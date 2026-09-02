import type { AuthContext } from "../_shared/auth-guard.ts";
import { AuthError, guardRequest } from "../_shared/auth-guard.ts";
import {
  buildCkanSearchUrl,
  CkanDispatchError,
  type GovernmentCatalogue,
  type GovernmentDatasetSummary,
  searchGovernmentCatalogue,
} from "../_shared/ckan-client.ts";
import {
  handleOptions,
  jsonResponse,
  rejectForbiddenOrigin,
} from "../_shared/cors.ts";

interface GovernmentEvidenceRequest {
  query: string;
  queryOrigin: "explicit-user-public-terms";
  consent: {
    approvedResearch: true;
    publicQuery: true;
  };
  jurisdictions: GovernmentCatalogue[];
  limitPerCatalogue: number;
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

export interface GovernmentEvidenceDependencies {
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
  searchCatalogue(input: {
    catalogue: GovernmentCatalogue;
    query: string;
    limit: number;
  }): Promise<GovernmentDatasetSummary[]>;
}

interface CatalogueDispatch {
  catalogue: GovernmentCatalogue;
  egressRoute: string;
  resourceSha256: string;
}

type CatalogueOutcome =
  | {
    status: "success";
    catalogue: GovernmentCatalogue;
    datasets: GovernmentDatasetSummary[];
  }
  | {
    status: "unavailable";
    catalogue: GovernmentCatalogue;
    message: string;
  };

const EGRESS_KIND = "approved-research";
const LOGICAL_REQUEST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const PUBLIC_QUERY_PATTERN = /^[\p{L}\p{N} &'(),.\/-]+$/u;
const REQUEST_FIELDS = [
  "consent",
  "generation_request_id",
  "jurisdictions",
  "limitPerCatalogue",
  "query",
  "queryOrigin",
  "request_id",
] as const;

const PRIVATE_QUERY_PATTERNS: RegExp[] = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /(?:https?:\/\/|www\.)/iu,
  /\b(?:\+?61|0)[23478](?:[\s()-]*\d){8}\b/u,
  /\b\d{1,5}\s+[\p{L}][\p{L}\s'-]{1,40}\s+(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|court|ct|place|pl)\b/iu,
  /\b(?:date of birth|dob|tax file number|tfn|medicare|passport|driver'?s? licence)\b/iu,
  /\b(?:my name is|i live at|contact me|my resume|my résumé|cover letter|curriculum vitae)\b/iu,
  /\b(?:ignore (?:all |the )?(?:previous|prior)|system prompt|you are (?:chatgpt|ted|an? assistant)|follow these instructions|reveal (?:the )?(?:prompt|instructions)|begin (?:document|resume)|end (?:document|resume))\b/iu,
  /```|<\/?(?:system|assistant|user)>|^#{1,6}\s/mu,
];

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

function parseConsent(value: unknown): GovernmentEvidenceRequest["consent"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestFailure(
      403,
      "APPROVED_RESEARCH_CONSENT_REQUIRED",
      "Approve this public-data research query before sending it.",
    );
  }
  const consent = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(consent, ["approvedResearch", "publicQuery"]) ||
    consent.approvedResearch !== true || consent.publicQuery !== true
  ) {
    throw new RequestFailure(
      403,
      "APPROVED_RESEARCH_CONSENT_REQUIRED",
      "Approve this public-data research query before sending it.",
    );
  }
  return { approvedResearch: true, publicQuery: true };
}

export function normalisePublicGovernmentQuery(value: unknown): string {
  if (
    typeof value !== "string" ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    }) ||
    value !== value.trim()
  ) {
    throw new RequestFailure(
      400,
      "PUBLIC_RESEARCH_QUERY_INVALID",
      "Use only short, public, non-sensitive catalogue search terms.",
    );
  }
  const query = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const wordCount = query.split(" ").filter(Boolean).length;
  if (
    query.length < 2 || query.length > 120 || wordCount > 16 ||
    !PUBLIC_QUERY_PATTERN.test(query) ||
    PRIVATE_QUERY_PATTERNS.some((pattern) => pattern.test(query)) ||
    /\b\d{7,}\b/u.test(query)
  ) {
    throw new RequestFailure(
      400,
      "PUBLIC_RESEARCH_QUERY_REJECTED",
      "The query appears to contain private, document, or instruction text. Enter only public catalogue search terms.",
    );
  }
  return query;
}

export function parseGovernmentEvidenceRequest(
  body: unknown,
): GovernmentEvidenceRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestFailure(
      400,
      "GOVERNMENT_EVIDENCE_REQUEST_INVALID",
      "A JSON request body is required.",
    );
  }
  const input = body as Record<string, unknown>;
  if (!hasOnlyKeys(input, REQUEST_FIELDS)) {
    throw new RequestFailure(
      400,
      "GOVERNMENT_EVIDENCE_EXCESS_FIELDS",
      "The research request contains fields that are not needed for a public catalogue search.",
    );
  }
  if (input.queryOrigin !== "explicit-user-public-terms") {
    throw new RequestFailure(
      400,
      "PUBLIC_RESEARCH_QUERY_ORIGIN_REQUIRED",
      "Enter and confirm public search terms directly; document text is not sent silently.",
    );
  }
  const requested = input.jurisdictions === undefined
    ? ["australia", "victoria"]
    : input.jurisdictions;
  if (
    !Array.isArray(requested) || requested.length < 1 || requested.length > 2
  ) {
    throw new RequestFailure(
      400,
      "GOVERNMENT_EVIDENCE_REQUEST_INVALID",
      "jurisdictions may contain australia and victoria once each.",
    );
  }
  const jurisdictions = requested.filter(
    (value): value is GovernmentCatalogue =>
      value === "australia" || value === "victoria",
  );
  if (
    jurisdictions.length !== requested.length ||
    new Set(jurisdictions).size !== jurisdictions.length
  ) {
    throw new RequestFailure(
      400,
      "GOVERNMENT_EVIDENCE_REQUEST_INVALID",
      "jurisdictions may contain australia and victoria once each.",
    );
  }
  const limit = input.limitPerCatalogue === undefined
    ? 8
    : input.limitPerCatalogue;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 20) {
    throw new RequestFailure(
      400,
      "GOVERNMENT_EVIDENCE_REQUEST_INVALID",
      "limitPerCatalogue must be an integer between 1 and 20.",
    );
  }
  return {
    query: normalisePublicGovernmentQuery(input.query),
    queryOrigin: "explicit-user-public-terms",
    consent: parseConsent(input.consent),
    jurisdictions,
    limitPerCatalogue: Number(limit),
  };
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
      "Send a stable request identity for this external research request.",
    );
  }
  return auth.generationRequestId;
}

export async function buildCatalogueDispatch(
  input: GovernmentEvidenceRequest,
  requestId: string,
  catalogue: GovernmentCatalogue,
): Promise<CatalogueDispatch> {
  const url = new URL(
    buildCkanSearchUrl(catalogue, input.query, input.limitPerCatalogue),
  );
  const egressRoute = `ckan-${catalogue}`;
  const normalizedRequest = {
    method: "GET",
    origin: url.origin,
    path: url.pathname,
    query: Object.fromEntries(
      [...url.searchParams.entries()].sort(([left], [right]) =>
        left.localeCompare(right)
      ),
    ),
  };
  return {
    catalogue,
    egressRoute,
    resourceSha256: await sha256(canonicalJson({
      contract: "external-egress.resource.v1",
      logical_request_id: requestId,
      route: egressRoute,
      normalized_request: normalizedRequest,
    })),
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
  deps: GovernmentEvidenceDependencies,
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
        "Research is unavailable while account deletion is in progress.",
      );
    }
  }
  if (!response || response.error) {
    throw new RequestFailure(
      503,
      "EGRESS_ADMISSION_UNAVAILABLE",
      "The research request could not be admitted safely. Try again later.",
      true,
      2,
    );
  }
  const claim = record(response.data);
  if (!claim || claim.dispatch_token !== input.dispatchToken) {
    throw new RequestFailure(
      503,
      "EGRESS_ADMISSION_INVALID",
      "The research request could not be admitted safely. Try again later.",
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
      "This exact research request is already in progress. It was not sent again.",
      true,
      retryAfter,
    );
  }
  if (outcome === "completed") {
    throw new RequestFailure(
      409,
      "EGRESS_ALREADY_COMPLETED",
      "This exact research request already completed and was not sent again. Start new research to refresh it.",
    );
  }
  if (outcome === "reconciliation_required") {
    throw new RequestFailure(
      409,
      "EGRESS_RECONCILIATION_REQUIRED",
      "This research request has an unresolved prior dispatch and was not sent again.",
      false,
      retryAfter,
    );
  }
  throw new RequestFailure(
    503,
    "EGRESS_ADMISSION_INVALID",
    "The research request could not be admitted safely. Try again later.",
    true,
    2,
  );
}

async function completeWithAckRetry(
  deps: GovernmentEvidenceDependencies,
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

async function executeCatalogue(
  deps: GovernmentEvidenceDependencies,
  auth: AuthContext,
  input: GovernmentEvidenceRequest,
  requestId: string,
  catalogue: GovernmentCatalogue,
): Promise<CatalogueOutcome> {
  const dispatch = await buildCatalogueDispatch(input, requestId, catalogue);
  const dispatchToken = deps.createDispatchToken();
  const egress = {
    userId: auth.userId,
    egressKind: EGRESS_KIND,
    egressRoute: dispatch.egressRoute,
    resourceSha256: dispatch.resourceSha256,
    dispatchToken,
  };
  await claimWithAckRetry(deps, auth.admin, egress);

  let datasets: GovernmentDatasetSummary[];
  try {
    datasets = await deps.searchCatalogue({
      catalogue,
      query: input.query,
      limit: input.limitPerCatalogue,
    });
  } catch (error) {
    const terminalState = error instanceof CkanDispatchError &&
        error.dispatchCertain
      ? "completed" as const
      : "reconciliation_required" as const;
    const acknowledged = await completeWithAckRetry(deps, auth.admin, {
      ...egress,
      terminalState,
    });
    if (!acknowledged || terminalState === "reconciliation_required") {
      throw new RequestFailure(
        503,
        "EGRESS_RECONCILIATION_REQUIRED",
        "A government catalogue request may have been sent, but its completion is unresolved. It will not be sent again automatically.",
      );
    }
    return {
      status: "unavailable",
      catalogue,
      message: "This catalogue is temporarily unavailable.",
    };
  }

  const acknowledged = await completeWithAckRetry(deps, auth.admin, {
    ...egress,
    terminalState: "completed",
  });
  if (!acknowledged) {
    throw new RequestFailure(
      503,
      "EGRESS_RECONCILIATION_REQUIRED",
      "Government research completed, but its durable acknowledgement is unresolved. It will not be sent again automatically.",
    );
  }
  return { status: "success", catalogue, datasets };
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

const defaultDependencies: GovernmentEvidenceDependencies = {
  guard: (req) =>
    guardRequest(req, {
      enforceCap: false,
      rateLimitOperation: "government-evidence",
      rateLimitLimit: 20,
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
  searchCatalogue: ({ catalogue, query, limit }) =>
    searchGovernmentCatalogue({ catalogue, query, limit }),
};

export async function handleGovernmentEvidenceRequest(
  req: Request,
  dependencies: Partial<GovernmentEvidenceDependencies> = {},
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
    const input = parseGovernmentEvidenceRequest(auth.body);
    const settled = await Promise.allSettled(
      input.jurisdictions.map((catalogue) =>
        executeCatalogue(deps, auth, input, requestId, catalogue)
      ),
    );
    const failure = settled.find((result): result is PromiseRejectedResult =>
      result.status === "rejected"
    );
    if (failure) throw failure.reason;

    const outcomes = settled.map((result) =>
      (result as PromiseFulfilledResult<CatalogueOutcome>).value
    );
    const results = outcomes.flatMap((outcome) =>
      outcome.status === "success" ? outcome.datasets : []
    );
    const unavailable = outcomes.flatMap((outcome) =>
      outcome.status === "unavailable"
        ? [{ catalogue: outcome.catalogue, message: outcome.message }]
        : []
    );
    if (results.length === 0 && unavailable.length === outcomes.length) {
      throw new RequestFailure(
        503,
        "GOVERNMENT_CATALOGUES_UNAVAILABLE",
        "Government data catalogues are temporarily unavailable.",
      );
    }

    return jsonResponse(
      {
        data: {
          query: input.query,
          datasets: results,
          unavailable,
          retrievedAt: new Date().toISOString(),
        },
        source: "official-government-open-data-catalogues",
        requestId,
        privacy: {
          approvedResearchConsent: true,
          publicQueryOnly: true,
          queryOrigin: input.queryOrigin,
        },
      },
      200,
      origin,
    );
  } catch (error) {
    if (error instanceof RequestFailure) {
      return requestFailureResponse(error, origin);
    }
    console.error("GOVERNMENT_EVIDENCE_ERROR", { code: "UNEXPECTED_FAILURE" });
    return jsonResponse(
      {
        error: {
          code: "GOVERNMENT_EVIDENCE_FAILED",
          message: "Government evidence research is temporarily unavailable.",
          retryable: false,
        },
      },
      500,
      origin,
    );
  }
}
