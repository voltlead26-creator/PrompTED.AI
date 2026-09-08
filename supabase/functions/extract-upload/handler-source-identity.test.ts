// deno-lint-ignore-file no-import-prefix
import { assertEquals } from "jsr:@std/assert@1";
import {
  handleExtractUpload,
  type UploadExtractorDependencies,
} from "./handler.ts";
import {
  extractBoundedUploadText,
  extractBoundedUploadWithSource,
  extractBoundedUploadWithSourceV3,
  UploadExtractionError,
} from "../_shared/upload-extraction.ts";

const original = new TextEncoder().encode("Original retained source A");
const replacement = new TextEncoder().encode("Replaced retained source B");
const userId = "71000000-0000-4000-8000-000000000001";
const uploadId = "72000000-0000-8000-8000-000000000001";
const claimToken = "73000000-0000-4000-8000-000000000001";
const key = "synthetic-owned-source-service-key";
const versions = [
  "upload-extraction.1",
  "upload-extraction.2",
  "upload-extraction.3",
] as const;
async function fixture(version: typeof versions[number], signal?: AbortSignal) {
  const digest = await crypto.subtle.digest("SHA-256", original);
  const contentSha256 = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const alias = original.slice();
  const calls = { read: 0, parser: 0 };
  const deps: UploadExtractorDependencies = {
    serviceRoleKey: key,
    loadSnapshot: () =>
      Promise.resolve({
        uploadId,
        userId,
        claimToken,
        requestSha256: "b".repeat(64),
        storagePath: `${userId}/${uploadId}/source.txt`,
        filename: "source.txt",
        fileType: "text/plain",
        contentSha256,
        byteLength: original.length,
        stage: "storage_completed",
        extractionContractVersion: version,
      }),
    readOriginal: () => {
      calls.read++;
      return Promise.resolve(alias);
    },
    extract: (...args) => {
      calls.parser++;
      return extractBoundedUploadText(...args);
    },
    extractWithSource: (...args) => {
      calls.parser++;
      return extractBoundedUploadWithSource(...args);
    },
    extractWithSourceV3: (...args) => {
      calls.parser++;
      return extractBoundedUploadWithSourceV3(...args);
    },
  };
  const req = new Request(
    "https://example.invalid/functions/v1/extract-upload",
    {
      method: "POST",
      signal,
      headers: {
        authorization: `Bearer ${key}`,
        apikey: key,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        upload_id: uploadId,
        user_id: userId,
        claim_token: claimToken,
        request_sha256: "b".repeat(64),
        ...(version === "upload-extraction.1"
          ? {}
          : { extraction_contract_version: version }),
      }),
    },
  );
  return { req, deps, alias, calls, contentSha256 };
}

function holdOriginalDigest() {
  const digest = crypto.subtle.digest;
  const reached = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  let held = false;
  crypto.subtle.digest = async function (algorithm, data) {
    const result = digest.call(this, algorithm, data);
    if (
      !held && data instanceof Uint8Array && data.length === original.length &&
      data.every((byte, index) => byte === original[index])
    ) {
      held = true;
      reached.resolve();
      await released.promise;
    }
    return await result;
  };
  return {
    reached: reached.promise,
    release: () => released.resolve(),
    restore: () => {
      crypto.subtle.digest = digest;
    },
  };
}

for (const version of versions) {
  Deno.test(`${version} cancelled late parser failure cannot become a terminal file receipt`, async () => {
    const controller = new AbortController();
    const { deps, req } = await fixture(version, controller.signal);
    const failAfterAbort = () => {
      controller.abort();
      throw new UploadExtractionError(
        422,
        "UPLOAD_RTF_INVALID",
        "Late parser failure",
        false,
      );
    };
    if (version === "upload-extraction.1") {
      const extract = deps.extract;
      deps.extract = async (...args) => {
        await extract(...args);
        return failAfterAbort();
      };
    } else if (version === "upload-extraction.2") {
      const extract = deps.extractWithSource!;
      deps.extractWithSource = async (...args) => {
        await extract(...args);
        return failAfterAbort();
      };
    } else {
      const extract = deps.extractWithSourceV3!;
      deps.extractWithSourceV3 = async (...args) => {
        await extract(...args);
        return failAfterAbort();
      };
    }
    const response = await handleExtractUpload(req, deps);
    assertEquals(response.status, 503);
    const body = await response.json();
    assertEquals([body.error.code, body.retryable], [
      "UPLOAD_EXTRACTION_CANCELLED",
      true,
    ]);
  });
  Deno.test(`${version} hashes and parses one owned source even if Storage alias changes`, async () => {
    const { deps, req, alias, calls, contentSha256 } = await fixture(version);
    assertEquals(alias.length, replacement.length);
    const held = holdOriginalDigest();
    try {
      const pending = handleExtractUpload(req, deps);
      await held.reached;
      alias.set(replacement);
      held.release();
      const response = await pending;
      assertEquals(response.status, 200);
      const body = await response.json();
      assertEquals(body.text, "Original retained source A");
      assertEquals(body.content_sha256, contentSha256);
      assertEquals(calls, { read: 1, parser: 1 });
    } finally {
      held.release();
      held.restore();
    }
  });

  Deno.test(`${version} cancellation during original hashing fences parser dispatch`, async () => {
    const controller = new AbortController();
    const { deps, req, calls } = await fixture(version, controller.signal);
    const held = holdOriginalDigest();
    try {
      const pending = handleExtractUpload(req, deps);
      await held.reached;
      controller.abort();
      held.release();
      const response = await pending;
      assertEquals(response.status, 503);
      assertEquals((await response.json()).retryable, true);
      assertEquals(calls, { read: 1, parser: 0 });
    } finally {
      held.release();
      held.restore();
    }
  });
}

Deno.test("extract-upload cancellation before Storage performs no source read", async () => {
  const { deps, req, calls } = await fixture(
    "upload-extraction.3",
    AbortSignal.abort(),
  );
  const response = await handleExtractUpload(req, deps);
  assertEquals(response.status, 503);
  assertEquals(calls, { read: 0, parser: 0 });
});

Deno.test("extract-upload v1 cannot publish a parser result after caller cancellation", async () => {
  const controller = new AbortController();
  const { deps, req } = await fixture("upload-extraction.1", controller.signal);
  const extract = deps.extract;
  deps.extract = async (...args) => {
    const result = await extract(...args);
    controller.abort();
    return result;
  };
  const response = await handleExtractUpload(req, deps);
  assertEquals(response.status, 503);
  assertEquals((await response.json()).retryable, true);
});

Deno.test("extract-upload digest failure is a sanitized recoverable verification failure", async () => {
  const { deps, req, calls } = await fixture("upload-extraction.3");
  const digest = crypto.subtle.digest;
  crypto.subtle.digest = function (algorithm, data) {
    if (
      data instanceof Uint8Array && data.length === original.length &&
      data.every((byte, i) => byte === original[i])
    ) {
      return Promise.reject(new Error("PRIVATE_HASH_FAILURE_DETAIL"));
    }
    return digest.call(this, algorithm, data);
  };
  try {
    const response = await handleExtractUpload(req, deps);
    assertEquals(response.status, 503);
    const body = await response.text();
    assertEquals(body.includes("PRIVATE_HASH_FAILURE_DETAIL"), false);
    assertEquals(JSON.parse(body).retryable, true);
    assertEquals(
      JSON.parse(body).error.code,
      "UPLOAD_EXTRACTION_SOURCE_UNAVAILABLE",
    );
    assertEquals(calls, { read: 1, parser: 0 });
  } finally {
    crypto.subtle.digest = digest;
  }
});

Deno.test("extract-upload owns only the accepted byte view and rejects shared originals", async () => {
  const { deps, req, contentSha256 } = await fixture("upload-extraction.3");
  const backing = new Uint8Array(original.length + 4).fill(255);
  backing.set(original, 2);
  deps.readOriginal = () => Promise.resolve(backing.subarray(2, -2));
  const response = await handleExtractUpload(req, deps);
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals([body.content_sha256, body.text], [
    contentSha256,
    "Original retained source A",
  ]);
  const shared = new Uint8Array(new SharedArrayBuffer(original.length));
  shared.set(original);
  const bad = await fixture("upload-extraction.3");
  bad.deps.readOriginal = () => Promise.resolve(shared);
  const denied = await handleExtractUpload(bad.req, bad.deps);
  assertEquals(denied.status, 409);
  assertEquals(
    (await denied.json()).error.code,
    "UPLOAD_EXTRACTION_SOURCE_CONFLICT",
  );
  assertEquals(bad.calls.parser, 0);
});
