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

export interface RoleOutcomeCommand {
  /** Allocated once before the first attempt; reused on every uncertain retry. */
  eventId: string;
  userId: string;
  savedRoleId: string;
  stage: RoleOutcomeStage;
  note?: string;
  occurredAt: string;
}

export function roleOutcomeLocalDate(now = new Date()): string {
  return `${now.getFullYear().toString().padStart(4, "0")}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${now.getDate().toString().padStart(2, "0")}`;
}

function isCivilDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const ROLE_OUTCOME_COLUMNS = "id,user_id,saved_role_id,stage,note,occurred_at";

function readRoleOutcome(value: unknown, ownerId: string, roleId: string): RoleOutcome | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !UUID_PATTERN.test(row.id) || row.user_id !== ownerId ||
    row.saved_role_id !== roleId || typeof row.stage !== "string" ||
    !Object.hasOwn(ROLE_OUTCOME_STAGE_LABELS, row.stage) ||
    (row.note !== null && typeof row.note !== "string") || !isCivilDate(row.occurred_at)) return null;
  return { id: row.id, stage: row.stage as RoleOutcomeStage, note: row.note, occurred_at: row.occurred_at };
}

/** Insert once; reconcile ambiguous acknowledgements by exact immutable identity. */
export async function recordRoleOutcome(input: RoleOutcomeCommand, lease: OwnerDispatchLease): Promise<RoleOutcome> {
  if (input.userId.trim().toLowerCase() !== lease.expectedUserId) {
    throw new Error("SAVED_ROLE_OWNER_CONTEXT_MISMATCH");
  }
  if (!UUID_PATTERN.test(input.eventId) || !UUID_PATTERN.test(input.savedRoleId) ||
    !Object.hasOwn(ROLE_OUTCOME_STAGE_LABELS, input.stage) || !isCivilDate(input.occurredAt) ||
    (input.note !== undefined && typeof input.note !== "string")) throw new Error("ROLE_OUTCOME_COMMAND_INVALID");
  const expected = { id: input.eventId.toLowerCase(), user_id: lease.expectedUserId, saved_role_id: input.savedRoleId.toLowerCase(),
    stage: input.stage, note: input.note?.trim() || null, occurred_at: input.occurredAt };
  const matches = (row: RoleOutcome) => row.id === expected.id && row.stage === expected.stage &&
    row.note === expected.note && row.occurred_at === expected.occurred_at;
  return withOwnerSupabase(lease, async supabase => {
    lease.assertCurrent();
    try {
      const { data, error } = await supabase.from("role_outcomes").insert(expected).select(ROLE_OUTCOME_COLUMNS).single();
      lease.assertCurrent();
      const row = !error && readRoleOutcome(data, expected.user_id, expected.saved_role_id);
      if (row && matches(row)) return row;
    } catch {
      // An insert may have committed before its acknowledgement was lost.
      // A read under the same owner lease is the only permitted reconciliation.
      lease.assertCurrent();
    }
    lease.assertCurrent();
    const { data, error } = await supabase.from("role_outcomes").select(ROLE_OUTCOME_COLUMNS)
      .eq("id", expected.id).eq("user_id", expected.user_id).eq("saved_role_id", expected.saved_role_id).maybeSingle();
    lease.assertCurrent();
    const row = !error && readRoleOutcome(data, expected.user_id, expected.saved_role_id);
    if (!row) throw new Error("ROLE_OUTCOME_SAVE_UNCONFIRMED");
    if (!matches(row)) throw new Error("ROLE_OUTCOME_REPLAY_CONFLICT");
    return row;
  });
}

export async function fetchRoleOutcomes(
  savedRoleId: string,
  lease: OwnerDispatchLease,
): Promise<RoleOutcome[]> {
  if (!UUID_PATTERN.test(savedRoleId)) throw new Error("ROLE_OUTCOME_ROLE_INVALID");
  savedRoleId = savedRoleId.toLowerCase();
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase
      .from("role_outcomes")
      .select(ROLE_OUTCOME_COLUMNS)
      .eq("saved_role_id", savedRoleId)
      .eq("user_id", lease.expectedUserId)
      .order("occurred_at", { ascending: false }),
  );
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("ROLE_OUTCOME_HISTORY_INVALID");
  const rows: RoleOutcome[] = [];
  const ids = new Set<string>();
  for (const value of data) {
    const row = readRoleOutcome(value, lease.expectedUserId, savedRoleId);
    if (!row || ids.has(row.id)) throw new Error("ROLE_OUTCOME_HISTORY_INVALID");
    ids.add(row.id);
    rows.push(row);
  }
  return rows;
}

const ROLE_ACTION_COLUMNS = "id,user_id,saved_role_id,label,description,status,sort_order,mutation_token";
// PostgreSQL UUID values need not carry an RFC version; returned text is lowercase.
const ROLE_ACTION_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function readRoleActionItem(value: unknown, ownerId: string, roleId: string): RoleActionItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" || !ROLE_ACTION_UUID_PATTERN.test(row.id) ||
    row.user_id !== ownerId || row.saved_role_id !== roleId ||
    typeof row.label !== "string" ||
    (row.description !== null && typeof row.description !== "string") ||
    (row.status !== "pending" && row.status !== "done" && row.status !== "skipped") ||
    typeof row.sort_order !== "number" || !Number.isInteger(row.sort_order) ||
    row.sort_order < -2147483648 || row.sort_order > 2147483647 ||
    typeof row.mutation_token !== "string" || !ROLE_ACTION_UUID_PATTERN.test(row.mutation_token)
  ) return null;
  return {
    id: row.id,
    label: row.label,
    description: row.description,
    status: row.status,
    sort_order: row.sort_order,
    mutation_token: row.mutation_token,
  };
}

export async function fetchActionItems(
  savedRoleId: string,
  lease: OwnerDispatchLease,
): Promise<RoleActionItem[]> {
  if (typeof savedRoleId !== "string" || !ROLE_ACTION_UUID_PATTERN.test(savedRoleId.toLowerCase())) {
    throw new Error("ROLE_ACTION_ROLE_INVALID");
  }
  const roleId = savedRoleId.toLowerCase();
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase
      .from("role_action_items")
      .select(ROLE_ACTION_COLUMNS)
      .eq("saved_role_id", roleId)
      .eq("user_id", lease.expectedUserId)
      .order("sort_order", { ascending: true }),
  );
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("ROLE_ACTION_ITEMS_INVALID");
  const rows: RoleActionItem[] = [];
  const ids = new Set<string>();
  for (const value of data) {
    const row = readRoleActionItem(value, lease.expectedUserId, roleId);
    if (!row || ids.has(row.id)) throw new Error("ROLE_ACTION_ITEMS_INVALID");
    ids.add(row.id);
    rows.push(row);
  }
  return rows;
}

export type RoleActionItemMutationResult =
  | { status: "committed"; affectedRows: 1; item: RoleActionItem }
  | { status: "revision_conflict"; affectedRows: 0; item: RoleActionItem };

function isRoleActionItem(value: unknown, expectedId: string): value is RoleActionItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    item.id === expectedId &&
    typeof item.label === "string" &&
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
