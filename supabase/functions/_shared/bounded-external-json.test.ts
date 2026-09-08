// deno-lint-ignore-file no-import-prefix -- Edge test dependencies are pinned by the repository lockfile.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  ExternalJsonError,
  fetchBoundedExternalJson,
} from "./bounded-external-json.ts";

const URL =
  "https://catalogue.example.test/api/3/action/package_search?q=synthetic";
const encode = (value: string) => new TextEncoder().encode(value);
const identity = (value: unknown) => value;
const response = (body = '{"success":true}') =>
  new Response(body, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });

function read(
  overrides: Partial<Parameters<typeof fetchBoundedExternalJson<unknown>>[0]> =
    {},
) {
  return fetchBoundedExternalJson({
    url: URL,
    maximumBytes: 1024,
    timeoutMs: 1000,
    validate: identity,
    fetchImpl: () => Promise.resolve(response()),
    ...overrides,
  });
}

function deferred<T>() {
  let resolveValue: (value: T) => void = () => {
    throw new Error("Fixture not initialised");
  };
  let rejectValue: (error: unknown) => void = () => {
    throw new Error("Fixture not initialised");
  };
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });
  return {
    promise,
    resolve: (value: T) => resolveValue(value),
    reject: rejectValue,
  };
}

Deno.test("external JSON retains real scalar/object/array values and releases the reader", async () => {
  for (const value of [null, false, 17, "café", [], { nested: [true, 1] }]) {
    const supplied = response(JSON.stringify(value));
    assertEquals(
      await read({ fetchImpl: () => Promise.resolve(supplied) }),
      value,
    );
    assertEquals(supplied.body?.locked, false);
  }
});

Deno.test("external JSON pre-abort prevents dispatch and is a known non-dispatch", async () => {
  const controller = new AbortController();
  controller.abort(new Error("private cancellation detail"));
  let calls = 0;
  const error = await assertRejects(() =>
    read({
      signal: controller.signal,
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(response());
      },
    }), ExternalJsonError);
  assertEquals([calls, error.failure, error.dispatchCertain], [
    0,
    "cancelled",
    true,
  ]);
  assertEquals(error.message.includes("private"), false);
});

Deno.test("external JSON aborts a pending fetch, disposes its late response and never waits for cancellation cleanup", async () => {
  const controller = new AbortController();
  const pending = deferred<Response>();
  const dispatched = deferred<void>();
  const running = read({
    signal: controller.signal,
    fetchImpl: () => {
      dispatched.resolve();
      return pending.promise;
    },
  });
  await dispatched.promise;
  controller.abort();
  const error = await assertRejects(() => running, ExternalJsonError);
  assertEquals([error.failure, error.dispatchCertain], ["cancelled", false]);
  let cancelled = 0;
  let pulled = 0;
  pending.resolve(
    new Response(
      new ReadableStream<Uint8Array>({
        pull() {
          pulled += 1;
        },
        cancel() {
          cancelled += 1;
          return new Promise<void>(() => {});
        },
      }, { highWaterMark: 0 }),
      { headers: { "content-type": "application/json" } },
    ),
  );
  await Promise.resolve();
  await Promise.resolve();
  assertEquals([pulled, cancelled], [0, 1]);
});

Deno.test("external JSON consumes a late fetch rejection after caller cancellation", async () => {
  const controller = new AbortController();
  const pending = deferred<Response>();
  const running = read({
    signal: controller.signal,
    fetchImpl: () => pending.promise,
  });
  controller.abort();
  await assertRejects(() => running, ExternalJsonError);
  pending.reject(new Error("late private network error"));
  await Promise.resolve();
  await Promise.resolve();
});

Deno.test("external JSON deadline rejects a transport that ignores its signal", async () => {
  const observed: { signal?: AbortSignal | null } = {};
  const pending = deferred<Response>();
  const error = await assertRejects(() =>
    read({
      timeoutMs: 20,
      fetchImpl: (_url, init) => {
        observed.signal = init?.signal;
        return pending.promise;
      },
    }), ExternalJsonError);
  assertEquals([error.failure, error.dispatchCertain], ["timeout", false]);
  assert(
    observed.signal?.aborted,
    "The real dispatched signal must also be aborted.",
  );
  pending.reject(new Error("late timeout rejection"));
  await Promise.resolve();
});

Deno.test("external JSON cancellation during a held body is known and releases despite stalled cleanup", async () => {
  const controller = new AbortController();
  const reading = deferred<void>();
  let cancelled = 0;
  const supplied = new Response(
    new ReadableStream<Uint8Array>({
      pull() {
        reading.resolve();
      },
      cancel() {
        cancelled += 1;
        return new Promise<void>(() => {});
      },
    }, { highWaterMark: 0 }),
    { headers: { "content-type": "application/json" } },
  );
  const running = read({
    signal: controller.signal,
    fetchImpl: () => Promise.resolve(supplied),
  });
  await reading.promise;
  controller.abort();
  const error = await assertRejects(() => running, ExternalJsonError);
  assertEquals([error.failure, error.dispatchCertain], ["cancelled", true]);
  assertEquals(cancelled, 1);
  assertEquals(supplied.body?.locked, false);
});

Deno.test("external JSON preserves its safe error when unread body cleanup rejects", async () => {
  let cancelled = 0;
  const supplied = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        cancelled += 1;
        return Promise.reject(new Error("private cleanup failure"));
      },
    }, { highWaterMark: 0 }),
    { headers: { "content-type": "text/html" } },
  );
  const error = await assertRejects(
    () => read({ fetchImpl: () => Promise.resolve(supplied) }),
    ExternalJsonError,
  );
  assertEquals([error.failure, error.dispatchCertain, cancelled], [
    "invalid_response",
    true,
    1,
  ]);
  assertEquals(error.message.includes("private"), false);
});

Deno.test("external JSON classifies a received broken body as known without exposing its error", async () => {
  const supplied = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("private body error"));
      },
    }, { highWaterMark: 0 }),
    { headers: { "content-type": "application/json" } },
  );
  const error = await assertRejects(
    () => read({ fetchImpl: () => Promise.resolve(supplied) }),
    ExternalJsonError,
  );
  assertEquals([error.failure, error.dispatchCertain], [
    "invalid_response",
    true,
  ]);
  assertEquals(supplied.body?.locked, false);
  assertEquals(error.message.includes("private"), false);
});

Deno.test("external JSON observes the absolute deadline at EOF before timers run", async () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  let pulls = 0;
  const supplied = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(encode("{}"));
        else {
          now += 1001;
          controller.close();
        }
      },
    }, { highWaterMark: 0 }),
    { headers: { "content-type": "application/json" } },
  );
  try {
    const error = await assertRejects(
      () => read({ fetchImpl: () => Promise.resolve(supplied) }),
      ExternalJsonError,
    );
    assertEquals([error.failure, error.dispatchCertain, pulls], [
      "timeout",
      true,
      2,
    ]);
    assertEquals(supplied.body?.locked, false);
  } finally {
    Date.now = originalNow;
  }
});

Deno.test("external JSON fences publication after synchronous validation exhausts the deadline", async () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    const error = await assertRejects(() =>
      read({
        validate(value) {
          now += 1001;
          return value;
        },
      }), ExternalJsonError);
    assertEquals([error.failure, error.dispatchCertain], ["timeout", true]);
  } finally {
    Date.now = originalNow;
  }
});

Deno.test("external JSON rejects excessive empty chunks before the promised later valid body", async () => {
  let pulls = 0;
  let cancelled = 0;
  const supplied = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls <= 33) controller.enqueue(new Uint8Array());
        else {
          controller.enqueue(encode("{}"));
          controller.close();
        }
      },
      cancel() {
        cancelled += 1;
      },
    }, { highWaterMark: 0 }),
    { headers: { "content-type": "application/json" } },
  );
  await assertRejects(
    () => read({ fetchImpl: () => Promise.resolve(supplied) }),
    ExternalJsonError,
  );
  assertEquals([pulls, cancelled, supplied.body?.locked], [33, 1, false]);
});

Deno.test("external JSON preserves exact bytes across reused mutable stream chunks", async () => {
  const bytes = encode('"a');
  let pulls = 0;
  const supplied = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(bytes);
        else if (pulls === 2) {
          bytes.set(encode('b"'));
          controller.enqueue(bytes);
        } else controller.close();
      },
    }, { highWaterMark: 0 }),
    { headers: { "content-type": "application/json" } },
  );
  assertEquals(
    await read({ fetchImpl: () => Promise.resolve(supplied) }),
    "ab",
  );
});

Deno.test("external JSON snapshots its target, limits and validator before awaiting transport", async () => {
  const pending = deferred<Response>();
  const input = {
    url: URL,
    maximumBytes: 1024,
    timeoutMs: 1000,
    validate: identity,
    fetchImpl: () => pending.promise,
  };
  const running = fetchBoundedExternalJson(input);
  input.url = "https://other.example.test/";
  input.maximumBytes = 1;
  input.validate = () => "replacement";
  pending.resolve(response('{"original":true}'));
  assertEquals(await running, { original: true });
});

for (
  const [name, body] of [
    ["invalid surrogate escape", '"\\ud800"'],
    ["nonfinite JSON number", "1e999"],
    ["excessive nesting", "[".repeat(34) + "0" + "]".repeat(34)],
    [
      "excessive collection",
      JSON.stringify(Array.from({ length: 5001 }, () => 0)),
    ],
  ] as const
) {
  Deno.test(`external JSON rejects ${name} before publication`, async () => {
    let validated = false;
    const error = await assertRejects(() =>
      read({
        maximumBytes: 16_384,
        fetchImpl: () => Promise.resolve(response(body)),
        validate(value) {
          validated = true;
          return value;
        },
      }), ExternalJsonError);
    assertEquals([error.failure, error.dispatchCertain, validated], [
      "invalid_response",
      true,
      false,
    ]);
  });
}
