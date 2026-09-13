// deno-lint-ignore no-import-prefix -- Deployed Edge SDK type uses the direct JSR dependency pinned by the repository lockfile.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { PAYWALL_PAYLOAD, type Plan } from "./auth-guard.ts";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const ROUTE_KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,79}$/;

export interface AllowanceReservation {
  reservationId: string;
  requestId: string;
  routeKey: string;
  expiresAt: string;
  executionClaimToken?: string;
  replayResult?: DurableAllowanceResult;
  executionPolicy?: AllowanceExecutionPolicy;
}

export interface AllowanceExecutionPolicy {
  version: "legacy-template-policy.1";
  sha256: string;
}

export interface AllowanceReplayRead {
  state: "absent" | "unsettled" | "settled";
  reservation: AllowanceReservation | null;
  hasPriorProviderWork: boolean;
  reconciliationRequired: boolean;
}

export interface DurableAllowanceResult {
  contract_version: "allowance-result.1";
  route_key: string;
  transport: "json" | "sse";
  payload: Record<string, unknown>;
}

export interface AllowanceRequestIdentity {
  requestId: string;
  provenance: "client_supplied" | "server_derived_legacy_v1";
}

export const RECONCILIATION_REQUIRED_PAYLOAD = {
  error: {
    code: "GENERATION_RECONCILIATION_REQUIRED",
    message:
      "TED cannot safely retry this generation because its provider or accounting outcome needs reconciliation. The request remains held until an explicit reconciliation decision is made.",
    retryable: false,
    workflow_state: "awaiting_provider_reconciliation",
  },
} as const;

export class AllowanceReservationError extends Error {
  constructor(
    public readonly status: 400 | 402 | 409 | 500,
    public readonly code: string,
    public readonly payload: Record<string, unknown>,
  ) {
    super(code);
  }
}

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalise(item)]),
    );
  }
  return value;
}

export async function allowanceRequestSha256(
  routeKey: string,
  body: Record<string, unknown>,
): Promise<string> {
  const encoded = new TextEncoder().encode(
    JSON.stringify(canonicalise({ route_key: routeKey, body })),
  );
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function requireAllowanceRequestId(value: unknown): string {
  const requestId = typeof value === "string" ? value.trim() : "";
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new AllowanceReservationError(400, "INVALID_GENERATION_REQUEST_ID", {
      error: {
        code: "INVALID_GENERATION_REQUEST_ID",
        message:
          "A stable generation request ID is required. Reuse it only when retrying the same generation.",
      },
    });
  }
  return requestId;
}

/**
 * Bounded compatibility for clients released before generation_request_id.
 * The exact owner, route, and canonical request body produce one stable ID,
 * so response-loss retries cannot consume a second allowance. Telemetry is
 * content-free and names the removal gate explicitly.
 */
export async function resolveAllowanceRequestIdentity(
  value: unknown,
  params: {
    userId: string;
    routeKey: "generate-document" | "generate-checklist" | "generate-report";
    body: Record<string, unknown>;
  },
): Promise<AllowanceRequestIdentity> {
  if (typeof value === "string" && value.trim()) {
    return {
      requestId: requireAllowanceRequestId(value),
      provenance: "client_supplied",
    };
  }
  if (
    (Deno.env.get("PROMPTED_LEGACY_REQUEST_ID_ADAPTER") ?? "enabled")
      .trim().toLowerCase() === "disabled"
  ) {
    requireAllowanceRequestId(value);
  }
  const fingerprint = await allowanceRequestSha256(
    `${params.routeKey}:legacy-request-id-v1`,
    { user_id: params.userId, body: params.body },
  );
  const requestId = `legacy:${params.routeKey}:${fingerprint}`;
  console.warn(JSON.stringify({
    event: "legacy_generation_request_id_adapter",
    adapter_version: "legacy-request-id-v1",
    route_key: params.routeKey,
    removal_gate: "PROMPTED_LEGACY_REQUEST_ID_ADAPTER=disabled",
  }));
  return { requestId, provenance: "server_derived_legacy_v1" };
}

function durableResult(
  value: unknown,
  routeKey: string,
): DurableAllowanceResult | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const result = value as Record<string, unknown>;
  if (
    result.contract_version !== "allowance-result.1" ||
    result.route_key !== routeKey ||
    !["json", "sse"].includes(String(result.transport)) ||
    !result.payload || typeof result.payload !== "object" ||
    Array.isArray(result.payload)
  ) return undefined;
  return result as unknown as DurableAllowanceResult;
}

function databaseMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error ?? "unknown");
}

function persistenceError(): AllowanceReservationError {
  return new AllowanceReservationError(500, "ALLOWANCE_PERSISTENCE_FAILED", {
    error: {
      code: "ALLOWANCE_PERSISTENCE_FAILED",
      message:
        "TED could not safely reserve or record this generation. Nothing has been marked complete. Try again shortly.",
      retryable: true,
    },
  });
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw persistenceError();
  }
  return Object.fromEntries(Object.entries(value));
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  if (Object.keys(value).sort().join("|") !== [...expected].sort().join("|")) {
    throw persistenceError();
  }
}

function replayIdentity(value: Record<string, unknown>, params: {
  userId: string;
  requestId: string;
  routeKey: string;
}, requestSha256: string): void {
  if (
    value.user_id !== params.userId || value.request_id !== params.requestId ||
    value.route_key !== params.routeKey ||
    value.request_sha256 !== requestSha256
  ) throw persistenceError();
}

function readExecutionPolicy(
  value: Record<string, unknown>,
): AllowanceExecutionPolicy | undefined {
  if (
    value.execution_policy_version === null &&
    value.execution_policy_sha256 === null
  ) return undefined;
  if (
    value.execution_policy_version !== "legacy-template-policy.1" ||
    typeof value.execution_policy_sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.execution_policy_sha256)
  ) throw persistenceError();
  return {
    version: value.execution_policy_version,
    sha256: value.execution_policy_sha256,
  };
}

function checkedReplay(
  value: unknown,
  routeKey: string,
): DurableAllowanceResult {
  const raw = record(value);
  exactKeys(raw, ["contract_version", "route_key", "transport", "payload"]);
  const parsed = durableResult(raw, routeKey);
  if (
    !parsed || new TextEncoder().encode(JSON.stringify(raw)).length > 8_388_608
  ) throw persistenceError();
  return structuredClone(parsed);
}

function checkedReservation(value: Record<string, unknown>, params: {
  requestId: string;
  routeKey: string;
}): AllowanceReservation {
  if (
    typeof value.reservation_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value.reservation_id,
    ) ||
    typeof value.expires_at !== "string" ||
    (value.expires_at !== "infinity" &&
      !Number.isFinite(Date.parse(value.expires_at)))
  ) throw persistenceError();
  return {
    reservationId: value.reservation_id,
    expiresAt: value.expires_at,
    requestId: params.requestId,
    routeKey: params.routeKey,
    executionPolicy: readExecutionPolicy(value),
  };
}

function policyRpcError(error: unknown): never {
  const message = databaseMessage(error);
  if (message.includes("ALLOWANCE_REQUEST_REPLAY_CONFLICT")) {
    throw new AllowanceReservationError(409, "GENERATION_REQUEST_CONFLICT", {
      error: {
        code: "GENERATION_REQUEST_CONFLICT",
        message: "That request ID is already bound to different input.",
        retryable: false,
      },
    });
  }
  if (
    message.includes("ALLOWANCE_EXECUTION_POLICY_CONFLICT") ||
    message.includes("ALLOWANCE_EXECUTION_POLICY_RECOVERY_REQUIRED")
  ) {
    throw new AllowanceReservationError(
      409,
      "GENERATION_TEMPLATE_RECOVERY_REQUIRED",
      {
        error: {
          code: "GENERATION_TEMPLATE_RECOVERY_REQUIRED",
          message:
            "This earlier generation used a different document contract. Its saved work and usage are preserved. Reload the workspace before starting a new request.",
          retryable: false,
        },
      },
    );
  }
  throw persistenceError();
}

/** Read the existing immutable receipt before applying current template policy.
 * This command cannot reserve allowance or renew a provider execution claim. */
export async function readDocumentAllowanceReplay(
  admin: SupabaseClient,
  params: {
    userId: string;
    requestId: string;
    routeKey: "generate-document";
    body: Record<string, unknown>;
    signal?: AbortSignal;
  },
): Promise<AllowanceReplayRead> {
  params = {
    ...params,
    requestId: requireAllowanceRequestId(params.requestId),
    body: structuredClone(params.body),
  };
  const requestId = params.requestId;
  if (params.routeKey !== "generate-document") throw persistenceError();
  if (params.signal?.aborted) throw params.signal.reason;
  const requestSha256 = await allowanceRequestSha256(
    params.routeKey,
    params.body,
  );
  if (params.signal?.aborted) throw params.signal.reason;
  const query = admin.rpc("read_document_allowance_replay", {
    p_user_id: params.userId,
    p_request_id: requestId,
    p_route_key: params.routeKey,
    p_request_sha256: requestSha256,
  });
  const { data, error } =
    await (params.signal ? query.abortSignal(params.signal) : query);
  if (params.signal?.aborted) throw params.signal.reason;
  if (error) policyRpcError(error);
  const raw = record(data);
  exactKeys(raw, [
    "contract_version",
    "user_id",
    "request_id",
    "route_key",
    "request_sha256",
    "state",
    "reservation_id",
    "reservation_status",
    "expires_at",
    "execution_policy_version",
    "execution_policy_sha256",
    "has_prior_provider_work",
    "reconciliation_required",
    "replay_result",
  ]);
  replayIdentity(raw, params, requestSha256);
  if (
    raw.contract_version !== "allowance-replay.1" ||
    typeof raw.has_prior_provider_work !== "boolean" ||
    typeof raw.reconciliation_required !== "boolean"
  ) throw persistenceError();
  if (raw.state === "absent") {
    if (
      [
        raw.reservation_id,
        raw.reservation_status,
        raw.expires_at,
        raw.execution_policy_version,
        raw.execution_policy_sha256,
        raw.replay_result,
      ].some((value) => value !== null) ||
      raw.has_prior_provider_work || raw.reconciliation_required
    ) throw persistenceError();
    return {
      state: "absent",
      reservation: null,
      hasPriorProviderWork: false,
      reconciliationRequired: false,
    };
  }
  if (raw.state !== "unsettled" && raw.state !== "settled") {
    throw persistenceError();
  }
  const reservation = checkedReservation(raw, params);
  if (raw.state === "settled") {
    if (raw.reservation_status !== "settled" || raw.reconciliation_required) {
      throw persistenceError();
    }
    reservation.replayResult = checkedReplay(
      raw.replay_result,
      params.routeKey,
    );
  } else if (
    !["reserved", "released", "expired"].includes(
      String(raw.reservation_status),
    ) || raw.replay_result !== null
  ) {
    throw persistenceError();
  }
  return {
    state: raw.state,
    reservation,
    hasPriorProviderWork: raw.has_prior_provider_work,
    reconciliationRequired: raw.reconciliation_required,
  };
}

async function reserveWithPolicy(
  admin: SupabaseClient,
  params: Parameters<typeof reserveDocumentAllowance>[1],
  requestSha256: string,
): Promise<AllowanceReservation> {
  const policy = params.executionPolicy;
  if (
    !policy || policy.version !== "legacy-template-policy.1" ||
    !/^[0-9a-f]{64}$/.test(policy.sha256) ||
    (policy.legacySha256 !== undefined &&
      !/^[0-9a-f]{64}$/.test(policy.legacySha256)) ||
    params.routeKey !== "generate-document"
  ) throw persistenceError();
  if (params.signal?.aborted) throw params.signal.reason;
  const query = admin.rpc("reserve_document_allowance_with_policy", {
    p_user_id: params.userId,
    p_request_id: params.requestId,
    p_route_key: params.routeKey,
    p_request_sha256: requestSha256,
    p_plan: params.plan,
    p_monthly_cap: params.monthlyCap,
    p_ttl_seconds: params.ttlSeconds ?? 1800,
    p_execution_policy_version: policy.version,
    p_execution_policy_sha256: policy.sha256,
    p_legacy_execution_policy_sha256: policy.legacySha256 ?? null,
  });
  const { data, error } =
    await (params.signal ? query.abortSignal(params.signal) : query);
  if (params.signal?.aborted) throw params.signal.reason;
  if (error) {
    if (databaseMessage(error).includes("ALLOWANCE_CAP_REACHED")) {
      const payload = PAYWALL_PAYLOAD(params.plan, params.accessProfile);
      throw new AllowanceReservationError(
        402,
        payload.error.code,
        payload,
      );
    }
    policyRpcError(error);
  }
  const raw = record(data);
  exactKeys(raw, [
    "contract_version",
    "user_id",
    "request_id",
    "route_key",
    "request_sha256",
    "reservation_id",
    "expires_at",
    "state",
    "provider_permitted",
    "execution_claim_token",
    "execution_policy_version",
    "execution_policy_sha256",
    "replay_result",
  ]);
  replayIdentity(raw, params, requestSha256);
  if (
    raw.contract_version !== "allowance-policy-reservation.1" ||
    typeof raw.provider_permitted !== "boolean"
  ) throw persistenceError();
  const reservation = checkedReservation(raw, params);
  if (raw.state === "settled") {
    if (raw.provider_permitted || raw.execution_claim_token !== null) {
      throw persistenceError();
    }
    reservation.replayResult = checkedReplay(
      raw.replay_result,
      params.routeKey,
    );
    return reservation;
  }
  if (raw.replay_result !== null) throw persistenceError();
  if (raw.state === "awaiting_reconciliation") {
    if (raw.provider_permitted || raw.execution_claim_token !== null) {
      throw persistenceError();
    }
    throw new AllowanceReservationError(
      409,
      "GENERATION_RECONCILIATION_REQUIRED",
      RECONCILIATION_REQUIRED_PAYLOAD,
    );
  }
  if (
    raw.state !== "reserved" ||
    reservation.executionPolicy?.version !== policy.version ||
    reservation.executionPolicy.sha256 !== policy.sha256
  ) throw persistenceError();
  if (!raw.provider_permitted) {
    if (raw.execution_claim_token !== null) throw persistenceError();
    throw new AllowanceReservationError(409, "GENERATION_REQUEST_IN_PROGRESS", {
      error: {
        code: "GENERATION_REQUEST_IN_PROGRESS",
        message:
          "This generation is already running. Wait for its result before retrying.",
        retryable: true,
      },
    });
  }
  if (
    typeof raw.execution_claim_token !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      raw.execution_claim_token,
    )
  ) throw persistenceError();
  reservation.executionClaimToken = raw.execution_claim_token;
  return reservation;
}

export function isProviderReconciliationRequired(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  return code === "OPENAI_PROVIDER_RECONCILIATION_REQUIRED" ||
    code === "OPENAI_MODEL_CALL_RECONCILIATION_REQUIRED" ||
    code === "OPENAI_PROVIDER_DISPATCH_RECONCILIATION_REQUIRED" ||
    code === "OPENAI_CAPACITY_ADMISSION_RECONCILIATION_REQUIRED" ||
    code === "OPENAI_CAPACITY_RELEASE_RECONCILIATION_REQUIRED" ||
    code === "OLLAMA_PROVIDER_RECONCILIATION_REQUIRED";
}

export async function reserveDocumentAllowance(
  admin: SupabaseClient,
  params: {
    userId: string;
    requestId: string;
    routeKey: string;
    body: Record<string, unknown>;
    plan: Plan;
    monthlyCap: number;
    /** Validated server projection used only for limit messaging, never allowance authority. */
    accessProfile?: "subscription" | "owner";
    ttlSeconds?: number;
    executionPolicy?: AllowanceExecutionPolicy & { legacySha256?: string };
    signal?: AbortSignal;
  },
): Promise<AllowanceReservation> {
  const requestId = requireAllowanceRequestId(params.requestId);
  if (params.executionPolicy) {
    params = {
      ...params,
      requestId,
      body: structuredClone(params.body),
      executionPolicy: { ...params.executionPolicy },
    };
  }
  if (!ROUTE_KEY_PATTERN.test(params.routeKey)) throw persistenceError();

  const requestSha256 = await allowanceRequestSha256(
    params.routeKey,
    params.body,
  );
  if (params.executionPolicy) {
    return await reserveWithPolicy(admin, params, requestSha256);
  }
  const { data, error } = await admin.rpc(
    "reserve_document_allowance_with_result",
    {
      p_user_id: params.userId,
      p_request_id: requestId,
      p_route_key: params.routeKey,
      p_request_sha256: requestSha256,
      p_plan: params.plan,
      p_monthly_cap: params.monthlyCap,
      p_ttl_seconds: params.ttlSeconds ?? 1800,
    },
  );

  if (error) {
    const message = databaseMessage(error);
    if (message.includes("ALLOWANCE_CAP_REACHED")) {
      const payload = PAYWALL_PAYLOAD(params.plan, params.accessProfile);
      throw new AllowanceReservationError(
        402,
        payload.error.code,
        payload,
      );
    }
    if (message.includes("ALLOWANCE_REQUEST_REPLAY_CONFLICT")) {
      throw new AllowanceReservationError(409, "GENERATION_REQUEST_CONFLICT", {
        error: {
          code: "GENERATION_REQUEST_CONFLICT",
          message:
            "That generation request ID is already bound to different input. Start a new generation with a new request ID.",
          retryable: false,
        },
      });
    }
    if (
      message.includes("ALLOWANCE_REQUEST_ID_INVALID") ||
      message.includes("ALLOWANCE_REQUEST_IDENTITY_INVALID")
    ) {
      throw persistenceError();
    }
    throw persistenceError();
  }

  const result = data && typeof data === "object"
    ? data as Record<string, unknown>
    : {};
  const state = String(result.state ?? "");
  if (result.provider_permitted !== true) {
    if (
      state === "awaiting_reconciliation" ||
      result.reconciliation_required === true
    ) {
      throw new AllowanceReservationError(
        409,
        "GENERATION_RECONCILIATION_REQUIRED",
        RECONCILIATION_REQUIRED_PAYLOAD,
      );
    }
    const completed = state === "settled";
    const replayResult = completed
      ? durableResult(result.replay_result, params.routeKey)
      : undefined;
    if (replayResult) {
      const reservationId = String(result.reservation_id ?? "");
      if (!reservationId) throw persistenceError();
      return {
        reservationId,
        requestId,
        routeKey: params.routeKey,
        expiresAt: String(result.expires_at ?? ""),
        replayResult,
      };
    }
    throw new AllowanceReservationError(
      409,
      completed
        ? "GENERATION_REQUEST_COMPLETED"
        : "GENERATION_REQUEST_IN_PROGRESS",
      {
        error: {
          code: completed
            ? "GENERATION_REQUEST_COMPLETED"
            : "GENERATION_REQUEST_IN_PROGRESS",
          message: completed
            ? "This generation request has already been completed and charged. Start a new generation with a new request ID."
            : "This generation request is already reserved or running. Wait for it to finish before retrying.",
          retryable: !completed,
        },
      },
    );
  }

  const reservationId = String(result.reservation_id ?? "");
  const expiresAt = String(result.expires_at ?? "");
  const executionClaimToken = typeof result.execution_claim_token === "string"
    ? result.execution_claim_token
    : undefined;
  if (
    !reservationId || !expiresAt ||
    (["generate-document", "generate-checklist"].includes(params.routeKey) &&
      !executionClaimToken)
  ) throw persistenceError();
  return {
    reservationId,
    requestId,
    routeKey: params.routeKey,
    expiresAt,
    executionClaimToken,
  };
}

export async function holdDocumentAllowanceForReconciliation(
  admin: SupabaseClient,
  params: {
    userId: string;
    reservation: AllowanceReservation;
  },
): Promise<void> {
  const { data, error } = await admin.rpc("release_document_allowance", {
    p_user_id: params.userId,
    p_reservation_id: params.reservation.reservationId,
    p_request_id: params.reservation.requestId,
    p_release_code: "provider_reconciliation_required",
  });
  const result = data && typeof data === "object"
    ? data as Record<string, unknown>
    : {};
  if (error || result.state !== "reserved") throw persistenceError();
}

export async function settleDocumentAllowance(
  admin: SupabaseClient,
  params: {
    userId: string;
    reservation: AllowanceReservation;
    task: string;
    inputTokens?: number;
    outputTokens?: number;
    result: DurableAllowanceResult;
  },
): Promise<void> {
  if (
    params.result.contract_version !== "allowance-result.1" ||
    params.result.route_key !== params.reservation.routeKey
  ) throw persistenceError();
  const { data, error } = await admin.rpc(
    "settle_document_allowance_with_result",
    {
      p_user_id: params.userId,
      p_reservation_id: params.reservation.reservationId,
      p_request_id: params.reservation.requestId,
      p_task: params.task,
      p_provider: "openai",
      p_input_tokens: Math.max(0, Math.trunc(params.inputTokens ?? 0)),
      p_output_tokens: Math.max(0, Math.trunc(params.outputTokens ?? 0)),
      p_response_payload: params.result,
    },
  );
  if (error) throw persistenceError();
  const result = data && typeof data === "object"
    ? data as Record<string, unknown>
    : {};
  if (result.state !== "settled" || !result.usage_ledger_id) {
    throw persistenceError();
  }
}

export async function releaseDocumentAllowance(
  admin: SupabaseClient,
  params: {
    userId: string;
    reservation: AllowanceReservation;
    releaseCode: "provider_failed" | "request_cancelled" | "route_failed";
  },
): Promise<void> {
  const { error } = await admin.rpc("release_document_allowance", {
    p_user_id: params.userId,
    p_reservation_id: params.reservation.reservationId,
    p_request_id: params.reservation.requestId,
    p_release_code: params.releaseCode,
  });
  if (error) {
    // Expiry is the final safety net if a transient release write fails.  Do
    // not surface database details or replace the route's original error.
    console.error("allowance-reservation: release failed");
  }
}
