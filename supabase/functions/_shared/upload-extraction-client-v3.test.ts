// deno-lint-ignore-file no-import-prefix
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { extractBoundedUploadWithSourceV3 } from "./upload-extraction.ts";
import {
  type IsolatedSourceUploadExtractionInputV3,
  IsolatedUploadExtractionError,
  MAX_SOURCE_EXTRACTION_RESPONSE_BYTES,
  requestIsolatedUploadExtraction,
} from "./upload-extraction-client.ts";

const bytes = new TextEncoder().encode(
  String.raw`{\rtf1\ansi Caf\'e9 \u55357?\u56832?}`,
);
const runtime = {
  baseUrl: "http://127.0.0.1:54321",
  serviceRoleKey: "synthetic-v3-reader-key",
  timeoutMs: 1000,
};
async function fixture() {
  const result = await extractBoundedUploadWithSourceV3(
    bytes,
    "source.rtf",
    "application/rtf",
  );
  if (result.format !== "rtf") throw new Error("RTF fixture was not extracted");
  const input: IsolatedSourceUploadExtractionInputV3 = {
    uploadId: "72000000-0000-8000-8000-000000000001",
    userId: "71000000-0000-4000-8000-000000000001",
    requestSha256: "b".repeat(64),
    claimToken: "73000000-0000-4000-8000-000000000001",
    extractionContractVersion: "upload-extraction.3",
    expectedContentSha256: result.sourceManifest.originalSha256,
    expectedByteLength: bytes.length,
  };
  const body = {
    upload_id: input.uploadId,
    user_id: input.userId,
    claim_token: input.claimToken,
    request_sha256: input.requestSha256,
    content_sha256: input.expectedContentSha256,
    content_byte_length: bytes.length,
    extraction_contract_version: input.extractionContractVersion,
    text: result.text,
    format: result.format,
    truncated: result.truncated,
    resource_policy_version: result.resourcePolicyVersion,
    source_manifest: result.sourceManifest,
  };
  return { input, body };
}

Deno.test("v3 client rejects every identity/policy/closed-response downgrade after exactly one dispatch", async () => {
  const { input, body } = await fixture();
  const mutations = [
    { upload_id: input.userId },
    { user_id: input.uploadId },
    { request_sha256: "a".repeat(64) },
    { claim_token: input.userId },
    { content_sha256: "a".repeat(64) },
    { content_byte_length: bytes.length + 1 },
    { extraction_contract_version: "upload-extraction.2" },
    { resource_policy_version: "upload-resource-policy.1" },
    { text: "Unrelated wording" },
    { text: "\ud800" },
    { text: "A\u0000B" },
    { text: "A".repeat(20_001) },
    { format: "text" },
    { format: "docx" },
    { format: "unknown" },
    { truncated: "false" },
    { source_manifest: null },
    { source_manifest: { ...body.source_manifest, blockers: [] } },
    {
      source_manifest: {
        ...body.source_manifest,
        assessment: "format_preserved",
      },
    },
    { private_extra: "PRIVATE_DO_NOT_ECHO" },
  ];
  const missing = { ...body };
  Reflect.deleteProperty(missing, "source_manifest");
  for (
    const candidate of [
      ...mutations.map((patch) => ({ ...body, ...patch })),
      missing,
    ]
  ) {
    let calls = 0;
    const error = await assertRejects(
      () =>
        requestIsolatedUploadExtraction(input, runtime, () => {
          calls++;
          return Promise.resolve(Response.json(candidate));
        }),
      IsolatedUploadExtractionError,
      "UPLOAD_EXTRACTION_RESPONSE_INVALID",
    );
    assertEquals([calls, error.status, error.retryable], [1, 503, true]);
    assertEquals(error.message.includes("PRIVATE_DO_NOT_ECHO"), false);
  }
});

Deno.test("v3 client validates complete expected source identity before dispatch", async () => {
  const { input } = await fixture();
  const mutations = [
    { expectedContentSha256: undefined },
    { expectedContentSha256: "A".repeat(64) },
    { expectedByteLength: undefined },
    { expectedByteLength: 0 },
    { expectedByteLength: 8 * 1024 * 1024 + 1 },
    { expectedByteLength: 1.5 },
    { expectedByteLength: "42" },
    { extractionContractVersion: "upload-extraction.4" },
    { userId: { toString: () => input.userId } },
    { uploadId: { toString: () => input.uploadId } },
    { requestSha256: { toString: () => input.requestSha256 } },
    { claimToken: { toString: () => input.claimToken } },
  ];
  for (const patch of mutations) {
    let calls = 0;
    await assertRejects(
      () =>
        Reflect.apply(requestIsolatedUploadExtraction, null, [
          { ...input, ...patch },
          runtime,
          () => {
            calls++;
            return Promise.resolve(Response.json({}));
          },
        ]),
      Error,
      "UPLOAD_EXTRACTION_REQUEST_INVALID",
    );
    assertEquals(calls, 0);
  }
});

Deno.test("v3 client owns identity while waiting and keeps cancellation ownership", async () => {
  const { input, body } = await fixture();
  const transport = Promise.withResolvers<Response>();
  let calls = 0;
  const pending = requestIsolatedUploadExtraction(input, runtime, () => {
    calls++;
    return transport.promise;
  });
  input.expectedContentSha256 = "a".repeat(64);
  input.expectedByteLength++;
  transport.resolve(Response.json(body));
  const result = await pending;
  assertEquals(result.contentSha256, body.content_sha256);
  assertEquals(result.contentByteLength, body.content_byte_length);
  assertEquals(calls, 1);

  const { input: fresh } = await fixture();
  const controller = new AbortController();
  let cancelledBody = 0;
  const late = Promise.withResolvers<Response>();
  const cancelled = requestIsolatedUploadExtraction(
    { ...fresh, signal: controller.signal },
    runtime,
    () => late.promise,
  );
  controller.abort();
  await assertRejects(
    () => cancelled,
    IsolatedUploadExtractionError,
    "UPLOAD_EXTRACTION_CANCELLED",
  );
  late.resolve(
    new Response(
      new ReadableStream({
        cancel() {
          cancelledBody++;
        },
      }),
    ),
  );
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(cancelledBody, 1);
});

Deno.test("v3 client rejects malformed/lost response without blind redispatch", async () => {
  const { input } = await fixture();
  for (const response of ["{bad", "", "null", "[]", '{"text":"partial"}']) {
    let calls = 0;
    await assertRejects(
      () =>
        requestIsolatedUploadExtraction(input, runtime, () => {
          calls++;
          return Promise.resolve(new Response(response));
        }),
      IsolatedUploadExtractionError,
      "UPLOAD_EXTRACTION_RESPONSE_INVALID",
    );
    assertEquals(calls, 1);
  }
  let lostCalls = 0;
  await assertRejects(
    () =>
      requestIsolatedUploadExtraction(input, runtime, () => {
        lostCalls++;
        return Promise.reject(new Error("Connection lost"));
      }),
    IsolatedUploadExtractionError,
    "UPLOAD_EXTRACTION_UNAVAILABLE",
  );
  assertEquals(lostCalls, 1);
});

Deno.test("v3 client bounds successful source and error bodies independently and cancels unread streams", async () => {
  const { input } = await fixture();
  for (
    const [status, maximum] of [[200, MAX_SOURCE_EXTRACTION_RESPONSE_BYTES], [
      413,
      64 * 1024,
    ]]
  ) {
    let cancelled = 0;
    const response = new Response(
      new ReadableStream({
        cancel() {
          cancelled++;
        },
      }),
      {
        status,
        headers: { "content-length": String(maximum + 1) },
      },
    );
    const error = await assertRejects(
      () =>
        requestIsolatedUploadExtraction(
          input,
          runtime,
          () => Promise.resolve(response),
        ),
      IsolatedUploadExtractionError,
      "UPLOAD_EXTRACTION_RESPONSE_INVALID",
    );
    assertEquals([error.status, error.retryable, cancelled], [503, true, 1]);
  }
});

Deno.test("v3 client preserves structural failure and rejects pre-abort before dispatch", async () => {
  const { input } = await fixture();
  const error = await assertRejects(
    () =>
      requestIsolatedUploadExtraction(input, runtime, () =>
        Promise.resolve(
          Response.json({
            error: {
              code: "UPLOAD_RTF_RESOURCE_LIMIT",
              message: "Too complex",
            },
            retryable: false,
          }, { status: 413 }),
        )),
    IsolatedUploadExtractionError,
    "UPLOAD_RTF_RESOURCE_LIMIT",
  );
  assertEquals([error.status, error.retryable], [413, false]);
  let calls = 0;
  await assertRejects(
    () =>
      requestIsolatedUploadExtraction(
        { ...input, signal: AbortSignal.abort() },
        runtime,
        () => {
          calls++;
          return Promise.resolve(Response.json({}));
        },
      ),
    IsolatedUploadExtractionError,
    "UPLOAD_EXTRACTION_CANCELLED",
  );
  assertEquals(calls, 0);
});

Deno.test("v3 client cancellation during manifest hash settles promptly and observes a late rejection", async () => {
  const { input, body } = await fixture();
  const controller = new AbortController();
  const digest = crypto.subtle.digest;
  const reached = Promise.withResolvers<void>();
  const delayed = Promise.withResolvers<ArrayBuffer>();
  let hashes = 0;
  crypto.subtle.digest = () => {
    hashes++;
    reached.resolve();
    return delayed.promise;
  };
  try {
    const pending = requestIsolatedUploadExtraction(
      { ...input, signal: controller.signal },
      runtime,
      () => Promise.resolve(Response.json(body)),
    );
    await reached.promise;
    controller.abort();
    await assertRejects(
      () => pending,
      IsolatedUploadExtractionError,
      "UPLOAD_EXTRACTION_CANCELLED",
    );
    assertEquals(hashes, 1);
    delayed.reject(new Error("PRIVATE_LATE_HASH_FAILURE"));
    await Promise.resolve();
    await Promise.resolve();
  } finally {
    delayed.resolve(new ArrayBuffer(32));
    crypto.subtle.digest = digest;
  }
});
