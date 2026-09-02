import type { PersistedChecklistItem } from "@prompted/shared";
import type { OwnerDispatchLease } from "@/lib/browser-principal-state";
import { withOwnerSupabase } from "@/lib/supabase/owner-client";

export interface AtomicChecklistItem {
  id: string;
  text: string;
  due_date: string | null;
  reason: string | null;
  order_index: number;
}

export interface ChecklistReplacementResult {
  status: "committed";
  outcome_id: string;
  request_id: string;
  item_count: number;
  outcome_updated_at: string;
  idempotent_replay: boolean;
}

/** One authenticated database transaction replaces a generated checklist. */
export async function replaceOwnChecklist(input: {
  outcomeId: string;
  requestId: string;
  expectedOutcomeUpdatedAt: string;
  items: AtomicChecklistItem[];
}, lease: OwnerDispatchLease): Promise<ChecklistReplacementResult> {
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase.rpc("replace_own_checklist", {
      p_outcome_id: input.outcomeId,
      p_request_id: input.requestId,
      p_expected_outcome_updated_at: input.expectedOutcomeUpdatedAt,
      p_items: input.items,
    }),
  );
  if (error) throw error;
  return data as ChecklistReplacementResult;
}

export type ChecklistItemMutationResult =
  | { status: "committed"; affectedRows: 1; item: PersistedChecklistItem }
  | { status: "revision_conflict"; affectedRows: 0; item: PersistedChecklistItem };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPersistedChecklistItem(
  value: unknown,
  expected?: { itemId?: string; outcomeId?: string; userId?: string },
): value is PersistedChecklistItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" && UUID_PATTERN.test(item.id) &&
    typeof item.outcome_id === "string" && UUID_PATTERN.test(item.outcome_id) &&
    typeof item.user_id === "string" && UUID_PATTERN.test(item.user_id) &&
    typeof item.mutation_token === "string" && UUID_PATTERN.test(item.mutation_token) &&
    typeof item.text === "string" && item.text.trim().length > 0 && item.text.length <= 2000 &&
    (item.due_date === null || typeof item.due_date === "string") &&
    (item.reason === null || typeof item.reason === "string") &&
    typeof item.done === "boolean" &&
    (item.reminder_offset_days === null || Number.isInteger(item.reminder_offset_days)) &&
    typeof item.reminder_sent === "boolean" &&
    Number.isInteger(item.order_index) &&
    typeof item.created_at === "string" &&
    typeof item.updated_at === "string" &&
    (!expected?.itemId || item.id === expected.itemId) &&
    (!expected?.outcomeId || item.outcome_id === expected.outcomeId) &&
    (!expected?.userId || item.user_id === expected.userId)
  );
}

export async function updateOwnChecklistItem(input: {
  itemId: string;
  outcomeId: string;
  expectedMutationToken: string;
  expectedUserId: string;
  done?: boolean;
  text?: string;
}, lease: OwnerDispatchLease): Promise<ChecklistItemMutationResult> {
  const changes = Number(input.done !== undefined) + Number(input.text !== undefined);
  if (changes !== 1 || (input.text !== undefined && !input.text.trim())) {
    throw new Error("CHECKLIST_ITEM_CHANGE_INVALID");
  }
  if (input.expectedUserId.trim().toLowerCase() !== lease.expectedUserId) {
    throw new Error("CHECKLIST_OWNER_CONTEXT_MISMATCH");
  }
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase.rpc("update_own_checklist_item", {
      p_item_id: input.itemId,
      p_outcome_id: input.outcomeId,
      p_expected_mutation_token: input.expectedMutationToken,
      p_done: input.done ?? null,
      p_text: input.text?.trim() ?? null,
    }),
  );
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    throw error ?? new Error("CHECKLIST_ITEM_MUTATION_UNCONFIRMED");
  }
  const envelope = data as Record<string, unknown>;
  const committed = envelope.status === "committed" && envelope.affected_rows === 1;
  const conflict =
    envelope.status === "revision_conflict" && envelope.affected_rows === 0;
  if (
    (!committed && !conflict) ||
    !isPersistedChecklistItem(envelope.item, {
      itemId: input.itemId,
      outcomeId: input.outcomeId,
      userId: input.expectedUserId,
    }) ||
    envelope.item.mutation_token === input.expectedMutationToken
  ) {
    throw new Error("CHECKLIST_ITEM_MUTATION_INVALID");
  }
  return committed
    ? { status: "committed", affectedRows: 1, item: envelope.item }
    : { status: "revision_conflict", affectedRows: 0, item: envelope.item };
}
