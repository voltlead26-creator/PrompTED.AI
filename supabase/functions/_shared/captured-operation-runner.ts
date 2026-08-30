import {
  capturedDocumentOutputSchema,
  capturedDocumentSystemPrompt,
  capturedDocumentUserMessage,
  type CapturedInputPlan,
  CapturedOperationInputError,
  capturedOutputNeedsReview,
  type CapturedValidationIssue,
  planCapturedInputs,
  validateCapturedDocumentOutput,
} from "./captured-document-operation.ts";
import {
  OpenAIAdapterError,
  type ProviderAttempt,
  type ProviderAttemptLifecycle,
  type ProviderRequest,
  type ProviderResponse,
  routeRequest,
} from "./provider-router.ts";
import {
  type OpenAIRouteSnapshot,
  validateOpenAIRouteSnapshot,
} from "../../../packages/shared/src/document-operation.ts";

const PIPELINE_VERSION = "captured-operation-pipeline.1";
const WORKFLOW = "master-workspace";

export interface CapturedOperationBody {
  action?: unknown;
  operation_id?: unknown;
  outcome_id?: unknown;
  document_id?: unknown;
  title?: unknown;
  template_id?: unknown;
  generation_request_id?: unknown;
  input_revision?: unknown;
  input_values?: unknown;
  locale?: unknown;
  jurisdiction?: unknown;
}

export interface CapturedOperationEnvironment {
  environment: string;
  userCohort: string;
}

export interface CapturedOperationGateway {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<
    { data: unknown; error: { message?: string; code?: string } | null }
  >;
}

export type CapturedProvider = (
  request: ProviderRequest,
) => Promise<ProviderResponse>;

export interface CapturedOperationRunnerResult {
  status: number;
  body: Record<string, unknown>;
}

interface OperationState {
  operation_id: string;
  document_id: string;
  operation_revision: number;
  accepted_document_revision?: number;
  status: string;
  lease_token?: string | null;
  correlation_id?: string;
  safe_section_keys?: string[];
  blocked_section_keys?: string[];
  idempotent_replay?: boolean;
  latest_document_revision?: number;
  routing_version?: string;
  route_snapshot?: unknown;
  generation_checkpoint?: unknown;
  review_checkpoint?: unknown;
  provider_attempt_number?: number;
  provider_client_request_id?: string;
}

class CapturedOperationRpcError extends Error {
  constructor(
    public readonly code: string,
    public readonly rpc: string,
  ) {
    super(code);
    this.name = "CapturedOperationRpcError";
  }
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function uuid(value: unknown): string {
  const candidate = text(value, 64);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(candidate)
  ) {
    throw new CapturedOperationInputError("CAPTURED_OPERATION_UUID_INVALID");
  }
  return candidate;
}

function publicRpcCode(
  error: { message?: string; code?: string } | null,
): string {
  const message = error?.message ?? "";
  const match = message.match(/\b([A-Z][A-Z0-9_]{3,})\b/);
  return match?.[1] ??
    (error?.code ? `DATABASE_${error.code}` : "CAPTURED_OPERATION_RPC_FAILED");
}

function state(
  value: unknown,
  rpc: string,
  previous?: OperationState,
): OperationState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CapturedOperationRpcError(
      "CAPTURED_OPERATION_RPC_SHAPE_INVALID",
      rpc,
    );
  }
  const record = value as Record<string, unknown>;
  const merged = { ...previous, ...record } as unknown as OperationState;
  if (
    typeof merged.operation_id !== "string" ||
    typeof merged.document_id !== "string" ||
    typeof merged.operation_revision !== "number" ||
    typeof merged.status !== "string"
  ) {
    throw new CapturedOperationRpcError(
      "CAPTURED_OPERATION_RPC_SHAPE_INVALID",
      rpc,
    );
  }
  return merged;
}

function publicState(operation: OperationState): Record<string, unknown> {
  const {
    route_snapshot: _routeSnapshot,
    routing_version: _routingVersion,
    generation_checkpoint: _generationCheckpoint,
    review_checkpoint: _ReviewCheckpoint,
    provider_attempt_number: _providerAttemptNumber,
    provider_client_request_id: _providerClientRequestId,
    lease_token: _leaseToken,
    ...visible
  } = operation;
  return visible;
}

function structuredCheckpoint(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function rpcState(
  gateway: CapturedOperationGateway,
  name: string,
  args: Record<string, unknown>,
  previous?: OperationState,
): Promise<OperationState> {
  const { data, error } = await gateway.rpc(name, args);
  if (error) throw new CapturedOperationRpcError(publicRpcCode(error), name);
  return state(data, name, previous);
}

function questions(plan: CapturedInputPlan) {
  const missing = new Set(plan.unresolvedInputKeys);
  return plan.template.requiredInputs
    .filter((input) => missing.has(input.key))
    .slice(0, 3)
    .map((input) => ({
      input_key: input.key,
      label: input.label,
      question: input.clarification.question,
      why_needed: input.clarification.whyNeeded,
      blocks_sections: input.clarification.blocksSections,
      blocks_export: input.clarification.blocksExport,
      can_skip: input.clarification.canAnswerWithUnknown,
      skip_consequence: input.clarification.fallbackIfUserSkips ??
        "blockGeneration",
    }));
}

function routePrompt(
  plan: CapturedInputPlan,
  task: "document" | "review",
  routeSnapshot: OpenAIRouteSnapshot,
  prior?: { output: unknown; issues: CapturedValidationIssue[] },
): ProviderRequest {
  return {
    task,
    systemPrompt: capturedDocumentSystemPrompt(plan, task === "review"),
    messages: [{
      role: "user",
      content: capturedDocumentUserMessage(plan, prior),
    }],
    maxTokens: 16_000,
    outputSchema: capturedDocumentOutputSchema(plan),
    background: false,
    routeSnapshot,
    metadata: {
      ledger_version: "ledger.2026-08-first-cohort.1",
      routing_version: routeSnapshot.routingVersion,
      template_id: plan.templateId,
    },
  };
}

function acceptedRoute(
  operation: OperationState,
  plan: CapturedInputPlan,
  semanticRoute: "deep" | "review",
): OpenAIRouteSnapshot {
  const captured = operation.route_snapshot;
  if (!captured || typeof captured !== "object" || Array.isArray(captured)) {
    throw new CapturedOperationRpcError(
      "CAPTURED_ACCEPTED_ROUTE_INVALID",
      "accept_captured_document_operation",
    );
  }
  const root = captured as Record<string, unknown>;
  const routes = root.routes && typeof root.routes === "object" &&
      !Array.isArray(root.routes)
    ? root.routes as Record<string, unknown>
    : null;
  const rawRoute = routes?.[semanticRoute];
  const route = rawRoute && typeof rawRoute === "object" &&
      !Array.isArray(rawRoute)
    ? rawRoute as Record<string, unknown>
    : null;
  const routingVersion = typeof root.routingVersion === "string"
    ? root.routingVersion.trim()
    : "";
  const expectedSchema = capturedDocumentOutputSchema(plan).version ??
    capturedDocumentOutputSchema(plan).name;
  const validationIssues = validateOpenAIRouteSnapshot(route);
  if (
    root.provider !== "openai" ||
    !routingVersion ||
    routingVersion !== operation.routing_version ||
    validationIssues.length > 0 ||
    route?.semanticRoute !== semanticRoute ||
    route?.routingVersion !== routingVersion ||
    route?.structuredOutputSchemaVersion !== expectedSchema ||
    JSON.stringify(route?.allowedTools) !== "[]"
  ) {
    throw new CapturedOperationRpcError(
      "CAPTURED_ACCEPTED_ROUTE_INVALID",
      "accept_captured_document_operation",
    );
  }
  return route as unknown as OpenAIRouteSnapshot;
}

async function advance(
  gateway: CapturedOperationGateway,
  operation: OperationState,
  leaseToken: string,
  nextStatus: string,
  metadata: Record<string, unknown> = {},
  error?: { code: string; message: string; next: string },
): Promise<OperationState> {
  const next = await rpcState(gateway, "advance_captured_document_operation", {
    p_operation_id: operation.operation_id,
    p_expected_operation_revision: operation.operation_revision,
    p_lease_token: leaseToken,
    p_next_status: nextStatus,
    p_event_metadata: metadata,
    p_error_code: error?.code ?? null,
    p_public_error_message: error?.message ?? null,
    p_safe_next_action: error?.next ?? null,
  }, operation);
  next.lease_token =
    nextStatus === "generating" || nextStatus === "validating" ||
      nextStatus === "persisting"
      ? leaseToken
      : null;
  return next;
}

function providerErrorInfo(error: unknown) {
  if (error instanceof CapturedOperationRpcError) {
    return {
      code: error.code,
      retryable: false,
      status: 409,
      attempts: [] as ProviderAttempt[],
    };
  }
  if (error instanceof OpenAIAdapterError) {
    return {
      code: error.code,
      retryable: error.retryable,
      status: error.status,
      attempts: error.attempts,
    };
  }
  const attempts =
    (error as { attempts?: ProviderAttempt[] } | null)?.attempts ?? [];
  return {
    code: (error as { name?: string } | null)?.name === "AbortError"
      ? "OPENAI_CANCELLED"
      : "OPENAI_REQUEST_FAILED",
    retryable: false,
    status: 502,
    attempts,
  };
}

export async function runCapturedDocumentOperation(params: {
  userId: string;
  body: CapturedOperationBody;
  environment: CapturedOperationEnvironment;
  gateway: CapturedOperationGateway;
  signal?: AbortSignal;
  provider?: CapturedProvider;
}): Promise<CapturedOperationRunnerResult> {
  const provider = params.provider ?? routeRequest;
  let operation: OperationState | null = null;
  let leaseToken: string | null = null;

  try {
    const outcomeId = uuid(params.body.outcome_id);
    const documentId = uuid(params.body.document_id);
    const templateId = text(params.body.template_id, 120).toLowerCase();
    const title = text(params.body.title, 240);
    const idempotencyKey = text(params.body.generation_request_id, 128);
    const inputRevision = positiveInteger(params.body.input_revision, 1);
    const locale = text(params.body.locale, 40) || "en-AU";
    const jurisdiction = text(params.body.jurisdiction, 40) || "AU";
    if (!title) {
      throw new CapturedOperationInputError("CAPTURED_DOCUMENT_TITLE_INVALID");
    }
    if (!idempotencyKey) {
      throw new CapturedOperationInputError(
        "CAPTURED_IDEMPOTENCY_KEY_REQUIRED",
      );
    }

    const plan = planCapturedInputs(templateId, params.body.input_values);
    operation = await rpcState(
      params.gateway,
      "accept_captured_document_operation",
      {
        p_user_id: params.userId,
        p_outcome_id: outcomeId,
        p_document_id: documentId,
        p_title: title,
        p_environment: params.environment.environment,
        p_user_cohort: params.environment.userCohort,
        p_workflow: WORKFLOW,
        p_template_id: plan.templateId,
        p_benchmark_version: plan.template.qualityBenchmark.benchmarkVersion,
        p_pipeline_version: PIPELINE_VERSION,
        p_input_revision: inputRevision,
        p_idempotency_key: idempotencyKey,
        p_input_values: plan.inputValues,
        p_source_snapshot: plan.sourceSnapshot,
        p_evidence_snapshot: plan.evidenceSnapshot,
        p_locale: locale,
        p_jurisdiction: jurisdiction,
        p_safe_section_keys: plan.safeSectionKeys,
        p_blocked_section_keys: plan.blockedSectionKeys,
        p_unresolved_input_keys: plan.unresolvedInputKeys,
        p_confirmations: plan.confirmations,
        p_operation_ttl_seconds: 86_400,
      },
    );

    const requestedAction = text(params.body.action, 20).toLowerCase();
    if (requestedAction === "resume") {
      const requestedOperationId = uuid(params.body.operation_id);
      if (
        !operation.idempotent_replay ||
        operation.operation_id !== requestedOperationId
      ) {
        throw new CapturedOperationRpcError(
          "CAPTURED_OPERATION_RESUME_CONFLICT",
          "accept_captured_document_operation",
        );
      }
    }

    // Validate both routes from the immutable accepted snapshot before the
    // first provider call. The adapter receives these exact effective routes;
    // it never re-selects a model from the current environment for this work.
    const generationRoute = acceptedRoute(operation, plan, "deep");
    const reviewRoute = acceptedRoute(operation, plan, "review");

    const resumableStatus = [
      "accepted",
      "generating",
      "validating",
      "persisting",
      "retryable_failure",
    ].includes(operation.status);
    if (
      operation.idempotent_replay &&
      !(requestedAction === "resume" && resumableStatus)
    ) {
      const terminal = operation.status === "terminal_failure" ||
        operation.status === "cancelled";
      return {
        status: operation.status === "ready_for_review"
          ? 200
          : terminal
          ? 409
          : 202,
        body: {
          ...publicState(operation),
          reconnect:
            `/api/document-operation?operation_id=${operation.operation_id}`,
          retryable: false,
        },
      };
    }

    const leaseOwner =
      `edge:document-operation:${PIPELINE_VERSION}:${crypto.randomUUID()}`;
    const renewLease = async (): Promise<void> => {
      if (!operation) {
        throw new CapturedOperationRpcError(
          "CAPTURED_OPERATION_STATE_MISSING",
          "claim_captured_document_operation",
        );
      }
      const priorLeaseToken = leaseToken;
      const claimed = await rpcState(
        params.gateway,
        "claim_captured_document_operation",
        {
          p_operation_id: operation.operation_id,
          p_expected_operation_revision: operation.operation_revision,
          p_lease_owner: leaseOwner,
          p_lease_seconds: 300,
        },
        operation,
      );
      const nextLeaseToken = text(claimed.lease_token, 64);
      if (
        !nextLeaseToken ||
        (priorLeaseToken && priorLeaseToken !== nextLeaseToken)
      ) {
        throw new CapturedOperationRpcError(
          "CAPTURED_OPERATION_LEASE_MISSING",
          "claim_captured_document_operation",
        );
      }
      operation = claimed;
      leaseToken = nextLeaseToken;
      operation.lease_token = nextLeaseToken;
    };

    const attemptLifecycle = (
      stage: "generation" | "review",
      route: OpenAIRouteSnapshot,
    ): ProviderAttemptLifecycle => ({
      prepare: async ({ startedAt, requestSha256 }) => {
        await renewLease();
        if (!operation || !leaseToken) {
          throw new CapturedOperationRpcError(
            "CAPTURED_OPERATION_LEASE_MISSING",
            "record_captured_document_provider_attempt",
          );
        }
        const prepared = await rpcState(
          params.gateway,
          "record_captured_document_provider_attempt",
          {
            p_operation_id: operation.operation_id,
            p_expected_operation_revision: operation.operation_revision,
            p_lease_token: leaseToken,
            p_logical_stage_key: stage,
            p_attempt_number: 0,
            p_semantic_route: route.semanticRoute,
            p_model: route.model,
            p_reasoning_effort: route.reasoningEffort,
            p_provider_response_id: null,
            p_retention_mode: "store_false",
            p_status: "prepared",
            p_input_tokens: 0,
            p_output_tokens: 0,
            p_retry_reason: null,
            p_error_code: null,
            p_started_at: startedAt,
            p_completed_at: null,
            p_request_sha256: requestSha256,
            p_structured_output: null,
          },
          operation,
        );
        operation = prepared;
        operation.lease_token = leaseToken;
        const attemptNumber = positiveInteger(
          prepared.provider_attempt_number,
          0,
        );
        const clientRequestId = text(
          prepared.provider_client_request_id,
          512,
        );
        if (!attemptNumber || !clientRequestId) {
          throw new CapturedOperationRpcError(
            "CAPTURED_PROVIDER_ATTEMPT_PREPARATION_INVALID",
            "record_captured_document_provider_attempt",
          );
        }
        return { attemptNumber, clientRequestId };
      },
      complete: async ({ attempt, requestSha256, structuredOutput }) => {
        await renewLease();
        if (!operation || !leaseToken) {
          throw new CapturedOperationRpcError(
            "CAPTURED_OPERATION_LEASE_MISSING",
            "record_captured_document_provider_attempt",
          );
        }
        operation = await rpcState(
          params.gateway,
          "record_captured_document_provider_attempt",
          {
            p_operation_id: operation.operation_id,
            p_expected_operation_revision: operation.operation_revision,
            p_lease_token: leaseToken,
            p_logical_stage_key: stage,
            p_attempt_number: attempt.attemptNumber,
            p_semantic_route: route.semanticRoute,
            p_model: route.model,
            p_reasoning_effort: route.reasoningEffort,
            p_provider_response_id: attempt.responseId || null,
            p_retention_mode: "store_false",
            p_status: attempt.status,
            p_input_tokens: attempt.inputTokens,
            p_output_tokens: attempt.outputTokens,
            p_retry_reason: attempt.attemptNumber > 1
              ? "bounded_transient_retry"
              : null,
            p_error_code: attempt.errorCode,
            p_started_at: attempt.startedAt,
            p_completed_at: attempt.completedAt,
            p_request_sha256: requestSha256,
            p_structured_output: structuredOutput,
          },
          operation,
        );
        operation.lease_token = leaseToken;
      },
    });

    await renewLease();
    if (!leaseToken) {
      throw new CapturedOperationRpcError(
        "CAPTURED_OPERATION_LEASE_MISSING",
        "claim_captured_document_operation",
      );
    }
    const activeLeaseToken = leaseToken;

    if (plan.blockedSectionKeys.length > 0) {
      operation = await advance(
        params.gateway,
        operation,
        activeLeaseToken,
        "awaiting_clarification",
        {
          unresolved_input_keys: plan.unresolvedInputKeys,
          blocked_section_keys: plan.blockedSectionKeys,
        },
      );
      return {
        status: 202,
        body: {
          ...publicState(operation),
          questions: questions(plan),
          reconnect:
            `/api/document-operation?operation_id=${operation.operation_id}`,
          retryable: true,
        },
      };
    }

    if (["accepted", "retryable_failure"].includes(operation.status)) {
      operation = await advance(
        params.gateway,
        operation,
        activeLeaseToken,
        "generating",
        { semantic_route: "deep" },
      );
    } else if (
      ![
        "generating",
        "validating",
        "persisting",
      ].includes(operation.status)
    ) {
      throw new CapturedOperationRpcError(
        "CAPTURED_OPERATION_RESUME_STATUS_INVALID",
        "accept_captured_document_operation",
      );
    }

    let generationOutput = structuredCheckpoint(
      operation.generation_checkpoint,
    );
    const reviewCheckpoint = structuredCheckpoint(operation.review_checkpoint);
    if (
      ["validating", "persisting"].includes(operation.status) &&
      !generationOutput && !reviewCheckpoint
    ) {
      throw new CapturedOperationRpcError(
        "CAPTURED_PROVIDER_CHECKPOINT_RECONCILIATION_REQUIRED",
        "record_captured_document_provider_attempt",
      );
    }
    if (!generationOutput && !reviewCheckpoint) {
      try {
        const generated = await provider({
          ...routePrompt(plan, "document", generationRoute),
          signal: params.signal,
          attemptLifecycle: attemptLifecycle("generation", generationRoute),
          metadata: {
            operation_id: operation.operation_id,
            ledger_version: "ledger.2026-08-first-cohort.1",
            routing_version: generationRoute.routingVersion,
            template_id: plan.templateId,
          },
        });
        generationOutput = generated.structured ?? null;
      } catch (error) {
        const info = providerErrorInfo(error);
        if (info.code === "OPENAI_CANCELLED") {
          operation = await rpcState(
            params.gateway,
            "cancel_captured_document_operation",
            {
              p_operation_id: operation.operation_id,
              p_expected_operation_revision: operation.operation_revision,
              p_lease_token: activeLeaseToken,
              p_cancellation_code: "client_cancelled",
            },
            operation,
          );
          return {
            status: 409,
            body: { ...publicState(operation), retryable: false },
          };
        }
        operation = await advance(
          params.gateway,
          operation,
          activeLeaseToken,
          info.retryable ? "retryable_failure" : "terminal_failure",
          { provider_status: info.status },
          {
            code: info.code,
            message: "TED could not finish this document operation.",
            next: info.retryable
              ? "Resume this operation without creating a new document."
              : "Review the supplied facts before starting a new operation.",
          },
        );
        return {
          status: info.retryable ? 503 : 422,
          body: { ...publicState(operation), retryable: info.retryable },
        };
      }
    }

    let evaluated = validateCapturedDocumentOutput(
      plan,
      reviewCheckpoint ?? generationOutput,
    );
    if (
      !reviewCheckpoint && capturedOutputNeedsReview(plan, evaluated.validation)
    ) {
      if (operation.status === "persisting") {
        throw new CapturedOperationRpcError(
          "CAPTURED_PERSISTING_CHECKPOINT_INVALID",
          "finalize_captured_document_operation",
        );
      }
      if (operation.status !== "validating") {
        operation = await advance(
          params.gateway,
          operation,
          activeLeaseToken,
          "validating",
          {
            semantic_route: "review",
            issue_count: evaluated.validation.issues.length,
            high_risk: plan.template.riskLevel === "high_risk",
          },
        );
      }
      let reviewed: ProviderResponse;
      try {
        reviewed = await provider({
          ...routePrompt(plan, "review", reviewRoute, {
            output: generationOutput,
            issues: evaluated.validation.issues,
          }),
          signal: params.signal,
          attemptLifecycle: attemptLifecycle("review", reviewRoute),
          metadata: {
            operation_id: operation.operation_id,
            stage_id: "conditional-review",
            ledger_version: "ledger.2026-08-first-cohort.1",
            routing_version: reviewRoute.routingVersion,
            template_id: plan.templateId,
          },
        });
      } catch (error) {
        const info = providerErrorInfo(error);
        operation = await advance(
          params.gateway,
          operation,
          activeLeaseToken,
          info.retryable ? "retryable_failure" : "terminal_failure",
          { stage: "conditional_review" },
          {
            code: info.code,
            message: "TED could not complete the required document review.",
            next: info.retryable
              ? "Resume this operation without duplicating the allowance."
              : "Review the supplied facts before starting a new operation.",
          },
        );
        return {
          status: info.retryable ? 503 : 422,
          body: { ...publicState(operation), retryable: info.retryable },
        };
      }
      evaluated = validateCapturedDocumentOutput(plan, reviewed.structured);
    }

    if (!evaluated.validation.passed) {
      operation = await advance(
        params.gateway,
        operation,
        activeLeaseToken,
        "terminal_failure",
        { validation_issue_count: evaluated.validation.issues.length },
        {
          code: "CAPTURED_OUTPUT_VALIDATION_FAILED",
          message:
            "TED did not produce wording that passed the document contract.",
          next: "Review the confirmed inputs before starting a new operation.",
        },
      );
      return {
        status: 422,
        body: {
          ...publicState(operation),
          retryable: false,
          validation: evaluated.validation,
        },
      };
    }

    if (operation.status === "generating") {
      operation = await advance(
        params.gateway,
        operation,
        activeLeaseToken,
        "validating",
        { deterministic_validation_passed: true },
      );
    }
    await renewLease();
    if (operation.status !== "persisting") {
      operation = await advance(
        params.gateway,
        operation,
        activeLeaseToken,
        "persisting",
        { deterministic_validation_passed: true },
      );
    }
    operation = await rpcState(
      params.gateway,
      "finalize_captured_document_operation",
      {
        p_operation_id: operation.operation_id,
        p_expected_operation_revision: operation.operation_revision,
        p_lease_token: activeLeaseToken,
        p_sections: evaluated.sections,
        p_validation_result: evaluated.validation,
      },
      operation,
    );

    return {
      status: 200,
      body: {
        ...publicState(operation),
        retryable: false,
        reconnect:
          `/api/document-operation?operation_id=${operation.operation_id}`,
      },
    };
  } catch (error) {
    if (error instanceof CapturedOperationInputError) {
      return {
        status: 400,
        body: {
          error: {
            code: error.code,
            message: "The captured document request is incomplete or invalid.",
          },
          retryable: false,
        },
      };
    }
    if (error instanceof CapturedOperationRpcError) {
      const activationDisabled = error.code === "CAPTURED_ACTIVATION_DISABLED";
      return {
        status: activationDisabled ? 409 : 500,
        body: {
          error: {
            code: error.code,
            message: activationDisabled
              ? "This captured document cohort is not active in this environment."
              : "TED could not persist the document operation safely.",
          },
          retryable: !activationDisabled,
          operation_id: operation?.operation_id,
          correlation_id: operation?.correlation_id,
        },
      };
    }
    return {
      status: 500,
      body: {
        error: {
          code: "CAPTURED_OPERATION_FAILED",
          message: "TED could not persist the document operation safely.",
        },
        retryable: Boolean(operation),
        operation_id: operation?.operation_id,
        correlation_id: operation?.correlation_id,
      },
    };
  }
}
