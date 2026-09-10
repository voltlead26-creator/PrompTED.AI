import type { WorkspaceUploadDetail } from "@prompted/shared/ingest-upload";

/** Presentation eligibility only. commit_document_import revalidates the owned
 * upload and its source contract atomically before creating any document. */
export function canReviewRetainedText(source: WorkspaceUploadDetail | null | undefined): source is WorkspaceUploadDetail & {
  preview: { text: string; truncated: false };
} {
  return Boolean(source && source.status === "ready" && source.ingest_status === "completed" &&
    source.format === "text" && source.original && !source.imported_document &&
    source.preview?.truncated === false && source.preview.text.trim());
}
