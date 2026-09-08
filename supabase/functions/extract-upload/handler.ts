import { jsonResponse } from "../_shared/cors.ts";
import { PrivateStorageObjectError } from "../_shared/private-storage-object.ts";
import {
  assertUploadFormatMetadata,
  assertUploadFormatMetadataV3,
  MAX_UPLOAD_BYTES,
  type SourceUploadExtractionResult,
  UploadExtractionError,
  type UploadExtractionResult,
} from "../_shared/upload-extraction.ts";
import {
  type ReadableUploadExtractionContractVersion,
  UPLOAD_EXTRACTION_CONTRACT_V1,
  UPLOAD_EXTRACTION_CONTRACT_V2,
  UPLOAD_EXTRACTION_CONTRACT_V3,
} from "../_shared/upload-extraction-contract.ts";
import {
  normalizeSourceExtractionResponse,
  normalizeSourceExtractionResponseV3,
} from "../_shared/upload-extraction-client.ts";
import type { SourceUploadExtractionResultV3 } from "../_shared/document-source-contract.ts";

const MAX_INTERNAL_REQUEST_BYTES = 4_096;
const INTERNAL_REQUEST_TIMEOUT_MS = 5_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

interface ExtractUploadInput {
  upload_id: string;
  user_id: string;
  request_sha256: string;
  claim_token: string;
  extraction_contract_version?:
    | typeof UPLOAD_EXTRACTION_CONTRACT_V2
    | typeof UPLOAD_EXTRACTION_CONTRACT_V3;
}

export interface UploadExtractionSnapshot {
  uploadId: string;
  userId: string;
  requestSha256: string;
  claimToken: string;
  storagePath: string;
  filename: string;
  fileType: string;
  byteLength: number;
  contentSha256: string;
  stage: "storage_completed" | "provider_dispatched";
  extractionContractVersion?: ReadableUploadExtractionContractVersion;
}

export interface UploadExtractorDependencies {
  serviceRoleKey: string;
  loadSnapshot(input: {
    uploadId: string;
    userId: string;
    requestSha256: string;
    claimToken: string;
  }): Promise<UploadExtractionSnapshot | null>;
  readOriginal(input: {
    storagePath: string;
    maximumBytes: number;
    signal: AbortSignal;
  }): Promise<Uint8Array>;
  extract(
    bytes: Uint8Array,
    filename: string,
    fileType: string,
    signal: AbortSignal,
  ): Promise<UploadExtractionResult>;
  extractWithSource?(
    bytes: Uint8Array,
    filename: string,
    fileType: string,
    signal: AbortSignal,
  ): Promise<SourceUploadExtractionResult>;
  extractWithSourceV3?(
    bytes: Uint8Array,
    filename: string,
    fileType: string,
    signal: AbortSignal,
  ): Promise<SourceUploadExtractionResultV3>;
}

/** Existing RPC snapshot adapter shared with the entry point; absent means v1. */
export function parseUploadExtractionSnapshot(
  value: unknown,
): UploadExtractionSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const version = record.extraction_contract_version;
  if (
    Object.hasOwn(record, "extraction_contract_version") &&
    version !== UPLOAD_EXTRACTION_CONTRACT_V1 &&
    version !== UPLOAD_EXTRACTION_CONTRACT_V2 &&
    version !== UPLOAD_EXTRACTION_CONTRACT_V3
  ) return null;
  // Preserve historical conversion while requiring v3's explicitly typed RPC fields.
  const stringKeys = [
    "upload_id",
    "user_id",
    "request_sha256",
    "claim_token",
    "storage_path",
    "filename",
    "file_type",
    "content_sha256",
  ];
  const v3Keys = [
    ...stringKeys,
    "byte_length",
    "stage",
    "extraction_contract_version",
  ];
  if (
    version === UPLOAD_EXTRACTION_CONTRACT_V3 && (
      Object.keys(record).length !== v3Keys.length || v3Keys.some((key) =>
        !Object.hasOwn(record, key)
      ) ||
      stringKeys.some((key) => typeof record[key] !== "string") ||
      typeof record.byte_length !== "number" ||
      (record.stage !== "storage_completed" &&
        record.stage !== "provider_dispatched")
    )
  ) return null;
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
    ...(version === UPLOAD_EXTRACTION_CONTRACT_V1 ||
        version === UPLOAD_EXTRACTION_CONTRACT_V2 ||
        version === UPLOAD_EXTRACTION_CONTRACT_V3
      ? { extractionContractVersion: version }
      : {}),
  };
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  retryable: boolean,
): Response {
  return jsonResponse({ error: { code, message }, retryable }, status, null);
}

function cancelledResponse(): Response {
  return errorResponse(
    503,
    "UPLOAD_EXTRACTION_CANCELLED",
    "Reading this upload was cancelled. You can retry this exact upload.",
    true,
  );
}

function sourceConflictResponse(): Response {
  return errorResponse(
    409,
    "UPLOAD_EXTRACTION_SOURCE_CONFLICT",
    "The retained original no longer matches the accepted upload.",
    false,
  );
}

async function digestBytes(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)),
  );
}

async function secureEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    digestBytes(encoder.encode(left)),
    digestBytes(encoder.encode(right)),
  ]);
  let difference = left.length ^ right.length;
  for (let index = 0; index < leftDigest.byteLength; index += 1) {
    difference |= leftDigest[index]! ^ rightDigest[index]!;
  }
  return difference === 0;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(await digestBytes(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

class InternalRequestTimeout extends Error {}

async function readBoundedJson(req: Request): Promise<unknown> {
  if (!req.body) throw new Error("INTERNAL_REQUEST_INVALID");
  const reader = req.body.getReader();
  const bytes = new Uint8Array(MAX_INTERNAL_REQUEST_BYTES);
  let total = 0;
  let chunkCount = 0;
  let finished = false;
  const deadline = Date.now() + INTERNAL_REQUEST_TIMEOUT_MS;
  const interrupted = Promise.withResolvers<never>();
  // Retain a rejection observer even when an early validation failure wins.
  void interrupted.promise.catch(() => {});
  const onAbort = () =>
    interrupted.reject(new Error("INTERNAL_REQUEST_CANCELLED"));
  req.signal.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(
    () => interrupted.reject(new InternalRequestTimeout()),
    INTERNAL_REQUEST_TIMEOUT_MS,
  );
  const assertBudget = () => {
    if (req.signal.aborted) throw new Error("INTERNAL_REQUEST_CANCELLED");
    if (Date.now() >= deadline) throw new InternalRequestTimeout();
  };
  try {
    assertBudget();
    const contentLength = req.headers.get("content-length");
    if (
      contentLength !== null &&
      (!/^\d+$/.test(contentLength) ||
        Number(contentLength) > MAX_INTERNAL_REQUEST_BYTES)
    ) throw new Error("INTERNAL_REQUEST_INVALID");
    while (true) {
      assertBudget();
      // Promise.race observes both settlements, including a late read rejection.
      const { done, value } = await Promise.race([
        reader.read(),
        interrupted.promise,
      ]);
      assertBudget();
      if (done) {
        finished = true;
        break;
      }
      chunkCount++;
      if (
        !(value instanceof Uint8Array) ||
        chunkCount > MAX_INTERNAL_REQUEST_BYTES ||
        value.byteLength > MAX_INTERNAL_REQUEST_BYTES - total
      ) {
        throw new Error("INTERNAL_REQUEST_INVALID");
      }
      bytes.set(value, total);
      total += value.byteLength;
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, total),
      ),
    );
  } finally {
    clearTimeout(timeout);
    req.signal.removeEventListener("abort", onAbort);
    if (!finished) {
      try {
        // Cleanup must not delay or replace the already selected safe response.
        void reader.cancel("INTERNAL_REQUEST_READ_ABANDONED").catch(() => {});
      } catch { /* Preserve the original error if cleanup cannot start. */ }
    }
    reader.releaseLock();
  }
}

function parseInput(value: unknown): ExtractUploadInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INTERNAL_REQUEST_INVALID");
  }
  const record = value as Record<string, unknown>;
  const sourceContract = Object.hasOwn(record, "extraction_contract_version");
  if (
    sourceContract &&
    record.extraction_contract_version !== UPLOAD_EXTRACTION_CONTRACT_V2 &&
    record.extraction_contract_version !== UPLOAD_EXTRACTION_CONTRACT_V3
  ) {
    throw new Error("INTERNAL_REQUEST_INVALID");
  }
  const expectedKeys = [
    "claim_token",
    "request_sha256",
    "upload_id",
    "user_id",
    ...(sourceContract ? ["extraction_contract_version"] : []),
  ].sort();
  const actualKeys = Object.keys(record).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) throw new Error("INTERNAL_REQUEST_INVALID");

  const input = record as unknown as ExtractUploadInput;
  if (
    typeof input.upload_id !== "string" ||
    !UUID_PATTERN.test(input.upload_id) ||
    typeof input.user_id !== "string" || !UUID_PATTERN.test(input.user_id) ||
    typeof input.request_sha256 !== "string" ||
    !SHA256_PATTERN.test(input.request_sha256) ||
    typeof input.claim_token !== "string" ||
    !UUID_PATTERN.test(input.claim_token)
  ) throw new Error("INTERNAL_REQUEST_INVALID");
  return input;
}

function snapshotIsValid(
  snapshot: UploadExtractionSnapshot,
  input: ExtractUploadInput,
): boolean {
  return snapshot.uploadId === input.upload_id &&
    snapshot.userId === input.user_id &&
    snapshot.requestSha256 === input.request_sha256 &&
    snapshot.claimToken === input.claim_token &&
    (snapshot.extractionContractVersion === undefined
        ? UPLOAD_EXTRACTION_CONTRACT_V1
        : snapshot.extractionContractVersion) ===
      (input.extraction_contract_version ?? UPLOAD_EXTRACTION_CONTRACT_V1) &&
    ["storage_completed", "provider_dispatched"].includes(snapshot.stage) &&
    snapshot.storagePath.startsWith(
      `${snapshot.userId}/${snapshot.uploadId}/`,
    ) &&
    snapshot.storagePath.length <= 800 &&
    !snapshot.storagePath.includes("\\") &&
    snapshot.storagePath.split("/").every((part) =>
      Boolean(part) && part !== "." && part !== ".."
    ) &&
    Boolean(snapshot.filename.trim()) && snapshot.filename.length <= 300 &&
    snapshot.fileType.length <= 200 &&
    Number.isSafeInteger(snapshot.byteLength) && snapshot.byteLength >= 0 &&
    snapshot.byteLength <= MAX_UPLOAD_BYTES &&
    SHA256_PATTERN.test(snapshot.contentSha256);
}

function boundedLegacyFileType(fileType: string, filename: string): string {
  const normalized = fileType.normalize("NFKC").trim().toLowerCase();
  const filenameExtension = filename.normalize("NFKC").trim().toLowerCase()
    .split(".").at(-1) ?? "";
  if (
    [
      "",
      "unknown",
      "application/octet-stream",
      "binary/octet-stream",
    ].includes(normalized)
  ) return "application/octet-stream";
  if (normalized.includes("/")) return normalized;
  if (
    normalized === filenameExtension &&
    ["pdf", "docx", "xlsx", "txt", "md", "csv"].includes(normalized)
  ) return "application/octet-stream";
  return normalized;
}

export async function handleExtractUpload(
  req: Request,
  dependencies: UploadExtractorDependencies,
): Promise<Response> {
  if (req.method !== "POST") {
    return errorResponse(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed.",
      false,
    );
  }
  const authorization = req.headers.get("authorization") ?? "";
  const apiKey = req.headers.get("apikey") ?? "";
  const suppliedBearer = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (
    !dependencies.serviceRoleKey ||
    !(await secureEqual(suppliedBearer, dependencies.serviceRoleKey)) ||
    !(await secureEqual(apiKey, dependencies.serviceRoleKey))
  ) {
    return errorResponse(
      401,
      "INTERNAL_AUTH_REQUIRED",
      "This internal operation is not available to browser callers.",
      false,
    );
  }

  let input: ExtractUploadInput;
  try {
    input = parseInput(await readBoundedJson(req));
  } catch (error) {
    if (req.signal.aborted) return cancelledResponse();
    if (error instanceof InternalRequestTimeout) {
      return errorResponse(
        503,
        "UPLOAD_EXTRACTION_TIMEOUT",
        "The document reader did not receive the complete request in time. Please retry this exact upload.",
        true,
      );
    }
    return errorResponse(
      400,
      "INTERNAL_REQUEST_INVALID",
      "The internal extraction request is invalid.",
      false,
    );
  }

  let snapshot: UploadExtractionSnapshot | null;
  try {
    snapshot = await dependencies.loadSnapshot({
      uploadId: input.upload_id,
      userId: input.user_id,
      requestSha256: input.request_sha256,
      claimToken: input.claim_token,
    });
  } catch {
    return errorResponse(
      503,
      "UPLOAD_EXTRACTION_SNAPSHOT_UNAVAILABLE",
      "TED could not verify the accepted upload before extraction.",
      true,
    );
  }
  if (!snapshot || !snapshotIsValid(snapshot, input)) {
    return errorResponse(
      409,
      "UPLOAD_EXTRACTION_CLAIM_CONFLICT",
      "This extraction claim is stale or no longer matches the accepted upload.",
      false,
    );
  }
  // Own the accepted primitive metadata across Storage, parser and digest awaits.
  snapshot = { ...snapshot };
  const sourceContract =
    input.extraction_contract_version === UPLOAD_EXTRACTION_CONTRACT_V2 ||
    input.extraction_contract_version === UPLOAD_EXTRACTION_CONTRACT_V3;
  const sourceExtractor =
    input.extraction_contract_version === UPLOAD_EXTRACTION_CONTRACT_V3
      ? dependencies.extractWithSourceV3
      : dependencies.extractWithSource;
  if (sourceContract && !sourceExtractor) {
    return errorResponse(
      503,
      "UPLOAD_EXTRACTION_VERSION_UNAVAILABLE",
      "TED cannot safely read this accepted upload version right now. Please retry this exact upload.",
      true,
    );
  }
  if (req.signal.aborted) return cancelledResponse();
  if (snapshot.byteLength === 0) {
    return errorResponse(
      422,
      "UPLOAD_FILE_EMPTY",
      "The uploaded file is empty.",
      false,
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await dependencies.readOriginal({
      storagePath: snapshot.storagePath,
      maximumBytes: snapshot.byteLength,
      signal: req.signal,
    });
  } catch (error) {
    if (req.signal.aborted) return cancelledResponse();
    if (
      error instanceof PrivateStorageObjectError &&
      ["conflict", "not_found", "too_large"].includes(error.kind)
    ) {
      return errorResponse(
        409,
        "UPLOAD_EXTRACTION_SOURCE_CONFLICT",
        "The retained original no longer matches the accepted upload.",
        false,
      );
    }
    if (
      error instanceof PrivateStorageObjectError &&
      error.kind === "configuration"
    ) {
      return errorResponse(
        503,
        "UPLOAD_EXTRACTION_CONFIGURATION_UNAVAILABLE",
        "TED cannot safely access the retained original right now.",
        true,
      );
    }
    return errorResponse(
      503,
      "UPLOAD_EXTRACTION_SOURCE_UNAVAILABLE",
      "TED could not reload the retained original for safe extraction.",
      true,
    );
  }
  if (req.signal.aborted) return cancelledResponse();
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.buffer instanceof SharedArrayBuffer ||
    bytes.byteLength !== snapshot.byteLength
  ) {
    return sourceConflictResponse();
  }
  try {
    // Retain one owned original before the first hash await. A Storage adapter
    // alias must not replace the bytes subsequently supplied to the parser.
    bytes = Uint8Array.from(bytes);
    const actualSha256 = await sha256(bytes);
    if (req.signal.aborted) return cancelledResponse();
    if (actualSha256 !== snapshot.contentSha256) {
      return sourceConflictResponse();
    }
  } catch {
    if (req.signal.aborted) return cancelledResponse();
    return errorResponse(
      503,
      "UPLOAD_EXTRACTION_SOURCE_UNAVAILABLE",
      "TED could not verify the retained original for safe extraction. Please retry this exact upload.",
      true,
    );
  }

  try {
    if (sourceContract) {
      const deadline = Date.now() + 30_000;
      const result = await sourceExtractor!(
        bytes,
        snapshot.filename,
        boundedLegacyFileType(snapshot.fileType, snapshot.filename),
        req.signal,
      );
      if (req.signal.aborted) return cancelledResponse();
      try {
        if (
          input.extraction_contract_version === UPLOAD_EXTRACTION_CONTRACT_V3
        ) {
          assertUploadFormatMetadataV3(
            result.format,
            snapshot.filename,
            boundedLegacyFileType(snapshot.fileType, snapshot.filename),
          );
        } else if (result.format === "rtf") {
          throw new UploadExtractionError(
            503,
            "UPLOAD_EXTRACTION_RESPONSE_INVALID",
            "The reader returned an unexpected file format.",
            true,
          );
        } else {assertUploadFormatMetadata(
            result.format,
            snapshot.filename,
            boundedLegacyFileType(snapshot.fileType, snapshot.filename),
          );}
      } catch (error) {
        if (!(error instanceof UploadExtractionError)) throw error;
        return errorResponse(
          503,
          "UPLOAD_EXTRACTION_RESPONSE_INVALID",
          "TED received an inconsistent result from the document reader. Please retry this exact upload.",
          true,
        );
      }
      const envelope = {
        upload_id: snapshot.uploadId,
        user_id: snapshot.userId,
        request_sha256: snapshot.requestSha256,
        claim_token: snapshot.claimToken,
        content_sha256: snapshot.contentSha256,
        content_byte_length: snapshot.byteLength,
        extraction_contract_version: input.extraction_contract_version,
        text: result.text,
        format: result.format,
        truncated: result.truncated,
        resource_policy_version: result.resourcePolicyVersion,
        source_manifest: result.sourceManifest,
      };
      const accepted = {
        uploadId: snapshot.uploadId,
        userId: snapshot.userId,
        requestSha256: snapshot.requestSha256,
        claimToken: snapshot.claimToken,
        expectedContentSha256: snapshot.contentSha256,
        expectedByteLength: snapshot.byteLength,
      };
      const verified =
        input.extraction_contract_version === UPLOAD_EXTRACTION_CONTRACT_V3
          ? await normalizeSourceExtractionResponseV3(
            {
              ...accepted,
              extractionContractVersion: UPLOAD_EXTRACTION_CONTRACT_V3,
            },
            envelope,
            req.signal,
            deadline,
          )
          : await normalizeSourceExtractionResponse(
            {
              ...accepted,
              extractionContractVersion: UPLOAD_EXTRACTION_CONTRACT_V2,
            },
            envelope,
            req.signal,
            deadline,
          );
      if (req.signal.aborted || Date.now() >= deadline) {
        throw new UploadExtractionError(
          503,
          "UPLOAD_EXTRACTION_RESOURCE_UNAVAILABLE",
          "TED could not safely finish reading that file right now. Please retry this exact upload.",
          true,
        );
      }
      // Publish the owned verified manifest, never a producer object that can
      // change while its digest is checked. All other envelope fields are scalars.
      return jsonResponse(
        { ...envelope, source_manifest: verified.sourceManifest },
        200,
        null,
      );
    }
    const result = await dependencies.extract(
      bytes,
      snapshot.filename,
      boundedLegacyFileType(snapshot.fileType, snapshot.filename),
      req.signal,
    );
    if (req.signal.aborted) return cancelledResponse();
    return jsonResponse(
      {
        upload_id: snapshot.uploadId,
        user_id: snapshot.userId,
        request_sha256: snapshot.requestSha256,
        claim_token: snapshot.claimToken,
        content_sha256: snapshot.contentSha256,
        text: result.text,
        format: result.format,
        truncated: result.truncated,
        resource_policy_version: result.resourcePolicyVersion,
      },
      200,
      null,
    );
  } catch (error) {
    if (req.signal.aborted) return cancelledResponse();
    if (error instanceof UploadExtractionError) {
      return errorResponse(
        error.status,
        error.code,
        error.publicMessage,
        error.retryable,
      );
    }
    return errorResponse(
      503,
      "UPLOAD_EXTRACTION_UNAVAILABLE",
      "TED could not safely extract that file right now. Please try again.",
      true,
    );
  }
}
