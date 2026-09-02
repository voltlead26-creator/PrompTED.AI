// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertRejects,
} from "jsr:@std/assert@1";
import {
  IsolatedUploadExtractionError,
  requestIsolatedUploadExtraction,
} from "./upload-extraction-client.ts";

const input = {
  uploadId: "72000000-0000-8000-8000-000000000001",
  userId: "71000000-0000-4000-8000-000000000001",
  requestSha256: "a".repeat(64),
  claimToken: "73000000-0000-4000-8000-000000000001",
};
const contentSha256 = "b".repeat(64);
const runtime = {
  baseUrl: "https://jjsykocqpjlekgsbylkd.supabase.co",
  serviceRoleKey: "synthetic-service-key",
  timeoutMs: 1_000,
};

Deno.test("isolated extraction client binds retained identity and server credential", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const result = await requestIsolatedUploadExtraction(
    input,
    runtime,
    (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return Promise.resolve(
        Response.json({
          upload_id: input.uploadId,
          user_id: input.userId,
          request_sha256: input.requestSha256,
          claim_token: input.claimToken,
          content_sha256: contentSha256,
          text: "Reliable retained source",
          format: "text",
          truncated: false,
          resource_policy_version: "upload-resource-policy.1",
        }),
      );
    },
  );
  assertEquals(result.text, "Reliable retained source");
  assertEquals(
    capturedUrl,
    "https://jjsykocqpjlekgsbylkd.supabase.co/functions/v1/extract-upload",
  );
  assertEquals(new Headers(capturedInit?.headers).get("authorization"),
    "Bearer synthetic-service-key");
  assertEquals(JSON.parse(String(capturedInit?.body)), {
    upload_id: input.uploadId,
    user_id: input.userId,
    request_sha256: input.requestSha256,
    claim_token: input.claimToken,
  });
});

Deno.test("isolated extraction client rejects any non-canonical hosted origin before fetch", async () => {
  const invalidOrigins = [
    "https://attacker.example",
    "https://jjsykocqpjlekgsbylkd.supabase.co.attacker.example",
    "https://otherprojectref00000.supabase.co",
    "https://jjsykocqpjlekgsbylkd.supabase.co:444",
    "https://jjsykocqpjlekgsbylkd.supabase.co/alternate",
    "https://user:password@jjsykocqpjlekgsbylkd.supabase.co",
    "https://jjsykocqpjlekgsbylkd.supabase.co?redirect=attacker",
  ];
  for (const baseUrl of invalidOrigins) {
    let fetchCalled = false;
    await assertRejects(
      () =>
        requestIsolatedUploadExtraction(
          input,
          { ...runtime, baseUrl },
          () => {
            fetchCalled = true;
            return Promise.reject(new Error("must not dispatch"));
          },
        ),
      Error,
      "UPLOAD_EXTRACTION_CONFIGURATION_INVALID",
    );
    assertEquals(fetchCalled, false);
  }
});

Deno.test("isolated extraction client allows the explicit local loopback boundary", async () => {
  let capturedUrl = "";
  await requestIsolatedUploadExtraction(
    input,
    { ...runtime, baseUrl: "http://127.0.0.1:54321" },
    (url) => {
      capturedUrl = String(url);
      return Promise.resolve(Response.json({
        upload_id: input.uploadId,
        user_id: input.userId,
        request_sha256: input.requestSha256,
        claim_token: input.claimToken,
        content_sha256: contentSha256,
        text: "Local retained source",
        format: "text",
        truncated: false,
        resource_policy_version: "upload-resource-policy.1",
      }));
    },
  );
  assertEquals(capturedUrl, "http://127.0.0.1:54321/functions/v1/extract-upload");
});

Deno.test("isolated extraction client preserves deterministic 413 policy failures", async () => {
  const error = await assertRejects(
    () =>
      requestIsolatedUploadExtraction(input, runtime, () =>
        Promise.resolve(
          Response.json(
            {
              error: {
                code: "UPLOAD_ARCHIVE_EXPANSION_LIMIT",
                message: "That file expands beyond the safe limit.",
              },
              retryable: false,
            },
            { status: 413 },
          ),
        )),
    IsolatedUploadExtractionError,
    "UPLOAD_ARCHIVE_EXPANSION_LIMIT",
  );
  assertEquals(error.status, 413);
  assertEquals(error.retryable, false);
});

Deno.test("isolated extraction client turns termination or malformed output into retryable 503", async () => {
  const terminated = await assertRejects(
    () =>
      requestIsolatedUploadExtraction(input, runtime, () =>
        Promise.resolve(new Response("worker terminated", { status: 546 }))),
    IsolatedUploadExtractionError,
    "UPLOAD_EXTRACTION_RESPONSE_INVALID",
  );
  assertEquals(terminated.status, 503);
  assertEquals(terminated.retryable, true);

  const unavailable = await assertRejects(
    () =>
      requestIsolatedUploadExtraction(input, runtime, () =>
        Promise.reject(new Error("synthetic network failure"))),
    IsolatedUploadExtractionError,
    "UPLOAD_EXTRACTION_UNAVAILABLE",
  );
  assertEquals(unavailable.status, 503);
  assertEquals(unavailable.retryable, true);
});
