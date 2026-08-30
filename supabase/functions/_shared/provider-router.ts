// PrompTED's sole active model boundary.
//
// Every active inference request is an OpenAI Responses request selected by a
// semantic route. Historical provider names remain data provenance only and
// are never selectable here.

import {
  type OpenAIRouteSnapshot,
  validateOpenAIRouteSnapshot,
} from "../../../packages/shared/src/document-operation.ts";

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
  errorCode: string | null;
}

export interface ProviderAttemptPreparation {
  attemptNumber: number;
  clientRequestId: string;
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
  ) {
    super(code);
    this.name = "OpenAIAdapterError";
  }
}

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_ROUTING_VERSION = "routing.2026-08-pilot.1";
const HOSTED_DEPLOYMENT_ENVIRONMENTS = new Set([
  "production",
  "staging",
  "preview",
]);
const REQUIRED_HOSTED_ROUTE_CONFIGURATION = [
  "OPENAI_FAST_MODEL",
  "OPENAI_DEEP_MODEL",
  "OPENAI_RESEARCH_MODEL",
  "OPENAI_REVIEW_MODEL",
  "OPENAI_ROUTING_VERSION",
] as const;

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
  const deploymentEnvironment = env("PROMPTED_DEPLOYMENT_ENV")?.toLowerCase() ??
    "local";
  if (!HOSTED_DEPLOYMENT_ENVIRONMENTS.has(deploymentEnvironment)) return;
  if (REQUIRED_HOSTED_ROUTE_CONFIGURATION.some((name) => !env(name))) {
    throw new OpenAIAdapterError(
      "OPENAI_HOSTED_ROUTING_CONFIG_MISSING",
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
    ? request.outputSchema.version ?? request.outputSchema.name
    : request.requireJson
    ? "json-object.compatibility.v1"
    : "text.compatibility.v1";
}

function effectiveRouteSnapshot(request: ProviderRequest): OpenAIRouteSnapshot {
  assertHostedRouteConfiguration();
  const semanticRoute = semanticRouteForTask(request.task);
  const schemaVersion = outputSchemaVersion(request);
  const allowedTools = request.webSearch ? ["web_search"] as const : [];

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
  return status === 408 || status === 425 || status === 429 || status >= 500;
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
  return data.output.flatMap((item) => {
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
  }).join("");
}

function tokenCount(data: Record<string, unknown>, name: string): number {
  const usage = data.usage && typeof data.usage === "object"
    ? data.usage as Record<string, unknown>
    : {};
  return typeof usage[name] === "number" && Number.isFinite(usage[name])
    ? usage[name] as number
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
      ? record.action as Record<string, unknown>
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

function responseError(status: number): OpenAIAdapterError {
  return new OpenAIAdapterError(
    "OPENAI_UPSTREAM_ERROR",
    status,
    isRetryableProviderStatus(status),
  );
}

function timeoutMs(route: OpenAISemanticRoute): number {
  return route === "fast" ? 30_000 : 90_000;
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

async function waitForRetry(signal?: AbortSignal): Promise<void> {
  const delay = retryDelayMs();
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
}

export async function routeRequest(
  request: ProviderRequest,
): Promise<ProviderResponse> {
  // Resolve and validate the complete hosted routing contract before checking
  // credentials or preparing a provider request. An immutable accepted route
  // cannot be used to bypass an incomplete hosted activation configuration.
  const routeSnapshot = effectiveRouteSnapshot(request);
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) {
    throw new OpenAIAdapterError("OPENAI_KEY_UNAVAILABLE", 503, false);
  }

  const body = buildOpenAIRequestBody(request);
  const requestSha256 = await sha256Json(body);
  let lastError: OpenAIAdapterError | undefined;
  const attempts: ProviderAttempt[] = [];

  for (let attempt = 0; attempt < routeSnapshot.maxAttempts; attempt += 1) {
    const localAttemptNumber = attempt + 1;
    const startedAt = new Date().toISOString();
    const prepared = request.attemptLifecycle
      ? await request.attemptLifecycle.prepare({
        localAttemptNumber,
        startedAt,
        requestSha256,
        routeSnapshot,
      })
      : { attemptNumber: localAttemptNumber, clientRequestId: "" };
    if (
      !Number.isInteger(prepared.attemptNumber) || prepared.attemptNumber < 1 ||
      (prepared.clientRequestId &&
        (!/^[\x20-\x7E]{1,512}$/.test(prepared.clientRequestId)))
    ) {
      throw new OpenAIAdapterError(
        "OPENAI_ATTEMPT_PREPARATION_INVALID",
        500,
        false,
      );
    }
    const attemptNumber = prepared.attemptNumber;
    let responseId = "";
    let inputTokens = 0;
    let outputTokens = 0;
    const attemptController = new AbortController();
    let timedOut = false;
    const onCallerAbort = () => attemptController.abort(request.signal?.reason);
    request.signal?.addEventListener("abort", onCallerAbort, { once: true });
    if (request.signal?.aborted) onCallerAbort();
    const timeout = setTimeout(() => {
      timedOut = true;
      attemptController.abort();
    }, routeSnapshot.timeoutMs);

    let completed:
      | {
        text: string;
        structured?: Record<string, unknown>;
        status: string;
        sources: ProviderSource[];
      }
      | null = null;
    let failure: OpenAIAdapterError | null = null;
    let cancelled = false;
    try {
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
        await response.body?.cancel().catch(() => undefined);
        throw responseError(response.status);
      }

      const data = await response.json() as Record<string, unknown>;
      responseId = typeof data.id === "string" ? data.id : "";
      inputTokens = tokenCount(data, "input_tokens");
      outputTokens = tokenCount(data, "output_tokens");
      const status = typeof data.status === "string"
        ? data.status
        : "completed";
      if (status !== "completed") {
        throw new OpenAIAdapterError("OPENAI_INCOMPLETE_RESPONSE", 502, false);
      }
      const text = extractText(data);
      if (!text.trim()) {
        throw new OpenAIAdapterError("OPENAI_EMPTY_RESPONSE", 502, false);
      }
      const structured = request.outputSchema || request.requireJson
        ? parseStructured(text)
        : undefined;
      completed = {
        text,
        structured,
        status,
        sources: normalizedResearchSources(data, routeSnapshot),
      };
    } catch (error) {
      if (request.signal?.aborted) {
        cancelled = true;
        failure = new OpenAIAdapterError("OPENAI_CANCELLED", 499, false);
      } else {
        failure = timedOut
          ? new OpenAIAdapterError("OPENAI_TIMEOUT", 504, true)
          : error instanceof OpenAIAdapterError
          ? error
          : new OpenAIAdapterError(
            "OPENAI_NETWORK_ERROR",
            503,
            error instanceof TypeError,
          );
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
      errorCode: completed ? null : failure?.code ?? "OPENAI_UNKNOWN_ERROR",
    };
    if (request.attemptLifecycle) {
      await request.attemptLifecycle.complete({
        attempt: attemptResult,
        requestSha256,
        routeSnapshot,
        structuredOutput: completed?.structured ?? null,
      });
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
      await waitForRetry(request.signal);
      continue;
    }
    throw normalized;
  }

  throw lastError ?? new OpenAIAdapterError("OPENAI_UNKNOWN_ERROR", 500, false);
}
