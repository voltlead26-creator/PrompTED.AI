// Stable raw-endpoint compatibility façade.
// Model/tool/retry policy lives only in provider-router.ts.

import { AuthError, guardRequest, type AuthContext } from "./auth-guard.ts";
import {
  corsHeaders as originCorsHeaders,
  handleOptions as corsHandleOptions,
  jsonResponse as corsJsonResponse,
} from "./cors.ts";
import {
  OpenAIAdapterError,
  routeRequest,
  type StrictOutputSchema,
} from "./provider-router.ts";

export type PromptedControl = {
  task: string;
  reviewOutput: boolean;
  highReasoning: boolean;
  reason: string;
  promptProfile?: Record<string, unknown>;
};

export const corsHeaders = originCorsHeaders;

export function jsonResponse(
  body: unknown,
  status = 200,
  origin: string | null = null,
): Response {
  return corsJsonResponse(body, status, origin);
}

export function handleOptions(req: Request): Response | null {
  return corsHandleOptions(req);
}

export async function guardModelRequest(
  req: Request,
  handler: (
    body: Record<string, unknown>,
    auth: AuthContext,
    origin: string | null,
  ) => Promise<Response>,
): Promise<Response> {
  const origin = req.headers.get("origin");
  try {
    const auth = await guardRequest(req, { enforceCap: false });
    if (!auth.body) {
      return jsonResponse({
        error: {
          code: "INVALID_BODY",
          message: "A JSON request body is required.",
        },
      }, 400, origin);
    }
    return await handler(auth.body, auth, origin);
  } catch (error) {
    if (error instanceof AuthError) return jsonResponse(error.payload, error.status, origin);
    console.error("OpenAI proxy request failed", {
      code: error instanceof OpenAIAdapterError ? error.code : "UNEXPECTED_PROXY_ERROR",
    });
    return jsonResponse({
      error: {
        code: "MODEL_REQUEST_FAILED",
        message: "TED couldn't finish that just now. Please try again in a moment.",
      },
    }, 500, origin);
  }
}

export function extractText(data: unknown): string {
  if (!data) return "";
  if (typeof data === "string") return data;
  if (typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;
  if (typeof record.text === "string") return record.text;
  if (!Array.isArray(record.output)) return "";
  return record.output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const text = (part as Record<string, unknown>).text;
      return typeof text === "string" ? [text] : [];
    });
  }).join("");
}

export function parsePromptedControl(inputBody: Record<string, unknown>): PromptedControl {
  const raw = (inputBody.prompted_control || inputBody.promptedControl || {}) as Record<
    string,
    unknown
  >;
  const promptProfile = raw.promptProfile && typeof raw.promptProfile === "object"
    ? raw.promptProfile as Record<string, unknown>
    : undefined;
  return {
    task: String(raw.task || "general").trim().slice(0, 80) || "general",
    reviewOutput: raw.reviewOutput === true || raw.review_output === true,
    // Retained only as a V1 payload compatibility field. It cannot select a
    // model or reasoning level; the semantic route owns that policy.
    highReasoning: raw.highReasoning === true || raw.high_reasoning === true,
    reason: String(raw.reason || "").slice(0, 240),
    promptProfile,
  };
}

function readContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (Array.isArray(record.content)) return record.content.map(readContent).join("");
  return "";
}

function normalizeInput(value: unknown): Array<Record<string, string>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const role = String(record.role || "user");
    if (!["system", "developer", "user", "assistant"].includes(role)) return [];
    const content = readContent(record.content).slice(0, 200_000);
    return content ? [{ role, content }] : [];
  });
}

function strictOutputSchema(body: Record<string, unknown>): StrictOutputSchema | undefined {
  const text = body.text && typeof body.text === "object"
    ? body.text as Record<string, unknown>
    : undefined;
  const format = text?.format && typeof text.format === "object"
    ? text.format as Record<string, unknown>
    : undefined;
  if (format?.type !== "json_schema" || format.strict !== true) return undefined;
  if (typeof format.name !== "string" || !format.schema || typeof format.schema !== "object") {
    return undefined;
  }
  if (JSON.stringify(format.schema).length > 20_000) return undefined;
  return { name: format.name, schema: format.schema as Record<string, unknown> };
}

function wantsJsonObject(body: Record<string, unknown>): boolean {
  const text = body.text && typeof body.text === "object"
    ? body.text as Record<string, unknown>
    : undefined;
  const format = text?.format && typeof text.format === "object"
    ? text.format as Record<string, unknown>
    : undefined;
  return format?.type === "json_object";
}

export function normalizeResponsesBody(
  inputBody: Record<string, unknown>,
  control = parsePromptedControl(inputBody),
): Record<string, unknown> {
  const input = normalizeInput(inputBody.input);
  const maxTokens = Number(inputBody.max_output_tokens ?? 2_000);
  const outputSchema = strictOutputSchema(inputBody);
  return {
    task: control.task,
    input,
    max_output_tokens: Number.isInteger(maxTokens) ? maxTokens : 2_000,
    ...(outputSchema ? { output_schema: outputSchema } : {}),
    ...(wantsJsonObject(inputBody) ? { require_json: true } : {}),
  };
}

export function chatToResponsesBody(
  inputBody: Record<string, unknown>,
  control = parsePromptedControl(inputBody),
): Record<string, unknown> {
  return normalizeResponsesBody({
    input: inputBody.messages,
    max_output_tokens: inputBody.max_output_tokens ?? inputBody.max_tokens,
    text: inputBody.text,
  }, control);
}

function adapterTask(task: string): string {
  const normalized = task.toLowerCase().replaceAll("-", "_");
  if (normalized === "document_generation") return "document";
  if (normalized === "live_source") return "research";
  return normalized;
}

function proxyInput(body: Record<string, unknown>): {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const input = normalizeInput(body.input);
  const instructions = input
    .filter((item) => item.role === "system" || item.role === "developer")
    .map((item) => item.content)
    .join("\n\n") || "You are TED, PrompTED's calm and evidence-aware assistant.";
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const item of input) {
    if (item.role === "user" || item.role === "assistant") {
      messages.push({ role: item.role, content: item.content });
    }
  }
  return { systemPrompt: instructions, messages };
}

function responsePayload(result: Awaited<ReturnType<typeof routeRequest>>): Record<string, unknown> {
  return {
    id: result.responseId,
    object: "response",
    status: result.status,
    output_text: result.text,
    output: [{
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: result.text }],
    }],
    usage: {
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
    },
  };
}

function errorResponse(error: unknown, origin: string | null): Response {
  const normalized = error instanceof OpenAIAdapterError
    ? error
    : new OpenAIAdapterError("OPENAI_PROXY_FAILURE", 500, false);
  return jsonResponse({
    error: {
      code: normalized.code,
      message: "TED couldn't finish that just now. Please try again in a moment.",
      retryable: normalized.retryable,
    },
  }, normalized.status, origin);
}

export async function callOpenAIResponses(
  body: Record<string, unknown>,
  control: PromptedControl = {
    task: "general",
    reviewOutput: false,
    highReasoning: false,
    reason: "",
  },
  signal?: AbortSignal,
  origin: string | null = null,
): Promise<Response> {
  try {
    const input = proxyInput(body);
    if (input.messages.length === 0) {
      return jsonResponse({
        error: { code: "INVALID_INPUT", message: "A user message is required." },
      }, 400, origin);
    }

    const result = await routeRequest({
      task: adapterTask(String(body.task ?? control.task)),
      logicalStageKey: "openai-proxy.primary",
      systemPrompt: input.systemPrompt,
      messages: input.messages,
      maxTokens: Number(body.max_output_tokens ?? 2_000),
      outputSchema: body.output_schema as StrictOutputSchema | undefined,
      requireJson: body.require_json === true,
      webSearch: body.web_search === true,
      signal,
    });

    if (control.reviewOutput && adapterTask(control.task) === "document") {
      const reviewed = await routeRequest({
        task: "review",
        logicalStageKey: "openai-proxy.review",
        systemPrompt: [
          "Review this document against its stated constraints.",
          "Correct unsupported overclaims, structure failures, and unclear wording.",
          "Preserve supported user facts. Return only the final user-facing document.",
        ].join(" "),
        messages: [{ role: "user", content: result.text }],
        maxTokens: Number(body.max_output_tokens ?? 2_400),
        signal,
      });
      return jsonResponse({
        ...responsePayload(reviewed),
        prompted_review: { status: "reviewed" },
      }, 200, origin);
    }

    return jsonResponse(responsePayload(result), 200, origin);
  } catch (error) {
    return errorResponse(error, origin);
  }
}
