import { assertEquals } from "jsr:@std/assert@1";
import {
  bindModelCallContext,
  setModelCallRequestIdentity,
} from "../_shared/model-call-context.ts";
import {
  type EdgeBackgroundRuntime,
  scheduleEdgeBackgroundTask,
  scheduleEdgeBackgroundTaskWithModelContext,
} from "./background.ts";

Deno.test("background scheduling fails closed when EdgeRuntime is unavailable", async () => {
  let calls = 0;
  const scheduled = scheduleEdgeBackgroundTask(async () => {
    calls += 1;
  }, null);

  await Promise.resolve();
  assertEquals(scheduled, false);
  assertEquals(calls, 0);
});

Deno.test("background scheduling registers and completes the exact task", async () => {
  let registered: Promise<unknown> | null = null;
  let calls = 0;
  const runtime: EdgeBackgroundRuntime = {
    waitUntil(promise) {
      registered = promise;
    },
  };

  const scheduled = scheduleEdgeBackgroundTask(async () => {
    calls += 1;
  }, runtime);

  assertEquals(scheduled, true);
  assertEquals(calls, 0);
  await registered;
  assertEquals(calls, 1);
});

Deno.test("background scheduling does not start untracked work when registration throws", async () => {
  let calls = 0;
  const runtime: EdgeBackgroundRuntime = {
    waitUntil() {
      throw new Error("runtime rejected background registration");
    },
  };

  const scheduled = scheduleEdgeBackgroundTask(async () => {
    calls += 1;
  }, runtime);

  await Promise.resolve();
  assertEquals(scheduled, false);
  assertEquals(calls, 0);
});

Deno.test("background scheduling inherits auth context onto a request-independent signal", async () => {
  let registered: Promise<unknown> | null = null;
  let reusedParentSignal = true;
  let backgroundWasAborted = true;
  const parent = new AbortController();
  bindModelCallContext(parent.signal, {
    userId: "10000000-0000-4000-8000-000000000001",
    admin: {} as never,
  });
  const runtime: EdgeBackgroundRuntime = {
    waitUntil(promise) {
      registered = promise;
    },
  };

  const scheduled = scheduleEdgeBackgroundTaskWithModelContext(
    parent.signal,
    async (signal) => {
      reusedParentSignal = signal === parent.signal;
      backgroundWasAborted = signal.aborted;
      setModelCallRequestIdentity(signal, "captured-background-operation");
    },
    runtime,
  );
  parent.abort("foreground response completed");

  assertEquals(scheduled, true);
  await registered;
  assertEquals(reusedParentSignal, false);
  assertEquals(backgroundWasAborted, false);
});
