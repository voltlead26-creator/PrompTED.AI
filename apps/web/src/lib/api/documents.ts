import type {
  Document,
  DocumentPlaceholderMetadata,
  DocumentStatus,
} from "@prompted/shared/browser";
import { createClient } from "@/lib/supabase/client";

function resolveTemplateUuid(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    candidate,
  )
    ? candidate.toLowerCase()
    : null;
}

export async function fetchDocument(id: string): Promise<Document | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data as Document;
}

export async function fetchDocumentByOutcomeId(
  outcomeId: string,
  userId: string,
): Promise<Document | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("outcome_id", outcomeId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data as Document;
}

export async function upsertDocument(doc: {
  id: string;
  user_id: string;
  outcome_id?: string | null;
  title: string;
  status: DocumentStatus;
  template_id?: string | null;
  unresolved_placeholders?: DocumentPlaceholderMetadata[];
}): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("documents").upsert(
    {
      id: doc.id,
      user_id: doc.user_id,
      outcome_id: doc.outcome_id ?? null,
      template_id: resolveTemplateUuid(doc.template_id),
      title: doc.title,
      status: doc.status,
      format: "word",
      is_template: false,
      unresolved_placeholders: doc.unresolved_placeholders ?? [],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) throw error;
}

export async function updateDocumentStatus(
  id: string,
  status: DocumentStatus,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("documents")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function updateDocumentTitle(
  id: string,
  title: string,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("documents")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
