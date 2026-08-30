/** Owns bounded rendering, deterministic inspection evidence, and identity. */

const INSPECTION_VERSION = "prompted.rendered-pdf.v1";
const DEFAULT_RENDER_TIMEOUT_MS = 15_000;
const MAX_RENDER_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 25 * 1024 * 1024;

export interface RenderServiceContract {
  endpoint: string;
  origin: string;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface CapturedPdfInspectionExpectation {
  version: typeof INSPECTION_VERSION;
  contentSha256: string;
  sectionOrderSha256: string;
  source: {
    title: string;
    sections: ExpectedSection[];
  };
}

export interface ExpectedSection {
  name: string;
  content: string;
  order_index: number;
}

interface CapturedCompletionIdentity {
  exportId: string;
  operationId: string;
  storagePath: string;
  artifactSha256: string;
  rendererVersion: string;
}

export interface CapturedPdfInspectionResult {
  passed: boolean;
  artifactInspected: boolean;
  artifactSha256: string;
  validationResult: {
    passed: boolean;
    artifact_inspected: boolean;
    inspection_contract: typeof INSPECTION_VERSION;
    byte_length: number;
    content_sha256: string;
    section_order_sha256: string;
    checks: {
      transport_envelope: boolean;
      inspection_version: boolean;
      renderer_status: boolean;
      renderer_structural: boolean;
      content_matches: boolean;
      section_order_matches: boolean;
      artifact_hash_matches: boolean;
    };
  };
}

type RenderFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function artifactBytes(payload: ArrayBuffer | string): Uint8Array {
  return typeof payload === "string"
    ? new TextEncoder().encode(payload)
    : new Uint8Array(payload);
}

export function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", ownedBuffer(bytes));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function hasPdfTransportEnvelope(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 100) return false;
  const head = new TextDecoder().decode(bytes.slice(0, 5));
  const tail = new TextDecoder().decode(bytes.slice(-1024));
  return head === "%PDF-" && tail.includes("%%EOF");
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^\d+$/.test(value.trim())) {
    throw new Error("RENDER_SERVICE_CONFIGURATION_INVALID");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error("RENDER_SERVICE_CONFIGURATION_INVALID");
  }
  return parsed;
}

function isPublicDnsHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (
    !normalized.includes(".") ||
    normalized.includes(":") ||
    /^\d+(?:\.\d+){3}$/.test(normalized)
  ) {
    return false;
  }
  if (
    [
      ".local",
      ".localhost",
      ".internal",
      ".lan",
      ".home",
      ".test",
      ".invalid",
      ".example",
    ].some((suffix) => normalized.endsWith(suffix))
  ) {
    return false;
  }
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
    normalized,
  );
}

export function validateRenderServiceContract(input: {
  serviceUrl?: string;
  allowedOrigin?: string;
  timeoutMs?: string;
  maxResponseBytes?: string;
}): RenderServiceContract | null {
  const rawServiceUrl = input.serviceUrl?.trim() ?? "";
  const rawAllowedOrigin = input.allowedOrigin?.trim() ?? "";
  if (!rawServiceUrl && !rawAllowedOrigin) return null;
  if (!rawServiceUrl || !rawAllowedOrigin) {
    throw new Error("RENDER_SERVICE_CONFIGURATION_INVALID");
  }

  let endpoint: URL;
  let allowed: URL;
  try {
    endpoint = new URL(rawServiceUrl);
    allowed = new URL(rawAllowedOrigin);
  } catch {
    throw new Error("RENDER_SERVICE_CONFIGURATION_INVALID");
  }
  const hasCredentials = (value: URL) =>
    Boolean(value.username || value.password);
  if (
    endpoint.protocol !== "https:" ||
    allowed.protocol !== "https:" ||
    hasCredentials(endpoint) ||
    hasCredentials(allowed) ||
    !isPublicDnsHostname(endpoint.hostname) ||
    !isPublicDnsHostname(allowed.hostname) ||
    endpoint.origin !== allowed.origin ||
    endpoint.search !== "" ||
    endpoint.hash !== "" ||
    allowed.pathname !== "/" ||
    allowed.search !== "" ||
    allowed.hash !== ""
  ) {
    throw new Error("RENDER_SERVICE_CONFIGURATION_INVALID");
  }

  return {
    endpoint: endpoint.toString(),
    origin: allowed.origin,
    timeoutMs: boundedInteger(
      input.timeoutMs,
      DEFAULT_RENDER_TIMEOUT_MS,
      1_000,
      MAX_RENDER_TIMEOUT_MS,
    ),
    maxResponseBytes: boundedInteger(
      input.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      1_024,
      DEFAULT_MAX_RESPONSE_BYTES,
    ),
  };
}

export async function readBoundedResponseBytes(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      throw new Error("RENDER_SERVICE_RESPONSE_INVALID");
    }
    if (Number(contentLength) > maximumBytes) {
      throw new Error("RENDER_SERVICE_RESPONSE_TOO_LARGE");
    }
  }
  if (!response.body) throw new Error("RENDER_SERVICE_RESPONSE_INVALID");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("RENDER_SERVICE_RESPONSE_TOO_LARGE");
        throw new Error("RENDER_SERVICE_RESPONSE_TOO_LARGE");
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

export async function requestRenderedPdf(
  contract: RenderServiceContract,
  request: Record<string, unknown>,
  fetcher: RenderFetcher = fetch,
): Promise<{ bytes: Uint8Array; headers: Headers } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), contract.timeoutMs);
  try {
    const response = await fetcher(contract.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
      redirect: "error",
    });
    if (
      !response.ok ||
      !response.headers.get("content-type")?.toLowerCase().startsWith(
        "application/pdf",
      )
    ) {
      return null;
    }
    return {
      bytes: await readBoundedResponseBytes(
        response,
        contract.maxResponseBytes,
      ),
      headers: response.headers,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function createCapturedPdfInspectionExpectation(
  title: string,
  sections: ExpectedSection[],
): Promise<CapturedPdfInspectionExpectation> {
  const canonicalSections = sections.map((section) => ({
    name: section.name,
    content: section.content,
    order_index: section.order_index,
  }));
  const contentSha256 = await sha256Hex(
    artifactBytes(JSON.stringify({ title, sections: canonicalSections })),
  );
  const sectionOrderSha256 = await sha256Hex(
    artifactBytes(JSON.stringify(canonicalSections.map((section) => ({
      name: section.name,
      order_index: section.order_index,
    })))),
  );
  return {
    version: INSPECTION_VERSION,
    contentSha256,
    sectionOrderSha256,
    source: { title, sections: canonicalSections },
  };
}

export async function inspectCapturedPdfArtifact(
  bytes: Uint8Array,
  rendererHeaders: Headers,
  expectation: CapturedPdfInspectionExpectation,
): Promise<CapturedPdfInspectionResult> {
  // The approved TLS renderer is the inspection authority: it must parse the
  // produced PDF, compare extracted content and section order with the exact
  // `expected_document` request, then return all evidence headers below. The
  // local signature/EOF envelope is only transport sanity and cannot pass on
  // its own.
  const artifactSha256 = await sha256Hex(bytes);
  const checks = {
    transport_envelope: hasPdfTransportEnvelope(bytes),
    inspection_version: rendererHeaders.get("x-prompted-inspection-version") ===
      expectation.version,
    renderer_status:
      rendererHeaders.get("x-prompted-inspection-status") === "passed",
    renderer_structural:
      rendererHeaders.get("x-prompted-pdf-structure") === "passed",
    content_matches: rendererHeaders.get("x-prompted-content-sha256") ===
      expectation.contentSha256,
    section_order_matches:
      rendererHeaders.get("x-prompted-section-order-sha256") ===
        expectation.sectionOrderSha256,
    artifact_hash_matches:
      rendererHeaders.get("x-prompted-artifact-sha256") === artifactSha256,
  };
  const passed = Object.values(checks).every(Boolean);
  return {
    passed,
    artifactInspected: passed,
    artifactSha256,
    validationResult: {
      passed,
      artifact_inspected: passed,
      inspection_contract: expectation.version,
      byte_length: bytes.byteLength,
      content_sha256: expectation.contentSha256,
      section_order_sha256: expectation.sectionOrderSha256,
      checks,
    },
  };
}

export function capturedExportCompletionMatches(
  value: unknown,
  expected: CapturedCompletionIdentity,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const validation = row.artifact_validation_result;
  return row.status === "created" &&
    row.export_id === expected.exportId &&
    row.operation_id === expected.operationId &&
    row.storage_path === expected.storagePath &&
    row.artifact_sha256 === expected.artifactSha256 &&
    row.renderer_version === expected.rendererVersion &&
    Boolean(
      validation && typeof validation === "object" &&
        !Array.isArray(validation) &&
        (validation as Record<string, unknown>).passed === true &&
        (validation as Record<string, unknown>).artifact_inspected === true,
    );
}

export async function reconcileCapturedExportCompletion(
  complete: () => Promise<{ data: unknown; error: unknown }>,
  expected: CapturedCompletionIdentity,
): Promise<{ completed: boolean; attempts: number }> {
  for (let attempts = 1; attempts <= 2; attempts += 1) {
    const { data, error } = await complete();
    if (!error && capturedExportCompletionMatches(data, expected)) {
      return { completed: true, attempts };
    }
  }
  return { completed: false, attempts: 2 };
}

export function capturedExportStoragePath(
  userId: string,
  exportId: string,
  filename: string,
): string {
  if (
    !/^[0-9a-f-]{36}$/i.test(userId) ||
    !/^[0-9a-f-]{36}$/i.test(exportId) ||
    !/^[a-z0-9][a-z0-9._-]{0,159}$/i.test(filename)
  ) {
    throw new Error("CAPTURED_EXPORT_STORAGE_IDENTITY_INVALID");
  }
  return `${userId}/${exportId}/${filename}`;
}
