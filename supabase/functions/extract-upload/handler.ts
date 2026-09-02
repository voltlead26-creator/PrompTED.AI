import { jsonResponse } from "../_shared/cors.ts";
import { PrivateStorageObjectError } from "../_shared/private-storage-object.ts";
import {
  MAX_UPLOAD_BYTES,
  UploadExtractionError,
  type UploadExtractionResult,
} from "../_shared/upload-extraction.ts";

const MAX_INTERNAL_REQUEST_BYTES = 4_096;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

interface ExtractUploadInput {
  upload_id: string;
  user_id: string;
  request_sha256: string;
  claim_token: string;
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
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  retryable: boolean,
): Response {
  return jsonResponse({ error: { code, message }, retryable }, status, null);
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

async function readBoundedJson(req: Request): Promise<unknown> {
  const contentLength = req.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) ||
      Number(contentLength) > MAX_INTERNAL_REQUEST_BYTES)
  ) throw new Error("INTERNAL_REQUEST_INVALID");
  if (!req.body) throw new Error("INTERNAL_REQUEST_INVALID");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_INTERNAL_REQUEST_BYTES) {
        await reader.cancel("INTERNAL_REQUEST_TOO_LARGE");
        throw new Error("INTERNAL_REQUEST_INVALID");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function parseInput(value: unknown): ExtractUploadInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INTERNAL_REQUEST_INVALID");
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = [
    "claim_token",
    "request_sha256",
    "upload_id",
    "user_id",
  ];
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
  } catch {
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
  if (
    bytes.byteLength !== snapshot.byteLength ||
    await sha256(bytes) !== snapshot.contentSha256
  ) {
    return errorResponse(
      409,
      "UPLOAD_EXTRACTION_SOURCE_CONFLICT",
      "The retained original no longer matches the accepted upload.",
      false,
    );
  }

  try {
    const result = await dependencies.extract(
      bytes,
      snapshot.filename,
      boundedLegacyFileType(snapshot.fileType, snapshot.filename),
      req.signal,
    );
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
