// Edge tests retain the repository's existing lockfile-pinned JSR imports.
// deno-lint-ignore no-import-prefix
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
// deno-lint-ignore no-import-prefix
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  checkpointReceiptFromReplay,
  type LegacyCheckpointReceiptIdentity,
  ModelCallAccountingError,
  type TerminalModelAttemptRecord,
  trackTerminalModelAttempt,
} from "./cost-tracker.ts";
import {
  legacyAuditSourceSha256,
  legacyAuditTargetSha256,
  legacyAuditTextSha256,
} from "./document-audit-binding.ts";

const record: TerminalModelAttemptRecord = {
  userId: "10000000-0000-4000-8000-000000000001",
  logicalRequestId: "generation-one",
  logicalStageKey: "generate-document.section:summary",
  requestSha256: "a".repeat(64),
  providerAttemptId: "response:resp_one",
  attemptNumber: 1,
  attemptStatus: "succeeded",
  providerResponseId: "resp_one",
  providerStatus: "completed",
  errorCode: null,
  inputTokens: 11,
  outputTokens: 7,
  startedAt: "2026-09-01T00:00:00.000Z",
  completedAt: "2026-09-01T00:00:01.000Z",
  model: "gpt-5.6-sol",
  routingVersion: "routing.test.1",
  semanticRoute: "deep",
  reasoningEffort: "medium",
};

const checkpointedRecord: TerminalModelAttemptRecord = {
  ...record,
  checkpointScope: "generate-document",
  originReservationId: "30000000-0000-4000-8000-000000000001",
  executionClaimToken: "30000000-0000-4000-8000-000000000002",
  resultEnvelope: {
    version: "legacy-provider-result.1",
    text: "finished wording",
    structured: {
      outer: { alpha: 1, beta: 2 },
      entries: [{ left: true, right: false }],
    },
    sources: [],
    route_snapshot: {
      provider: "openai",
      semanticRoute: "deep",
      model: record.model,
      reasoningEffort: "medium",
      routingVersion: record.routingVersion,
      structuredOutputSchemaVersion: "text.compatibility.v1",
      allowedTools: [],
      timeoutMs: 90_000,
      maxAttempts: 2,
      background: false,
      store: false,
      fallback: null,
    },
  },
};

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function receipt(input = record) {
  return {
    data: {
      usage_ledger_id: "20000000-0000-4000-8000-000000000001",
      model_call_key: await sha256(
        `${input.logicalStageKey}|${input.requestSha256}|${input.providerAttemptId}`,
      ),
      idempotent_replay: false,
      result_id: input.resultEnvelope
        ? "40000000-0000-4000-8000-000000000001"
        : null,
      result_response_sha256: input.resultEnvelope ? "c".repeat(64) : null,
      result_idempotent_replay: input.resultEnvelope ? false : null,
    },
    error: null,
  };
}

Deno.test("one lost accounting acknowledgement receives one exact idempotent RPC retry", async () => {
  const acknowledged = await receipt();
  let rpcCalls = 0;
  let readCalls = 0;
  const admin = {
    rpc() {
      rpcCalls += 1;
      return Promise.resolve(
        rpcCalls === 1
          ? {
            data: null,
            error: { code: "PGRST000", message: "connection lost" },
          }
          : acknowledged,
      );
    },
    from() {
      readCalls += 1;
      throw new Error(
        "verification read must not run after the retry is acknowledged",
      );
    },
  } as unknown as SupabaseClient;

  const result: unknown = await trackTerminalModelAttempt(admin, record);
  assertEquals(rpcCalls, 2);
  assertEquals(readCalls, 0);
  assertEquals(result, await expectedReceipt(record));
});

Deno.test("two lost acknowledgements accept output only after an exact bounded ledger read", async () => {
  let rpcCalls = 0;
  let readCalls = 0;
  const filters: Array<[string, unknown]> = [];
  const modelCallKey = await sha256(
    `${record.logicalStageKey}|${record.requestSha256}|${record.providerAttemptId}`,
  );
  const exactRow = {
    id: "20000000-0000-4000-8000-000000000001",
    event_type: "model_call",
    generation_request_id: `legacy-model-call:${modelCallKey}`,
    task: record.logicalStageKey,
    provider: "openai",
    input_tokens: record.inputTokens,
    output_tokens: record.outputTokens,
    model_call_key: modelCallKey,
    logical_request_id: record.logicalRequestId,
    logical_stage_key: record.logicalStageKey,
    provider_request_sha256: record.requestSha256,
    provider_attempt_id: record.providerAttemptId,
    provider_response_id: record.providerResponseId,
    provider_status: record.providerStatus,
    provider_error_code: record.errorCode,
    model_call_status: record.attemptStatus,
    provider_attempt_number: record.attemptNumber,
    provider_started_at: record.startedAt,
    provider_completed_at: record.completedAt,
    model: record.model,
    routing_version: record.routingVersion,
    semantic_route: record.semanticRoute,
    reasoning_effort: record.reasoningEffort,
  };
  const query = {
    select() {
      return this;
    },
    eq(name: string, value: unknown) {
      filters.push([name, value]);
      return this;
    },
    limit() {
      return this;
    },
    maybeSingle() {
      readCalls += 1;
      return Promise.resolve({ data: exactRow, error: null });
    },
  };
  const admin = {
    rpc() {
      rpcCalls += 1;
      return Promise.reject(new TypeError("response acknowledgement lost"));
    },
    from(name: string) {
      assertEquals(name, "usage_ledger");
      return query;
    },
  } as unknown as SupabaseClient;

  const result: unknown = await trackTerminalModelAttempt(admin, record);
  assertEquals(rpcCalls, 2);
  assertEquals(readCalls, 1);
  assertEquals(filters, [["user_id", record.userId], ["model_call_key", modelCallKey]]);
  assertEquals(result, await expectedReceipt(record));
});

Deno.test("two lost acknowledgements without an exact durable row fail closed", async () => {
  let rpcCalls = 0;
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    limit() {
      return this;
    },
    maybeSingle() {
      return Promise.resolve({ data: null, error: null });
    },
  };
  const admin = {
    rpc() {
      rpcCalls += 1;
      return Promise.resolve({
        data: null,
        error: { code: "08006", message: "connection failure" },
      });
    },
    from() {
      return query;
    },
  } as unknown as SupabaseClient;

  const error = await assertRejects(
    () => trackTerminalModelAttempt(admin, record),
    ModelCallAccountingError,
    "MODEL_CALL_ATTEMPT_ACK_UNRESOLVED",
  );
  assertEquals(error.code, "MODEL_CALL_ATTEMPT_ACK_UNRESOLVED");
  assertEquals(rpcCalls, 2);
});

Deno.test("two lost checkpoint acknowledgements accept output only when usage and result facts both match", async () => {
  let writeCalls = 0;
  let readCalls = 0;
  const admin = {
    rpc(name: string) {
      if (name === "record_legacy_model_call_attempt") {
        writeCalls += 1;
        return Promise.reject(new TypeError("response acknowledgement lost"));
      }
      readCalls += 1;
      return Promise.resolve({
        data: {
          state: "replay",
          provider_permitted: false,
          attempt_number: checkpointedRecord.attemptNumber,
          response_sha256: "c".repeat(64),
          response_envelope: {
            route_snapshot: {
              fallback: null,
              store: false,
              background: false,
              maxAttempts: 2,
              timeoutMs: 90_000,
              allowedTools: [],
              structuredOutputSchemaVersion: "text.compatibility.v1",
              routingVersion: record.routingVersion,
              reasoningEffort: "medium",
              model: record.model,
              semanticRoute: "deep",
              provider: "openai",
            },
            sources: [],
            structured: {
              entries: [{ right: false, left: true }],
              outer: { beta: 2, alpha: 1 },
            },
            text: "finished wording",
            version: "legacy-provider-result.1",
          },
          usage: {
            usage_ledger_id: "20000000-0000-4000-8000-000000000001",
            provider: "openai",
            provider_attempt_id: checkpointedRecord.providerAttemptId,
            provider_response_id: checkpointedRecord.providerResponseId,
            provider_status: checkpointedRecord.providerStatus,
            attempt_status: checkpointedRecord.attemptStatus,
            error_code: checkpointedRecord.errorCode,
            input_tokens: checkpointedRecord.inputTokens,
            output_tokens: checkpointedRecord.outputTokens,
            started_at: checkpointedRecord.startedAt,
            completed_at: checkpointedRecord.completedAt,
            model: checkpointedRecord.model,
            routing_version: checkpointedRecord.routingVersion,
            semantic_route: checkpointedRecord.semanticRoute,
            reasoning_effort: checkpointedRecord.reasoningEffort,
          },
        },
        error: null,
      });
    },
  } as unknown as SupabaseClient;
  const result: unknown = await trackTerminalModelAttempt(admin, checkpointedRecord);
  assertEquals(writeCalls, 2);
  assertEquals(readCalls, 1);
  assertEquals(result, await expectedReceipt(checkpointedRecord));
});

async function expectedReceipt(input: TerminalModelAttemptRecord) {
  const common = {
    version: "terminal-model-attempt-receipt.1",
    userId: input.userId,
    logicalRequestId: input.logicalRequestId ?? null,
    checkpointScope: input.checkpointScope ?? null,
    authorityReservationId: input.originReservationId ?? null,
    logicalStageKey: input.logicalStageKey,
    requestSha256: input.requestSha256,
    providerAttemptId: input.providerAttemptId,
    attemptNumber: input.attemptNumber,
    provider: input.provider ?? "openai",
    attemptStatus: input.attemptStatus,
    providerStatus: input.providerStatus,
    providerResponseId: input.providerResponseId,
    errorCode: input.errorCode,
    usageLedgerId: "20000000-0000-4000-8000-000000000001",
    modelCallKey: await sha256(
      `${input.logicalStageKey}|${input.requestSha256}|${input.providerAttemptId}`,
    ),
  };
  return input.resultEnvelope
    ? { ...common, kind: "checkpoint", resultResponseSha256: "c".repeat(64) }
    : { ...common, kind: "usage_only" };
}

function replay(input = checkpointedRecord) {
  return {
    state: "replay" as const,
    provider_permitted: false,
    attempt_number: input.attemptNumber,
    response_sha256: "c".repeat(64),
    response_envelope: structuredClone(input.resultEnvelope),
    usage: {
      usage_ledger_id: "20000000-0000-4000-8000-000000000001",
      provider: input.provider ?? "openai",
      provider_attempt_id: input.providerAttemptId,
      provider_response_id: input.providerResponseId,
      provider_status: input.providerStatus,
      attempt_status: input.attemptStatus,
      error_code: input.errorCode,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      started_at: input.startedAt,
      completed_at: input.completedAt,
      model: input.model,
      routing_version: input.routingVersion,
      semantic_route: input.semanticRoute,
      reasoning_effort: input.reasoningEffort,
    },
  };
}

function missingRowQuery() {
  return {
    select() { return this; },
    eq() { return this; },
    limit() { return this; },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
  };
}

Deno.test("fresh usage-only and checkpoint acknowledgements expose distinct exact durable receipts", async () => {
  for (const input of [record, checkpointedRecord]) {
    const acknowledged = await receipt(input);
    let writes = 0;
    const admin = {
      rpc() {
        writes += 1;
        return Promise.resolve(acknowledged);
      },
    } as unknown as SupabaseClient;
    const result: unknown = await trackTerminalModelAttempt(admin, input);
    assertEquals(writes, 1);
    assertEquals(result, await expectedReceipt(input));
  }
});

Deno.test("a shape-valid acknowledgement for another model-call key cannot establish persistence", async () => {
  const acknowledged = await receipt();
  acknowledged.data.model_call_key = "b".repeat(64);
  let writes = 0;
  let reads = 0;
  const admin = {
    rpc() { writes += 1; return Promise.resolve(acknowledged); },
    from() { reads += 1; return missingRowQuery(); },
  } as unknown as SupabaseClient;
  await assertRejects(
    () => trackTerminalModelAttempt(admin, record),
    ModelCallAccountingError,
    "MODEL_CALL_ATTEMPT_ACK_UNRESOLVED",
  );
  assertEquals(writes, 2);
  assertEquals(reads, 1);
});

Deno.test("an acknowledgement with a non-UUID usage identity cannot become a receipt", async () => {
  const acknowledged = await receipt();
  acknowledged.data.usage_ledger_id = "not-a-database-uuid";
  const admin = {
    rpc() { return Promise.resolve(acknowledged); },
    from() { return missingRowQuery(); },
  } as unknown as SupabaseClient;
  await assertRejects(
    () => trackTerminalModelAttempt(admin, record),
    ModelCallAccountingError,
    "MODEL_CALL_ATTEMPT_ACK_UNRESOLVED",
  );
});

Deno.test("a checkpoint acknowledgement requires an actual result UUID before exposing its digest", async () => {
  const acknowledged = await receipt(checkpointedRecord);
  acknowledged.data.result_id = "not-a-database-uuid";
  const admin = {
    rpc(name: string) {
      return Promise.resolve(name.startsWith("record_")
        ? acknowledged
        : { data: { state: "not_found", provider_permitted: false }, error: null });
    },
  } as unknown as SupabaseClient;
  await assertRejects(
    () => trackTerminalModelAttempt(admin, checkpointedRecord),
    ModelCallAccountingError,
    "MODEL_CALL_ATTEMPT_ACK_UNRESOLVED",
  );
});

Deno.test("lost-ACK checkpoint readback cannot coerce token counts or an absent error into exact facts", async () => {
  for (const field of ["input_tokens", "output_tokens", "error_code"]) {
    const checkpoint = replay();
    if (field === "error_code") Reflect.deleteProperty(checkpoint.usage, field);
    else Reflect.set(checkpoint.usage, field, String(Reflect.get(checkpoint.usage, field)));
    let writes = 0;
    let reads = 0;
    const admin = {
      rpc(name: string) {
        if (name.startsWith("record_")) {
          writes += 1;
          return Promise.reject(new TypeError("response acknowledgement lost"));
        }
        reads += 1;
        return Promise.resolve({ data: checkpoint, error: null });
      },
    } as unknown as SupabaseClient;
    await assertRejects(
      () => trackTerminalModelAttempt(admin, checkpointedRecord),
      ModelCallAccountingError,
      "MODEL_CALL_ATTEMPT_ACK_UNRESOLVED",
    );
    assertEquals(writes, 2);
    assertEquals(reads, 1);
  }
});

Deno.test("lost-ACK checkpoint readback requires a durable usage UUID and opaque response digest", async () => {
  for (const missing of ["usage_ledger_id", "response_sha256"]) {
    const checkpoint = replay();
    if (missing === "usage_ledger_id") Reflect.deleteProperty(checkpoint.usage, missing);
    else Reflect.deleteProperty(checkpoint, missing);
    const admin = {
      rpc(name: string) {
        return name.startsWith("record_")
          ? Promise.reject(new TypeError("response acknowledgement lost"))
          : Promise.resolve({ data: checkpoint, error: null });
      },
    } as unknown as SupabaseClient;
    await assertRejects(
      () => trackTerminalModelAttempt(admin, checkpointedRecord),
      ModelCallAccountingError,
      "MODEL_CALL_ATTEMPT_ACK_UNRESOLVED",
    );
  }
});

Deno.test("terminal recording snapshots nested result wording before the first acknowledgement wait", async () => {
  const candidate = structuredClone(checkpointedRecord);
  const accepted = structuredClone(candidate);
  const acknowledged = await receipt(accepted);
  let release!: () => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  let sentEnvelope: unknown;
  const admin = {
    async rpc(_name: string, args: Record<string, unknown>) {
      sentEnvelope = args.p_result_envelope;
      entered();
      await held;
      return acknowledged;
    },
  } as unknown as SupabaseClient;
  const pending = trackTerminalModelAttempt(admin, candidate);
  await enteredPromise;
  candidate.resultEnvelope!.text = "later caller wording";
  candidate.resultEnvelope!.structured = { changed: true };
  release();
  const result: unknown = await pending;
  assertEquals(sentEnvelope, accepted.resultEnvelope);
  assertEquals(result, await expectedReceipt(accepted));
});

Deno.test("two lost acknowledgements reconcile against the original identity despite caller mutation", async () => {
  const candidate = structuredClone(checkpointedRecord);
  const accepted = structuredClone(candidate);
  const checkpoint = replay(accepted);
  let entered!: () => void;
  let release!: () => void;
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const writeArguments: Record<string, unknown>[] = [];
  let readArguments: Record<string, unknown> | undefined;
  const admin = {
    async rpc(name: string, args: Record<string, unknown>) {
      if (name.startsWith("record_")) {
        writeArguments.push(structuredClone(args));
        if (writeArguments.length === 1) { entered(); await held; }
        throw new TypeError("response acknowledgement lost");
      }
      readArguments = args;
      return { data: checkpoint, error: null };
    },
  } as unknown as SupabaseClient;
  const pending = trackTerminalModelAttempt(admin, candidate);
  await enteredPromise;
  candidate.userId = "10000000-0000-4000-8000-000000000002";
  candidate.logicalRequestId = "later-request";
  candidate.logicalStageKey = "later-stage";
  candidate.checkpointScope = "edit-section";
  candidate.originReservationId = "30000000-0000-4000-8000-000000000099";
  candidate.requestSha256 = "d".repeat(64);
  candidate.providerAttemptId = "client:later-attempt";
  candidate.resultEnvelope!.text = "later caller wording";
  release();
  const result: unknown = await pending;
  assertEquals(writeArguments.length, 2);
  assertEquals(writeArguments[1], writeArguments[0]);
  assertEquals(readArguments?.p_user_id, accepted.userId);
  assertEquals(readArguments?.p_logical_request_id, accepted.logicalRequestId);
  assertEquals(readArguments?.p_logical_stage_key, accepted.logicalStageKey);
  assertEquals(readArguments?.p_checkpoint_scope, accepted.checkpointScope);
  assertEquals(readArguments?.p_origin_reservation_id, accepted.originReservationId);
  assertEquals(readArguments?.p_request_sha256, accepted.requestSha256);
  assertEquals(result, await expectedReceipt(accepted));
});

Deno.test("historical response and client provider-attempt text remains exact in usage-only receipts", async () => {
  for (const providerAttemptId of ["response:resp_one", "client:request-older-1"]) {
    const input = { ...record, providerAttemptId };
    const acknowledged = await receipt(input);
    const admin = { rpc() { return Promise.resolve(acknowledged); } } as unknown as SupabaseClient;
    const result: unknown = await trackTerminalModelAttempt(admin, input);
    assertEquals(result, await expectedReceipt(input));
  }
});

function checkpointIdentity(): LegacyCheckpointReceiptIdentity {
  return {
    userId: checkpointedRecord.userId,
    logicalRequestId: "generation-one",
    checkpointScope: "generate-document",
    authorityReservationId: checkpointedRecord.originReservationId!,
    logicalStageKey: checkpointedRecord.logicalStageKey,
    requestSha256: checkpointedRecord.requestSha256,
  };
}

Deno.test("checkpoint replay yields the same exact receipt as the acknowledged write", async () => {
  const acknowledged = await receipt(checkpointedRecord);
  const admin = { rpc() { return Promise.resolve(acknowledged); } } as unknown as SupabaseClient;
  const written = await trackTerminalModelAttempt(admin, checkpointedRecord);
  const read = await checkpointReceiptFromReplay(replay(), checkpointIdentity());
  assertEquals(read, written);
  assertEquals(Object.isFrozen(read), true);
  assertEquals(read.resultResponseSha256, "c".repeat(64));
  assertEquals("resultEnvelope" in read, false);
  assertEquals("executionClaimToken" in read, false);
});

Deno.test("original OpenAI-only checkpoint projection may omit provider without inventing an attempt identity", async () => {
  const checkpoint = replay();
  Reflect.deleteProperty(checkpoint.usage, "provider");
  const read = await checkpointReceiptFromReplay(checkpoint, checkpointIdentity());
  assertEquals(read, await expectedReceipt(checkpointedRecord));
  assertEquals(read.providerAttemptId, "response:resp_one");
});

Deno.test("a later authorised reservation can read the same saved checkpoint without relabelling its origin", async () => {
  const oldAuthority = checkpointIdentity();
  const newAuthority = {
    ...oldAuthority,
    authorityReservationId: "30000000-0000-4000-8000-000000000099",
  };
  const first = await checkpointReceiptFromReplay(replay(), oldAuthority);
  const later = await checkpointReceiptFromReplay(replay(), newAuthority);
  assertEquals(later, { ...first, authorityReservationId: newAuthority.authorityReservationId });
  assertEquals(later.usageLedgerId, first.usageLedgerId);
  assertEquals(later.resultResponseSha256, first.resultResponseSha256);
  assertEquals("originReservationId" in later, false);
});

Deno.test("checkpoint evidence retains failed completed attempts and rejects non-checkpoint terminal states", async () => {
  const failed = {
    ...checkpointedRecord,
    attemptStatus: "failed" as const,
    errorCode: "OPENAI_STRUCTURED_OUTPUT_INVALID",
  };
  const saved = await checkpointReceiptFromReplay(replay(failed), checkpointIdentity());
  assertEquals(saved.attemptStatus, "failed");
  assertEquals(saved.errorCode, failed.errorCode);
  for (const state of ["not_found", "terminal_cancelled", "completed_result_unavailable"] as const) {
    await assertRejects(
      () => checkpointReceiptFromReplay({ ...replay(), state }, checkpointIdentity()),
      ModelCallAccountingError,
      "MODEL_CALL_CHECKPOINT_MALFORMED",
    );
  }
});

Deno.test("checkpoint receipt rejects malformed identities, numeric coercion, missing null and malformed digests", async (test) => {
  const cases: Array<[string, (checkpoint: ReturnType<typeof replay>) => void]> = [
    ["usage identity is a SQL UUID", (value) => { value.usage.usage_ledger_id = "not-a-uuid"; }],
    ["digest is opaque lowercase SHA256", (value) => { value.response_sha256 = "invalid"; }],
    ["attempt number must be a number", (value) => { Reflect.set(value, "attempt_number", "1"); }],
    ["token count must be a number", (value) => { Reflect.set(value.usage, "input_tokens", "11"); }],
    ["token count must be finite", (value) => { value.usage.output_tokens = Infinity; }],
    ["token count must be integral", (value) => { value.usage.input_tokens = 1.5; }],
    ["successful error code must explicitly be null", (value) => { Reflect.deleteProperty(value.usage, "error_code"); }],
    ["explicit null provider is not historical omission", (value) => { Reflect.set(value.usage, "provider", null); }],
    ["response identity must be a string", (value) => { Reflect.set(value.usage, "provider_response_id", { id: "resp_one" }); }],
    ["provider dispatch is not permitted by replay", (value) => { value.provider_permitted = true; }],
    ["result envelope is required", (value) => { Reflect.deleteProperty(value, "response_envelope"); }],
    ["cancelled status cannot be a retained completed result", (value) => { value.usage.provider_status = "cancelled"; }],
  ];
  for (const [name, mutate] of cases) {
    await test.step(name, async () => {
      const checkpoint = replay();
      mutate(checkpoint);
      await assertRejects(
        () => checkpointReceiptFromReplay(checkpoint, checkpointIdentity()),
        ModelCallAccountingError,
        "MODEL_CALL_CHECKPOINT_MALFORMED",
      );
    });
  }
  for (const patch of [
    { userId: "not-an-auth-uuid" },
    { authorityReservationId: "not-a-reservation-uuid" },
    { authorityReservationId: null },
    { requestSha256: "invalid" },
    { logicalStageKey: "Invalid stage" },
  ]) {
    await assertRejects(
      () => checkpointReceiptFromReplay(replay(), { ...checkpointIdentity(), ...patch }),
      ModelCallAccountingError,
      "MODEL_CALL_CHECKPOINT_MALFORMED",
    );
  }
});

Deno.test("checkpoint factory snapshots read response and authority before its asynchronous key digest", async () => {
  const checkpoint = replay();
  const expected = checkpointIdentity();
  const pending = checkpointReceiptFromReplay(checkpoint, expected);
  checkpoint.usage.provider_attempt_id = "client:later-attempt";
  checkpoint.usage.usage_ledger_id = "20000000-0000-4000-8000-000000000099";
  checkpoint.response_sha256 = "e".repeat(64);
  Reflect.set(expected, "authorityReservationId", "30000000-0000-4000-8000-000000000099");
  const accepted = await pending;
  assertEquals(accepted, await expectedReceipt(checkpointedRecord));
});

Deno.test("malformed terminal facts cannot be turned into a truthful receipt by a permissive ACK", async () => {
  for (const value of [NaN, Infinity, 1.25, "11"]) {
    const candidate = structuredClone(record);
    Reflect.set(candidate, "inputTokens", value);
    let writes = 0;
    const acknowledged = await receipt();
    const admin = {
      rpc() { writes += 1; return Promise.resolve(acknowledged); },
    } as unknown as SupabaseClient;
    await assertRejects(
      () => trackTerminalModelAttempt(admin, candidate),
      ModelCallAccountingError,
      "MODEL_CALL_ATTEMPT_PERSISTENCE_FAILED",
    );
    assertEquals(writes, 0);
  }
});

Deno.test("checkpoint receipt requires usage model and route facts to match the saved envelope", async (test) => {
  for (const [field, other] of [
    ["model", "another-model"],
    ["routing_version", "routing.other"],
    ["semantic_route", "fast"],
    ["reasoning_effort", "high"],
  ] as const) {
    await test.step(`rejects mismatched ${field}`, async () => {
      const checkpoint = replay();
      Reflect.set(checkpoint.usage, field, other);
      await assertRejects(
        () => checkpointReceiptFromReplay(checkpoint, checkpointIdentity()),
        ModelCallAccountingError,
        "MODEL_CALL_CHECKPOINT_MALFORMED",
      );
    });
  }
});

Deno.test("Ollama checkpoint receipt uses the pinned fallback model and retains the accepted primary route", async () => {
  const input = structuredClone(checkpointedRecord);
  input.provider = "ollama";
  input.allowCreditFallback = true;
  input.attemptNumber = 2;
  input.providerAttemptId = "50000000-0000-4000-8000-000000000002";
  input.providerResponseId = `ollama:${input.providerAttemptId}`;
  input.model = "gpt-oss:20b";
  input.resultEnvelope!.route_snapshot = {
    ...input.resultEnvelope!.route_snapshot,
    creditFallback: {
      provider: "ollama",
      model: input.model,
      modelDigest: "d".repeat(64),
      configurationVersion: "ollama.receipt.test.1",
    },
  };
  const checkpoint = replay(input);
  const accepted = await checkpointReceiptFromReplay(checkpoint, checkpointIdentity());
  assertEquals(accepted, await expectedReceipt(input));
  assertEquals(checkpoint.response_envelope!.route_snapshot.model, record.model);
  assertEquals(checkpoint.usage.model, input.model);
});

async function boundAuditRecord() {
  const sources: [string, string, string, string, string] = ["I was charged $10 twice.", "", "", "", ""];
  const sections = [{ key: "opening", label: "Opening", content: sources[0] }];
  const contentSha256 = await legacyAuditTextSha256(sources[0]);
  const binding = {
    version: "legacy-document-audit-binding.1" as const, digest_version: "legacy-document-audit-digests.1" as const,
    validator_version: "legacy-wording-assessment.1" as const, unit_policy_version: "legacy-factual-units.2" as const,
    review_kind: "quality" as const, round: 0,
    output_schema_name: "prompted_document_quality_audit" as const, output_schema_version: "document-quality-audit.1" as const,
    evidence_mode: "verbatim" as const, source_sha256: await legacyAuditSourceSha256(sources),
    execution_policy_version: "legacy-template-policy.1" as const, execution_policy_sha256: "b".repeat(64),
    target_sha256: await legacyAuditTargetSha256(sections),
    sections: [{ key: "opening", label: "Opening", content_sha256: contentSha256 }],
    units: [{ id: "opening#1", section_key: "opening", content_sha256: contentSha256 }],
  };
  const admissionId = "50000000-0000-4000-8000-000000000001";
  const base = structuredClone(checkpointedRecord);
  base.resultEnvelope = {
    ...base.resultEnvelope!, text: '{"decision":"approve","issues":[]}',
    structured: { decision: "approve", issues: [] },
    route_snapshot: { ...base.resultEnvelope!.route_snapshot, structuredOutputSchemaVersion: "document-quality-audit.1" },
  };
  return {
    ...base,
    logicalStageKey: "generate-document.quality:round-0",
    providerAttemptId: admissionId,
    legacyAuditBinding: binding,
    legacyAuditSources: sources,
    legacyAuditAdmission: { admissionId, bindingSha256: "d".repeat(64) },
  };
}

Deno.test("bound audit terminal ACK qualifies only its prepared admission without another RPC", async () => {
  const input = await boundAuditRecord();
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const acknowledged = await receipt(input);
  const admin = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args: structuredClone(args) });
      return Promise.resolve(acknowledged);
    },
  } as unknown as SupabaseClient;
  const result = await trackTerminalModelAttempt(admin, input);
  assertEquals<unknown>(result, {
    ...await expectedReceipt(input), legacyAuditBindingSha256: input.legacyAuditAdmission.bindingSha256,
  });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "record_legacy_model_call_attempt");
  assertEquals(calls[0].args.p_provider_attempt_id, input.legacyAuditAdmission.admissionId);
  assertEquals(Object.hasOwn(calls[0].args, "p_audit_binding"), false);
  assertEquals(Object.hasOwn(result, "legacyAuditSources"), false);
});

Deno.test("wrong audit admission cannot qualify an ACK while actual terminal accounting remains recorded", async () => {
  const input = await boundAuditRecord();
  input.legacyAuditAdmission.admissionId = "50000000-0000-4000-8000-000000000099";
  const acknowledged = await receipt(input);
  const calls: Array<Record<string, unknown>> = [];
  const admin = {
    rpc(_name: string, args: Record<string, unknown>) {
      calls.push(structuredClone(args));
      return Promise.resolve(acknowledged);
    },
  } as unknown as SupabaseClient;
  await assertRejects(() => trackTerminalModelAttempt(admin, input), ModelCallAccountingError,
    "MODEL_CALL_AUDIT_CHECKPOINT_CONFLICT");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].p_provider_attempt_id, input.providerAttemptId);
  assertEquals(calls[0].p_attempt_status, "succeeded");
});

for (const mismatch of [false, true]) {
  Deno.test("bound audit lost-ACK readback verifies stored binding with mismatch=" + mismatch, async () => {
    const input = await boundAuditRecord();
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const savedBinding = structuredClone(input.legacyAuditBinding);
    if (mismatch) savedBinding.execution_policy_sha256 = "e".repeat(64);
    const admin = {
      rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args: structuredClone(args) });
        if (name === "record_legacy_model_call_attempt") {
          return Promise.reject(new TypeError("synthetic lost terminal ACK"));
        }
        const checkpoint = replay(input);
        return Promise.resolve({ data: name === "read_legacy_document_audit_checkpoint_v1"
          ? { contract_version: "legacy-document-audit-checkpoint.1", checkpoint,
            audit_binding: savedBinding, audit_binding_sha256: input.legacyAuditAdmission.bindingSha256 }
          : checkpoint,
        error: null });
      },
    } as unknown as SupabaseClient;
    if (mismatch) {
      await assertRejects(() => trackTerminalModelAttempt(admin, input), ModelCallAccountingError,
        "MODEL_CALL_ATTEMPT_ACK_UNRESOLVED");
    } else {
      const result = await trackTerminalModelAttempt(admin, input);
      assertEquals<unknown>(result, {
        ...await expectedReceipt(input), legacyAuditBindingSha256: input.legacyAuditAdmission.bindingSha256,
      });
    }
    assertEquals(calls.map((call) => call.name), [
      "record_legacy_model_call_attempt", "record_legacy_model_call_attempt",
      "read_legacy_document_audit_checkpoint_v1",
    ]);
    assertEquals(calls[2].args.p_allocate_attempt, false);
    assertEquals(calls[2].args.p_audit_binding, input.legacyAuditBinding);
    assertEquals(calls[2].args.p_source_snapshot, input.legacyAuditSources);
  });
}

Deno.test("bound audit terminal snapshot cannot change while its exact acknowledgement is pending", async () => {
  const input = await boundAuditRecord();
  const accepted = structuredClone(input);
  const acknowledged = await receipt(input);
  let entered!: () => void;
  let release!: () => void;
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const admin = {
    async rpc() { entered(); await held; return acknowledged; },
  } as unknown as SupabaseClient;
  const pending = trackTerminalModelAttempt(admin, input);
  await enteredPromise;
  input.legacyAuditAdmission.admissionId = "50000000-0000-4000-8000-000000000099";
  input.legacyAuditAdmission.bindingSha256 = "e".repeat(64);
  input.legacyAuditBinding.source_sha256 = "f".repeat(64);
  input.legacyAuditSources[0] = "Changed after accounting began.";
  release();
  assertEquals<unknown>(await pending, {
    ...await expectedReceipt(accepted), legacyAuditBindingSha256: accepted.legacyAuditAdmission.bindingSha256,
  });
});
