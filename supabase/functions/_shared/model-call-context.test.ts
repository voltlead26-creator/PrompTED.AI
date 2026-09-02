import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  bindModelCallContext,
  claimOpenAICapacity,
  claimUserProviderDispatch,
  completeUserProviderDispatch,
  inheritModelCallContext,
  markOpenAICapacityDispatched,
  ModelCallContextError,
  ModelCapacityError,
  prepareLegacyModelAttempt,
  recordLegacyModelAttempt,
  releaseOpenAICapacity,
  setModelCallCheckpointContext,
  setModelCallRequestIdentity,
} from "./model-call-context.ts";

Deno.env.set("PROMPTED_DEPLOYMENT_ENV", "test");

Deno.test("capacity admission and release use one exact retry-safe lease", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let claims = 0;
  const leaseId = "c1000000-0000-4000-8000-000000000001";
  const admin = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "claim_openai_capacity_lease") {
        claims += 1;
        if (claims === 1) {
          return Promise.resolve({ data: null, error: { message: "lost" } });
        }
        return Promise.resolve({
          data: {
            capacity_admitted: true,
            outcome: "idempotent_replay",
            capacity_lease_id: leaseId,
            lease_token: args.p_lease_token,
            environment: "test",
            semantic_route: "deep",
            estimated_tokens: 1200,
            config_revision: 3,
            expires_at: "2026-09-01T01:00:00.000Z",
            retry_after_seconds: 5,
          },
          error: null,
        });
      }
      if (name === "mark_openai_capacity_lease_dispatched") {
        return Promise.resolve({
          data: {
            outcome: "dispatched",
            capacity_lease_id: leaseId,
            dispatched_at: "2026-09-01T00:00:00.000Z",
          },
          error: null,
        });
      }
      return Promise.resolve({
        data: {
          outcome: "released",
          capacity_lease_id: leaseId,
          terminal_outcome: "completed",
        },
        error: null,
      });
    },
  } as never;
  const signal = new AbortController().signal;
  bindModelCallContext(signal, { userId: "user-1", admin });

  const claim = await claimOpenAICapacity(signal, {
    semanticRoute: "deep",
    estimatedTokens: 1200,
    resourceIdentity: "synthetic-capacity-attempt",
  });
  await markOpenAICapacityDispatched(signal, claim);
  await releaseOpenAICapacity(signal, claim, "completed");

  assertEquals(calls.map((call) => call.name), [
    "claim_openai_capacity_lease",
    "claim_openai_capacity_lease",
    "mark_openai_capacity_lease_dispatched",
    "release_openai_capacity_lease",
  ]);
  assertEquals(calls[0].args.p_lease_token, calls[1].args.p_lease_token);
  assertEquals(calls[2].args.p_lease_token, calls[0].args.p_lease_token);
  assertEquals(calls[3].args.p_lease_token, calls[0].args.p_lease_token);
});

Deno.test("capacity denial returns bounded retry state without dispatch authority", async () => {
  const signal = new AbortController().signal;
  bindModelCallContext(signal, {
    userId: "user-1",
    admin: {
      rpc() {
        return Promise.resolve({
          data: {
            capacity_admitted: false,
            outcome: "awaiting_capacity",
            denial_reason: "per_user_active_limit",
            retry_after_seconds: 7,
          },
          error: null,
        });
      },
    } as never,
  });
  const error = await assertRejects(
    () =>
      claimOpenAICapacity(signal, {
        semanticRoute: "deep",
        estimatedTokens: 1200,
        resourceIdentity: "synthetic-capacity-denial",
      }),
    ModelCapacityError,
    "MODEL_CALL_AWAITING_CAPACITY",
  );
  assertEquals(error.retryAfterSeconds, 7);
});

Deno.test("missing capacity configuration is non-retryable activation state", async () => {
  const signal = new AbortController().signal;
  bindModelCallContext(signal, {
    userId: "user-1",
    admin: {
      rpc() {
        return Promise.resolve({
          data: {
            capacity_admitted: false,
            outcome: "configuration_unavailable",
            denial_reason: "configuration_unavailable",
            retryable: false,
          },
          error: null,
        });
      },
    } as never,
  });
  await assertRejects(
    () =>
      claimOpenAICapacity(signal, {
        semanticRoute: "deep",
        estimatedTokens: 1200,
        resourceIdentity: "synthetic-capacity-configuration",
      }),
    ModelCallContextError,
    "MODEL_CALL_CAPACITY_CONFIGURATION_UNAVAILABLE",
  );
});

Deno.test("a request above the measured route ceiling is non-retryable", async () => {
  const signal = new AbortController().signal;
  bindModelCallContext(signal, {
    userId: "user-1",
    admin: {
      rpc() {
        return Promise.resolve({
          data: {
            capacity_admitted: false,
            outcome: "capacity_request_too_large",
            denial_reason: "estimated_tokens_exceed_route_limit",
            retryable: false,
          },
          error: null,
        });
      },
    } as never,
  });
  await assertRejects(
    () =>
      claimOpenAICapacity(signal, {
        semanticRoute: "deep",
        estimatedTokens: 1200,
        resourceIdentity: "synthetic-capacity-too-large",
      }),
    ModelCallContextError,
    "MODEL_CALL_CAPACITY_REQUEST_TOO_LARGE",
  );
});

Deno.test("provider dispatch admission and completion use one exact retry-safe token", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let claimAcknowledgements = 0;
  const admin = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "claim_user_external_egress") {
        claimAcknowledgements += 1;
        if (claimAcknowledgements === 1) {
          return Promise.resolve({
            data: null,
            error: { message: "lost ack" },
          });
        }
        return Promise.resolve({
          data: {
            outcome: "idempotent_replay",
            egress_permitted: true,
            dispatch_token: args.p_dispatch_token,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { outcome: "completed" }, error: null });
    },
  } as never;
  const signal = new AbortController().signal;
  bindModelCallContext(signal, { userId: "user-1", admin });

  const claim = await claimUserProviderDispatch(signal, "captured-attempt-1");
  await completeUserProviderDispatch(signal, claim, "completed");

  assertEquals(calls.map((call) => call.name), [
    "claim_user_external_egress",
    "claim_user_external_egress",
    "complete_user_external_egress",
  ]);
  assertEquals(calls[0].args.p_dispatch_token, calls[1].args.p_dispatch_token);
  assertEquals(calls[2].args.p_dispatch_token, calls[0].args.p_dispatch_token);
  assertEquals(calls[2].args.p_terminal_state, "completed");
});

Deno.test("a durable account deletion fence rejects provider dispatch", async () => {
  const signal = new AbortController().signal;
  bindModelCallContext(signal, {
    userId: "user-1",
    admin: {
      rpc() {
        return Promise.resolve({
          data: null,
          error: { message: "ACCOUNT_DELETION_FENCED" },
        });
      },
    } as never,
  });
  await assertRejects(
    () => claimUserProviderDispatch(signal, "captured-attempt-1"),
    ModelCallContextError,
    "MODEL_CALL_ACCOUNT_DELETION_FENCED",
  );
});

function fakeAdmin() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    admin: {
      rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        return Promise.resolve({
          data: {
            usage_ledger_id: "10000000-0000-4000-8000-000000000001",
            model_call_key: "a".repeat(64),
            idempotent_replay: false,
          },
          error: null,
        });
      },
    } as never,
  };
}

Deno.test("derived signals retain deterministic non-captured attempt identity", async () => {
  const { admin } = fakeAdmin();
  const parent = new AbortController().signal;
  const child = new AbortController().signal;
  bindModelCallContext(parent, { userId: "user-1", admin });
  setModelCallRequestIdentity(parent, "generation-1");
  inheritModelCallContext(parent, child);

  const first = await prepareLegacyModelAttempt(child, {
    logicalStageKey: "document.section:summary",
    requestSha256: "b".repeat(64),
    attemptNumber: 1,
  });
  const replay = await prepareLegacyModelAttempt(child, {
    logicalStageKey: "document.section:summary",
    requestSha256: "b".repeat(64),
    attemptNumber: 1,
  });
  assertEquals(first, replay);
  assertEquals(first.clientRequestId.startsWith("prompted-"), true);
});

Deno.test("terminal attempt persistence forwards exact provider facts", async () => {
  const { admin, calls } = fakeAdmin();
  const signal = new AbortController().signal;
  bindModelCallContext(signal, {
    userId: "user-1",
    admin,
    generationRequestId: "generation-1",
  });
  await recordLegacyModelAttempt(signal, {
    logicalStageKey: "clarify.primary",
    requestSha256: "b".repeat(64),
    providerAttemptId: "response:resp_1",
    attemptNumber: 1,
    attemptStatus: "succeeded",
    providerResponseId: "resp_1",
    providerStatus: "completed",
    errorCode: null,
    inputTokens: 10,
    outputTokens: 20,
    startedAt: "2026-09-01T00:00:00.000Z",
    completedAt: "2026-09-01T00:00:01.000Z",
    model: "gpt-test",
    routingVersion: "routing.test.1",
    semanticRoute: "fast",
    reasoningEffort: "low",
  });
  assertEquals(calls[0].name, "record_legacy_model_call_attempt");
  assertEquals(calls[0].args.p_user_id, "user-1");
  assertEquals(calls[0].args.p_provider_response_id, "resp_1");
  assertEquals(calls[0].args.p_input_tokens, 10);
});

Deno.test("checkpoint opt-in allocates its durable attempt after allowance admission", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const admin = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve({
        data: {
          state: "prepared",
          provider_permitted: true,
          attempt_number: 2,
          attempt_admission_id: "20000000-0000-4000-8000-000000000002",
          execution_claim_token: "10000000-0000-4000-8000-000000000002",
        },
        error: null,
      });
    },
  } as never;
  const signal = new AbortController().signal;
  bindModelCallContext(signal, {
    userId: "user-1",
    admin,
    generationRequestId: "generation-1",
  });
  setModelCallCheckpointContext(signal, {
    scope: "generate-document",
    originReservationId: "10000000-0000-4000-8000-000000000001",
    executionClaimToken: "10000000-0000-4000-8000-000000000002",
  });
  const prepared = await prepareLegacyModelAttempt(signal, {
    logicalStageKey: "generate-document.section:summary:draft",
    requestSha256: "b".repeat(64),
    attemptNumber: 1,
    maxAttempts: 2,
  });
  assertEquals(prepared.attemptNumber, 2);
  assertEquals(
    prepared.durableAdmissionId,
    "20000000-0000-4000-8000-000000000002",
  );
  assertEquals(calls[0].name, "read_legacy_model_call_checkpoint");
  assertEquals(calls[0].args.p_allocate_attempt, true);
  assertEquals(
    calls[0].args.p_origin_reservation_id,
    "10000000-0000-4000-8000-000000000001",
  );
});

Deno.test("generic checkpoints allocate a server claim without an allowance origin", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const admin = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve({
        data: {
          state: "prepared",
          provider_permitted: true,
          attempt_number: 1,
          attempt_admission_id: "20000000-0000-4000-8000-000000000003",
          execution_claim_token: "10000000-0000-4000-8000-000000000003",
        },
        error: null,
      });
    },
  } as never;
  const signal = new AbortController().signal;
  bindModelCallContext(signal, {
    userId: "user-1",
    admin,
    generationRequestId: "generation-1",
    checkpoint: { scope: "clarify" },
  });

  const prepared = await prepareLegacyModelAttempt(signal, {
    logicalStageKey: "clarify.primary",
    requestSha256: "c".repeat(64),
    attemptNumber: 1,
  });

  assertEquals(
    prepared.durableAdmissionId,
    "20000000-0000-4000-8000-000000000003",
  );
  assertEquals(calls[0].args.p_origin_reservation_id, null);
  assertEquals(calls[0].args.p_execution_claim_token, null);
  assertEquals(calls[0].args.p_checkpoint_scope, "clarify");
});

Deno.test("missing context and unstable stage keys fail before dispatch", async () => {
  await assertRejects(
    () =>
      prepareLegacyModelAttempt(undefined, {
        logicalStageKey: "clarify.primary",
        requestSha256: "b".repeat(64),
        attemptNumber: 1,
      }),
    ModelCallContextError,
    "MODEL_CALL_CONTEXT_MISSING",
  );
  const { admin } = fakeAdmin();
  const signal = new AbortController().signal;
  bindModelCallContext(signal, { userId: "user-1", admin });
  await assertRejects(
    () =>
      prepareLegacyModelAttempt(signal, {
        logicalStageKey: "Invalid stage",
        requestSha256: "b".repeat(64),
        attemptNumber: 1,
      }),
    ModelCallContextError,
    "MODEL_CALL_STAGE_INVALID",
  );
});

Deno.test("metering persistence errors propagate fail closed", async () => {
  const signal = new AbortController().signal;
  bindModelCallContext(signal, {
    userId: "user-1",
    admin: {
      rpc() {
        return Promise.resolve({
          data: null,
          error: { message: "database unavailable" },
        });
      },
    } as never,
  });
  await assertRejects(
    () =>
      recordLegacyModelAttempt(signal, {
        logicalStageKey: "clarify.primary",
        requestSha256: "b".repeat(64),
        providerAttemptId: "client:attempt-1",
        attemptNumber: 1,
        attemptStatus: "failed",
        providerResponseId: "",
        providerStatus: "http_429",
        errorCode: "OPENAI_UPSTREAM_ERROR",
        inputTokens: 0,
        outputTokens: 0,
        startedAt: "2026-09-01T00:00:00.000Z",
        completedAt: "2026-09-01T00:00:01.000Z",
        model: "gpt-test",
        routingVersion: "routing.test.1",
        semanticRoute: "fast",
        reasoningEffort: "low",
      }),
  );
});
