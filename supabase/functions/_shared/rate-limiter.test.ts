import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { checkRateLimit, RateLimitError } from "./rate-limiter.ts";

function store(result: { data: boolean | null; error: { message: string } | null }) {
  return {
    calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
    async rpc(name: string, args: Record<string, unknown>) {
      this.calls.push({ name, args });
      return result;
    },
  };
}

Deno.test("durable rate limiter scopes the atomic bucket by user and operation", async () => {
  const client = store({ data: true, error: null });
  await checkRateLimit(client, "11111111-1111-4111-8111-111111111111", {
    operation: "generate-document",
    limit: 12,
    windowSeconds: 90,
  });

  assertEquals(client.calls, [{
    name: "consume_rate_limit",
    args: {
      p_user_id: "11111111-1111-4111-8111-111111111111",
      p_operation: "generate-document",
      p_limit: 12,
      p_window_seconds: 90,
    },
  }]);
});

Deno.test("durable rate limiter returns the stable 429 contract", async () => {
  const error = await assertRejects(
    () => checkRateLimit(store({ data: false, error: null }), "user-1"),
    RateLimitError,
  );
  assertEquals(error.status, 429);
  assertEquals(error.payload.error.code, "RATE_LIMITED");
});

Deno.test("durable rate limiter fails closed when enforcement is unavailable", async () => {
  await assertRejects(
    () => checkRateLimit(store({ data: null, error: { message: "database unavailable" } }), "user-1"),
    Error,
    "RATE_LIMIT_UNAVAILABLE",
  );
});
