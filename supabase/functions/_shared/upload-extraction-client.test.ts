// deno-lint-ignore-file no-import-prefix
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  type IsolatedSourceUploadExtractionInput,
  IsolatedUploadExtractionError,
  MAX_SOURCE_EXTRACTION_RESPONSE_BYTES,
  requestIsolatedUploadExtraction,
} from "./upload-extraction-client.ts";
import {
  DOCX_SOURCE_POLICY,
  encodeOfficePartRoster,
} from "./document-source-contract.ts";
import { mapWordXmlSource } from "./wordprocessingml-source.ts";

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

Deno.test("isolated extraction v2 binds an explicit source-absent result to the accepted version and original", async () => {
  const accepted = {
    ...input,
    extractionContractVersion: "upload-extraction.2" as const,
    expectedContentSha256: contentSha256,
    expectedByteLength: 32,
  };
  let sent: unknown;
  const result = await requestIsolatedUploadExtraction(
    accepted,
    runtime,
    (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return Promise.resolve(
        Response.json({
          ...responseBody(),
          extraction_contract_version: "upload-extraction.2",
          content_byte_length: 32,
          source_manifest: null,
        }),
      );
    },
  );
  assertEquals(sent, {
    upload_id: input.uploadId,
    user_id: input.userId,
    request_sha256: input.requestSha256,
    claim_token: input.claimToken,
    extraction_contract_version: "upload-extraction.2",
  });
  assertEquals<unknown>(result, {
    contentSha256,
    text: "Reliable retained source",
    format: "text",
    truncated: false,
    resourcePolicyVersion: "upload-resource-policy.1",
    extractionContractVersion: "upload-extraction.2",
    contentByteLength: 32,
    sourceManifest: null,
  });
});

function responseBody(text = "Reliable retained source") {
  return {
    upload_id: input.uploadId,
    user_id: input.userId,
    request_sha256: input.requestSha256,
    claim_token: input.claimToken,
    content_sha256: contentSha256,
    text,
    format: "text",
    truncated: false,
    resource_policy_version: "upload-resource-policy.1",
  };
}

// Transport fixture with actual mapped XML and declared package metadata.
// Actual ZIP identity is independently covered by the combined producer tests.
async function sourceResponse(text = "Source wording") {
  const xml = new TextEncoder().encode(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  const source = await mapWordXmlSource(xml);
  const parts = [
    {
      path: "[Content_Types].xml",
      compressionMethod: 0,
      compressedByteLength: 64,
      uncompressedByteLength: 64,
      crc32: 1,
      contentSha256,
    },
    {
      path: "_rels/.rels",
      compressionMethod: 0,
      compressedByteLength: 64,
      uncompressedByteLength: 64,
      crc32: 2,
      contentSha256,
    },
    {
      path: "word/document.xml",
      compressionMethod: 0,
      compressedByteLength: xml.length,
      uncompressedByteLength: xml.length,
      crc32: 3,
      contentSha256: source.originalSha256,
    },
  ];
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encodeOfficePartRoster(parts)),
  );
  const accepted: IsolatedSourceUploadExtractionInput = {
    ...input,
    extractionContractVersion: "upload-extraction.2",
    expectedContentSha256: contentSha256,
    expectedByteLength: xml.length + 2048,
  };
  return {
    accepted,
    body: {
      ...responseBody(),
      format: "docx",
      extraction_contract_version: "upload-extraction.2",
      content_byte_length: accepted.expectedByteLength,
      source_manifest: {
        version: DOCX_SOURCE_POLICY.version,
        assessment: "source_only" as const,
        archiveSha256: contentSha256,
        archiveByteLength: accepted.expectedByteLength,
        rosterEncodingVersion: DOCX_SOURCE_POLICY.rosterEncodingVersion,
        partRosterSha256: Array.from(
          digest,
          (b) => b.toString(16).padStart(2, "0"),
        ).join(""),
        parts,
        mainPart: { path: "word/document.xml" as const, source },
        blockers: [
          "layout_unassessed",
          "package_semantics_unassessed",
          "styles_and_visibility_unassessed",
        ],
      },
    },
  };
}

Deno.test("isolated extraction v2 accepts a bounded DOCX source larger than v1 without upgrading v1", async () => {
  const fixture = await sourceResponse("Source 😀 ".repeat(8_000));
  assert(
    new TextEncoder().encode(JSON.stringify(fixture.body)).length > 65_536,
  );
  const result = await requestIsolatedUploadExtraction(
    fixture.accepted,
    runtime,
    () => Promise.resolve(Response.json(fixture.body)),
  );
  assert(result.format === "docx");
  assertEquals(result.sourceManifest, fixture.body.source_manifest);
  assert(
    Object.isFrozen(result) &&
      Object.isFrozen(result.sourceManifest.mainPart.source.nodes),
  );
  await assertRejects(
    () =>
      requestIsolatedUploadExtraction(
        input,
        runtime,
        () => Promise.resolve(Response.json(fixture.body)),
      ),
    IsolatedUploadExtractionError,
    "UPLOAD_EXTRACTION_RESPONSE_INVALID",
  );
});

Deno.test("isolated extraction v2 rejects downgraded responses and wrong source identity or closed variants", async () => {
  const { accepted, body } = await sourceResponse();
  const withoutManifest = { ...body } as Record<string, unknown>;
  delete withoutManifest.source_manifest;
  for (
    const candidate of [
      responseBody(),
      withoutManifest,
      { ...body, extra: true },
      { ...body, extraction_contract_version: "upload-extraction.1" },
      { ...body, extraction_contract_version: null },
      { ...body, content_byte_length: accepted.expectedByteLength + 1 },
      { ...body, content_sha256: "c".repeat(64) },
      { ...body, format: ["docx"] },
      { ...body, format: ["text"], source_manifest: null },
      { ...body, format: "text" },
      { ...body, source_manifest: null },
      {
        ...body,
        source_manifest: {
          ...body.source_manifest,
          archiveSha256: "c".repeat(64),
        },
      },
      {
        ...body,
        source_manifest: { ...body.source_manifest, assessment: "approved" },
      },
    ]
  ) {
    let requests = 0;
    await assertRejects(
      () =>
        requestIsolatedUploadExtraction(accepted, runtime, () => {
          requests += 1;
          return Promise.resolve(Response.json(candidate));
        }),
      IsolatedUploadExtractionError,
      "UPLOAD_EXTRACTION_RESPONSE_INVALID",
    );
    assertEquals(requests, 1);
  }
});

Deno.test("isolated extraction v2 independently bounds transport envelope manifest and error responses", async () => {
  const { accepted, body } = await sourceResponse();
  const serialized = JSON.stringify(body);
  const size = new TextEncoder().encode(serialized).length;
  const exact = serialized +
    " ".repeat(MAX_SOURCE_EXTRACTION_RESPONSE_BYTES - size);
  const result = await requestIsolatedUploadExtraction(
    accepted,
    runtime,
    () => Promise.resolve(new Response(exact)),
  );
  assertEquals(result.text, body.text);
  for (
    const response of [
      new Response(exact + " "),
      // Valid short UTF-16 text still has an oversized escaped JSON envelope.
      Response.json({ ...body, text: "\u0001".repeat(20_000) }),
      Response.json({
        ...body,
        source_manifest: {
          ...body.source_manifest,
          mainPart: {
            ...body.source_manifest.mainPart,
            source: {
              ...body.source_manifest.mainPart.source,
              nodes: [{
                ...body.source_manifest.mainPart.source.nodes[0],
                text: "x".repeat(DOCX_SOURCE_POLICY.maxManifestBytes + 1),
              }],
            },
          },
        },
      }),
      new Response(
        JSON.stringify({
          error: { code: "LIMIT", message: "retry" },
          retryable: true,
        }) + " ".repeat(65_536),
        { status: 503 },
      ),
    ]
  ) {
    await assertRejects(
      () =>
        requestIsolatedUploadExtraction(
          accepted,
          runtime,
          () => Promise.resolve(response),
        ),
      IsolatedUploadExtractionError,
      "UPLOAD_EXTRACTION_RESPONSE_INVALID",
    );
  }
});

Deno.test("isolated extraction v2 accepts each exact inner byte ceiling and rejects one byte over", async () => {
  const encoder = new TextEncoder();
  const provisional = await sourceResponse("x".repeat(1_040_000));
  const room = DOCX_SOURCE_POLICY.maxManifestBytes -
    encoder.encode(JSON.stringify(provisional.body.source_manifest)).length;
  const fixture = await sourceResponse("x".repeat(1_040_000 + room));
  assertEquals(
    encoder.encode(JSON.stringify(fixture.body.source_manifest)).length,
    DOCX_SOURCE_POLICY.maxManifestBytes,
  );
  assertEquals(
    (await requestIsolatedUploadExtraction(
      fixture.accepted,
      runtime,
      () => Promise.resolve(Response.json(fixture.body)),
    )).format,
    "docx",
  );
  const oneOver = await sourceResponse("x".repeat(1_040_001 + room));
  assertEquals(
    encoder.encode(JSON.stringify(oneOver.body.source_manifest)).length,
    DOCX_SOURCE_POLICY.maxManifestBytes + 1,
  );
  await assertRejects(
    () =>
      requestIsolatedUploadExtraction(
        oneOver.accepted,
        runtime,
        () => Promise.resolve(Response.json(oneOver.body)),
      ),
    IsolatedUploadExtractionError,
    "UPLOAD_EXTRACTION_RESPONSE_INVALID",
  );

  const envelope = {
    ...responseBody(""),
    extraction_contract_version: "upload-extraction.2",
    content_byte_length: fixture.accepted.expectedByteLength,
  };
  const textRoom = 65_536 - encoder.encode(JSON.stringify(envelope)).length;
  envelope.text = "\u0001".repeat(Math.floor(textRoom / 6)) +
    "x".repeat(textRoom % 6);
  assert(envelope.text.length <= 20_000);
  assertEquals(encoder.encode(JSON.stringify(envelope)).length, 65_536);
  assertEquals(
    (await requestIsolatedUploadExtraction(
      fixture.accepted,
      runtime,
      () =>
        Promise.resolve(Response.json({ ...envelope, source_manifest: null })),
    ))
      .text,
    envelope.text,
  );
  await assertRejects(
    () =>
      requestIsolatedUploadExtraction(
        fixture.accepted,
        runtime,
        () =>
          Promise.resolve(
            Response.json({
              ...envelope,
              text: envelope.text + "x",
              source_manifest: null,
            }),
          ),
      ),
    IsolatedUploadExtractionError,
    "UPLOAD_EXTRACTION_RESPONSE_INVALID",
  );
});

Deno.test("isolated extraction requires supported versions and complete expected identity before dispatch", async () => {
  for (
    const candidate of [
      { ...input, extractionContractVersion: null },
      { ...input, extractionContractVersion: "upload-extraction.3" },
      { ...input, extractionContractVersion: "upload-extraction.2" },
      {
        ...input,
        extractionContractVersion: "upload-extraction.2",
        expectedContentSha256: contentSha256,
        expectedByteLength: 0,
      },
      {
        ...input,
        extractionContractVersion: "upload-extraction.2",
        expectedContentSha256: contentSha256,
        expectedByteLength: "32",
      },
    ]
  ) {
    let dispatched = false;
    await assertRejects(
      () =>
        requestIsolatedUploadExtraction(
          candidate as unknown as IsolatedSourceUploadExtractionInput,
          runtime,
          () => {
            dispatched = true;
            return Promise.resolve(Response.json(responseBody()));
          },
        ),
      Error,
      "UPLOAD_EXTRACTION_REQUEST_INVALID",
    );
    assertEquals(dispatched, false);
  }
});

Deno.test("isolated extraction v2 bounds chunk work with fixed storage and accepts its exact one-byte delivery ceiling", async () => {
  const { accepted, body } = await sourceResponse();
  const base = new TextEncoder().encode(JSON.stringify(body));
  const bytes = new Uint8Array(MAX_SOURCE_EXTRACTION_RESPONSE_BYTES).fill(32);
  bytes.set(base);
  let offset = 0;
  const oneByte = new Uint8Array(1);
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.length) {
          controller.close();
          return;
        }
        oneByte[0] = bytes[offset++]!;
        controller.enqueue(oneByte);
      },
    }, { highWaterMark: 0 }),
  );
  const result = await requestIsolatedUploadExtraction(accepted, {
    ...runtime,
    timeoutMs: 5_000,
  }, () => Promise.resolve(response));
  assertEquals(offset, MAX_SOURCE_EXTRACTION_RESPONSE_BYTES);
  assertEquals(result.text, body.text);
  let chunks = 0;
  let cancelled = 0;
  const empty = new Uint8Array();
  await assertRejects(
    () =>
      requestIsolatedUploadExtraction(accepted, {
        ...runtime,
        timeoutMs: 5_000,
      }, () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                chunks += 1;
                controller.enqueue(empty);
              },
              cancel() {
                cancelled += 1;
              },
            }, { highWaterMark: 0 }),
          ),
        )),
    IsolatedUploadExtractionError,
    "UPLOAD_EXTRACTION_RESPONSE_INVALID",
  );
  assertEquals(chunks, MAX_SOURCE_EXTRACTION_RESPONSE_BYTES + 1);
  assertEquals(cancelled, 1);
});

Deno.test("isolated extraction v2 owns expected original identity while waiting for the transport", async () => {
  const { accepted, body } = await sourceResponse();
  const waiting = deferred<Response>();
  const pending = requestIsolatedUploadExtraction(
    accepted,
    runtime,
    () => waiting.promise,
  );
  accepted.expectedContentSha256 = "c".repeat(64);
  accepted.expectedByteLength += 1;
  waiting.resolve(Response.json(body));
  const result = await pending;
  assertEquals(result.contentSha256, contentSha256);
  assertEquals(result.contentByteLength, body.content_byte_length);
});

Deno.test("isolated extraction stops immediate stream work at the accepted deadline before timers run", async () => {
  const { accepted, body } = await sourceResponse();
  const nativeNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  let pulls = 0;
  let cancels = 0;
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (pulls === 1) {
        now = 3_000;
        controller.enqueue(bytes.subarray(0, 1));
      } else if (pulls === 2) controller.enqueue(bytes.subarray(1));
      else controller.close();
    },
    cancel() {
      cancels += 1;
    },
  }, { highWaterMark: 0 });
  try {
    await assertRejects(
      () =>
        requestIsolatedUploadExtraction(
          accepted,
          runtime,
          () => Promise.resolve(new Response(stream)),
        ),
      IsolatedUploadExtractionError,
      "UPLOAD_EXTRACTION_TIMEOUT",
    );
    assertEquals([pulls, cancels, stream.locked], [1, 1, false]);
  } finally {
    Date.now = nativeNow;
  }
});

Deno.test("isolated extraction cannot publish v1 success after its deadline merely because the timer is queued", async () => {
  const nativeNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  try {
    await assertRejects(
      () =>
        requestIsolatedUploadExtraction(input, runtime, () => {
          now = 3_000;
          return Promise.resolve(Response.json(responseBody()));
        }),
      IsolatedUploadExtractionError,
      "UPLOAD_EXTRACTION_TIMEOUT",
    );
  } finally {
    Date.now = nativeNow;
  }
});

Deno.test("isolated extraction v2 keeps cancellation ownership during manifest hashing and observes late rejection", async () => {
  const { accepted, body } = await sourceResponse();
  const controller = new AbortController();
  const started = deferred<void>();
  const digest = deferred<ArrayBuffer>();
  const nativeDigest = crypto.subtle.digest;
  crypto.subtle.digest = () => {
    started.resolve();
    return digest.promise.then(() => {
      throw new Error("late synthetic digest rejection");
    });
  };
  try {
    const pending = outcome(
      requestIsolatedUploadExtraction(
        { ...accepted, signal: controller.signal },
        runtime,
        () => Promise.resolve(Response.json(body)),
      ),
    );
    await started.promise;
    controller.abort();
    const result = await beforeTestDeadline(pending);
    assert(result !== "still_pending" && result.kind === "failure");
    assertEquals(result.error.code, "UPLOAD_EXTRACTION_CANCELLED");
  } finally {
    digest.resolve(new ArrayBuffer(32));
    crypto.subtle.digest = nativeDigest;
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function outcome<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ kind: "success" as const, value }),
    (error) => ({ kind: "failure" as const, error }),
  );
}

async function beforeTestDeadline<T>(promise: Promise<T>, ms = 50) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<"still_pending">((resolve) => {
        timer = setTimeout(() => resolve("still_pending"), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

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
  assertEquals(
    new Headers(capturedInit?.headers).get("authorization"),
    "Bearer synthetic-service-key",
  );
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
  assertEquals(
    capturedUrl,
    "http://127.0.0.1:54321/functions/v1/extract-upload",
  );
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
      requestIsolatedUploadExtraction(
        input,
        runtime,
        () =>
          Promise.resolve(new Response("worker terminated", { status: 546 })),
      ),
    IsolatedUploadExtractionError,
    "UPLOAD_EXTRACTION_RESPONSE_INVALID",
  );
  assertEquals(terminated.status, 503);
  assertEquals(terminated.retryable, true);

  const unavailable = await assertRejects(
    () =>
      requestIsolatedUploadExtraction(
        input,
        runtime,
        () => Promise.reject(new Error("synthetic network failure")),
      ),
    IsolatedUploadExtractionError,
    "UPLOAD_EXTRACTION_UNAVAILABLE",
  );
  assertEquals(unavailable.status, 503);
  assertEquals(unavailable.retryable, true);
});

Deno.test("isolated extraction rejects pre-cancellation before dispatch", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const result = await outcome(requestIsolatedUploadExtraction(
    { ...input, signal: controller.signal },
    runtime,
    () => {
      calls += 1;
      return Promise.resolve(Response.json(responseBody()));
    },
  ));
  assertEquals(calls, 0);
  assertEquals(result.kind, "failure");
  if (result.kind === "failure") {
    assertEquals(result.error.code, "UPLOAD_EXTRACTION_CANCELLED");
  }
});

Deno.test("isolated extraction cancellation settles a pending fetch and disposes its late body", async () => {
  const controller = new AbortController();
  const fetchResult = deferred<Response>();
  let cancellations = 0;
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(value) {
        streamController = value;
      },
      cancel() {
        cancellations += 1;
      },
    }),
  );
  const request = outcome(requestIsolatedUploadExtraction(
    { ...input, signal: controller.signal },
    runtime,
    () => fetchResult.promise,
  ));
  controller.abort();
  const observed = await beforeTestDeadline(request);
  fetchResult.resolve(response);
  await Promise.resolve();
  await Promise.resolve();
  if (cancellations === 0) streamController.close();
  await request;
  assert(
    observed !== "still_pending",
    "Cancellation must not wait for fetch to settle",
  );
  assertEquals(observed.kind, "failure");
  assertEquals(cancellations, 1);
  assertEquals(response.body?.locked, false);
});

Deno.test("isolated extraction cancellation releases a stalled body without awaiting stalled cleanup", async () => {
  const controller = new AbortController();
  const reading = deferred<void>();
  const cleanup = deferred<void>();
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  let cancellations = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(value) {
        streamController = value;
      },
      pull() {
        reading.resolve();
      },
      cancel() {
        cancellations += 1;
        return cleanup.promise;
      },
    }, { highWaterMark: 0 }),
  );
  const request = outcome(requestIsolatedUploadExtraction(
    { ...input, signal: controller.signal },
    runtime,
    () => Promise.resolve(response),
  ));
  await reading.promise;
  controller.abort();
  const observed = await beforeTestDeadline(request);
  // Release the baseline implementation as well, so an intended failure cannot
  // strand a test process. This cleanup does not determine the assertion.
  if (cancellations === 0) streamController.close();
  cleanup.resolve();
  await request;
  assert(
    observed !== "still_pending",
    "Cancellation must release a pending reader independently of cleanup",
  );
  assertEquals(observed.kind, "failure");
  if (observed.kind === "failure") {
    assertEquals(observed.error.code, "UPLOAD_EXTRACTION_CANCELLED");
  }
  assertEquals(cancellations, 1);
  assertEquals(response.body?.locked, false);
});

Deno.test("isolated extraction timeout settles a transport that never honours its signal", async () => {
  const reading = deferred<void>();
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  let cancellations = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(value) {
        streamController = value;
      },
      pull() {
        reading.resolve();
      },
      cancel() {
        cancellations += 1;
      },
    }, { highWaterMark: 0 }),
  );
  const request = outcome(
    requestIsolatedUploadExtraction(
      input,
      runtime,
      () => Promise.resolve(response),
    ),
  );
  await reading.promise;
  const observed = await beforeTestDeadline(request, 1_500);
  if (cancellations === 0) streamController.close();
  await request;
  assert(
    observed !== "still_pending",
    "The accepted 1s deadline must terminate a stalled body",
  );
  assertEquals(observed.kind, "failure");
  if (observed.kind === "failure") {
    assertEquals(observed.error.code, "UPLOAD_EXTRACTION_TIMEOUT");
    assertEquals(observed.error.retryable, true);
  }
  assertEquals(cancellations, 1);
  assertEquals(response.body?.locked, false);
});

Deno.test("isolated extraction rejects oversized response metadata and cancels its unread body", async () => {
  let cancellations = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        cancellations += 1;
      },
    }),
    { headers: { "content-length": String(64 * 1024 + 1) } },
  );
  await assertRejects(
    () =>
      requestIsolatedUploadExtraction(
        input,
        runtime,
        () => Promise.resolve(response),
      ),
    IsolatedUploadExtractionError,
    "UPLOAD_EXTRACTION_RESPONSE_INVALID",
  );
  assertEquals(cancellations, 1);
  assertEquals(response.body?.locked, false);
});

Deno.test("isolated extraction size rejection does not await non-responsive stream cleanup", async () => {
  const cleanup = deferred<void>();
  let cancellations = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64 * 1024 + 1));
      },
      cancel() {
        cancellations += 1;
        return cleanup.promise;
      },
    }),
  );
  const request = outcome(
    requestIsolatedUploadExtraction(
      input,
      runtime,
      () => Promise.resolve(response),
    ),
  );
  const observed = await beforeTestDeadline(request);
  cleanup.resolve();
  await request;
  assert(
    observed !== "still_pending",
    "Size rejection must not await remote stream cleanup",
  );
  assertEquals(observed.kind, "failure");
  assertEquals(cancellations, 1);
  assertEquals(response.body?.locked, false);
});

Deno.test("isolated extraction disposes a response when abort crosses fetch settlement microtasks", async () => {
  const controller = new AbortController();
  let cancellations = 0;
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(value) {
        streamController = value;
      },
      cancel() {
        cancellations += 1;
      },
    }),
  );
  const result = await outcome(requestIsolatedUploadExtraction(
    { ...input, signal: controller.signal },
    runtime,
    () => {
      queueMicrotask(() => queueMicrotask(() => controller.abort()));
      return Promise.resolve(response);
    },
  ));
  if (cancellations === 0) streamController.close();
  assertEquals(result.kind, "failure");
  assertEquals(cancellations, 1);
  assertEquals(response.body?.locked, false);
});

Deno.test("isolated extraction bounds empty chunks even when they never yield to timers", async () => {
  let chunks = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks += 1;
        if (chunks <= 64 * 1024 + 1) controller.enqueue(new Uint8Array());
        else {
          controller.enqueue(
            new TextEncoder().encode(JSON.stringify(responseBody())),
          );
          controller.close();
        }
      },
    }, { highWaterMark: 0 }),
  );
  const result = await outcome(
    requestIsolatedUploadExtraction(
      input,
      runtime,
      () => Promise.resolve(response),
    ),
  );
  assertEquals(result.kind, "failure");
  if (result.kind === "failure") {
    assertEquals(result.error.code, "UPLOAD_EXTRACTION_RESPONSE_INVALID");
  }
  assertEquals(chunks, 64 * 1024 + 1);
  assertEquals(response.body?.locked, false);
});

Deno.test("isolated extraction retains its accepted identity if caller objects change while waiting", async () => {
  const accepted = { ...input };
  const response = deferred<Response>();
  const request = outcome(
    requestIsolatedUploadExtraction(accepted, runtime, () => response.promise),
  );
  accepted.userId = "71000000-0000-4000-8000-000000000009";
  accepted.uploadId = "72000000-0000-8000-8000-000000000009";
  response.resolve(
    Response.json({
      ...responseBody(),
      user_id: accepted.userId,
      upload_id: accepted.uploadId,
    }),
  );
  const result = await request;
  assertEquals(result.kind, "failure");
  if (result.kind === "failure") {
    assertEquals(result.error.code, "UPLOAD_EXTRACTION_RESPONSE_INVALID");
  }
});

Deno.test("isolated extraction handles one-byte UTF-8 chunks and the exact 64KiB response ceiling", async () => {
  const bytes = new TextEncoder().encode(
    JSON.stringify(responseBody("Résumé 😀")),
  );
  let offset = 0;
  const chunked = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.length) controller.close();
        else controller.enqueue(bytes.slice(offset, ++offset));
      },
    }),
  );
  const result = await requestIsolatedUploadExtraction(
    input,
    runtime,
    () => Promise.resolve(chunked),
  );
  assertEquals(result.text, "Résumé 😀");
  assertEquals(chunked.body?.locked, false);
  const ordinary = JSON.stringify(responseBody());
  const exact = ordinary +
    " ".repeat(64 * 1024 - new TextEncoder().encode(ordinary).length);
  const exactBytes = new TextEncoder().encode(exact);
  let exactOffset = 0;
  const exactChunked = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (exactOffset === exactBytes.length) controller.close();
        else controller.enqueue(exactBytes.slice(exactOffset, ++exactOffset));
      },
    }, { highWaterMark: 0 }),
  );
  assertEquals(
    (await requestIsolatedUploadExtraction(
      input,
      runtime,
      () => Promise.resolve(exactChunked),
    )).text,
    "Reliable retained source",
  );
  assertEquals(exactOffset, 64 * 1024);
  assertEquals(exactChunked.body?.locked, false);
  assertEquals(
    (await requestIsolatedUploadExtraction(
      input,
      runtime,
      () => Promise.resolve(new Response(exact)),
    )).text,
    "Reliable retained source",
  );
  await assertRejects(
    () =>
      requestIsolatedUploadExtraction(
        input,
        runtime,
        () => Promise.resolve(new Response(exact + " ")),
      ),
    IsolatedUploadExtractionError,
    "UPLOAD_EXTRACTION_RESPONSE_INVALID",
  );
});

Deno.test("isolated extraction preserves cancellation when a late transport or cleanup rejects", async () => {
  const controller = new AbortController();
  let rejectFetch!: (error: Error) => void;
  const pending = new Promise<Response>((_resolve, reject) => {
    rejectFetch = reject;
  });
  const request = outcome(
    requestIsolatedUploadExtraction(
      { ...input, signal: controller.signal },
      runtime,
      () => pending,
    ),
  );
  controller.abort();
  const result = await request;
  rejectFetch(new Error("Synthetic late fetch rejection"));
  await Promise.resolve();
  assertEquals(result.kind, "failure");
  if (result.kind === "failure") {
    assertEquals(result.error.code, "UPLOAD_EXTRACTION_CANCELLED");
  }

  const response = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        return Promise.reject(new Error("Synthetic cleanup rejection"));
      },
    }),
    { headers: { "content-length": "invalid" } },
  );
  await assertRejects(
    () =>
      requestIsolatedUploadExtraction(
        input,
        runtime,
        () => Promise.resolve(response),
      ),
    IsolatedUploadExtractionError,
    "UPLOAD_EXTRACTION_RESPONSE_INVALID",
  );
  assertEquals(response.body?.locked, false);
});
