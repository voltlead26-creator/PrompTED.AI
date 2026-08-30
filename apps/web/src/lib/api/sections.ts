import type {
  Section,
  SectionStatus,
  SectionVersion,
} from "@prompted/shared/browser";
import { createClient } from "@/lib/supabase/client";

export async function fetchSections(documentId: string): Promise<Section[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("sections")
    .select("*")
    .eq("document_id", documentId)
    .order("order_index", { ascending: true });
  if (error) throw error;
  if (!data) return [];
  return data as Section[];
}

/** Loads historical bodies only when the user opens History. */
export async function fetchSectionVersionHistory(
  sectionId: string,
): Promise<SectionVersion[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("sections")
    .select("version_history")
    .eq("id", sectionId)
    .maybeSingle();
  if (error) throw error;
  return Array.isArray(data?.version_history)
    ? data.version_history as SectionVersion[]
    : [];
}

export async function updateSectionContent(
  id: string,
  content: string,
  status: SectionStatus,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("sections")
    .update({ content, status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function updateSectionStatus(
  id: string,
  status: SectionStatus,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("sections")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Upsert all sections for a document in one round-trip. Used by the autosave
 * path — creates rows on first save and updates them on subsequent saves.
 */
export async function upsertSections(sections: Section[]): Promise<void> {
  if (sections.length === 0) return;
  const supabase = createClient();
  const rows = sections.map((s) => ({
    id: s.id,
    document_id: s.document_id,
    user_id: s.user_id,
    name: s.name,
    order_index: s.order_index,
    content: s.content,
    status: s.status,
    is_required: s.is_required,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from("sections")
    .upsert(rows, { onConflict: "id", defaultToNull: false });
  if (error) throw error;
}

/**
 * Persist a new section order in one round-trip. Only `order_index` is
 * touched. Supabase upsert reindexes every affected row at once rather than
 * rewriting content row-by-row.
 */
export async function persistSectionOrder(
  sections: Pick<Section, "id" | "order_index">[],
): Promise<void> {
  const supabase = createClient();
  const updates = sections.map((s) => ({
    id: s.id,
    order_index: s.order_index,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from("sections")
    .upsert(updates, { onConflict: "id", defaultToNull: false });
  if (error) throw error;
}
