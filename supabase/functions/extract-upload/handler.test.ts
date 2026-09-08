// deno-lint-ignore-file no-import-prefix
import { assert, assertEquals } from "jsr:@std/assert@1";
import { PrivateStorageObjectError } from "../_shared/private-storage-object.ts";
import {
  extractBoundedUploadWithSource,
  UploadExtractionError,
} from "../_shared/upload-extraction.ts";
import {
  handleExtractUpload,
  type UploadExtractorDependencies,
} from "./handler.ts";
import {
  requestIsolatedUploadExtraction,
} from "../_shared/upload-extraction-client.ts";

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

function request(
  overrides: Record<string, unknown> = {},
  key = SERVICE_KEY,
): Request {
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

Deno.test("extract-upload v2 uses the accepted version and emits a closed source-absent response", async () => {
  const deps = {
    ...dependencies(),
    extractWithSource: extractBoundedUploadWithSource,
  };
  const load = deps.loadSnapshot;
  deps.loadSnapshot = async (input) => {
    const snapshot = await load(input);
    if (!snapshot) throw new Error("fixture missing");
    return {
      ...snapshot,
      extractionContractVersion: "upload-extraction.2" as const,
    };
  };
  const response = await handleExtractUpload(
    await request({ extraction_contract_version: "upload-extraction.2" }),
    deps,
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    upload_id: UPLOAD_ID,
    user_id: USER_ID,
    request_sha256: REQUEST_SHA256,
    claim_token: CLAIM_TOKEN,
    content_sha256: await sha256(BYTES),
    content_byte_length: BYTES.length,
    text: "Reliable retained source",
    format: "text",
    truncated: false,
    resource_policy_version: "upload-resource-policy.1",
    extraction_contract_version: "upload-extraction.2",
    source_manifest: null,
  });
  assertEquals(deps.extracts, 0);
});

Deno.test("extract-upload v2 transports a real DOCX from one retained read through both boundaries", async () => {
  const bytes = await Deno.readFile(
    new URL("./fixtures/source-preservation.docx", import.meta.url),
  );
  const original = Uint8Array.from(bytes);
  const digest = await sha256(bytes);
  assertEquals(
    digest,
    "a096ad4a8de77f395cef7f999d2e0037147945ae62c6663fabf6b43556c3b799",
  );
  const deps = dependencies();
  const load = deps.loadSnapshot;
  let reads = 0;
  let combinedReads = 0;
  deps.loadSnapshot = async (identity) => {
    const snapshot = await load(identity);
    assert(snapshot);
    return {
      ...snapshot,
      filename: "source.docx",
      fileType: "application/octet-stream",
      byteLength: bytes.length,
      contentSha256: digest,
      extractionContractVersion: "upload-extraction.2",
    };
  };
  deps.readOriginal = () => {
    reads += 1;
    return Promise.resolve(bytes);
  };
  deps.extractWithSource = (...args) => {
    combinedReads += 1;
    return extractBoundedUploadWithSource(...args);
  };
  const result = await requestIsolatedUploadExtraction({
    uploadId: UPLOAD_ID,
    userId: USER_ID,
    requestSha256: REQUEST_SHA256,
    claimToken: CLAIM_TOKEN,
    extractionContractVersion: "upload-extraction.2",
    expectedContentSha256: digest,
    expectedByteLength: bytes.length,
  }, {
    baseUrl: "http://127.0.0.1:54321",
    serviceRoleKey: SERVICE_KEY,
    timeoutMs: 1_000,
  }, (url, init) => handleExtractUpload(new Request(url, init), deps));
  assert(result.format === "docx");
  assertEquals(result.text, "Format protected document");
  assertEquals(result.sourceManifest.archiveSha256, digest);
  assertEquals(
    result.sourceManifest.mainPart.source.nodes.map((node) => node.text),
    ["Format protected document"],
  );
  assert(result.sourceManifest.blockers.includes("layout_unassessed"));
  assertEquals([reads, combinedReads, deps.extracts], [1, 1, 0]);
  assertEquals(bytes, original);
});

Deno.test("extract-upload rejects version mismatches before Storage and never guesses unknown versions", async () => {
  for (
    const version of [
      undefined,
      "upload-extraction.1",
      "upload-extraction.2",
      null,
      "upload-extraction.3",
      ["upload-extraction.1"],
    ]
  ) {
    for (const requested of [undefined, "upload-extraction.2"]) {
      const deps = dependencies();
      const load = deps.loadSnapshot;
      deps.loadSnapshot = async (identity) => {
        const snapshot = await load(identity);
        assert(snapshot);
        return {
          ...snapshot,
          extractionContractVersion: version,
        } as unknown as NonNullable<Awaited<ReturnType<typeof load>>>;
      };
      const compatible =
        (version === undefined || version === "upload-extraction.1") &&
        requested === undefined;
      const needsMissingReader = version === "upload-extraction.2" &&
        requested === "upload-extraction.2";
      const response = await handleExtractUpload(
        await request(
          requested ? { extraction_contract_version: requested } : {},
        ),
        deps,
      );
      assertEquals(
        response.status,
        compatible ? 200 : needsMissingReader ? 503 : 409,
      );
      if (!compatible) assertEquals([deps.reads, deps.extracts], [0, 0]);
    }
  }
  for (
    const version of [null, "upload-extraction.1", "upload-extraction.4", [
      "upload-extraction.2",
    ]]
  ) {
    const deps = dependencies();
    assertEquals(
      (await handleExtractUpload(
        await request({ extraction_contract_version: version }),
        deps,
      )).status,
      400,
    );
    assertEquals(deps.reads, 0);
  }
});

Deno.test("extract-upload v2 rejects an invalid producer manifest without downgrading", async () => {
  const bytes = await Deno.readFile(
    new URL("./fixtures/source-preservation.docx", import.meta.url),
  );
  const deps = dependencies();
  const load = deps.loadSnapshot;
  deps.loadSnapshot = async (identity) => {
    const snapshot = await load(identity);
    assert(snapshot);
    return {
      ...snapshot,
      filename: "source.docx",
      fileType: "application/octet-stream",
      byteLength: bytes.length,
      contentSha256: await sha256(bytes),
      extractionContractVersion: "upload-extraction.2",
    };
  };
  deps.readOriginal = () => Promise.resolve(bytes);
  deps.extractWithSource = () =>
    Promise.resolve({
      text: "Never accept a missing DOCX source",
      format: "docx",
      truncated: false,
      resourcePolicyVersion: "upload-resource-policy.1",
      sourceManifest: null,
    } as unknown as Awaited<ReturnType<typeof extractBoundedUploadWithSource>>);
  const response = await handleExtractUpload(
    await request({ extraction_contract_version: "upload-extraction.2" }),
    deps,
  );
  assertEquals(response.status, 503);
  assertEquals(
    (await response.json()).error.code,
    "UPLOAD_EXTRACTION_UNAVAILABLE",
  );
  assertEquals(deps.extracts, 0);
});

Deno.test("extract-upload v2 cannot downgrade an accepted DOCX to source-absent text", async () => {
  const bytes = await Deno.readFile(
    new URL("./fixtures/source-preservation.docx", import.meta.url),
  );
  const deps = dependencies();
  const load = deps.loadSnapshot;
  deps.loadSnapshot = async (identity) => {
    const snapshot = await load(identity);
    assert(snapshot);
    return {
      ...snapshot,
      filename: "original.docx",
      fileType: "application/octet-stream",
      byteLength: bytes.length,
      contentSha256: await sha256(bytes),
      extractionContractVersion: "upload-extraction.2",
    };
  };
  deps.readOriginal = () => Promise.resolve(bytes);
  deps.extractWithSource = () =>
    Promise.resolve({
      text: "Format protected document",
      format: "text",
      truncated: false,
      resourcePolicyVersion: "upload-resource-policy.1",
      sourceManifest: null,
    });
  const response = await handleExtractUpload(
    await request({ extraction_contract_version: "upload-extraction.2" }),
    deps,
  );
  assertEquals(response.status, 503);
  assertEquals(
    (await response.json()).error.code,
    "UPLOAD_EXTRACTION_RESPONSE_INVALID",
  );
  assertEquals(deps.extracts, 0);
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
