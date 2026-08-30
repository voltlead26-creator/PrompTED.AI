import { assertEquals } from "jsr:@std/assert@1";
import {
  bindModelCallContext,
  inheritModelCallContext,
  meterSuccessfulModelCall,
} from "./model-call-context.ts";

class LedgerQuery {
  rows: Record<string, unknown>[] = [];
  insert(row: Record<string, unknown>) {
    this.rows.push(row);
    return Promise.resolve({ error: null });
  }
}

Deno.test("derived signals inherit auth and successful calls are metered", async () => {
  const ledger = new LedgerQuery();
  const admin = { from: () => ledger } as never;
  const parent = new AbortController().signal;
  const child = new AbortController().signal;
  bindModelCallContext(parent, { userId: "user-1", admin });
  inheritModelCallContext(parent, child);

  await meterSuccessfulModelCall(child, {
    task: "document",
    provider: "anthropic",
    inputTokens: 10,
    outputTokens: 20,
  });

  assertEquals(ledger.rows.length, 1);
  assertEquals(ledger.rows[0].event_type, "model_call");
  assertEquals(ledger.rows[0].user_id, "user-1");
});
