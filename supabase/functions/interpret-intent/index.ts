// =====================================================
// PrompTED — interpret-intent
// Reads the user's situation, returns domain + situation +
// confidence, and either the next adaptive question or a
// recommendation. No fixed clarification cap.
// =====================================================

import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { AuthError, guardRequest } from "../_shared/auth-guard.ts";
import { routeRequest, USER_SAFE_ERROR } from "../_shared/provider-router.ts";
import {
  buildSystemPrompt,
  type ClariPrefs,
  type Domain,
} from "../_shared/prompt-builder.ts";
import { loadUserMemoryContext } from "../_shared/user-memory.ts";
import { INTENT_OUTPUT_SCHEMA } from "../_shared/model-output-contracts.ts";

interface IntentBody {
  situation_text?: string;
  extracted_text?: string;
  clari?: ClariPrefs;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") {
    return jsonResponse(
      { error: { message: "Method not allowed" } },
      405,
      origin,
    );
  }

  let auth;
  try {
    auth = await guardRequest(req, { enforceCap: false });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse(err.payload, err.status, origin);
    }
    console.error("Intent auth guard failed", err);
    return jsonResponse(USER_SAFE_ERROR, 500, origin);
  }

  try {
    const body = auth.body as unknown as IntentBody;
    const situation = String(body.situation_text ?? "").slice(0, 20000).trim();
    const extracted = String(body.extracted_text ?? "").slice(0, 20000).trim();

    if (!situation && !extracted) {
      return jsonResponse(
        { error: { message: "situation_text is required" } },
        400,
        origin,
      );
    }

    const memory = auth.userId === "anonymous"
      ? ""
      : await loadUserMemoryContext(auth.admin, auth.userId);
    const systemPrompt = buildSystemPrompt({
      task: "intent",
      clari: body.clari,
      profileHint: [situation, extracted].filter(Boolean).join("\n\n"),
      extra: memory,
    });

    const userContent = [
      situation && `Situation: ${situation}`,
      extracted && `Attached document content:\n${extracted}`,
    ].filter(Boolean).join("\n\n");

    const messages = [{ role: "user" as const, content: userContent }];

    const result = await routeRequest({
      task: "intent",
      logicalStageKey: "interpret-intent.primary",
      outputSchema: INTENT_OUTPUT_SCHEMA,
      systemPrompt,
      messages,
      maxTokens: 1200,
      signal: req.signal,
    });

    let parsed = result.structured;

    // The model sometimes answers the request directly in prose instead of
    // returning the required JSON -- usually because the request was clear
    // enough to commit to a recommendation, and it tried to be helpful
    // instead of following the schema. One repair attempt, rather than
    // silently treating a schema failure as a legitimate short clarifying
    // question (which is what was happening before: the raw prose answer
    // was dumped straight into `question` and shown as a chat message,
    // with recommendation left null, so no document was ever offered).
    if (!parsed) {
      const repair = await routeRequest({
        task: "intent",
        logicalStageKey: "interpret-intent.repair",
        outputSchema: INTENT_OUTPUT_SCHEMA,
        systemPrompt,
        messages: [
          ...messages,
          { role: "assistant" as const, content: result.text },
          {
            role: "user" as const,
            content:
              "Your last reply did not follow the required JSON schema -- it answered in prose instead. " +
              "Reply again with ONLY the JSON object described in your instructions: no prose, no markdown fences, no commentary. " +
              "This is the first turn, so set intent_clear to false, keep recommendation null, and ask exactly one short clarification question. " +
              "Use the highest-impact unresolved factual requirement from the resolved document profile; if none is unresolved, summarise the facts you understood and ask the user to confirm or correct them.",
          },
        ],
        maxTokens: 1200,
        signal: req.signal,
      });
      parsed = repair.structured;
    }

    if (!parsed) {
      // Both attempts failed to produce valid JSON. Do not echo back
      // whatever prose the model wrote -- it could be any length and was
      // never validated as an actual short clarifying question.
      return jsonResponse(
        {
          domain: "general",
          situation,
          confidence: 0,
          intent_clear: false,
          question:
            "Could you tell me a bit more about what you're trying to create, in a sentence or two?",
          recommendation: null,
        },
        200,
        origin,
      );
    }

    return jsonResponse(parsed, 200, origin);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error("Intent request failed", message.slice(0, 1000));
    const isAbort = /abort|timeout/i.test(message);
    return jsonResponse(USER_SAFE_ERROR, isAbort ? 504 : 500, origin);
  }
});

export type { Domain };
