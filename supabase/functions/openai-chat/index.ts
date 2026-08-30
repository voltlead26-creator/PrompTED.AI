import {
  callOpenAIResponses,
  chatToResponsesBody,
  handleOptions,
  jsonResponse,
  parsePromptedControl,
  guardModelRequest,
} from "../_shared/openai-proxy.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== "POST") {
    return jsonResponse({ error: { message: "Method not allowed" } }, 405, req.headers.get("origin"));
  }

  return await guardModelRequest(req, async (body, _auth, origin) => {
    const control = parsePromptedControl(body);
    return await callOpenAIResponses(chatToResponsesBody(body, control), control, req.signal, origin);
  });
});
