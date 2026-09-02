import { inheritModelCallContext } from "../_shared/model-call-context.ts";

export interface EdgeBackgroundRuntime {
  waitUntil(promise: Promise<unknown>): void;
}

function currentRuntime(): EdgeBackgroundRuntime | null {
  const runtime = (globalThis as typeof globalThis & {
    EdgeRuntime?: EdgeBackgroundRuntime;
  }).EdgeRuntime;
  return runtime && typeof runtime.waitUntil === "function" ? runtime : null;
}

/**
 * Registers work with the Supabase Edge Runtime before starting it.
 * Returning false is fail-closed: the accepted operation remains resumable,
 * but the handler must not claim that execution was scheduled.
 */
export function scheduleEdgeBackgroundTask(
  task: () => Promise<void>,
  runtime: EdgeBackgroundRuntime | null = currentRuntime(),
): boolean {
  if (!runtime) return false;
  let registered = false;
  const pending = Promise.resolve().then(() => {
    if (!registered) return;
    return task();
  });
  try {
    runtime.waitUntil(pending);
    registered = true;
    return true;
  } catch {
    // Some local or future runtimes may expose a waitUntil-shaped function
    // while refusing registration. Do not start untracked provider work in
    // that case; the already accepted operation remains safe to resume.
    return false;
  }
}

/**
 * Give background work its own lifetime while preserving the authenticated,
 * server-only model-call context bound by the request guard. The request
 * signal must not be reused: it can be aborted as soon as the 202 response is
 * returned even though EdgeRuntime.waitUntil continues the durable operation.
 */
export function scheduleEdgeBackgroundTaskWithModelContext(
  parentSignal: AbortSignal,
  task: (signal: AbortSignal) => Promise<void>,
  runtime: EdgeBackgroundRuntime | null = currentRuntime(),
): boolean {
  const controller = new AbortController();
  inheritModelCallContext(parentSignal, controller.signal);
  return scheduleEdgeBackgroundTask(
    () => task(controller.signal),
    runtime,
  );
}
