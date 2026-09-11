// Edge tests retain the repository's existing lockfile-pinned JSR imports.
// deno-lint-ignore no-import-prefix
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { resolveOpenAIRoute } from "./provider-router.ts";
import { ModelCallAccountingError } from "./cost-tracker.ts";
import {
  legacyAuditSourceSha256,
  legacyAuditTargetSha256,
  legacyAuditTextSha256,
} from "./document-audit-binding.ts";
import {
  bindModelCallContext,
  claimOpenAICapacity,
  claimUserProviderDispatch,
  completeUserProviderDispatch,
  inheritModelCallContext,
  markOpenAICapacityDispatched,
  markLegacyModelAttemptDispatched,
  ModelCallContextError,
  ModelCapacityError,
  prepareLegacyModelAttempt,
  recordLegacyModelAttempt,
  releaseOpenAICapacity,
  setModelCallCheckpointContext,
  setModelCallRequestIdentity,
} from "./model-call-context.ts";

Deno.env.set("PROMPTED_DEPLOYMENT_ENV", "test");

async function contextAuditInput() {
  const sources: [string, string, string, string, string] = ["I was charged $10 twice.", "", "", "", ""];
  const contentSha256 = await legacyAuditTextSha256(sources[0]);
  return {
    logicalStageKey: "generate-document.quality:round-0", requestSha256: "b".repeat(64),
    attemptNumber: 1, maxAttempts: 2,
    legacyAuditSources: sources,
    legacyAuditBinding: {
      version: "legacy-document-audit-binding.1" as const, digest_version: "legacy-document-audit-digests.1" as const,
      validator_version: "legacy-wording-assessment.1" as const, unit_policy_version: "legacy-factual-units.2" as const,
      review_kind: "quality" as const, round: 0,
      output_schema_name: "prompted_document_quality_audit" as const, output_schema_version: "document-quality-audit.1" as const,
      evidence_mode: "verbatim" as const, source_sha256: await legacyAuditSourceSha256(sources),
      execution_policy_version: "legacy-template-policy.1" as const, execution_policy_sha256: "b".repeat(64),
      target_sha256: await legacyAuditTargetSha256([{ key: "opening", label: "Opening", content: sources[0] }]),
      sections: [{ key: "opening", label: "Opening", content_sha256: contentSha256 }],
      units: [{ id: "opening#1", section_key: "opening", content_sha256: contentSha256 }],
    },
  };
}

for (const mismatch of [false, true]) {
  Deno.test("audit preparation keeps its owned source/binding and requires matching durable proof with mismatch=" + mismatch, async () => {
    const input = await contextAuditInput();
    const accepted = structuredClone(input);
    const admissionId = "20000000-0000-4000-8000-000000000002";
    const claimToken = "10000000-0000-4000-8000-000000000002";
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const admin = {
      rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args: structuredClone(args) });
        input.legacyAuditSources[0] = "Changed after checkpoint read began.";
        input.legacyAuditBinding.sections[0].label = "Changed caller label";
        const checkpoint = {
          state: "prepared", provider_permitted: true, attempt_number: 1,
          attempt_admission_id: admissionId, execution_claim_token: claimToken,
        };
        const binding = structuredClone(accepted.legacyAuditBinding);
        if (mismatch) binding.sections[0].label = "Different stored section";
        return Promise.resolve({ data: name === "read_legacy_document_audit_checkpoint_v1"
          ? { contract_version: "legacy-document-audit-checkpoint.1", checkpoint,
            audit_binding: binding, audit_binding_sha256: "d".repeat(64) }
          : checkpoint,
        error: null });
      },
    } as never;
    const signal = new AbortController().signal;
    bindModelCallContext(signal, {
      userId: "11111111-1111-4111-8111-111111111111", admin,
      generationRequestId: "context-audit-binding-request",
      checkpoint: {
        scope: "generate-document", originReservationId: "30000000-0000-4000-8000-000000000001",
        executionClaimToken: claimToken,
      },
    });
    if (mismatch) {
      await assertRejects(() => prepareLegacyModelAttempt(signal, input), ModelCallAccountingError,
        "MODEL_CALL_AUDIT_CHECKPOINT_CONFLICT");
    } else {
      const prepared = await prepareLegacyModelAttempt(signal, input);
      assertEquals(prepared.durableAdmissionId, admissionId);
      assertEquals(Reflect.get(prepared, "legacyAuditBindingSha256"), "d".repeat(64));
    }
    assertEquals(calls.length, 1);
    assertEquals(calls[0].name, "read_legacy_document_audit_checkpoint_v1");
    assertEquals(calls[0].args.p_audit_binding, accepted.legacyAuditBinding);
    assertEquals(calls[0].args.p_source_snapshot, accepted.legacyAuditSources);
    assertEquals(calls[0].args.p_allocate_attempt, true);
    assertEquals(calls[0].args.p_with_fallback, false);
  });
}

for (const checkpointEnabled of [false, true]) {
  Deno.test("terminal context returns discriminated durable receipt with checkpoint=" + checkpointEnabled, async () => {
    const userId = "22222222-2222-4222-8222-222222222222";
    const originReservationId = "33333333-3333-4333-8333-333333333333";
    const usageLedgerId = "44444444-4444-4444-8444-444444444444";
    const executionClaimToken = "55555555-5555-4555-8555-555555555555";
    const logicalRequestId = "context-receipt-request";
    const logicalStageKey = "generate-document.audit:wording";
    const requestSha256 = "b".repeat(64);
    // provider_attempt_id is SQL TEXT, not a UUID-only field.
    const providerAttemptId = "response:resp_context_receipt";
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(
      logicalStageKey + "|" + requestSha256 + "|" + providerAttemptId,
    ));
    const modelCallKey = Array.from(new Uint8Array(bytes))
      .map((value) => value.toString(16).padStart(2, "0")).join("");
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const admin = {
      rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        return Promise.resolve({ data: {
          usage_ledger_id: usageLedgerId, model_call_key: modelCallKey,
          idempotent_replay: false,
          result_id: args.p_result_envelope ? "66666666-6666-4666-8666-666666666666" : null,
          result_response_sha256: args.p_result_envelope ? "c".repeat(64) : null,
          result_idempotent_replay: args.p_result_envelope ? false : null,
        }, error: null });
      },
    } as never;
    const signal = new AbortController().signal;
    bindModelCallContext(signal, {
      userId, admin, generationRequestId: logicalRequestId,
      ...(checkpointEnabled ? { checkpoint: {
        scope: "generate-document", originReservationId, executionClaimToken,
      } } : {}),
    });
    const resultEnvelope = {
      version: "legacy-provider-result.1" as const,
      text: '{"decision":"approve"}', structured: { decision: "approve" },
      sources: [], route_snapshot: resolveOpenAIRoute("review"),
    };
    const receipt: unknown = await recordLegacyModelAttempt(signal, {
      logicalStageKey, requestSha256, providerAttemptId, attemptNumber: 1,
      attemptStatus: "succeeded", providerResponseId: "resp_context_receipt",
      providerStatus: "completed", errorCode: null, inputTokens: 7, outputTokens: 4,
      startedAt: "2026-09-01T00:00:00.000Z",
      completedAt: "2026-09-01T00:00:01.000Z",
      model: resultEnvelope.route_snapshot.model,
      routingVersion: resultEnvelope.route_snapshot.routingVersion,
      semanticRoute: resultEnvelope.route_snapshot.semanticRoute,
      reasoningEffort: resultEnvelope.route_snapshot.reasoningEffort,
      resultEnvelope,
    });
    assertEquals(calls.length, 1);
    assertEquals(calls[0].name, "record_legacy_model_call_attempt");
    assertEquals(calls[0].args.p_result_envelope, checkpointEnabled ? resultEnvelope : null);
    assertEquals(receipt, {
      version: "terminal-model-attempt-receipt.1",
      kind: checkpointEnabled ? "checkpoint" : "usage_only",
      userId, logicalRequestId,
      checkpointScope: checkpointEnabled ? "generate-document" : null,
      authorityReservationId: checkpointEnabled ? originReservationId : null,
      logicalStageKey, requestSha256, providerAttemptId, attemptNumber: 1,
      provider: "openai", attemptStatus: "succeeded", providerStatus: "completed",
      providerResponseId: "resp_context_receipt", errorCode: null,
      usageLedgerId, modelCallKey,
      ...(checkpointEnabled ? { resultResponseSha256: "c".repeat(64) } : {}),
    });
  });
}

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

Deno.test("a captured cumulative budget denial stops dispatch without acknowledgement retries", async () => {
  const signal = new AbortController().signal;
  let calls = 0;
  bindModelCallContext(signal, {
    userId: "user-1",
    admin: { rpc() {
      calls += 1;
      return Promise.resolve({ data: null, error: {
        code: "PGB01", message: "GENERATION_ATTEMPT_LIMIT_REACHED",
      } });
    } } as never,
  });
  await assertRejects(() => claimUserProviderDispatch(signal, "captured-attempt-1"),
    ModelCallContextError, "GENERATION_ATTEMPT_LIMIT_REACHED");
  assertEquals(calls, 1);
});

Deno.test("an inexact captured budget marker remains an unresolved dispatch acknowledgement", async () => {
  const signal = new AbortController().signal;
  let calls = 0;
  bindModelCallContext(signal, {
    userId: "user-1",
    admin: { rpc() {
      calls += 1;
      return Promise.resolve({ data: null, error: {
        code: "P0001", message: "GENERATION_ATTEMPT_LIMIT_REACHED",
      } });
    } } as never,
  });
  await assertRejects(() => claimUserProviderDispatch(signal, "captured-attempt-1"),
    ModelCallContextError, "MODEL_CALL_PROVIDER_DISPATCH_ACK_UNRESOLVED");
  assertEquals(calls, 2);
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
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(
          String(args.p_logical_stage_key) + "|" + String(args.p_request_sha256) + "|" +
            String(args.p_provider_attempt_id),
        ));
        const modelCallKey = Array.from(new Uint8Array(bytes))
          .map((value) => value.toString(16).padStart(2, "0")).join("");
        return Promise.resolve({
          data: {
            usage_ledger_id: "10000000-0000-4000-8000-000000000001",
            model_call_key: modelCallKey,
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

for (const [databaseCode, databaseMessage, expected, calls] of [
  ["PGB01", "GENERATION_ATTEMPT_LIMIT_REACHED", "GENERATION_ATTEMPT_LIMIT_REACHED", 1],
  ["PGB02", "GENERATION_REPAIR_LIMIT_REACHED", "GENERATION_REPAIR_LIMIT_REACHED", 1],
  ["PGB02", "different error", "MODEL_CALL_DISPATCH_ACK_UNRESOLVED", 2],
  ["P0001", "GENERATION_REPAIR_LIMIT_REACHED", "MODEL_CALL_DISPATCH_ACK_UNRESOLVED", 2],
  ["PGB01", "different error", "MODEL_CALL_DISPATCH_ACK_UNRESOLVED", 2],
  ["P0001", "GENERATION_ATTEMPT_LIMIT_REACHED", "MODEL_CALL_DISPATCH_ACK_UNRESOLVED", 2],
] as const) {
  Deno.test(`dispatch budget denial is exact and permanent: ${databaseCode}/${databaseMessage}`, async () => {
    let count = 0;
    const admin = { rpc(name: string) {
      assertEquals(name, "mark_legacy_model_attempt_dispatched"); count += 1;
      return Promise.resolve({ data: null, error: { code: databaseCode, message: databaseMessage } });
    } } as never;
    const signal = new AbortController().signal;
    bindModelCallContext(signal, { userId: "94120000-0000-4000-8000-000000000001", admin,
      generationRequestId: "budget-context", checkpoint: { scope: "generate-document",
        originReservationId: "94120000-0000-4000-8000-000000000002",
        executionClaimToken: "94120000-0000-4000-8000-000000000003" } });
    const error = await assertRejects(() => markLegacyModelAttemptDispatched(signal, {
      logicalStageKey: "generate-document.primary", requestSha256: "a".repeat(64), attemptNumber: 1,
      durableAdmissionId: "94120000-0000-4000-8000-000000000004" }), ModelCallContextError);
    assertEquals(error.code, expected); assertEquals(count, calls);
  });
}
