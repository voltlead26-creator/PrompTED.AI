// Deprecated presentation compatibility endpoint. It deliberately buffers one
// semantic Responses result; durable operation progress lives in Supabase and
// this path never owns model routing or persistence.

import {
  callOpenAIResponses,
  chatToResponsesBody,
  extractText,
  guardModelRequest,
  handleOptions,
  jsonResponse,
} from "../_shared/openai-proxy.ts";
import { corsHeaders } from "../_shared/cors.ts";

function messages(body: Record<string, unknown>): unknown[] {
  if (Array.isArray(body.messages)) return body.messages;
  const fallback = typeof body.input === "string"
    ? body.input
    : typeof body.prompt === "string"
    ? body.prompt
    : "";
  return fallback.trim() ? [{ role: "user", content: fallback }] : [];
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") {
    return jsonResponse({ error: { message: "Method not allowed" } }, 405, origin);
  }

  return await guardModelRequest(req, async (body, _auth, requestOrigin) => {
    const control = {
      task: "general",
      reviewOutput: false,
      highReasoning: false,
      reason: "Legacy buffered stream compatibility",
    };
    const response = await callOpenAIResponses(
      chatToResponsesBody({
        messages: [
          ...(typeof body.system === "string"
            ? [{ role: "system", content: body.system }]
            : []),
          ...messages(body),
        ],
        max_output_tokens: body.max_output_tokens ?? body.max_tokens ?? body.maxTokens,
      }, control),
      control,
      req.signal,
      requestOrigin,
    );

    const payload = await response.json();
    if (!response.ok) return jsonResponse(payload, response.status, requestOrigin);

    return new Response(extractText(payload), {
      status: 200,
      headers: {
        ...corsHeaders(requestOrigin),
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "private, no-store, max-age=0",
        "X-PrompTED-Compatibility": "buffered-responses-v1",
      },
    });
  });
});
