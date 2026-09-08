import { strictEqual as assertEquals } from "node:assert";
import { isOpenAICreditExhaustion } from "./openai-credit-exhaustion.ts";

Deno.test("credit exhaustion requires an explicit recognized billing code and HTTP status", async () => {
  for (const code of ["credit_balance_exhausted", "insufficient_quota"]) {
    for (const status of [402, 429]) {
      assertEquals(
        await isOpenAICreditExhaustion(
          Response.json({ error: { code } }, { status }),
        ),
        true,
      );
    }
    for (const status of [200, 401, 403, 408, 500, 503]) {
      assertEquals(
        await isOpenAICreditExhaustion(
          Response.json({ error: { code } }, { status }),
        ),
        false,
      );
    }
  }
  for (
    const error of [
      { code: "rate_limit_exceeded" },
      { code: "slow_down" },
      { code: "invalid_api_key" },
      { code: "unknown" },
      { message: "credit_balance_exhausted" },
      { code: ["insufficient_quota"] },
      null,
    ]
  ) {
    assertEquals(
      await isOpenAICreditExhaustion(Response.json({ error }, { status: 429 })),
      false,
    );
  }
});

Deno.test("malformed, oversized, and interrupted error bodies cannot authorize fallback", async () => {
  for (
    const body of [
      "not JSON",
      "null",
      "[]",
      JSON.stringify({
        error: { code: "insufficient_quota", message: "x".repeat(16_384) },
      }),
    ]
  ) {
    assertEquals(
      await isOpenAICreditExhaustion(new Response(body, { status: 429 })),
      false,
    );
  }
  assertEquals(
    await isOpenAICreditExhaustion(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("disconnected"));
          },
        }),
        { status: 429 },
      ),
    ),
    false,
  );
});
