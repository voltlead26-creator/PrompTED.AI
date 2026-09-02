// deno-lint-ignore-file no-import-prefix
import { assertEquals } from "jsr:@std/assert@1";
import { PrivateStorageObjectError } from "../_shared/private-storage-object.ts";
import { UploadExtractionError } from "../_shared/upload-extraction.ts";
import {
  handleExtractUpload,
  type UploadExtractorDependencies,
} from "./handler.ts";

const SERVICE_KEY = "synthetic-service-role-key";
const USER_ID = "71000000-0000-4000-8000-000000000001";
const UPLOAD_ID = "72000000-0000-8000-8000-000000000001";
const CLAIM_TOKEN = "73000000-0000-4000-8000-000000000001";
const REQUEST_SHA256 = "b".repeat(64);
const BYTES = new TextEncoder().encode("Reliable retained source");

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function request(
  overrides: Record<string, unknown> = {},
  key = SERVICE_KEY,
): Promise<Request> {
  return new Request("https://example.invalid/functions/v1/extract-upload", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      apikey: key,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      upload_id: UPLOAD_ID,
      user_id: USER_ID,
      request_sha256: REQUEST_SHA256,
      claim_token: CLAIM_TOKEN,
      ...overrides,
    }),
  });
}

function dependencies(): UploadExtractorDependencies & {
  reads: number;
  extracts: number;
  fileTypes: string[];
} {
  const deps: UploadExtractorDependencies & {
    reads: number;
    extracts: number;
    fileTypes: string[];
  } = {
    serviceRoleKey: SERVICE_KEY,
    reads: 0,
    extracts: 0,
    fileTypes: [],
    async loadSnapshot() {
      return {
        uploadId: UPLOAD_ID,
        userId: USER_ID,
        requestSha256: REQUEST_SHA256,
        claimToken: CLAIM_TOKEN,
        storagePath: `${USER_ID}/${UPLOAD_ID}/source.txt`,
        filename: "source.txt",
        fileType: "text/plain",
        byteLength: BYTES.byteLength,
        contentSha256: await sha256(BYTES),
        stage: "storage_completed" as const,
      };
    },
    readOriginal() {
      deps.reads += 1;
      return Promise.resolve(Uint8Array.from(BYTES));
    },
    extract(bytes: Uint8Array, _filename: string, fileType: string) {
      deps.extracts += 1;
      deps.fileTypes.push(fileType);
      return Promise.resolve({
        text: new TextDecoder().decode(bytes),
        format: "text" as const,
        truncated: false,
        resourcePolicyVersion: "upload-resource-policy.1" as const,
      });
    },
  };
  return deps;
}

Deno.test("extract-upload admits only the exact internal service credential", async () => {
  const deps = dependencies();
  const response = await handleExtractUpload(
    await request({}, "wrong-key"),
    deps,
  );
  assertEquals(response.status, 401);
  assertEquals((await response.json()).error.code, "INTERNAL_AUTH_REQUIRED");
  assertEquals(deps.reads, 0);
  assertEquals(deps.extracts, 0);
});

Deno.test("extract-upload reloads and verifies exact retained bytes before parsing", async () => {
  const deps = dependencies();
  const response = await handleExtractUpload(await request(), deps);
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body, {
    upload_id: UPLOAD_ID,
    user_id: USER_ID,
    request_sha256: REQUEST_SHA256,
    claim_token: CLAIM_TOKEN,
    content_sha256: await sha256(BYTES),
    text: "Reliable retained source",
    format: "text",
    truncated: false,
    resource_policy_version: "upload-resource-policy.1",
  });
  assertEquals(deps.reads, 1);
  assertEquals(deps.extracts, 1);
});

Deno.test("extract-upload rejects caller metadata and stale durable claims before Storage", async () => {
  const deps = dependencies();
  const callerMetadata = await handleExtractUpload(
    await request({ storage_path: `${USER_ID}/${UPLOAD_ID}/other.txt` }),
    deps,
  );
  assertEquals(callerMetadata.status, 400);
  assertEquals(deps.reads, 0);

  deps.loadSnapshot = () => Promise.resolve(null);
  const stale = await handleExtractUpload(await request(), deps);
  assertEquals(stale.status, 409);
  assertEquals(
    (await stale.json()).error.code,
    "UPLOAD_EXTRACTION_CLAIM_CONFLICT",
  );
  assertEquals(deps.reads, 0);
  assertEquals(deps.extracts, 0);
});

Deno.test("extract-upload rejects an accepted empty upload deterministically", async () => {
  const deps = dependencies();
  deps.loadSnapshot = async () => ({
    uploadId: UPLOAD_ID,
    userId: USER_ID,
    requestSha256: REQUEST_SHA256,
    claimToken: CLAIM_TOKEN,
    storagePath: `${USER_ID}/${UPLOAD_ID}/empty.txt`,
    filename: "empty.txt",
    fileType: "txt",
    byteLength: 0,
    contentSha256: await sha256(new Uint8Array()),
    stage: "storage_completed" as const,
  });
  const response = await handleExtractUpload(await request(), deps);
  assertEquals(response.status, 422);
  assertEquals((await response.json()).error.code, "UPLOAD_FILE_EMPTY");
  assertEquals(deps.reads, 0);
  assertEquals(deps.extracts, 0);
});

Deno.test("extract-upload fails closed when retained identity changes", async () => {
  const deps = dependencies();
  deps.readOriginal = () =>
    Promise.resolve(new TextEncoder().encode("different"));
  const response = await handleExtractUpload(await request(), deps);
  assertEquals(response.status, 409);
  assertEquals(
    (await response.json()).error.code,
    "UPLOAD_EXTRACTION_SOURCE_CONFLICT",
  );
  assertEquals(deps.extracts, 0);
});

Deno.test("extract-upload maps retained source and infrastructure failures without leaking details", async () => {
  const missing = dependencies();
  missing.readOriginal = () =>
    Promise.reject(
      new PrivateStorageObjectError("not_found", "PRIVATE_STORAGE_NOT_FOUND"),
    );
  const missingResponse = await handleExtractUpload(await request(), missing);
  assertEquals(missingResponse.status, 409);
  assertEquals(
    (await missingResponse.json()).error.code,
    "UPLOAD_EXTRACTION_SOURCE_CONFLICT",
  );

  const unavailable = dependencies();
  unavailable.readOriginal = () =>
    Promise.reject(
      new PrivateStorageObjectError("retryable", "native private detail"),
    );
  const unavailableResponse = await handleExtractUpload(
    await request(),
    unavailable,
  );
  const unavailableBody = await unavailableResponse.json();
  assertEquals(unavailableResponse.status, 503);
  assertEquals(
    unavailableBody.error.code,
    "UPLOAD_EXTRACTION_SOURCE_UNAVAILABLE",
  );
  assertEquals(
    JSON.stringify(unavailableBody).includes("native private detail"),
    false,
  );
});

Deno.test("extract-upload adapts historical unknown file metadata without rewriting provenance", async () => {
  const deps = dependencies();
  const load = deps.loadSnapshot;
  deps.loadSnapshot = async (input) => {
    const snapshot = await load(input);
    if (!snapshot) throw new Error("synthetic snapshot missing");
    return { ...snapshot, fileType: "unknown" };
  };
  const response = await handleExtractUpload(await request(), deps);
  assertEquals(response.status, 200);
  assertEquals(deps.fileTypes, ["application/octet-stream"]);
});

Deno.test("extract-upload preserves deterministic resource status and retryability", async () => {
  const deps = dependencies();
  deps.extract = () =>
    Promise.reject(
      new UploadExtractionError(
        413,
        "UPLOAD_ARCHIVE_EXPANSION_LIMIT",
        "That file expands beyond the safe limit.",
      ),
    );
  const response = await handleExtractUpload(await request(), deps);
  const body = await response.json();
  assertEquals(response.status, 413);
  assertEquals(body.error.code, "UPLOAD_ARCHIVE_EXPANSION_LIMIT");
  assertEquals(body.retryable, false);
});
