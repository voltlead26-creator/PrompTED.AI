import { assertEquals } from "jsr:@std/assert@1";
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

function gateway(options?: {
  activationDisabled?: boolean;
  replay?: boolean;
  replayStatus?: string;
  generationCheckpoint?: Record<string, unknown>;
  reviewCheckpoint?: Record<string, unknown>;
  nextAttemptNumber?: number;
  routeSnapshot?: unknown;
}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const attemptNumbers: number[] = [];
  let revision = 1;
  let status = "accepted";
  let nextAttemptNumber = options?.nextAttemptNumber ?? 1;
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
    generation_checkpoint: options?.generationCheckpoint ?? null,
    review_checkpoint: options?.reviewCheckpoint ?? null,
    ...extra,
  });

  const adapter: CapturedOperationGateway = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "accept_captured_document_operation") {
        if (options?.activationDisabled) {
          return {
            data: null,
            error: { message: "CAPTURED_ACTIVATION_DISABLED:local:pilot" },
          };
        }
        if (options?.replayStatus) status = options.replayStatus;
        return {
          data: value({ idempotent_replay: options?.replay ?? false }),
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
      if (name === "advance_captured_document_operation") {
        revision += 1;
        status = String(args.p_next_status);
        return {
          data: value({ retryable: status === "retryable_failure" }),
          error: null,
        };
      }
      if (name === "record_captured_document_provider_attempt") {
        revision += 1;
        const prepared = args.p_status === "prepared";
        const attemptNumber = prepared
          ? nextAttemptNumber++
          : Number(args.p_attempt_number);
        if (prepared) attemptNumbers.push(attemptNumber);
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
  return { adapter, calls, attemptNumbers };
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
    "accept_captured_document_operation",
    "claim_captured_document_operation",
    "advance_captured_document_operation",
  ]);
  assertEquals(
    (result.body.questions as Array<Record<string, unknown>>)[0]?.input_key,
    "desired_outcome",
  );
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
    "accept_captured_document_operation",
    "claim_captured_document_operation",
    "advance_captured_document_operation",
    "claim_captured_document_operation",
    "record_captured_document_provider_attempt",
    "claim_captured_document_operation",
    "record_captured_document_provider_attempt",
    "advance_captured_document_operation",
    "claim_captured_document_operation",
    "advance_captured_document_operation",
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
    "accept_captured_document_operation",
  ]);
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
    4,
  );
  assertEquals(attemptNumbers, [3]);
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
