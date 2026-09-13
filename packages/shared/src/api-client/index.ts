import { isOllamaCreditFallbackPolicy, type OllamaCreditFallbackPolicy } from "../document-operation";
import { parseSourcePreparedUpload, UPLOAD_SOURCE_PREPARATION_VERSION, type SourcePreparedUpload } from "../upload-source-preparation";
export type { SourcePreparedUpload } from "../upload-source-preparation";
// =====================================================
// PrompTED — Typed API Client
// Thin fetch wrappers around the orchestration Edge Functions.
// Configure once at app startup with the base URL + token getter.
// =====================================================

import type {
  BrandKit,
  Bundle,
  ChecklistItem,
  ClariPreferences,
  CompanyProfile,
  Document,
  DocumentPlaceholderMetadata,
  Outcome,
  Profile,
  RecommendationPayload,
  Section,
  Subscription,
  Template,
  Upload,
} from "../types/index";
import {
  type ChecklistItemResult,
  coerceIntentResult,
  type ExplainResult,
  type IntentResult,
  validateChecklist,
  validateExplainResult,
} from "../orchestration";
import type { TedArtifact, TedArtifactEvent, TedSupportingArtifactKind } from "../artifacts";
import {
  parseIngestUploadConfirmPayload,
  preflightUploadMetadata,
  preflightUploadMetadataV2,
  UPLOAD_RESOURCE_POLICY_VERSION,
  UPLOAD_RESOURCE_POLICY_VERSION_V2,
  type UploadPreflightFormatV2,
  type IngestUploadConfirmPayload,
} from "../ingest-upload";
import {
  BrandKitOperationInputError,
  type BrandLogoAction,
  prepareBrandKitOperation,
} from "../brand-kit-operation";

export type { IngestUploadConfirmPayload, UploadStructureSection } from "../ingest-upload";

// ---- configuration ---------------------------------------------

export interface ApiClientConfig {
  /** Stable same-origin application API base. Browser code must use "/api". */
  baseUrl: string;
  /** Resolves a token only for the immutable owner lease that began the action. */
  getToken?: (request: ApiRequestContext) => Promise<string | null> | string | null;
}

/**
 * Required dispatch identity for every authenticated shared-client request.
 * The web application captures it synchronously before the first await.
 */
export interface ApiRequestContext {
  expectedUserId: string;
  principalEpoch: number;
  signal: AbortSignal;
  assertCurrent: () => void;
}

let config: ApiClientConfig = { baseUrl: "/api" };

export function configureApiClient(next: ApiClientConfig): void {
  config = next;
}

function assertRequestCurrent(request: ApiRequestContext): void {
  if (
    !request ||
    typeof request.expectedUserId !== "string" ||
    request.expectedUserId.trim().length === 0 ||
    !Number.isSafeInteger(request.principalEpoch) ||
    request.principalEpoch < 0 ||
    !(request.signal instanceof AbortSignal) ||
    typeof request.assertCurrent !== "function"
  ) {
    throw new ApiError(409, "OWNER_CONTEXT_INVALID", {});
  }
  request.assertCurrent();
  if (request.signal.aborted) {
    const reason = request.signal.reason;
    if (reason instanceof Error) throw reason;
    throw new ApiError(409, "OWNER_DISPATCH_STALE", {});
  }
}

function authSubjectFromToken(token: string): string {
  try {
    const encoded = token.split(".")[1];
    if (!encoded) throw new Error("JWT_PAYLOAD_MISSING");
    const base64 = encoded
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const payload = JSON.parse(atob(base64)) as { sub?: unknown };
    const subject = typeof payload.sub === "string" ? payload.sub.trim().toLowerCase() : "";
    if (!subject) throw new Error("JWT_SUBJECT_INVALID");
    return subject;
  } catch {
    throw new ApiError(401, "AUTH_TOKEN_SUBJECT_INVALID", {});
  }
}

async function authHeaders(request: ApiRequestContext): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  return await authHeadersWithContentType(headers, request);
}

async function authHeadersWithContentType(
  headers: Record<string, string>,
  request: ApiRequestContext,
): Promise<Record<string, string>> {
  assertRequestCurrent(request);
  if (!config.getToken) throw new ApiError(401, "AUTH_RESOLVER_UNAVAILABLE", {});
  const token = await config.getToken(request);
  assertRequestCurrent(request);
  if (!token) throw new ApiError(401, "AUTH_REQUIRED", {});
  if (authSubjectFromToken(token) !== request.expectedUserId.trim().toLowerCase()) {
    throw new ApiError(401, "AUTH_SUBJECT_MISMATCH", {});
  }
  headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly payload: unknown,
  ) {
    super(code);
  }
}

async function postJson<T>(
  path: string,
  body: unknown,
  requestContext: ApiRequestContext,
): Promise<T> {
  const request = async (url: string): Promise<T> => {
    assertRequestCurrent(requestContext);
    const res = await fetch(url, {
      method: "POST",
      headers: await authHeadersWithContentType(
        {
          "Content-Type": "application/json",
        },
        requestContext,
      ),
      body: JSON.stringify(body),
      signal: requestContext.signal,
    });

    const data = await res.json().catch(() => ({}));
    assertRequestCurrent(requestContext);
    if (!res.ok) {
      const err = (data as Record<string, unknown>).error as Record<string, unknown> | undefined;
      throw new ApiError(res.status, String(err?.code ?? "REQUEST_FAILED"), data);
    }
    return data as T;
  };

  return await request(`${config.baseUrl}/${path}`);
}

const REQUEST_UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DURABLE_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface ModelRequestIdentity {
  /** Stable for one intended model invocation; pass the same UUID to resume
   * an exact request after a lost transport acknowledgement. */
  generation_request_id?: string;
}

/** JSON-only inference transport. It is deliberately separate from generic
 * mutation POSTs: only a transport rejection gets one exact replay, and both
 * attempts carry one UUID in the body and both identity headers. */
async function postModelJson<
  T,
  TInput extends object & ModelRequestIdentity = object & ModelRequestIdentity,
>(path: string, input: TInput, requestContext: ApiRequestContext): Promise<T> {
  const requestId = input.generation_request_id ?? crypto.randomUUID();
  if (
    input.generation_request_id
      ? !DURABLE_REQUEST_ID_PATTERN.test(requestId)
      : !REQUEST_UUID_V4_PATTERN.test(requestId)
  ) {
    throw new ApiError(400, "REQUEST_IDENTITY_INVALID", {});
  }
  const body = JSON.stringify({ ...input, generation_request_id: requestId });
  const request = async () => {
    assertRequestCurrent(requestContext);
    return fetch(`${config.baseUrl}/${path}`, {
      method: "POST",
      headers: await authHeadersWithContentType(
        {
          "Content-Type": "application/json",
          "x-idempotency-key": requestId,
          "x-request-id": requestId,
        },
        requestContext,
      ),
      body,
      signal: requestContext.signal,
    });
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await request();
    } catch (error) {
      if (requestContext.signal.aborted || attempt === 1) throw error;
      continue;
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = isRecord(data) && isRecord(data.error) ? data.error : null;
      throw new ApiError(response.status, typeof error?.code === "string" ? error.code : "REQUEST_FAILED", data);
    }
    try {
      const result = (await response.json()) as T;
      assertRequestCurrent(requestContext);
      return result;
    } catch (error) {
      if (requestContext.signal.aborted) throw error;
      if (attempt === 1) {
        throw new ApiError(502, "MODEL_RESPONSE_INVALID", {});
      }
    }
  }
  throw new ApiError(502, "MODEL_RESPONSE_INVALID", {});
}

async function getJson<T>(path: string, requestContext: ApiRequestContext): Promise<T> {
  const request = async (url: string): Promise<T> => {
    assertRequestCurrent(requestContext);
    const res = await fetch(url, {
      method: "GET",
      headers: await authHeaders(requestContext),
      signal: requestContext.signal,
    });
    const data = await res.json().catch(() => ({}));
    assertRequestCurrent(requestContext);
    if (!res.ok) {
      const err = (data as Record<string, unknown>).error as Record<string, unknown> | undefined;
      throw new ApiError(res.status, String(err?.code ?? "REQUEST_FAILED"), data);
    }
    return data as T;
  };

  return await request(`${config.baseUrl}/${path}`);
}

// ---- durable brand-kit operation -------------------------------

export interface SaveBrandKitOperationInput {
  businessId: string;
  expectedRevision: number;
  logoAction: BrandLogoAction;
  primaryColour: string;
  secondaryColour: string | null;
  footerText: string | null;
  file: File | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V8_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BRAND_STORAGE_PATH_PATTERN =
  /^brand-kits\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/logos\/([0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})[.](png|jpg|webp)$/;

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseBrandKitOperationResponse(
  value: unknown,
  prepared: Awaited<ReturnType<typeof prepareBrandKitOperation>>,
): BrandKit {
  const response = objectRecord(value);
  const brand = objectRecord(response?.brand_kit);
  if (
    response?.outcome !== "completed" ||
    response.operation_id !== prepared.operationId ||
    !brand ||
    !UUID_PATTERN.test(String(brand.id ?? "")) ||
    brand.business_id !== prepared.businessId ||
    brand.primary_colour !== prepared.primaryColour ||
    brand.secondary_colour !== prepared.secondaryColour ||
    brand.footer_text !== prepared.footerText ||
    brand.revision !== prepared.expectedRevision + 1 ||
    !["ready", "legacy_unverified"].includes(String(brand.logo_status ?? "")) ||
    typeof brand.updated_at !== "string" ||
    !Number.isFinite(Date.parse(brand.updated_at))
  ) {
    throw new ApiError(502, "BRAND_KIT_RESPONSE_INVALID", {});
  }

  const logoUrl = brand.logo_url;
  const logoOperationId = brand.logo_operation_id;
  const logoStoragePath = brand.logo_storage_path;
  const logoContentSha256 = brand.logo_content_sha256;
  const logoMediaType = brand.logo_media_type;
  const logoByteLength = brand.logo_byte_length;
  if (prepared.logoAction === "replace") {
    const pathMatch =
      typeof logoStoragePath === "string" ? BRAND_STORAGE_PATH_PATTERN.exec(logoStoragePath) : null;
    if (
      typeof logoUrl !== "string" ||
      logoUrl.includes("?") ||
      logoUrl.includes("#") ||
      !pathMatch ||
      pathMatch[1] !== prepared.businessId ||
      pathMatch[2] !== prepared.operationId ||
      !logoUrl.endsWith(`/storage/v1/object/public/assets/${logoStoragePath}`) ||
      logoOperationId !== prepared.operationId ||
      logoContentSha256 !== prepared.contentSha256 ||
      logoMediaType !== prepared.mediaType ||
      logoByteLength !== prepared.byteLength ||
      brand.logo_status !== "ready"
    ) {
      throw new ApiError(502, "BRAND_KIT_RESPONSE_INVALID", {});
    }
  } else if (prepared.logoAction === "remove") {
    if (
      logoUrl !== null ||
      logoOperationId !== null ||
      logoStoragePath !== null ||
      logoContentSha256 !== null ||
      logoMediaType !== null ||
      logoByteLength !== null ||
      brand.logo_status !== "ready"
    ) {
      throw new ApiError(502, "BRAND_KIT_RESPONSE_INVALID", {});
    }
  } else {
    const emptyLogo =
      logoUrl === null &&
      logoOperationId === null &&
      logoStoragePath === null &&
      logoContentSha256 === null &&
      logoMediaType === null &&
      logoByteLength === null &&
      brand.logo_status === "ready";
    const legacyLogo =
      typeof logoUrl === "string" &&
      logoOperationId === null &&
      logoStoragePath === null &&
      logoContentSha256 === null &&
      logoMediaType === null &&
      logoByteLength === null &&
      brand.logo_status === "legacy_unverified";
    const versionedLogo =
      typeof logoUrl === "string" &&
      UUID_V8_PATTERN.test(String(logoOperationId ?? "")) &&
      typeof logoStoragePath === "string" &&
      BRAND_STORAGE_PATH_PATTERN.test(logoStoragePath) &&
      SHA256_PATTERN.test(String(logoContentSha256 ?? "")) &&
      ["image/png", "image/jpeg", "image/webp"].includes(String(logoMediaType ?? "")) &&
      Number.isSafeInteger(logoByteLength) &&
      Number(logoByteLength) > 0 &&
      Number(logoByteLength) <= 5 * 1024 * 1024 &&
      brand.logo_status === "ready";
    if (!emptyLogo && !legacyLogo && !versionedLogo) {
      throw new ApiError(502, "BRAND_KIT_RESPONSE_INVALID", {});
    }
  }

  return brand as unknown as BrandKit;
}

/**
 * Submit one owner-bound brand-kit command. The exact deterministic operation
 * identity is reused only for one uncertain transport replay; file selection
 * itself performs no network or Storage mutation.
 */
export async function saveBrandKitOperation(
  input: SaveBrandKitOperationInput,
  requestContext: ApiRequestContext,
): Promise<BrandKit> {
  assertRequestCurrent(requestContext);
  let bytes: Uint8Array | null = null;
  if (input.file) bytes = new Uint8Array(await input.file.arrayBuffer());
  assertRequestCurrent(requestContext);
  let prepared: Awaited<ReturnType<typeof prepareBrandKitOperation>>;
  try {
    prepared = await prepareBrandKitOperation({
      ownerUserId: requestContext.expectedUserId,
      businessId: input.businessId,
      expectedRevision: input.expectedRevision,
      logoAction: input.logoAction,
      primaryColour: input.primaryColour,
      secondaryColour: input.secondaryColour,
      footerText: input.footerText,
      file: bytes && input.file ? { bytes, mediaType: input.file.type } : null,
    });
  } catch (error) {
    if (error instanceof BrandKitOperationInputError) {
      throw new ApiError(400, error.code, {});
    }
    throw error;
  }

  const form = (): FormData => {
    const value = new FormData();
    value.append("operation_id", prepared.operationId);
    value.append("binding_sha256", prepared.bindingSha256);
    value.append("business_id", prepared.businessId);
    value.append("expected_revision", String(prepared.expectedRevision));
    value.append("logo_action", prepared.logoAction);
    value.append("primary_colour", prepared.primaryColour);
    value.append("secondary_colour", prepared.secondaryColour ?? "");
    value.append("footer_text", prepared.footerText ?? "");
    if (input.file) value.append("file", input.file, input.file.name);
    return value;
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      assertRequestCurrent(requestContext);
      response = await fetch(`${config.baseUrl}/brand-logo`, {
        method: "POST",
        headers: await authHeadersWithContentType(
          {
            "x-idempotency-key": prepared.operationId,
            "x-request-id": prepared.operationId,
          },
          requestContext,
        ),
        body: form(),
        signal: requestContext.signal,
      });
    } catch (error) {
      if (requestContext.signal.aborted || attempt === 1) throw error;
      continue;
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      assertRequestCurrent(requestContext);
      const error = objectRecord(objectRecord(data)?.error);
      throw new ApiError(response.status, String(error?.code ?? "BRAND_KIT_SAVE_FAILED"), data);
    }
    try {
      const result = parseBrandKitOperationResponse(await response.json(), prepared);
      assertRequestCurrent(requestContext);
      return result;
    } catch (error) {
      if (requestContext.signal.aborted) throw error;
      if (attempt === 1) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(502, "BRAND_KIT_RESPONSE_INVALID", {});
      }
    }
  }
  throw new ApiError(502, "BRAND_KIT_RESPONSE_INVALID", {});
}

// ---- durable captured document operation ----------------------

export interface CapturedDocumentOperationQuestion {
  input_key: string;
  label: string;
  question: string;
  why_needed: string;
  blocks_sections: string[];
  blocks_export: boolean;
  can_skip: boolean;
  skip_consequence: string;
}

export interface CapturedDocumentOperationStatus {
  contract_version?: string;
  operation_id: string;
  document_id: string;
  operation_revision: number;
  accepted_document_revision?: number;
  latest_document_revision?: number;
  document_revision?: number;
  status: string;
  safe_section_keys?: string[];
  blocked_section_keys?: string[];
  retryable: boolean;
  reconnect?: string;
  message?: string | null;
  safe_next_action?: string | null;
  correlation_id?: string;
  questions?: CapturedDocumentOperationQuestion[];
  idempotent_replay?: boolean;
  cancellation_requested?: boolean;
  /** Server-authoritative recovery gate; true only when no live worker lease blocks resume. */
  resume_available?: boolean;
  /** Safe-to-expose lease deadline used to explain when stranded work can be reclaimed. */
  lease_expires_at?: string | null;
  /** Durable capacity retry timing; present only while status is awaiting_capacity. */
  capacity_retry_after_at?: string | null;
  retry_after_seconds?: number | null;
  capacity_semantic_route?: "deep" | "review" | null;
}

const CAPTURED_OPERATION_STATUSES = new Set([
  "accepted",
  "awaiting_clarification",
  "awaiting_capacity",
  "generating",
  "validating",
  "persisting",
  "ready_for_review",
  "retryable_failure",
  "terminal_failure",
  "cancelled",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isOptionalRevision(value: unknown): boolean {
  return value === undefined || (Number.isInteger(value) && Number(value) >= 0);
}

function isOptionalStringArray(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((entry) => typeof entry === "string"))
  );
}

function isCapturedQuestion(value: unknown): value is CapturedDocumentOperationQuestion {
  if (!isRecord(value)) return false;
  return (
    typeof value.input_key === "string" &&
    typeof value.label === "string" &&
    typeof value.question === "string" &&
    typeof value.why_needed === "string" &&
    Array.isArray(value.blocks_sections) &&
    value.blocks_sections.every((entry) => typeof entry === "string") &&
    typeof value.blocks_export === "boolean" &&
    typeof value.can_skip === "boolean" &&
    typeof value.skip_consequence === "string"
  );
}

function invalidCapturedOperationReceipt(): never {
  throw new ApiError(502, "CAPTURED_OPERATION_RESPONSE_INVALID", {});
}

function validateCapturedOperationReceipt(value: unknown): CapturedDocumentOperationStatus {
  if (!isRecord(value)) invalidCapturedOperationReceipt();
  if (
    typeof value.operation_id !== "string" ||
    value.operation_id.length === 0 ||
    typeof value.document_id !== "string" ||
    value.document_id.length === 0 ||
    !Number.isInteger(value.operation_revision) ||
    Number(value.operation_revision) < 1 ||
    typeof value.status !== "string" ||
    !CAPTURED_OPERATION_STATUSES.has(value.status) ||
    typeof value.retryable !== "boolean" ||
    !isOptionalString(value.contract_version) ||
    !isOptionalRevision(value.accepted_document_revision) ||
    !isOptionalRevision(value.latest_document_revision) ||
    !isOptionalRevision(value.document_revision) ||
    !isOptionalStringArray(value.safe_section_keys) ||
    !isOptionalStringArray(value.blocked_section_keys) ||
    !isOptionalString(value.reconnect) ||
    !isOptionalNullableString(value.message) ||
    !isOptionalNullableString(value.safe_next_action) ||
    !isOptionalString(value.correlation_id) ||
    !isOptionalBoolean(value.idempotent_replay) ||
    !isOptionalBoolean(value.cancellation_requested) ||
    !isOptionalBoolean(value.resume_available) ||
    !isOptionalNullableString(value.lease_expires_at) ||
    !isOptionalNullableString(value.capacity_retry_after_at) ||
    !(
      value.retry_after_seconds === undefined ||
      value.retry_after_seconds === null ||
      (typeof value.retry_after_seconds === "number" &&
        Number.isFinite(value.retry_after_seconds) &&
        value.retry_after_seconds >= 0)
    ) ||
    !(
      value.capacity_semantic_route === undefined ||
      value.capacity_semantic_route === null ||
      value.capacity_semantic_route === "deep" ||
      value.capacity_semantic_route === "review"
    ) ||
    !(
      value.questions === undefined ||
      (Array.isArray(value.questions) && value.questions.every(isCapturedQuestion))
    )
  ) {
    invalidCapturedOperationReceipt();
  }
  return value as unknown as CapturedDocumentOperationStatus;
}

function validateExpectedCapturedOperationReceipt(
  value: unknown,
  expected: { operationId?: string; documentId?: string },
): CapturedDocumentOperationStatus {
  const receipt = validateCapturedOperationReceipt(value);
  if (
    (expected.operationId !== undefined && receipt.operation_id !== expected.operationId) ||
    (expected.documentId !== undefined && receipt.document_id !== expected.documentId)
  ) {
    invalidCapturedOperationReceipt();
  }
  return receipt;
}

export interface StartCapturedDocumentOperationInput {
  outcome_id: string;
  document_id: string;
  title: string;
  template_id: string;
  generation_request_id: string;
  input_revision: number;
  input_values: Record<string, unknown>;
  locale?: string;
  jurisdiction?: string;
}

/** Starts or resumes one immutable, idempotent operation through the server. */
export async function startCapturedDocumentOperation(
  input: StartCapturedDocumentOperationInput,
  requestContext: ApiRequestContext,
): Promise<CapturedDocumentOperationStatus> {
  return validateExpectedCapturedOperationReceipt(
    await postJson<unknown>("document-operation", input, requestContext),
    { documentId: input.document_id },
  );
}

export interface ResumeCapturedDocumentOperationInput {
  action: "resume";
  operation_id: string;
}

/**
 * Resumes by durable identity. The server reloads the immutable accepted input
 * snapshot, so a browser reload cannot alter request identity or create a
 * second logical operation.
 */
export async function resumeCapturedDocumentOperation(
  input: ResumeCapturedDocumentOperationInput,
  requestContext: ApiRequestContext,
): Promise<CapturedDocumentOperationStatus> {
  return validateExpectedCapturedOperationReceipt(
    await postJson<unknown>("document-operation", input, requestContext),
    { operationId: input.operation_id },
  );
}

export interface CancelCapturedDocumentOperationResult extends CapturedDocumentOperationStatus {
  cancellation_requested: true;
  idempotent_replay: boolean;
  reconnect: string;
  retryable: false;
}

/** Requests durable owner cancellation at one exact operation revision. */
export async function cancelCapturedDocumentOperation(
  input: {
    operation_id: string;
    expected_operation_revision: number;
    cancellation_code: "owner_cancelled";
  },
  requestContext: ApiRequestContext,
): Promise<CancelCapturedDocumentOperationResult> {
  const receipt = validateExpectedCapturedOperationReceipt(
    await postJson<unknown>("document-operation", { action: "cancel", ...input }, requestContext),
    { operationId: input.operation_id },
  );
  if (
    receipt.cancellation_requested !== true ||
    typeof receipt.idempotent_replay !== "boolean" ||
    typeof receipt.reconnect !== "string" ||
    receipt.reconnect.length === 0 ||
    receipt.retryable !== false
  ) {
    invalidCapturedOperationReceipt();
  }
  return receipt as CancelCapturedDocumentOperationResult;
}

/** Reconnects to durable Supabase truth; provider streams are never authority. */
export async function getCapturedDocumentOperation(
  operationId: string,
  requestContext: ApiRequestContext,
): Promise<CapturedDocumentOperationStatus> {
  return validateExpectedCapturedOperationReceipt(
    await getJson<unknown>(
      `document-operation?operation_id=${encodeURIComponent(operationId)}`,
      requestContext,
    ),
    { operationId },
  );
}

// ---- interpret-intent ------------------------------------------

export interface InterpretIntentInput extends ModelRequestIdentity {
  situation_text: string;
  extracted_text?: string;
  clari?: Partial<ClariPreferences>;
}

export async function interpretIntent(
  input: InterpretIntentInput,
  requestContext: ApiRequestContext,
): Promise<IntentResult> {
  const raw = await postModelJson<unknown>("interpret-intent", input, requestContext);
  return coerceIntentResult(raw);
}

// ---- clarify ---------------------------------------------------

export interface ClarifyTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ClarifyInput extends ModelRequestIdentity {
  domain?: string;
  situation?: string;
  /**
   * Full text extracted from any uploaded document. Sent separately from
   * `situation` so the Edge Function can give it its own (larger) length
   * budget instead of losing it to the per-turn history slice.
   */
  extracted_text?: string;
  history: ClarifyTurn[];
  answer: string;
  clari?: Partial<ClariPreferences>;
}

export async function clarify(
  input: ClarifyInput,
  requestContext: ApiRequestContext,
): Promise<IntentResult> {
  const raw = await postModelJson<unknown>("clarify", input, requestContext);
  return coerceIntentResult(raw);
}

// ---- recommend -------------------------------------------------

export interface RecommendInput extends ModelRequestIdentity {
  domain?: string;
  situation: string;
  clari?: Partial<ClariPreferences>;
}

export async function recommend(
  input: RecommendInput,
  requestContext: ApiRequestContext,
): Promise<IntentResult> {
  const raw = await postModelJson<unknown>("recommend", input, requestContext);
  return coerceIntentResult({
    ...(raw as object),
    intent_clear: true,
    recommendation: raw,
  });
}

// ---- job-match -------------------------------------------------

export interface JobMatchInput extends ModelRequestIdentity {
  situation: string;
  experience?: string;
  location?: string;
  /** Structured constraints, passed alongside (not instead of) situation
   * free text so they are guaranteed to reach the model rather than relying
   * on the text mention surviving truncation or being deprioritised. */
  work_type?: string;
  distance?: string;
  role_focus?: string;
  /** Explicit ISO-3166 alpha-2 market scope. Omitted means market facts fail closed. */
  country_code?: string;
  history?: { role: "user" | "assistant"; content: string }[];
}

export interface FitBreakdown {
  skills_match?: number;
  experience_match?: number;
  work_style_fit?: number;
  location_fit?: "pass" | "fail" | "flag";
  career_alignment?: number;
}

export interface JobVacancy {
  title?: string;
  employer?: string;
  location?: string;
  source?: string;
  /** Immutable provider-tool source identity captured for this exact search. */
  source_id?: string;
  source_status?: "source_linked_not_independently_verified";
  url?: string;
  pay?: string;
  closing?: string;
  why_fit?: string;
  fit_score?: number;
  fit_breakdown?: FitBreakdown;
  risk_flags?: string[];
  improve_before_applying?: string[];
}

export interface JobRoleIdea {
  dataset_role_id?: string;
  role?: string;
  industry?: string;
  why_fit?: string;
  typical_pay?: string;
  demand?: string;
  how_fast?: string;
  first_steps?: string[];
  fit_score?: number;
  fit_breakdown?: FitBreakdown;
  evidence_to_show?: string[];
  application_actions?: string[];
  market_country?: "AU";
  currency?: "AUD";
  data_as_of?: string;
}

export type VacancySearchStatus =
  | { status: "completed"; source_linked_count: number }
  | {
      status: "failed";
      source_linked_count: 0;
      retryable: boolean;
      error: {
        code: "VACANCY_RESEARCH_UNAVAILABLE";
        message: string;
        safe_next_action: string;
        retry_after_seconds?: number;
      };
    };

export interface JobMatchResult {
  need_more_context?: boolean;
  ask?: string;
  missing?: string[];
  urgency?: "high" | "normal";
  location_used?: string;
  summary?: string;
  listings?: JobVacancy[];
  role_ideas?: JobRoleIdea[];
  tips?: string[];
  data_as_of?: string;
  data_source?: "database" | "unavailable";
  live_search?: boolean;
  grounding_status?: "source_linked_not_independently_verified";
  source_linked_count?: number;
  vacancy_search?: VacancySearchStatus;
  /** @deprecated Source membership only; use grounding_status. */
  verified_count?: number;
  /** @deprecated Source membership only; use grounding_status. */
  verified_sources?: Array<{
    id: string;
    title: string;
    url: string;
    type: "web";
  }>;
}

/** Find real, current job vacancies + role ideas for the user's situation and location. */
export async function jobMatch(
  input: JobMatchInput,
  requestContext: ApiRequestContext,
): Promise<JobMatchResult> {
  return postModelJson<JobMatchResult>("job-match", input, requestContext);
}

// ---- proofread-document -----------------------------------------

export interface ProofreadItem {
  title: string;
  why: string;
  original_snippet: string;
  revised_snippet: string;
}

export interface ProofreadSectionResult {
  id: string;
  key: string;
  label: string;
  corrections: ProofreadItem[];
  improvements: ProofreadItem[];
}

export interface ProofreadInput extends ModelRequestIdentity {
  sections: Array<{ id: string; key?: string; label: string; content: string }>;
  domain?: string;
}

export async function proofreadDocument(
  input: ProofreadInput,
  requestContext: ApiRequestContext,
): Promise<{ sections: ProofreadSectionResult[] }> {
  return postModelJson<{ sections: ProofreadSectionResult[] }>(
    "proofread-document",
    input,
    requestContext,
  );
}

// ---- generate-document (streaming) -----------------------------

export interface GenerateDocumentInput {
  template_id: string;
  situation?: string;
  profile?: Record<string, string | undefined>;
  extracted_text?: string;
  conversation_context?: string;
  upload_context?: string;
  upload_id?: string;
  sections?: Array<{
    key: string;
    label: string;
    required: boolean;
    hint?: string;
    vital?: string[];
    improver?: string[];
  }>;
  /** Compatibility assertions from older callers. The server resolves the
   * canonical catalogue policy and rejects conflicting assertions; these
   * fields cannot replace its domain, structure or advice requirements. */
  domain?: string;
  structure_type?: "compose" | "structured_form" | "checklist";
  advice_boundary?: "none" | "light" | "high-stakes";
  /** True when no catalogue template matched: the backend designs a
   * situation-specific structure instead of the generic scaffold. */
  design_bespoke?: boolean;
  document_name?: string;
  /** Stable per intended generation; reused on retries so the backend
   * charges the document credit at most once. */
  generation_request_id: string;
}

export interface DocumentDesignEvent {
  type: "document_design";
  name: string;
  sections: Array<{ key: string; label: string; required: boolean }>;
}

export interface MissingInfoEvent {
  type: "missing_info";
  sections: Array<{ key: string; label: string; missing: string[] }>;
}

export interface UnresolvedPlaceholdersEvent {
  type: "unresolved_placeholders";
  placeholders: DocumentPlaceholderMetadata[];
}

export interface DocumentSectionEvent {
  type: "section";
  key: string;
  label: string;
  content: string;
}

export interface DocumentDraftSectionEvent {
  type: "draft_section";
  key: string;
  label: string;
  content: string;
}

// Allow the durable payload ceiling plus bounded SSE framing and heartbeats.
const DOCUMENT_STREAM_MAX_BYTES = 8_380_000 + 64 * 1024;
const DOCUMENT_STREAM_MAX_FRAME_BYTES = 1024 * 1024;
const DOCUMENT_STREAM_MAX_EVENTS = 1024;
const DOCUMENT_STREAM_MAX_SECTIONS = 128;
// The existing server sends a heartbeat every 20 seconds. Three missing
// intervals end this observation; they do not establish provider completion.
const DOCUMENT_STREAM_IDLE_TIMEOUT_MS = 60_000;

function documentStreamFailure(code = "DOCUMENT_STREAM_EVENT_INVALID"): never {
  throw new ApiError(502, code, {});
}

function streamString(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= maximum &&
    (allowEmpty || value.trim().length > 0);
}

function streamRoster(value: unknown): value is DocumentDesignEvent["sections"] {
  return Array.isArray(value) && value.length > 0 &&
    value.length <= DOCUMENT_STREAM_MAX_SECTIONS &&
    value.every((section) => isRecord(section) &&
      streamString(section.key, 200) && streamString(section.label, 512) &&
      typeof section.required === "boolean") &&
    new Set(value.map((section) => section.key)).size === value.length;
}

function streamPlaceholder(value: unknown): value is DocumentPlaceholderMetadata {
  if (!isRecord(value)) return false;
  const fields = ["id", "profileKey", "sectionKey", "informationKey", "label", "question", "factType"];
  if (!fields.every((field) => streamString(value[field], 16_384))) return false;
  if (typeof value.requiredForExport !== "boolean") return false;
  for (const field of ["automaticFallback", "sharedResolutionKey"]) {
    if (value[field] !== undefined && !streamString(value[field], 16_384, true)) return false;
  }
  const options = value.neutralReplacementOptions;
  return Array.isArray(options) && options.length <= 128 &&
    options.every((option) => isRecord(option) &&
      ["id", "label", "value", "suitability"].every((key) =>
        streamString(option[key], 16_384, key === "value")) &&
      typeof option.clearsExportWarning === "boolean" &&
      typeof option.regenerateSurroundingWording === "boolean") &&
    new Set(options.map((option) => option.id)).size === options.length;
}

type AcceptedDocumentStreamEvent =
  | DocumentSectionEvent
  | DocumentDesignEvent
  | MissingInfoEvent
  | UnresolvedPlaceholdersEvent;


/**
 * Accept reviewed sections only after the complete expected set, terminal
 * marker and EOF. Draft callbacks are transient previews, never saved content.
 * Completion proves this response's transport contract, not a document revision.
 */
export async function generateDocumentStream(
  input: GenerateDocumentInput,
  onSection: (event: DocumentSectionEvent) => void,
  requestContext: ApiRequestContext,
  onDesign?: (event: DocumentDesignEvent) => void,
  onMissingInfo?: (event: MissingInfoEvent) => void,
  onUnresolvedPlaceholders?: (event: UnresolvedPlaceholdersEvent) => void,
  onDraftSection?: (event: DocumentDraftSectionEvent) => void,
): Promise<void> {
  const request = async (url: string) => {
    assertRequestCurrent(requestContext);
    const res = await fetch(url, {
      method: "POST",
      headers: await authHeaders(requestContext),
      body: JSON.stringify(input),
      signal: requestContext.signal,
    });

    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      const err = isRecord(data) && isRecord(data.error) ? data.error : null;
      throw new ApiError(res.status, typeof err?.code === "string" ? err.code : "STREAM_FAILED", data);
    }
    return res;
  };

  const res = await request(`${config.baseUrl}/generate-document`);

  if ((res.headers.get("Content-Type") ?? "").split(";")[0]?.trim().toLowerCase() !== "text/event-stream") {
    void res.body!.cancel().catch(() => undefined);
    documentStreamFailure("DOCUMENT_STREAM_CONTENT_TYPE_INVALID");
  }
  if (input.sections !== undefined && !streamRoster(input.sections)) {
    void res.body!.cancel().catch(() => undefined);
    documentStreamFailure("DOCUMENT_STREAM_SECTION_SET_INVALID");
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const encoder = new TextEncoder();
  let expectedKeys = input.sections?.map((section) => section.key) ?? null;
  let buffer = "";
  let searchFrom = 0;
  let dataLines: string[] = [];
  let frameBytes = 0;
  let pendingBytes = 0;
  let receivedBytes = 0;
  let eventCount = 0;
  let terminal = false;
  let eof = false;
  let phase: "design" | "drafts" | "sections" | "metadata" = "design";
  const accepted: AcceptedDocumentStreamEvent[] = [];
  const finalKeys: string[] = [];
  const metadataTypes = new Set<string>();
  let designSeen = false;
  let firstDecodedCharacter = true;
  let cleanup: Promise<void> | undefined;
  const cancelReader = () => {
    cleanup ??= reader.cancel().catch(() => undefined);
    return cleanup;
  };
  const onAbort = () => { void cancelReader(); };
  requestContext.signal.addEventListener("abort", onAbort, { once: true });

  const readChunk = async () => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new ApiError(504,
            "DOCUMENT_STREAM_IDLE_TIMEOUT", {})), DOCUMENT_STREAM_IDLE_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  };

  const completeSectionSet = () => {
    const roster = expectedKeys;
    if (!roster?.length || finalKeys.length !== roster.length ||
      finalKeys.some((key, index) => key !== roster[index])) {
      documentStreamFailure("DOCUMENT_STREAM_SECTION_SET_INVALID");
    }
  };
  const knownSection = (key: unknown): key is string =>
    streamString(key, 200) && (!expectedKeys || expectedKeys.includes(key));

  const consumeEvent = async (data: string) => {
    assertRequestCurrent(requestContext);
    if (++eventCount > DOCUMENT_STREAM_MAX_EVENTS) {
      documentStreamFailure("DOCUMENT_STREAM_LIMIT_EXCEEDED");
    }
    if (terminal) documentStreamFailure("DOCUMENT_STREAM_AFTER_TERMINAL");
    if (data === "[DONE]") {
      completeSectionSet();
      terminal = true;
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      documentStreamFailure("DOCUMENT_STREAM_JSON_INVALID");
    }
    if (!isRecord(raw)) documentStreamFailure();
    // A server failure retains its exact code/status, even when no successful
    // section roster was established. Never mask a reconciliation hold.
    if (raw.type === "error") {
      const error = isRecord(raw.error) ? raw.error : {};
      const code = error.code ?? raw.code ?? raw.detail_code ?? "DOCUMENT_STREAM_FAILED";
      if (!streamString(code, 256)) documentStreamFailure();
      const status = raw.http_status === undefined ? 502 : raw.http_status;
      if (typeof status !== "number" || !Number.isInteger(status) || status < 400 || status > 599) {
        documentStreamFailure();
      }
      throw new ApiError(status, code, raw);
    }
    if (raw.type === "document_design") {
      if (designSeen || phase !== "design" || !input.design_bespoke ||
        !streamString(raw.name, 512) || !streamRoster(raw.sections)) {
        documentStreamFailure();
      }
      designSeen = true;
      expectedKeys = raw.sections.map((section) => section.key);
      accepted.push(raw as unknown as DocumentDesignEvent);
      return;
    }
    if (raw.type === "section" || raw.type === "draft_section") {
      if (!knownSection(raw.key) || !streamString(raw.label, 512) ||
        !streamString(raw.content, DOCUMENT_STREAM_MAX_FRAME_BYTES)) {
        documentStreamFailure();
      }
      if (raw.type === "draft_section") {
        if (phase === "sections" || phase === "metadata") documentStreamFailure();
        phase = "drafts";
        // Draft keys may repeat across bounded repairs and arrive concurrently.
        // This callback is optional and must only update a transient preview.
        await onDraftSection?.(raw as unknown as DocumentDraftSectionEvent);
        assertRequestCurrent(requestContext);
      } else {
        if (phase === "metadata" || finalKeys.includes(raw.key) ||
          (expectedKeys && expectedKeys[finalKeys.length] !== raw.key) ||
          finalKeys.length >= DOCUMENT_STREAM_MAX_SECTIONS) {
          documentStreamFailure("DOCUMENT_STREAM_SECTION_SET_INVALID");
        }
        phase = "sections";
        finalKeys.push(raw.key);
        accepted.push(raw as unknown as DocumentSectionEvent);
      }
      return;
    }
    if (raw.type !== "missing_info" && raw.type !== "unresolved_placeholders" &&
      raw.type !== "advice_boundary") documentStreamFailure();
    completeSectionSet();
    phase = "metadata";
    if (metadataTypes.has(raw.type)) documentStreamFailure();
    metadataTypes.add(raw.type);
    if (raw.type === "advice_boundary") {
      if (typeof raw.level !== "string" || !["none", "light", "high-stakes"].includes(raw.level)) {
        documentStreamFailure();
      }
      return;
    }
    if (encoder.encode(data).byteLength > 256 * 1024) {
      documentStreamFailure("DOCUMENT_STREAM_LIMIT_EXCEEDED");
    }
    if (raw.type === "missing_info") {
      const entries = raw.sections;
      if (!Array.isArray(entries) || entries.length > DOCUMENT_STREAM_MAX_SECTIONS ||
        !entries.every((entry) => isRecord(entry) && knownSection(entry.key) &&
          streamString(entry.label, 512) && Array.isArray(entry.missing) &&
          entry.missing.length <= 128 &&
          entry.missing.every((value: unknown) => streamString(value, 16_384))) ||
        new Set(entries.map((entry) => entry.key)).size !== entries.length) {
        documentStreamFailure();
      }
      accepted.push(raw as unknown as MissingInfoEvent);
    } else {
      const entries = raw.placeholders;
      if (!Array.isArray(entries) || entries.length > 512 ||
        !entries.every((entry) => streamPlaceholder(entry) && knownSection(entry.sectionKey)) ||
        new Set(entries.map((entry) => entry.id)).size !== entries.length) {
        documentStreamFailure();
      }
      accepted.push(raw as unknown as UnresolvedPlaceholdersEvent);
    }
  };

  const consumeLines = async (flushing: boolean) => {
    const ending = /[\r\n]/g;
    for (;;) {
      ending.lastIndex = searchFrom;
      const match = ending.exec(buffer);
      if (!match) { searchFrom = buffer.length; break; }
      const index = match.index;
      if (!flushing && buffer[index] === "\r" && index === buffer.length - 1) {
        searchFrom = index;
        break;
      }
      const width = buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1;
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + width);
      searchFrom = 0;
      const lineBytes = encoder.encode(line).byteLength + width;
      pendingBytes -= lineBytes;
      frameBytes += lineBytes;
      if (frameBytes > DOCUMENT_STREAM_MAX_FRAME_BYTES) {
        documentStreamFailure("DOCUMENT_STREAM_LIMIT_EXCEEDED");
      }
      if (!line) {
        if (dataLines.length > 0) await consumeEvent(dataLines.join("\n"));
        dataLines = [];
        frameBytes = 0;
      } else if (!line.startsWith(":")) {
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "data") dataLines.push(value);
        // Event names, IDs and retry hints cannot change this request identity.
      }
    }
    if (frameBytes + pendingBytes > DOCUMENT_STREAM_MAX_FRAME_BYTES) {
      documentStreamFailure("DOCUMENT_STREAM_LIMIT_EXCEEDED");
    }
  };

  try {
    assertRequestCurrent(requestContext);
    for (;;) {
      const { done, value } = await readChunk();
      assertRequestCurrent(requestContext);
      if (value) {
        receivedBytes += value.byteLength;
        pendingBytes += value.byteLength;
        if (receivedBytes > DOCUMENT_STREAM_MAX_BYTES) {
          documentStreamFailure("DOCUMENT_STREAM_LIMIT_EXCEEDED");
        }
      }
      let decoded: string;
      try {
        decoded = done ? decoder.decode() : decoder.decode(value, { stream: true });
      } catch {
        documentStreamFailure("DOCUMENT_STREAM_ENCODING_INVALID");
      }
      if (firstDecodedCharacter && decoded.length > 0) {
        firstDecodedCharacter = false;
        if (decoded.charCodeAt(0) === 0xfeff) {
          decoded = decoded.slice(1);
          pendingBytes -= 3;
        }
      }
      buffer += decoded;
      await consumeLines(done);
      if (done) { eof = true; break; }
    }
    if (!terminal || buffer || dataLines.length > 0) {
      documentStreamFailure("DOCUMENT_STREAM_INCOMPLETE");
    }
    // Publish nothing canonical until every frame, final section and metadata
    // item has passed the terminal contract, including absence of trailing data.
    for (const event of accepted) {
      assertRequestCurrent(requestContext);
      switch (event.type) {
        case "section": await onSection(event); break;
        case "document_design": await onDesign?.(event); break;
        case "missing_info": await onMissingInfo?.(event); break;
        case "unresolved_placeholders": await onUnresolvedPlaceholders?.(event); break;
      }
      assertRequestCurrent(requestContext);
    }
  } finally {
    requestContext.signal.removeEventListener("abort", onAbort);
    // Cleanup must not replace a parser, consumer, owner or reconciliation error.
    // cancel() closes pending reads synchronously, but its underlying transport
    // cleanup promise may never settle. It must not hide the primary failure.
    if (!eof) void cancelReader();
    reader.releaseLock();
  }

}

// ---- generate-checklist ----------------------------------------

export interface GenerateChecklistInput {
  situation: string;
  /** Stable per intended generation and reused only for an exact retry. */
  generation_request_id: string;
  domain?: string;
  clari?: Partial<ClariPreferences>;
}

export async function generateChecklist(
  input: GenerateChecklistInput,
  requestContext: ApiRequestContext,
): Promise<ChecklistItemResult[]> {
  const raw = await postModelJson<unknown>("generate-checklist", input, requestContext);
  return validateChecklist(raw);
}

// ---- generate-artifact (unified TED v2) ----------------------

export interface GenerateArtifactInput {
  request_id: string;
  outcome_id: string;
  kind: TedSupportingArtifactKind;
  template_id?: string;
  situation: string;
  conversation_context?: string;
  upload_context?: string;
  extracted_text?: string;
  locale?: string;
  timezone?: string;
}

export async function generateArtifactStream(
  input: GenerateArtifactInput,
  onEvent: (event: TedArtifactEvent) => void,
  requestContext: ApiRequestContext,
): Promise<TedArtifact> {
  if (!DURABLE_REQUEST_ID_PATTERN.test(input.request_id)) {
    throw new ApiError(400, "REQUEST_IDENTITY_INVALID", {});
  }
  const body = JSON.stringify({
    ...input,
    generation_request_id: input.request_id,
  });
  const request = async () => {
    assertRequestCurrent(requestContext);
    return fetch(`${config.baseUrl}/generate-artifact`, {
      method: "POST",
      headers: await authHeadersWithContentType(
        {
          "Content-Type": "application/json",
          "x-idempotency-key": input.request_id,
          "x-request-id": input.request_id,
        },
        requestContext,
      ),
      body,
      signal: requestContext.signal,
    });
  };
  let res: Response;
  try {
    res = await request();
  } catch (error) {
    if (requestContext.signal.aborted) throw error;
    res = await request();
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    assertRequestCurrent(requestContext);
    const detail = isRecord(data) && isRecord(data.error) ? data.error : null;
    const code = detail?.code;
    const knownCode = code === "DOCUMENT_LIMIT_REACHED" || code === "PAYWALL" || code === "TED_V2_DISABLED"
      ? code
      : "ARTIFACT_STREAM_FAILED";
    throw new ApiError(res.status, knownCode, data);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: TedArtifact | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    assertRequestCurrent(requestContext);
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.replace(/^data: /, "").trim();
      if (!line || line === "[DONE]") continue;
      assertRequestCurrent(requestContext);
      const event = JSON.parse(line) as TedArtifactEvent;
      onEvent(event);
      if (event.type === "error") throw new ApiError(502, event.code, event);
      if (event.type === "complete") completed = event.artifact;
    }
  }
  if (!completed) throw new ApiError(502, "ARTIFACT_INCOMPLETE", {});
  assertRequestCurrent(requestContext);
  return completed;
}

// ---- ingest-upload (Layer 5 placeholder) -----------------------

export interface IngestUploadOutput {
  credit_fallback?: OllamaCreditFallbackPolicy;
  upload_id: string;
  extracted_text: string;
  original_retained: true;
  classification_status: "completed";
  confirm_payload: IngestUploadConfirmPayload;
  extraction_format?: UploadPreflightFormatV2;
  resource_policy_version?: typeof UPLOAD_RESOURCE_POLICY_VERSION | typeof UPLOAD_RESOURCE_POLICY_VERSION_V2;
}

export interface PreparedUploadDispatch {
  readonly uploadId: string;
  readonly situationText: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly persistedFileType: string;
  readonly fileSizeBytes: number;
  readonly contentSha256: string;
}

export interface IngestUploadOptions {
  readonly beforeDispatch?: (prepared: Readonly<PreparedUploadDispatch>) => void | Promise<void>;
  /** Local file admission only; never selects or changes the server's accepted contract. */
  readonly metadataPolicyVersion?: typeof UPLOAD_RESOURCE_POLICY_VERSION | typeof UPLOAD_RESOURCE_POLICY_VERSION_V2;
}

const UPLOAD_UUID_V8_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_UPLOAD_SITUATION_CHARS = 30_000;
const MAX_UPLOAD_SUCCESS_BYTES = 128 * 1024;

function assertUploadMetadata(input: {
  fileName: string;
  mimeType: string;
  byteLength: number;
}, preflight: typeof preflightUploadMetadataV2): void {
  const result = preflight(input);
  if (result.ok) return;
  const status =
    result.code === "UPLOAD_TEXT_RESOURCE_LIMIT" || result.code === "UPLOAD_TOO_LARGE" ? 413 : 400;
  throw new ApiError(status, result.code, {
    error: {
      code: result.code,
      message: result.message,
      retryable: false,
    },
  });
}

async function prepareUploadDispatch(
  file: File,
  situationText: string,
  userId: string,
  preflight: typeof preflightUploadMetadataV2,
  processingPolicy?: typeof UPLOAD_SOURCE_PREPARATION_VERSION,
): Promise<Readonly<PreparedUploadDispatch>> {
  const normalisedName = String(file.name || "")
    .normalize("NFKC")
    .trim()
    .slice(0, 300);
  const rawNormalisedType = String(file.type || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
  // Multipart emits application/octet-stream for an untyped File. Capture
  // that actual wire value before hashing so the server derives the same ID.
  // Explicit MIME values and the server's historical JSON route are unchanged.
  const normalisedType = rawNormalisedType.slice(0, 200) || "application/octet-stream";
  const canonicalSituation = situationText.normalize("NFKC").trim();
  if (!normalisedName || canonicalSituation.length > MAX_UPLOAD_SITUATION_CHARS) {
    throw new ApiError(400, "UPLOAD_METADATA_INVALID", {
      error: {
        code: "UPLOAD_METADATA_INVALID",
        message: "The upload name or situation is invalid.",
        retryable: false,
      },
    });
  }
  assertUploadMetadata({
    fileName: normalisedName,
    mimeType: rawNormalisedType,
    byteLength: file.size,
  }, preflight);
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  assertUploadMetadata({
    fileName: normalisedName,
    mimeType: rawNormalisedType,
    byteLength: fileBytes.byteLength,
  }, preflight);
  if (fileBytes.byteLength !== file.size) {
    throw new ApiError(400, "UPLOAD_METADATA_INVALID", {
      error: {
        code: "UPLOAD_METADATA_INVALID",
        message: "The selected file changed before it could be uploaded. Choose it again.",
        retryable: false,
      },
    });
  }
  const contentSha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  // This is the exact immutable request contract independently recomputed by
  // ingest-upload. Deriving the UUID from it lets a lost-response replay after
  // a reload recover the same upload row without keeping browser-local state.
  const requestContract = {
    contract: processingPolicy ? "ingest-upload.request.v2" : "ingest-upload.request.v1",
    ...(processingPolicy ? { processing_policy_version: processingPolicy } : {}),
    filename: normalisedName,
    mime: normalisedType,
    byte_length: fileBytes.byteLength,
    content_sha256: contentSha256,
    situation_text: canonicalSituation,
  };
  const identityEnvelope = new TextEncoder().encode(
    JSON.stringify({
      contract: processingPolicy ? "ingest-upload.identity.v2" : "ingest-upload.identity.v1",
      user_id: userId,
      request: requestContract,
    }),
  );
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", identityEnvelope)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const variant = ((Number.parseInt(digest[16]!, 16) & 0x3) | 0x8).toString(16);
  const uploadId = [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `8${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
  const extensionIndex = normalisedName.lastIndexOf(".");
  const extension =
    extensionIndex === -1 ? "" : normalisedName.slice(extensionIndex + 1).toLowerCase();
  return Object.freeze({
    uploadId,
    situationText: canonicalSituation,
    fileName: normalisedName,
    mimeType: normalisedType,
    persistedFileType: normalisedType || extension || "unknown",
    fileSizeBytes: fileBytes.byteLength,
    contentSha256,
  });
}

function parseIngestUploadSuccess(
  value: unknown,
  prepared: Readonly<PreparedUploadDispatch>,
  ownerId: string,
): IngestUploadOutput {
  if (!isRecord(value) || !isRecord(value.confirm_payload)) {
    throw new Error("UPLOAD_RESPONSE_INVALID");
  }
  const hasMetadata = Object.hasOwn(value, "resource_policy_version") || Object.hasOwn(value, "extraction_format");
  const sourcePolicy = value.resource_policy_version === UPLOAD_RESOURCE_POLICY_VERSION_V2;
  const preflight = preflightUploadMetadataV2({ fileName: prepared.fileName, mimeType: prepared.mimeType,
    byteLength: prepared.fileSizeBytes });
  let metadata: Pick<IngestUploadOutput, "extraction_format" | "resource_policy_version"> = {};
  if (!preflight.ok || (preflight.format === "rtf" && !sourcePolicy)) throw new Error("UPLOAD_RESPONSE_INVALID");
  if (hasMetadata) {
    const policy = value.resource_policy_version;
    const format = value.extraction_format;
    if ((policy !== UPLOAD_RESOURCE_POLICY_VERSION && policy !== UPLOAD_RESOURCE_POLICY_VERSION_V2) ||
      format !== preflight.format) throw new Error("UPLOAD_RESPONSE_INVALID");
    metadata = { extraction_format: preflight.format, resource_policy_version: policy };
  }
  const extractedText = value.extracted_text;
  if (
    value.upload_id !== prepared.uploadId ||
    typeof value.upload_id !== "string" ||
    !UPLOAD_UUID_V8_PATTERN.test(value.upload_id) ||
    value.original_retained !== true ||
    value.classification_status !== "completed" ||
    typeof extractedText !== "string" ||
    extractedText.length < 1 ||
    extractedText.length > 20_000 ||
    !extractedText.trim() ||
    (!sourcePolicy && extractedText !== extractedText.trim())
  ) {
    throw new Error("UPLOAD_RESPONSE_INVALID");
  }
  if (value.credit_fallback !== undefined && !isOllamaCreditFallbackPolicy(value.credit_fallback)) {
    throw new Error("UPLOAD_RESPONSE_INVALID");
  }
  if (sourcePolicy) {
    const exactKeys = (record: Record<string, unknown>, keys: string[]) =>
      Object.keys(record).length === keys.length && keys.every(key => Object.hasOwn(record, key));
    const keys = ["upload_id", "extracted_text", "original_retained", "storage_path", "classification_status",
      "extraction_format", "resource_policy_version", "confirm_payload"];
    if (Object.hasOwn(value, "credit_fallback")) keys.push("credit_fallback");
    if (!exactKeys(value, keys) ||
      !exactKeys(value.confirm_payload, ["summary", "document_type", "structure", "filename", "char_count", "truncated"]) ||
      !Array.isArray(value.confirm_payload.structure) || value.confirm_payload.structure.some(section =>
        !isRecord(section) || !exactKeys(section, ["title", "items"])) ||
      typeof value.storage_path !== "string" || value.storage_path.length > 800 ||
      !value.storage_path.startsWith(`${ownerId}/${prepared.uploadId}/`) ||
      value.storage_path.split("/").some(part => !part || part === "." || part === "..") ||
      extractedText.includes("\u0000") ||
      new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(extractedText)) !== extractedText) {
      throw new Error("UPLOAD_RESPONSE_INVALID");
    }
  }
  let confirmation: IngestUploadConfirmPayload;
  try {
    confirmation = parseIngestUploadConfirmPayload(
      value.confirm_payload,
      prepared.fileName,
      extractedText,
    );
  } catch {
    throw new Error("UPLOAD_RESPONSE_INVALID");
  }
  return {
    ...metadata,
    ...(isOllamaCreditFallbackPolicy(value.credit_fallback) ? { credit_fallback: value.credit_fallback } : {}),
    upload_id: value.upload_id,
    extracted_text: extractedText,
    original_retained: true,
    classification_status: "completed",
    confirm_payload: {
      ...confirmation,
    },
  };
}

async function readBoundedUploadSuccess(response: Response): Promise<unknown> {
  const encoded = await response.text();
  if (new TextEncoder().encode(encoded).byteLength > MAX_UPLOAD_SUCCESS_BYTES) {
    throw new Error("UPLOAD_RESPONSE_INVALID");
  }
  return JSON.parse(encoded) as unknown;
}

export async function ingestUpload(
  file: File,
  situationText: string,
  requestContext: ApiRequestContext,
  options: IngestUploadOptions = {},
): Promise<IngestUploadOutput> {
  return dispatchUpload(file, situationText, requestContext, options, undefined, parseIngestUploadSuccess);
}

/** Explicit no-classification upload for Master Workspace; legacy intake keeps ingestUpload. */
export async function prepareUploadSource(
  file: File,
  situationText: string,
  requestContext: ApiRequestContext,
  options: IngestUploadOptions = {},
): Promise<SourcePreparedUpload> {
  return dispatchUpload(file, situationText, requestContext, options, UPLOAD_SOURCE_PREPARATION_VERSION,
    (value, prepared, ownerId) => {
      const metadata = preflightUploadMetadataV2({ fileName: prepared.fileName, mimeType: prepared.mimeType,
        byteLength: prepared.fileSizeBytes });
      if (!metadata.ok) throw new Error("UPLOAD_RESPONSE_INVALID");
      return parseSourcePreparedUpload(value, { uploadId: prepared.uploadId, ownerId, format: metadata.format });
    });
}

async function dispatchUpload<T>(
  file: File,
  situationText: string,
  requestContext: ApiRequestContext,
  options: IngestUploadOptions,
  processingPolicy: typeof UPLOAD_SOURCE_PREPARATION_VERSION | undefined,
  parseResult: (value: unknown, prepared: Readonly<PreparedUploadDispatch>, ownerId: string) => T | Promise<T>,
): Promise<T> {
  assertRequestCurrent(requestContext);
  // Local metadata admission and server processing are distinct captured policies.
  // Legacy requests retain their literal v1 identity and multipart fields.
  const metadataPolicy = options.metadataPolicyVersion === undefined
    ? (processingPolicy ? UPLOAD_RESOURCE_POLICY_VERSION_V2 : UPLOAD_RESOURCE_POLICY_VERSION)
    : options.metadataPolicyVersion;
  if (metadataPolicy !== UPLOAD_RESOURCE_POLICY_VERSION && metadataPolicy !== UPLOAD_RESOURCE_POLICY_VERSION_V2) {
    throw new Error("UPLOAD_METADATA_POLICY_UNSUPPORTED");
  }
  const preflight = metadataPolicy === UPLOAD_RESOURCE_POLICY_VERSION_V2 ? preflightUploadMetadataV2 : preflightUploadMetadata;
  const prepared = await prepareUploadDispatch(file, situationText, requestContext.expectedUserId, preflight, processingPolicy);
  assertRequestCurrent(requestContext);
  await options.beforeDispatch?.(prepared);
  assertRequestCurrent(requestContext);
  const form = new FormData();
  form.append("file", file);
  form.append("upload_id", prepared.uploadId);
  form.append("request_id", prepared.uploadId);
  if (processingPolicy) form.append("processing_policy_version", processingPolicy);
  if (prepared.situationText) form.append("situation_text", prepared.situationText);

  const request = async () => {
    assertRequestCurrent(requestContext);
    return fetch(`${config.baseUrl}/ingest-upload`, {
      method: "POST",
      headers: await authHeadersWithContentType(
        {
          "x-idempotency-key": prepared.uploadId,
          "x-request-id": prepared.uploadId,
        },
        requestContext,
      ),
      body: form,
      signal: requestContext.signal,
    });
  };
  let transportReplayUsed = false;
  let processingRecheckUsed = false;
  for (;;) {
    let response: Response;
    try {
      response = await request();
    } catch (error) {
      if (requestContext.signal.aborted || transportReplayUsed) throw error;
      assertRequestCurrent(requestContext);
      transportReplayUsed = true;
      continue;
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = (data as Record<string, unknown>).error as Record<string, unknown> | undefined;
      const processingIdentity = (data as Record<string, unknown>).upload_id;
      if (
        response.status === 409 &&
        error?.code === "UPLOAD_PROCESSING" &&
        processingIdentity === prepared.uploadId &&
        !processingRecheckUsed
      ) {
        processingRecheckUsed = true;
        const rawRetryAfter = response.headers.get("Retry-After") ?? "";
        const retryAfterMs = /^\d+(?:\.\d+)?$/.test(rawRetryAfter)
          ? Math.min(Number(rawRetryAfter) * 1_000, 2_000)
          : 250;
        if (retryAfterMs > 0) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, retryAfterMs);
            requestContext.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(requestContext.signal.reason ?? new DOMException("Aborted", "AbortError"));
              },
              { once: true },
            );
          });
        }
        continue;
      }
      throw new ApiError(response.status, String(error?.code ?? "UPLOAD_FAILED"), data);
    }
    let result: T;
    try {
      result = await parseResult(await readBoundedUploadSuccess(response), prepared, requestContext.expectedUserId);
    } catch (error) {
      if (requestContext.signal.aborted) throw error;
      assertRequestCurrent(requestContext);
      if (transportReplayUsed) {
        throw new ApiError(502, "UPLOAD_RESPONSE_INVALID", {});
      }
      transportReplayUsed = true;
      continue;
    }
    assertRequestCurrent(requestContext);
    return result;
  }
}

// ---- edit-section (streaming, Layer 9) -------------------------

export type EditAction = "improve" | "shorten" | "expand" | "change_tone" | "add_detail";

export interface EditSectionInput {
  action: EditAction;
  /** The current section content being edited. */
  content: string;
  /** Optional selected substring — only this is edited when present. */
  selection?: string;
  /** Optional steering, e.g. the target tone for "change_tone". */
  instruction?: string;
  domain?: string;
  clari?: Partial<ClariPreferences>;
  /** Present only for a persisted legacy section. Captured sections keep
   * their existing captured mutation RPC after proposal review. */
  persistence?: {
    operation_id: string;
    document_id: string;
    section_id: string;
    expected_section_revision: number;
  };
}

export interface EditDeltaEvent {
  type: "delta";
  text: string;
}

export interface EditChangesEvent {
  type: "changes";
  changes: string[];
}

export interface EditOperationEvent {
  type: "operation";
  operation_id: string;
  accepted_section_revision: number;
  accepted_content_sha256: string;
  idempotent_replay: boolean;
}

export interface EditResultEvent {
  type: "result";
  operation_id: string;
  accepted_section_revision: number;
  result_sha256: string;
  /** Exact full-section body persisted by the durable edit operation. */
  applied_candidate_content: string;
  /** SHA-256 of `applied_candidate_content`, verified before it reaches UI. */
  applied_candidate_sha256: string;
  state: "ready";
  idempotent_replay: boolean;
}

export interface EditSectionStreamResult {
  operation: EditOperationEvent | null;
  result: EditResultEvent | null;
}

async function sha256Text(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Stream an "Edit with TED" revision. Calls `onDelta` for each text chunk as
 * it arrives so the editor can render the edit progressively, and `onChanges`
 * once with the plain-language list of what TED changed (sent after the
 * content deltas, before the stream closes). Resolves when the stream
 * completes; rejects (or surfaces an error event) on failure. Pass an
 * AbortSignal to support a Cancel button.
 */
export async function editSectionStream(
  input: EditSectionInput,
  onDelta: (text: string) => void,
  onChanges: ((changes: string[]) => void) | undefined,
  requestContext: ApiRequestContext,
): Promise<EditSectionStreamResult> {
  assertRequestCurrent(requestContext);
  const persistence = input.persistence;
  const requestId = persistence?.operation_id ?? crypto.randomUUID();
  if (
    persistence
      ? !DURABLE_REQUEST_ID_PATTERN.test(requestId)
      : !REQUEST_UUID_V4_PATTERN.test(requestId)
  ) {
    throw new ApiError(400, "REQUEST_IDENTITY_INVALID", {});
  }
  const acceptedContentSha256 = persistence ? await sha256Text(input.content) : null;
  assertRequestCurrent(requestContext);
  const body = persistence
    ? {
        ...input,
        persistence: undefined,
        ...persistence,
        generation_request_id: requestId,
        accepted_content_sha256: acceptedContentSha256,
      }
    : { ...input, generation_request_id: requestId };
  const serializedBody = JSON.stringify(body);
  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      assertRequestCurrent(requestContext);
      res = await fetch(`${config.baseUrl}/edit-section`, {
        method: "POST",
        headers: await authHeadersWithContentType(
          {
            "Content-Type": "application/json",
            "x-idempotency-key": requestId,
            "x-request-id": requestId,
          },
          requestContext,
        ),
        body: serializedBody,
        signal: requestContext.signal,
      });
    } catch (error) {
      if (requestContext.signal.aborted || attempt === 1) throw error;
      continue;
    }
    if (!res.ok) {
      let data: unknown;
      try {
        data = await res.json();
      } catch {
        if (!requestContext.signal.aborted && attempt === 0) {
          res = null;
          continue;
        }
        data = {};
      }
      const err = (data as Record<string, unknown>).error as Record<string, unknown> | undefined;
      throw new ApiError(res.status, String(err?.code ?? "STREAM_FAILED"), data);
    }
    if (res.body) break;
    if (attempt === 1) {
      throw new ApiError(502, "STREAM_RESPONSE_MISSING", {});
    }
    res = null;
  }
  if (!res?.body) {
    throw new ApiError(502, "STREAM_RESPONSE_MISSING", {});
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let operation: EditOperationEvent | null = null;
  let result: EditResultEvent | null = null;
  let streamedContent = "";
  let malformedEventSeen = false;

  for (;;) {
    const { done, value } = await reader.read();
    assertRequestCurrent(requestContext);
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const raw of events) {
      const line = raw.replace(/^data: /, "").trim();
      if (!line || line === "[DONE]") continue;
      assertRequestCurrent(requestContext);
      try {
        const event = JSON.parse(line) as
          | EditDeltaEvent
          | EditChangesEvent
          | EditOperationEvent
          | EditResultEvent
          | { type: string; code?: string; error?: { code?: string } };
        if (event.type === "delta") {
          const text = (event as EditDeltaEvent).text;
          streamedContent += text;
          onDelta(text);
        } else if (event.type === "changes") {
          onChanges?.((event as EditChangesEvent).changes);
        } else if (event.type === "operation") {
          operation = event as EditOperationEvent;
        } else if (event.type === "result") {
          result = event as EditResultEvent;
        } else if (event.type === "error") {
          throw new ApiError(
            502,
            String(
              (event as { code?: string; error?: { code?: string } }).error?.code ??
                (event as { code?: string }).code ??
                "EDIT_FAILED",
            ),
            event,
          );
        }
      } catch (err) {
        if (err instanceof ApiError) throw err;
        malformedEventSeen = true;
      }
    }
  }
  if (persistence && malformedEventSeen) {
    throw new ApiError(502, "EDIT_DURABLE_RESULT_INVALID", {
      error: { code: "EDIT_DURABLE_RESULT_INVALID" },
    });
  }
  if (persistence && (!operation || !result)) {
    throw new ApiError(502, "EDIT_DURABLE_RESULT_MISSING", {
      error: { code: "EDIT_DURABLE_RESULT_MISSING" },
    });
  }
  if (persistence && operation && result) {
    const candidate = result.applied_candidate_content;
    const candidateSha256 = result.applied_candidate_sha256;
    const valid =
      REQUEST_UUID_V4_PATTERN.test(operation.operation_id) &&
      operation.operation_id === requestId &&
      REQUEST_UUID_V4_PATTERN.test(result.operation_id) &&
      result.operation_id === requestId &&
      Number.isInteger(operation.accepted_section_revision) &&
      operation.accepted_section_revision === persistence.expected_section_revision &&
      result.accepted_section_revision === operation.accepted_section_revision &&
      SHA256_PATTERN.test(operation.accepted_content_sha256) &&
      operation.accepted_content_sha256 === acceptedContentSha256 &&
      SHA256_PATTERN.test(result.result_sha256) &&
      SHA256_PATTERN.test(candidateSha256) &&
      typeof candidate === "string" &&
      candidate.trim().length > 0 &&
      result.state === "ready" &&
      typeof operation.idempotent_replay === "boolean" &&
      typeof result.idempotent_replay === "boolean" &&
      result.result_sha256 === (await sha256Text(streamedContent)) &&
      candidateSha256 === (await sha256Text(candidate));
    assertRequestCurrent(requestContext);
    if (!valid) {
      throw new ApiError(502, "EDIT_DURABLE_RESULT_INVALID", {
        error: { code: "EDIT_DURABLE_RESULT_INVALID" },
      });
    }
  }
  assertRequestCurrent(requestContext);
  return { operation, result };
}

// ---- explain-section ------------------------------------------

export interface ExplainSectionInput extends ModelRequestIdentity {
  content: string;
  selection?: string;
  question?: string;
  section_name?: string;
  domain?: string;
  clari?: Partial<ClariPreferences>;
}

export type ExplainSectionOutput = ExplainResult;

export async function explainSection(
  input: ExplainSectionInput,
  requestContext: ApiRequestContext,
): Promise<ExplainSectionOutput> {
  const raw = await postModelJson<unknown>("explain-section", input, requestContext);
  const parsed = validateExplainResult(raw);
  if (!parsed) {
    throw new ApiError(502, "EXPLAIN_FAILED", raw);
  }
  return parsed;
}

// ---- render-export (Layer 11) ----------------------------------

export type DocumentExportFormat = "pdf" | "word" | "excel";

export interface RenderExportInput {
  document_id?: string;
  artifact_id?: string;
  title: string;
  format: DocumentExportFormat;
  sections: Section[];
  brand_kit?: BrandKit | null;
  lede?: string;
  budget?: Record<string, number>;
  unresolved_placeholders?: DocumentPlaceholderMetadata[];
  placeholder_acknowledged?: boolean;
  captured_export_id?: string;
  captured_operation_id?: string;
  captured_expected_operation_revision?: number;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  approvedSections: number;
  capturedExportId: string | null;
}

/**
 * Render and download an export. The server re-validates the approval gate
 * and returns the artifact as a binary stream. Throws ApiError (code
 * "EXPORT_GATE") if a required section isn't approved.
 */
export async function renderExport(
  input: RenderExportInput,
  requestContext: ApiRequestContext,
): Promise<ExportResult> {
  assertRequestCurrent(requestContext);
  const captured =
    input.captured_export_id !== undefined ||
    input.captured_operation_id !== undefined ||
    input.captured_expected_operation_revision !== undefined;
  const requestId = captured ? null : crypto.randomUUID();
  const body = JSON.stringify(requestId ? { ...input, request_id: requestId } : input);

  const request = async (): Promise<ExportResult> => {
    assertRequestCurrent(requestContext);
    const headers = await authHeaders(requestContext);
    if (requestId) {
      headers["x-idempotency-key"] = requestId;
      headers["x-request-id"] = requestId;
    }
    const res = await fetch(`${config.baseUrl}/render-export`, {
      method: "POST",
      headers,
      body,
      signal: requestContext.signal,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = (data as Record<string, unknown>).error as Record<string, unknown> | undefined;
      throw new ApiError(res.status, String(err?.code ?? "EXPORT_FAILED"), data);
    }

    const capturedExportId = res.headers.get("X-Captured-Export-Id");
    if (captured && (!input.captured_export_id || capturedExportId !== input.captured_export_id)) {
      throw new ApiError(502, "CAPTURED_EXPORT_RESPONSE_INVALID", {
        error: { code: "CAPTURED_EXPORT_RESPONSE_INVALID" },
      });
    }
    const blob = await res.blob();
    assertRequestCurrent(requestContext);
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match?.[1] ?? `${input.title || "document"}.pdf`;
    const approvedSections = Number(res.headers.get("X-Approved-Sections") ?? "0");
    return { blob, filename, approvedSections, capturedExportId };
  };

  try {
    return await request();
  } catch (error) {
    if (captured || requestContext.signal.aborted || error instanceof ApiError) throw error;
    return await request();
  }
}

// ---- Re-exports of domain types --------------------------------

export type {
  BrandKit,
  Bundle,
  ChecklistItem,
  ClariPreferences,
  CompanyProfile,
  Document,
  Outcome,
  Profile,
  RecommendationPayload,
  Section,
  Subscription,
  Template,
  Upload,
};
