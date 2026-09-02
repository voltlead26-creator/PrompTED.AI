import type { OwnerDispatchLease } from "@/lib/browser-principal-state";
import { withOwnerSupabase } from "@/lib/supabase/owner-client";

export class CapturedDocumentMutationError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(code);
    this.name = "CapturedDocumentMutationError";
  }
}

function publicCode(error: { message?: string; code?: string } | null): string {
  const match = error?.message?.match(/\b([A-Z][A-Z0-9_]{3,})\b/);
  return match?.[1] ??
    (error?.code ? `DATABASE_${error.code}` : "CAPTURED_DOCUMENT_MUTATION_FAILED");
}

function isRetryable(code: string): boolean {
  return code.startsWith("STALE_") ||
    code.includes("TIMEOUT") ||
    code.includes("UNAVAILABLE");
}

async function rpc<T>(
  name: string,
  args: Record<string, unknown>,
  lease: OwnerDispatchLease,
): Promise<T> {
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase.rpc(name, args),
  );
  if (error || !data) {
    const code = publicCode(error);
    throw new CapturedDocumentMutationError(code, isRetryable(code));
  }
  return data as T;
}

export interface CapturedSectionEditResult {
  operation_id: string;
  operation_revision: number;
  document_id: string;
  document_revision: number;
  section_id: string;
  section_key: string;
  section_revision: number;
  persisted: true;
}

export function editCapturedDocumentSection(input: {
  operationId: string;
  expectedOperationRevision: number;
  documentId: string;
  expectedDocumentRevision: number;
  sectionKey: string;
  expectedSectionRevision: number;
  content: string;
  sectionState: "final" | "interactive_placeholder" | "neutral_fallback" | "omitted_optional";
}, lease: OwnerDispatchLease): Promise<CapturedSectionEditResult> {
  return rpc("edit_captured_document_section", {
    p_operation_id: input.operationId,
    p_expected_operation_revision: input.expectedOperationRevision,
    p_document_id: input.documentId,
    p_expected_document_revision: input.expectedDocumentRevision,
    p_section_key: input.sectionKey,
    p_expected_section_revision: input.expectedSectionRevision,
    p_content: input.content,
    p_section_state: input.sectionState,
  }, lease);
}

export interface CapturedApprovalResult {
  approval_id: string;
  operation_id: string;
  operation_revision: number;
  document_id: string;
  document_revision: number;
  approved: true;
  idempotent_replay: boolean;
}

export function approveCapturedDocumentRevision(input: {
  operationId: string;
  expectedOperationRevision: number;
  documentId: string;
  expectedDocumentRevision: number;
}, lease: OwnerDispatchLease): Promise<CapturedApprovalResult> {
  return rpc("approve_captured_document_revision", {
    p_operation_id: input.operationId,
    p_expected_operation_revision: input.expectedOperationRevision,
    p_document_id: input.documentId,
    p_expected_document_revision: input.expectedDocumentRevision,
  }, lease);
}

export interface CapturedExportRequestResult {
  export_id: string;
  operation_id: string;
  operation_revision: number;
  document_id: string;
  document_revision: number;
  format: "docx" | "pdf" | "xlsx" | "html_preview";
  status: "requested" | "created" | "failed" | "cancelled";
  idempotent_replay: boolean;
}

export function requestCapturedDocumentExport(input: {
  operationId: string;
  expectedOperationRevision: number;
  documentId: string;
  approvedDocumentRevision: number;
  format: "docx" | "pdf" | "xlsx" | "html_preview";
  idempotencyKey: string;
}, lease: OwnerDispatchLease): Promise<CapturedExportRequestResult> {
  return rpc("request_captured_document_export", {
    p_operation_id: input.operationId,
    p_expected_operation_revision: input.expectedOperationRevision,
    p_document_id: input.documentId,
    p_approved_document_revision: input.approvedDocumentRevision,
    p_format: input.format,
    p_export_idempotency_key: input.idempotencyKey,
  }, lease);
}
