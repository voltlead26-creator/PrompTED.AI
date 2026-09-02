import type {
  ConversationMessage,
  Outcome,
  OutcomeStatus,
  RecommendationPayload,
} from "@prompted/shared/browser";
import type { OwnerDispatchLease } from "@/lib/browser-principal-state";
import { withOwnerSupabase } from "@/lib/supabase/owner-client";

export interface UpsertOutcomeInput {
  id: string;
  /** @deprecated Ownership is derived from the authenticated session. */
  user_id: string;
  situation_text: string;
  recommendation_payload?: RecommendationPayload | null;
  status?: OutcomeStatus;
}

export interface AttachedOutcomeUpload {
  outcomeId: string;
  situation: string;
  templateId: string | null;
  templateName: string;
  conversationContext: string;
  uploadContext: string;
  uploadId: string;
  updatedAt: string;
}

export interface SaveOutcomeConversationInput {
  outcomeId: string;
  expectedConversationRevision: number;
  requestId: string;
  conversation: ConversationMessage[];
}

interface OutcomeConversationSaveReceiptBase {
  requestId: string;
  outcomeId: string;
  userId: string;
  acceptedConversationRevision: number;
  conversationRevision: number;
  conversationSha256: string;
  updatedAt: string;
  idempotentReplay: boolean;
}

export interface OutcomeConversationSaveSuccess
  extends OutcomeConversationSaveReceiptBase {
  state: "committed" | "unchanged";
}

export interface OutcomeConversationSaveSuperseded
  extends OutcomeConversationSaveReceiptBase {
  state: "superseded";
  committedConversationRevision: number;
  idempotentReplay: true;
  retryable: false;
  safeNextAction: "reload";
}

export type OutcomeConversationSaveReceipt =
  | OutcomeConversationSaveSuccess
  | OutcomeConversationSaveSuperseded;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_CONVERSATION_WIRE_BYTES = 240_000;

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

export function isSaveOutcomeConversationInput(
  candidate: unknown,
): candidate is SaveOutcomeConversationInput {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return false;
  }
  const input = candidate as Record<string, unknown>;
  if (
    !hasOnlyKeys(input, [
      "outcomeId",
      "expectedConversationRevision",
      "requestId",
      "conversation",
    ]) ||
    typeof input.outcomeId !== "string" ||
    !input.outcomeId.trim() ||
    !Number.isSafeInteger(input.expectedConversationRevision) ||
    (input.expectedConversationRevision as number) < 0 ||
    typeof input.requestId !== "string" ||
    !REQUEST_ID_PATTERN.test(input.requestId) ||
    !Array.isArray(input.conversation) ||
    input.conversation.length < 1 ||
    input.conversation.length > 256
  ) {
    return false;
  }

  let contextCharacters = 0;
  for (const candidateMessage of input.conversation) {
    if (
      !candidateMessage ||
      typeof candidateMessage !== "object" ||
      Array.isArray(candidateMessage)
    ) {
      return false;
    }
    const message = candidateMessage as Record<string, unknown>;
    if (
      !hasOnlyKeys(message, ["role", "text"]) ||
      (message.role !== "user" && message.role !== "ted") ||
      typeof message.text !== "string" ||
      !message.text.trim() ||
      message.text.length > 20_000
    ) {
      return false;
    }
    contextCharacters += message.text.length + (message.role === "ted" ? 5 : 6) + 1;
    if (contextCharacters > MAX_CONVERSATION_WIRE_BYTES) return false;
  }

  try {
    return (
      new TextEncoder().encode(JSON.stringify(input.conversation)).byteLength <=
      MAX_CONVERSATION_WIRE_BYTES
    );
  } catch {
    return false;
  }
}

function invalidConversationReceipt(): never {
  throw new Error("OUTCOME_CONVERSATION_RECEIPT_INVALID");
}

/**
 * Create or update the outcome (session) row.
 *
 * This is the parent record the Library "Recents" reads from, and where the
 * chat thread is stored so it can be reopened via "Back to conversation". Safe
 * to call repeatedly (upsert on id). The authenticated RPC derives ownership
 * from the session; the legacy user_id input is retained only for call-site
 * compatibility and is never sent to the database.
 */
export async function upsertOutcome(
  input: UpsertOutcomeInput,
  lease: OwnerDispatchLease,
): Promise<void> {
  if (input.user_id.trim().toLowerCase() !== lease.expectedUserId) {
    throw new Error("OUTCOME_OWNER_CONTEXT_MISMATCH");
  }
  const uploadId = input.recommendation_payload?.upload_id?.trim();
  const { error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase.rpc(
      uploadId ? "upsert_own_outcome_with_upload" : "upsert_own_outcome",
      {
        p_id: input.id,
        p_situation_text: input.situation_text,
        p_recommendation_payload: input.recommendation_payload ?? null,
        p_status: input.status ?? "in_progress",
        ...(uploadId ? { p_upload_id: uploadId } : {}),
      },
    ),
  );
  if (error) throw error;
}

/**
 * Atomically replaces the one active pre-generation source for an outcome.
 * Returned intake is server-derived from the locked outcome and retained
 * upload, so the same page never needs a stale read/merge/write round trip.
 */
export async function attachOutcomeUpload(
  outcomeId: string,
  uploadId: string,
  lease: OwnerDispatchLease,
): Promise<AttachedOutcomeUpload> {
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase.rpc("attach_own_upload_to_outcome", {
      p_outcome_id: outcomeId,
      p_upload_id: uploadId,
    }),
  );
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    throw error ?? new Error("OUTCOME_UPLOAD_BINDING_UNCONFIRMED");
  }
  const value = data as Record<string, unknown>;
  if (
    value.outcome_id !== outcomeId ||
    value.upload_id !== uploadId ||
    typeof value.situation !== "string" ||
    (value.template_id !== null && typeof value.template_id !== "string") ||
    typeof value.template_name !== "string" ||
    typeof value.conversation_context !== "string" ||
    typeof value.upload_context !== "string" ||
    typeof value.updated_at !== "string"
  ) {
    throw new Error("OUTCOME_UPLOAD_BINDING_INVALID");
  }
  return {
    outcomeId,
    situation: value.situation,
    templateId: value.template_id as string | null,
    templateName: value.template_name,
    conversationContext: value.conversation_context,
    uploadContext: value.upload_context,
    uploadId,
    updatedAt: value.updated_at,
  };
}

/** Patch fields on an existing outcome (e.g. mark completed, save the thread). */
export async function updateOutcome(
  id: string,
  patch: {
    status?: OutcomeStatus;
    is_saved?: boolean;
  },
  lease: OwnerDispatchLease,
): Promise<void> {
  const { error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase.rpc("update_own_outcome", {
      p_outcome_id: id,
      p_patch: patch,
    }),
  );
  if (error) throw error;
}

/**
 * Persist only the conversation-owned outcome fields with optimistic
 * concurrency and an immutable idempotency receipt. Template choice, upload
 * provenance, alternatives and workflow state remain server-owned.
 */
export async function saveOutcomeConversation(
  input: SaveOutcomeConversationInput,
  lease: OwnerDispatchLease,
): Promise<OutcomeConversationSaveReceipt> {
  lease.assertCurrent();
  if (!isSaveOutcomeConversationInput(input)) {
    throw new Error("OUTCOME_CONVERSATION_INPUT_INVALID");
  }

  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase.rpc("save_own_outcome_conversation", {
      p_outcome_id: input.outcomeId,
      p_expected_conversation_revision: input.expectedConversationRevision,
      p_request_id: input.requestId,
      p_conversation: input.conversation,
    }),
  );
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    invalidConversationReceipt();
  }

  const value = data as Record<string, unknown>;
  const state = value.state;
  const acceptedRevision = value.accepted_conversation_revision;
  const conversationRevision = value.conversation_revision;
  if (
    value.contract_version !== "outcome-conversation-save.1" ||
    (state !== "committed" && state !== "unchanged" && state !== "superseded") ||
    value.request_id !== input.requestId ||
    value.outcome_id !== input.outcomeId ||
    typeof value.user_id !== "string" ||
    value.user_id.trim().toLowerCase() !== lease.expectedUserId ||
    acceptedRevision !== input.expectedConversationRevision ||
    !Number.isSafeInteger(conversationRevision) ||
    typeof value.conversation_sha256 !== "string" ||
    !SHA256_PATTERN.test(value.conversation_sha256) ||
    typeof value.updated_at !== "string" ||
    !Number.isFinite(Date.parse(value.updated_at)) ||
    typeof value.idempotent_replay !== "boolean"
  ) {
    invalidConversationReceipt();
  }

  if (state === "superseded") {
    const committedRevision = value.committed_conversation_revision;
    if (
      !Number.isSafeInteger(committedRevision) ||
      (committedRevision as number) < input.expectedConversationRevision ||
      (committedRevision as number) > input.expectedConversationRevision + 1 ||
      (conversationRevision as number) <= (committedRevision as number) ||
      value.idempotent_replay !== true ||
      value.retryable !== false ||
      value.safe_next_action !== "reload"
    ) {
      invalidConversationReceipt();
    }
    return {
      state,
      requestId: input.requestId,
      outcomeId: input.outcomeId,
      userId: lease.expectedUserId,
      acceptedConversationRevision: input.expectedConversationRevision,
      committedConversationRevision: committedRevision as number,
      conversationRevision: conversationRevision as number,
      conversationSha256: value.conversation_sha256,
      updatedAt: value.updated_at,
      idempotentReplay: true,
      retryable: false,
      safeNextAction: "reload",
    };
  }

  if (
    conversationRevision !==
    input.expectedConversationRevision + (state === "committed" ? 1 : 0)
  ) {
    invalidConversationReceipt();
  }

  return {
    state,
    requestId: input.requestId,
    outcomeId: input.outcomeId,
    userId: lease.expectedUserId,
    acceptedConversationRevision: input.expectedConversationRevision,
    conversationRevision: conversationRevision as number,
    conversationSha256: value.conversation_sha256,
    updatedAt: value.updated_at,
    idempotentReplay: value.idempotent_replay,
  };
}

/** Load one outcome by id — its payload holds the saved conversation. */
export async function fetchOutcome(
  id: string,
  lease: OwnerDispatchLease,
): Promise<Outcome | null> {
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase.from("outcomes").select("*").eq("id", id).maybeSingle(),
  );
  if (error) throw error;
  if (!data) return null;
  if (
    typeof data !== "object" ||
    Array.isArray(data) ||
    (data as { id?: unknown }).id !== id ||
    typeof (data as { user_id?: unknown }).user_id !== "string" ||
    (data as { user_id: string }).user_id.trim().toLowerCase() !== lease.expectedUserId ||
    ((data as { conversation_revision?: unknown }).conversation_revision !== undefined &&
      (!Number.isSafeInteger(
        (data as { conversation_revision?: unknown }).conversation_revision,
      ) ||
        Number((data as { conversation_revision?: unknown }).conversation_revision) < 0))
  ) {
    throw new Error("OUTCOME_READ_INVALID");
  }
  return data as Outcome;
}
