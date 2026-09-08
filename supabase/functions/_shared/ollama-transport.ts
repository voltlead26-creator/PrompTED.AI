// Server-only, bounded local inference transport. The provider router owns
// fallback selection, admission, durable attempt identity, and persistence.
// Match the Edge runtime's explicit pinned dependency convention.
// deno-lint-ignore no-import-prefix
import { Validator } from "npm:@cfworker/json-schema@4.1.1";

export interface OllamaConfiguration {
  readonly baseUrl: string;
  readonly model: string;
  readonly modelDigest: string;
  readonly configurationVersion: string;
  readonly contextTokens: number;
  readonly apiKey?: string;
}

export interface OllamaInput {
  readonly systemPrompt: string;
  readonly messages: readonly { role: "user" | "assistant"; content: string }[];
  readonly maxOutputTokens: number;
  readonly reasoningEffort: "low" | "medium" | "high";
  readonly schema?: Record<string, unknown>;
  readonly requireJson?: boolean;
  readonly allowedTools: readonly string[];
  readonly attemptId: string;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}

export interface OllamaResult {
  readonly provider: "ollama";
  readonly model: string;
  readonly modelDigest: string;
  readonly configurationVersion: string;
  /** Client attempt receipt; Ollama does not return an OpenAI response ID. */
  readonly responseId: string;
  readonly text: string;
  readonly structured?: Record<string, unknown>;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export class OllamaError extends Error {
  constructor(
    readonly code: string,
    readonly dispatched: boolean = false,
    readonly reconciliationRequired: boolean = false,
    readonly usage?: {
      inputTokens: number;
      outputTokens: number;
      responseId: string;
    },
  ) {
    super(code);
    this.name = "OllamaError";
  }
}

const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "host.docker.internal",
]);
const encoder = new TextEncoder();

export function validateOllamaConfiguration(
  config: OllamaConfiguration,
  environment: string,
): void {
  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    throw new OllamaError("OLLAMA_CONFIGURATION_INVALID");
  }
  const local = environment === "local" || environment === "test";
  const hosted = ["production", "staging", "preview"].includes(environment);
  if (
    (!local && !hosted) ||
    url.username || url.password || url.search || url.hash ||
    (url.pathname !== "/" && url.pathname !== "") ||
    !["http:", "https:"].includes(url.protocol) ||
    (local && !LOCAL_HOSTS.has(url.hostname)) ||
    (hosted &&
      (url.protocol !== "https:" || LOCAL_HOSTS.has(url.hostname) ||
        !config.apiKey)) ||
    (config.apiKey !== undefined &&
      !/^[\x21-\x7e]{1,4096}$/.test(config.apiKey)) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(config.model) ||
    config.model.toLowerCase().includes("cloud") ||
    !/^[0-9a-f]{64}$/.test(config.modelDigest) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(config.configurationVersion) ||
    !Number.isSafeInteger(config.contextTokens) ||
    config.contextTokens < 2048 || config.contextTokens > 131072
  ) throw new OllamaError("OLLAMA_CONFIGURATION_INVALID");
}

async function boundedJson(
  response: Response,
  limit: number,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new OllamaError("OLLAMA_RESPONSE_INVALID");
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) throw new OllamaError("OLLAMA_RESPONSE_TOO_LARGE");
      chunks.push(chunk.value);
    }
    const content = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      content.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(content),
    );
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function requestOllama(
  config: OllamaConfiguration,
  input: OllamaInput,
  environment: string,
): Promise<OllamaResult> {
  validateOllamaConfiguration(config, environment);
  if (input.allowedTools.length) {
    throw new OllamaError("OLLAMA_TOOLS_UNAVAILABLE");
  }
  if (
    !input.systemPrompt.trim() || !input.messages.length ||
    input.messages.some((message) =>
      !["user", "assistant"].includes(message.role) ||
      typeof message.content !== "string"
    ) ||
    !Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 ||
    input.maxOutputTokens > 128000 ||
    !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 ||
    input.timeoutMs > 600000 ||
    !["low", "medium", "high"].includes(input.reasoningEffort) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(input.attemptId)
  ) throw new OllamaError("OLLAMA_INPUT_INVALID");
  input.signal.throwIfAborted();
  let validator: Validator | undefined;
  if (input.schema) {
    if (
      input.schema.type !== "object" ||
      input.schema.additionalProperties !== false
    ) {
      throw new OllamaError("OLLAMA_SCHEMA_INVALID");
    }
    try {
      validator = new Validator(input.schema);
    } catch {
      throw new OllamaError("OLLAMA_SCHEMA_INVALID");
    }
  }
  const body = JSON.stringify({
    model: config.model,
    stream: false,
    think: input.reasoningEffort,
    messages: [
      { role: "system", content: input.systemPrompt },
      ...input.messages,
    ],
    ...(input.schema
      ? { format: input.schema }
      : input.requireJson
      ? { format: "json" }
      : {}),
    options: {
      temperature: 0,
      num_predict: input.maxOutputTokens,
      num_ctx: config.contextTokens,
    },
  });
  // Use the same conservative byte-plus-output admission principle as OpenAI.
  // A long document must not be silently truncated to fit local context.
  if (
    encoder.encode(body).byteLength + input.maxOutputTokens + 256 >
      config.contextTokens
  ) {
    throw new OllamaError("OLLAMA_CONTEXT_LIMIT_EXCEEDED");
  }
  const controller = new AbortController();
  let timedOut = false;
  let dispatched = false;
  let responseReceived = false;
  let usage: OllamaError["usage"];
  const abort = () => controller.abort(input.signal.reason);
  input.signal.addEventListener("abort", abort, { once: true });
  if (input.signal.aborted) abort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, input.timeoutMs);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  const checkModel = async () => {
    const response = await fetch(new URL("/api/tags", config.baseUrl), {
      headers,
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new OllamaError("OLLAMA_UNAVAILABLE");
    }
    const inventory = record(await boundedJson(response, 1048576));
    const matches = Array.isArray(inventory?.models)
      ? inventory.models.map(record).filter((model) =>
        model?.name === config.model
      )
      : [];
    if (matches.length !== 1 || matches[0]?.digest !== config.modelDigest) {
      throw new OllamaError("OLLAMA_MODEL_CHANGED_OR_UNAVAILABLE");
    }
  };
  try {
    await checkModel();
    controller.signal.throwIfAborted();
    dispatched = true;
    const response = await fetch(new URL("/api/chat", config.baseUrl), {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new OllamaError(
        "OLLAMA_UPSTREAM_ERROR",
        true,
        response.status >= 500 || response.status === 408,
      );
    }
    const data = record(await boundedJson(response, 4194304));
    const message = record(data?.message);
    if (
      data?.model === config.model && data.done === true &&
      Number.isSafeInteger(data.prompt_eval_count) &&
      Number(data.prompt_eval_count) >= 0 &&
      Number.isSafeInteger(data.eval_count) && Number(data.eval_count) >= 0
    ) {
      usage = {
        inputTokens: Number(data.prompt_eval_count),
        outputTokens: Number(data.eval_count),
        responseId: `ollama:${input.attemptId}`,
      };
      responseReceived = true;
    }
    if (
      !data || data.model !== config.model || data.done !== true ||
      data.done_reason !== "stop" ||
      !message || message.role !== "assistant" ||
      typeof message.content !== "string" || !message.content.trim() ||
      (message.tool_calls !== undefined &&
        (!Array.isArray(message.tool_calls) ||
          message.tool_calls.length > 0)) ||
      !Number.isSafeInteger(data.prompt_eval_count) ||
      Number(data.prompt_eval_count) < 0 ||
      !Number.isSafeInteger(data.eval_count) || Number(data.eval_count) < 0
    ) throw new OllamaError("OLLAMA_RESPONSE_INVALID", true);
    let structured: Record<string, unknown> | undefined;
    if (input.schema || input.requireJson) {
      try {
        structured = record(JSON.parse(message.content)) ?? undefined;
      } catch {
        throw new OllamaError("OLLAMA_STRUCTURED_OUTPUT_INVALID", true);
      }
      if (!structured || (validator && !validator.validate(structured).valid)) {
        throw new OllamaError("OLLAMA_STRUCTURED_OUTPUT_INVALID", true);
      }
    }
    await checkModel();
    controller.signal.throwIfAborted();
    return {
      provider: "ollama",
      model: config.model,
      modelDigest: config.modelDigest,
      configurationVersion: config.configurationVersion,
      responseId: `ollama:${input.attemptId}`,
      text: message.content,
      structured,
      inputTokens: Number(data.prompt_eval_count),
      outputTokens: Number(data.eval_count),
    };
  } catch (error) {
    if (input.signal.aborted || timedOut) {
      throw new OllamaError(
        timedOut ? "OLLAMA_TIMEOUT" : "OLLAMA_CANCELLED",
        dispatched,
        dispatched && !responseReceived,
        usage,
      );
    }
    if (error instanceof OllamaError) {
      throw new OllamaError(
        error.code,
        dispatched,
        error.reconciliationRequired ||
          (dispatched && !responseReceived &&
            error.code !== "OLLAMA_UPSTREAM_ERROR"),
        usage,
      );
    }
    throw new OllamaError(
      responseReceived ? "OLLAMA_RESPONSE_INVALID" : "OLLAMA_UNAVAILABLE",
      dispatched,
      dispatched && !responseReceived,
      usage,
    );
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener("abort", abort);
  }
}
