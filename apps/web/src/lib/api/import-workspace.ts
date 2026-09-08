import type { Section } from "@prompted/shared/browser";
import { withOwnerDispatchSignal, type OwnerDispatchLease } from "@/lib/browser-principal-state";
import { withOwnerSupabase } from "@/lib/supabase/owner-client";
import {
  isWorkspaceUploadId, MAX_UPLOAD_BYTES, parseWorkspaceUploadDetail, parseWorkspaceUploadPage,
  type WorkspaceUploadCursor, type WorkspaceUploadDetail, type WorkspaceUploadPage,
} from "@prompted/shared/ingest-upload";

export async function getWorkspaceUpload(uploadId: string, lease: OwnerDispatchLease): Promise<WorkspaceUploadDetail | null> {
  lease.assertCurrent();
  if (!isWorkspaceUploadId(uploadId)) throw new Error("UPLOAD_ID_INVALID");
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase.rpc("get_own_workspace_upload_v1", { p_upload_id: uploadId }));
  if (error) throw error;
  return parseWorkspaceUploadDetail(data, lease.expectedUserId, uploadId);
}

export async function listWorkspaceUploads(cursor: WorkspaceUploadCursor | null, lease: OwnerDispatchLease): Promise<WorkspaceUploadPage> {
  lease.assertCurrent();
  if (cursor && (!isWorkspaceUploadId(cursor.upload_id) || typeof cursor.created_at !== "string" ||
    cursor.created_at.length > 40 || !Number.isFinite(Date.parse(cursor.created_at)))) throw new Error("UPLOAD_CURSOR_INVALID");
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase.rpc("list_own_workspace_uploads_v1", {
      p_before_created_at: cursor?.created_at ?? null, p_before_id: cursor?.upload_id ?? null,
    }));
  if (error) throw error;
  return parseWorkspaceUploadPage(data, lease.expectedUserId);
}

/** Read back the exact selected original, then verify available byte evidence.
 * The caller owns the final selected-resource lease and browser download action. */
export async function downloadWorkspaceUpload(uploadId: string, lease: OwnerDispatchLease): Promise<{ blob: Blob; fileName: string }> {
  const controller = new AbortController();
  const boundedLease = withOwnerDispatchSignal(lease, controller.signal);
  const deadline = Date.now() + 30_000;
  const assertBudget = () => {
    boundedLease.assertCurrent();
    if (Date.now() >= deadline) throw new Error("UPLOAD_ORIGINAL_TIMEOUT");
  };
  const timer = setTimeout(() => controller.abort(new Error("UPLOAD_ORIGINAL_TIMEOUT")), 30_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const source = await getWorkspaceUpload(uploadId, boundedLease);
    assertBudget();
    if (!source?.original) throw new Error("UPLOAD_ORIGINAL_UNAVAILABLE");
    // storage-js interpolates this argument into a URL. Encode literal stored
    // segments so historical #, ?, percent and backslash names stay exact.
    const path = source.original.storage_path.split("/").map(encodeURIComponent).join("/");
    // The installed SDK forwards these Fetch options unchanged; its published
    // FetchParameters type lists only signal/cache. Keep the complete object
    // checked against the browser Fetch contract and exercise it through SDK tests.
    const parameters = { signal: boundedLease.signal, cache: "no-store", redirect: "error" } satisfies RequestInit;
    const { error } = await withOwnerSupabase(boundedLease, async (supabase) => {
      const result = await supabase.storage.from("original-documents").download(path, {}, parameters).asStream();
      // Own cleanup before the owner client performs its post-response check.
      if (result.data && typeof result.data.getReader === "function") reader = result.data.getReader();
      return result;
    });
    if (error) throw error;
    if (!reader) throw new Error("UPLOAD_ORIGINAL_INVALID_RESPONSE");
    assertBudget();
    const bytes = new Uint8Array(source.byte_length ?? MAX_UPLOAD_BYTES);
    let length = 0;
    let reads = 0;
    let emptyReads = 0;
    while (true) {
      assertBudget();
      if (++reads > 65_536) throw new Error("UPLOAD_ORIGINAL_READ_LIMIT");
      // One abort reaction per outstanding read; completed reads retain none.
      const activeReader = reader;
      const part = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
        const onAbort = () => { cleanup(); reject(boundedLease.signal.reason ?? new Error("UPLOAD_ORIGINAL_CANCELLED")); };
        const cleanup = () => boundedLease.signal.removeEventListener("abort", onAbort);
        boundedLease.signal.addEventListener("abort", onAbort, { once: true });
        if (boundedLease.signal.aborted) { onAbort(); return; }
        void activeReader.read().then((result) => { cleanup(); resolve(result); }, (error) => { cleanup(); reject(error); });
      });
      assertBudget();
      if (part.done) break;
      if (!ArrayBuffer.isView(part.value) || Object.prototype.toString.call(part.value) !== "[object Uint8Array]")
        throw new Error("UPLOAD_ORIGINAL_INVALID_RESPONSE");
      if (part.value.byteLength === 0) {
        if (++emptyReads > 32) throw new Error("UPLOAD_ORIGINAL_READ_LIMIT");
        continue;
      }
      emptyReads = 0;
      if (length + part.value.byteLength > bytes.byteLength)
        throw new Error("UPLOAD_ORIGINAL_BYTES_MISMATCH");
      bytes.set(part.value, length);
      length += part.value.byteLength;
    }
    if (length === 0 || (source.byte_length !== null && length !== source.byte_length)) throw new Error("UPLOAD_ORIGINAL_BYTES_MISMATCH");
    const content = bytes.subarray(0, length);
    const blob = new Blob([content], { type: "application/octet-stream" });
    if (source.original.sha256 !== null) {
      assertBudget();
      const digest = await crypto.subtle.digest("SHA-256", content);
      assertBudget();
      const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (actual !== source.original.sha256) throw new Error("UPLOAD_ORIGINAL_BYTES_MISMATCH");
    }
    assertBudget();
    return { blob, fileName: source.file_name };
  } finally {
    clearTimeout(timer);
    if (reader) { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
    controller.abort();
  }
}

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
  lease: OwnerDispatchLease,
): Promise<CommitDocumentImportResult> {
  const { data, error } = await withOwnerSupabase(
    lease,
    async (supabase) =>
      await supabase.rpc("commit_document_import", {
        p_upload_id: input.uploadId,
        p_outcome_id: input.outcomeId,
        p_document_id: input.documentId,
        p_title: input.title,
        p_situation_text: input.situationText,
        p_recommendation_payload: input.recommendationPayload,
        p_sections: input.sections,
      }),
  );

  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("IMPORT_COMMIT_INVALID_RESPONSE");
  }
  const receipt = data as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    Object.keys(receipt).length !== 4 ||
    receipt.status !== "committed" ||
    typeof receipt.outcome_id !== "string" ||
    !uuid.test(receipt.outcome_id) ||
    typeof receipt.document_id !== "string" ||
    !uuid.test(receipt.document_id) ||
    typeof receipt.idempotent_replay !== "boolean" ||
    (!receipt.idempotent_replay &&
      (receipt.outcome_id.toLowerCase() !== input.outcomeId.toLowerCase() ||
        receipt.document_id.toLowerCase() !== input.documentId.toLowerCase()))
  ) {
    throw new Error("IMPORT_COMMIT_INVALID_RESPONSE");
  }
  // Replays deliberately return the original destination of this owned upload.
  return {
    status: "committed",
    outcome_id: receipt.outcome_id,
    document_id: receipt.document_id,
    idempotent_replay: receipt.idempotent_replay,
  };
}

/**
 * Moves one device-only workspace into the signed-in account in a single
 * revision-safe database transaction. The server derives the owner from the
 * session and treats the idempotency key as immutable.
 */
export async function commitGuestWorkspaceImport(
  input: CommitGuestWorkspaceImportInput,
  lease: OwnerDispatchLease,
): Promise<CommitDocumentImportResult> {
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase.rpc("commit_guest_workspace_import", {
      p_idempotency_key: input.idempotencyKey,
      p_outcome_id: input.outcomeId,
      p_document_id: input.documentId,
      p_title: input.title,
      p_situation_text: input.situationText,
      p_recommendation_payload: input.recommendationPayload,
      p_template_id: input.templateId,
      p_document_status: input.documentStatus,
      p_sections: input.sections,
    }),
  );

  if (error) throw error;
  if (!data || typeof data !== "object") {
    throw new Error("GUEST_IMPORT_COMMIT_EMPTY_RESPONSE");
  }
  return data as CommitDocumentImportResult;
}
