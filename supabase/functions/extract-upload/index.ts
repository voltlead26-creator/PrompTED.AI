// =====================================================
// PrompTED - extract-upload
// Internal, resource-isolated parsing of an exact retained upload.
// =====================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse } from "../_shared/cors.ts";
import {
  privateStorageRuntime,
  requestPrivateStorageObject,
} from "../_shared/private-storage-object.ts";
import {
  extractBoundedUploadText,
  MAX_UPLOAD_BYTES,
} from "../_shared/upload-extraction.ts";
import {
  handleExtractUpload,
  type UploadExtractionSnapshot,
} from "./handler.ts";

function snapshotRecord(value: unknown): UploadExtractionSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    uploadId: String(record.upload_id ?? ""),
    userId: String(record.user_id ?? ""),
    requestSha256: String(record.request_sha256 ?? ""),
    claimToken: String(record.claim_token ?? ""),
    storagePath: String(record.storage_path ?? ""),
    filename: String(record.filename ?? ""),
    fileType: String(record.file_type ?? ""),
    byteLength: Number(record.byte_length),
    contentSha256: String(record.content_sha256 ?? ""),
    stage: String(record.stage ?? "") as UploadExtractionSnapshot["stage"],
  };
}

Deno.serve(async (req) => {
  try {
    const runtime = privateStorageRuntime();
    const admin = createClient(runtime.baseUrl, runtime.serviceRoleKey, {
      auth: { persistSession: false },
    });
    return await handleExtractUpload(req, {
      serviceRoleKey: runtime.serviceRoleKey,
      async loadSnapshot(input) {
        const { data, error } = await admin.rpc(
          "load_upload_extraction_snapshot",
          {
            p_upload_id: input.uploadId,
            p_user_id: input.userId,
            p_request_sha256: input.requestSha256,
            p_claim_token: input.claimToken,
          },
        );
        if (error) throw new Error("UPLOAD_EXTRACTION_SNAPSHOT_UNAVAILABLE");
        return snapshotRecord(data);
      },
      async readOriginal(input) {
        const bytes = await requestPrivateStorageObject({
          ...runtime,
          bucket: "original-documents",
          path: input.storagePath,
          method: "GET",
          maximumResponseBytes: Math.min(input.maximumBytes, MAX_UPLOAD_BYTES),
          signal: input.signal,
        });
        if (!bytes) throw new Error("UPLOAD_EXTRACTION_SOURCE_UNAVAILABLE");
        return bytes;
      },
      extract: extractBoundedUploadText,
    });
  } catch {
    return jsonResponse(
      {
        error: {
          code: "UPLOAD_EXTRACTION_CONFIGURATION_UNAVAILABLE",
          message: "TED cannot safely start upload extraction right now.",
        },
        retryable: true,
      },
      503,
      null,
    );
  }
});
