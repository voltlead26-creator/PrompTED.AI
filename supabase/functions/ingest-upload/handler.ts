// deno-lint-ignore-file no-import-prefix no-unversioned-import
import { decodeBase64 } from "jsr:@std/encoding/base64";
import type { AuthContext } from "../_shared/auth-guard.ts";
import { jsonResponse } from "../_shared/cors.ts";
import { setModelCallRequestIdentity } from "../_shared/model-call-context.ts";
import {
  PrivateStorageObjectError,
  privateStorageRuntime,
  requestPrivateStorageObject,
} from "../_shared/private-storage-object.ts";
import {
  MAX_EXTRACTED_TEXT_CHARS,
  MAX_UPLOAD_BYTES,
  UPLOAD_RESOURCE_POLICY_VERSION,
} from "../_shared/upload-extraction-contract.ts";
import {
  IsolatedUploadExtractionError,
  type IsolatedUploadExtractionInput,
  type IsolatedUploadExtractionResult,
  requestIsolatedUploadExtraction,
} from "../_shared/upload-extraction-client.ts";
import {
  type ProviderRequest,
  routeRequest,
} from "../_shared/provider-router.ts";

interface IngestBody {
  upload_id?: string;
  request_id?: string;
  filename?: string;
  mime?: string;
  content_base64?: string;
  note?: string;
  situation_text?: string;
}

export interface IngestClaimInput {
  uploadId: string;
  userId: string;
  storagePath: string;
  filename: string;
  mime: string;
  byteLength: number;
  requestSha256: string;
  contentSha256: string;
}

export type IngestTerminalStatus =
  | "completed"
  | "failed"
  | "reconciliation_required";
export type IngestActiveStage =
  | "prepared"
  | "storage_dispatched"
  | "storage_completed"
  | "provider_dispatched";

export type IngestClaim =
  | {
    outcome: "accepted" | "resumed";
    stage: IngestActiveStage;
    claimToken: string;
  }
  | { outcome: "processing"; stage?: IngestActiveStage }
  | { outcome: "conflict" }
  | {
    outcome: IngestTerminalStatus;
    httpStatus?: number;
    response?: Record<string, unknown>;
  };

export interface IngestSettlement {
  uploadId: string;
  userId: string;
  requestSha256: string;
  ingestStatus: IngestTerminalStatus;
  httpStatus: number;
  response: Record<string, unknown>;
  extractedText: string | null;
  extractedPayload: Record<string, unknown>;
  errorCode: string | null;
  claimToken: string;
}

export interface IngestExtractionIdentity {
  uploadId: string;
  userId: string;
  requestSha256: string;
  claimToken: string;
}

export interface IngestExtractionAdmission {
  outcome: "accepted" | "checkpoint_exists";
  attemptForClaim: number;
  totalAttempts: number;
  retryAfterSeconds: number;
}

export interface IngestStore {
  claim(input: IngestClaimInput): Promise<IngestClaim>;
  advance(input: {
    uploadId: string;
    userId: string;
    requestSha256: string;
    claimToken: string;
    expectedStage: IngestActiveStage;
    nextStage: IngestActiveStage;
  }): Promise<void>;
  retainOriginal(
    input: {
      storagePath: string;
      mime: string;
      bytes: Uint8Array;
      signal: AbortSignal;
    },
  ): Promise<void>;
  readRetainedOriginal(
    input: {
      storagePath: string;
      expectedContentSha256: string;
      signal: AbortSignal;
    },
  ): Promise<Uint8Array>;
  beginExtraction(
    input: IngestExtractionIdentity,
  ): Promise<IngestExtractionAdmission>;
  loadExtraction(
    input: IngestExtractionIdentity,
  ): Promise<IsolatedUploadExtractionResult | null>;
  recordExtraction(
    input: IngestExtractionIdentity & {
      extraction: IsolatedUploadExtractionResult;
    },
  ): Promise<void>;
  settle(input: IngestSettlement): Promise<void>;
}

export interface IngestDependencies {
  store: IngestStore;
  allowLegacyMissingIdentity: boolean;
  recordLegacyIdentityAdapter(): void;
  setRequestIdentity(signal: AbortSignal, requestId: string): void;
  extractText(
    input: IsolatedUploadExtractionInput,
  ): Promise<IsolatedUploadExtractionResult>;
  classify(request: ProviderRequest): Promise<{
    text: string;
    structured?: Record<string, unknown>;
  }>;
}

const MAX_BYTES = MAX_UPLOAD_BYTES;
const MAX_CHARS = 20_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export { requestPrivateStorageObject } from "../_shared/private-storage-object.ts";
const INGEST_CLASSIFICATION_SCHEMA = {
  name: "prompted_ingest_classification",
  version: "ingest-classification.1",
  schema: {
    type: "object",
    properties: {
      document_type: { type: "string" },
      purpose: { type: "string" },
      sections: {
        type: "array",
        maxItems: 12,
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            items: {
              type: "array",
              maxItems: 12,
              items: { type: "string" },
            },
          },
          required: ["title", "items"],
          additionalProperties: false,
        },
      },
    },
    required: ["document_type", "purpose", "sections"],
    additionalProperties: false,
  },
} as const;

class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super("INGEST_REQUEST_INVALID");
  }
}

function extOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index + 1).toLowerCase();
}

function safeFilename(name: string): string {
  return (
    name
      .normalize("NFKC")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 180) || "document"
  );
}

function errorBody(code: string, message: string): Record<string, unknown> {
  return { error: { code, message } };
}

function requestError(
  status: number,
  code: string,
  message: string,
): RequestError {
  return new RequestError(status, errorBody(code, message));
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function uuidV8FromSha256(digest: string): string {
  const variant = ((Number.parseInt(digest[16]!, 16) & 0x3) | 0x8).toString(16);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `8${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

export async function deriveUploadRequestIdentity(input: {
  userId: string;
  filename: string;
  mime: string;
  bytes: Uint8Array;
  situationText: string;
}): Promise<{
  uploadId: string;
  requestSha256: string;
  contentSha256: string;
  filename: string;
  mime: string;
  situationText: string;
}> {
  const filename = input.filename.normalize("NFKC").trim().slice(0, 300);
  const mime = input.mime.normalize("NFKC").trim().toLowerCase().slice(0, 200);
  const situationText = input.situationText.normalize("NFKC").trim();
  if (
    !UUID_PATTERN.test(input.userId) ||
    !filename ||
    input.bytes.byteLength > MAX_BYTES ||
    situationText.length > 30_000
  ) {
    throw requestError(
      400,
      "UPLOAD_METADATA_INVALID",
      "The upload file metadata is invalid.",
    );
  }
  const contentSha256 = await sha256(input.bytes);
  const request = {
    contract: "ingest-upload.request.v1",
    filename,
    mime,
    byte_length: input.bytes.byteLength,
    content_sha256: contentSha256,
    situation_text: situationText,
  };
  const requestSha256 = await sha256(
    new TextEncoder().encode(JSON.stringify(request)),
  );
  const identitySha256 = await sha256(
    new TextEncoder().encode(
      JSON.stringify({
        contract: "ingest-upload.identity.v1",
        user_id: input.userId,
        request,
      }),
    ),
  );
  return {
    uploadId: uuidV8FromSha256(identitySha256),
    requestSha256,
    contentSha256,
    filename,
    mime,
    situationText,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactPositiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

async function normalizeExtractionCheckpoint(
  value: unknown,
): Promise<IsolatedUploadExtractionResult | null> {
  if (value === null) return null;
  const record = asRecord(value);
  if (
    !record ||
    !hasExactKeys(record, [
      "content_sha256",
      "format",
      "resource_policy_version",
      "text",
      "text_sha256",
      "truncated",
    ]) ||
    typeof record.content_sha256 !== "string" ||
    !SHA256_PATTERN.test(record.content_sha256) ||
    typeof record.text_sha256 !== "string" ||
    !SHA256_PATTERN.test(record.text_sha256) ||
    typeof record.text !== "string" ||
    !record.text.trim() ||
    record.text.length > MAX_EXTRACTED_TEXT_CHARS ||
    !["pdf", "docx", "xlsx", "text"].includes(String(record.format)) ||
    typeof record.truncated !== "boolean" ||
    record.resource_policy_version !== UPLOAD_RESOURCE_POLICY_VERSION
  ) throw new Error("UPLOAD_EXTRACTION_CHECKPOINT_INVALID");
  if (
    await sha256(new TextEncoder().encode(record.text)) !== record.text_sha256
  ) throw new Error("UPLOAD_EXTRACTION_CHECKPOINT_INVALID");
  return {
    contentSha256: record.content_sha256,
    text: record.text,
    format: record.format as IsolatedUploadExtractionResult["format"],
    truncated: record.truncated,
    resourcePolicyVersion: UPLOAD_RESOURCE_POLICY_VERSION,
  };
}

function sameExtraction(
  left: IsolatedUploadExtractionResult,
  right: IsolatedUploadExtractionResult,
): boolean {
  return left.contentSha256 === right.contentSha256 &&
    left.text === right.text && left.format === right.format &&
    left.truncated === right.truncated &&
    left.resourcePolicyVersion === right.resourcePolicyVersion;
}

function createStore(auth: AuthContext): IngestStore {
  return {
    async claim(input) {
      const { data, error } = await auth.admin.rpc("claim_upload_ingest", {
        p_upload_id: input.uploadId,
        p_user_id: input.userId,
        p_storage_path: input.storagePath,
        p_file_type: input.mime,
        p_file_name: input.filename,
        p_file_size_bytes: input.byteLength,
        p_request_sha256: input.requestSha256,
        p_content_sha256: input.contentSha256,
      });
      if (error) throw new Error("UPLOAD_CLAIM_FAILED");
      const receipt = asRecord(data);
      const outcome = String(receipt?.outcome ?? "");
      if (["accepted", "resumed"].includes(outcome)) {
        const stage = String(receipt?.stage ?? "") as IngestActiveStage;
        const claimToken = String(receipt?.claim_token ?? "");
        if (
          !UUID_PATTERN.test(claimToken) || ![
            "prepared",
            "storage_dispatched",
            "storage_completed",
            "provider_dispatched",
          ].includes(stage)
        ) throw new Error("UPLOAD_CLAIM_INVALID");
        return { outcome, stage, claimToken } as IngestClaim;
      }
      if (outcome === "processing") {
        return {
          outcome,
          stage: String(receipt?.stage ?? "") as IngestActiveStage,
        };
      }
      if (outcome === "conflict") {
        return { outcome };
      }
      if (
        ["completed", "failed", "reconciliation_required"].includes(outcome)
      ) {
        const response = asRecord(receipt?.response) ?? undefined;
        const httpStatus = Number(receipt?.http_status);
        return {
          outcome,
          response,
          httpStatus: Number.isInteger(httpStatus) ? httpStatus : undefined,
        } as IngestClaim;
      }
      throw new Error("UPLOAD_CLAIM_INVALID");
    },
    async advance(input) {
      const args = {
        p_upload_id: input.uploadId,
        p_user_id: input.userId,
        p_request_sha256: input.requestSha256,
        p_claim_token: input.claimToken,
        p_expected_stage: input.expectedStage,
        p_next_stage: input.nextStage,
      };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { data, error } = await auth.admin.rpc(
          "advance_upload_ingest",
          args,
        );
        const receipt = asRecord(data);
        if (
          !error && ["advanced", "idempotent_replay"].includes(
            String(receipt?.outcome ?? ""),
          ) && receipt?.stage === input.nextStage
        ) return;
      }
      throw new Error("UPLOAD_ADVANCE_FAILED");
    },
    async retainOriginal(input) {
      const runtime = privateStorageRuntime();
      await requestPrivateStorageObject({
        ...runtime,
        bucket: "original-documents",
        path: input.storagePath,
        method: "POST",
        bytes: input.bytes,
        contentType: input.mime || "application/octet-stream",
        maximumResponseBytes: 0,
        signal: input.signal,
      });
    },
    async readRetainedOriginal(input) {
      const runtime = privateStorageRuntime();
      const retained = await requestPrivateStorageObject({
        ...runtime,
        bucket: "original-documents",
        path: input.storagePath,
        method: "GET",
        maximumResponseBytes: MAX_BYTES,
        signal: input.signal,
      });
      if (!retained) throw new Error("ORIGINAL_STORAGE_READ_UNRESOLVED");
      if (await sha256(retained) !== input.expectedContentSha256) {
        throw new PrivateStorageObjectError(
          "conflict",
          "ORIGINAL_STORAGE_HASH_CONFLICT",
        );
      }
      return retained;
    },
    async beginExtraction(input) {
      const { data, error } = await auth.admin.rpc(
        "begin_upload_extraction_attempt",
        {
          p_upload_id: input.uploadId,
          p_user_id: input.userId,
          p_request_sha256: input.requestSha256,
          p_claim_token: input.claimToken,
        },
      );
      const receipt = asRecord(data);
      const outcome = String(receipt?.outcome ?? "");
      const attemptForClaim = exactPositiveInteger(
        receipt?.attempt_for_claim,
      );
      const totalAttempts = exactPositiveInteger(receipt?.total_attempts);
      const retryAfterSeconds = outcome === "checkpoint_exists"
        ? 0
        : exactPositiveInteger(receipt?.retry_after_seconds);
      if (
        error || !["accepted", "checkpoint_exists"].includes(outcome) ||
        attemptForClaim === null || totalAttempts === null ||
        retryAfterSeconds === null || retryAfterSeconds > 120
      ) throw new Error("UPLOAD_EXTRACTION_ATTEMPT_FAILED");
      return {
        outcome: outcome as IngestExtractionAdmission["outcome"],
        attemptForClaim,
        totalAttempts,
        retryAfterSeconds,
      };
    },
    async loadExtraction(input) {
      const { data, error } = await auth.admin.rpc(
        "get_upload_extraction_checkpoint",
        {
          p_upload_id: input.uploadId,
          p_user_id: input.userId,
          p_request_sha256: input.requestSha256,
          p_claim_token: input.claimToken,
        },
      );
      if (error) throw new Error("UPLOAD_EXTRACTION_CHECKPOINT_READ_FAILED");
      return await normalizeExtractionCheckpoint(data);
    },
    async recordExtraction(input) {
      const extractedTextSha256 = await sha256(
        new TextEncoder().encode(input.extraction.text),
      );
      const args = {
        p_upload_id: input.uploadId,
        p_user_id: input.userId,
        p_request_sha256: input.requestSha256,
        p_claim_token: input.claimToken,
        p_content_sha256: input.extraction.contentSha256,
        p_extracted_text_sha256: extractedTextSha256,
        p_extracted_text: input.extraction.text,
        p_format: input.extraction.format,
        p_truncated: input.extraction.truncated,
        p_policy_version: input.extraction.resourcePolicyVersion,
      };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { data, error } = await auth.admin.rpc(
          "record_upload_extraction_snapshot",
          args,
        );
        const receipt = asRecord(data);
        if (
          !error && ["recorded", "idempotent_replay"].includes(
            String(receipt?.outcome ?? ""),
          )
        ) return;
      }
      throw new Error("UPLOAD_EXTRACTION_CHECKPOINT_WRITE_FAILED");
    },
    async settle(input) {
      const args = {
        p_upload_id: input.uploadId,
        p_user_id: input.userId,
        p_request_sha256: input.requestSha256,
        p_ingest_status: input.ingestStatus,
        p_http_status: input.httpStatus,
        p_response: input.response,
        p_extracted_text: input.extractedText,
        p_extracted_payload: input.extractedPayload,
        p_error_code: input.errorCode,
        p_claim_token: input.claimToken,
      };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { data, error } = await auth.admin.rpc(
          "settle_upload_ingest",
          args,
        );
        const receipt = asRecord(data);
        if (
          !error && ["settled", "idempotent_replay"].includes(
            String(receipt?.outcome ?? ""),
          )
        ) return;
      }
      throw new Error("UPLOAD_SETTLEMENT_FAILED");
    },
  };
}

function defaultDependencies(auth: AuthContext): IngestDependencies {
  return {
    store: createStore(auth),
    allowLegacyMissingIdentity:
      Deno.env.get("PROMPTED_LEGACY_UPLOAD_ID_ADAPTER")?.trim()
        .toLowerCase() !== "disabled",
    recordLegacyIdentityAdapter() {
      console.warn(
        JSON.stringify({
          event: "legacy_upload_request_id_adapter",
          function: "ingest-upload",
          contract: "ingest-upload.identity.v1",
        }),
      );
    },
    setRequestIdentity: setModelCallRequestIdentity,
    extractText: requestIsolatedUploadExtraction,
    classify: routeRequest,
  };
}

async function parseInput(
  req: Request,
  auth: AuthContext,
): Promise<{
  suppliedIdentities: string[];
  filename: string;
  mime: string;
  bytes: Uint8Array;
  situationText: string;
}> {
  const suppliedIdentities = [
    req.headers.get("x-idempotency-key") ?? "",
    req.headers.get("x-request-id") ?? "",
  ];
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  let filename = "upload";
  let mime = "";
  let situationText = "";
  let bytes: Uint8Array;

  if (contentType.includes("multipart/form-data")) {
    const form = auth.multipartBody;
    if (!form) {
      throw requestError(
        400,
        "UPLOAD_MULTIPART_NOT_ADMITTED",
        "The upload form was not admitted by the request guard.",
      );
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw requestError(400, "UPLOAD_FILE_REQUIRED", "file is required");
    }
    if (file.size > MAX_BYTES) {
      throw requestError(
        413,
        "UPLOAD_TOO_LARGE",
        "That file is a bit too big to read. Files need to be 8MB or smaller.",
      );
    }
    for (const field of ["upload_id", "request_id"]) {
      const rawIdentity = form.get(field);
      if (rawIdentity !== null && typeof rawIdentity !== "string") {
        throw requestError(
          400,
          "UPLOAD_REQUEST_ID_INVALID",
          "A valid upload request identity is required.",
        );
      }
      suppliedIdentities.push(String(rawIdentity ?? ""));
    }
    const rawSituation = form.get("situation_text");
    if (rawSituation !== null && typeof rawSituation !== "string") {
      throw requestError(
        400,
        "UPLOAD_SITUATION_INVALID",
        "The upload situation is invalid.",
      );
    }
    situationText = String(rawSituation ?? "")
      .normalize("NFKC")
      .trim();
    filename = String(file.name || "upload");
    mime = String(file.type || "");
    bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    const body = auth.body as IngestBody | null;
    if (!body) {
      throw requestError(
        400,
        "UPLOAD_JSON_NOT_ADMITTED",
        "The upload request was not admitted by the request guard.",
      );
    }
    suppliedIdentities.push(
      String(body?.upload_id ?? ""),
      String(body?.request_id ?? ""),
    );
    filename = String(body?.filename ?? "upload");
    mime = String(body?.mime ?? "");
    situationText = String(body?.situation_text ?? body?.note ?? "")
      .normalize("NFKC")
      .trim();
    const raw = String(body?.content_base64 ?? "").replace(/^data:[^,]*,/, "");
    if (!raw) {
      throw requestError(
        400,
        "UPLOAD_CONTENT_REQUIRED",
        "content_base64 is required",
      );
    }
    if (raw.length > MAX_BYTES * 1.4) {
      throw requestError(
        413,
        "UPLOAD_TOO_LARGE",
        "That file is a bit too big to read. Files need to be 8MB or smaller.",
      );
    }
    try {
      bytes = decodeBase64(raw);
    } catch {
      throw requestError(
        400,
        "UPLOAD_CONTENT_INVALID",
        "The file didn't arrive intact. Please try again.",
      );
    }
    if (bytes.byteLength > MAX_BYTES) {
      throw requestError(
        413,
        "UPLOAD_TOO_LARGE",
        "That file is a bit too big to read. Files need to be 8MB or smaller.",
      );
    }
  }

  const identities = suppliedIdentities
    .map((identity) => identity.trim().toLowerCase())
    .filter(Boolean);
  if (identities.some((identity) => !UUID_PATTERN.test(identity))) {
    throw requestError(
      400,
      "UPLOAD_REQUEST_ID_INVALID",
      "A valid upload request identity is required.",
    );
  }
  if (new Set(identities).size > 1) {
    throw requestError(
      409,
      "UPLOAD_REQUEST_ID_CONFLICT",
      "The upload request identity does not match the request body.",
    );
  }
  return {
    suppliedIdentities: identities,
    filename,
    mime,
    bytes,
    situationText,
  };
}

function terminalReplay(
  claim: Extract<IngestClaim, { outcome: IngestTerminalStatus }>,
  uploadId: string,
  origin: string | null,
): Response {
  const expectedStatus = claim.outcome === "completed"
    ? 200
    : claim.outcome === "reconciliation_required"
    ? 409
    : claim.httpStatus;
  if (
    !claim.response ||
    claim.response.upload_id !== uploadId ||
    !Number.isInteger(claim.httpStatus) ||
    ((claim.httpStatus ?? 0) < 400 && claim.outcome !== "completed") ||
    claim.httpStatus !== expectedStatus
  ) {
    return jsonResponse(
      {
        ...errorBody(
          "UPLOAD_REPLAY_STATE_INVALID",
          "TED found an upload that needs reconciliation before it can be used.",
        ),
        upload_id: uploadId,
      },
      409,
      origin,
    );
  }
  return jsonResponse(claim.response, claim.httpStatus!, origin);
}

function processingReplay(
  uploadId: string,
  stage: IngestActiveStage | undefined,
  origin: string | null,
): Response {
  const response = jsonResponse(
    {
      ...errorBody(
        "UPLOAD_PROCESSING",
        "TED is already processing this exact upload.",
      ),
      upload_id: uploadId,
      classification_status: "processing",
      durable_stage: stage ?? "prepared",
      retryable: true,
      retry_after_seconds: 120,
    },
    409,
    origin,
  );
  response.headers.set("Retry-After", "120");
  return response;
}

async function settleResponse(
  store: IngestStore,
  input: Omit<IngestSettlement, "response" | "httpStatus">,
  response: Record<string, unknown>,
  httpStatus: number,
  origin: string | null,
): Promise<Response> {
  try {
    await store.settle({ ...input, response, httpStatus });
  } catch {
    return jsonResponse(
      {
        ...errorBody(
          "UPLOAD_SETTLEMENT_FAILED",
          "TED could not safely record the upload result. The upload will not be processed again until it is reconciled.",
        ),
        upload_id: input.uploadId,
      },
      503,
      origin,
    );
  }
  return jsonResponse(response, httpStatus, origin);
}

export async function handleIngestUpload(
  req: Request,
  auth: AuthContext,
  dependencies: IngestDependencies = defaultDependencies(auth),
): Promise<Response> {
  const origin = req.headers.get("origin");
  let parsed: Awaited<ReturnType<typeof parseInput>>;
  try {
    parsed = await parseInput(req, auth);
  } catch (error) {
    if (error instanceof RequestError) {
      return jsonResponse(error.body, error.status, origin);
    }
    return jsonResponse(
      errorBody("UPLOAD_REQUEST_INVALID", "The upload request is invalid."),
      400,
      origin,
    );
  }

  let identity: Awaited<ReturnType<typeof deriveUploadRequestIdentity>>;
  try {
    identity = await deriveUploadRequestIdentity({
      userId: auth.userId,
      filename: parsed.filename,
      mime: parsed.mime,
      bytes: parsed.bytes,
      situationText: parsed.situationText,
    });
  } catch (error) {
    if (error instanceof RequestError) {
      return jsonResponse(error.body, error.status, origin);
    }
    return jsonResponse(
      errorBody(
        "UPLOAD_IDENTITY_FAILED",
        "The upload identity could not be verified.",
      ),
      400,
      origin,
    );
  }
  const {
    uploadId,
    requestSha256,
    contentSha256,
    filename,
    mime,
    situationText: _situationText,
  } = identity;
  const bytes = parsed.bytes;
  if (parsed.suppliedIdentities.length === 0) {
    if (!dependencies.allowLegacyMissingIdentity) {
      return jsonResponse(
        errorBody(
          "UPLOAD_REQUEST_ID_REQUIRED",
          "A stable upload request identity is required.",
        ),
        400,
        origin,
      );
    }
    dependencies.recordLegacyIdentityAdapter();
  } else if (parsed.suppliedIdentities[0] !== uploadId) {
    return jsonResponse(
      {
        ...errorBody(
          "UPLOAD_REQUEST_ID_PAYLOAD_MISMATCH",
          "The upload request identity does not match this user and upload payload.",
        ),
        upload_id: uploadId,
      },
      409,
      origin,
    );
  }
  try {
    dependencies.setRequestIdentity(req.signal, uploadId);
  } catch {
    return jsonResponse(
      errorBody(
        "UPLOAD_REQUEST_CONTEXT_FAILED",
        "TED could not establish a safe upload request identity.",
      ),
      500,
      origin,
    );
  }

  const storagePath = `${auth.userId}/${uploadId}/${safeFilename(filename)}`;
  const claimInput: IngestClaimInput = {
    uploadId,
    userId: auth.userId,
    storagePath,
    filename,
    mime: mime || extOf(filename) || "unknown",
    byteLength: bytes.byteLength,
    requestSha256,
    contentSha256,
  };

  let claim: IngestClaim;
  try {
    claim = await dependencies.store.claim(claimInput);
  } catch {
    return jsonResponse(
      errorBody(
        "UPLOAD_CLAIM_FAILED",
        "TED could not safely start this upload. Nothing was processed.",
      ),
      503,
      origin,
    );
  }
  if (claim.outcome === "conflict") {
    return jsonResponse(
      {
        ...errorBody(
          "UPLOAD_REPLAY_CONFLICT",
          "That upload request identity is already bound to different upload data.",
        ),
        upload_id: uploadId,
      },
      409,
      origin,
    );
  }
  if (claim.outcome === "processing") {
    return processingReplay(uploadId, claim.stage, origin);
  }
  if (
    claim.outcome === "completed" || claim.outcome === "failed" ||
    claim.outcome === "reconciliation_required"
  ) {
    return terminalReplay(claim, uploadId, origin);
  }
  if (claim.outcome !== "accepted" && claim.outcome !== "resumed") {
    return jsonResponse(
      errorBody(
        "UPLOAD_CLAIM_INVALID",
        "TED received an invalid durable upload state.",
      ),
      503,
      origin,
    );
  }
  let stage = claim.stage;
  const claimToken = claim.claimToken;

  const advance = async (
    expectedStage: IngestActiveStage,
    nextStage: IngestActiveStage,
  ): Promise<Response | null> => {
    try {
      await dependencies.store.advance({
        uploadId,
        userId: auth.userId,
        requestSha256,
        claimToken,
        expectedStage,
        nextStage,
      });
      stage = nextStage;
      return null;
    } catch {
      return jsonResponse(
        {
          ...errorBody(
            "UPLOAD_STAGE_ACK_UNRESOLVED",
            "TED could not confirm the upload processing stage. It will not repeat an external action until the durable state is resolved.",
          ),
          upload_id: uploadId,
          classification_status: "processing",
        },
        503,
        origin,
      );
    }
  };

  if (stage === "prepared") {
    const dispatchFailure = await advance("prepared", "storage_dispatched");
    if (dispatchFailure) return dispatchFailure;
    let retentionAcknowledged = false;
    try {
      await dependencies.store.retainOriginal({
        storagePath,
        mime,
        bytes,
        signal: req.signal,
      });
      retentionAcknowledged = true;
    } catch {
      // The upload may have committed before its HTTP acknowledgement was
      // lost. Continue only through the exact-path/hash readback below; never
      // issue a second upload for this durable storage-dispatched stage.
    }
    if (retentionAcknowledged) {
      const retentionAckFailure = await advance(
        "storage_dispatched",
        "storage_completed",
      );
      if (retentionAckFailure) return retentionAckFailure;
    }
  }
  if (stage === "storage_dispatched") {
    try {
      await dependencies.store.readRetainedOriginal({
        storagePath,
        expectedContentSha256: contentSha256,
        signal: req.signal,
      });
      const retainedAckFailure = await advance(
        "storage_dispatched",
        "storage_completed",
      );
      if (retainedAckFailure) return retainedAckFailure;
    } catch (error) {
      if (
        error instanceof PrivateStorageObjectError &&
        !["conflict", "not_found", "too_large"].includes(error.kind)
      ) {
        const response = jsonResponse(
          {
            ...errorBody(
              "UPLOAD_RETENTION_READ_UNAVAILABLE",
              "TED could not safely verify the retained original right now. Please retry this exact upload.",
            ),
            upload_id: uploadId,
            classification_status: "processing",
            durable_stage: stage,
            original_retained: null,
            storage_path: storagePath,
            retryable: true,
            retry_after_seconds: 120,
          },
          503,
          origin,
        );
        response.headers.set("Retry-After", "120");
        return response;
      }
      const response = {
        ...errorBody(
          "UPLOAD_RETENTION_RECONCILIATION_REQUIRED",
          "TED could not prove that the retained original exactly matches this upload. It will not upload or classify it again until reconciled.",
        ),
        upload_id: uploadId,
        classification_status: "reconciliation_required",
        original_retained: null,
        storage_status: "unknown",
        storage_path: storagePath,
      };
      return await settleResponse(
        dependencies.store,
        {
          uploadId,
          userId: auth.userId,
          requestSha256,
          claimToken,
          ingestStatus: "reconciliation_required",
          extractedText: null,
          extractedPayload: {
            original_retained: null,
            storage_status: "unknown",
            classification_status: "reconciliation_required",
          },
          errorCode: "UPLOAD_RETENTION_RECONCILIATION_REQUIRED",
        },
        response,
        409,
        origin,
      );
    }
  }

  const extractionIdentity: IngestExtractionIdentity = {
    uploadId,
    userId: auth.userId,
    requestSha256,
    claimToken,
  };
  const checkpointUnavailable = (
    code: string,
    message: string,
  ): Response => {
    const response = jsonResponse(
      {
        ...errorBody(code, message),
        upload_id: uploadId,
        classification_status: "processing",
        durable_stage: stage,
        original_retained: true,
        storage_path: storagePath,
        retryable: true,
        retry_after_seconds: 120,
      },
      503,
      origin,
    );
    response.headers.set("Retry-After", "120");
    return response;
  };
  const reconcileExtraction = async (
    code: string,
    message: string,
  ): Promise<Response> => {
    const response = {
      ...errorBody(code, message),
      upload_id: uploadId,
      classification_status: "reconciliation_required",
      original_retained: null,
      storage_status: "conflict",
      storage_path: storagePath,
    };
    return await settleResponse(
      dependencies.store,
      {
        ...extractionIdentity,
        ingestStatus: "reconciliation_required",
        extractedText: null,
        extractedPayload: {
          original_retained: null,
          storage_status: "conflict",
          classification_status: "reconciliation_required",
        },
        errorCode: code,
      },
      response,
      409,
      origin,
    );
  };

  let extraction: IsolatedUploadExtractionResult | null;
  try {
    extraction = await dependencies.store.loadExtraction(extractionIdentity);
  } catch {
    return checkpointUnavailable(
      "UPLOAD_EXTRACTION_CHECKPOINT_UNAVAILABLE",
      "TED could not safely read the retained extraction state. Please retry this exact upload.",
    );
  }

  let extractedNow = false;
  if (!extraction) {
    if (stage === "provider_dispatched") {
      return await reconcileExtraction(
        "UPLOAD_EXTRACTION_CHECKPOINT_MISSING",
        "TED found provider work without its exact retained extraction. It will not classify the upload again until reconciled.",
      );
    }
    let admission: IngestExtractionAdmission;
    try {
      admission = await dependencies.store.beginExtraction(extractionIdentity);
    } catch {
      return checkpointUnavailable(
        "UPLOAD_EXTRACTION_ATTEMPT_UNAVAILABLE",
        "TED could not safely admit another extraction attempt. Please retry this exact upload after the durable lease expires.",
      );
    }
    if (admission.outcome === "checkpoint_exists") {
      try {
        extraction = await dependencies.store.loadExtraction(
          extractionIdentity,
        );
      } catch {
        return checkpointUnavailable(
          "UPLOAD_EXTRACTION_CHECKPOINT_UNAVAILABLE",
          "TED could not safely read the retained extraction state. Please retry this exact upload.",
        );
      }
      if (!extraction) {
        return checkpointUnavailable(
          "UPLOAD_EXTRACTION_CHECKPOINT_UNAVAILABLE",
          "TED could not confirm the admitted extraction checkpoint. Please retry this exact upload.",
        );
      }
    } else {
      try {
        extraction = await dependencies.extractText({
          ...extractionIdentity,
          signal: req.signal,
        });
        extractedNow = true;
      } catch (error) {
        if (
          error instanceof IsolatedUploadExtractionError &&
          error.code === "UPLOAD_EXTRACTION_CLAIM_CONFLICT"
        ) {
          return processingReplay(uploadId, stage, origin);
        }
        if (
          !(error instanceof IsolatedUploadExtractionError) ||
          error.status === 503 || error.retryable
        ) {
          return checkpointUnavailable(
            error instanceof IsolatedUploadExtractionError
              ? error.code
              : "UPLOAD_EXTRACTION_UNAVAILABLE",
            error instanceof IsolatedUploadExtractionError
              ? error.publicMessage
              : "TED could not safely extract that file right now. Please retry this exact upload.",
          );
        }

        const reconciliationRequired = error.status === 409;
        if (reconciliationRequired) {
          return await reconcileExtraction(error.code, error.publicMessage);
        }
        const response = {
          ...errorBody(error.code, error.publicMessage),
          upload_id: uploadId,
          classification_status: "not_started",
          original_retained: true,
          storage_path: storagePath,
        };
        return await settleResponse(
          dependencies.store,
          {
            ...extractionIdentity,
            ingestStatus: "failed",
            extractedText: null,
            extractedPayload: {
              original_retained: true,
              classification_status: "not_started",
            },
            errorCode: error.code,
          },
          response,
          error.status,
          origin,
        );
      }
    }
  }

  if (!extraction || extraction.contentSha256 !== contentSha256) {
    return await reconcileExtraction(
      "UPLOAD_EXTRACTION_SOURCE_CONFLICT",
      "The retained original no longer matches the accepted upload.",
    );
  }
  const clean = extraction.text
    .split("\u0000")
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  if (!clean) {
    const response = {
      ...errorBody(
        "UPLOAD_TEXT_EMPTY",
        "TED couldn't find readable text in that file. If it's a scan or photo, try a text-based PDF or Word document.",
      ),
      upload_id: uploadId,
      original_retained: true,
      storage_path: storagePath,
      extraction_format: extraction.format,
      resource_policy_version: extraction.resourcePolicyVersion,
    };
    return await settleResponse(
      dependencies.store,
      {
        ...extractionIdentity,
        ingestStatus: "failed",
        extractedText: null,
        extractedPayload: {
          original_retained: true,
          classification_status: "not_started",
          extraction_format: extraction.format,
          resource_policy_version: extraction.resourcePolicyVersion,
        },
        errorCode: "UPLOAD_TEXT_EMPTY",
      },
      response,
      422,
      origin,
    );
  }

  const normalizedExtraction: IsolatedUploadExtractionResult = {
    ...extraction,
    text: clean.slice(0, MAX_CHARS),
    truncated: extraction.truncated || clean.length > MAX_CHARS,
  };
  if (!extractedNow && !sameExtraction(extraction, normalizedExtraction)) {
    return await reconcileExtraction(
      "UPLOAD_EXTRACTION_CHECKPOINT_INVALID",
      "TED found a retained extraction that does not match the current immutable text contract.",
    );
  }
  extraction = normalizedExtraction;
  if (extractedNow) {
    try {
      await dependencies.store.recordExtraction({
        ...extractionIdentity,
        extraction,
      });
    } catch {
      let authoritative: IsolatedUploadExtractionResult | null = null;
      try {
        authoritative = await dependencies.store.loadExtraction(
          extractionIdentity,
        );
      } catch {
        return checkpointUnavailable(
          "UPLOAD_EXTRACTION_CHECKPOINT_UNAVAILABLE",
          "TED could not confirm whether the retained extraction was recorded. It will not dispatch provider work.",
        );
      }
      if (!authoritative || !sameExtraction(authoritative, extraction)) {
        return await reconcileExtraction(
          "UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT",
          "TED found a different retained extraction for this exact upload. It will not dispatch provider work until reconciled.",
        );
      }
      extraction = authoritative;
    }
  }

  const truncated = extraction.truncated;
  const sliced = extraction.text;
  if (stage === "storage_completed") {
    const providerDispatchFailure = await advance(
      "storage_completed",
      "provider_dispatched",
    );
    if (providerDispatchFailure) return providerDispatchFailure;
  }
  let summary = "";
  let structure: { title: string; items: string[] }[] | null = null;
  let documentType = "";
  let classificationStatus:
    | "completed"
    | "failed"
    | "processing"
    | "reconciliation_required" = "failed";
  try {
    const result = await dependencies.classify({
      task: "recommend",
      logicalStageKey: "ingest-upload.classify",
      systemPrompt:
        "You are TED, PrompTED's assistant. You will receive text extracted from a document a user just uploaded. " +
        "Respond ONLY with a JSON object, no prose and no markdown fences: " +
        '{ "document_type": "...", "purpose": "...", "sections": [{ "title": "...", "items": ["..."] }] }. ' +
        "document_type: 2-5 plain words naming what this document is. " +
        "purpose: 1-3 warm plain-English sentences, in your own words, explaining what this document is for and what it means for the person — never technical, never a restatement of headings. " +
        "sections: mirror the document's OWN structure and ordering — use its real headings as titles and its real entries as items (shortened to a line each, at most 12 items per section, at most 12 sections). If the document has no clear sections, return one section titled after the document itself.",
      messages: [{ role: "user", content: sliced.slice(0, 12_000) }],
      maxTokens: 1_600,
      outputSchema: INGEST_CLASSIFICATION_SCHEMA,
      signal: req.signal,
    });
    const classifiedRecord = result.structured;
    if (
      !classifiedRecord ||
      !hasExactKeys(classifiedRecord, ["document_type", "purpose", "sections"])
    ) throw new Error("UPLOAD_CLASSIFICATION_SCHEMA_INVALID");
    const classified = classifiedRecord as {
      document_type?: unknown;
      purpose?: unknown;
      sections?: unknown;
    } | undefined;
    if (
      !classified || typeof classified.document_type !== "string" ||
      typeof classified.purpose !== "string" ||
      !Array.isArray(classified.sections)
    ) throw new Error("UPLOAD_CLASSIFICATION_SCHEMA_INVALID");
    documentType = classified.document_type.trim().slice(0, 80);
    summary = String(classified.purpose ?? "")
      .trim()
      .slice(0, 600);
    structure = classified.sections
      .slice(0, 12)
      .map((section) => {
        const record = section as { title?: unknown; items?: unknown };
        if (
          !record || typeof record !== "object" ||
          !hasExactKeys(record as Record<string, unknown>, [
            "title",
            "items",
          ]) ||
          typeof record.title !== "string" || !Array.isArray(record.items) ||
          record.items.some((item) => typeof item !== "string")
        ) throw new Error("UPLOAD_CLASSIFICATION_SCHEMA_INVALID");
        const title = record.title.trim().slice(0, 120);
        const items = record.items.slice(0, 12).map((item) =>
          String(item).trim().slice(0, 200)
        ).filter(Boolean);
        if (!title) throw new Error("UPLOAD_CLASSIFICATION_SCHEMA_INVALID");
        return { title, items };
      });
    if (!documentType || !summary || structure.length === 0) {
      throw new Error("UPLOAD_CLASSIFICATION_SCHEMA_INVALID");
    }
    classificationStatus = "completed";
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    if (
      code.includes("RECONCILIATION_REQUIRED") ||
      code.includes("METERING_FAILED") ||
      code.includes("ACK_UNRESOLVED")
    ) {
      classificationStatus = "reconciliation_required";
    } else if (code === "OPENAI_MODEL_CALL_IN_PROGRESS") {
      classificationStatus = "processing";
    }
  }

  if (classificationStatus === "processing") {
    return jsonResponse(
      {
        ...errorBody(
          "UPLOAD_CLASSIFICATION_PROCESSING",
          "TED is still classifying this upload. Retry this exact request shortly.",
        ),
        upload_id: uploadId,
        classification_status: classificationStatus,
        original_retained: true,
        storage_path: storagePath,
        extraction_format: extraction.format,
        resource_policy_version: extraction.resourcePolicyVersion,
      },
      409,
      origin,
    );
  }

  if (classificationStatus === "reconciliation_required") {
    const response = {
      ...errorBody(
        "UPLOAD_CLASSIFICATION_RECONCILIATION_REQUIRED",
        "TED saved the upload, but cannot safely classify it again until the prior provider attempt is reconciled.",
      ),
      upload_id: uploadId,
      classification_status: classificationStatus,
      original_retained: true,
      storage_path: storagePath,
      extraction_format: extraction.format,
      resource_policy_version: extraction.resourcePolicyVersion,
    };
    return await settleResponse(
      dependencies.store,
      {
        uploadId,
        userId: auth.userId,
        requestSha256,
        claimToken,
        ingestStatus: "reconciliation_required",
        extractedText: sliced,
        extractedPayload: {
          truncated,
          original_retained: true,
          classification_status: classificationStatus,
          extraction_format: extraction.format,
          resource_policy_version: extraction.resourcePolicyVersion,
        },
        errorCode: "UPLOAD_CLASSIFICATION_RECONCILIATION_REQUIRED",
      },
      response,
      409,
      origin,
    );
  }

  if (classificationStatus === "failed") {
    const response = {
      ...errorBody(
        "UPLOAD_CLASSIFICATION_FAILED",
        "TED saved the original file, but could not classify it safely. No document import is available from this result.",
      ),
      upload_id: uploadId,
      classification_status: classificationStatus,
      original_retained: true,
      storage_path: storagePath,
      extraction_format: extraction.format,
      resource_policy_version: extraction.resourcePolicyVersion,
    };
    return await settleResponse(
      dependencies.store,
      {
        uploadId,
        userId: auth.userId,
        requestSha256,
        claimToken,
        ingestStatus: "failed",
        extractedText: sliced,
        extractedPayload: {
          truncated,
          original_retained: true,
          classification_status: classificationStatus,
          extraction_format: extraction.format,
          resource_policy_version: extraction.resourcePolicyVersion,
        },
        errorCode: "UPLOAD_CLASSIFICATION_FAILED",
      },
      response,
      502,
      origin,
    );
  }

  const response = {
    upload_id: uploadId,
    extracted_text: sliced,
    original_retained: true,
    storage_path: storagePath,
    classification_status: classificationStatus,
    extraction_format: extraction.format,
    resource_policy_version: extraction.resourcePolicyVersion,
    confirm_payload: {
      summary,
      document_type: documentType,
      structure,
      filename,
      char_count: sliced.length,
      truncated,
    },
  };
  return await settleResponse(
    dependencies.store,
    {
      uploadId,
      userId: auth.userId,
      requestSha256,
      claimToken,
      ingestStatus: "completed",
      extractedText: sliced,
      extractedPayload: {
        truncated,
        original_retained: true,
        classification_status: classificationStatus,
        extraction_format: extraction.format,
        resource_policy_version: extraction.resourcePolicyVersion,
      },
      errorCode: null,
    },
    response,
    200,
    origin,
  );
}
