// deno-lint-ignore-file no-import-prefix
import { assertEquals } from "jsr:@std/assert@1";
import {
  handleExtractUpload,
  type UploadExtractorDependencies,
} from "./handler.ts";

const key = "synthetic-request-lifecycle-key";
const requestBody = new TextEncoder().encode(JSON.stringify({
  upload_id: "72000000-0000-4000-8000-000000000001",
  user_id: "71000000-0000-4000-8000-000000000001",
  claim_token: "73000000-0000-4000-8000-000000000001",
  request_sha256: "b".repeat(64),
}));

function fixture(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
  length?: string,
) {
  let snapshots = 0;
  const deps: UploadExtractorDependencies = {
    serviceRoleKey: key,
    loadSnapshot: () => {
      snapshots++;
      return Promise.resolve(null);
    },
    readOriginal: () => Promise.reject(new Error("Unexpected Storage read")),
    extract: () => Promise.reject(new Error("Unexpected parser")),
  };
  const req = new Request(
    "https://example.invalid/functions/v1/extract-upload",
    {
      method: "POST",
      body,
      signal,
      headers: {
        authorization: `Bearer ${key}`,
        apikey: key,
        ...(length === undefined ? {} : { "content-length": length }),
      },
    },
  );
  return {
    req,
    run: () => handleExtractUpload(req, deps),
    snapshots: () => snapshots,
  };
}

async function withWatchdog<T>(
  work: Promise<T>,
  milliseconds = 500,
): Promise<T | "still pending"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<"still pending">((resolve) => {
        timer = setTimeout(() => resolve("still pending"), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

Deno.test("extract-upload aborted stalled request cancels once without awaiting transport cleanup", async () => {
  const ready = Promise.withResolvers<void>();
  const cleanup = Promise.withResolvers<void>();
  let cancels = 0;
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  const controller = new AbortController();
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      streamController = value;
    },
    pull() {
      ready.resolve();
    },
    cancel() {
      cancels++;
      return cleanup.promise;
    },
  }, { highWaterMark: 0 });
  const f = fixture(body, controller.signal);
  const pending = f.run();
  try {
    await ready.promise;
    controller.abort();
    const response = await withWatchdog(pending);
    assertEquals(
      response instanceof Response,
      true,
      "aborted request remained pending",
    );
    if (!(response instanceof Response)) return;
    assertEquals(response.status, 503);
    assertEquals(
      (await response.json()).error.code,
      "UPLOAD_EXTRACTION_CANCELLED",
    );
    assertEquals([cancels, f.snapshots(), body.locked], [1, 0, false]);
  } finally {
    // Also releases the defective reader after recording RED; no hanging test resources.
    if (body.locked) {
      streamController!.error(new Error("Synthetic test cleanup"));
    }
    cleanup.resolve();
    await pending;
  }
});

Deno.test("extract-upload request byte ceiling rejects before non-settling cancellation", async () => {
  const cleanup = Promise.withResolvers<void>();
  let cancels = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(4_097));
    },
    cancel() {
      cancels++;
      return cleanup.promise;
    },
  });
  const f = fixture(body);
  const pending = f.run();
  try {
    const response = await withWatchdog(pending);
    assertEquals(
      response instanceof Response,
      true,
      "oversize cleanup delayed the rejection",
    );
    if (!(response instanceof Response)) return;
    assertEquals(response.status, 400);
    assertEquals([cancels, f.snapshots(), body.locked], [1, 0, false]);
  } finally {
    cleanup.resolve();
    await pending;
  }
});

Deno.test("extract-upload bounds empty chunks before a later valid body can be admitted", async () => {
  let pulls = 0;
  let cancels = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      if (pulls <= 4_098) controller.enqueue(new Uint8Array());
      else {
        controller.enqueue(requestBody);
        controller.close();
      }
    },
    cancel() {
      cancels++;
    },
  }, { highWaterMark: 0 });
  const f = fixture(body);
  const response = await f.run();
  assertEquals(response.status, 400);
  assertEquals([pulls, cancels, f.snapshots(), body.locked], [
    4_097,
    1,
    0,
    false,
  ]);
});

Deno.test("extract-upload invalid declared length cancels unread request body", async () => {
  let cancels = 0;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancels++;
    },
  });
  const f = fixture(body, undefined, "4097");
  assertEquals((await f.run()).status, 400);
  assertEquals([cancels, f.snapshots(), body.locked], [1, 0, false]);
});

Deno.test("extract-upload one-byte request chunks preserve valid legacy admission", async () => {
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset < requestBody.length) {
        controller.enqueue(requestBody.slice(offset, ++offset));
      } else controller.close();
    },
  }, { highWaterMark: 0 });
  const f = fixture(body);
  const response = await f.run();
  // A valid request reaches the authoritative snapshot lookup; no fixture is fabricated.
  assertEquals(response.status, 409);
  assertEquals([f.snapshots(), body.locked], [1, false]);
});

Deno.test("extract-upload stalled request hits its own deadline without caller abort", async () => {
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  let cancels = 0;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      streamController = value;
    },
    cancel() {
      cancels++;
      return Promise.reject(new Error("PRIVATE cleanup failure"));
    },
  });
  const f = fixture(body);
  const pending = f.run();
  try {
    const response = await withWatchdog(pending, 6_000);
    assertEquals(
      response instanceof Response,
      true,
      "request deadline did not settle",
    );
    if (!(response instanceof Response)) return;
    assertEquals(response.status, 503);
    const result = await response.json();
    assertEquals([result.error.code, result.retryable], [
      "UPLOAD_EXTRACTION_TIMEOUT",
      true,
    ]);
    assertEquals(JSON.stringify(result).includes("PRIVATE"), false);
    assertEquals([cancels, f.snapshots(), body.locked], [1, 0, false]);
  } finally {
    if (body.locked) {
      streamController!.error(new Error("Synthetic test cleanup"));
    }
    await pending;
  }
});

Deno.test("extract-upload request absolute deadline also bounds streams that starve timers", async () => {
  const now = Date.now;
  let syntheticNow = now();
  let cancels = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      syntheticNow += 6_000;
      controller.enqueue(requestBody);
    },
    cancel() {
      cancels++;
    },
  }, { highWaterMark: 0 });
  const f = fixture(body);
  Date.now = () => syntheticNow;
  try {
    const response = await f.run();
    assertEquals(response.status, 503);
    assertEquals(
      (await response.json()).error.code,
      "UPLOAD_EXTRACTION_TIMEOUT",
    );
    assertEquals([cancels, f.snapshots(), body.locked], [1, 0, false]);
  } finally {
    Date.now = now;
  }
});

Deno.test("extract-upload malformed and invalid UTF-8 request bodies never reach snapshots", async () => {
  for (
    const bytes of [
      new Uint8Array([0xff]),
      new TextEncoder().encode('{"upload_id":'),
    ]
  ) {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const f = fixture(body);
    assertEquals((await f.run()).status, 400);
    assertEquals([f.snapshots(), body.locked], [0, false]);
  }
});
