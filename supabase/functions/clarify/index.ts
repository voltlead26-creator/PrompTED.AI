// =====================================================
// PrompTED — clarify
// Continues profile-driven factual questions, then prepares a
// knowledge summary and candidate recommendation for user confirmation.
// =====================================================

import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { AuthError, guardRequest } from "../_shared/auth-guard.ts";
import { routeRequest, USER_SAFE_ERROR } from "../_shared/provider-router.ts";
import {
  buildSystemPrompt,
  type ClariPrefs,
} from "../_shared/prompt-builder.ts";
import { loadUserMemoryContext } from "../_shared/user-memory.ts";
import { CLARIFY_OUTPUT_SCHEMA } from "../_shared/model-output-contracts.ts";
import { clarificationContext, type ClarifyTurn } from "./context.ts";

interface ClarifyBody {
  domain?: string;
  situation?: string;
  /** Full text extracted from any uploaded document (own 20k budget). */
  extracted_text?: string;
  history?: ClarifyTurn[];
  answer?: string;
  clari?: ClariPrefs;
}

/** Normalise a question for repeat detection. */
function normaliseQuestion(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ")
    .trim();
}

/** Token-overlap similarity between two questions (0..1). */
function questionSimilarity(a: string, b: string): number {
  const ta = new Set(
    normaliseQuestion(a).split(" ").filter((w) => w.length > 2),
  );
  const tb = new Set(
    normaliseQuestion(b).split(" ").filter((w) => w.length > 2),
  );
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const w of ta) if (tb.has(w)) overlap++;
  return overlap / Math.min(ta.size, tb.size);
}

/** True when a proposed question is a near-repeat of one already asked. */
function isRepeatQuestion(question: string, history: ClarifyTurn[]): boolean {
  return history
    .filter((t) => t.role === "assistant")
    .some((t) => questionSimilarity(question, t.content) >= 0.7);
}

const REPEAT_REPAIR_INSTRUCTION =
  "Your question repeats an earlier question. Re-read the user's answers and the selected document profile. " +
  "Ask up to three different unresolved material questions, or provide the knowledge summary and proposed recommendation " +
  "only if the requirements are sufficiently understood. Do not treat repetition or a turn count as permission to guess. " +
  "If a previous answer did not resolve a blocking fact, explain exactly what is still needed and why. Return the required JSON.";

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
    return jsonResponse(USER_SAFE_ERROR, 500, origin);
  }

  try {
    const body = auth.body as unknown as ClarifyBody;
    const { history, messages, profileHint, domain } = clarificationContext(body);

    const memory = await loadUserMemoryContext(auth.admin, auth.userId);
    const systemPrompt = buildSystemPrompt({
      task: "clarify",
      domain,
      profileHint,
      clari: body.clari,
      extra: memory,
    });

    const result = await routeRequest({
      task: "clarify",
      logicalStageKey: "clarify.primary",
      outputSchema: CLARIFY_OUTPUT_SCHEMA,
      systemPrompt,
      messages,
      maxTokens: 3000,
      signal: req.signal,
    });

    let parsed = result.structured;

    // Repair malformed provider output once. A prose reply does not establish
    // that the document requirements are understood or that the user agreed.
    if (!parsed) {
      const repair = await routeRequest({
        task: "clarify",
        logicalStageKey: "clarify.repair",
        outputSchema: CLARIFY_OUTPUT_SCHEMA,
        systemPrompt,
        messages: [
          ...messages,
          { role: "assistant", content: result.text },
          {
            role: "user",
            content:
              "Your last reply did not follow the required JSON schema -- it answered in prose instead. " +
              "Reply again with ONLY the JSON object described in your instructions: no prose, no markdown fences, no commentary. " +
              "Re-check the selected document profile. Ask the unresolved factual questions, or provide a complete knowledge_summary " +
              "and proposed recommendation for user confirmation when the requirements are sufficiently understood. Prose output alone is not evidence of readiness.",
          },
        ],
        maxTokens: 3000,
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
          intent_clear: false,
          question:
            "Could you tell me a little more about what you're trying to create?",
          recommendation: null,
          missing_information: [],
        },
        200,
        origin,
      );
    }

    // Repair a repeated question once without forcing an ungrounded recommendation.
    const parsedRecord = parsed as Record<string, unknown>;
    const proposedQuestion = typeof parsedRecord.question === "string"
      ? parsedRecord.question
      : "";
    const stuck = parsedRecord.intent_clear !== true &&
      proposedQuestion && isRepeatQuestion(proposedQuestion, history);

    if (stuck) {
      const repaired = await routeRequest({
        task: "clarify",
        logicalStageKey: "clarify.resolve-repeat",
        outputSchema: CLARIFY_OUTPUT_SCHEMA,
        systemPrompt,
        messages: [
          ...messages,
          { role: "assistant", content: result.text },
          {
            role: "user",
            content: REPEAT_REPAIR_INSTRUCTION,
          },
        ],
        maxTokens: 3000,
        signal: req.signal,
      });
      const repairedParsed = repaired.structured;
      if (
        repairedParsed && (
          (repairedParsed.intent_clear === true && repairedParsed.recommendation && repairedParsed.knowledge_summary) ||
          (repairedParsed.intent_clear === false && typeof repairedParsed.question === "string" &&
            !isRepeatQuestion(repairedParsed.question, history))
        )
      ) {
        return jsonResponse(repairedParsed, 200, origin);
      }
      return jsonResponse(
        { error: { code: "CLARIFICATION_REPEATED", message: "TED couldn't resolve the remaining document details without repeating itself. Your answers are kept; please clarify the missing detail or retry." } },
        422,
        origin,
      );
    }

    return jsonResponse(parsed, 200, origin);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    if (message === "CLARIFICATION_INPUT_INVALID") return jsonResponse({ error: { code: message, message: "The clarification context is invalid or too long. Your answers have not been changed." } }, 400, origin);
    const isAbort = /abort|timeout/i.test(message);
    return jsonResponse(USER_SAFE_ERROR, isAbort ? 504 : 500, origin);
  }
});
