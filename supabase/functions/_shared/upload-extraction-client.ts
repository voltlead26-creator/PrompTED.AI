import {
  MAX_EXTRACTED_TEXT_CHARS,
  type UploadExtractionResult,
  UPLOAD_RESOURCE_POLICY_VERSION,
} from "./upload-extraction-contract.ts";

const DEFAULT_EXTRACTION_TIMEOUT_MS = 30_000;
const MAX_EXTRACTION_TIMEOUT_MS = 60_000;
const MAX_EXTRACTION_RESPONSE_BYTES = 64 * 1024;
const PROMPTED_SUPABASE_PROJECT_REF = "jjsykocqpjlekgsbylkd";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

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
}

export interface IsolatedUploadExtractionResult extends UploadExtractionResult {
  contentSha256: string;
}

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
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
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

async function readBoundedResponse(
  response: Response,
): Promise<Record<string, unknown>> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) ||
      Number(contentLength) > MAX_EXTRACTION_RESPONSE_BYTES)
  ) throw new Error("UPLOAD_EXTRACTION_RESPONSE_INVALID");
  if (!response.body) throw new Error("UPLOAD_EXTRACTION_RESPONSE_INVALID");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_EXTRACTION_RESPONSE_BYTES) {
        await reader.cancel("UPLOAD_EXTRACTION_RESPONSE_TOO_LARGE");
        throw new Error("UPLOAD_EXTRACTION_RESPONSE_INVALID");
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
  const parsed = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("UPLOAD_EXTRACTION_RESPONSE_INVALID");
  }
  return parsed as Record<string, unknown>;
}

function validateInput(input: IsolatedUploadExtractionInput): void {
  if (
    !UUID_PATTERN.test(input.uploadId) || !UUID_PATTERN.test(input.userId) ||
    !UUID_PATTERN.test(input.claimToken) ||
    !SHA256_PATTERN.test(input.requestSha256)
  ) throw new Error("UPLOAD_EXTRACTION_REQUEST_INVALID");
}

function normalizeSuccess(
  input: IsolatedUploadExtractionInput,
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
    typeof body.text !== "string" || body.text.length > MAX_EXTRACTED_TEXT_CHARS ||
    !["pdf", "docx", "xlsx", "text"].includes(String(body.format)) ||
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

export async function requestIsolatedUploadExtraction(
  input: IsolatedUploadExtractionInput,
  runtime: UploadExtractionClientRuntime = uploadExtractionClientRuntime(),
  fetcher: ExtractionFetcher = fetch,
): Promise<IsolatedUploadExtractionResult> {
  validateInput(input);
  if (
    !runtime.serviceRoleKey || !Number.isSafeInteger(runtime.timeoutMs) ||
    runtime.timeoutMs < 1_000 || runtime.timeoutMs > MAX_EXTRACTION_TIMEOUT_MS
  ) throw new Error("UPLOAD_EXTRACTION_CONFIGURATION_INVALID");
  // Resolve and validate the privileged destination before entering the network
  // error boundary so a configuration error cannot be disguised as a retryable
  // outage and no service-role credential can reach an unintended origin.
  const targetUrl = extractionUrl(runtime.baseUrl);
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(input.signal?.reason);
  if (input.signal?.aborted) abortFromCaller();
  else input.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), runtime.timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetcher(targetUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${runtime.serviceRoleKey}`,
          apikey: runtime.serviceRoleKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          upload_id: input.uploadId,
          user_id: input.userId,
          request_sha256: input.requestSha256,
          claim_token: input.claimToken,
        }),
        signal: controller.signal,
        redirect: "error",
      });
    } catch {
      throw new IsolatedUploadExtractionError(
        503,
        "UPLOAD_EXTRACTION_UNAVAILABLE",
        "TED could not reach the safe extraction boundary. Please retry this upload.",
        true,
      );
    }
    let body: Record<string, unknown>;
    try {
      body = await readBoundedResponse(response);
    } catch {
      throw new IsolatedUploadExtractionError(
        503,
        "UPLOAD_EXTRACTION_RESPONSE_INVALID",
        "TED received an invalid response from the safe extraction boundary.",
        true,
      );
    }
    if (!response.ok) throw normalizeFailure(response, body);
    try {
      return normalizeSuccess(input, body);
    } catch {
      throw new IsolatedUploadExtractionError(
        503,
        "UPLOAD_EXTRACTION_RESPONSE_INVALID",
        "TED received an invalid response from the safe extraction boundary.",
        true,
      );
    }
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abortFromCaller);
  }
}
