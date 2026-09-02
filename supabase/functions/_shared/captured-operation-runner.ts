import {
  type CapturedAcceptedInputSnapshot,
  capturedDocumentOutputSchema,
  capturedDocumentSystemPrompt,
  capturedDocumentUserMessage,
  type CapturedInputPlan,
  CapturedOperationInputError,
  capturedOutputNeedsReview,
  type CapturedValidationIssue,
  planCapturedInputs,
  restoreCapturedInputPlan,
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

const CURRENT_PIPELINE_VERSION = "captured-operation-pipeline.1";
const WORKFLOW = "master-workspace";
const OPERATION_TTL_SECONDS = 86_400;

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
  /**
   * Compatibility-only test/input field. New acceptance never trusts it;
   * Supabase resolves the authenticated owner's assignment server-side.
   */
  userCohort?: string;
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

export type CapturedOperationExecutionMode = "accept_only" | "run";

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
  cancellation_requested?: boolean;
  cancellation_code?: string | null;
  capacity_resume_deferred?: boolean;
  capacity_semantic_route?: "deep" | "review" | null;
  capacity_wait_started_at?: string | null;
  capacity_retry_after_at?: string | null;
  retry_after_seconds?: number | null;
  resume_available?: boolean;
}

interface AcceptedExecution {
  operationId: string;
  outcomeId: string;
  documentId: string;
  title: string;
  environment: CapturedOperationEnvironment;
  workflow: string;
  templateId: string;
  ledgerSchemaVersion: string;
  ledgerVersion: string;
  ledgerContractSha256: string;
  benchmarkVersion: string;
  pipelineVersion: string;
  routingVersion: string;
  routeSnapshot: Record<string, unknown>;
  idempotencyKey: string;
  inputRevision: number;
  locale: string;
  jurisdiction: string;
  operationTtlSeconds: number;
  plan: CapturedInputPlan;
}

interface CapturedPipelineAdapter {
  readonly pipelineVersion: string;
  readonly workflow: string;
  readonly operationTtlSeconds: number;
  restorePlan(snapshot: CapturedAcceptedInputSnapshot): CapturedInputPlan;
}

const CAPTURED_PIPELINE_ADAPTERS: ReadonlyMap<string, CapturedPipelineAdapter> =
  new Map([[CURRENT_PIPELINE_VERSION, {
    pipelineVersion: CURRENT_PIPELINE_VERSION,
    workflow: WORKFLOW,
    operationTtlSeconds: OPERATION_TTL_SECONDS,
    restorePlan: restoreCapturedInputPlan,
  }]]);

class CapturedOperationRpcError extends Error {
  constructor(
    public readonly code: string,
    public readonly rpc: string,
  ) {
    super(code);
    this.name = "CapturedOperationRpcError";
  }
}

class CapturedCapacityResumeDeferredError extends Error {
  constructor() {
    super("CAPTURED_CAPACITY_RETRY_NOT_READY");
    this.name = "CapturedCapacityResumeDeferredError";
  }
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function acceptedText(
  value: unknown,
  max: number,
  code: string,
): string {
  const accepted = typeof value === "string" ? value.trim() : "";
  if (!accepted || accepted.length > max) {
    throw new CapturedOperationRpcError(
      code,
      "get_captured_document_resume_payload",
    );
  }
  return accepted;
}

function acceptedUuid(value: unknown, code: string): string {
  const accepted = acceptedText(value, 64, code);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(accepted)
  ) {
    throw new CapturedOperationRpcError(
      code,
      "get_captured_document_resume_payload",
    );
  }
  return accepted;
}

function acceptedPositiveInteger(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new CapturedOperationRpcError(
      code,
      "get_captured_document_resume_payload",
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    const entries = Object.keys(object).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(object[key])}`
    );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
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
    cancellation_code: _cancellationCode,
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

async function rpcValue(
  gateway: CapturedOperationGateway,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await gateway.rpc(name, args);
  if (error) throw new CapturedOperationRpcError(publicRpcCode(error), name);
  return data;
}

function pipelineAdapter(version: string): CapturedPipelineAdapter {
  const adapter = CAPTURED_PIPELINE_ADAPTERS.get(version);
  if (!adapter) {
    throw new CapturedOperationRpcError(
      "CAPTURED_PIPELINE_VERSION_UNSUPPORTED",
      "get_captured_document_resume_payload",
    );
  }
  return adapter;
}

function parseAcceptedExecution(
  raw: unknown,
  userId: string,
  expectedOperationId: string,
): AcceptedExecution {
  const accepted = record(raw);
  if (!accepted || accepted.action !== "resume") {
    throw new CapturedOperationRpcError(
      "CAPTURED_ACCEPTED_SNAPSHOT_INVALID",
      "get_captured_document_resume_payload",
    );
  }

  const operationId = acceptedUuid(
    accepted.operation_id,
    "CAPTURED_ACCEPTED_OPERATION_ID_INVALID",
  );
  const acceptedUserId = acceptedUuid(
    accepted.accepted_user_id,
    "CAPTURED_ACCEPTED_USER_ID_INVALID",
  );
  if (operationId !== expectedOperationId || acceptedUserId !== userId) {
    throw new CapturedOperationRpcError(
      "CAPTURED_ACCEPTED_SNAPSHOT_IDENTITY_MISMATCH",
      "get_captured_document_resume_payload",
    );
  }

  const pipelineVersion = acceptedText(
    accepted.pipeline_version,
    128,
    "CAPTURED_ACCEPTED_PIPELINE_VERSION_INVALID",
  );
  const adapter = pipelineAdapter(pipelineVersion);
  const workflow = acceptedText(
    accepted.workflow,
    100,
    "CAPTURED_ACCEPTED_WORKFLOW_INVALID",
  );
  const operationTtlSeconds = acceptedPositiveInteger(
    accepted.operation_ttl_seconds,
    "CAPTURED_ACCEPTED_TTL_INVALID",
  );
  if (
    workflow !== adapter.workflow ||
    operationTtlSeconds !== adapter.operationTtlSeconds ||
    accepted.contract_version !== "captured-document-operation.v1"
  ) {
    throw new CapturedOperationRpcError(
      "CAPTURED_ACCEPTED_PIPELINE_CONTRACT_INVALID",
      "get_captured_document_resume_payload",
    );
  }

  const templateId = acceptedText(
    accepted.template_id,
    120,
    "CAPTURED_ACCEPTED_TEMPLATE_ID_INVALID",
  ).toLowerCase();
  const ledgerSchemaVersion = acceptedText(
    accepted.ledger_schema_version,
    80,
    "CAPTURED_ACCEPTED_LEDGER_IDENTITY_INVALID",
  );
  const ledgerVersion = acceptedText(
    accepted.ledger_version,
    160,
    "CAPTURED_ACCEPTED_LEDGER_IDENTITY_INVALID",
  );
  const benchmarkVersion = acceptedText(
    accepted.benchmark_version,
    160,
    "CAPTURED_ACCEPTED_BENCHMARK_VERSION_INVALID",
  );
  const ledgerContractSha256 = acceptedText(
    accepted.ledger_contract_sha256,
    64,
    "CAPTURED_ACCEPTED_LEDGER_HASH_INVALID",
  );
  const requestSha256 = acceptedText(
    accepted.request_sha256,
    64,
    "CAPTURED_ACCEPTED_REQUEST_HASH_INVALID",
  );
  const generationSnapshotSha256 = acceptedText(
    accepted.generation_snapshot_sha256,
    64,
    "CAPTURED_ACCEPTED_GENERATION_HASH_INVALID",
  );
  if (
    !/^[0-9a-f]{64}$/.test(ledgerContractSha256) ||
    !/^[0-9a-f]{64}$/.test(requestSha256) ||
    !/^[0-9a-f]{64}$/.test(generationSnapshotSha256)
  ) {
    throw new CapturedOperationRpcError(
      "CAPTURED_ACCEPTED_SNAPSHOT_HASH_INVALID",
      "get_captured_document_resume_payload",
    );
  }

  const routeSnapshot = record(accepted.route_snapshot);
  const routingVersion = acceptedText(
    accepted.routing_version,
    160,
    "CAPTURED_ACCEPTED_ROUTING_VERSION_INVALID",
  );
  if (
    !routeSnapshot ||
    routeSnapshot.provider !== "openai" ||
    routeSnapshot.routingVersion !== routingVersion
  ) {
    throw new CapturedOperationRpcError(
      "CAPTURED_ACCEPTED_ROUTE_INVALID",
      "get_captured_document_resume_payload",
    );
  }

  let plan: CapturedInputPlan;
  try {
    plan = adapter.restorePlan({
      ledgerSchemaVersion,
      ledgerVersion,
      templateId,
      benchmarkVersion,
      ledgerTemplate: accepted.ledger_template,
      inputValues: accepted.input_values,
      sourceSnapshot: accepted.source_snapshot,
      evidenceSnapshot: accepted.evidence_snapshot,
      confirmations: accepted.confirmations,
      unresolvedInputKeys: accepted.unresolved_input_keys,
      safeSectionKeys: accepted.safe_section_keys,
      blockedSectionKeys: accepted.blocked_section_keys,
    });
  } catch (error) {
    const code = error instanceof CapturedOperationInputError
      ? error.code
      : "CAPTURED_ACCEPTED_SNAPSHOT_INVALID";
    throw new CapturedOperationRpcError(
      code,
      "get_captured_document_resume_payload",
    );
  }

  const locale = acceptedText(
    accepted.locale,
    40,
    "CAPTURED_ACCEPTED_LOCALE_INVALID",
  );
  const jurisdiction = acceptedText(
    accepted.jurisdiction,
    40,
    "CAPTURED_ACCEPTED_JURISDICTION_INVALID",
  );
  if (!plan.template.supportedLocales.includes(locale)) {
    throw new CapturedOperationRpcError(
      "CAPTURED_ACCEPTED_LOCALE_INVALID",
      "get_captured_document_resume_payload",
    );
  }

  return {
    operationId,
    outcomeId: acceptedUuid(
      accepted.outcome_id,
      "CAPTURED_ACCEPTED_OUTCOME_ID_INVALID",
    ),
    documentId: acceptedUuid(
      accepted.document_id,
      "CAPTURED_ACCEPTED_DOCUMENT_ID_INVALID",
    ),
    title: acceptedText(
      accepted.title,
      240,
      "CAPTURED_ACCEPTED_DOCUMENT_TITLE_INVALID",
    ),
    environment: {
      environment: acceptedText(
        accepted.accepted_environment,
        100,
        "CAPTURED_ACCEPTED_ENVIRONMENT_INVALID",
      ).toLowerCase(),
      userCohort: acceptedText(
        accepted.accepted_user_cohort,
        100,
        "CAPTURED_ACCEPTED_COHORT_INVALID",
      ).toLowerCase(),
    },
    workflow,
    templateId,
    ledgerSchemaVersion,
    ledgerVersion,
    ledgerContractSha256,
    benchmarkVersion,
    pipelineVersion,
    routingVersion,
    routeSnapshot,
    idempotencyKey: acceptedText(
      accepted.generation_request_id,
      128,
      "CAPTURED_ACCEPTED_IDEMPOTENCY_KEY_INVALID",
    ),
    inputRevision: acceptedPositiveInteger(
      accepted.input_revision,
      "CAPTURED_ACCEPTED_INPUT_REVISION_INVALID",
    ),
    locale,
    jurisdiction,
    operationTtlSeconds,
    plan,
  };
}

async function loadAcceptedExecution(
  gateway: CapturedOperationGateway,
  userId: string,
  operationId: string,
): Promise<AcceptedExecution> {
  const raw = await rpcValue(
    gateway,
    "get_captured_document_resume_payload",
    { p_user_id: userId, p_operation_id: operationId },
  );
  return parseAcceptedExecution(raw, userId, operationId);
}

function acceptanceArgs(
  userId: string,
  accepted: AcceptedExecution,
): Record<string, unknown> {
  return {
    p_user_id: userId,
    p_outcome_id: accepted.outcomeId,
    p_document_id: accepted.documentId,
    p_title: accepted.title,
    p_environment: accepted.environment.environment,
    p_user_cohort: accepted.environment.userCohort,
    p_workflow: accepted.workflow,
    p_template_id: accepted.plan.templateId,
    p_benchmark_version: accepted.benchmarkVersion,
    p_pipeline_version: accepted.pipelineVersion,
    p_input_revision: accepted.inputRevision,
    p_idempotency_key: accepted.idempotencyKey,
    p_input_values: accepted.plan.inputValues,
    p_source_snapshot: accepted.plan.sourceSnapshot,
    p_evidence_snapshot: accepted.plan.evidenceSnapshot,
    p_locale: accepted.locale,
    p_jurisdiction: accepted.jurisdiction,
    p_safe_section_keys: accepted.plan.safeSectionKeys,
    p_blocked_section_keys: accepted.plan.blockedSectionKeys,
    p_unresolved_input_keys: accepted.plan.unresolvedInputKeys,
    p_confirmations: accepted.plan.confirmations,
    p_operation_ttl_seconds: accepted.operationTtlSeconds,
  };
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
  accepted: AcceptedExecution,
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
      ledger_version: accepted.ledgerVersion,
      routing_version: routeSnapshot.routingVersion,
      template_id: plan.templateId,
    },
  };
}

function acceptedRoute(
  operation: OperationState,
  accepted: AcceptedExecution,
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
    routingVersion !== accepted.routingVersion ||
    canonicalJson(captured) !== canonicalJson(accepted.routeSnapshot) ||
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
      retryAfterSeconds: undefined,
      attempts: [] as ProviderAttempt[],
    };
  }
  if (error instanceof OpenAIAdapterError) {
    return {
      code: error.code,
      retryable: error.retryable,
      status: error.status,
      retryAfterSeconds: error.retryAfterSeconds,
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
    retryAfterSeconds: undefined,
    attempts,
  };
}

function acceptedAttemptBudgetExhausted(
  attempts: readonly ProviderAttempt[],
  route: OpenAIRouteSnapshot,
): boolean {
  return attempts.some((attempt) => attempt.attemptNumber >= route.maxAttempts);
}

function preparedAttemptRequiresReconciliation(code: string): boolean {
  return code === "OPENAI_PROVIDER_RECONCILIATION_REQUIRED" ||
    code === "CAPTURED_PROVIDER_ATTEMPT_RECONCILIATION_REQUIRED";
}

function providerCompletionRequiresReconciliation(code: string): boolean {
  return code === "CAPTURED_PROVIDER_COMPLETION_RECONCILIATION_REQUIRED";
}

export async function runCapturedDocumentOperation(params: {
  userId: string;
  body: CapturedOperationBody;
  environment: CapturedOperationEnvironment;
  gateway: CapturedOperationGateway;
  executionMode?: CapturedOperationExecutionMode;
  signal?: AbortSignal;
  provider?: CapturedProvider;
}): Promise<CapturedOperationRunnerResult> {
  const provider = params.provider ?? routeRequest;
  let operation: OperationState | null = null;
  let leaseToken: string | null = null;

  try {
    const requestedAction = text(params.body.action, 20).toLowerCase();
    let accepted: AcceptedExecution;
    if (requestedAction === "resume") {
      const requestedOperationId = uuid(params.body.operation_id);
      // Every other resume field is deliberately ignored. Only the protected
      // service RPC may reconstruct the privileged accepted snapshot.
      accepted = await loadAcceptedExecution(
        params.gateway,
        params.userId,
        requestedOperationId,
      );
      operation = await rpcState(
        params.gateway,
        "accept_captured_document_operation",
        acceptanceArgs(params.userId, accepted),
      );
      if (
        !operation.idempotent_replay ||
        operation.operation_id !== requestedOperationId
      ) {
        throw new CapturedOperationRpcError(
          "CAPTURED_OPERATION_RESUME_CONFLICT",
          "accept_captured_document_operation",
        );
      }
    } else {
      const outcomeId = uuid(params.body.outcome_id);
      const documentId = uuid(params.body.document_id);
      const templateId = text(params.body.template_id, 120).toLowerCase();
      const title = text(params.body.title, 240);
      const idempotencyKey = text(params.body.generation_request_id, 128);
      const inputRevision = positiveInteger(params.body.input_revision, 1);
      const locale = text(params.body.locale, 40) || "en-AU";
      const jurisdiction = text(params.body.jurisdiction, 40) || "AU";
      if (!title) {
        throw new CapturedOperationInputError(
          "CAPTURED_DOCUMENT_TITLE_INVALID",
        );
      }
      if (!idempotencyKey) {
        throw new CapturedOperationInputError(
          "CAPTURED_IDEMPOTENCY_KEY_REQUIRED",
        );
      }

      const initialPlan = planCapturedInputs(
        templateId,
        params.body.input_values,
      );
      operation = await rpcState(
        params.gateway,
        "accept_assigned_captured_document_operation",
        {
          p_user_id: params.userId,
          p_outcome_id: outcomeId,
          p_document_id: documentId,
          p_title: title,
          p_environment: params.environment.environment,
          p_workflow: WORKFLOW,
          p_template_id: initialPlan.templateId,
          p_benchmark_version:
            initialPlan.template.qualityBenchmark.benchmarkVersion,
          p_pipeline_version: CURRENT_PIPELINE_VERSION,
          p_input_revision: inputRevision,
          p_idempotency_key: idempotencyKey,
          p_input_values: initialPlan.inputValues,
          p_source_snapshot: initialPlan.sourceSnapshot,
          p_evidence_snapshot: initialPlan.evidenceSnapshot,
          p_locale: locale,
          p_jurisdiction: jurisdiction,
          p_safe_section_keys: initialPlan.safeSectionKeys,
          p_blocked_section_keys: initialPlan.blockedSectionKeys,
          p_unresolved_input_keys: initialPlan.unresolvedInputKeys,
          p_confirmations: initialPlan.confirmations,
          p_operation_ttl_seconds: OPERATION_TTL_SECONDS,
        },
      );
      accepted = await loadAcceptedExecution(
        params.gateway,
        params.userId,
        operation.operation_id,
      );
    }

    if (
      operation.operation_id !== accepted.operationId ||
      operation.document_id !== accepted.documentId ||
      operation.routing_version !== accepted.routingVersion ||
      canonicalJson(operation.route_snapshot) !==
        canonicalJson(accepted.routeSnapshot)
    ) {
      throw new CapturedOperationRpcError(
        "CAPTURED_ACCEPTED_SNAPSHOT_IDENTITY_MISMATCH",
        "accept_captured_document_operation",
      );
    }
    const plan = accepted.plan;

    // Validate both routes from the immutable accepted snapshot before the
    // first provider call. The adapter receives these exact effective routes;
    // it never re-selects a model from the current environment for this work.
    const generationRoute = acceptedRoute(operation, accepted, plan, "deep");
    const reviewRoute = acceptedRoute(operation, accepted, plan, "review");

    const resumableStatus = [
      "accepted",
      "generating",
      "validating",
      "persisting",
      "awaiting_capacity",
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

    if (params.executionMode === "accept_only") {
      return {
        status: 202,
        body: {
          ...publicState(operation),
          questions: plan.blockedSectionKeys.length > 0 ? questions(plan) : [],
          reconnect:
            `/api/document-operation?operation_id=${operation.operation_id}`,
          retryable: false,
        },
      };
    }

    const leaseOwner =
      `edge:document-operation:${accepted.pipelineVersion}:${crypto.randomUUID()}`;
    const renewLease = async (): Promise<void> => {
      if (!operation) {
        throw new CapturedOperationRpcError(
          "CAPTURED_OPERATION_STATE_MISSING",
          "claim_captured_document_operation",
        );
      }
      const priorLeaseToken = leaseToken;
      const capacityResume = !priorLeaseToken &&
        operation.status === "awaiting_capacity";
      const rpc = priorLeaseToken
        ? "renew_captured_document_operation_lease"
        : capacityResume
        ? "resume_captured_document_operation_from_capacity"
        : "claim_captured_document_operation";
      const claimed = await rpcState(
        params.gateway,
        rpc,
        priorLeaseToken
          ? {
            p_operation_id: operation.operation_id,
            p_lease_token: priorLeaseToken,
            p_lease_seconds: 300,
          }
          : {
            p_operation_id: operation.operation_id,
            p_expected_operation_revision: operation.operation_revision,
            p_lease_owner: leaseOwner,
            p_lease_seconds: 300,
          },
        operation,
      );
      if (capacityResume && claimed.capacity_resume_deferred === true) {
        operation = claimed;
        leaseToken = null;
        operation.lease_token = null;
        throw new CapturedCapacityResumeDeferredError();
      }
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

    const reconcilePreparedAttempt = async (
      reconciliationCode: string,
    ): Promise<void> => {
      await renewLease();
      if (!operation || !leaseToken) {
        throw new CapturedOperationRpcError(
          "CAPTURED_OPERATION_LEASE_MISSING",
          "reconcile_captured_document_provider_attempt",
        );
      }
      operation = await rpcState(
        params.gateway,
        "reconcile_captured_document_provider_attempt",
        {
          p_operation_id: operation.operation_id,
          p_expected_operation_revision: operation.operation_revision,
          p_lease_token: leaseToken,
          p_error_code: reconciliationCode.slice(0, 120),
        },
        operation,
      );
      operation.lease_token = leaseToken;
    };

    const terminalizeCancellation = async (
      cancellationCode: string,
      reconciliationCode: string,
    ): Promise<CapturedOperationRunnerResult> => {
      await reconcilePreparedAttempt(reconciliationCode);
      if (!operation || !leaseToken) {
        throw new CapturedOperationRpcError(
          "CAPTURED_OPERATION_LEASE_MISSING",
          "cancel_captured_document_operation",
        );
      }
      operation = await rpcState(
        params.gateway,
        "cancel_captured_document_operation",
        {
          p_operation_id: operation.operation_id,
          p_expected_operation_revision: operation.operation_revision,
          p_lease_token: leaseToken,
          p_cancellation_code: cancellationCode,
        },
        operation,
      );
      leaseToken = null;
      operation.lease_token = null;
      return {
        status: 409,
        body: { ...publicState(operation), retryable: false },
      };
    };

    const finishRequestedCancellation = async (
      reconciliationCode: string,
    ): Promise<CapturedOperationRunnerResult | null> => {
      if (!operation?.cancellation_requested) return null;
      return await terminalizeCancellation(
        operation.cancellation_code || "owner_requested",
        reconciliationCode,
      );
    };

    const attemptLifecycle = (
      stage: "generation" | "review",
      route: OpenAIRouteSnapshot,
    ): ProviderAttemptLifecycle => ({
      prepare: async ({ startedAt, requestSha256 }) => {
        await renewLease();
        if (operation?.cancellation_requested) {
          throw new CapturedOperationRpcError(
            "CAPTURED_CANCELLATION_REQUESTED",
            "record_captured_document_provider_attempt",
          );
        }
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
            "complete_captured_document_provider_attempt",
          );
        }
        const completionArgs = {
          p_operation_id: operation.operation_id,
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
        };

        const commitCompletion = async (): Promise<void> => {
          if (!operation || !leaseToken) {
            throw new CapturedOperationRpcError(
              "CAPTURED_OPERATION_LEASE_MISSING",
              "complete_captured_document_provider_attempt",
            );
          }
          operation = await rpcState(
            params.gateway,
            "complete_captured_document_provider_attempt",
            completionArgs,
            operation,
          );
          operation.lease_token = leaseToken;
        };

        try {
          await commitCompletion();
          return;
        } catch (firstError) {
          if (!(firstError instanceof CapturedOperationRpcError)) {
            throw firstError;
          }
        }

        // A committed completion can lose its HTTP acknowledgement.  Renewing
        // the token-bound lease and replaying the exact same immutable attempt
        // is safe because the database completion RPC rejects conflicts and
        // returns an idempotent replay for an exact terminal attempt.
        try {
          await renewLease();
          await commitCompletion();
          return;
        } catch (retryError) {
          if (!(retryError instanceof CapturedOperationRpcError)) {
            throw retryError;
          }
        }

        // If both acknowledgements were lost, re-read the durable acceptance
        // boundary.  An exact succeeded checkpoint proves the transaction
        // committed; anything else remains non-terminal for operator-safe
        // reconciliation and must not release the allowance or redispatch.
        try {
          if (!operation || !leaseToken) {
            throw new CapturedOperationRpcError(
              "CAPTURED_OPERATION_LEASE_MISSING",
              "complete_captured_document_provider_attempt",
            );
          }
          const activeToken = leaseToken;
          const replayed = await rpcState(
            params.gateway,
            "accept_captured_document_operation",
            acceptanceArgs(params.userId, accepted),
            operation,
          );
          const checkpoint = stage === "generation"
            ? replayed.generation_checkpoint
            : replayed.review_checkpoint;
          if (
            attempt.status === "succeeded" &&
            structuredOutput !== null &&
            canonicalJson(checkpoint) === canonicalJson(structuredOutput)
          ) {
            operation = replayed;
            leaseToken = activeToken;
            operation.lease_token = activeToken;
            return;
          }
        } catch (reloadError) {
          if (!(reloadError instanceof CapturedOperationRpcError)) {
            throw reloadError;
          }
        }

        throw new CapturedOperationRpcError(
          "CAPTURED_PROVIDER_COMPLETION_RECONCILIATION_REQUIRED",
          "complete_captured_document_provider_attempt",
        );
      },
    });

    const deferForCapacity = async (
      semanticRoute: "deep" | "review",
      retryAfterSeconds: number | undefined,
    ): Promise<CapturedOperationRunnerResult> => {
      if (!operation || !leaseToken) {
        throw new CapturedOperationRpcError(
          "CAPTURED_OPERATION_LEASE_MISSING",
          "defer_captured_document_operation_for_capacity",
        );
      }
      const boundedRetry = Number.isInteger(retryAfterSeconds) &&
          retryAfterSeconds! >= 1 && retryAfterSeconds! <= 1800
        ? retryAfterSeconds!
        : 30;
      operation = await rpcState(
        params.gateway,
        "defer_captured_document_operation_for_capacity",
        {
          p_operation_id: operation.operation_id,
          p_expected_operation_revision: operation.operation_revision,
          p_operation_lease_token: leaseToken,
          p_semantic_route: semanticRoute,
          p_retry_after_seconds: boundedRetry,
        },
        operation,
      );
      leaseToken = null;
      operation.lease_token = null;
      return {
        status: 202,
        body: {
          ...publicState(operation),
          retryable: true,
          reconnect:
            `/api/document-operation?operation_id=${operation.operation_id}`,
        },
      };
    };

    await renewLease();
    if (!leaseToken) {
      throw new CapturedOperationRpcError(
        "CAPTURED_OPERATION_LEASE_MISSING",
        "claim_captured_document_operation",
      );
    }
    const activeLeaseToken = leaseToken;

    const cancelledBeforeDispatch = await finishRequestedCancellation(
      "CAPTURED_PROVIDER_ATTEMPT_CANCELLED_BEFORE_DISPATCH",
    );
    if (cancelledBeforeDispatch) return cancelledBeforeDispatch;

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

    let generationOutput = structuredCheckpoint(
      operation.generation_checkpoint,
    );
    const reviewCheckpoint = structuredCheckpoint(operation.review_checkpoint);
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
          ...routePrompt(plan, accepted, "document", generationRoute),
          signal: params.signal,
          attemptLifecycle: attemptLifecycle("generation", generationRoute),
          metadata: {
            operation_id: operation.operation_id,
            ledger_version: accepted.ledgerVersion,
            routing_version: generationRoute.routingVersion,
            template_id: plan.templateId,
          },
        });
        generationOutput = generated.structured ?? null;
      } catch (error) {
        const info = providerErrorInfo(error);
        await renewLease();
        const requestedCancellation = await finishRequestedCancellation(
          info.code,
        );
        if (requestedCancellation) return requestedCancellation;
        if (info.code === "OPENAI_CANCELLED") {
          return await terminalizeCancellation(
            "client_cancelled",
            "OPENAI_CANCELLED",
          );
        }
        if (info.code === "OPENAI_AWAITING_CAPACITY") {
          return await deferForCapacity("deep", info.retryAfterSeconds);
        }
        if (providerCompletionRequiresReconciliation(info.code)) {
          return {
            status: 503,
            body: {
              ...publicState(operation),
              retryable: true,
              error: {
                code: info.code,
                message:
                  "TED is confirming the durable provider result before continuing.",
                safe_next_action:
                  "Reconnect to this same operation; do not start another document.",
              },
            },
          };
        }
        if (preparedAttemptRequiresReconciliation(info.code)) {
          await reconcilePreparedAttempt(info.code);
        }
        const attemptBudgetExhausted = acceptedAttemptBudgetExhausted(
          info.attempts,
          generationRoute,
        );
        const retryable = info.retryable && !attemptBudgetExhausted;
        const errorCode = attemptBudgetExhausted
          ? "OPENAI_ACCEPTED_ATTEMPT_BUDGET_EXHAUSTED"
          : info.code;
        operation = await advance(
          params.gateway,
          operation,
          activeLeaseToken,
          retryable ? "retryable_failure" : "terminal_failure",
          {
            provider_status: info.status,
            accepted_attempt_budget_exhausted: attemptBudgetExhausted,
          },
          {
            code: errorCode,
            message: "TED could not finish this document operation.",
            next: retryable
              ? "Resume this operation without creating a new document."
              : "Review the supplied facts before starting a new operation.",
          },
        );
        return {
          status: retryable ? 503 : 422,
          body: { ...publicState(operation), retryable },
        };
      }
    }

    const cancelledAfterGeneration = await finishRequestedCancellation(
      "CAPTURED_PROVIDER_GENERATION_COMPLETED_AFTER_CANCELLATION",
    );
    if (cancelledAfterGeneration) return cancelledAfterGeneration;

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
          ...routePrompt(plan, accepted, "review", reviewRoute, {
            output: generationOutput,
            issues: evaluated.validation.issues,
          }),
          signal: params.signal,
          attemptLifecycle: attemptLifecycle("review", reviewRoute),
          metadata: {
            operation_id: operation.operation_id,
            stage_id: "conditional-review",
            ledger_version: accepted.ledgerVersion,
            routing_version: reviewRoute.routingVersion,
            template_id: plan.templateId,
          },
        });
      } catch (error) {
        const info = providerErrorInfo(error);
        await renewLease();
        const requestedCancellation = await finishRequestedCancellation(
          info.code,
        );
        if (requestedCancellation) return requestedCancellation;
        if (info.code === "OPENAI_CANCELLED") {
          return await terminalizeCancellation(
            "client_cancelled",
            "OPENAI_CANCELLED",
          );
        }
        if (info.code === "OPENAI_AWAITING_CAPACITY") {
          return await deferForCapacity("review", info.retryAfterSeconds);
        }
        if (providerCompletionRequiresReconciliation(info.code)) {
          return {
            status: 503,
            body: {
              ...publicState(operation),
              retryable: true,
              error: {
                code: info.code,
                message:
                  "TED is confirming the durable review result before continuing.",
                safe_next_action:
                  "Reconnect to this same operation; do not start another review.",
              },
            },
          };
        }
        if (preparedAttemptRequiresReconciliation(info.code)) {
          await reconcilePreparedAttempt(info.code);
        }
        const attemptBudgetExhausted = acceptedAttemptBudgetExhausted(
          info.attempts,
          reviewRoute,
        );
        const retryable = info.retryable && !attemptBudgetExhausted;
        const errorCode = attemptBudgetExhausted
          ? "OPENAI_ACCEPTED_ATTEMPT_BUDGET_EXHAUSTED"
          : info.code;
        operation = await advance(
          params.gateway,
          operation,
          activeLeaseToken,
          retryable ? "retryable_failure" : "terminal_failure",
          {
            stage: "conditional_review",
            accepted_attempt_budget_exhausted: attemptBudgetExhausted,
          },
          {
            code: errorCode,
            message: "TED could not complete the required document review.",
            next: retryable
              ? "Resume this operation without duplicating the allowance."
              : "Review the supplied facts before starting a new operation.",
          },
        );
        return {
          status: retryable ? 503 : 422,
          body: { ...publicState(operation), retryable },
        };
      }
      evaluated = validateCapturedDocumentOutput(plan, reviewed.structured);
      const cancelledAfterReview = await finishRequestedCancellation(
        "CAPTURED_PROVIDER_REVIEW_COMPLETED_AFTER_CANCELLATION",
      );
      if (cancelledAfterReview) return cancelledAfterReview;
    }

    await renewLease();
    const cancelledBeforePersistence = await finishRequestedCancellation(
      "CAPTURED_PROVIDER_OUTPUT_DISCARDED_AFTER_CANCELLATION",
    );
    if (cancelledBeforePersistence) return cancelledBeforePersistence;

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
    await renewLease();
    const cancelledAtFinalization = await finishRequestedCancellation(
      "CAPTURED_PROVIDER_OUTPUT_DISCARDED_AFTER_CANCELLATION",
    );
    if (cancelledAtFinalization) return cancelledAtFinalization;
    try {
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
    } catch (error) {
      if (
        error instanceof CapturedOperationRpcError &&
        error.code === "CAPTURED_CANCELLATION_RECONCILIATION_REQUIRED"
      ) {
        await renewLease();
        const reconciledCancellation = await finishRequestedCancellation(
          "CAPTURED_PROVIDER_OUTPUT_DISCARDED_AFTER_CANCELLATION",
        );
        if (reconciledCancellation) return reconciledCancellation;
      }
      throw error;
    }

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
    if (error instanceof CapturedCapacityResumeDeferredError) {
      return {
        status: 202,
        body: {
          ...(operation ? publicState(operation) : {}),
          retryable: true,
          reconnect: operation
            ? `/api/document-operation?operation_id=${operation.operation_id}`
            : undefined,
        },
      };
    }
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
      const capacityConfigurationUnavailable =
        error.code === "CAPTURED_OPENAI_CAPACITY_CONFIGURATION_UNAVAILABLE";
      const rolloutNotAssigned = error.code === "CAPTURED_ROLLOUT_NOT_ASSIGNED";
      const conflict = activationDisabled || rolloutNotAssigned ||
        error.code === "CAPTURED_PIPELINE_VERSION_UNSUPPORTED" ||
        error.code === "CAPTURED_OPERATION_RESUME_CONFLICT" ||
        error.code === "CAPTURED_OPERATION_RESUME_STATUS_INVALID";
      const retryable = !conflict && !capacityConfigurationUnavailable &&
        !error.code.startsWith("CAPTURED_ACCEPTED_") &&
        error.code !== "CAPTURED_CANCELLATION_REQUESTED";
      return {
        status: conflict ? 409 : capacityConfigurationUnavailable ? 503 : 500,
        body: {
          error: {
            code: error.code,
            message: activationDisabled || rolloutNotAssigned
              ? "This captured document workflow is not active for this account."
              : capacityConfigurationUnavailable
              ? "This document workflow is not ready for generation capacity."
              : "TED could not persist the document operation safely.",
          },
          retryable,
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
