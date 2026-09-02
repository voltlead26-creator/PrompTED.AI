import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  ModelCallAccountingError,
  type TerminalModelAttemptRecord,
  trackTerminalModelAttempt,
} from "./cost-tracker.ts";

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

function receipt() {
  return {
    data: {
      usage_ledger_id: "20000000-0000-4000-8000-000000000001",
      model_call_key: "b".repeat(64),
    },
    error: null,
  };
}

Deno.test("one lost accounting acknowledgement receives one exact idempotent RPC retry", async () => {
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
          : receipt(),
      );
    },
    from() {
      readCalls += 1;
      throw new Error(
        "verification read must not run after the retry is acknowledged",
      );
    },
  } as unknown as SupabaseClient;

  await trackTerminalModelAttempt(admin, record);
  assertEquals(rpcCalls, 2);
  assertEquals(readCalls, 0);
});

Deno.test("two lost acknowledgements accept output only after an exact bounded ledger read", async () => {
  let rpcCalls = 0;
  let readCalls = 0;
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
    eq() {
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

  await trackTerminalModelAttempt(admin, record);
  assertEquals(rpcCalls, 2);
  assertEquals(readCalls, 1);
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
  await trackTerminalModelAttempt(admin, checkpointedRecord);
  assertEquals(writeCalls, 2);
  assertEquals(readCalls, 1);
});
