// =====================================================
// PrompTED — clarify
// Given the conversation so far, asks ONE adaptive question
// or commits to a recommendation. No fixed question cap:
// the loop ends when TED's intent_clear signal fires.
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

interface ClarifyTurn {
  role: "user" | "assistant";
  content: string;
}

interface ClarifyBody {
  domain?: string;
  situation?: string;
  /** Full text extracted from any uploaded document (own 20k budget). */
  extracted_text?: string;
  history?: ClarifyTurn[];
  answer?: string;
  clari?: ClariPrefs;
}

/** Turns after which TED must commit to a best-guess recommendation. */
const MAX_CLARIFY_QUESTIONS = 4;

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

const FORCED_COMMIT_INSTRUCTION =
  "You have now asked enough clarifying questions. Do NOT ask another question under any circumstances. " +
  "Set intent_clear to true and commit to your best recommendation using the canonical PrompTED catalogue name " +
  "that most plausibly fits everything the user has said and any uploaded document content. " +
  "If several outputs are plausible, pick the strongest as the recommendation. " +
  "You are committing without having asked about every fact you would ideally want — list each plain-language " +
  'fact you still don\'t have in "missing_information". Never invent a fact to avoid listing it there. ' +
  "Respond ONLY with the JSON object described in your instructions.";

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
    const history = Array.isArray(body.history) ? body.history : [];
    const answer = String(body.answer ?? "").slice(0, 20000).trim();
    const extracted = String(body.extracted_text ?? "").slice(0, 20000).trim();

    if (history.length === 0 && !answer) {
      return jsonResponse(
        { error: { message: "history or answer is required" } },
        400,
        origin,
      );
    }

    const memory = await loadUserMemoryContext(auth.admin, auth.userId);
    const systemPrompt = buildSystemPrompt({
      task: "clarify",
      clari: body.clari,
      extra: memory,
    });

    // Build the conversation: prior turns + the latest answer.
    const messages: ClarifyTurn[] = [
      ...history.map((t) => ({
        role: t.role === "assistant"
          ? ("assistant" as const)
          : ("user" as const),
        content: String(t.content ?? "").slice(0, 8000),
      })),
    ];
    if (answer) messages.push({ role: "user", content: answer });

    // Prepend situation context as the first user turn if not already present.
    if (
      body.situation &&
      !messages.some((m) => m.content.includes(String(body.situation)))
    ) {
      messages.unshift({
        role: "user",
        content: `Situation: ${body.situation}`,
      });
    }

    // Uploaded document content gets its own turn with its own length budget.
    // History turns are sliced to 8k each, so a document folded into the
    // first turn was being truncated; this keeps up to 20k of it in play.
    if (
      extracted &&
      !messages.some((m) => m.content.includes(extracted.slice(0, 200)))
    ) {
      messages.unshift({
        role: "user",
        content: `Attached document content:\n${extracted}`,
      });
    }

    // Forced commit: after MAX_CLARIFY_QUESTIONS assistant questions, TED
    // must stop interrogating a cooperative user and make its best educated
    // recommendation from everything available. The SRS forbids an
    // indefinite loop; the model prompt alone cannot guarantee termination.
    const questionsAsked = history.filter((t) => t.role === "assistant").length;
    const mustCommit = questionsAsked >= MAX_CLARIFY_QUESTIONS;
    if (mustCommit) {
      messages.push({ role: "user", content: FORCED_COMMIT_INSTRUCTION });
    }

    const result = await routeRequest({
      task: "clarify",
      logicalStageKey: "clarify.primary",
      outputSchema: CLARIFY_OUTPUT_SCHEMA,
      systemPrompt,
      messages,
      maxTokens: 1200,
      signal: req.signal,
    });

    let parsed = result.structured;

    // Same repair pattern as interpret-intent: a prose answer instead of the
    // required JSON usually means the conversation had become clear enough
    // to commit to a recommendation, and the model tried to just answer
    // helpfully instead of following the schema. One repair attempt before
    // falling back, rather than silently dumping unbounded prose into the
    // `question` field as if it were a legitimate short clarifying question.
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
              "If your previous reply directly answered the request, that means the conversation was clear enough to commit to -- " +
              "set intent_clear to true and provide a recommendation matching what you were about to write, instead of repeating the answer as the question field.",
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

    // Enforcement pass: a valid-JSON reply can still be a broken loop.
    // Two stuck states trigger one forced-commit retry:
    //   1. The model asked ANOTHER question after the forced-commit cap.
    //   2. The model's question is a near-repeat of one it already asked.
    const parsedRecord = parsed as Record<string, unknown>;
    const proposedQuestion = typeof parsedRecord.question === "string"
      ? parsedRecord.question
      : "";
    const stuck = parsedRecord.intent_clear !== true &&
      (mustCommit ||
        (proposedQuestion && isRepeatQuestion(proposedQuestion, history)));

    if (stuck) {
      const forced = await routeRequest({
        task: "clarify",
        logicalStageKey: "clarify.forced-commit",
        outputSchema: CLARIFY_OUTPUT_SCHEMA,
        systemPrompt,
        messages: [
          ...messages,
          { role: "assistant", content: result.text },
          {
            role: "user",
            content: (mustCommit
              ? "You were told to commit and asked another question anyway. "
              : "You are repeating a question the user has already answered. ") +
              FORCED_COMMIT_INSTRUCTION,
          },
        ],
        maxTokens: 1200,
        signal: req.signal,
      });
      const forcedParsed = forced.structured;
      if (
        forcedParsed &&
        forcedParsed.intent_clear === true &&
        forcedParsed.recommendation
      ) {
        return jsonResponse(forcedParsed, 200, origin);
      }
      // The model would not commit even under instruction. Never loop the
      // user again on the same question: surrender control honestly and let
      // the client-side keyword fallback pick a template from context.
      return jsonResponse(
        {
          intent_clear: true,
          question: null,
          recommendation: null,
          missing_information: [
            "TED could not confirm enough detail to make a recommendation",
          ],
        },
        200,
        origin,
      );
    }

    return jsonResponse(parsed, 200, origin);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    const isAbort = /abort|timeout/i.test(message);
    return jsonResponse(USER_SAFE_ERROR, isAbort ? 504 : 500, origin);
  }
});
