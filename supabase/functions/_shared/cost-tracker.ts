// =====================================================
// PrompTED — Cost Tracker
// Logs AI token usage per call for cost monitoring.
// IMPORTANT: Never log prompt content, system prompts,
// or any generated document text in this module.
// =====================================================

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { OpenAIRouteSnapshot } from "../../../packages/shared/src/document-operation.ts";

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
}

export interface UsageRecord {
  userId: string;
  businessId?: string;
  task: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  /** Client-generated ID reused across retries of the same intended
   * generation. When present, the credit charge is idempotent: the
   * usage_ledger row is inserted with ON CONFLICT DO NOTHING against a
   * unique index on (user_id, generation_request_id, event_type). */
  generationRequestId?: string;
}

export interface ModelCallRecord extends UsageRecord {
  /** Deterministic identifier for one logical model call within a request. */
  callKey: string;
}

export interface TerminalModelAttemptRecord {
  userId: string;
  logicalRequestId?: string;
  logicalStageKey: string;
  requestSha256: string;
  providerAttemptId: string;
  attemptNumber: number;
  attemptStatus: "succeeded" | "failed" | "cancelled" | "unknown";
  providerResponseId: string;
  providerStatus: string;
  errorCode: string | null;
  inputTokens: number;
  outputTokens: number;
  startedAt: string;
  completedAt: string;
  model: string;
  routingVersion: string;
  semanticRoute: "fast" | "deep" | "research" | "review";
  reasoningEffort: "low" | "medium" | "high";
  checkpointScope?: string;
  originReservationId?: string;
  executionClaimToken?: string;
  resultEnvelope?: LegacyProviderResultEnvelope;
}

export interface LegacyProviderResultEnvelope {
  version: "legacy-provider-result.1";
  text: string;
  structured: Record<string, unknown> | null;
  sources: Array<{ id: string; title: string; url: string; type: "web" }>;
  route_snapshot: OpenAIRouteSnapshot;
}

export interface LegacyModelCheckpoint {
  state:
    | "prepared"
    | "replay"
    | "not_found"
    | "attempt_limit"
    | "attempt_unresolved"
    | "in_progress"
    | "terminal_error"
    | "terminal_cancelled"
    | "completed_result_unavailable"
    | "awaiting_reconciliation";
  provider_permitted: boolean;
  attempt_number?: number;
  attempt_admission_id?: string;
  execution_claim_token?: string;
  next_attempt_number?: number;
  response_sha256?: string;
  response_envelope?: LegacyProviderResultEnvelope;
  usage?: Record<string, unknown>;
}

export class ModelCallAccountingError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ModelCallAccountingError";
  }
}

type RpcReceipt = { data: unknown; error: unknown };

function rpcArguments(record: TerminalModelAttemptRecord) {
  return {
    p_user_id: record.userId,
    p_logical_request_id: record.logicalRequestId ?? null,
    p_logical_stage_key: record.logicalStageKey,
    p_request_sha256: record.requestSha256,
    p_provider_attempt_id: record.providerAttemptId,
    p_attempt_number: record.attemptNumber,
    p_attempt_status: record.attemptStatus,
    p_provider_response_id: record.providerResponseId,
    p_provider_status: record.providerStatus,
    p_error_code: record.errorCode,
    p_input_tokens: record.inputTokens,
    p_output_tokens: record.outputTokens,
    p_started_at: record.startedAt,
    p_completed_at: record.completedAt,
    p_model: record.model,
    p_routing_version: record.routingVersion,
    p_semantic_route: record.semanticRoute,
    p_reasoning_effort: record.reasoningEffort,
    p_checkpoint_scope: record.checkpointScope ?? null,
    p_origin_reservation_id: record.originReservationId ?? null,
    p_result_envelope: record.resultEnvelope ?? null,
    p_execution_claim_token: record.executionClaimToken ?? null,
  };
}

function validReceipt(
  data: unknown,
  record: TerminalModelAttemptRecord,
): boolean {
  const row = data as Record<string, unknown> | null;
  return Boolean(
    row && typeof row === "object" &&
      String(row.usage_ledger_id ?? "") &&
      /^[0-9a-f]{64}$/.test(
        String(row.model_call_key ?? ""),
      ) &&
      (!record.resultEnvelope ||
        (String(row.result_id ?? "") &&
          /^[0-9a-f]{64}$/.test(String(row.result_response_sha256 ?? "")))),
  );
}

function message(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return error instanceof Error ? error.message : String(error ?? "");
}

function isAcknowledgementAmbiguity(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  if (
    code.startsWith("08") ||
    ["PGRST000", "PGRST001", "PGRST002", "PGRST003", "57014", "57P01"]
      .includes(code)
  ) return true;
  return /fetch|network|connection|socket|transport|timeout|timed out|response.*lost|acknowledg/i
    .test(message(error));
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

function sameTimestamp(left: unknown, right: string): boolean {
  const leftMs = Date.parse(String(left ?? ""));
  const rightMs = Date.parse(right);
  return Number.isFinite(leftMs) && leftMs === rightMs;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalJson(item)]),
    );
  }
  return value;
}

async function verifyTerminalModelAttempt(
  admin: SupabaseClient,
  record: TerminalModelAttemptRecord,
): Promise<boolean> {
  if (
    record.checkpointScope && record.executionClaimToken &&
    record.logicalRequestId &&
    record.resultEnvelope
  ) {
    try {
      const checkpoint = await readLegacyModelCheckpoint(admin, {
        userId: record.userId,
        checkpointScope: record.checkpointScope,
        originReservationId: record.originReservationId,
        executionClaimToken: record.executionClaimToken,
        logicalRequestId: record.logicalRequestId,
        logicalStageKey: record.logicalStageKey,
        requestSha256: record.requestSha256,
        maxAttempts: 2,
        allocateAttempt: false,
      });
      const usage = checkpoint.usage ?? {};
      return checkpoint.state === "replay" &&
        JSON.stringify(canonicalJson(checkpoint.response_envelope)) ===
          JSON.stringify(canonicalJson(record.resultEnvelope)) &&
        usage.provider_attempt_id === record.providerAttemptId &&
        (usage.provider_response_id ?? "") === record.providerResponseId &&
        usage.provider_status === record.providerStatus &&
        usage.attempt_status === record.attemptStatus &&
        (usage.error_code ?? null) === record.errorCode &&
        Number(usage.input_tokens) === record.inputTokens &&
        Number(usage.output_tokens) === record.outputTokens &&
        Number(checkpoint.attempt_number) === record.attemptNumber &&
        sameTimestamp(usage.started_at, record.startedAt) &&
        sameTimestamp(usage.completed_at, record.completedAt) &&
        usage.model === record.model &&
        usage.routing_version === record.routingVersion &&
        usage.semantic_route === record.semanticRoute &&
        usage.reasoning_effort === record.reasoningEffort;
    } catch {
      return false;
    }
  }
  const modelCallKey = await sha256(
    `${record.logicalStageKey}|${record.requestSha256}|${record.providerAttemptId}`,
  );
  try {
    const { data, error } = await admin
      .from("usage_ledger")
      .select(
        "id,event_type,generation_request_id,task,provider,input_tokens,output_tokens,model_call_key,logical_request_id,checkpoint_scope,logical_stage_key,provider_request_sha256,provider_attempt_id,provider_response_id,provider_status,provider_error_code,model_call_status,provider_attempt_number,provider_started_at,provider_completed_at,model,routing_version,semantic_route,reasoning_effort",
      )
      .eq("user_id", record.userId)
      .eq("model_call_key", modelCallKey)
      .limit(1)
      .maybeSingle();
    if (error || !data || typeof data !== "object") return false;
    const row = data as Record<string, unknown>;
    return Boolean(String(row.id ?? "")) &&
      row.event_type === "model_call" &&
      row.generation_request_id === `legacy-model-call:${modelCallKey}` &&
      row.task === record.logicalStageKey &&
      row.provider === "openai" &&
      Number(row.input_tokens) === record.inputTokens &&
      Number(row.output_tokens) === record.outputTokens &&
      row.model_call_key === modelCallKey &&
      (row.logical_request_id ?? null) === (record.logicalRequestId ?? null) &&
      (row.checkpoint_scope ?? null) === (record.checkpointScope ?? null) &&
      row.logical_stage_key === record.logicalStageKey &&
      row.provider_request_sha256 === record.requestSha256 &&
      row.provider_attempt_id === record.providerAttemptId &&
      (row.provider_response_id ?? "") === record.providerResponseId &&
      row.provider_status === record.providerStatus &&
      (row.provider_error_code ?? null) === record.errorCode &&
      row.model_call_status === record.attemptStatus &&
      Number(row.provider_attempt_number) === record.attemptNumber &&
      sameTimestamp(row.provider_started_at, record.startedAt) &&
      sameTimestamp(row.provider_completed_at, record.completedAt) &&
      row.model === record.model &&
      row.routing_version === record.routingVersion &&
      row.semantic_route === record.semanticRoute &&
      row.reasoning_effort === record.reasoningEffort;
  } catch {
    return false;
  }
}

export async function readLegacyModelCheckpoint(
  admin: SupabaseClient,
  input: {
    userId: string;
    checkpointScope: string;
    originReservationId?: string;
    executionClaimToken?: string;
    logicalRequestId: string;
    logicalStageKey: string;
    requestSha256: string;
    maxAttempts: number;
    allocateAttempt: boolean;
  },
): Promise<LegacyModelCheckpoint> {
  const { data, error } = await admin.rpc("read_legacy_model_call_checkpoint", {
    p_user_id: input.userId,
    p_checkpoint_scope: input.checkpointScope,
    p_origin_reservation_id: input.originReservationId ?? null,
    p_logical_request_id: input.logicalRequestId,
    p_logical_stage_key: input.logicalStageKey,
    p_request_sha256: input.requestSha256,
    p_max_attempts: input.maxAttempts,
    p_execution_claim_token: input.executionClaimToken ?? null,
    p_allocate_attempt: input.allocateAttempt,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    const detail = message(error);
    const code = detail.includes("LEGACY_MODEL_CHECKPOINT_REQUEST_CONFLICT")
      ? "MODEL_CALL_CHECKPOINT_REQUEST_CONFLICT"
      : detail.includes("LEGACY_MODEL_CHECKPOINT_MALFORMED")
      ? "MODEL_CALL_CHECKPOINT_MALFORMED"
      : "MODEL_CALL_CHECKPOINT_READ_FAILED";
    throw new ModelCallAccountingError(code);
  }
  return data as unknown as LegacyModelCheckpoint;
}

/**
 * Persist one known terminal non-captured provider attempt. Unlike historical
 * best-effort cost logging, this command deliberately throws on any persistence
 * defect so a successful provider result cannot escape without its accounting
 * record. The service-only RPC owns immutable replay validation.
 */
export async function trackTerminalModelAttempt(
  admin: SupabaseClient,
  record: TerminalModelAttemptRecord,
): Promise<void> {
  const args = rpcArguments(record);
  let ambiguityCount = 0;
  for (let rpcAttempt = 1; rpcAttempt <= 2; rpcAttempt += 1) {
    let receipt: RpcReceipt;
    try {
      receipt = await admin.rpc("record_legacy_model_call_attempt", args);
    } catch (error) {
      receipt = { data: null, error };
    }
    if (!receipt.error && validReceipt(receipt.data, record)) return;
    if (receipt.error && !isAcknowledgementAmbiguity(receipt.error)) {
      throw new ModelCallAccountingError(
        "MODEL_CALL_ATTEMPT_PERSISTENCE_FAILED",
      );
    }
    ambiguityCount += 1;
  }

  // Both write acknowledgements were ambiguous. A bounded, service-owned read
  // may accept the provider output only when every immutable model-call fact is
  // already present. No third write or provider redispatch is attempted.
  if (
    ambiguityCount === 2 &&
    await verifyTerminalModelAttempt(admin, record)
  ) return;
  throw new ModelCallAccountingError("MODEL_CALL_ATTEMPT_ACK_UNRESOLVED");
}

/**
 * Insert a usage_ledger row for a document_created event and log token usage
 * for cost monitoring. Fire-and-forget — must never block the response.
 */
export async function trackDocumentCreated(
  admin: SupabaseClient,
  record: UsageRecord,
): Promise<boolean> {
  try {
    const row = {
      user_id: record.userId,
      business_id: record.businessId ?? null,
      event_type: "document_created",
      created_at: new Date().toISOString(),
    };

    if (record.generationRequestId) {
      // Atomic, idempotent charge: one INSERT ... ON CONFLICT DO NOTHING.
      // A retry with the same generationRequestId inserts no second row.
      const { data, error } = await admin
        .from("usage_ledger")
        .upsert(
          { ...row, generation_request_id: record.generationRequestId },
          {
            onConflict: "user_id,generation_request_id,event_type",
            ignoreDuplicates: true,
          },
        )
        .select("user_id");
      if (error) throw error;
      const charged = (data?.length ?? 0) > 0;
      if (charged) logTokenUsage(record);
      return charged;
    }

    const { error } = await admin.from("usage_ledger").insert(row);
    if (error) throw error;
    logTokenUsage(record);
    return true;
  } catch (err) {
    // Cost tracking must never break a generation request.
    // Log only the error type — never log any content.
    const message = err instanceof Error
      ? err.message
      : (err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err));
    console.error(`cost-tracker: insert failed: ${message}`);
    return false;
  }
}

/**
 * Insert a usage_ledger row for an ai_edit event and log token usage.
 */
export async function trackAiEdit(
  admin: SupabaseClient,
  record: UsageRecord,
): Promise<void> {
  try {
    await admin.from("usage_ledger").insert({
      user_id: record.userId,
      business_id: record.businessId ?? null,
      event_type: "ai_edit",
      created_at: new Date().toISOString(),
    });
    logTokenUsage(record);
  } catch (err) {
    const message = err instanceof Error
      ? err.message
      : (err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err));
    console.error(`cost-tracker: ai_edit insert failed: ${message}`);
  }
}

/**
 * Record one successful model call without consuming a document allowance.
 * Failed/cancelled calls never invoke this function. When a generation request
 * id is present, append the deterministic call key and reuse the ledger's
 * existing request-id uniqueness contract.
 */
export async function trackModelCall(
  admin: SupabaseClient,
  record: ModelCallRecord,
): Promise<boolean> {
  try {
    const generationRequestId = record.generationRequestId
      ? `${record.generationRequestId}:${record.callKey}`
      : undefined;
    const row = {
      user_id: record.userId,
      business_id: record.businessId ?? null,
      event_type: "model_call",
      generation_request_id: generationRequestId ?? null,
      task: record.task,
      provider: record.provider,
      input_tokens: record.inputTokens,
      output_tokens: record.outputTokens,
      created_at: new Date().toISOString(),
    };

    if (generationRequestId) {
      const { data, error } = await admin
        .from("usage_ledger")
        .upsert(row, {
          onConflict: "user_id,generation_request_id,event_type",
          ignoreDuplicates: true,
        })
        .select("user_id");
      if (error) throw error;
      const recorded = (data?.length ?? 0) > 0;
      if (recorded) logTokenUsage(record);
      return recorded;
    }

    const { error } = await admin.from("usage_ledger").insert(row);
    if (error) throw error;
    logTokenUsage(record);
    return true;
  } catch (err) {
    const message = err instanceof Error
      ? err.message
      : (err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err));
    console.error(`cost-tracker: model_call insert failed: ${message}`);
    return false;
  }
}

/**
 * Log token counts as structured JSON so Supabase log aggregation and
 * external cost-monitoring tools can parse them. Never logs content.
 */
function logTokenUsage(record: UsageRecord): void {
  console.log(
    JSON.stringify({
      event: "token_usage",
      task: record.task,
      provider: record.provider,
      input_tokens: record.inputTokens,
      output_tokens: record.outputTokens,
      total_tokens: record.inputTokens + record.outputTokens,
      ts: new Date().toISOString(),
    }),
  );
}
