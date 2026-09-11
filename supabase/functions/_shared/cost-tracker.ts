// =====================================================
// PrompTED — Cost Tracker
// Logs AI token usage per call for cost monitoring.
// IMPORTANT: Never log prompt content, system prompts,
// or any generated document text in this module.
// =====================================================

// Edge imports retain the repository's existing lockfile-pinned JSR boundary.
// deno-lint-ignore no-import-prefix
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  isOllamaCreditFallbackPolicy,
  type OpenAIRouteSnapshot,
} from "../../../packages/shared/src/document-operation.ts";
import {
  type LegacyAuditSources,
  type LegacyDocumentAuditBinding,
  legacyAuditSourceSha256,
  validateLegacyAuditSources,
  validateLegacyDocumentAuditBinding,
} from "./document-audit-binding.ts";

export interface LegacyAuditAdmission {
  readonly admissionId: string;
  readonly bindingSha256: string;
}

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
  provider?: "openai" | "ollama";
  allowCreditFallback?: boolean;
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
  readonly legacyAuditBinding?: LegacyDocumentAuditBinding;
  readonly legacyAuditSources?: LegacyAuditSources;
  readonly legacyAuditAdmission?: LegacyAuditAdmission;
}

export interface LegacyProviderResultEnvelope {
  version: "legacy-provider-result.1";
  text: string;
  structured: Record<string, unknown> | null;
  sources: Array<{ id: string; title: string; url: string; type: "web" }>;
  route_snapshot: OpenAIRouteSnapshot;
}

export interface LegacyModelCheckpoint {
  fallback_required?: boolean;
  reason?: string;
  error_code?: string;
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
  /** Internal evidence from the audited reader; never part of the old RPC payload. */
  readonly legacyAuditBinding?: LegacyDocumentAuditBinding;
  readonly legacyAuditBindingSha256?: string;
}

/** Identity supplied to the existing owner-scoped checkpoint read. Its command
 * verifies this binding; its result does not echo these fields. */
export interface LegacyCheckpointReceiptIdentity {
  readonly userId: string;
  readonly logicalRequestId: string;
  readonly checkpointScope: string;
  /** Current read/write authority, not the stored result's original reservation.
   * A later reservation may reuse a checkpoint from the same logical request. */
  readonly authorityReservationId: string | null;
  readonly logicalStageKey: string;
  readonly requestSha256: string;
}

interface TerminalModelAttemptReceiptBase {
  readonly version: "terminal-model-attempt-receipt.1";
  readonly userId: string;
  readonly logicalRequestId: string | null;
  readonly checkpointScope: string | null;
  readonly authorityReservationId: string | null;
  readonly logicalStageKey: string;
  readonly requestSha256: string;
  /** Historical response:/client: identities are text, not necessarily UUIDs. */
  readonly providerAttemptId: string;
  readonly attemptNumber: number;
  readonly provider: "openai" | "ollama";
  readonly attemptStatus: TerminalModelAttemptRecord["attemptStatus"];
  readonly providerStatus: string;
  readonly providerResponseId: string;
  readonly errorCode: string | null;
  readonly usageLedgerId: string;
  readonly modelCallKey: string;
}

/** A checkpoint proves retained output identity, not factual correctness or a
 * successful audit. Failed completed responses retain their actual status. */
export type TerminalModelAttemptReceipt = TerminalModelAttemptReceiptBase & (
  | { readonly kind: "usage_only" }
  | (LegacyCheckpointReceiptIdentity & {
    readonly kind: "checkpoint";
    /** Opaque digest computed by Postgres over its stored JSONB envelope. */
    readonly resultResponseSha256: string;
    readonly legacyAuditBindingSha256?: string;
  })
);

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

const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function captureAuditInput(input: {
  logicalStageKey: string;
  legacyAuditBinding?: LegacyDocumentAuditBinding;
  legacyAuditSources?: LegacyAuditSources;
}): { binding: LegacyDocumentAuditBinding; sources: LegacyAuditSources } | undefined {
  if (input.legacyAuditBinding === undefined && input.legacyAuditSources === undefined) return undefined;
  try {
    return {
      binding: validateLegacyDocumentAuditBinding(input.legacyAuditBinding, input.logicalStageKey),
      sources: validateLegacyAuditSources(input.legacyAuditSources),
    };
  } catch {
    throw new ModelCallAccountingError("MODEL_CALL_AUDIT_CHECKPOINT_MALFORMED");
  }
}

function matchingAuditDigest(
  checkpoint: LegacyModelCheckpoint,
  expected: LegacyDocumentAuditBinding,
): string {
  let actual: LegacyDocumentAuditBinding;
  try {
    actual = validateLegacyDocumentAuditBinding(checkpoint.legacyAuditBinding);
  } catch {
    throw new ModelCallAccountingError("MODEL_CALL_AUDIT_CHECKPOINT_MALFORMED");
  }
  if (typeof checkpoint.legacyAuditBindingSha256 !== "string" || !SHA256.test(checkpoint.legacyAuditBindingSha256)) {
    throw new ModelCallAccountingError("MODEL_CALL_AUDIT_CHECKPOINT_MALFORMED");
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new ModelCallAccountingError("MODEL_CALL_AUDIT_CHECKPOINT_CONFLICT");
  }
  return checkpoint.legacyAuditBindingSha256;
}

/** Audit evidence is qualified only after the actual terminal attempt has been
 * acknowledged. Invalid evidence must not suppress accounting for dispatched work. */
async function qualifyAuditReceipt(
  receipt: TerminalModelAttemptReceipt,
  record: TerminalModelAttemptRecord,
): Promise<TerminalModelAttemptReceipt> {
  if (record.legacyAuditBinding === undefined && record.legacyAuditSources === undefined &&
    record.legacyAuditAdmission === undefined) return receipt;
  let audit: ReturnType<typeof captureAuditInput>;
  try {
    audit = captureAuditInput(record);
    if (!audit || await legacyAuditSourceSha256(audit.sources) !== audit.binding.source_sha256) throw new Error();
  } catch {
    throw new ModelCallAccountingError("MODEL_CALL_AUDIT_CHECKPOINT_CONFLICT");
  }
  const admission = record.legacyAuditAdmission;
  if (record.checkpointScope !== "generate-document" || !record.logicalRequestId ||
    typeof record.originReservationId !== "string" || !UUID.test(record.originReservationId) ||
    !object(admission) || Object.keys(admission).sort().join(",") !== "admissionId,bindingSha256" ||
    typeof admission.admissionId !== "string" || !UUID.test(admission.admissionId) ||
    admission.admissionId !== record.providerAttemptId ||
    typeof admission.bindingSha256 !== "string" || !SHA256.test(admission.bindingSha256)) {
    throw new ModelCallAccountingError("MODEL_CALL_AUDIT_CHECKPOINT_CONFLICT");
  }
  if (receipt.kind !== "checkpoint") return receipt;
  if (receipt.legacyAuditBindingSha256 !== undefined && receipt.legacyAuditBindingSha256 !== admission.bindingSha256) {
    throw new ModelCallAccountingError("MODEL_CALL_AUDIT_CHECKPOINT_CONFLICT");
  }
  return Object.freeze({ ...receipt, legacyAuditBindingSha256: admission.bindingSha256 });
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    Array.from(value).length <= maximum;
}

function integer(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function validAttemptFacts(record: TerminalModelAttemptRecord): boolean {
  return object(record) && typeof record.userId === "string" && record.userId.length > 0 &&
    (record.logicalRequestId === undefined || (typeof record.logicalRequestId === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(record.logicalRequestId))) &&
    (record.checkpointScope === undefined || (typeof record.checkpointScope === "string" &&
      /^[a-z0-9][a-z0-9-]{0,79}$/.test(record.checkpointScope))) &&
    (record.originReservationId === undefined || typeof record.originReservationId === "string") &&
    typeof record.logicalStageKey === "string" &&
    /^[a-z0-9][a-z0-9._:-]{0,159}$/.test(record.logicalStageKey) &&
    typeof record.requestSha256 === "string" && SHA256.test(record.requestSha256) &&
    boundedText(record.providerAttemptId, 512) && integer(record.attemptNumber, 1) &&
    ["succeeded", "failed", "cancelled", "unknown"].includes(record.attemptStatus) &&
    boundedText(record.providerStatus, 80) && typeof record.providerResponseId === "string" &&
    (record.attemptStatus === "succeeded"
      ? record.errorCode === null
      : typeof record.errorCode === "string") &&
    integer(record.inputTokens) && integer(record.outputTokens) &&
    typeof record.startedAt === "string" && typeof record.completedAt === "string" &&
    Number.isFinite(Date.parse(record.startedAt)) &&
    Date.parse(record.completedAt) >= Date.parse(record.startedAt) &&
    boundedText(record.model, 160) && boundedText(record.routingVersion, 160) &&
    ["fast", "deep", "research", "review"].includes(record.semanticRoute) &&
    ["low", "medium", "high"].includes(record.reasoningEffort) &&
    (record.provider === undefined || record.provider === "openai" || record.provider === "ollama");
}

function terminalReceipt(
  record: TerminalModelAttemptRecord,
  modelCallKey: string,
  usageLedgerId: string,
  resultResponseSha256?: string,
): TerminalModelAttemptReceipt {
  const common: TerminalModelAttemptReceiptBase = {
    version: "terminal-model-attempt-receipt.1",
    userId: record.userId,
    logicalRequestId: record.logicalRequestId ?? null,
    checkpointScope: record.checkpointScope ?? null,
    authorityReservationId: record.originReservationId ?? null,
    logicalStageKey: record.logicalStageKey,
    requestSha256: record.requestSha256,
    providerAttemptId: record.providerAttemptId,
    attemptNumber: record.attemptNumber,
    provider: record.provider ?? "openai",
    attemptStatus: record.attemptStatus,
    providerStatus: record.providerStatus,
    providerResponseId: record.providerResponseId,
    errorCode: record.errorCode,
    usageLedgerId,
    modelCallKey,
  };
  if (resultResponseSha256 !== undefined) {
    if (!record.logicalRequestId || !record.checkpointScope) {
      throw new ModelCallAccountingError("MODEL_CALL_CHECKPOINT_MALFORMED");
    }
    return Object.freeze({
      ...common,
      logicalRequestId: record.logicalRequestId,
      checkpointScope: record.checkpointScope,
      kind: "checkpoint",
      resultResponseSha256,
    });
  }
  return Object.freeze({ ...common, kind: "usage_only" });
}

function receiptFromAcknowledgement(
  data: unknown,
  record: TerminalModelAttemptRecord,
  modelCallKey: string,
): TerminalModelAttemptReceipt | null {
  if (!object(data) || typeof data.usage_ledger_id !== "string" ||
    !UUID.test(data.usage_ledger_id) || data.model_call_key !== modelCallKey) return null;
  if (record.resultEnvelope) {
    if (typeof data.result_id !== "string" || !UUID.test(data.result_id) ||
      typeof data.result_response_sha256 !== "string" ||
      !SHA256.test(data.result_response_sha256)) return null;
    return terminalReceipt(record, modelCallKey, data.usage_ledger_id, data.result_response_sha256);
  }
  if (data.result_id != null || data.result_response_sha256 != null) return null;
  return terminalReceipt(record, modelCallKey, data.usage_ledger_id);
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
  if (typeof left !== "string") return false;
  const leftMs = Date.parse(left);
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

/** Convert the result of the exact owner-scoped read into the same evidence as
 * a validated write acknowledgement. No provider work or database write occurs
 * here, and the Postgres JSONB digest is retained literally. */
export async function checkpointReceiptFromReplay(
  checkpoint: LegacyModelCheckpoint,
  expectedIdentity: LegacyCheckpointReceiptIdentity,
  expectedAuditBinding?: LegacyDocumentAuditBinding,
): Promise<Extract<TerminalModelAttemptReceipt, { kind: "checkpoint" }>> {
  let saved: LegacyModelCheckpoint;
  let expected: LegacyCheckpointReceiptIdentity;
  let auditBinding: LegacyDocumentAuditBinding | undefined;
  try {
    saved = structuredClone(checkpoint);
    expected = structuredClone(expectedIdentity);
    auditBinding = expectedAuditBinding === undefined ? undefined
      : validateLegacyDocumentAuditBinding(expectedAuditBinding, expected.logicalStageKey);
  } catch {
    throw new ModelCallAccountingError("MODEL_CALL_CHECKPOINT_MALFORMED");
  }
  const fail = () => new ModelCallAccountingError("MODEL_CALL_CHECKPOINT_MALFORMED");
  if (!object(expected) || typeof expected.userId !== "string" || !UUID.test(expected.userId) ||
    typeof expected.logicalRequestId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(expected.logicalRequestId) ||
    typeof expected.checkpointScope !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,79}$/.test(expected.checkpointScope) ||
    (expected.authorityReservationId !== null &&
      (typeof expected.authorityReservationId !== "string" || !UUID.test(expected.authorityReservationId))) ||
    (["generate-document", "generate-checklist"].includes(expected.checkpointScope)
      ? expected.authorityReservationId === null
      : expected.authorityReservationId !== null)) throw fail();
  if (!object(saved) || saved.state !== "replay" || saved.provider_permitted !== false ||
    typeof saved.response_sha256 !== "string" || !SHA256.test(saved.response_sha256) ||
    !integer(saved.attempt_number, 1) || !object(saved.usage) ||
    typeof saved.usage.usage_ledger_id !== "string" || !UUID.test(saved.usage.usage_ledger_id)) throw fail();
  const envelope = saved.response_envelope;
  if (!object(envelope) || envelope.version !== "legacy-provider-result.1" ||
    typeof envelope.text !== "string" ||
    !(envelope.structured === null || object(envelope.structured)) ||
    !Array.isArray(envelope.sources) || !object(envelope.route_snapshot)) throw fail();
  const usage = saved.usage;
  // The original OpenAI-only SQL projection omitted this field while enforcing
  // provider='openai'. Explicit null or another provider is never that history.
  const provider = usage.provider === undefined ? "openai" : usage.provider;
  if ((provider !== "openai" && provider !== "ollama") ||
    usage.provider_status !== "completed" ||
    (usage.attempt_status !== "succeeded" && usage.attempt_status !== "failed")) throw fail();
  // Mirror the existing write command's cross-field binding. A well-typed
  // usage row for a different model/route is not evidence for this envelope.
  const route = envelope.route_snapshot;
  if (route.provider !== "openai" || route.routingVersion !== usage.routing_version ||
    route.semanticRoute !== usage.semantic_route || route.reasoningEffort !== usage.reasoning_effort ||
    !boundedText(route.model, 160)) throw fail();
  if (provider === "ollama") {
    if (!isOllamaCreditFallbackPolicy(route.creditFallback) ||
      route.creditFallback.model !== usage.model || saved.attempt_number !== 2 ||
      route.maxAttempts !== 2 || !Array.isArray(route.allowedTools) ||
      route.allowedTools.length !== 0) throw fail();
  } else if (route.model !== usage.model) throw fail();
  const record: TerminalModelAttemptRecord = {
    userId: expected.userId,
    logicalRequestId: expected.logicalRequestId,
    checkpointScope: expected.checkpointScope,
    originReservationId: expected.authorityReservationId ?? undefined,
    logicalStageKey: expected.logicalStageKey,
    requestSha256: expected.requestSha256,
    provider,
    providerAttemptId: usage.provider_attempt_id as string,
    attemptNumber: saved.attempt_number,
    attemptStatus: usage.attempt_status,
    providerStatus: usage.provider_status,
    providerResponseId: usage.provider_response_id as string,
    errorCode: usage.error_code as string | null,
    inputTokens: usage.input_tokens as number,
    outputTokens: usage.output_tokens as number,
    startedAt: usage.started_at as string,
    completedAt: usage.completed_at as string,
    model: usage.model as string,
    routingVersion: usage.routing_version as string,
    semanticRoute: usage.semantic_route as TerminalModelAttemptRecord["semanticRoute"],
    reasoningEffort: usage.reasoning_effort as TerminalModelAttemptRecord["reasoningEffort"],
  };
  if (!validAttemptFacts(record)) throw fail();
  const auditDigest = auditBinding ? matchingAuditDigest(saved, auditBinding) : undefined;
  const modelCallKey = await sha256(
    `${record.logicalStageKey}|${record.requestSha256}|${record.providerAttemptId}`,
  );
  const receipt = terminalReceipt(record, modelCallKey, usage.usage_ledger_id as string, saved.response_sha256);
  if (receipt.kind !== "checkpoint") throw fail();
  return auditDigest === undefined ? receipt
    : Object.freeze({ ...receipt, legacyAuditBindingSha256: auditDigest });
}

async function verifyTerminalModelAttempt(
  admin: SupabaseClient,
  record: TerminalModelAttemptRecord,
  modelCallKey: string,
): Promise<TerminalModelAttemptReceipt | null> {
  if (
    record.checkpointScope && record.executionClaimToken &&
    record.logicalRequestId &&
    record.resultEnvelope
  ) {
    try {
      const checkpoint = structuredClone(await readLegacyModelCheckpoint(admin, {
        userId: record.userId,
        checkpointScope: record.checkpointScope,
        originReservationId: record.originReservationId,
        executionClaimToken: record.executionClaimToken,
        logicalRequestId: record.logicalRequestId,
        logicalStageKey: record.logicalStageKey,
        requestSha256: record.requestSha256,
        maxAttempts: 2,
        allocateAttempt: false,
        allowCreditFallback: record.allowCreditFallback ||
          record.provider === "ollama",
        ...(record.legacyAuditBinding === undefined && record.legacyAuditSources === undefined ? {} : {
          legacyAuditBinding: record.legacyAuditBinding,
          legacyAuditSources: record.legacyAuditSources,
        }),
      }));
      const usage = checkpoint.usage ?? {};
      const receipt = await checkpointReceiptFromReplay(checkpoint, {
        userId: record.userId,
        logicalRequestId: record.logicalRequestId,
        checkpointScope: record.checkpointScope,
        authorityReservationId: record.originReservationId ?? null,
        logicalStageKey: record.logicalStageKey,
        requestSha256: record.requestSha256,
      }, record.legacyAuditBinding);
      const matches = receipt.modelCallKey === modelCallKey &&
        receipt.provider === (record.provider ?? "openai") &&
        JSON.stringify(canonicalJson(checkpoint.response_envelope)) ===
          JSON.stringify(canonicalJson(record.resultEnvelope)) &&
        usage.provider_attempt_id === record.providerAttemptId &&
        usage.provider_response_id === record.providerResponseId &&
        usage.provider_status === record.providerStatus &&
        usage.attempt_status === record.attemptStatus &&
        usage.error_code === record.errorCode &&
        usage.input_tokens === record.inputTokens &&
        usage.output_tokens === record.outputTokens &&
        checkpoint.attempt_number === record.attemptNumber &&
        sameTimestamp(usage.started_at, record.startedAt) &&
        sameTimestamp(usage.completed_at, record.completedAt) &&
        usage.model === record.model &&
        usage.routing_version === record.routingVersion &&
        usage.semantic_route === record.semanticRoute &&
        usage.reasoning_effort === record.reasoningEffort;
      return matches ? await qualifyAuditReceipt(receipt, record) : null;
    } catch {
      return null;
    }
  }
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
    if (error || !object(data)) return null;
    const row = data as Record<string, unknown>;
    const matches = typeof row.id === "string" && UUID.test(row.id) &&
      row.event_type === "model_call" &&
      row.generation_request_id === `legacy-model-call:${modelCallKey}` &&
      row.task === record.logicalStageKey &&
      row.provider === (record.provider ?? "openai") &&
      row.input_tokens === record.inputTokens &&
      row.output_tokens === record.outputTokens &&
      row.model_call_key === modelCallKey &&
      (row.logical_request_id ?? null) === (record.logicalRequestId ?? null) &&
      (row.checkpoint_scope ?? null) === (record.checkpointScope ?? null) &&
      row.logical_stage_key === record.logicalStageKey &&
      row.provider_request_sha256 === record.requestSha256 &&
      row.provider_attempt_id === record.providerAttemptId &&
      (row.provider_response_id === null ? "" : row.provider_response_id) === record.providerResponseId &&
      row.provider_status === record.providerStatus &&
      row.provider_error_code === record.errorCode &&
      row.model_call_status === record.attemptStatus &&
      row.provider_attempt_number === record.attemptNumber &&
      sameTimestamp(row.provider_started_at, record.startedAt) &&
      sameTimestamp(row.provider_completed_at, record.completedAt) &&
      row.model === record.model &&
      row.routing_version === record.routingVersion &&
      row.semantic_route === record.semanticRoute &&
      row.reasoning_effort === record.reasoningEffort;
    return matches ? terminalReceipt(record, modelCallKey, row.id as string) : null;
  } catch {
    return null;
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
    allowCreditFallback?: boolean;
    legacyAuditBinding?: LegacyDocumentAuditBinding;
    legacyAuditSources?: LegacyAuditSources;
  },
): Promise<LegacyModelCheckpoint> {
  // Scalar authority and nested audit input must remain one snapshot while the
  // source commitment is hashed and the database response is pending.
  input = { ...input };
  const audit = captureAuditInput(input);
  if (audit && await legacyAuditSourceSha256(audit.sources) !== audit.binding.source_sha256) {
    throw new ModelCallAccountingError("MODEL_CALL_AUDIT_CHECKPOINT_CONFLICT");
  }
  const { data, error } = await admin.rpc(
    audit ? "read_legacy_document_audit_checkpoint_v1" : input.allowCreditFallback
      ? "read_legacy_model_call_checkpoint_with_fallback"
      : "read_legacy_model_call_checkpoint",
    {
      p_user_id: input.userId,
      p_checkpoint_scope: input.checkpointScope,
      p_origin_reservation_id: input.originReservationId ?? null,
      p_logical_request_id: input.logicalRequestId,
      p_logical_stage_key: input.logicalStageKey,
      p_request_sha256: input.requestSha256,
      p_max_attempts: input.maxAttempts,
      p_execution_claim_token: input.executionClaimToken ?? null,
      p_allocate_attempt: input.allocateAttempt,
      ...(audit ? {
        p_audit_binding: audit.binding,
        p_with_fallback: input.allowCreditFallback === true,
        p_source_snapshot: audit.sources,
      } : {}),
    },
  );
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    const detail = message(error);
    const code = detail.includes("LEGACY_DOCUMENT_AUDIT_BINDING_CONFLICT") ||
        detail.includes("LEGACY_DOCUMENT_AUDIT_SOURCE_CONFLICT")
      ? "MODEL_CALL_AUDIT_CHECKPOINT_CONFLICT"
      : detail.includes("LEGACY_DOCUMENT_AUDIT_")
      ? "MODEL_CALL_AUDIT_CHECKPOINT_MALFORMED"
      : detail.includes("LEGACY_MODEL_CHECKPOINT_REQUEST_CONFLICT")
      ? "MODEL_CALL_CHECKPOINT_REQUEST_CONFLICT"
      : detail.includes("LEGACY_MODEL_CHECKPOINT_MALFORMED")
      ? "MODEL_CALL_CHECKPOINT_MALFORMED"
      : "MODEL_CALL_CHECKPOINT_READ_FAILED";
    throw new ModelCallAccountingError(code);
  }
  if (audit) {
    let wrapper: Record<string, unknown>;
    try { wrapper = structuredClone(data) as Record<string, unknown>; } catch {
      throw new ModelCallAccountingError("MODEL_CALL_AUDIT_CHECKPOINT_MALFORMED");
    }
    const malformed = () => new ModelCallAccountingError("MODEL_CALL_AUDIT_CHECKPOINT_MALFORMED");
    if (Object.keys(wrapper).sort().join(",") !== "audit_binding,audit_binding_sha256,checkpoint,contract_version" ||
      wrapper.contract_version !== "legacy-document-audit-checkpoint.1" || !object(wrapper.checkpoint)) throw malformed();
    const checkpoint = wrapper.checkpoint;
    if (typeof checkpoint.provider_permitted !== "boolean" || ![
      "prepared", "replay", "not_found", "attempt_limit", "attempt_unresolved", "in_progress",
      "terminal_error", "terminal_cancelled", "completed_result_unavailable", "awaiting_reconciliation",
    ].includes(String(checkpoint.state)) ||
      (checkpoint.state === "prepared" ? !checkpoint.provider_permitted : checkpoint.provider_permitted)) throw malformed();
    if (wrapper.audit_binding === null && wrapper.audit_binding_sha256 === null) {
      // A read-only probe may discover an undispatched historical preparation.
      // Only the allocating wrapper may bind it before dispatch.
      if (checkpoint.state === "replay" || (checkpoint.state === "prepared" && input.allocateAttempt)) throw malformed();
      return checkpoint as unknown as LegacyModelCheckpoint;
    }
    if (checkpoint.state === "not_found") throw malformed();
    let stored: LegacyDocumentAuditBinding;
    try { stored = validateLegacyDocumentAuditBinding(wrapper.audit_binding, input.logicalStageKey); } catch { throw malformed(); }
    const bound = {
      ...checkpoint, legacyAuditBinding: stored,
      legacyAuditBindingSha256: wrapper.audit_binding_sha256,
    } as unknown as LegacyModelCheckpoint;
    matchingAuditDigest(bound, audit.binding);
    return bound;
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
  input: TerminalModelAttemptRecord,
): Promise<TerminalModelAttemptReceipt> {
  // The caller may continue working while acknowledgements are pending. Every
  // retry, verification read and returned identity must use this one snapshot.
  let record: TerminalModelAttemptRecord;
  try {
    record = structuredClone(input);
  } catch {
    throw new ModelCallAccountingError("MODEL_CALL_ATTEMPT_PERSISTENCE_FAILED");
  }
  if (!validAttemptFacts(record)) {
    throw new ModelCallAccountingError("MODEL_CALL_ATTEMPT_PERSISTENCE_FAILED");
  }
  const modelCallKey = await sha256(
    `${record.logicalStageKey}|${record.requestSha256}|${record.providerAttemptId}`,
  );
  const args = rpcArguments(record);
  const fallbackContract = record.allowCreditFallback ||
    record.provider === "ollama";
  let ambiguityCount = 0;
  for (let rpcAttempt = 1; rpcAttempt <= 2; rpcAttempt += 1) {
    let receipt: RpcReceipt;
    try {
      receipt = await admin.rpc(
        fallbackContract
          ? "record_legacy_model_call_attempt_with_provider"
          : "record_legacy_model_call_attempt",
        fallbackContract
          ? { ...args, p_provider: record.provider ?? "openai" }
          : args,
      );
    } catch (error) {
      receipt = { data: null, error };
    }
    if (!receipt.error) {
      const accepted = receiptFromAcknowledgement(receipt.data, record, modelCallKey);
      if (accepted) return await qualifyAuditReceipt(accepted, record);
    }
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
  if (ambiguityCount === 2) {
    const verified = await verifyTerminalModelAttempt(admin, record, modelCallKey);
    if (verified) return verified;
  }
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
