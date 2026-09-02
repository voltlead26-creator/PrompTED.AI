import { MAX_UPLOAD_BYTES } from "./upload-extraction-contract.ts";

const DEFAULT_STORAGE_REQUEST_TIMEOUT_MS = 60_000;
const MAX_STORAGE_REQUEST_TIMEOUT_MS = 90_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StorageFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type PrivateStorageFailureKind =
  | "cancelled"
  | "configuration"
  | "conflict"
  | "not_found"
  | "retryable"
  | "too_large";

export class PrivateStorageObjectError extends Error {
  constructor(
    readonly kind: PrivateStorageFailureKind,
    code: string,
  ) {
    super(code);
    this.name = "PrivateStorageObjectError";
  }
}

function storageError(
  kind: PrivateStorageFailureKind,
  code: string,
): PrivateStorageObjectError {
  return new PrivateStorageObjectError(kind, code);
}

export interface PrivateStorageObjectRequest {
  baseUrl: string;
  serviceRoleKey: string;
  bucket: "original-documents";
  path: string;
  method: "GET" | "POST";
  bytes?: Uint8Array;
  contentType?: string;
  timeoutMs: number;
  maximumResponseBytes: number;
  signal?: AbortSignal;
}

function storageRequestTimeoutMs(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_STORAGE_REQUEST_TIMEOUT_MS;
  }
  if (!/^\d+$/.test(value.trim())) {
    throw storageError(
      "configuration",
      "PRIVATE_STORAGE_CONFIGURATION_INVALID",
    );
  }
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) || parsed < 1_000 ||
    parsed > MAX_STORAGE_REQUEST_TIMEOUT_MS
  ) {
    throw storageError(
      "configuration",
      "PRIVATE_STORAGE_CONFIGURATION_INVALID",
    );
  }
  return parsed;
}

function privateStorageObjectUrl(
  baseUrl: string,
  bucket: string,
  path: string,
): URL {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw storageError(
      "configuration",
      "PRIVATE_STORAGE_CONFIGURATION_INVALID",
    );
  }
  const localHttp = base.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  const hostedSupabase = base.protocol === "https:" && !base.port &&
    /^[a-z0-9-]+\.supabase\.co$/.test(base.hostname);
  if (
    (!hostedSupabase && !localHttp) || base.username ||
    base.password || base.search || base.hash || base.pathname !== "/" ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(bucket)
  ) {
    throw storageError(
      "configuration",
      "PRIVATE_STORAGE_CONFIGURATION_INVALID",
    );
  }
  const segments = path.split("/");
  if (
    path.length > 800 || segments.length !== 3 ||
    !UUID_PATTERN.test(segments[0] ?? "") ||
    !UUID_PATTERN.test(segments[1] ?? "") ||
    (segments[2]?.length ?? 0) > 300 ||
    segments.some((segment) =>
      !segment || segment === "." || segment === ".." || segment.includes("\\")
    )
  ) {
    throw storageError("configuration", "PRIVATE_STORAGE_PATH_INVALID");
  }
  return new URL(
    "/storage/v1/object/" + encodeURIComponent(bucket) + "/" +
      segments.map(encodeURIComponent).join("/"),
    base.origin,
  );
}

async function boundedStorageResponseBytes(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes)
  ) {
    try {
      await response.body?.cancel("PRIVATE_STORAGE_RESPONSE_TOO_LARGE");
    } catch {
      // Preserve the resource-limit result if stream cancellation also fails.
    }
    throw storageError("too_large", "PRIVATE_STORAGE_RESPONSE_TOO_LARGE");
  }
  if (!response.body) {
    throw storageError("retryable", "PRIVATE_STORAGE_RESPONSE_INVALID");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        try {
          await reader.cancel("PRIVATE_STORAGE_RESPONSE_TOO_LARGE");
        } catch {
          // Preserve the resource-limit result if stream cancellation fails.
        }
        throw storageError("too_large", "PRIVATE_STORAGE_RESPONSE_TOO_LARGE");
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
  return bytes;
}

export async function requestPrivateStorageObject(
  input: PrivateStorageObjectRequest,
  fetcher: StorageFetcher = fetch,
): Promise<Uint8Array | null> {
  if (
    !input.serviceRoleKey || input.timeoutMs < 1 ||
    input.timeoutMs > MAX_STORAGE_REQUEST_TIMEOUT_MS ||
    !Number.isSafeInteger(input.timeoutMs) ||
    !Number.isSafeInteger(input.maximumResponseBytes) ||
    input.maximumResponseBytes < 0 ||
    input.maximumResponseBytes > MAX_UPLOAD_BYTES
  ) {
    throw storageError(
      "configuration",
      "PRIVATE_STORAGE_CONFIGURATION_INVALID",
    );
  }
  if (
    input.method === "POST" &&
    (!input.bytes || input.bytes.byteLength > MAX_UPLOAD_BYTES ||
      !input.contentType || input.contentType.length > 200 ||
      /[\r\n]/.test(input.contentType) || input.maximumResponseBytes !== 0)
  ) {
    throw storageError("configuration", "PRIVATE_STORAGE_REQUEST_INVALID");
  }
  if (input.method === "GET" && input.maximumResponseBytes === 0) {
    throw storageError("configuration", "PRIVATE_STORAGE_REQUEST_INVALID");
  }

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(input.signal?.reason);
  if (input.signal?.aborted) abortFromCaller();
  else input.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetcher(
        privateStorageObjectUrl(input.baseUrl, input.bucket, input.path),
        {
          method: input.method,
          headers: {
            Authorization: "Bearer " + input.serviceRoleKey,
            apikey: input.serviceRoleKey,
            ...(input.method === "POST"
              ? {
                "Content-Type": input.contentType!,
                "cache-control": "max-age=3600",
                "x-upsert": "false",
              }
              : {}),
          },
          body: input.method === "POST"
            ? Uint8Array.from(input.bytes!).buffer
            : undefined,
          signal: controller.signal,
          redirect: "error",
        },
      );
    } catch (error) {
      if (error instanceof PrivateStorageObjectError) throw error;
      if (input.signal?.aborted) {
        if (error instanceof Error) throw error;
        throw storageError("cancelled", "PRIVATE_STORAGE_CANCELLED");
      }
      throw storageError("retryable", "PRIVATE_STORAGE_RETRYABLE");
    }
    if (!response.ok) {
      try {
        await response.body?.cancel("PRIVATE_STORAGE_NON_SUCCESS");
      } catch {
        // Preserve the status-derived failure if body cancellation fails.
      }
      if (response.status === 404) {
        throw storageError("not_found", "PRIVATE_STORAGE_NOT_FOUND");
      }
      if (response.status === 413) {
        throw storageError("too_large", "PRIVATE_STORAGE_RESPONSE_TOO_LARGE");
      }
      if ([401, 403].includes(response.status)) {
        throw storageError("configuration", "PRIVATE_STORAGE_UNAUTHORIZED");
      }
      if (response.status === 409) {
        throw storageError("conflict", "PRIVATE_STORAGE_CONFLICT");
      }
      throw storageError("retryable", "PRIVATE_STORAGE_RETRYABLE");
    }
    if (input.method === "POST") {
      try {
        await response.body?.cancel("PRIVATE_STORAGE_BODY_UNUSED");
      } catch {
        // The Storage write acknowledgement is already authoritative.
      }
      return null;
    }
    return await boundedStorageResponseBytes(
      response,
      input.maximumResponseBytes,
    );
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export function privateStorageRuntime(): {
  baseUrl: string;
  serviceRoleKey: string;
  timeoutMs: number;
} {
  const baseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ??
    "";
  if (!baseUrl || !serviceRoleKey) {
    throw storageError(
      "configuration",
      "PRIVATE_STORAGE_CONFIGURATION_INVALID",
    );
  }
  return {
    baseUrl,
    serviceRoleKey,
    timeoutMs: storageRequestTimeoutMs(
      Deno.env.get("PRIVATE_STORAGE_REQUEST_TIMEOUT_MS"),
    ),
  };
}
