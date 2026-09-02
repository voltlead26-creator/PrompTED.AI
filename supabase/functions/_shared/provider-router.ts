// PrompTED's sole active model boundary.
//
// Every active inference request is an OpenAI Responses request selected by a
// semantic route. Historical provider names remain data provenance only and
// are never selectable here.

import {
  type OpenAIRouteSnapshot,
  validateOpenAIRouteSnapshot,
} from "../../../packages/shared/src/document-operation.ts";
import {
  claimOpenAICapacity,
  claimUserProviderDispatch,
  completeUserProviderDispatch,
  inspectLegacyModelCheckpointBeforeCapacity,
  markLegacyModelAttemptDispatched,
  markOpenAICapacityDispatched,
  ModelCallContextError,
  ModelCapacityError,
  type OpenAICapacityClaim,
  prepareLegacyModelAttempt,
  type ProviderDispatchClaim,
  recordLegacyModelAttempt,
  releaseOpenAICapacity,
} from "./model-call-context.ts";
import {
  type LegacyModelCheckpoint,
  type LegacyProviderResultEnvelope,
  ModelCallAccountingError,
} from "./cost-tracker.ts";

export type { OpenAIRouteSnapshot } from "../../../packages/shared/src/document-operation.ts";

export type OpenAISemanticRoute = "fast" | "deep" | "research" | "review";
export type OpenAIReasoningEffort = "low" | "medium" | "high";

export interface StrictOutputSchema {
  name: string;
  version?: string;
  schema: Record<string, unknown>;
}

export interface ProviderRequest {
  task: string;
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
  stream?: boolean;
  webSearch?: boolean;
  /** Legacy JSON parsing seam. Captured work must pass outputSchema instead. */
  requireJson?: boolean;
  outputSchema?: StrictOutputSchema;
  background?: boolean;
  metadata?: Record<string, string>;
  safetyIdentifier?: string;
  signal?: AbortSignal;
  /** Exact accepted route for durable captured work. Legacy callers omit it. */
  routeSnapshot?: OpenAIRouteSnapshot;
  /** Durable attempt lifecycle owned by the captured-operation boundary. */
  attemptLifecycle?: ProviderAttemptLifecycle;
  /** Stable caller-owned stage identity for non-captured model accounting. */
  logicalStageKey?: string;
}

export interface ProviderSource {
  id: string;
  title: string;
  url: string;
  type: "web";
}

export interface ProviderResponse {
  text: string;
  structured?: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  _provider: "openai";
  responseId: string;
  status: string;
  routeSnapshot: OpenAIRouteSnapshot;
  attempts: ProviderAttempt[];
  sources: ProviderSource[];
}

export interface ProviderAttempt {
  attemptNumber: number;
  startedAt: string;
  completedAt: string;
  status: "succeeded" | "failed" | "cancelled";
  responseId: string;
  inputTokens: number;
  outputTokens: number;
  providerStatus?: string;
  errorCode: string | null;
}

export interface ProviderAttemptPreparation {
  attemptNumber: number;
  clientRequestId: string;
  durableAdmissionId?: string;
}

export interface ProviderAttemptLifecycle {
  prepare(input: {
    localAttemptNumber: number;
    startedAt: string;
    requestSha256: string;
    routeSnapshot: OpenAIRouteSnapshot;
  }): Promise<ProviderAttemptPreparation>;
  complete(input: {
    attempt: ProviderAttempt;
    requestSha256: string;
    routeSnapshot: OpenAIRouteSnapshot;
    structuredOutput: Record<string, unknown> | null;
  }): Promise<void>;
}

export const USER_SAFE_ERROR = {
  error: {
    code: "TED_ERROR",
    message: "TED couldn't finish that just now. Please try again in a moment.",
  },
};

export class OpenAIAdapterError extends Error {
  readonly provider = "openai" as const;
  attempts: ProviderAttempt[] = [];

  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly retryable: boolean,
    public readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = "OpenAIAdapterError";
  }
}

function estimatedCapacityTokens(body: Record<string, unknown>): number {
  const encodedRequestBytes =
    new TextEncoder().encode(JSON.stringify(body)).byteLength;
  const outputBudget = Number(body.max_output_tokens ?? 0);
  // A BPE token cannot represent fewer than one encoded byte. Counting every
  // request byte as one token plus the full output budget and a small framing
  // allowance is intentionally conservative and cannot recreate the prior
  // bytes/3 under-reservation failure.
  const estimate = encodedRequestBytes + outputBudget + 256;
  if (!Number.isSafeInteger(estimate) || estimate > 2_000_000) {
    throw new OpenAIAdapterError(
      "OPENAI_CAPACITY_ESTIMATE_EXCEEDED",
      413,
      false,
    );
  }
  return Math.max(1, estimate);
}

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_ROUTING_VERSION = "routing.2026-08-pilot.1";
const HOSTED_DEPLOYMENT_ENVIRONMENTS = new Set([
  "production",
  "staging",
  "preview",
]);
const LOCAL_DEPLOYMENT_ENVIRONMENTS = new Set(["local", "test"]);
const REQUIRED_HOSTED_ROUTE_CONFIGURATION = [
  "OPENAI_FAST_MODEL",
  "OPENAI_DEEP_MODEL",
  "OPENAI_RESEARCH_MODEL",
  "OPENAI_REVIEW_MODEL",
  "OPENAI_ROUTING_VERSION",
] as const;
const HOSTED_ROUTE_VALUE_PATTERN = /^[a-z0-9][a-z0-9._-]{1,99}$/;

const TASK_ROUTES: Record<string, OpenAISemanticRoute> = {
  general: "fast",
  intent: "fast",
  clarify: "fast",
  recommend: "fast",
  explain: "fast",
  document: "deep",
  document_generation: "deep",
  checklist: "deep",
  edit: "deep",
  proofread: "deep",
  report: "deep",
  research: "research",
  job_match: "research",
  review: "review",
};

function env(name: string): string | undefined {
  const value = Deno.env.get(name)?.trim();
  return value || undefined;
}

function assertHostedRouteConfiguration(): void {
  const deploymentEnvironment = env("PROMPTED_DEPLOYMENT_ENV")?.toLowerCase();
  if (
    !deploymentEnvironment ||
    (!LOCAL_DEPLOYMENT_ENVIRONMENTS.has(deploymentEnvironment) &&
      !HOSTED_DEPLOYMENT_ENVIRONMENTS.has(deploymentEnvironment))
  ) {
    throw new OpenAIAdapterError("OPENAI_DEPLOYMENT_ENV_INVALID", 503, false);
  }
  if (LOCAL_DEPLOYMENT_ENVIRONMENTS.has(deploymentEnvironment)) return;
  if (REQUIRED_HOSTED_ROUTE_CONFIGURATION.some((name) => !env(name))) {
    throw new OpenAIAdapterError(
      "OPENAI_HOSTED_ROUTING_CONFIG_MISSING",
      503,
      false,
    );
  }
  if (
    REQUIRED_HOSTED_ROUTE_CONFIGURATION.some((name) =>
      !HOSTED_ROUTE_VALUE_PATTERN.test(env(name) ?? "")
    )
  ) {
    throw new OpenAIAdapterError(
      "OPENAI_HOSTED_ROUTING_CONFIG_INVALID",
      503,
      false,
    );
  }
}

function modelFor(route: OpenAISemanticRoute): string {
  switch (route) {
    case "fast":
      return env("OPENAI_FAST_MODEL") ?? "gpt-5.6-luna";
    case "deep":
      return env("OPENAI_DEEP_MODEL") ?? "gpt-5.6-sol";
    case "research":
      return env("OPENAI_RESEARCH_MODEL") ?? "gpt-5.6-terra";
    case "review":
      return env("OPENAI_REVIEW_MODEL") ?? "gpt-5.6-sol";
  }
}

function reasoningFor(route: OpenAISemanticRoute): OpenAIReasoningEffort {
  switch (route) {
    case "fast":
      return "low";
    case "deep":
    case "research":
      return "medium";
    case "review":
      return "high";
  }
}

function semanticRouteForTask(task: string): OpenAISemanticRoute {
  const normalizedTask = task.trim().toLowerCase().replaceAll("-", "_");
  const route = TASK_ROUTES[normalizedTask];
  if (!route) {
    throw new OpenAIAdapterError("OPENAI_UNKNOWN_TASK", 400, false);
  }
  return route;
}

export function resolveOpenAIRoute(task: string): OpenAIRouteSnapshot {
  assertHostedRouteConfiguration();
  const route = semanticRouteForTask(task);
  return {
    provider: "openai",
    semanticRoute: route,
    model: modelFor(route),
    reasoningEffort: reasoningFor(route),
    routingVersion: env("OPENAI_ROUTING_VERSION") ?? DEFAULT_ROUTING_VERSION,
    structuredOutputSchemaVersion: "text.compatibility.v1",
    allowedTools: [],
    timeoutMs: timeoutMs(route),
    maxAttempts: 2,
    background: false,
    store: false,
    fallback: null,
  };
}

function outputSchemaVersion(request: ProviderRequest): string {
  return request.outputSchema
    ? (request.outputSchema.version ?? request.outputSchema.name)
    : request.requireJson
    ? "json-object.compatibility.v1"
    : "text.compatibility.v1";
}

function effectiveRouteSnapshot(request: ProviderRequest): OpenAIRouteSnapshot {
  assertHostedRouteConfiguration();
  const semanticRoute = semanticRouteForTask(request.task);
  const schemaVersion = outputSchemaVersion(request);
  const allowedTools = request.webSearch ? (["web_search"] as const) : [];

  if (!request.routeSnapshot) {
    const configured = resolveOpenAIRoute(request.task);
    return {
      ...configured,
      structuredOutputSchemaVersion: schemaVersion,
      allowedTools,
    };
  }

  const accepted = request.routeSnapshot;
  const validationIssues = validateOpenAIRouteSnapshot(accepted);
  if (
    validationIssues.length > 0 ||
    accepted.semanticRoute !== semanticRoute ||
    accepted.structuredOutputSchemaVersion !== schemaVersion ||
    JSON.stringify(accepted.allowedTools) !== JSON.stringify(allowedTools)
  ) {
    throw new OpenAIAdapterError("OPENAI_ACCEPTED_ROUTE_INVALID", 409, false);
  }
  return accepted;
}

function validateSchema(output: StrictOutputSchema): void {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(output.name)) {
    throw new OpenAIAdapterError("OPENAI_INVALID_SCHEMA_NAME", 500, false);
  }
  if (output.schema.type !== "object") {
    throw new OpenAIAdapterError("OPENAI_INVALID_SCHEMA_ROOT", 500, false);
  }
  if (output.schema.additionalProperties !== false) {
    throw new OpenAIAdapterError("OPENAI_SCHEMA_MUST_BE_CLOSED", 500, false);
  }
  if (
    output.version !== undefined &&
    !/^[a-zA-Z0-9._-]{1,128}$/.test(output.version)
  ) {
    throw new OpenAIAdapterError("OPENAI_INVALID_SCHEMA_VERSION", 500, false);
  }
}

function safeMetadata(
  metadata: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!metadata) return undefined;
  const allowed = new Set([
    "operation_id",
    "stage_id",
    "ledger_version",
    "routing_version",
    "template_id",
  ]);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!allowed.has(key)) continue;
    const normalized = value.trim().slice(0, 256);
    if (normalized) result[key] = normalized;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function maxOutputTokens(value: number | undefined): number {
  if (value === undefined) return 2_400;
  if (!Number.isInteger(value) || value < 1 || value > 128_000) {
    throw new OpenAIAdapterError(
      "OPENAI_INVALID_MAX_OUTPUT_TOKENS",
      400,
      false,
    );
  }
  return value;
}

export function buildOpenAIRequestBody(
  request: ProviderRequest,
): Record<string, unknown> {
  if (!request.systemPrompt.trim() || request.messages.length === 0) {
    throw new OpenAIAdapterError("OPENAI_INVALID_INPUT", 400, false);
  }
  if (request.stream) {
    throw new OpenAIAdapterError("OPENAI_STREAM_NOT_DURABLE", 400, false);
  }
  if (request.background) {
    throw new OpenAIAdapterError("OPENAI_BACKGROUND_NOT_ACTIVATED", 409, false);
  }

  const route = effectiveRouteSnapshot(request);
  if (request.webSearch && route.semanticRoute !== "research") {
    throw new OpenAIAdapterError("OPENAI_TOOL_NOT_ALLOWED", 400, false);
  }

  const body: Record<string, unknown> = {
    model: route.model,
    instructions: request.systemPrompt,
    input: request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    max_output_tokens: maxOutputTokens(request.maxTokens),
    reasoning: { effort: route.reasoningEffort },
    store: false,
  };

  if (request.outputSchema) {
    validateSchema(request.outputSchema);
    body.text = {
      format: {
        type: "json_schema",
        name: request.outputSchema.name,
        schema: request.outputSchema.schema,
        strict: true,
      },
    };
  } else if (request.requireJson) {
    // Historical callers remain readable during strangulation. Every captured
    // cohort caller must use outputSchema and therefore strict mode above.
    body.text = { format: { type: "json_object" } };
  }

  if (request.webSearch) {
    body.tools = [{ type: "web_search" }];
    body.include = ["web_search_call.action.sources"];
  }
  const metadata = safeMetadata(request.metadata);
  if (metadata) body.metadata = metadata;
  if (request.safetyIdentifier) {
    const identifier = request.safetyIdentifier.trim();
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(identifier)) {
      throw new OpenAIAdapterError(
        "OPENAI_INVALID_SAFETY_IDENTIFIER",
        400,
        false,
      );
    }
    body.safety_identifier = identifier;
  }

  return body;
}

export function isRetryableProviderStatus(status: number): boolean {
  // Retry only when the provider explicitly rejected the request before useful
  // work could be returned. Network failures, client timeouts and 5xx responses
  // are ambiguous without a retrievable provider operation identity.
  return status === 425 || status === 429;
}

function providerOutcomeIsAmbiguous(error: OpenAIAdapterError): boolean {
  return (
    error.code === "OPENAI_TIMEOUT" ||
    error.code === "OPENAI_NETWORK_ERROR" ||
    (error.code === "OPENAI_UPSTREAM_ERROR" &&
      (error.status === 408 || error.status >= 500))
  );
}

function retryDelayMs(): number {
  const configured = Number(env("OPENAI_RETRY_BASE_MS") ?? "250");
  return Number.isFinite(configured) && configured >= 0
    ? Math.min(configured, 2_000)
    : 250;
}

function extractText(data: Record<string, unknown>): string {
  if (typeof data.output_text === "string") return data.output_text;
  if (!Array.isArray(data.output)) return "";
  return data.output
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const content = (item as Record<string, unknown>).content;
      if (!Array.isArray(content)) return [];
      return content.flatMap((part) => {
        if (!part || typeof part !== "object") return [];
        const record = part as Record<string, unknown>;
        return record.type === "output_text" && typeof record.text === "string"
          ? [record.text]
          : [];
      });
    })
    .join("");
}

function tokenCount(data: Record<string, unknown>, name: string): number {
  const usage = data.usage && typeof data.usage === "object"
    ? (data.usage as Record<string, unknown>)
    : {};
  return typeof usage[name] === "number" && Number.isFinite(usage[name])
    ? (usage[name] as number)
    : 0;
}

function normalizedResearchSources(
  data: Record<string, unknown>,
  route: OpenAIRouteSnapshot,
): ProviderSource[] {
  if (route.semanticRoute !== "research" || !Array.isArray(data.output)) {
    return [];
  }

  const seen = new Set<string>();
  const sources: ProviderSource[] = [];
  for (const item of data.output) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (record.type !== "web_search_call") continue;
    const action = record.action && typeof record.action === "object" &&
        !Array.isArray(record.action)
      ? (record.action as Record<string, unknown>)
      : null;
    if (!action || !Array.isArray(action.sources)) continue;

    for (const value of action.sources) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const source = value as Record<string, unknown>;
      if (typeof source.url !== "string") continue;
      let parsed: URL;
      try {
        parsed = new URL(source.url);
      } catch {
        continue;
      }
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
        continue;
      }
      parsed.hash = "";
      const url = parsed.href;
      if (seen.has(url)) continue;
      seen.add(url);
      const suppliedId = typeof source.id === "string" ? source.id.trim() : "";
      const suppliedTitle = typeof source.title === "string"
        ? source.title.trim()
        : "";
      sources.push({
        id: suppliedId.slice(0, 255) || url,
        title: suppliedTitle.slice(0, 500) || parsed.hostname,
        url,
        type: "web",
      });
    }
  }
  return sources;
}

async function sha256Json(value: Record<string, unknown>): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
}

function parseStructured(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // The caller receives a stable code; never log private model output.
  }
  throw new OpenAIAdapterError("OPENAI_INVALID_STRUCTURED_OUTPUT", 502, false);
}

function replayLegacyCheckpoint(
  checkpoint: LegacyModelCheckpoint,
  request: ProviderRequest,
  routeSnapshot: OpenAIRouteSnapshot,
): ProviderResponse {
  const envelope = checkpoint.response_envelope;
  const usage = checkpoint.usage ?? {};
  if (
    checkpoint.state !== "replay" ||
    !envelope ||
    envelope.version !== "legacy-provider-result.1" ||
    typeof envelope.text !== "string" ||
    !Array.isArray(envelope.sources) ||
    !sameRouteSnapshot(envelope.route_snapshot, routeSnapshot) ||
    usage.provider_status !== "completed"
  ) {
    throw new OpenAIAdapterError("OPENAI_CHECKPOINT_MALFORMED", 409, false);
  }
  const text = envelope.text;
  if (!text.trim()) {
    throw new OpenAIAdapterError("OPENAI_EMPTY_RESPONSE", 502, false);
  }
  const structured = request.outputSchema || request.requireJson
    ? parseStructured(text)
    : undefined;
  if (
    structured &&
    JSON.stringify(canonicalJson(structured)) !==
      JSON.stringify(canonicalJson(envelope.structured))
  ) {
    throw new OpenAIAdapterError("OPENAI_CHECKPOINT_MALFORMED", 409, false);
  }
  if (usage.attempt_status === "failed") {
    const retainedCode = String(usage.error_code ?? "");
    if (!/^OPENAI_[A-Z0-9_]+$/.test(retainedCode)) {
      throw new OpenAIAdapterError("OPENAI_CHECKPOINT_MALFORMED", 409, false);
    }
    throw new OpenAIAdapterError(retainedCode, 502, false);
  }
  if (usage.attempt_status !== "succeeded") {
    throw new OpenAIAdapterError("OPENAI_CHECKPOINT_MALFORMED", 409, false);
  }
  const attempt: ProviderAttempt = {
    attemptNumber: Number(checkpoint.attempt_number),
    startedAt: String(usage.started_at ?? ""),
    completedAt: String(usage.completed_at ?? ""),
    status: usage.attempt_status === "succeeded" ? "succeeded" : "failed",
    responseId: String(usage.provider_response_id ?? ""),
    inputTokens: Number(usage.input_tokens ?? 0),
    outputTokens: Number(usage.output_tokens ?? 0),
    providerStatus: "completed",
    errorCode: usage.error_code === null
      ? null
      : String(usage.error_code ?? ""),
  };
  return {
    text,
    structured,
    inputTokens: attempt.inputTokens,
    outputTokens: attempt.outputTokens,
    _provider: "openai",
    responseId: attempt.responseId,
    status: "completed",
    routeSnapshot,
    attempts: [attempt],
    sources: envelope.sources,
  };
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalJson(item)]),
    );
  }
  return value;
}

function sameRouteSnapshot(
  left: OpenAIRouteSnapshot,
  right: OpenAIRouteSnapshot,
): boolean {
  return JSON.stringify(canonicalJson(left)) ===
    JSON.stringify(canonicalJson(right));
}

function checkpointBlockError(checkpoint: LegacyModelCheckpoint): Error {
  switch (checkpoint.state) {
    case "attempt_limit":
      return new OpenAIAdapterError("OPENAI_STAGE_ATTEMPT_LIMIT", 409, false);
    case "attempt_unresolved":
      return new OpenAIAdapterError(
        "OPENAI_PROVIDER_RECONCILIATION_REQUIRED",
        409,
        false,
      );
    case "in_progress":
      return new OpenAIAdapterError("OPENAI_MODEL_CALL_IN_PROGRESS", 409, true);
    case "terminal_cancelled":
      return abortError();
    case "terminal_error": {
      const usage = checkpoint.usage ?? {};
      const code = String(usage.error_code ?? "OPENAI_UNKNOWN_ERROR");
      const providerStatus = String(usage.provider_status ?? "");
      const contract = retainedErrorContract(code, providerStatus);
      return new OpenAIAdapterError(
        /^OPENAI_[A-Z0-9_]+$/.test(code) ? code : "OPENAI_UNKNOWN_ERROR",
        contract.status,
        contract.retryable,
      );
    }
    case "completed_result_unavailable":
      return new OpenAIAdapterError(
        "OPENAI_COMPLETED_RESULT_UNAVAILABLE",
        409,
        false,
      );
    case "awaiting_reconciliation":
      return new OpenAIAdapterError(
        "OPENAI_PROVIDER_RECONCILIATION_REQUIRED",
        409,
        false,
      );
    default:
      return new OpenAIAdapterError(
        "OPENAI_CHECKPOINT_READ_FAILED",
        500,
        false,
      );
  }
}

function parseRetryAfterSeconds(
  value: string | null,
  nowMs = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(1_800, Math.max(1, Math.ceil(seconds)));
  }
  const retryAtMs = Date.parse(trimmed);
  if (!Number.isFinite(retryAtMs)) return undefined;
  return Math.min(1_800, Math.max(1, Math.ceil((retryAtMs - nowMs) / 1_000)));
}

function responseError(
  status: number,
  retryAfterHeader: string | null,
): OpenAIAdapterError {
  const retryAfterSeconds = parseRetryAfterSeconds(retryAfterHeader) ??
    (status === 429 ? 30 : undefined);
  return new OpenAIAdapterError(
    "OPENAI_UPSTREAM_ERROR",
    status,
    isRetryableProviderStatus(status),
    retryAfterSeconds,
  );
}

function retainedErrorContract(
  code: string,
  providerStatus: string,
): { status: number; retryable: boolean } {
  const upstream = /^http_([0-9]{3})$/.exec(providerStatus);
  if (code === "OPENAI_UPSTREAM_ERROR" && upstream) {
    const status = Number(upstream[1]);
    return { status, retryable: isRetryableProviderStatus(status) };
  }
  switch (code) {
    case "OPENAI_KEY_UNAVAILABLE":
      return { status: 503, retryable: false };
    case "OPENAI_ROUTE_BUDGET_EXHAUSTED":
      return { status: 504, retryable: true };
    case "OPENAI_EMPTY_RESPONSE":
    case "OPENAI_INVALID_STRUCTURED_OUTPUT":
    case "OPENAI_INCOMPLETE_RESPONSE":
      return { status: 502, retryable: false };
    default:
      return { status: 500, retryable: false };
  }
}

function timeoutMs(route: OpenAISemanticRoute): number {
  return route === "fast" ? 30_000 : 90_000;
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

async function waitForRetry(
  routeDeadline: number,
  signal?: AbortSignal,
  retryAfterSeconds?: number,
): Promise<void> {
  const delay = retryAfterSeconds === undefined
    ? retryDelayMs()
    : Math.max(retryDelayMs(), retryAfterSeconds * 1_000);
  if (performance.now() + delay >= routeDeadline) {
    if (retryAfterSeconds !== undefined) {
      throw new OpenAIAdapterError(
        "OPENAI_AWAITING_CAPACITY",
        429,
        true,
        retryAfterSeconds,
      );
    }
    throw new OpenAIAdapterError("OPENAI_ROUTE_BUDGET_EXHAUSTED", 504, true);
  }
  if (delay === 0) return;
  if (signal?.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  if (performance.now() >= routeDeadline) {
    throw new OpenAIAdapterError("OPENAI_ROUTE_BUDGET_EXHAUSTED", 504, true);
  }
}

export async function routeRequest(
  request: ProviderRequest,
): Promise<ProviderResponse> {
  // Resolve and validate the complete hosted routing contract before checking
  // credentials or preparing a provider request. An immutable accepted route
  // cannot be used to bypass an incomplete hosted activation configuration.
  const routeSnapshot = effectiveRouteSnapshot(request);
  const body = buildOpenAIRequestBody(request);
  const requestSha256 = await sha256Json(body);
  let lastError: OpenAIAdapterError | undefined;
  const attempts: ProviderAttempt[] = [];
  // timeoutMs is the accepted budget for the complete route, not a fresh
  // allowance for every retry. This keeps deep and review work within the
  // Edge background runtime envelope.
  const routeDeadline = performance.now() + routeSnapshot.timeoutMs;

  if (!request.attemptLifecycle) {
    let checkpoint: LegacyModelCheckpoint | undefined;
    try {
      checkpoint = await inspectLegacyModelCheckpointBeforeCapacity(
        request.signal,
        {
          logicalStageKey: request.logicalStageKey,
          requestSha256,
          maxAttempts: routeSnapshot.maxAttempts,
        },
      );
    } catch (error) {
      if (error instanceof ModelCallContextError) {
        throw new OpenAIAdapterError(error.code, 500, false);
      }
      if (error instanceof ModelCallAccountingError) {
        throw new OpenAIAdapterError(
          error.code.replace("MODEL_CALL_", "OPENAI_"),
          error.code.includes("CONFLICT") ? 409 : 500,
          false,
        );
      }
      throw error;
    }
    if (checkpoint?.state === "replay") {
      return replayLegacyCheckpoint(checkpoint, request, routeSnapshot);
    }
    if (
      checkpoint &&
      !["not_found", "prepared"].includes(String(checkpoint.state ?? ""))
    ) {
      throw checkpointBlockError(checkpoint);
    }
  }
  const capacityTokens = estimatedCapacityTokens(body);

  const rejectPreparedAttempt = async (
    attemptNumber: number,
    startedAt: string,
    error: OpenAIAdapterError,
  ): Promise<never> => {
    const rejected: ProviderAttempt = {
      attemptNumber,
      startedAt,
      completedAt: new Date().toISOString(),
      status: "failed",
      responseId: "",
      inputTokens: 0,
      outputTokens: 0,
      providerStatus: "rejected_before_provider",
      errorCode: error.code,
    };
    if (request.attemptLifecycle) {
      await request.attemptLifecycle.complete({
        attempt: rejected,
        requestSha256,
        routeSnapshot,
        structuredOutput: null,
      });
    }
    attempts.push(rejected);
    error.attempts = [...attempts];
    throw error;
  };

  for (let attempt = 0; attempt < routeSnapshot.maxAttempts; attempt += 1) {
    if (performance.now() >= routeDeadline) {
      const budgetError = new OpenAIAdapterError(
        "OPENAI_ROUTE_BUDGET_EXHAUSTED",
        504,
        true,
      );
      budgetError.attempts = [...attempts];
      throw budgetError;
    }
    const localAttemptNumber = attempt + 1;
    const startedAt = new Date().toISOString();
    let capacityClaim: OpenAICapacityClaim;
    try {
      capacityClaim = await claimOpenAICapacity(request.signal, {
        semanticRoute: routeSnapshot.semanticRoute,
        estimatedTokens: capacityTokens,
        resourceIdentity: [
          "openai-capacity.v1",
          routeSnapshot.semanticRoute,
          requestSha256,
          localAttemptNumber,
        ].join(":"),
      });
    } catch (error) {
      if (error instanceof ModelCapacityError) {
        throw new OpenAIAdapterError(
          "OPENAI_AWAITING_CAPACITY",
          429,
          true,
          error.retryAfterSeconds,
        );
      }
      if (error instanceof ModelCallContextError) {
        const unavailable = [
          "MODEL_CALL_CAPACITY_CONFIGURATION_UNAVAILABLE",
          "MODEL_CALL_CAPACITY_ROUTE_DISABLED",
          "MODEL_CALL_CAPACITY_REQUEST_TOO_LARGE",
        ].includes(error.code);
        const reconciliation = error.code.includes("RECONCILIATION") ||
          error.code.includes("ACK_UNRESOLVED");
        throw new OpenAIAdapterError(
          reconciliation
            ? "OPENAI_CAPACITY_ADMISSION_RECONCILIATION_REQUIRED"
            : error.code === "MODEL_CALL_CONTEXT_MISSING"
            ? error.code
            : error.code.replace("MODEL_CALL_", "OPENAI_"),
          unavailable || reconciliation ? 503 : 500,
          false,
        );
      }
      throw error;
    }
    let capacityOutcome: "completed" | "reconciliation_required" | "cancelled" =
      "cancelled";
    let capacityAttemptResult: ProviderAttempt | null = null;
    let capacityReleaseStarted = false;
    const releaseCapacity = async (): Promise<void> => {
      if (capacityReleaseStarted) return;
      capacityReleaseStarted = true;
      try {
        await releaseOpenAICapacity(
          request.signal,
          capacityClaim,
          capacityOutcome,
        );
      } catch {
        const releaseError = new OpenAIAdapterError(
          "OPENAI_CAPACITY_RELEASE_RECONCILIATION_REQUIRED",
          503,
          false,
        );
        releaseError.attempts = capacityAttemptResult
          ? [...attempts, capacityAttemptResult]
          : [...attempts];
        throw releaseError;
      }
    };
    try {
      let prepared: ProviderAttemptPreparation;
      try {
        if (request.attemptLifecycle) {
          prepared = await request.attemptLifecycle.prepare({
            localAttemptNumber,
            startedAt,
            requestSha256,
            routeSnapshot,
          });
        } else {
          const legacy = await prepareLegacyModelAttempt(request.signal, {
            logicalStageKey: request.logicalStageKey,
            requestSha256,
            attemptNumber: localAttemptNumber,
            maxAttempts: routeSnapshot.maxAttempts,
          });
          if (legacy.checkpoint?.state === "replay") {
            capacityOutcome = "completed";
            return replayLegacyCheckpoint(
              legacy.checkpoint,
              request,
              routeSnapshot,
            );
          }
          if (legacy.checkpoint && legacy.checkpoint.state !== "prepared") {
            throw checkpointBlockError(legacy.checkpoint);
          }
          prepared = {
            attemptNumber: legacy.attemptNumber,
            clientRequestId: legacy.clientRequestId,
            durableAdmissionId: legacy.durableAdmissionId,
          };
        }
      } catch (error) {
        if (error instanceof ModelCallContextError) {
          throw new OpenAIAdapterError(error.code, 500, false);
        }
        if (error instanceof ModelCallAccountingError) {
          const status = error.code.includes("CONFLICT") ? 409 : 500;
          throw new OpenAIAdapterError(
            error.code.replace("MODEL_CALL_", "OPENAI_"),
            status,
            false,
          );
        }
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          String((error as { code?: unknown }).code) ===
            "CAPTURED_PROVIDER_ATTEMPT_LIMIT_EXCEEDED"
        ) {
          throw new OpenAIAdapterError(
            "OPENAI_ACCEPTED_ATTEMPT_BUDGET_EXHAUSTED",
            409,
            false,
          );
        }
        throw error;
      }
      if (
        !Number.isInteger(prepared.attemptNumber) ||
        prepared.attemptNumber < 1 ||
        (prepared.clientRequestId &&
          !/^[\x20-\x7E]{1,512}$/.test(prepared.clientRequestId))
      ) {
        throw new OpenAIAdapterError(
          "OPENAI_ATTEMPT_PREPARATION_INVALID",
          500,
          false,
        );
      }
      const attemptNumber = prepared.attemptNumber;
      if (attemptNumber > routeSnapshot.maxAttempts) {
        await rejectPreparedAttempt(
          attemptNumber,
          startedAt,
          new OpenAIAdapterError("OPENAI_ATTEMPT_LIMIT_EXCEEDED", 409, false),
        );
      }
      const remainingRouteBudgetMs = Math.ceil(
        routeDeadline - performance.now(),
      );
      if (remainingRouteBudgetMs <= 0) {
        await rejectPreparedAttempt(
          attemptNumber,
          startedAt,
          new OpenAIAdapterError("OPENAI_ROUTE_BUDGET_EXHAUSTED", 504, true),
        );
      }
      let responseId = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let providerStatus = "unknown";
      const attemptController = new AbortController();
      let timedOut = false;
      let providerDispatched = false;
      let providerDispatchClaim: ProviderDispatchClaim | null = null;
      const onCallerAbort = () =>
        attemptController.abort(request.signal?.reason);
      request.signal?.addEventListener("abort", onCallerAbort, { once: true });
      if (request.signal?.aborted) onCallerAbort();
      const timeout = setTimeout(() => {
        timedOut = true;
        attemptController.abort();
      }, remainingRouteBudgetMs);

      let completed: {
        text: string;
        structured?: Record<string, unknown>;
        status: string;
        sources: ProviderSource[];
      } | null = null;
      let failure: OpenAIAdapterError | null = null;
      let cancelled = false;
      let reconciliationRequired = false;
      let resultEnvelope: LegacyProviderResultEnvelope | undefined;
      try {
        if (request.signal?.aborted) {
          throw request.signal.reason ?? abortError();
        }
        // A durable checkpoint is authoritative even while provider credentials
        // are temporarily unavailable. Resolve the key only after replay/block
        // decisions, immediately before the first network dispatch.
        const apiKey = env("OPENAI_API_KEY");
        if (!apiKey) {
          throw new OpenAIAdapterError("OPENAI_KEY_UNAVAILABLE", 503, false);
        }
        // Convert the conservative in-flight reservation into one durable
        // rolling RPM/TPM admission before the network boundary. A lost
        // acknowledgement fails closed and cannot dispatch provider work.
        await markOpenAICapacityDispatched(request.signal, capacityClaim);
        providerDispatchClaim = await claimUserProviderDispatch(
          request.signal,
          prepared.durableAdmissionId ?? prepared.clientRequestId,
        );
        if (prepared.durableAdmissionId) {
          await markLegacyModelAttemptDispatched(request.signal, {
            logicalStageKey: request.logicalStageKey!,
            requestSha256,
            attemptNumber,
            durableAdmissionId: prepared.durableAdmissionId,
          });
        }
        // From this point forward a local abort is not proof that OpenAI stopped
        // or billed nothing. Treat it as an ambiguous provider outcome unless an
        // explicit upstream cancellation acknowledgement is later available.
        providerDispatched = true;
        const response = await fetch(OPENAI_RESPONSES_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            ...(prepared.clientRequestId
              ? { "X-Client-Request-Id": prepared.clientRequestId }
              : {}),
          },
          body: JSON.stringify(body),
          signal: attemptController.signal,
        });

        if (!response.ok) {
          providerStatus = `http_${response.status}`;
          const retryAfter = response.headers.get("Retry-After");
          await response.body?.cancel().catch(() => undefined);
          throw responseError(response.status, retryAfter);
        }

        const data = (await response.json()) as Record<string, unknown>;
        responseId = typeof data.id === "string" ? data.id : "";
        inputTokens = tokenCount(data, "input_tokens");
        outputTokens = tokenCount(data, "output_tokens");
        const status = typeof data.status === "string"
          ? data.status
          : "completed";
        providerStatus = status;
        if (status !== "completed") {
          throw new OpenAIAdapterError(
            "OPENAI_INCOMPLETE_RESPONSE",
            502,
            false,
          );
        }
        const text = extractText(data);
        const sources = normalizedResearchSources(data, routeSnapshot);
        resultEnvelope = {
          version: "legacy-provider-result.1",
          text,
          structured: null,
          sources,
          route_snapshot: routeSnapshot,
        };
        if (!text.trim()) {
          throw new OpenAIAdapterError("OPENAI_EMPTY_RESPONSE", 502, false);
        }
        const structured = request.outputSchema || request.requireJson
          ? parseStructured(text)
          : undefined;
        resultEnvelope.structured = structured ?? null;
        completed = {
          text,
          structured,
          status,
          sources,
        };
      } catch (error) {
        if (request.signal?.aborted && !providerDispatched) {
          cancelled = true;
          providerStatus = "cancelled";
          failure = new OpenAIAdapterError("OPENAI_CANCELLED", 499, false);
        } else {
          failure = error instanceof ModelCallContextError
            ? new OpenAIAdapterError(
              error.code === "MODEL_CALL_ACCOUNT_DELETION_FENCED"
                ? "OPENAI_ACCOUNT_DELETION_FENCED"
                : error.code.includes("RECONCILIATION_REQUIRED") ||
                    error.code.includes("ACK_UNRESOLVED")
                ? "OPENAI_PROVIDER_DISPATCH_RECONCILIATION_REQUIRED"
                : error.code.replace("MODEL_CALL_", "OPENAI_"),
              error.code === "MODEL_CALL_ACCOUNT_DELETION_FENCED" ? 409 : 503,
              false,
            )
            : timedOut
            ? new OpenAIAdapterError("OPENAI_TIMEOUT", 504, true)
            : error instanceof OpenAIAdapterError
            ? error
            : new OpenAIAdapterError(
              "OPENAI_NETWORK_ERROR",
              503,
              error instanceof TypeError,
            );
          if (providerOutcomeIsAmbiguous(failure)) {
            reconciliationRequired = true;
            providerStatus = "ambiguous";
            failure = new OpenAIAdapterError(
              "OPENAI_PROVIDER_RECONCILIATION_REQUIRED",
              502,
              false,
            );
          } else if (!providerDispatched && !cancelled) {
            providerStatus = "rejected_before_provider";
          }
        }
      } finally {
        clearTimeout(timeout);
        request.signal?.removeEventListener("abort", onCallerAbort);
      }

      const attemptResult: ProviderAttempt = {
        attemptNumber,
        startedAt,
        completedAt: new Date().toISOString(),
        status: completed ? "succeeded" : cancelled ? "cancelled" : "failed",
        responseId,
        inputTokens,
        outputTokens,
        providerStatus,
        errorCode: completed ? null : (failure?.code ?? "OPENAI_UNKNOWN_ERROR"),
      };
      capacityAttemptResult = attemptResult;
      let terminalPersistenceError: unknown = null;
      try {
        if (request.attemptLifecycle) {
          await request.attemptLifecycle.complete({
            attempt: attemptResult,
            requestSha256,
            routeSnapshot,
            structuredOutput: completed?.structured ?? null,
          });
        } else {
          await recordLegacyModelAttempt(request.signal, {
            logicalStageKey: request.logicalStageKey!,
            requestSha256,
            providerAttemptId: prepared.durableAdmissionId ??
              (responseId
                ? `response:${responseId}`
                : `client:${prepared.clientRequestId}`),
            attemptNumber,
            attemptStatus: reconciliationRequired
              ? "unknown"
              : attemptResult.status,
            providerResponseId: responseId,
            providerStatus,
            errorCode: attemptResult.errorCode,
            inputTokens,
            outputTokens,
            startedAt,
            completedAt: attemptResult.completedAt,
            model: routeSnapshot.model,
            routingVersion: routeSnapshot.routingVersion,
            semanticRoute: routeSnapshot.semanticRoute,
            reasoningEffort: routeSnapshot.reasoningEffort,
            resultEnvelope,
          });
        }
      } catch (error) {
        terminalPersistenceError = error;
      }
      let providerDispatchCompletionError: unknown = null;
      if (providerDispatchClaim) {
        try {
          await completeUserProviderDispatch(
            request.signal,
            providerDispatchClaim,
            reconciliationRequired || terminalPersistenceError
              ? "reconciliation_required"
              : "completed",
          );
        } catch (error) {
          providerDispatchCompletionError = error;
        }
      }
      capacityOutcome = reconciliationRequired || terminalPersistenceError ||
          providerDispatchCompletionError
        ? "reconciliation_required"
        : cancelled
        ? "cancelled"
        : "completed";
      await releaseCapacity();
      if (terminalPersistenceError) {
        const accountingReconciliation =
          terminalPersistenceError instanceof ModelCallAccountingError &&
          terminalPersistenceError.code === "MODEL_CALL_ATTEMPT_ACK_UNRESOLVED";
        const terminalError = new OpenAIAdapterError(
          request.attemptLifecycle
            ? "OPENAI_ATTEMPT_LIFECYCLE_FAILED"
            : accountingReconciliation
            ? "OPENAI_MODEL_CALL_RECONCILIATION_REQUIRED"
            : "OPENAI_MODEL_CALL_METERING_FAILED",
          request.attemptLifecycle || accountingReconciliation ? 503 : 500,
          false,
        );
        terminalError.attempts = [...attempts, attemptResult];
        throw terminalError;
      }
      if (providerDispatchCompletionError) {
        const dispatchError = new OpenAIAdapterError(
          providerDispatchCompletionError instanceof ModelCallContextError &&
            providerDispatchCompletionError.code.includes("RECONCILIATION")
            ? "OPENAI_PROVIDER_DISPATCH_RECONCILIATION_REQUIRED"
            : "OPENAI_PROVIDER_DISPATCH_COMPLETION_FAILED",
          503,
          false,
        );
        dispatchError.attempts = [...attempts, attemptResult];
        throw dispatchError;
      }
      attempts.push(attemptResult);

      if (completed) {
        return {
          text: completed.text,
          structured: completed.structured,
          inputTokens,
          outputTokens,
          _provider: "openai",
          responseId,
          status: completed.status,
          routeSnapshot,
          attempts,
          sources: completed.sources,
        };
      }

      if (cancelled) {
        const cancelledError = abortError() as DOMException & {
          attempts?: ProviderAttempt[];
        };
        cancelledError.attempts = [...attempts];
        throw cancelledError;
      }

      const normalized = failure ??
        new OpenAIAdapterError("OPENAI_UNKNOWN_ERROR", 500, false);
      normalized.attempts = [...attempts];
      lastError = normalized;
      console.error("OpenAI Responses attempt failed", {
        task: request.task,
        route: routeSnapshot.semanticRoute,
        status: normalized.status,
        code: normalized.code,
        attempt: attemptNumber,
      });
      if (attempt + 1 < routeSnapshot.maxAttempts && normalized.retryable) {
        try {
          await waitForRetry(
            routeDeadline,
            request.signal,
            normalized.retryAfterSeconds,
          );
        } catch (error) {
          const interrupted = error as Error & { attempts?: ProviderAttempt[] };
          interrupted.attempts = [...attempts];
          throw interrupted;
        }
        continue;
      }
      throw normalized;
    } finally {
      await releaseCapacity();
    }
  }

  throw lastError ?? new OpenAIAdapterError("OPENAI_UNKNOWN_ERROR", 500, false);
}
