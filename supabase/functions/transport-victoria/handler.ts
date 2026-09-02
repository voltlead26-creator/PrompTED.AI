import type { AuthContext } from "../_shared/auth-guard.ts";
import { AuthError, guardRequest } from "../_shared/auth-guard.ts";
import {
  handleOptions,
  jsonResponse,
  rejectForbiddenOrigin,
} from "../_shared/cors.ts";
import {
  PtvClient,
  ptvClientFromEnv,
  PtvConfigurationError,
  PtvDispatchError,
  type PtvQueryValue,
} from "../_shared/ptv-client.ts";

export type TransportAction =
  | "search"
  | "departures"
  | "nearby"
  | "disruptions"
  | "route-types";

interface TransportConsent {
  publicTransportLookup: true;
  preciseLocation?: true;
}

interface TransportRequest {
  action: TransportAction;
  consent: TransportConsent;
  searchTerm?: string;
  routeType?: number;
  stopId?: number;
  latitude?: number;
  longitude?: number;
  maxDistance?: number;
  maxResults?: number;
  dateUtc?: string;
}

export interface TransportDispatch {
  action: TransportAction;
  egressRoute: string;
  path: string;
  query: Record<string, PtvQueryValue>;
  resourceSha256: string;
  locationPrecision: typeof PTV_LOCATION_PRECISION_POLICY | null;
}

interface RpcError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

interface RpcResponse {
  data: unknown;
  error: RpcError | null;
}

interface EgressClaimInput {
  userId: string;
  egressKind: string;
  egressRoute: string;
  resourceSha256: string;
  dispatchToken: string;
}

interface EgressCompleteInput extends EgressClaimInput {
  terminalState: "completed" | "reconciliation_required";
}

export interface TransportDependencies {
  guard(req: Request): Promise<AuthContext>;
  claim(
    admin: AuthContext["admin"],
    input: EgressClaimInput,
  ): Promise<RpcResponse>;
  complete(
    admin: AuthContext["admin"],
    input: EgressCompleteInput,
  ): Promise<RpcResponse>;
  createDispatchToken(): string;
  createPtvClient(): PtvClient;
}

/**
 * Coordinates are rounded before egress to three decimal degrees. That is
 * approximately 110 metres of latitude (and less longitude in Victoria),
 * sufficient to locate nearby stops without sending device-grade GPS data.
 */
export const PTV_LOCATION_PRECISION_POLICY = {
  decimalPlaces: 3,
  approximateLatitudeMetres: 110,
  purpose: "nearby-public-transport-stop-search",
} as const;

const EGRESS_KIND = "public-transport";
const LOGICAL_REQUEST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SEARCH_TERM_PATTERN = /^[\p{L}\p{N} '&().,\/-]+$/u;
const VICTORIA_BOUNDS = {
  minimumLatitude: -39.5,
  maximumLatitude: -33.5,
  minimumLongitude: 140.5,
  maximumLongitude: 150.5,
} as const;

const ACTION_FIELDS: Record<TransportAction, readonly string[]> = {
  "route-types": ["action", "consent", "generation_request_id", "request_id"],
  search: [
    "action",
    "consent",
    "generation_request_id",
    "latitude",
    "longitude",
    "maxDistance",
    "request_id",
    "routeType",
    "searchTerm",
  ],
  nearby: [
    "action",
    "consent",
    "generation_request_id",
    "latitude",
    "longitude",
    "maxDistance",
    "maxResults",
    "request_id",
    "routeType",
  ],
  departures: [
    "action",
    "consent",
    "dateUtc",
    "generation_request_id",
    "maxResults",
    "request_id",
    "routeType",
    "stopId",
  ],
  disruptions: [
    "action",
    "consent",
    "generation_request_id",
    "request_id",
    "routeType",
  ],
};

class RequestFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function integerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  name: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    !Number.isInteger(value) || Number(value) < minimum ||
    Number(value) > maximum
  ) {
    throw new RequestFailure(
      400,
      "TRANSPORT_REQUEST_INVALID",
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return Number(value);
}

function finiteNumberInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  name: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== "number" || !Number.isFinite(value) || value < minimum ||
    value > maximum
  ) {
    throw new RequestFailure(
      400,
      "TRANSPORT_REQUEST_INVALID",
      `${name} is outside the supported Victorian transport area.`,
    );
  }
  return value;
}

function preciseCoordinate(value: number): number {
  return Number(value.toFixed(PTV_LOCATION_PRECISION_POLICY.decimalPlaces));
}

function parseConsent(value: unknown): TransportConsent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestFailure(
      403,
      "TRANSPORT_CONSENT_REQUIRED",
      "Confirm the public transport lookup before sharing a query.",
    );
  }
  const consent = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(consent, ["preciseLocation", "publicTransportLookup"]) ||
    consent.publicTransportLookup !== true ||
    (consent.preciseLocation !== undefined && consent.preciseLocation !== true)
  ) {
    throw new RequestFailure(
      403,
      "TRANSPORT_CONSENT_REQUIRED",
      "Confirm the public transport lookup before sharing a query.",
    );
  }
  return {
    publicTransportLookup: true,
    preciseLocation: consent.preciseLocation === true ? true : undefined,
  };
}

function parseSearchTerm(value: unknown): string {
  if (
    typeof value !== "string" ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    })
  ) {
    throw new RequestFailure(
      400,
      "TRANSPORT_REQUEST_INVALID",
      "searchTerm must be a short stop, station, suburb, or landmark name.",
    );
  }
  const term = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (
    term.length < 2 || term.length > 80 || !SEARCH_TERM_PATTERN.test(term) ||
    /(?:https?:\/\/|www\.|@)/iu.test(term)
  ) {
    throw new RequestFailure(
      400,
      "TRANSPORT_REQUEST_INVALID",
      "searchTerm must be a short stop, station, suburb, or landmark name.",
    );
  }
  return term;
}

function parseDateUtc(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (
    typeof value !== "string" || value.length > 35 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/u
      .test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new RequestFailure(
      400,
      "TRANSPORT_REQUEST_INVALID",
      "dateUtc must be an RFC 3339 date and time with a timezone.",
    );
  }
  return value;
}

export function parseTransportRequest(body: unknown): TransportRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestFailure(
      400,
      "TRANSPORT_REQUEST_INVALID",
      "A JSON request body is required.",
    );
  }
  const input = body as Record<string, unknown>;
  const actions: TransportAction[] = [
    "search",
    "departures",
    "nearby",
    "disruptions",
    "route-types",
  ];
  if (
    typeof input.action !== "string" ||
    !actions.includes(input.action as TransportAction)
  ) {
    throw new RequestFailure(
      400,
      "TRANSPORT_REQUEST_INVALID",
      "Unsupported transport action.",
    );
  }
  const action = input.action as TransportAction;
  if (!hasOnlyKeys(input, ACTION_FIELDS[action])) {
    throw new RequestFailure(
      400,
      "TRANSPORT_EXCESS_FIELDS",
      "The transport request contains fields that are not needed for this lookup.",
    );
  }

  const consent = parseConsent(input.consent);
  const routeType = integerInRange(input.routeType, 0, 6, "routeType");
  const stopId = integerInRange(input.stopId, 1, 99_999_999, "stopId");
  const maxDistance = integerInRange(
    input.maxDistance,
    50,
    10_000,
    "maxDistance",
  );
  const maxResults = integerInRange(input.maxResults, 1, 20, "maxResults");
  const latitude = finiteNumberInRange(
    input.latitude,
    VICTORIA_BOUNDS.minimumLatitude,
    VICTORIA_BOUNDS.maximumLatitude,
    "latitude",
  );
  const longitude = finiteNumberInRange(
    input.longitude,
    VICTORIA_BOUNDS.minimumLongitude,
    VICTORIA_BOUNDS.maximumLongitude,
    "longitude",
  );
  if ((latitude === undefined) !== (longitude === undefined)) {
    throw new RequestFailure(
      400,
      "TRANSPORT_REQUEST_INVALID",
      "latitude and longitude must be supplied together.",
    );
  }
  if (latitude !== undefined && consent.preciseLocation !== true) {
    throw new RequestFailure(
      403,
      "TRANSPORT_LOCATION_CONSENT_REQUIRED",
      "Confirm location sharing before searching from a location.",
    );
  }

  const request: TransportRequest = {
    action,
    consent,
    routeType,
    stopId,
    latitude: latitude === undefined ? undefined : preciseCoordinate(latitude),
    longitude: longitude === undefined
      ? undefined
      : preciseCoordinate(longitude),
    maxDistance,
    maxResults,
    dateUtc: parseDateUtc(input.dateUtc),
  };

  if (action === "search") {
    request.searchTerm = parseSearchTerm(input.searchTerm);
  }
  if (action === "nearby" && request.latitude === undefined) {
    throw new RequestFailure(
      400,
      "TRANSPORT_REQUEST_INVALID",
      "latitude and longitude are required for a nearby lookup.",
    );
  }
  if (
    action === "departures" && (routeType === undefined || stopId === undefined)
  ) {
    throw new RequestFailure(
      400,
      "TRANSPORT_REQUEST_INVALID",
      "routeType and stopId are required for departures.",
    );
  }
  return request;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${
    Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")
  }}`;
}

function compactQuery(
  query: Record<string, PtvQueryValue>,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(query)
      .filter(([, value]) =>
        value !== undefined && value !== null && value !== ""
      )
      .sort(([left], [right]) => left.localeCompare(right)) as Array<
        [string, string | number | boolean]
      >,
  );
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function logicalRequestId(req: Request, auth: AuthContext): string {
  const body = auth.body ?? {};
  const hasExplicitIdentity = (typeof body.request_id === "string" &&
    body.request_id.trim().length > 0) ||
    (typeof body.generation_request_id === "string" &&
      body.generation_request_id.trim().length > 0) ||
    (req.headers.get("x-idempotency-key")?.trim().length ?? 0) > 0;
  if (
    !hasExplicitIdentity || !auth.generationRequestId ||
    !LOGICAL_REQUEST_PATTERN.test(auth.generationRequestId)
  ) {
    throw new RequestFailure(
      400,
      "EGRESS_REQUEST_ID_REQUIRED",
      "Send a stable request identity for this external lookup.",
    );
  }
  return auth.generationRequestId;
}

export async function buildTransportDispatch(
  request: TransportRequest,
  requestId: string,
): Promise<TransportDispatch> {
  let path: string;
  let query: Record<string, PtvQueryValue> = {};
  switch (request.action) {
    case "route-types":
      path = "/v3/route_types";
      break;
    case "search":
      path = `/v3/search/${encodeURIComponent(request.searchTerm!)}`;
      query = {
        route_types: request.routeType,
        latitude: request.latitude,
        longitude: request.longitude,
        max_distance: request.maxDistance,
        include_outlets: false,
        match_stop_by_suburb: true,
      };
      break;
    case "nearby":
      path = `/v3/stops/location/${request.latitude},${request.longitude}`;
      query = {
        route_types: request.routeType,
        max_distance: request.maxDistance ?? 1500,
        max_results: request.maxResults ?? 10,
      };
      break;
    case "departures":
      path =
        `/v3/departures/route_type/${request.routeType}/stop/${request.stopId}`;
      query = {
        date_utc: request.dateUtc,
        max_results: request.maxResults ?? 10,
        include_cancelled: true,
      };
      break;
    case "disruptions":
      path = request.routeType === undefined
        ? "/v3/disruptions"
        : `/v3/disruptions/route_type/${request.routeType}`;
      break;
  }
  const egressRoute = `ptv-${request.action}`;
  const normalizedRequest = {
    method: "GET",
    path,
    query: compactQuery(query),
  };
  const resourceSha256 = await sha256(canonicalJson({
    contract: "external-egress.resource.v1",
    logical_request_id: requestId,
    route: egressRoute,
    normalized_request: normalizedRequest,
  }));
  return {
    action: request.action,
    egressRoute,
    path,
    query,
    resourceSha256,
    locationPrecision: request.latitude === undefined
      ? null
      : PTV_LOCATION_PRECISION_POLICY,
  };
}

function rpcErrorText(error: RpcError | null): string {
  return [error?.code, error?.message, error?.details, error?.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function claimWithAckRetry(
  deps: TransportDependencies,
  admin: AuthContext["admin"],
  input: EgressClaimInput,
): Promise<void> {
  let response: RpcResponse | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await deps.claim(admin, input);
    } catch (error) {
      response = {
        data: null,
        error: {
          message: error instanceof Error ? error.message : "EGRESS_RPC_FAILED",
        },
      };
    }
    if (!response.error) break;
    if (rpcErrorText(response.error).includes("ACCOUNT_DELETION_FENCED")) {
      throw new RequestFailure(
        409,
        "ACCOUNT_DELETION_IN_PROGRESS",
        "This lookup is unavailable while account deletion is in progress.",
      );
    }
  }
  if (!response || response.error) {
    throw new RequestFailure(
      503,
      "EGRESS_ADMISSION_UNAVAILABLE",
      "The external lookup could not be admitted safely. Try again later.",
      true,
      2,
    );
  }
  const claim = record(response.data);
  if (!claim || claim.dispatch_token !== input.dispatchToken) {
    throw new RequestFailure(
      503,
      "EGRESS_ADMISSION_INVALID",
      "The external lookup could not be admitted safely. Try again later.",
      true,
      2,
    );
  }
  const outcome = String(claim.outcome ?? "");
  if (
    claim.egress_permitted === true &&
    (outcome === "accepted" || outcome === "idempotent_replay")
  ) return;

  const retryAfter = Number.isInteger(claim.retry_after_seconds)
    ? Math.max(1, Math.min(30, Number(claim.retry_after_seconds)))
    : 2;
  if (outcome === "processing") {
    throw new RequestFailure(
      409,
      "EGRESS_ALREADY_PROCESSING",
      "This exact lookup is already in progress. It was not sent again.",
      true,
      retryAfter,
    );
  }
  if (outcome === "completed") {
    throw new RequestFailure(
      409,
      "EGRESS_ALREADY_COMPLETED",
      "This exact lookup already completed and was not sent again. Start a new lookup to refresh it.",
    );
  }
  if (outcome === "reconciliation_required") {
    throw new RequestFailure(
      409,
      "EGRESS_RECONCILIATION_REQUIRED",
      "This lookup has an unresolved prior dispatch and was not sent again.",
      false,
      retryAfter,
    );
  }
  throw new RequestFailure(
    503,
    "EGRESS_ADMISSION_INVALID",
    "The external lookup could not be admitted safely. Try again later.",
    true,
    2,
  );
}

async function completeWithAckRetry(
  deps: TransportDependencies,
  admin: AuthContext["admin"],
  input: EgressCompleteInput,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: RpcResponse;
    try {
      response = await deps.complete(admin, input);
    } catch {
      response = { data: null, error: { message: "EGRESS_RPC_FAILED" } };
    }
    if (response.error) continue;
    const completion = record(response.data);
    return (completion?.outcome === "completed" ||
      completion?.outcome === "idempotent_replay") &&
      completion?.terminal_state === input.terminalState;
  }
  return false;
}

function requestFailureResponse(
  failure: RequestFailure,
  origin: string | null,
): Response {
  const response = jsonResponse(
    {
      error: {
        code: failure.code,
        message: failure.message,
        retryable: failure.retryable,
      },
    },
    failure.status,
    origin,
  );
  if (failure.retryAfterSeconds !== undefined) {
    response.headers.set("Retry-After", String(failure.retryAfterSeconds));
  }
  return response;
}

const defaultDependencies: TransportDependencies = {
  guard: (req) =>
    guardRequest(req, {
      enforceCap: false,
      rateLimitOperation: "transport-victoria",
      rateLimitLimit: 30,
      rateLimitWindowSeconds: 60,
    }),
  claim: async (admin, input) => {
    const { data, error } = await admin.rpc("claim_user_external_egress", {
      p_user_id: input.userId,
      p_egress_kind: input.egressKind,
      p_egress_route: input.egressRoute,
      p_resource_sha256: input.resourceSha256,
      p_dispatch_token: input.dispatchToken,
    });
    return { data, error };
  },
  complete: async (admin, input) => {
    const { data, error } = await admin.rpc("complete_user_external_egress", {
      p_user_id: input.userId,
      p_egress_kind: input.egressKind,
      p_egress_route: input.egressRoute,
      p_resource_sha256: input.resourceSha256,
      p_dispatch_token: input.dispatchToken,
      p_terminal_state: input.terminalState,
    });
    return { data, error };
  },
  createDispatchToken: () => crypto.randomUUID(),
  createPtvClient: () => ptvClientFromEnv(),
};

export async function handleTransportVictoriaRequest(
  req: Request,
  dependencies: Partial<TransportDependencies> = {},
): Promise<Response> {
  const deps = { ...defaultDependencies, ...dependencies };
  const options = handleOptions(req);
  if (options) return options;
  const forbidden = rejectForbiddenOrigin(req);
  if (forbidden) return forbidden;
  const origin = req.headers.get("origin");
  if (req.method !== "POST") {
    return jsonResponse(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } },
      405,
      origin,
    );
  }

  let auth: AuthContext;
  try {
    auth = await deps.guard(req);
  } catch (error) {
    if (error instanceof AuthError) {
      return jsonResponse(error.payload, error.status, origin);
    }
    return jsonResponse(
      {
        error: {
          code: "AUTH_VERIFICATION_FAILED",
          message: "Your account identity could not be verified.",
        },
      },
      500,
      origin,
    );
  }

  try {
    const requestId = logicalRequestId(req, auth);
    const input = parseTransportRequest(auth.body);
    const dispatch = await buildTransportDispatch(input, requestId);
    let ptv: PtvClient;
    try {
      ptv = deps.createPtvClient();
    } catch (error) {
      if (error instanceof PtvConfigurationError) {
        throw new RequestFailure(
          503,
          "TRANSPORT_NOT_CONFIGURED",
          "Public transport information is temporarily unavailable.",
        );
      }
      throw error;
    }
    const dispatchToken = deps.createDispatchToken();
    const egress = {
      userId: auth.userId,
      egressKind: EGRESS_KIND,
      egressRoute: dispatch.egressRoute,
      resourceSha256: dispatch.resourceSha256,
      dispatchToken,
    };
    await claimWithAckRetry(deps, auth.admin, egress);

    let data: unknown;
    try {
      data = await ptv.get(dispatch.path, dispatch.query);
    } catch (error) {
      const terminalState = error instanceof PtvDispatchError &&
          error.dispatchCertain
        ? "completed" as const
        : "reconciliation_required" as const;
      const completionAcknowledged = await completeWithAckRetry(
        deps,
        auth.admin,
        { ...egress, terminalState },
      );
      if (
        !completionAcknowledged || terminalState === "reconciliation_required"
      ) {
        throw new RequestFailure(
          503,
          "EGRESS_RECONCILIATION_REQUIRED",
          "The transport lookup may have been sent, but its completion could not be confirmed. It will not be sent again automatically.",
        );
      }
      throw new RequestFailure(
        503,
        "TRANSPORT_LOOKUP_UNAVAILABLE",
        "Public transport information is temporarily unavailable.",
      );
    }

    const completionAcknowledged = await completeWithAckRetry(
      deps,
      auth.admin,
      { ...egress, terminalState: "completed" },
    );
    if (!completionAcknowledged) {
      throw new RequestFailure(
        503,
        "EGRESS_RECONCILIATION_REQUIRED",
        "The transport lookup completed, but its durable acknowledgement is unresolved. It will not be sent again automatically.",
      );
    }

    return jsonResponse(
      {
        data,
        source: "ptv-v3",
        requestId,
        privacy: {
          externalLookupConsent: true,
          locationPrecision: dispatch.locationPrecision,
        },
      },
      200,
      origin,
    );
  } catch (error) {
    if (error instanceof RequestFailure) {
      return requestFailureResponse(error, origin);
    }
    console.error("TRANSPORT_VICTORIA_ERROR", { code: "UNEXPECTED_FAILURE" });
    return jsonResponse(
      {
        error: {
          code: "TRANSPORT_LOOKUP_FAILED",
          message: "Public transport information is temporarily unavailable.",
          retryable: false,
        },
      },
      500,
      origin,
    );
  }
}
