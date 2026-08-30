import type { Outcome, OutcomeStatus, RecommendationPayload } from "@prompted/shared/browser";
import { createClient } from "@/lib/supabase/client";

export interface UpsertOutcomeInput {
  id: string;
  user_id: string;
  situation_text: string;
  recommendation_payload?: RecommendationPayload | null;
  status?: OutcomeStatus;
}

/**
 * Create or update the outcome (session) row.
 *
 * This is the parent record the Library "Recents" reads from, and where the
 * chat thread is stored so it can be reopened via "Back to conversation". Safe
 * to call repeatedly (upsert on id). Only meaningful for signed-in users — RLS
 * scopes every row to the authenticated user.
 */
export async function upsertOutcome(input: UpsertOutcomeInput): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("outcomes").upsert(
    {
      id: input.id,
      user_id: input.user_id,
      situation_text: input.situation_text,
      recommendation_payload: input.recommendation_payload ?? null,
      status: input.status ?? "in_progress",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) throw error;
}

/** Patch fields on an existing outcome (e.g. mark completed, save the thread). */
export async function updateOutcome(
  id: string,
  patch: {
    status?: OutcomeStatus;
    is_saved?: boolean;
    recommendation_payload?: RecommendationPayload | null;
  },
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("outcomes")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** Load one outcome by id — its payload holds the saved conversation. */
export async function fetchOutcome(id: string): Promise<Outcome | null> {
  const supabase = createClient();
  const { data, error } = await supabase.from("outcomes").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data as Outcome;
}
