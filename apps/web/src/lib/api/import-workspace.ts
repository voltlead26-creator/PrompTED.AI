import type { Section } from "@prompted/shared/browser";
import { createClient } from "@/lib/supabase/client";

export interface CommitDocumentImportInput {
  uploadId: string;
  outcomeId: string;
  documentId: string;
  title: string;
  situationText: string;
  recommendationPayload: Record<string, unknown>;
  sections: Section[];
}

export interface CommitDocumentImportResult {
  status: "committed";
  outcome_id: string;
  document_id: string;
  idempotent_replay: boolean;
}

export interface CommitGuestWorkspaceImportInput {
  idempotencyKey: string;
  outcomeId: string;
  documentId: string;
  title: string;
  situationText: string;
  recommendationPayload: Record<string, unknown>;
  templateId: string | null;
  documentStatus: "draft" | "archived";
  sections: Section[];
}

export async function commitDocumentImport(
  input: CommitDocumentImportInput,
): Promise<CommitDocumentImportResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("commit_document_import", {
    p_upload_id: input.uploadId,
    p_outcome_id: input.outcomeId,
    p_document_id: input.documentId,
    p_title: input.title,
    p_situation_text: input.situationText,
    p_recommendation_payload: input.recommendationPayload,
    p_sections: input.sections,
  });

  if (error) throw error;
  if (!data || typeof data !== "object") throw new Error("IMPORT_COMMIT_EMPTY_RESPONSE");
  return data as CommitDocumentImportResult;
}

/**
 * Moves one device-only workspace into the signed-in account in a single
 * revision-safe database transaction. The server derives the owner from the
 * session and treats the idempotency key as immutable.
 */
export async function commitGuestWorkspaceImport(
  input: CommitGuestWorkspaceImportInput,
): Promise<CommitDocumentImportResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("commit_guest_workspace_import", {
    p_idempotency_key: input.idempotencyKey,
    p_outcome_id: input.outcomeId,
    p_document_id: input.documentId,
    p_title: input.title,
    p_situation_text: input.situationText,
    p_recommendation_payload: input.recommendationPayload,
    p_template_id: input.templateId,
    p_document_status: input.documentStatus,
    p_sections: input.sections,
  });

  if (error) throw error;
  if (!data || typeof data !== "object") {
    throw new Error("GUEST_IMPORT_COMMIT_EMPTY_RESPONSE");
  }
  return data as CommitDocumentImportResult;
}
