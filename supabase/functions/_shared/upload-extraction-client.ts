import {
  MAX_EXTRACTED_TEXT_CHARS,
  MAX_UPLOAD_BYTES,
  UPLOAD_EXTRACTION_CONTRACT_V1,
  UPLOAD_EXTRACTION_CONTRACT_V2,
  UPLOAD_EXTRACTION_CONTRACT_V3,
  UPLOAD_RESOURCE_POLICY_VERSION,
  UPLOAD_RESOURCE_POLICY_VERSION_V2,
  type UploadExtractionResult,
} from "./upload-extraction-contract.ts";
import {
  DOCX_SOURCE_POLICY,
  normalizeDocxSourceManifest,
  normalizeRtfSourceManifest,
  type SourceUploadExtractionResult,
  type SourceUploadExtractionResultV3,
} from "./document-source-contract.ts";

const DEFAULT_EXTRACTION_TIMEOUT_MS = 30_000;
const MAX_EXTRACTION_TIMEOUT_MS = 60_000;
const MAX_EXTRACTION_RESPONSE_BYTES = 64 * 1024;
export const MAX_SOURCE_EXTRACTION_RESPONSE_BYTES =
  MAX_EXTRACTION_RESPONSE_BYTES + DOCX_SOURCE_POLICY.maxManifestBytes + 128;
// Admit even a full-size response delivered one byte at a time, while bounding
// empty-chunk producers that can otherwise starve the timeout's event loop.
const PROMPTED_SUPABASE_PROJECT_REF = "jjsykocqpjlekgsbylkd";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const TIMEOUT_REASON = Symbol("upload-extraction-timeout");

type ExtractionFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface IsolatedUploadExtractionInput {
  uploadId: string;
  userId: string;
  requestSha256: string;
  claimToken: string;
  signal?: AbortSignal;
  extractionContractVersion?: typeof UPLOAD_EXTRACTION_CONTRACT_V1;
}

export interface IsolatedSourceUploadExtractionInput
  extends Omit<IsolatedUploadExtractionInput, "extractionContractVersion"> {
  extractionContractVersion: typeof UPLOAD_EXTRACTION_CONTRACT_V2;
  expectedContentSha256: string;
  expectedByteLength: number;
}

export interface IsolatedSourceUploadExtractionInputV3
  extends
    Omit<IsolatedSourceUploadExtractionInput, "extractionContractVersion"> {
  extractionContractVersion: typeof UPLOAD_EXTRACTION_CONTRACT_V3;
}

type AcceptedExtractionInput =
  | IsolatedUploadExtractionInput
  | IsolatedSourceUploadExtractionInput
  | IsolatedSourceUploadExtractionInputV3;

export interface IsolatedUploadExtractionResult extends UploadExtractionResult {
  contentSha256: string;
}

export type IsolatedSourceUploadExtractionResult =
  & SourceUploadExtractionResult
  & {
    contentSha256: string;
    contentByteLength: number;
    extractionContractVersion: typeof UPLOAD_EXTRACTION_CONTRACT_V2;
  };

export type IsolatedSourceUploadExtractionResultV3 =
  & SourceUploadExtractionResultV3
  & {
    contentSha256: string;
    contentByteLength: number;
    extractionContractVersion: typeof UPLOAD_EXTRACTION_CONTRACT_V3;
  };

type AcceptedExtractionResult =
  | IsolatedUploadExtractionResult
  | IsolatedSourceUploadExtractionResult
  | IsolatedSourceUploadExtractionResultV3;

export interface UploadExtractionClientRuntime {
  baseUrl: string;
  serviceRoleKey: string;
  timeoutMs: number;
}

export class IsolatedUploadExtractionError extends Error {
  constructor(
    readonly status: 409 | 413 | 422 | 503,
    readonly code: string,
    readonly publicMessage: string,
    readonly retryable: boolean,
  ) {
    super(`${code}: ${publicMessage}`);
    this.name = "IsolatedUploadExtractionError";
  }
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_EXTRACTION_TIMEOUT_MS;
  }
  if (!/^\d+$/.test(value.trim())) {
    throw new Error("UPLOAD_EXTRACTION_CONFIGURATION_INVALID");
  }
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) || parsed < 1_000 ||
    parsed > MAX_EXTRACTION_TIMEOUT_MS
  ) throw new Error("UPLOAD_EXTRACTION_CONFIGURATION_INVALID");
  return parsed;
}

export function uploadExtractionClientRuntime(): UploadExtractionClientRuntime {
  const baseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ??
    "";
  if (!baseUrl || !serviceRoleKey) {
    throw new Error("UPLOAD_EXTRACTION_CONFIGURATION_INVALID");
  }
  return {
    baseUrl,
    serviceRoleKey,
    timeoutMs: parseTimeout(Deno.env.get("UPLOAD_EXTRACTION_TIMEOUT_MS")),
  };
}

function extractionUrl(baseUrl: string): URL {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new Error("UPLOAD_EXTRACTION_CONFIGURATION_INVALID");
  }
  const localHttp = base.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(base.hostname);
  const exactHostedProject = base.protocol === "https:" &&
    base.hostname === `${PROMPTED_SUPABASE_PROJECT_REF}.supabase.co` &&
    base.port === "";
  if (
    (!exactHostedProject && !localHttp) || base.username || base.password ||
    base.pathname !== "/" || base.search || base.hash
  ) throw new Error("UPLOAD_EXTRACTION_CONFIGURATION_INVALID");
  return new URL("/functions/v1/extract-upload", base.origin);
}

function interrupted(signal: AbortSignal): IsolatedUploadExtractionError {
  const timedOut = signal.reason === TIMEOUT_REASON;
  return new IsolatedUploadExtractionError(
    503,
    timedOut ? "UPLOAD_EXTRACTION_TIMEOUT" : "UPLOAD_EXTRACTION_CANCELLED",
    timedOut
      ? "The document reader did not finish in time. Please retry this exact upload."
      : "Reading this upload was cancelled. You can retry this exact upload.",
    true,
  );
}

function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw interrupted(signal);
}

// Observe our own deadline even if a transport ignores its fetch signal.
// Both settlement handlers remain attached after abort, so late rejection is
// consumed and cannot escape as an unhandled promise rejection.
function untilAborted<T>(
  work: Promise<T>,
  signal: AbortSignal,
  disposeAbandoned?: (value: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(interrupted(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) {
          disposeAbandoned?.(value);
          reject(interrupted(signal));
        } else resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(signal.aborted ? interrupted(signal) : error);
      },
    );
    if (signal.aborted) onAbort();
  });
}

function cancelUnread(
  source: ReadableStream<Uint8Array> | ReadableStreamDefaultReader<Uint8Array>,
): void {
  try {
    // Rejection is already the user-visible result. A remote cancel promise
    // must not postpone it indefinitely or mask it with a cleanup error.
    void source.cancel("UPLOAD_EXTRACTION_READ_ABANDONED").catch(() => {});
  } catch {
    // Preserve the existing rejection if cleanup cannot be initiated.
  }
}

async function readBoundedResponse(
  response: Response,
  signal: AbortSignal,
  maximumBytes: number,
  assertBudget: () => void,
): Promise<Record<string, unknown>> {
  if (!response.body) throw new Error("UPLOAD_EXTRACTION_RESPONSE_INVALID");
  const reader = response.body.getReader();
  // Fixed storage bounds memory even for a one-byte-at-a-time source response.
  const bytes = new Uint8Array(maximumBytes);
  let total = 0;
  let chunkCount = 0;
  let finished = false;
  try {
    assertBudget();
    const contentLength = response.headers.get("content-length");
    if (
      contentLength !== null &&
      (!/^\d+$/.test(contentLength) ||
        Number(contentLength) > maximumBytes)
    ) throw new Error("UPLOAD_EXTRACTION_RESPONSE_INVALID");
    while (true) {
      assertBudget();
      const { done, value } = await untilAborted(reader.read(), signal);
      assertBudget();
      if (done) {
        finished = true;
        break;
      }
      chunkCount += 1;
      if (
        !(value instanceof Uint8Array) ||
        chunkCount > maximumBytes
      ) throw new Error("UPLOAD_EXTRACTION_RESPONSE_INVALID");
      if (value.byteLength > maximumBytes - total) {
        throw new Error("UPLOAD_EXTRACTION_RESPONSE_INVALID");
      }
      bytes.set(value, total);
      total += value.byteLength;
    }
  } finally {
    if (!finished) cancelUnread(reader);
    reader.releaseLock();
  }
  assertBudget();
  const parsed = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, total)),
  );
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("UPLOAD_EXTRACTION_RESPONSE_INVALID");
  }
  return parsed as Record<string, unknown>;
}

function validateInput(input: AcceptedExtractionInput): void {
  if (
    input.extractionContractVersion === UPLOAD_EXTRACTION_CONTRACT_V3 &&
    [input.uploadId, input.userId, input.requestSha256, input.claimToken].some((
      value,
    ) => typeof value !== "string")
  ) {
    throw new Error("UPLOAD_EXTRACTION_REQUEST_INVALID");
  }
  if (
    !UUID_PATTERN.test(input.uploadId) || !UUID_PATTERN.test(input.userId) ||
    !UUID_PATTERN.test(input.claimToken) ||
    !SHA256_PATTERN.test(input.requestSha256)
  ) throw new Error("UPLOAD_EXTRACTION_REQUEST_INVALID");
  if (
    input.extractionContractVersion === UPLOAD_EXTRACTION_CONTRACT_V2 ||
    input.extractionContractVersion === UPLOAD_EXTRACTION_CONTRACT_V3
  ) {
    if (
      typeof input.expectedContentSha256 !== "string" ||
      !SHA256_PATTERN.test(input.expectedContentSha256) ||
      !Number.isSafeInteger(input.expectedByteLength) ||
      input.expectedByteLength < 1 ||
      input.expectedByteLength > MAX_UPLOAD_BYTES
    ) throw new Error("UPLOAD_EXTRACTION_REQUEST_INVALID");
  } else if (
    input.extractionContractVersion !== undefined &&
    input.extractionContractVersion !== UPLOAD_EXTRACTION_CONTRACT_V1
  ) throw new Error("UPLOAD_EXTRACTION_REQUEST_INVALID");
}

function normalizeSuccess(
  input: AcceptedExtractionInput,
  body: Record<string, unknown>,
): IsolatedUploadExtractionResult {
  const keys = Object.keys(body).sort();
  const expected = [
    "claim_token",
    "content_sha256",
    "format",
    "request_sha256",
    "resource_policy_version",
    "text",
    "truncated",
    "upload_id",
    "user_id",
  ];
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    body.upload_id !== input.uploadId || body.user_id !== input.userId ||
    body.request_sha256 !== input.requestSha256 ||
    body.claim_token !== input.claimToken ||
    typeof body.content_sha256 !== "string" ||
    !SHA256_PATTERN.test(body.content_sha256) ||
    typeof body.text !== "string" ||
    body.text.length > MAX_EXTRACTED_TEXT_CHARS ||
    typeof body.format !== "string" ||
    !["pdf", "docx", "xlsx", "text"].includes(body.format) ||
    typeof body.truncated !== "boolean" ||
    body.resource_policy_version !== UPLOAD_RESOURCE_POLICY_VERSION
  ) throw new Error("UPLOAD_EXTRACTION_RESPONSE_INVALID");
  return {
    contentSha256: body.content_sha256,
    text: body.text,
    format: body.format as UploadExtractionResult["format"],
    truncated: body.truncated,
    resourcePolicyVersion: UPLOAD_RESOURCE_POLICY_VERSION,
  };
}

/** Strict v2 response contract, shared by the privileged producer and caller. */
export async function normalizeSourceExtractionResponse(
  input: IsolatedSourceUploadExtractionInput,
  body: Record<string, unknown>,
  signal: AbortSignal,
  deadline: number,
): Promise<IsolatedSourceUploadExtractionResult> {
  const accepted = { ...input };
  validateInput(accepted);
  if (
    accepted.extractionContractVersion !== UPLOAD_EXTRACTION_CONTRACT_V2 ||
    !Number.isFinite(deadline)
  ) throw new Error("UPLOAD_EXTRACTION_REQUEST_INVALID");
  assertActive(signal);
  if (Date.now() >= deadline) {
    throw new Error("UPLOAD_EXTRACTION_DEADLINE_EXCEEDED");
  }
  const {
    extraction_contract_version,
    content_byte_length,
    source_manifest,
    ...legacy
  } = body;
  if (
    extraction_contract_version !== UPLOAD_EXTRACTION_CONTRACT_V2 ||
    content_byte_length !== accepted.expectedByteLength ||
    body.content_sha256 !== accepted.expectedContentSha256 ||
    !Object.hasOwn(body, "source_manifest") ||
    new TextEncoder().encode(
        JSON.stringify({
          ...legacy,
          extraction_contract_version,
          content_byte_length,
        }),
      ).byteLength >
      MAX_EXTRACTION_RESPONSE_BYTES
  ) throw new Error("UPLOAD_EXTRACTION_RESPONSE_INVALID");
  const result = normalizeSuccess(accepted, legacy);
  if (result.format === "docx") {
    const sourceManifest = await normalizeDocxSourceManifest(source_manifest, {
      contentSha256: accepted.expectedContentSha256,
      byteLength: accepted.expectedByteLength,
      signal,
      deadline,
    });
    assertActive(signal);
    if (Date.now() >= deadline) {
      throw new Error("UPLOAD_EXTRACTION_DEADLINE_EXCEEDED");
    }
    return Object.freeze({
      ...result,
      format: "docx",
      contentByteLength: accepted.expectedByteLength,
      extractionContractVersion: UPLOAD_EXTRACTION_CONTRACT_V2,
      sourceManifest,
    });
  }
  if (source_manifest !== null) {
    throw new Error("UPLOAD_EXTRACTION_RESPONSE_INVALID");
  }
  assertActive(signal);
  if (Date.now() >= deadline) {
    throw new Error("UPLOAD_EXTRACTION_DEADLINE_EXCEEDED");
  }
  return Object.freeze({
    ...result,
    format: result.format,
    contentByteLength: accepted.expectedByteLength,
    extractionContractVersion: UPLOAD_EXTRACTION_CONTRACT_V2,
    sourceManifest: null,
  });
}

/** V3 is a new wire contract; no reinterpretation through the legacy text variant. */
export async function normalizeSourceExtractionResponseV3(
  input: IsolatedSourceUploadExtractionInputV3,
  body: Record<string, unknown>,
  signal: AbortSignal,
  deadline: number,
): Promise<IsolatedSourceUploadExtractionResultV3> {
  const accepted = { ...input };
  validateInput(accepted);
  if (
    accepted.extractionContractVersion !== UPLOAD_EXTRACTION_CONTRACT_V3 ||
    !Number.isFinite(deadline)
  ) throw new Error("UPLOAD_EXTRACTION_REQUEST_INVALID");
  const assertBudget = () => {
    assertActive(signal);
    if (Date.now() >= deadline) {
      throw new Error("UPLOAD_EXTRACTION_DEADLINE_EXCEEDED");
    }
  };
  assertBudget();
  const keys = [
    "claim_token",
    "content_sha256",
    "content_byte_length",
    "format",
    "request_sha256",
    "resource_policy_version",
    "text",
    "truncated",
    "upload_id",
    "user_id",
    "extraction_contract_version",
    "source_manifest",
  ];
  const format = body.format;
  if (
    Object.keys(body).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(body, key)) ||
    body.upload_id !== accepted.uploadId || body.user_id !== accepted.userId ||
    body.request_sha256 !== accepted.requestSha256 ||
    body.claim_token !== accepted.claimToken ||
    body.content_sha256 !== accepted.expectedContentSha256 ||
    body.content_byte_length !== accepted.expectedByteLength ||
    body.extraction_contract_version !== UPLOAD_EXTRACTION_CONTRACT_V3 ||
    body.resource_policy_version !== UPLOAD_RESOURCE_POLICY_VERSION_V2 ||
    typeof body.text !== "string" ||
    body.text.length > MAX_EXTRACTED_TEXT_CHARS ||
    typeof body.truncated !== "boolean" ||
    (format !== "rtf" && format !== "docx" && format !== "pdf" &&
      format !== "xlsx" && format !== "text")
  ) {
    throw new Error("UPLOAD_EXTRACTION_RESPONSE_INVALID");
  }
  const { source_manifest, ...envelope } = body;
  if (
    new TextEncoder().encode(JSON.stringify(envelope)).byteLength >
      MAX_EXTRACTION_RESPONSE_BYTES
  ) {
    throw new Error("UPLOAD_EXTRACTION_RESPONSE_INVALID");
  }
  for (const character of body.text) {
    const scalar = character.codePointAt(0)!;
    if (scalar >= 0xd800 && scalar <= 0xdfff || scalar === 0) {
      throw new Error("UPLOAD_EXTRACTION_RESPONSE_INVALID");
    }
  }
  const result = {
    contentSha256: accepted.expectedContentSha256,
    contentByteLength: accepted.expectedByteLength,
    extractionContractVersion: UPLOAD_EXTRACTION_CONTRACT_V3,
    resourcePolicyVersion: UPLOAD_RESOURCE_POLICY_VERSION_V2,
    text: body.text,
    truncated: body.truncated,
  } as const;
  const binding = {
    contentSha256: result.contentSha256,
    byteLength: result.contentByteLength,
    signal,
    deadline,
  };
  if (format === "rtf") {
    const sourceManifest = await normalizeRtfSourceManifest(source_manifest, {
      ...binding,
      extractedText: result.text,
    });
    assertBudget();
    return Object.freeze({ ...result, format, sourceManifest });
  }
  if (format === "docx") {
    const sourceManifest = await normalizeDocxSourceManifest(
      source_manifest,
      binding,
    );
    assertBudget();
    return Object.freeze({ ...result, format, sourceManifest });
  }
  if (source_manifest !== null) {
    throw new Error("UPLOAD_EXTRACTION_RESPONSE_INVALID");
  }
  assertBudget();
  return Object.freeze({ ...result, format, sourceManifest: null });
}

function normalizeFailure(
  response: Response,
  body: Record<string, unknown>,
): IsolatedUploadExtractionError {
  const error = body.error;
  const retryable = body.retryable;
  if (
    !error || typeof error !== "object" || Array.isArray(error) ||
    typeof (error as Record<string, unknown>).code !== "string" ||
    typeof (error as Record<string, unknown>).message !== "string" ||
    typeof retryable !== "boolean"
  ) {
    return new IsolatedUploadExtractionError(
      503,
      "UPLOAD_EXTRACTION_RESPONSE_INVALID",
      "TED received an invalid response from the safe extraction boundary.",
      true,
    );
  }
  const status = [409, 413, 422, 503].includes(response.status)
    ? response.status as 409 | 413 | 422 | 503
    : 503;
  return new IsolatedUploadExtractionError(
    status,
    String((error as Record<string, unknown>).code).slice(0, 100),
    String((error as Record<string, unknown>).message).slice(0, 500),
    status === 503 ? true : retryable,
  );
}

export function requestIsolatedUploadExtraction(
  input: IsolatedSourceUploadExtractionInputV3,
  runtime?: UploadExtractionClientRuntime,
  fetcher?: ExtractionFetcher,
): Promise<IsolatedSourceUploadExtractionResultV3>;
export function requestIsolatedUploadExtraction(
  input: IsolatedSourceUploadExtractionInput,
  runtime?: UploadExtractionClientRuntime,
  fetcher?: ExtractionFetcher,
): Promise<IsolatedSourceUploadExtractionResult>;
export function requestIsolatedUploadExtraction(
  input: IsolatedUploadExtractionInput,
  runtime?: UploadExtractionClientRuntime,
  fetcher?: ExtractionFetcher,
): Promise<IsolatedUploadExtractionResult>;
export function requestIsolatedUploadExtraction(
  input: IsolatedUploadExtractionInput | IsolatedSourceUploadExtractionInput,
  runtime?: UploadExtractionClientRuntime,
  fetcher?: ExtractionFetcher,
): Promise<
  IsolatedUploadExtractionResult | IsolatedSourceUploadExtractionResult
>;
export function requestIsolatedUploadExtraction(
  input: AcceptedExtractionInput,
  runtime?: UploadExtractionClientRuntime,
  fetcher?: ExtractionFetcher,
): Promise<AcceptedExtractionResult>;
export async function requestIsolatedUploadExtraction(
  input: AcceptedExtractionInput,
  runtime: UploadExtractionClientRuntime = uploadExtractionClientRuntime(),
  fetcher: ExtractionFetcher = fetch,
): Promise<AcceptedExtractionResult> {
  // Capture request identity and the cancellation owner before yielding.
  const acceptedInput = { ...input };
  validateInput(acceptedInput);
  if (
    !runtime.serviceRoleKey || !Number.isSafeInteger(runtime.timeoutMs) ||
    runtime.timeoutMs < 1_000 || runtime.timeoutMs > MAX_EXTRACTION_TIMEOUT_MS
  ) throw new Error("UPLOAD_EXTRACTION_CONFIGURATION_INVALID");
  // Resolve and validate the privileged destination before entering the network
  // error boundary so a configuration error cannot be disguised as a retryable
  // outage and no service-role credential can reach an unintended origin.
  const targetUrl = extractionUrl(runtime.baseUrl);
  const sourceContract =
    acceptedInput.extractionContractVersion === UPLOAD_EXTRACTION_CONTRACT_V2 ||
    acceptedInput.extractionContractVersion === UPLOAD_EXTRACTION_CONTRACT_V3;
  const deadline = Date.now() + runtime.timeoutMs;
  const controller = new AbortController();
  const assertBudget = () => {
    // Immediately resolved stream/digest work can defer timer callbacks.
    // Enforce the same absolute deadline at every read and publication fence.
    if (Date.now() >= deadline && !controller.signal.aborted) {
      controller.abort(TIMEOUT_REASON);
    }
    assertActive(controller.signal);
  };
  const callerSignal = acceptedInput.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(
    () => controller.abort(TIMEOUT_REASON),
    runtime.timeoutMs,
  );
  try {
    let response: Response;
    try {
      assertBudget();
      const dispatched = fetcher(targetUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${runtime.serviceRoleKey}`,
          apikey: runtime.serviceRoleKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          upload_id: acceptedInput.uploadId,
          user_id: acceptedInput.userId,
          request_sha256: acceptedInput.requestSha256,
          claim_token: acceptedInput.claimToken,
          ...(sourceContract
            ? {
              extraction_contract_version:
                acceptedInput.extractionContractVersion,
            }
            : {}),
        }),
        signal: controller.signal,
        redirect: "error",
      });
      response = await untilAborted(
        dispatched,
        controller.signal,
        (lateResponse) => {
          if (lateResponse.body) cancelUnread(lateResponse.body);
        },
      );
      if (controller.signal.aborted || Date.now() >= deadline) {
        if (response.body) cancelUnread(response.body);
        assertBudget();
      }
    } catch {
      assertBudget();
      throw new IsolatedUploadExtractionError(
        503,
        "UPLOAD_EXTRACTION_UNAVAILABLE",
        "TED could not reach the safe extraction boundary. Please retry this upload.",
        true,
      );
    }
    let body: Record<string, unknown>;
    try {
      body = await readBoundedResponse(
        response,
        controller.signal,
        response.ok && sourceContract
          ? MAX_SOURCE_EXTRACTION_RESPONSE_BYTES
          : MAX_EXTRACTION_RESPONSE_BYTES,
        assertBudget,
      );
      assertBudget();
    } catch {
      assertBudget();
      throw new IsolatedUploadExtractionError(
        503,
        "UPLOAD_EXTRACTION_RESPONSE_INVALID",
        "TED received an invalid response from the safe extraction boundary.",
        true,
      );
    }
    if (!response.ok) throw normalizeFailure(response, body);
    try {
      const result = acceptedInput.extractionContractVersion ===
          UPLOAD_EXTRACTION_CONTRACT_V3
        ? await untilAborted(
          normalizeSourceExtractionResponseV3(
            acceptedInput,
            body,
            controller.signal,
            deadline,
          ),
          controller.signal,
        )
        : acceptedInput.extractionContractVersion ===
            UPLOAD_EXTRACTION_CONTRACT_V2
        ? await untilAborted(
          normalizeSourceExtractionResponse(
            acceptedInput,
            body,
            controller.signal,
            deadline,
          ),
          controller.signal,
        )
        : normalizeSuccess(acceptedInput, body);
      assertBudget();
      return result;
    } catch {
      assertBudget();
      throw new IsolatedUploadExtractionError(
        503,
        "UPLOAD_EXTRACTION_RESPONSE_INVALID",
        "TED received an invalid response from the safe extraction boundary.",
        true,
      );
    }
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}
