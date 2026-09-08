// =====================================================
// PrompTED - extract-upload
// Internal, resource-isolated parsing of an exact retained upload.
// =====================================================

// Preserve the repository's existing explicit deployed dependency specifier.
// deno-lint-ignore no-import-prefix
import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse } from "../_shared/cors.ts";
import {
  privateStorageRuntime,
  requestPrivateStorageObject,
} from "../_shared/private-storage-object.ts";
import {
  extractBoundedUploadText,
  extractBoundedUploadWithSource,
  extractBoundedUploadWithSourceV3,
  MAX_UPLOAD_BYTES,
} from "../_shared/upload-extraction.ts";
import {
  handleExtractUpload,
  parseUploadExtractionSnapshot,
} from "./handler.ts";

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
        return parseUploadExtractionSnapshot(data);
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
      extractWithSource: extractBoundedUploadWithSource,
      extractWithSourceV3: extractBoundedUploadWithSourceV3,
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
