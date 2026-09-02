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

export function isProviderReconciliationRequired(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  return code === "OPENAI_PROVIDER_RECONCILIATION_REQUIRED" ||
    code === "OPENAI_MODEL_CALL_RECONCILIATION_REQUIRED";
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
    ttlSeconds?: number;
  },
): Promise<AllowanceReservation> {
  const requestId = requireAllowanceRequestId(params.requestId);
  if (!ROUTE_KEY_PATTERN.test(params.routeKey)) throw persistenceError();

  const requestSha256 = await allowanceRequestSha256(
    params.routeKey,
    params.body,
  );
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
      throw new AllowanceReservationError(
        402,
        "PAYWALL",
        PAYWALL_PAYLOAD(params.plan),
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
