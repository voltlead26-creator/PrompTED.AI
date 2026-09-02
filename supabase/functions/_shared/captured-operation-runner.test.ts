import { assertEquals } from "jsr:@std/assert@1";
import { CAPTURED_DOCUMENT_LEDGER } from "../../../packages/shared/src/document-ledger.ts";
import {
  type CapturedOperationGateway,
  type CapturedProvider,
  runCapturedDocumentOperation,
} from "./captured-operation-runner.ts";
import type {
  ProviderAttempt,
  ProviderRequest,
  ProviderResponse,
} from "./provider-router.ts";
import { OpenAIAdapterError } from "./provider-router.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OUTCOME_ID = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_ID = "33333333-3333-4333-8333-333333333333";

function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `word${index + 1}`).join(
    " ",
  );
}

function acceptedRouteSnapshot() {
  const route = (
    semanticRoute: "deep" | "review",
    model: string,
    reasoningEffort: "medium" | "high",
  ) => ({
    provider: "openai" as const,
    semanticRoute,
    model,
    reasoningEffort,
    routingVersion: "routing.test.1",
    structuredOutputSchemaVersion: "complaint-letter.captured-output.1",
    allowedTools: [] as const,
    timeoutMs: 90_000,
    maxAttempts: 2 as const,
    background: false,
    store: false as const,
    fallback: null,
  });
  return {
    provider: "openai",
    routingVersion: "routing.test.1",
    routes: {
      deep: route("deep", "gpt-accepted-deep", "medium"),
      review: route("review", "gpt-accepted-review", "high"),
    },
  };
}

function acceptedResumePayload(
  inputValues: Record<string, unknown> = {
    recipient_name: "Synthetic Energy Co",
    issue_facts: "A synthetic invoice was charged twice.",
    desired_outcome: "Reverse the duplicate charge.",
  },
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const template = CAPTURED_DOCUMENT_LEDGER.templates["complaint-letter"];
  const inputKeys = Object.keys(inputValues);
  const unresolved = template.requiredInputs
    .filter((input) => !(input.key in inputValues))
    .map((input) => input.key)
    .sort();
  const blocked = template.sections
    .filter((section) =>
      section.dependsOnInputs.some((key) => unresolved.includes(key))
    )
    .map((section) => section.sectionKey)
    .sort();
  const safe = template.sections
    .map((section) => section.sectionKey)
    .filter((key) => !blocked.includes(key))
    .sort();
  const sources = inputKeys.map((key) => ({
    id: `input:${key}`,
    input_key: key,
    source_type: "confirmed_request_input",
    value: inputValues[key],
  }));
  return {
    action: "resume",
    contract_version: "captured-document-operation.v1",
    operation_id: "44444444-4444-4444-8444-444444444444",
    accepted_user_id: USER_ID,
    accepted_environment: "local",
    accepted_user_cohort: "pilot",
    workflow: "master-workspace",
    outcome_id: OUTCOME_ID,
    document_id: DOCUMENT_ID,
    accepted_document_revision: 1,
    title: "Synthetic complaint",
    template_id: "complaint-letter",
    generation_request_id: "synthetic-operation-1",
    generation_snapshot_id: "88888888-8888-4888-8888-888888888888",
    generation_snapshot_request_id: `captured:${"a".repeat(64)}`,
    generation_snapshot_sha256: "b".repeat(64),
    request_sha256: "c".repeat(64),
    input_revision: 1,
    input_values: inputValues,
    source_snapshot: { sources },
    evidence_snapshot: {
      permitted_source_ids: sources.map((source) => source.id),
      material_claims_require_source_reference: true,
    },
    unresolved_input_keys: unresolved,
    confirmations: Object.fromEntries(
      inputKeys.map((key) => [
        key,
        { confirmed: true, source_id: `input:${key}` },
      ]),
    ),
    safe_section_keys: safe,
    blocked_section_keys: blocked,
    locale: "en-AU",
    jurisdiction: "AU",
    activation_scope_key: "local:pilot:master-workspace:complaint-letter",
    activation_revision: 1,
    ledger_schema_version: CAPTURED_DOCUMENT_LEDGER.schemaVersion,
    ledger_version: CAPTURED_DOCUMENT_LEDGER.ledgerVersion,
    ledger_contract_sha256: "d".repeat(64),
    ledger_template: structuredClone(template),
    benchmark_version: template.qualityBenchmark.benchmarkVersion,
    pipeline_version: "captured-operation-pipeline.1",
    routing_version: "routing.test.1",
    route_snapshot: acceptedRouteSnapshot(),
    operation_ttl_seconds: 86_400,
    ...overrides,
  };
}

async function completeProviderAttempt(
  request: ProviderRequest,
  responseId: string,
  structured: Record<string, unknown>,
): Promise<ProviderAttempt> {
  if (!request.attemptLifecycle || !request.routeSnapshot) {
    throw new Error("captured provider lifecycle missing");
  }
  const startedAt = "2026-08-31T00:00:00.000Z";
  const prepared = await request.attemptLifecycle.prepare({
    localAttemptNumber: 1,
    startedAt,
    requestSha256: "a".repeat(64),
    routeSnapshot: request.routeSnapshot,
  });
  const attempt: ProviderAttempt = {
    attemptNumber: prepared.attemptNumber,
    startedAt,
    completedAt: "2026-08-31T00:00:01.000Z",
    status: "succeeded",
    responseId,
    inputTokens: 100,
    outputTokens: 200,
    errorCode: null,
  };
  await request.attemptLifecycle.complete({
    attempt,
    requestSha256: "a".repeat(64),
    routeSnapshot: request.routeSnapshot,
    structuredOutput: structured,
  });
  return attempt;
}

function successfulProvider(
  responseId: string,
  structured: Record<string, unknown>,
): CapturedProvider {
  return async (request): Promise<ProviderResponse> => {
    const attempt = await completeProviderAttempt(
      request,
      responseId,
      structured,
    );
    return {
      text: "structured",
      structured,
      inputTokens: 100,
      outputTokens: 200,
      _provider: "openai",
      responseId,
      status: "completed",
      routeSnapshot: request.routeSnapshot!,
      attempts: [attempt],
      sources: [],
    };
  };
}

async function failCompletedProviderAttempt(
  request: ProviderRequest,
  localAttemptNumber: number,
): Promise<ProviderAttempt> {
  if (!request.attemptLifecycle || !request.routeSnapshot) {
    throw new Error("captured provider lifecycle missing");
  }
  const startedAt = `2026-08-31T00:00:0${localAttemptNumber}.000Z`;
  const prepared = await request.attemptLifecycle.prepare({
    localAttemptNumber,
    startedAt,
    requestSha256: "a".repeat(64),
    routeSnapshot: request.routeSnapshot,
  });
  const attempt: ProviderAttempt = {
    attemptNumber: prepared.attemptNumber,
    startedAt,
    completedAt: `2026-08-31T00:00:1${localAttemptNumber}.000Z`,
    status: "failed",
    responseId: "",
    inputTokens: 0,
    outputTokens: 0,
    errorCode: "OPENAI_UPSTREAM_ERROR",
  };
  await request.attemptLifecycle.complete({
    attempt,
    requestSha256: "a".repeat(64),
    routeSnapshot: request.routeSnapshot,
    structuredOutput: null,
  });
  return attempt;
}

function gateway(options?: {
  activationDisabled?: boolean;
  rolloutNotAssigned?: boolean;
  replay?: boolean;
  replayAfterFirst?: boolean;
  replayStatus?: string;
  generationCheckpoint?: Record<string, unknown>;
  reviewCheckpoint?: Record<string, unknown>;
  nextAttemptNumber?: number;
  routeSnapshot?: unknown;
  resumePayload?: Record<string, unknown>;
  preparedReconciliationRequiredOnce?: boolean;
  completionAcknowledgementsLost?: number;
  capacityResumeDeferred?: boolean;
}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const attemptNumbers: number[] = [];
  let revision = 1;
  let status = options?.replayStatus ?? "accepted";
  let nextAttemptNumber = options?.nextAttemptNumber ?? 1;
  let acceptCalls = 0;
  let preparedAttempt = false;
  let cancellationRequested = false;
  let cancellationCode: string | null = null;
  let cancellationAfterNextRenewal = false;
  let preparedReconciliationRequired =
    options?.preparedReconciliationRequiredOnce ?? false;
  let completionAcknowledgementsLost =
    options?.completionAcknowledgementsLost ?? 0;
  let generationCheckpoint = options?.generationCheckpoint ?? null;
  let reviewCheckpoint = options?.reviewCheckpoint ?? null;
  const completedAttemptKeys = new Set<string>();
  let lastAcceptance: Record<string, unknown> | null = null;
  const leaseToken = "66666666-6666-4666-8666-666666666666";
  const value = (extra: Record<string, unknown> = {}) => ({
    operation_id: "44444444-4444-4444-8444-444444444444",
    document_id: DOCUMENT_ID,
    operation_revision: revision,
    accepted_document_revision: 1,
    status,
    correlation_id: "55555555-5555-4555-8555-555555555555",
    routing_version: "routing.test.1",
    route_snapshot: options?.routeSnapshot ?? acceptedRouteSnapshot(),
    generation_checkpoint: generationCheckpoint,
    review_checkpoint: reviewCheckpoint,
    cancellation_requested: cancellationRequested,
    cancellation_code: cancellationCode,
    ...(status === "awaiting_capacity"
      ? {
        capacity_semantic_route: generationCheckpoint ? "review" : "deep",
        capacity_wait_started_at: "2026-09-01T00:00:00.000Z",
        capacity_retry_after_at: "2099-01-01T00:00:00.000Z",
        retry_after_seconds: 30,
        resume_available: !options?.capacityResumeDeferred,
      }
      : {}),
    ...extra,
  });

  const payload = () => {
    if (options?.resumePayload) return options.resumePayload;
    const inputs = lastAcceptance?.p_input_values as
      | Record<string, unknown>
      | undefined;
    return acceptedResumePayload(inputs, {
      outcome_id: lastAcceptance?.p_outcome_id ?? OUTCOME_ID,
      document_id: lastAcceptance?.p_document_id ?? DOCUMENT_ID,
      title: lastAcceptance?.p_title ?? "Synthetic complaint",
      accepted_environment: lastAcceptance?.p_environment ?? "local",
      accepted_user_cohort: lastAcceptance?.p_user_cohort ?? "pilot",
      workflow: lastAcceptance?.p_workflow ?? "master-workspace",
      template_id: lastAcceptance?.p_template_id ?? "complaint-letter",
      benchmark_version: lastAcceptance?.p_benchmark_version ??
        CAPTURED_DOCUMENT_LEDGER.templates["complaint-letter"]
          .qualityBenchmark.benchmarkVersion,
      pipeline_version: lastAcceptance?.p_pipeline_version ??
        "captured-operation-pipeline.1",
      generation_request_id: lastAcceptance?.p_idempotency_key ??
        "synthetic-operation-1",
      input_revision: lastAcceptance?.p_input_revision ?? 1,
      locale: lastAcceptance?.p_locale ?? "en-AU",
      jurisdiction: lastAcceptance?.p_jurisdiction ?? "AU",
      safe_section_keys: lastAcceptance?.p_safe_section_keys ??
        acceptedResumePayload(inputs).safe_section_keys,
      blocked_section_keys: lastAcceptance?.p_blocked_section_keys ??
        acceptedResumePayload(inputs).blocked_section_keys,
      unresolved_input_keys: lastAcceptance?.p_unresolved_input_keys ??
        acceptedResumePayload(inputs).unresolved_input_keys,
      source_snapshot: lastAcceptance?.p_source_snapshot ??
        acceptedResumePayload(inputs).source_snapshot,
      evidence_snapshot: lastAcceptance?.p_evidence_snapshot ??
        acceptedResumePayload(inputs).evidence_snapshot,
      confirmations: lastAcceptance?.p_confirmations ??
        acceptedResumePayload(inputs).confirmations,
      route_snapshot: options?.routeSnapshot ?? acceptedRouteSnapshot(),
    });
  };

  const adapter: CapturedOperationGateway = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "get_captured_document_resume_payload") {
        return { data: payload(), error: null };
      }
      if (
        name === "accept_captured_document_operation" ||
        name === "accept_assigned_captured_document_operation"
      ) {
        if (
          name === "accept_assigned_captured_document_operation" &&
          options?.rolloutNotAssigned
        ) {
          return {
            data: null,
            error: {
              message:
                "CAPTURED_ROLLOUT_NOT_ASSIGNED:11111111-1111-4111-8111-111111111111:local:master-workspace:complaint-letter",
            },
          };
        }
        if (options?.activationDisabled) {
          return {
            data: null,
            error: { message: "CAPTURED_ACTIVATION_DISABLED:local:pilot" },
          };
        }
        acceptCalls += 1;
        lastAcceptance ??= args;
        const replay = options?.replay ||
          (options?.replayAfterFirst && acceptCalls > 1);
        return {
          data: value({ idempotent_replay: replay ?? false }),
          error: null,
        };
      }
      if (name === "claim_captured_document_operation") {
        revision += 1;
        return {
          data: value({ lease_token: leaseToken }),
          error: null,
        };
      }
      if (name === "resume_captured_document_operation_from_capacity") {
        if (options?.capacityResumeDeferred) {
          return {
            data: value({
              lease_token: null,
              capacity_resume_deferred: true,
              retry_after_seconds: 30,
              resume_available: false,
              retryable: true,
            }),
            error: null,
          };
        }
        revision += 1;
        status = generationCheckpoint ? "validating" : "generating";
        return {
          data: value({
            lease_token: leaseToken,
            capacity_resume_deferred: false,
            resumed_from_capacity_wait: true,
            capacity_semantic_route: null,
            capacity_wait_started_at: null,
            capacity_retry_after_at: null,
            retry_after_seconds: null,
            resume_available: false,
          }),
          error: null,
        };
      }
      if (name === "renew_captured_document_operation_lease") {
        revision += 1;
        const renewed = value({ lease_token: leaseToken });
        if (cancellationAfterNextRenewal) {
          cancellationAfterNextRenewal = false;
          revision += 1;
          cancellationRequested = true;
          cancellationCode = "owner_cancelled";
        }
        return {
          data: renewed,
          error: null,
        };
      }
      if (name === "advance_captured_document_operation") {
        revision += 1;
        status = String(args.p_next_status);
        return {
          data: value({ retryable: status === "retryable_failure" }),
          error: null,
        };
      }
      if (name === "defer_captured_document_operation_for_capacity") {
        revision += 1;
        status = "awaiting_capacity";
        return {
          data: value({
            lease_token: null,
            retryable: true,
            capacity_semantic_route: args.p_semantic_route,
            capacity_retry_after_at: "2099-01-01T00:00:00.000Z",
            retry_after_seconds: args.p_retry_after_seconds,
          }),
          error: null,
        };
      }
      if (name === "record_captured_document_provider_attempt") {
        revision += 1;
        const prepared = args.p_status === "prepared";
        if (prepared && preparedReconciliationRequired) {
          preparedReconciliationRequired = false;
          preparedAttempt = true;
          return {
            data: null,
            error: {
              message: "CAPTURED_PROVIDER_ATTEMPT_RECONCILIATION_REQUIRED",
            },
          };
        }
        const attemptNumber = prepared
          ? nextAttemptNumber++
          : Number(args.p_attempt_number);
        if (prepared) {
          attemptNumbers.push(attemptNumber);
          preparedAttempt = true;
        } else {
          preparedAttempt = false;
        }
        return {
          data: {
            attempt_id: crypto.randomUUID(),
            operation_id: value().operation_id,
            operation_revision: revision,
            provider_attempt_number: attemptNumber,
            provider_client_request_id: crypto.randomUUID(),
            idempotent_replay: false,
          },
          error: null,
        };
      }
      if (name === "complete_captured_document_provider_attempt") {
        const attemptKey = `${String(args.p_logical_stage_key)}:${
          String(args.p_attempt_number)
        }`;
        const replay = completedAttemptKeys.has(attemptKey);
        if (!replay) {
          revision += 1;
          completedAttemptKeys.add(attemptKey);
          if (args.p_status === "succeeded") {
            if (args.p_logical_stage_key === "generation") {
              generationCheckpoint = args.p_structured_output as
                | Record<string, unknown>
                | null;
            } else if (args.p_logical_stage_key === "review") {
              reviewCheckpoint = args.p_structured_output as
                | Record<string, unknown>
                | null;
            }
          }
        }
        preparedAttempt = false;
        if (completionAcknowledgementsLost > 0) {
          completionAcknowledgementsLost -= 1;
          return {
            data: null,
            error: { message: "CAPTURED_PROVIDER_COMPLETION_ACK_LOST" },
          };
        }
        return {
          data: value({
            lease_token: leaseToken,
            provider_attempt_number: Number(args.p_attempt_number),
            idempotent_replay: replay,
          }),
          error: null,
        };
      }
      if (name === "reconcile_captured_document_provider_attempt") {
        const reconciled = preparedAttempt;
        if (preparedAttempt) {
          revision += 1;
          preparedAttempt = false;
        }
        return {
          data: value({
            lease_token: leaseToken,
            prepared_attempt_reconciled: reconciled,
          }),
          error: null,
        };
      }
      if (name === "cancel_captured_document_operation") {
        revision += 1;
        status = "cancelled";
        cancellationRequested = true;
        cancellationCode = String(args.p_cancellation_code);
        return {
          data: value({ lease_token: null, retryable: false }),
          error: null,
        };
      }
      if (name === "finalize_captured_document_operation") {
        revision += 1;
        status = "ready_for_review";
        return {
          data: value({
            provider_finalized_revision: 2,
            latest_document_revision: 2,
            allowance_id: "77777777-7777-4777-8777-777777777777",
          }),
          error: null,
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  return {
    adapter,
    calls,
    attemptNumbers,
    requestCancellation(code = "owner_cancelled") {
      revision += 1;
      cancellationRequested = true;
      cancellationCode = code;
    },
    requestCancellationAfterNextRenewal() {
      cancellationAfterNextRenewal = true;
    },
  };
}

function body(inputValues: Record<string, unknown>) {
  return {
    outcome_id: OUTCOME_ID,
    document_id: DOCUMENT_ID,
    title: "Synthetic complaint",
    template_id: "complaint-letter",
    generation_request_id: "synthetic-operation-1",
    input_revision: 1,
    input_values: inputValues,
  };
}

function complaintOutput(): Record<string, unknown> {
  return {
    sections: [
      {
        section_key: "issue",
        content: words(90),
        state: "final",
        source_references: ["input:recipient_name", "input:issue_facts"],
      },
      {
        section_key: "impact",
        content: "",
        state: "omitted_optional",
        source_references: [],
      },
      {
        section_key: "resolution",
        content: words(50),
        state: "final",
        source_references: ["input:desired_outcome"],
      },
      {
        section_key: "close",
        content: "I look forward to your prompt written response.",
        state: "neutral_fallback",
        source_references: ["system:neutral-fallback"],
      },
    ],
  };
}

Deno.test("captured runner persists acceptance and clarification before any provider call", async () => {
  const { adapter, calls } = gateway();
  let providerCalls = 0;
  const result = await runCapturedDocumentOperation({
    userId: USER_ID,
    body: body({
      recipient_name: "Synthetic Energy Co",
      issue_facts: "A synthetic invoice was charged twice.",
    }),
    environment: { environment: "local", userCohort: "pilot" },
    gateway: adapter,
    provider: async () => {
      providerCalls += 1;
      throw new Error("provider must not run");
    },
  });

  assertEquals(result.status, 202);
  assertEquals(result.body.status, "awaiting_clarification");
  assertEquals(providerCalls, 0);
  assertEquals(calls.map((call) => call.name), [
    "accept_assigned_captured_document_operation",
    "get_captured_document_resume_payload",
    "claim_captured_document_operation",
    "advance_captured_document_operation",
  ]);
  assertEquals(
    (result.body.questions as Array<Record<string, unknown>>)[0]?.input_key,
    "desired_outcome",
  );
});

Deno.test("captured runner can stop after durable acceptance for background execution", async () => {
  const { adapter, calls } = gateway();
  let providerCalls = 0;
  const result = await runCapturedDocumentOperation({
    userId: USER_ID,
    body: body({
      recipient_name: "Synthetic Energy Co",
      issue_facts: "A synthetic invoice was charged twice.",
      desired_outcome: "Reverse the duplicate charge.",
    }),
    environment: { environment: "local", userCohort: "pilot" },
    gateway: adapter,
    executionMode: "accept_only",
    provider: async () => {
      providerCalls += 1;
      throw new Error("accept-only mode must not call a provider");
    },
  });

  assertEquals(result.status, 202);
  assertEquals(result.body.status, "accepted");
  assertEquals(result.body.retryable, false);
  assertEquals(result.body.questions, []);
  assertEquals(providerCalls, 0);
  assertEquals(calls.map((call) => call.name), [
    "accept_assigned_captured_document_operation",
    "get_captured_document_resume_payload",
  ]);
  assertEquals("p_user_cohort" in calls[0]!.args, false);
});

Deno.test("captured runner records the provider attempt and atomically finalizes validated output", async () => {
  const { adapter, calls } = gateway();
  const provider = successfulProvider("resp_synthetic", complaintOutput());

  const result = await runCapturedDocumentOperation({
    userId: USER_ID,
    body: body({
      recipient_name: "Synthetic Energy Co",
      issue_facts: "A synthetic invoice was charged twice.",
      desired_outcome: "Reverse the duplicate charge.",
    }),
    environment: { environment: "local", userCohort: "pilot" },
    gateway: adapter,
    provider,
  });

  assertEquals(result.status, 200);
  assertEquals(result.body.status, "ready_for_review");
  assertEquals(calls.map((call) => call.name), [
    "accept_assigned_captured_document_operation",
    "get_captured_document_resume_payload",
    "claim_captured_document_operation",
    "advance_captured_document_operation",
    "renew_captured_document_operation_lease",
    "record_captured_document_provider_attempt",
    "renew_captured_document_operation_lease",
    "complete_captured_document_provider_attempt",
    "renew_captured_document_operation_lease",
    "advance_captured_document_operation",
    "renew_captured_document_operation_lease",
    "advance_captured_document_operation",
    "renew_captured_document_operation_lease",
    "finalize_captured_document_operation",
  ]);
  assertEquals(
    calls.find((call) =>
      call.name === "record_captured_document_provider_attempt" &&
      call.args.p_status === "prepared"
    )?.args.p_attempt_number,
    0,
  );
});

Deno.test("captured runner replays an exact completion after commit acknowledgement loss without duplicate provider work", async () => {
  const controlled = gateway({ completionAcknowledgementsLost: 1 });
  let providerCalls = 0;
  const providerOutput = complaintOutput();
  const result = await runCapturedDocumentOperation({
    userId: USER_ID,
    body: body({
      recipient_name: "Synthetic Energy Co",
      issue_facts: "A synthetic invoice was charged twice.",
      desired_outcome: "Reverse the duplicate charge.",
    }),
    environment: { environment: "local", userCohort: "pilot" },
    gateway: controlled.adapter,
    provider: async (request) => {
      providerCalls += 1;
      return await successfulProvider(
        "resp_ack_loss_synthetic",
        providerOutput,
      )(request);
    },
  });

  assertEquals(result.status, 200);
  assertEquals(result.body.status, "ready_for_review");
  assertEquals(providerCalls, 1);
  const completions = controlled.calls.filter((call) =>
    call.name === "complete_captured_document_provider_attempt"
  );
  assertEquals(completions.length, 2);
  assertEquals(completions[0]?.args, completions[1]?.args);
  assertEquals(
    controlled.calls.filter((call) =>
      call.name === "record_captured_document_provider_attempt" &&
      call.args.p_status === "prepared"
    ).length,
    1,
  );
});

Deno.test("captured runner trusts the exact durable checkpoint when both completion acknowledgements are lost", async () => {
  const controlled = gateway({
    completionAcknowledgementsLost: 2,
    replayAfterFirst: true,
  });
  let providerCalls = 0;
  const providerOutput = complaintOutput();
  const result = await runCapturedDocumentOperation({
    userId: USER_ID,
    body: body({
      recipient_name: "Synthetic Energy Co",
      issue_facts: "A synthetic invoice was charged twice.",
      desired_outcome: "Reverse the duplicate charge.",
    }),
    environment: { environment: "local", userCohort: "pilot" },
    gateway: controlled.adapter,
    provider: async (request) => {
      providerCalls += 1;
      return await successfulProvider(
        "resp_double_ack_loss_synthetic",
        providerOutput,
      )(request);
    },
  });

  assertEquals(result.status, 200);
  assertEquals(result.body.status, "ready_for_review");
  assertEquals(providerCalls, 1);
  assertEquals(
    controlled.calls.filter((call) =>
      call.name === "complete_captured_document_provider_attempt"
    ).length,
    2,
  );
  assertEquals(
    controlled.calls.filter((call) =>
      call.name === "accept_assigned_captured_document_operation" ||
      call.name === "accept_captured_document_operation"
    ).length,
    2,
  );
});

Deno.test("captured runner fails closed for an owner outside the server-resolved rollout", async () => {
  const { adapter, calls } = gateway({ rolloutNotAssigned: true });
  let providerCalls = 0;
  const result = await runCapturedDocumentOperation({
    userId: USER_ID,
    body: body({
      recipient_name: "Synthetic Energy Co",
      issue_facts: "A synthetic invoice was charged twice.",
      desired_outcome: "Reverse the duplicate charge.",
    }),
    environment: { environment: "local", userCohort: "browser-forged" },
    gateway: adapter,
    provider: async () => {
      providerCalls += 1;
      throw new Error("provider must not run");
    },
  });

  assertEquals(result.status, 409);
  assertEquals(
    (result.body.error as Record<string, unknown>).code,
    "CAPTURED_ROLLOUT_NOT_ASSIGNED",
  );
  assertEquals(providerCalls, 0);
  assertEquals(calls.map((call) => call.name), [
    "accept_assigned_captured_document_operation",
  ]);
  assertEquals("p_user_cohort" in calls[0]!.args, false);
});

Deno.test("captured runner exposes a pre-acceptance activation miss without calling a provider", async () => {
  const { adapter } = gateway({ activationDisabled: true });
  let providerCalls = 0;
  const result = await runCapturedDocumentOperation({
    userId: USER_ID,
    body: body({
      recipient_name: "Synthetic Energy Co",
      issue_facts: "A synthetic invoice was charged twice.",
      desired_outcome: "Reverse the duplicate charge.",
    }),
    environment: { environment: "local", userCohort: "pilot" },
    gateway: adapter,
    provider: async () => {
      providerCalls += 1;
      throw new Error("provider must not run");
    },
  });

  assertEquals(result.status, 409);
  assertEquals(
    (result.body.error as Record<string, unknown>).code,
    "CAPTURED_ACTIVATION_DISABLED",
  );
  assertEquals(providerCalls, 0);
});

Deno.test("captured runner rejects an incomplete accepted route before provider work", async () => {
  const { adapter, calls } = gateway({
    routeSnapshot: {
      provider: "openai",
      routingVersion: "routing.test.1",
      routes: {
        deep: {
          provider: "openai",
          model: "gpt-accepted-deep",
          reasoningEffort: "medium",
        },
      },
    },
  });
  let providerCalls = 0;
  const result = await runCapturedDocumentOperation({
    userId: USER_ID,
    body: body({
      recipient_name: "Synthetic Energy Co",
      issue_facts: "A synthetic invoice was charged twice.",
      desired_outcome: "Reverse the duplicate charge.",
    }),
    environment: { environment: "local", userCohort: "pilot" },
    gateway: adapter,
    provider: async () => {
      providerCalls += 1;
      throw new Error("provider must not run");
    },
  });

  assertEquals(result.status, 500);
  assertEquals(
    (result.body.error as Record<string, unknown>).code,
    "CAPTURED_ACCEPTED_ROUTE_INVALID",
  );
  assertEquals(providerCalls, 0);
  assertEquals(calls.map((call) => call.name), [
    "accept_assigned_captured_document_operation",
    "get_captured_document_resume_payload",
  ]);
});

Deno.test("captured runner fails closed on a malformed protected resume snapshot", async () => {
  const { adapter, calls } = gateway({
    replay: true,
    replayStatus: "retryable_failure",
    resumePayload: acceptedResumePayload(undefined, {
      source_snapshot: { sources: [] },
    }),
  });
  let providerCalls = 0;
  const result = await runCapturedDocumentOperation({
    userId: USER_ID,
    body: {
      action: "resume",
      operation_id: "44444444-4444-4444-8444-444444444444",
    },
    environment: { environment: "production", userCohort: "changed" },
    gateway: adapter,
    provider: async () => {
      providerCalls += 1;
      throw new Error("malformed accepted snapshots must not dispatch");
    },
  });

  assertEquals(result.status, 500);
  assertEquals(result.body.retryable, false);
  assertEquals(
    (result.body.error as Record<string, unknown>).code,
    "CAPTURED_ACCEPTED_SOURCE_SNAPSHOT_INVALID",
  );
  assertEquals(providerCalls, 0);
  assertEquals(calls.map((call) => call.name), [
    "get_captured_document_resume_payload",
  ]);
});

Deno.test("captured runner rejects an accepted pipeline without a retained adapter", async () => {
  const { adapter, calls } = gateway({
    replay: true,
    replayStatus: "retryable_failure",
    resumePayload: acceptedResumePayload(undefined, {
      pipeline_version: "captured-operation-pipeline.99",
      operation_ttl_seconds: null,
    }),
  });
  let providerCalls = 0;
  const result = await runCapturedDocumentOperation({
    userId: USER_ID,
    body: {
      action: "resume",
      operation_id: "44444444-4444-4444-8444-444444444444",
    },
    environment: { environment: "local", userCohort: "pilot" },
    gateway: adapter,
    provider: async () => {
      providerCalls += 1;
      throw new Error("unsupported accepted pipelines must not dispatch");
    },
  });

  assertEquals(result.status, 409);
  assertEquals(result.body.retryable, false);
  assertEquals(
    (result.body.error as Record<string, unknown>).code,
    "CAPTURED_PIPELINE_VERSION_UNSUPPORTED",
  );
  assertEquals(providerCalls, 0);
  assertEquals(calls.map((call) => call.name), [
    "get_captured_document_resume_payload",
  ]);
});

Deno.test("captured resume ignores browser and current-activation drift and executes the accepted ledger template", async () => {
  const historicalTemplate = structuredClone(
    CAPTURED_DOCUMENT_LEDGER.templates["complaint-letter"],
  ) as unknown as { displayName: string } & Record<string, unknown>;
  historicalTemplate.displayName = "Accepted historical complaint contract";
  const acceptedPayload = acceptedResumePayload(undefined, {
    ledger_template: historicalTemplate,
    activation_revision: 1,
  });
  const { adapter, calls } = gateway({
    replay: true,
    replayStatus: "retryable_failure",
    resumePayload: acceptedPayload,
  });
  let acceptedPrompt = "";
  const provider = successfulProvider(
    "resp_accepted_snapshot",
    complaintOutput(),
  );
  const result = await runCapturedDocumentOperation({
    userId: USER_ID,
    body: {
      action: "resume",
      operation_id: "44444444-4444-4444-8444-444444444444",
      outcome_id: "browser-injected",
      document_id: "browser-injected",
      title: "Browser-injected title",
      template_id: "incident-near-miss-report",
      generation_request_id: "browser-injected-request",
      input_values: { fabricated: "value" },
    },
    environment: { environment: "production", userCohort: "changed" },
    gateway: adapter,
    provider: async (request) => {
      acceptedPrompt = request.messages[0]?.content ?? "";
      return await provider(request);
    },
  });

  assertEquals(result.status, 200);
  assertEquals(
    JSON.parse(acceptedPrompt).contract.display_name,
    "Accepted historical complaint contract",
  );
  const replay = calls.find((call) =>
    call.name === "accept_captured_document_operation"
  );
  assertEquals(replay?.args.p_environment, "local");
  assertEquals(replay?.args.p_user_cohort, "pilot");
  assertEquals(replay?.args.p_template_id, "complaint-letter");
  assertEquals(replay?.args.p_title, "Synthetic complaint");
  assertEquals(replay?.args.p_input_values, acceptedPayload.input_values);
});

Deno.test("captured runner terminalizes two accepted transient attempts and resume does not prepare attempt three", async () => {
  const { adapter, calls, attemptNumbers } = gateway({
    replayAfterFirst: true,
  });
  let providerCalls = 0;
  const first = await runCapturedDocumentOperation({
    userId: USER_ID,
    body: body({
      recipient_name: "Synthetic Energy Co",
      issue_facts: "A synthetic invoice was charged twice.",
      desired_outcome: "Reverse the duplicate charge.",
    }),
    environment: { environment: "local", userCohort: "pilot" },
    gateway: adapter,
    provider: async (request) => {
      providerCalls += 1;
      const attempts = [
        await failCompletedProviderAttempt(request, 1),
        await failCompletedProviderAttempt(request, 2),
      ];
      const error = new OpenAIAdapterError(
        "OPENAI_UPSTREAM_ERROR",
        429,
        true,
      );
      error.attempts = attempts;
      throw error;
    },
  });

  assertEquals(first.status, 422);
  assertEquals(first.body.status, "terminal_failure");
  assertEquals(first.body.retryable, false);
  assertEquals(attemptNumbers, [1, 2]);

  const second = await runCapturedDocumentOperation({
    userId: USER_ID,
    body: {
      action: "resume",
      operation_id: "44444444-4444-4444-8444-444444444444",
    },
    environment: { environment: "local", userCohort: "pilot" },
    gateway: adapter,
    provider: async () => {
      providerCalls += 1;
      throw new Error("terminal exhausted operations must not redispatch");
    },
  });

  assertEquals(second.status, 409);
  assertEquals(second.body.status, "terminal_failure");
  assertEquals(second.body.retryable, false);
  assertEquals(providerCalls, 1);
  assertEquals(attemptNumbers, [1, 2]);
  assertEquals(
    calls.filter((call) =>
      call.name === "record_captured_document_provider_attempt" &&
      call.args.p_status === "prepared"
    ).length,
    2,
  );
});

Deno.test("captured runner reconciles a prepared attempt left by a crashed worker before terminal failure", async () => {
  const { adapter, calls } = gateway({
    preparedReconciliationRequiredOnce: true,
  });
  const result = await runCapturedDocumentOperation({
    userId: USER_ID,
    body: body({
      recipient_name: "Synthetic Energy Co",
      issue_facts: "A synthetic invoice was charged twice.",
      desired_outcome: "Reverse the duplicate charge.",
    }),
    environment: { environment: "local", userCohort: "pilot" },
    gateway: adapter,
    provider: async (request) => {
      if (!request.attemptLifecycle || !request.routeSnapshot) {
        throw new Error("captured provider lifecycle missing");
      }
      await request.attemptLifecycle.prepare({
        localAttemptNumber: 1,
        startedAt: "2026-09-01T00:00:01.000Z",
        requestSha256: "a".repeat(64),
        routeSnapshot: request.routeSnapshot,
      });
      throw new Error(
        "the stale prepared attempt must block provider dispatch",
      );
    },
  });

  assertEquals(result.status, 422);
  assertEquals(result.body.status, "terminal_failure");
  const reconcileIndex = calls.findIndex((call) =>
    call.name === "reconcile_captured_document_provider_attempt"
  );
  const terminalIndex = calls.findIndex((call) =>
    call.name === "advance_captured_document_operation" &&
    call.args.p_next_status === "terminal_failure"
  );
  assertEquals(reconcileIndex >= 0, true);
  assertEquals(terminalIndex > reconcileIndex, true);
});

Deno.test("owner cancellation during a late successful provider call records the attempt before cancelling and never finalizes wording", async () => {
  const controlled = gateway();
  const providerOutput = complaintOutput();
  const result = await runCapturedDocumentOperation({
    userId: USER_ID,
    body: body({
      recipient_name: "Synthetic Energy Co",
      issue_facts: "A synthetic invoice was charged twice.",
      desired_outcome: "Reverse the duplicate charge.",
    }),
    environment: { environment: "local", userCohort: "pilot" },
    gateway: controlled.adapter,
    provider: async (request) => {
      if (!request.attemptLifecycle || !request.routeSnapshot) {
        throw new Error("captured provider lifecycle missing");
      }
      const startedAt = "2026-08-31T00:00:00.000Z";
      const prepared = await request.attemptLifecycle.prepare({
        localAttemptNumber: 1,
        startedAt,
        requestSha256: "a".repeat(64),
        routeSnapshot: request.routeSnapshot,
      });
      controlled.requestCancellation();
      const attempt: ProviderAttempt = {
        attemptNumber: prepared.attemptNumber,
        startedAt,
        completedAt: "2026-08-31T00:00:01.000Z",
        status: "succeeded",
        responseId: "resp_late_success",
        inputTokens: 17,
        outputTokens: 23,
        errorCode: null,
      };
      await request.attemptLifecycle.complete({
        attempt,
        requestSha256: "a".repeat(64),
        routeSnapshot: request.routeSnapshot,
        structuredOutput: providerOutput,
      });
      return {
        text: "structured",
        structured: providerOutput,
        inputTokens: 17,
        outputTokens: 23,
        _provider: "openai",
        responseId: "resp_late_success",
        status: "completed",
        routeSnapshot: request.routeSnapshot,
        attempts: [attempt],
        sources: [],
      };
    },
  });

  assertEquals(result.status, 409);
  assertEquals(result.body.status, "cancelled");
  assertEquals(result.body.retryable, false);
  const completedAttempt = controlled.calls.findIndex((call) =>
    call.name === "complete_captured_document_provider_attempt" &&
    call.args.p_status === "succeeded"
  );
  const cancelled = controlled.calls.findIndex((call) =>
    call.name === "cancel_captured_document_operation"
  );
  assertEquals(completedAttempt >= 0, true);
  assertEquals(cancelled > completedAttempt, true);
  assertEquals(
    controlled.calls.some((call) =>
      call.name === "finalize_captured_document_operation"
    ),
    false,
  );
});

Deno.test("token-bound completion preserves known tokens when cancellation advances the revision after renewal", async () => {
  const controlled = gateway();
  const providerOutput = complaintOutput();
  const result = await runCapturedDocumentOperation({
    userId: USER_ID,
    body: body({
      recipient_name: "Synthetic Energy Co",
      issue_facts: "A synthetic invoice was charged twice.",
      desired_outcome: "Reverse the duplicate charge.",
    }),
    environment: { environment: "local", userCohort: "pilot" },
    gateway: controlled.adapter,
    provider: async (request) => {
      if (!request.attemptLifecycle || !request.routeSnapshot) {
        throw new Error("captured provider lifecycle missing");
      }
      const startedAt = "2026-08-31T00:00:00.000Z";
      const prepared = await request.attemptLifecycle.prepare({
        localAttemptNumber: 1,
        startedAt,
        requestSha256: "a".repeat(64),
        routeSnapshot: request.routeSnapshot,
      });
      controlled.requestCancellationAfterNextRenewal();
      const attempt: ProviderAttempt = {
        attemptNumber: prepared.attemptNumber,
        startedAt,
        completedAt: "2026-08-31T00:00:01.000Z",
        status: "succeeded",
        responseId: "resp_atomic_late_success",
        inputTokens: 31,
        outputTokens: 47,
        errorCode: null,
      };
      await request.attemptLifecycle.complete({
        attempt,
        requestSha256: "a".repeat(64),
        routeSnapshot: request.routeSnapshot,
        structuredOutput: providerOutput,
      });
      return {
        text: "structured",
        structured: providerOutput,
        inputTokens: 31,
        outputTokens: 47,
        _provider: "openai",
        responseId: "resp_atomic_late_success",
        status: "completed",
        routeSnapshot: request.routeSnapshot,
        attempts: [attempt],
        sources: [],
      };
    },
  });

  assertEquals(result.status, 409);
  assertEquals(result.body.status, "cancelled");
  assertEquals(result.body.retryable, false);
  const completion = controlled.calls.find((call) =>
    call.name === "complete_captured_document_provider_attempt"
  );
  assertEquals(completion?.args.p_input_tokens, 31);
  assertEquals(completion?.args.p_output_tokens, 47);
  assertEquals(completion?.args.p_status, "succeeded");
  assertEquals(
    "p_expected_operation_revision" in (completion?.args ?? {}),
    false,
  );
  const completedAt = controlled.calls.findIndex((call) =>
    call.name === "complete_captured_document_provider_attempt"
  );
  const cancelledAt = controlled.calls.findIndex((call) =>
    call.name === "cancel_captured_document_operation"
  );
  assertEquals(completedAt >= 0, true);
  assertEquals(cancelledAt > completedAt, true);
  assertEquals(
    controlled.calls.some((call) =>
      call.name === "finalize_captured_document_operation"
    ),
    false,
  );
});

Deno.test("owner cancellation during a late provider failure records the failed attempt before cancelling", async () => {
  const controlled = gateway();
  let providerCalls = 0;
  const result = await runCapturedDocumentOperation({
    userId: USER_ID,
    body: body({
      recipient_name: "Synthetic Energy Co",
      issue_facts: "A synthetic invoice was charged twice.",
      desired_outcome: "Reverse the duplicate charge.",
    }),
    environment: { environment: "local", userCohort: "pilot" },
    gateway: controlled.adapter,
    provider: async (request) => {
      providerCalls += 1;
      if (!request.attemptLifecycle || !request.routeSnapshot) {
        throw new Error("captured provider lifecycle missing");
      }
      const startedAt = "2026-08-31T00:00:00.000Z";
      const prepared = await request.attemptLifecycle.prepare({
        localAttemptNumber: 1,
        startedAt,
        requestSha256: "a".repeat(64),
        routeSnapshot: request.routeSnapshot,
      });
      controlled.requestCancellation();
      const attempt: ProviderAttempt = {
        attemptNumber: prepared.attemptNumber,
        startedAt,
        completedAt: "2026-08-31T00:00:01.000Z",
        status: "failed",
        responseId: "",
        inputTokens: 0,
        outputTokens: 0,
        errorCode: "OPENAI_UPSTREAM_ERROR",
      };
      await request.attemptLifecycle.complete({
        attempt,
        requestSha256: "a".repeat(64),
        routeSnapshot: request.routeSnapshot,
        structuredOutput: null,
      });
      const error = new OpenAIAdapterError(
        "OPENAI_UPSTREAM_ERROR",
        429,
        true,
      );
      error.attempts = [attempt];
      throw error;
    },
  });

  assertEquals(result.status, 409);
  assertEquals(result.body.status, "cancelled");
  assertEquals(result.body.retryable, false);
  assertEquals(providerCalls, 1);
  const completedAttempt = controlled.calls.findIndex((call) =>
    call.name === "complete_captured_document_provider_attempt" &&
    call.args.p_status === "failed"
  );
  const cancelled = controlled.calls.findIndex((call) =>
    call.name === "cancel_captured_document_operation"
  );
  assertEquals(completedAttempt >= 0, true);
  assertEquals(cancelled > completedAttempt, true);
});

Deno.test("captured runner resumes the same retryable operation without a second document", async () => {
  const { adapter, calls, attemptNumbers } = gateway({
    replay: true,
    replayStatus: "retryable_failure",
    nextAttemptNumber: 3,
  });
  let providerCalls = 0;
  const provider = successfulProvider(
    "resp_resume_synthetic",
    complaintOutput(),
  );
  const resumeBody = body({
    recipient_name: "Synthetic Energy Co",
    issue_facts: "A synthetic invoice was charged twice.",
    desired_outcome: "Reverse the duplicate charge.",
  });
  const result = await runCapturedDocumentOperation({
    userId: USER_ID,
    body: {
      ...resumeBody,
      action: "resume",
      operation_id: "44444444-4444-4444-8444-444444444444",
    },
    environment: { environment: "local", userCohort: "pilot" },
    gateway: adapter,
    provider: async (request) => {
      providerCalls += 1;
      return await provider(request);
    },
  });

  assertEquals(result.status, 200);
  assertEquals(result.body.status, "ready_for_review");
  assertEquals(providerCalls, 1);
  assertEquals(
    calls.filter((call) => call.name === "accept_captured_document_operation")
      .length,
    1,
  );
  assertEquals(
    calls.filter((call) => call.name === "claim_captured_document_operation")
      .length,
    1,
  );
  assertEquals(attemptNumbers, [3]);
});

Deno.test("captured runner persists capacity denial without preparing provider work", async () => {
  const { adapter, calls } = gateway();
  let providerCalls = 0;
  const result = await runCapturedDocumentOperation({
    userId: USER_ID,
    body: body({
      recipient_name: "Synthetic Energy Co",
      issue_facts: "A synthetic invoice was charged twice.",
      desired_outcome: "Reverse the duplicate charge.",
    }),
    environment: { environment: "local", userCohort: "pilot" },
    gateway: adapter,
    provider: async () => {
      providerCalls += 1;
      throw new OpenAIAdapterError(
        "OPENAI_AWAITING_CAPACITY",
        429,
        true,
        7,
      );
    },
  });

  assertEquals(result.status, 202);
  assertEquals(result.body.status, "awaiting_capacity");
  assertEquals(result.body.retryable, true);
  assertEquals(result.body.retry_after_seconds, 7);
  assertEquals(providerCalls, 1);
  assertEquals(
    calls.filter((call) =>
      call.name === "record_captured_document_provider_attempt"
    ).length,
    0,
  );
  const deferred = calls.find((call) =>
    call.name === "defer_captured_document_operation_for_capacity"
  );
  assertEquals(deferred?.args.p_semantic_route, "deep");
  assertEquals(deferred?.args.p_retry_after_seconds, 7);
});

Deno.test("capacity-wait resume with a generation checkpoint retries review only", async () => {
  const invalidGeneration = complaintOutput();
  const sections = invalidGeneration.sections as Array<Record<string, unknown>>;
  sections[0] = { ...sections[0], content: "too short" };
  const { adapter, calls } = gateway({
    replay: true,
    replayStatus: "awaiting_capacity",
    generationCheckpoint: invalidGeneration,
  });
  const reviewProvider = successfulProvider(
    "resp_capacity_review",
    complaintOutput(),
  );
  const providerTasks: string[] = [];
  const original = body({
    recipient_name: "Synthetic Energy Co",
    issue_facts: "A synthetic invoice was charged twice.",
    desired_outcome: "Reverse the duplicate charge.",
  });
  const result = await runCapturedDocumentOperation({
    userId: USER_ID,
    body: {
      ...original,
      action: "resume",
      operation_id: "44444444-4444-4444-8444-444444444444",
    },
    environment: { environment: "local", userCohort: "pilot" },
    gateway: adapter,
    provider: async (request) => {
      providerTasks.push(request.task);
      return await reviewProvider(request);
    },
  });

  assertEquals(result.status, 200);
  assertEquals(result.body.status, "ready_for_review");
  assertEquals(providerTasks, ["review"]);
  assertEquals(
    calls
      .filter((call) => call.name === "advance_captured_document_operation")
      .map((call) => call.args.p_next_status),
    ["persisting"],
  );
  assertEquals(
    calls.filter((call) =>
      call.name === "resume_captured_document_operation_from_capacity"
    ).length,
    1,
  );
  assertEquals(
    calls.filter((call) =>
      call.name === "record_captured_document_provider_attempt" &&
      call.args.p_logical_stage_key === "generation"
    ).length,
    0,
  );
});

Deno.test("capacity-wait resume before the durable deadline performs no state churn or provider work", async () => {
  const { adapter, calls } = gateway({
    replay: true,
    replayStatus: "awaiting_capacity",
    capacityResumeDeferred: true,
  });
  let providerCalls = 0;
  const result = await runCapturedDocumentOperation({
    userId: USER_ID,
    body: {
      ...body({
        recipient_name: "Synthetic Energy Co",
        issue_facts: "A synthetic invoice was charged twice.",
        desired_outcome: "Reverse the duplicate charge.",
      }),
      action: "resume",
      operation_id: "44444444-4444-4444-8444-444444444444",
    },
    environment: { environment: "local", userCohort: "pilot" },
    gateway: adapter,
    provider: async () => {
      providerCalls += 1;
      throw new Error("capacity retry deadline has not opened");
    },
  });

  assertEquals(result.status, 202);
  assertEquals(result.body.status, "awaiting_capacity");
  assertEquals(result.body.capacity_resume_deferred, true);
  assertEquals(result.body.retryable, true);
  assertEquals(providerCalls, 0);
  assertEquals(
    calls.filter((call) =>
      call.name === "resume_captured_document_operation_from_capacity"
    ).length,
    1,
  );
  assertEquals(
    calls.filter((call) =>
      [
        "claim_captured_document_operation",
        "advance_captured_document_operation",
        "record_captured_document_provider_attempt",
      ].includes(call.name)
    ).length,
    0,
  );
});

Deno.test("captured runner resumes from a successful durable checkpoint without redispatch", async () => {
  const { adapter, calls } = gateway({
    replay: true,
    replayStatus: "retryable_failure",
    generationCheckpoint: complaintOutput(),
  });
  let providerCalls = 0;
  const original = body({
    recipient_name: "Synthetic Energy Co",
    issue_facts: "A synthetic invoice was charged twice.",
    desired_outcome: "Reverse the duplicate charge.",
  });
  const result = await runCapturedDocumentOperation({
    userId: USER_ID,
    body: {
      ...original,
      action: "resume",
      operation_id: "44444444-4444-4444-8444-444444444444",
    },
    environment: { environment: "local", userCohort: "pilot" },
    gateway: adapter,
    provider: async () => {
      providerCalls += 1;
      throw new Error("checkpointed work must not be redispatched");
    },
  });

  assertEquals(result.status, 200);
  assertEquals(providerCalls, 0);
  assertEquals(
    calls.filter((call) =>
      call.name === "record_captured_document_provider_attempt"
    ).length,
    0,
  );
  assertEquals("generation_checkpoint" in result.body, false);
  assertEquals("route_snapshot" in result.body, false);
});

Deno.test("captured runner reconciles every checkpointed in-progress stage without duplicate provider work", async () => {
  const expectations = [
    {
      status: "generating",
      transitions: ["validating", "persisting"],
    },
    { status: "validating", transitions: ["persisting"] },
    { status: "persisting", transitions: [] },
  ];

  for (const expectation of expectations) {
    const { adapter, calls } = gateway({
      replay: true,
      replayStatus: expectation.status,
      generationCheckpoint: complaintOutput(),
    });
    let providerCalls = 0;
    const original = body({
      recipient_name: "Synthetic Energy Co",
      issue_facts: "A synthetic invoice was charged twice.",
      desired_outcome: "Reverse the duplicate charge.",
    });
    const result = await runCapturedDocumentOperation({
      userId: USER_ID,
      body: {
        ...original,
        action: "resume",
        operation_id: "44444444-4444-4444-8444-444444444444",
      },
      environment: { environment: "local", userCohort: "pilot" },
      gateway: adapter,
      provider: async () => {
        providerCalls += 1;
        throw new Error(
          "checkpointed in-progress work must not be redispatched",
        );
      },
    });

    assertEquals(result.status, 200, expectation.status);
    assertEquals(result.body.status, "ready_for_review", expectation.status);
    assertEquals(providerCalls, 0, expectation.status);
    assertEquals(
      calls
        .filter((call) => call.name === "advance_captured_document_operation")
        .map((call) => call.args.p_next_status),
      expectation.transitions,
      expectation.status,
    );
    assertEquals(
      calls.filter((call) =>
        call.name === "record_captured_document_provider_attempt"
      ).length,
      0,
      expectation.status,
    );
  }
});
