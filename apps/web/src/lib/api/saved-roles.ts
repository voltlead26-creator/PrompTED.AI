import { createClient } from "@/lib/supabase/client";

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
}

/** Spec-defined default checklist created when a role is first saved. */
const DEFAULT_ACTION_ITEMS: Array<{ label: string; description: string }> = [
  { label: "Review job requirements", description: "Read the listing closely and note must-haves." },
  { label: "Tailor resume", description: "Create a role-specific resume copy \u2014 the original is never changed." },
  { label: "Write cover letter", description: "Draft a complete, role-specific cover letter with TED." },
  { label: "Open official apply link", description: "Apply on the employer or government site yourself." },
  { label: "Email public contact if appropriate", description: "Only public, confirmed contacts \u2014 TED never guesses emails." },
  { label: "Set a follow-up reminder", description: "Note when to follow up if you have not heard back." },
];

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
}): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("saved_roles")
    .upsert(
      {
        user_id: input.userId,
        role_title: input.roleTitle,
        company_name: input.companyName ?? null,
        location: input.location ?? null,
        match_percentage: input.matchPercentage ?? null,
        job_url: input.jobUrl ?? null,
        source_label: input.sourceLabel ?? null,
        contact_email: input.contactEmail ?? null,
        contact_source_status: input.contactSourceStatus ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,role_title,company_name" },
    )
    .select("id")
    .single();
  if (error || !data) return null;

  const { count } = await supabase
    .from("role_action_items")
    .select("id", { count: "exact", head: true })
    .eq("saved_role_id", data.id);
  if (!count) {
    await supabase.from("role_action_items").insert(
      DEFAULT_ACTION_ITEMS.map((item, index) => ({
        user_id: input.userId,
        saved_role_id: data.id,
        label: item.label,
        description: item.description,
        sort_order: index,
      })),
    );
  }
  return data.id;
}

export async function fetchSavedRoles(userId: string): Promise<SavedRole[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("saved_roles")
    .select("id,role_title,company_name,location,match_percentage,job_url,source_label,contact_email,contact_source_status,status,latest_stage")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  return (data ?? []) as SavedRole[];
}

/** Record what happened at a given stage \u2014 the outcome-tracking loop. */
export async function recordRoleOutcome(input: {
  userId: string;
  savedRoleId: string;
  stage: RoleOutcomeStage;
  note?: string;
  occurredAt?: string;
}): Promise<void> {
  const supabase = createClient();
  await supabase.from("role_outcomes").insert({
    user_id: input.userId,
    saved_role_id: input.savedRoleId,
    stage: input.stage,
    note: input.note?.trim() || null,
    occurred_at: input.occurredAt ?? new Date().toISOString().slice(0, 10),
  });
}

export async function fetchRoleOutcomes(savedRoleId: string): Promise<RoleOutcome[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("role_outcomes")
    .select("id,stage,note,occurred_at")
    .eq("saved_role_id", savedRoleId)
    .order("occurred_at", { ascending: false });
  return (data ?? []) as RoleOutcome[];
}

export async function fetchActionItems(savedRoleId: string): Promise<RoleActionItem[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("role_action_items")
    .select("id,label,description,status,sort_order")
    .eq("saved_role_id", savedRoleId)
    .order("sort_order", { ascending: true });
  return (data ?? []) as RoleActionItem[];
}

export async function setActionItemStatus(
  id: string,
  status: RoleActionItem["status"],
): Promise<void> {
  const supabase = createClient();
  await supabase
    .from("role_action_items")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
}
