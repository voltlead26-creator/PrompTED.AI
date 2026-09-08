// deno-lint-ignore-file no-import-prefix
import { assertEquals } from "jsr:@std/assert@1";
import {
  handleExtractUpload,
  parseUploadExtractionSnapshot,
  type UploadExtractionSnapshot,
} from "./handler.ts";
import { requestIsolatedUploadExtraction } from "../_shared/upload-extraction-client.ts";
import {
  extractBoundedUploadText,
  extractBoundedUploadWithSource,
  extractBoundedUploadWithSourceV3,
} from "../_shared/upload-extraction.ts";

const owner = "71000000-0000-4000-8000-000000000001";
const upload = "72000000-0000-8000-8000-000000000001";
const claim = "73000000-0000-4000-8000-000000000001";
const requestHash = "b".repeat(64);
const serviceKey = "synthetic-v3-service-key";
const v3 = "upload-extraction.3";
const bytes = new TextEncoder().encode(
  String.raw`{\rtf1\ansi Caf\'e9 \u-10179?\u-8704?}`,
);
async function sha(value: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(value)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
function request(version: unknown = v3) {
  return new Request("https://example.invalid/functions/v1/extract-upload", {
    method: "POST",
    headers: {
      authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      upload_id: upload,
      user_id: owner,
      claim_token: claim,
      request_sha256: requestHash,
      extraction_contract_version: version,
    }),
  });
}
async function fixture(
  version: unknown = v3,
  originalBytes = bytes,
  filename = "source.rtf",
  fileType = "application/rtf",
) {
  const snapshot: UploadExtractionSnapshot = {
    uploadId: upload,
    userId: owner,
    claimToken: claim,
    requestSha256: requestHash,
    filename,
    storagePath: `${owner}/${upload}/${filename}`,
    fileType,
    byteLength: originalBytes.length,
    contentSha256: await sha(originalBytes),
    stage: "storage_completed",
  };
  // The snapshot is an untrusted external response; test unsupported variants too.
  Reflect.set(snapshot, "extractionContractVersion", version);
  const calls = { reads: 0, old: 0, source: 0, v3: 0 };
  return {
    snapshot,
    calls,
    deps: {
      serviceRoleKey: serviceKey,
      loadSnapshot: () => Promise.resolve(snapshot),
      readOriginal: () => {
        calls.reads++;
        return Promise.resolve(originalBytes.slice());
      },
      extract: (...args: Parameters<typeof extractBoundedUploadText>) => {
        calls.old++;
        return extractBoundedUploadText(...args);
      },
      extractWithSource: (
        ...args: Parameters<typeof extractBoundedUploadWithSource>
      ) => {
        calls.source++;
        return extractBoundedUploadWithSource(...args);
      },
      extractWithSourceV3: (
        ...args: Parameters<typeof extractBoundedUploadWithSourceV3>
      ) => {
        calls.v3++;
        return extractBoundedUploadWithSourceV3(...args);
      },
    },
  };
}

Deno.test("extract-upload v3 returns the exact original-bound RTF envelope", async () => {
  const { calls, deps, snapshot } = await fixture();
  const response = await handleExtractUpload(request(), deps);
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body, {
    upload_id: upload,
    user_id: owner,
    claim_token: claim,
    request_sha256: requestHash,
    content_sha256: snapshot.contentSha256,
    content_byte_length: bytes.length,
    extraction_contract_version: v3,
    format: "rtf",
    text: "Café 😀",
    truncated: false,
    resource_policy_version: "upload-resource-policy.2",
    source_manifest: {
      version: "rtf-source-manifest.1",
      assessment: "source_only",
      originalSha256: snapshot.contentSha256,
      originalByteLength: bytes.length,
      extractedTextSha256: await sha(new TextEncoder().encode("Café 😀")),
      blockers: ["rtf-format-preserving-editing-unverified"],
    },
  });
  assertEquals(calls, { reads: 1, old: 0, source: 0, v3: 1 });
});

Deno.test("extract-upload v3 refuses a missing reader before Storage without fallback", async () => {
  const { calls, deps } = await fixture();
  const withoutV3 = { ...deps, extractWithSourceV3: undefined };
  const response = await handleExtractUpload(request(), withoutV3);
  assertEquals(response.status, 503);
  assertEquals(
    (await response.json()).error.code,
    "UPLOAD_EXTRACTION_VERSION_UNAVAILABLE",
  );
  assertEquals(calls, { reads: 0, old: 0, source: 0, v3: 0 });
});

Deno.test("extract-upload v3 refuses old or ambiguous accepted versions before Storage", async () => {
  for (
    const version of [
      undefined,
      null,
      "upload-extraction.1",
      "upload-extraction.2",
      "upload-extraction.99",
    ]
  ) {
    const { deps, calls } = await fixture(version);
    if (version === undefined) {
      Reflect.deleteProperty(
        await deps.loadSnapshot(),
        "extractionContractVersion",
      );
    }
    const response = await handleExtractUpload(request(), deps);
    assertEquals(response.status, 409);
    assertEquals(calls.reads, 0);
  }
});

Deno.test("v3 real RTF, DOCX and text pass client/handler/producer roundtrips without old dispatch", async () => {
  const docx = await Deno.readFile(
    new URL("./fixtures/source-preservation.docx", import.meta.url),
  );
  for (
    const [originalBytes, filename, mime, format] of [
      [bytes, "source.rtf", "application/rtf", "rtf"],
      [bytes, "source.rtf", "text/rtf", "rtf"],
      [
        docx,
        "source.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "docx",
      ],
      [
        new TextEncoder().encode("Exact text 😀"),
        "source.md",
        "text/markdown",
        "text",
      ],
    ] as const
  ) {
    const { deps, calls, snapshot } = await fixture(
      v3,
      originalBytes,
      filename,
      mime,
    );
    let dispatches = 0;
    const result = await requestIsolatedUploadExtraction({
      uploadId: upload,
      userId: owner,
      requestSha256: requestHash,
      claimToken: claim,
      expectedContentSha256: snapshot.contentSha256,
      expectedByteLength: originalBytes.length,
      extractionContractVersion: "upload-extraction.3",
    }, {
      baseUrl: "http://127.0.0.1:54321",
      serviceRoleKey: serviceKey,
      timeoutMs: 1000,
    }, async (url, init) => {
      dispatches++;
      assertEquals(JSON.parse(String(init?.body)), {
        upload_id: upload,
        user_id: owner,
        request_sha256: requestHash,
        claim_token: claim,
        extraction_contract_version: v3,
      });
      return await handleExtractUpload(new Request(url, init), deps);
    });
    assertEquals(dispatches, 1);
    assertEquals(calls, { reads: 1, old: 0, source: 0, v3: 1 });
    assertEquals(result.format, format);
    assertEquals(result.contentSha256, snapshot.contentSha256);
    assertEquals(result.contentByteLength, originalBytes.length);
    assertEquals(result.resourcePolicyVersion, "upload-resource-policy.2");
    assertEquals(result.extractionContractVersion, v3);
    if (result.format === "rtf") assertEquals(result.text, "Café 😀");
    else if (result.format === "text") {
      assertEquals(result.text, "Exact text 😀");
      assertEquals(result.sourceManifest, null);
    } else if (result.format === "docx") {
      assertEquals(result.sourceManifest.version, "docx-source-manifest.1");
      assertEquals(result.sourceManifest.archiveSha256, snapshot.contentSha256);
    }
  }
});

Deno.test("extract-upload entry-point snapshot converter preserves old versions and rejects malformed v3", async () => {
  const record = {
    upload_id: upload,
    user_id: owner,
    request_sha256: requestHash,
    claim_token: claim,
    storage_path: `${owner}/${upload}/source.rtf`,
    filename: "source.rtf",
    file_type: "application/rtf",
    byte_length: bytes.length,
    content_sha256: await sha(bytes),
    stage: "storage_completed",
  };
  for (
    const version of [
      "upload-extraction.1",
      "upload-extraction.2",
      "upload-extraction.3",
    ] as const
  ) {
    assertEquals(
      parseUploadExtractionSnapshot({
        ...record,
        extraction_contract_version: version,
      })?.extractionContractVersion,
      version,
    );
  }
  assertEquals(
    Object.hasOwn(
      parseUploadExtractionSnapshot(record)!,
      "extractionContractVersion",
    ),
    false,
  );
  for (const version of [null, "upload-extraction.4", [], undefined]) {
    assertEquals(
      parseUploadExtractionSnapshot({
        ...record,
        extraction_contract_version: version,
      }),
      null,
    );
  }
  for (
    const patch of [
      { byte_length: String(bytes.length) },
      { file_type: {} },
      { filename: null },
      { stage: "completed" },
      { private_extra: true },
    ]
  ) {
    assertEquals(
      parseUploadExtractionSnapshot({
        ...record,
        extraction_contract_version: v3,
        ...patch,
      }),
      null,
    );
  }
});

Deno.test("extract-upload v3 rejects RTF relabelled as plaintext and altered digest-bound wording", async () => {
  for (const downgrade of [true, false]) {
    const { deps } = await fixture();
    const producer = deps.extractWithSourceV3;
    deps.extractWithSourceV3 = async (...args) => {
      const result = await producer(...args);
      if (downgrade) return { ...result, format: "text", sourceManifest: null };
      return { ...result, text: "Unrelated replacement" };
    };
    const response = await handleExtractUpload(request(), deps);
    assertEquals(response.status, 503);
    assertEquals((await response.json()).retryable, true);
  }
});
