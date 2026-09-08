import {
  handleOptions,
  jsonResponse,
  rejectForbiddenOrigin,
} from "../_shared/cors.ts";
import { AuthError, type AuthContext, guardRequest } from "../_shared/auth-guard.ts";
import {
  assertBusinessDays,
  buildPublicHolidaysUrl,
  calculateBusinessDeadline,
  fetchPublicHolidays,
  HolidayDispatchError,
  HolidayInputError,
  type PublicHoliday,
} from "../_shared/public-holidays.ts";

const EGRESS_KIND = "public-holidays";
const EGRESS_ROUTE = "nager-holidays";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const REQUEST_FIELDS = new Set([
  "startDate", "businessDays", "countryCode", "subdivisionCode",
  "request_id", "generation_request_id",
]);

// The existing calculator joins year lookups and gives uncertain dispatches
// precedence. Preserve that same distinction for durable admission/ACK errors.
class DeadlineFailure extends HolidayDispatchError {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    dispatchCertain = true,
    readonly retryable = false,
  ) {
    super(message, dispatchCertain);
  }
}

function invalidRequest(message: string): never {
  throw new DeadlineFailure(400, "DEADLINE_REQUEST_INVALID", message);
}

function parseRequest(body: Record<string, unknown> | null): {
  startDate: string;
  businessDays: number;
  countryCode: string;
  subdivisionCode?: string;
} {
  if (!body || Array.isArray(body)) invalidRequest("A JSON request body is required.");
  if (Object.keys(body).some((key) => !REQUEST_FIELDS.has(key))) {
    invalidRequest("The deadline request contains unsupported fields.");
  }
  if (typeof body.startDate !== "string") invalidRequest("startDate is required.");
  assertBusinessDays(body.businessDays);
  for (const key of ["request_id", "generation_request_id"]) {
    const value = body[key];
    if (value !== undefined && (typeof value !== "string" || !REQUEST_ID_PATTERN.test(value))) {
      invalidRequest("The request identity is invalid.");
    }
  }
  if (body.countryCode !== undefined && typeof body.countryCode !== "string") {
    invalidRequest("countryCode must be a two-letter ISO code.");
  }
  const countryCode = body.countryCode === undefined ? "AU" : body.countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) invalidRequest("countryCode must be a two-letter ISO code.");
  let subdivisionCode: string | undefined;
  if (body.subdivisionCode !== undefined) {
    if (typeof body.subdivisionCode !== "string") invalidRequest("subdivisionCode must be a same-country subdivision code.");
    subdivisionCode = body.subdivisionCode.trim().toUpperCase();
    if (!/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(subdivisionCode) || !subdivisionCode.startsWith(`${countryCode}-`)) {
      invalidRequest("subdivisionCode must be a same-country subdivision code.");
    }
  }
  return { startDate: body.startDate, businessDays: body.businessDays, countryCode, subdivisionCode };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const valueRecord = value as Record<string, unknown>;
  return `{${Object.keys(valueRecord).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(valueRecord[key])}`).join(",")}}`;
}

interface EgressIdentity {
  p_user_id: string;
  p_egress_kind: string;
  p_egress_route: string;
  p_resource_sha256: string;
  p_dispatch_token: string;
}

async function lookupIdentity(auth: AuthContext, year: number, country: string): Promise<EgressIdentity> {
  const requestId = auth.generationRequestId;
  if (!requestId || !REQUEST_ID_PATTERN.test(requestId)) {
    throw new DeadlineFailure(503, "EGRESS_REQUEST_ID_UNAVAILABLE", "The deadline request could not be identified safely.");
  }
  const url = new URL(buildPublicHolidaysUrl(year, country));
  const bytes = new TextEncoder().encode(canonicalJson({
    contract: "external-egress.resource.v1",
    logical_request_id: requestId,
    route: EGRESS_ROUTE,
    normalized_request: { method: "GET", origin: url.origin, path: url.pathname, query: {} },
  }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return {
    p_user_id: auth.userId,
    p_egress_kind: EGRESS_KIND,
    p_egress_route: EGRESS_ROUTE,
    p_resource_sha256: Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    p_dispatch_token: crypto.randomUUID(),
  };
}

function reconciliationFailure(): DeadlineFailure {
  return new DeadlineFailure(
    503, "EGRESS_RECONCILIATION_REQUIRED",
    "A holiday lookup has an unresolved acknowledgement. It will not be sent again automatically.",
    false,
  );
}

async function claimWithAckRetry(auth: AuthContext, identity: EgressIdentity): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let data: unknown;
    try {
      const result = await auth.admin.rpc("claim_user_external_egress", { ...identity });
      if (result.error) {
        if ([result.error.code, result.error.message, result.error.details, result.error.hint].some((value) =>
          typeof value === "string" && value.includes("ACCOUNT_DELETION_FENCED"))) {
          throw new DeadlineFailure(409, "ACCOUNT_DELETION_IN_PROGRESS", "Deadline lookup is unavailable while account deletion is in progress.");
        }
        continue;
      }
      data = result.data;
    } catch (error) {
      if (error instanceof DeadlineFailure) throw error;
      // Retry only this exact immutable identity/token after an uncertain ACK.
      continue;
    }
    const receipt = record(data);
    if (!receipt || receipt.dispatch_token !== identity.p_dispatch_token) throw reconciliationFailure();
    if (receipt.egress_permitted === true &&
      (receipt.outcome === "accepted" || receipt.outcome === "idempotent_replay")) return;
    if (receipt.egress_permitted !== false) throw reconciliationFailure();
    if (receipt.outcome === "completed") {
      throw new DeadlineFailure(409, "EGRESS_ALREADY_COMPLETED", "This exact holiday lookup already completed and was not sent again. Start a new request to refresh it.");
    }
    if (receipt.outcome === "processing") {
      throw new DeadlineFailure(409, "EGRESS_ALREADY_PROCESSING", "This exact holiday lookup is already in progress and was not sent again.", true, true);
    }
    if (receipt.outcome === "reconciliation_required") {
      throw new DeadlineFailure(409, "EGRESS_RECONCILIATION_REQUIRED", "This exact holiday lookup has an unresolved prior dispatch and was not sent again.", false);
    }
    throw reconciliationFailure();
  }
  throw reconciliationFailure();
}

async function completeWithAckRetry(
  auth: AuthContext,
  identity: EgressIdentity,
  terminalState: "completed" | "reconciliation_required",
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await auth.admin.rpc("complete_user_external_egress", {
        ...identity, p_terminal_state: terminalState,
      });
      if (error) continue;
      const receipt = record(data);
      return (receipt?.outcome === "completed" || receipt?.outcome === "idempotent_replay") &&
        receipt.terminal_state === terminalState;
    } catch {
      // Replay only the same terminal command; never repeat the provider call.
    }
  }
  return false;
}

async function admittedYearLookup(
  auth: AuthContext,
  year: number,
  country: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<PublicHoliday[]> {
  signal.throwIfAborted();
  const identity = await lookupIdentity(auth, year, country);
  signal.throwIfAborted();
  await claimWithAckRetry(auth, identity);
  let dispatched = false;
  let holidays: PublicHoliday[];
  try {
    signal.throwIfAborted();
    dispatched = true;
    holidays = await fetchPublicHolidays(year, country, fetchImpl, signal);
  } catch (error) {
    const certain = !dispatched || (error instanceof HolidayDispatchError && error.dispatchCertain);
    const terminalState = certain ? "completed" : "reconciliation_required";
    const acknowledged = await completeWithAckRetry(auth, identity, terminalState);
    if (!acknowledged || !certain) throw reconciliationFailure();
    if (signal.aborted) throw signal.reason;
    throw new DeadlineFailure(503, "HOLIDAY_PROVIDER_UNAVAILABLE", "Holiday information is temporarily unavailable. The deadline was not calculated.", true, true);
  }
  if (!await completeWithAckRetry(auth, identity, "completed")) throw reconciliationFailure();
  signal.throwIfAborted();
  return holidays;
}

export async function handleCalculateDeadlineRequest(req: Request): Promise<Response> {
  const options = handleOptions(req);
  if (options) return options;
  const forbidden = rejectForbiddenOrigin(req);
  if (forbidden) return forbidden;
  const origin = req.headers.get("origin");
  if (req.method !== "POST") {
    return jsonResponse({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } }, 405, origin);
  }
  const fetchImpl = fetch;
  let auth: AuthContext;
  try {
    auth = await guardRequest(req, { enforceCap: false });
  } catch (error) {
    if (error instanceof AuthError) return jsonResponse(error.payload, error.status, origin);
    return jsonResponse({ error: { code: "AUTH_VERIFICATION_FAILED", message: "Your account could not be verified. Try again later." } }, 500, origin);
  }
  try {
    req.signal.throwIfAborted();
    const input = parseRequest(auth.body);
    const result = await calculateBusinessDeadline({
      ...input,
      signal: req.signal,
      lookupHolidays: (year, country) => admittedYearLookup(auth, year, country, req.signal, fetchImpl),
    });
    req.signal.throwIfAborted();
    return jsonResponse({
      data: { ...result, startDate: input.startDate, businessDays: input.businessDays,
        countryCode: input.countryCode, subdivisionCode: input.subdivisionCode ?? null },
      source: "nager-date-v4",
    }, 200, origin);
  } catch (error) {
    if (error instanceof DeadlineFailure) {
      return jsonResponse({ error: { code: error.code, message: error.message, retryable: error.retryable } }, error.status, origin);
    }
    if (req.signal.aborted) {
      return jsonResponse({ error: { code: "REQUEST_CANCELLED", message: "The deadline request was cancelled.", retryable: false } }, 499, origin);
    }
    if (error instanceof HolidayInputError) {
      return jsonResponse({ error: { code: "DEADLINE_REQUEST_INVALID", message: error.message, retryable: false } }, 400, origin);
    }
    console.error("DEADLINE_CALCULATION_ERROR", { code: "UNEXPECTED_FAILURE" });
    return jsonResponse({ error: { code: "DEADLINE_CALCULATION_FAILED", message: "The deadline could not be calculated. Try again later.", retryable: false } }, 500, origin);
  }
}
