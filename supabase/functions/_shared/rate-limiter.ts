// =====================================================

import { privateResponseHeaders } from "./cors.ts";
// PrompTED — Durable rate limiter
// Atomic per-user/per-operation windows stored in Postgres.
// =====================================================

const DEFAULT_LIMIT = 60;
const DEFAULT_WINDOW_SECONDS = 60;

interface RateLimitStore {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{
    data: boolean | null;
    error: { message?: string } | null;
  }>;
}

export interface RateLimitOptions {
  operation?: string;
  limit?: number;
  windowSeconds?: number;
}

export class RateLimitError extends Error {
  readonly status = 429;
  readonly payload = {
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests. Please wait a moment and try again.",
    },
  };

  constructor() {
    super("RATE_LIMITED");
  }
}

/**
 * Atomically consume one durable request allowance. Enforcement failures are
 * fail-closed so a database outage cannot silently expose unmetered AI calls.
 */
export async function checkRateLimit(
  store: RateLimitStore,
  userId: string,
  options: RateLimitOptions = {},
): Promise<void> {
  const operation = options.operation?.trim() || "edge-function";
  const limit = options.limit ?? DEFAULT_LIMIT;
  const windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const { data, error } = await store.rpc("consume_rate_limit", {
    p_user_id: userId,
    p_operation: operation,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error || data === null) {
    throw new Error("RATE_LIMIT_UNAVAILABLE");
  }
  if (data !== true) throw new RateLimitError();
}

/** Build a ready-to-return 429 response. */
export function rateLimitResponse(): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please wait a moment and try again.",
      },
    }),
    {
      status: 429,
      headers: {
        ...privateResponseHeaders(),
        "Content-Type": "application/json",
      },
    },
  );
}
