import type { OwnerDispatchLease } from "@/lib/browser-principal-state";
import { withOwnerSupabase } from "@/lib/supabase/owner-client";

export interface SavedRole {
  id: string;
  role_title: string;
  company_name: string | null;
  location: string | null;
  match_percentage: number | null;
  job_url: string | null;
  source_label: string | null;
  contact_email: string | null;
  contact_source_status: "official" | "public_listing" | "needs_confirmation" | null;
  status: string;
  latest_stage: RoleOutcomeStage | null;
}

/**
 * Outcome-tracking loop (inspired by ai-job-search's /outcome command):
 * records what actually happened to an application, distinct from the
 * action-plan checklist (which tracks preparation, not results).
 */
export type RoleOutcomeStage =
  | "applied"
  | "phone_screen"
  | "interview_1"
  | "interview_2"
  | "interview_3"
  | "final_round"
  | "offer"
  | "hired"
  | "rejected"
  | "no_response"
  | "withdrawn";

export const ROLE_OUTCOME_STAGE_LABELS: Record<RoleOutcomeStage, string> = {
  applied: "Applied",
  phone_screen: "Phone screen",
  interview_1: "1st interview",
  interview_2: "2nd interview",
  interview_3: "3rd interview",
  final_round: "Final round",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
  no_response: "No response",
  withdrawn: "Withdrawn",
};

export interface RoleOutcome {
  id: string;
  stage: RoleOutcomeStage;
  note: string | null;
  occurred_at: string;
}

export interface RoleActionItem {
  id: string;
  label: string;
  description: string | null;
  status: "pending" | "done" | "skipped";
  sort_order: number;
  mutation_token: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Create or update a saved role (unique per user + title + company). First
 * save also seeds the spec's default action-plan checklist. Returns the role id.
 */
export async function saveRole(input: {
  userId: string;
  roleTitle: string;
  companyName?: string;
  location?: string;
  matchPercentage?: number;
  jobUrl?: string;
  sourceLabel?: string;
  contactEmail?: string;
  contactSourceStatus?: SavedRole["contact_source_status"];
}, lease: OwnerDispatchLease): Promise<string> {
  if (input.userId.trim().toLowerCase() !== lease.expectedUserId) {
    throw new Error("SAVED_ROLE_OWNER_CONTEXT_MISMATCH");
  }
  return withOwnerSupabase(lease, async (supabase) => {
    const { data, error } = await supabase.rpc("save_own_role_with_default_actions", {
      p_role_title: input.roleTitle,
      p_company_name: input.companyName ?? null,
      p_location: input.location ?? null,
      p_match_percentage: input.matchPercentage ?? null,
      p_job_url: input.jobUrl ?? null,
      p_source_label: input.sourceLabel ?? null,
      p_contact_email: input.contactEmail ?? null,
      p_contact_source_status: input.contactSourceStatus ?? null,
    });
    if (error) throw error;
    if (typeof data !== "string" || !UUID_PATTERN.test(data)) {
      throw new Error("SAVED_ROLE_SAVE_RESULT_INVALID");
    }
    return data;
  });
}

export async function fetchSavedRoles(
  userId: string,
  lease: OwnerDispatchLease,
): Promise<SavedRole[]> {
  if (userId.trim().toLowerCase() !== lease.expectedUserId) {
    throw new Error("SAVED_ROLE_OWNER_CONTEXT_MISMATCH");
  }
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase
      .from("saved_roles")
      .select("id,role_title,company_name,location,match_percentage,job_url,source_label,contact_email,contact_source_status,status,latest_stage")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false }),
  );
  if (error) throw error;
  return (data ?? []) as SavedRole[];
}

/** Record what happened at a given stage \u2014 the outcome-tracking loop. */
export async function recordRoleOutcome(input: {
  userId: string;
  savedRoleId: string;
  stage: RoleOutcomeStage;
  note?: string;
  occurredAt?: string;
}, lease: OwnerDispatchLease): Promise<RoleOutcome> {
  if (input.userId.trim().toLowerCase() !== lease.expectedUserId) {
    throw new Error("SAVED_ROLE_OWNER_CONTEXT_MISMATCH");
  }
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase
      .from("role_outcomes")
      .insert({
        user_id: input.userId,
        saved_role_id: input.savedRoleId,
        stage: input.stage,
        note: input.note?.trim() || null,
        occurred_at: input.occurredAt ?? new Date().toISOString().slice(0, 10),
      })
      .select("id,stage,note,occurred_at")
      .single(),
  );
  if (error || !data) throw error ?? new Error("ROLE_OUTCOME_SAVE_UNCONFIRMED");
  return data as RoleOutcome;
}

export async function fetchRoleOutcomes(
  savedRoleId: string,
  lease: OwnerDispatchLease,
): Promise<RoleOutcome[]> {
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase
      .from("role_outcomes")
      .select("id,stage,note,occurred_at")
      .eq("saved_role_id", savedRoleId)
      .order("occurred_at", { ascending: false }),
  );
  if (error) throw error;
  return (data ?? []) as RoleOutcome[];
}

export async function fetchActionItems(
  savedRoleId: string,
  lease: OwnerDispatchLease,
): Promise<RoleActionItem[]> {
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase
      .from("role_action_items")
      .select("id,label,description,status,sort_order,mutation_token")
      .eq("saved_role_id", savedRoleId)
      .order("sort_order", { ascending: true }),
  );
  if (error) throw error;
  return (data ?? []) as RoleActionItem[];
}

export type RoleActionItemMutationResult =
  | { status: "committed"; affectedRows: 1; item: RoleActionItem }
  | { status: "revision_conflict"; affectedRows: 0; item: RoleActionItem };

function isRoleActionItem(value: unknown, expectedId: string): value is RoleActionItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    item.id === expectedId &&
    typeof item.label === "string" && item.label.trim().length > 0 &&
    (item.description === null || typeof item.description === "string") &&
    (item.status === "pending" || item.status === "done" || item.status === "skipped") &&
    Number.isInteger(item.sort_order) &&
    typeof item.mutation_token === "string" && UUID_PATTERN.test(item.mutation_token)
  );
}

export async function setActionItemStatus(
  input: {
    id: string;
    expectedMutationToken: string;
    status: RoleActionItem["status"];
  },
  lease: OwnerDispatchLease,
): Promise<RoleActionItemMutationResult> {
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase.rpc("update_own_role_action_item", {
      p_item_id: input.id,
      p_expected_mutation_token: input.expectedMutationToken,
      p_status: input.status,
    }),
  );
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    throw error ?? new Error("ROLE_ACTION_STATUS_UNCONFIRMED");
  }
  const envelope = data as Record<string, unknown>;
  const committed = envelope.status === "committed" && envelope.affected_rows === 1;
  const conflict = envelope.status === "revision_conflict" && envelope.affected_rows === 0;
  if (
    (!committed && !conflict) ||
    !isRoleActionItem(envelope.item, input.id) ||
    envelope.item.mutation_token === input.expectedMutationToken ||
    (committed && envelope.item.status !== input.status)
  ) {
    throw new Error("ROLE_ACTION_STATUS_INVALID");
  }
  return committed
    ? { status: "committed", affectedRows: 1, item: envelope.item }
    : { status: "revision_conflict", affectedRows: 0, item: envelope.item };
}
