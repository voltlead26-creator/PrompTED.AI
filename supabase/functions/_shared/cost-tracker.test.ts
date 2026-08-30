// =====================================================
// cost-tracker idempotency tests (Deno)
// Run: deno test supabase/functions/_shared/cost-tracker.test.ts
// Covers: (1) success charges once, (4) retry with the same
// generationRequestId charges once, (5) distinct IDs charge
// independently. Scenarios (2) model failure and (3) cancellation
// charge zero by control flow: generate-document only calls
// trackDocumentCreated in the stream success path after
// runDocumentPipeline resolves; abort/failure hits the catch path,
// which never charges.
// =====================================================

import { assertEquals } from "jsr:@std/assert@1";
import { trackDocumentCreated } from "./cost-tracker.ts";
import * as costTracker from "./cost-tracker.ts";

interface LedgerRow {
  user_id: string;
  event_type: string;
  generation_request_id?: string | null;
}

/** In-memory stand-in for the usage_ledger with the partial unique
 * index (user_id, generation_request_id, event_type). */
function fakeAdmin() {
  const rows: LedgerRow[] = [];
  const key = (r: LedgerRow) => `${r.user_id}|${r.generation_request_id}|${r.event_type}`;
  const admin = {
    from(_table: string) {
      return {
        insert(row: LedgerRow) {
          rows.push(row);
          return Promise.resolve({ data: null, error: null });
        },
        upsert(row: LedgerRow, _opts: unknown) {
          const duplicate = row.generation_request_id != null &&
            rows.some((existing) =>
              existing.generation_request_id != null && key(existing) === key(row)
            );
          if (!duplicate) rows.push(row);
          return {
            select(_cols: string) {
              return Promise.resolve({ data: duplicate ? [] : [row], error: null });
            },
          };
        },
      };
    },
  };
  // deno-lint-ignore no-explicit-any
  return { admin: admin as any, rows };
}

const base = {
  userId: "user-1",
  task: "document",
  provider: "gateway",
  inputTokens: 0,
  outputTokens: 0,
};

Deno.test("successful generation charges exactly once", async () => {
  const { admin, rows } = fakeAdmin();
  const charged = await trackDocumentCreated(admin, { ...base, generationRequestId: "req-1" });
  assertEquals(charged, true);
  assertEquals(rows.length, 1);
});

Deno.test("retry with the same generationRequestId does not double-charge", async () => {
  const { admin, rows } = fakeAdmin();
  const first = await trackDocumentCreated(admin, { ...base, generationRequestId: "req-1" });
  const retry = await trackDocumentCreated(admin, { ...base, generationRequestId: "req-1" });
  assertEquals(first, true);
  assertEquals(retry, false);
  assertEquals(rows.length, 1);
});

Deno.test("separate generationRequestIds charge independently", async () => {
  const { admin, rows } = fakeAdmin();
  const a = await trackDocumentCreated(admin, { ...base, generationRequestId: "req-1" });
  const b = await trackDocumentCreated(admin, { ...base, generationRequestId: "req-2" });
  assertEquals(a, true);
  assertEquals(b, true);
  assertEquals(rows.length, 2);
});

Deno.test("same generationRequestId for different users charges both", async () => {
  const { admin, rows } = fakeAdmin();
  await trackDocumentCreated(admin, { ...base, generationRequestId: "req-1" });
  await trackDocumentCreated(admin, { ...base, userId: "user-2", generationRequestId: "req-1" });
  assertEquals(rows.length, 2);
});

Deno.test("legacy call without generationRequestId still charges", async () => {
  const { admin, rows } = fakeAdmin();
  const charged = await trackDocumentCreated(admin, { ...base });
  assertEquals(charged, true);
  assertEquals(rows.length, 1);
});

Deno.test("successful model calls create an idempotent non-allowance ledger row", async () => {
  const trackModelCall = (
    costTracker as unknown as {
      trackModelCall?: (
        admin: unknown,
        record: Record<string, unknown>,
      ) => Promise<boolean>;
    }
  ).trackModelCall;
  assertEquals(typeof trackModelCall, "function");

  const { admin, rows } = fakeAdmin();
  const record = {
    ...base,
    task: "clarify",
    provider: "anthropic",
    inputTokens: 120,
    outputTokens: 40,
    generationRequestId: "req-1",
    callKey: "clarify-primary",
  };
  const first = await trackModelCall!(admin, record);
  const retry = await trackModelCall!(admin, record);

  assertEquals(first, true);
  assertEquals(retry, false);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].event_type, "model_call");
  assertEquals(
    rows[0].generation_request_id,
    "req-1:clarify-primary",
  );
});
