// =====================================================
// PrompTED — edit-section (streaming)
// Applies an "Edit with TED" action (improve / shorten / expand /
// change tone / add detail) to a section, or to a selected range
// within it. Streams the revised text back as SSE deltas so the
// client can render the edit as it arrives.
//
// Auth is optional so guest-generated workspaces can still be edited.
// Signed-in edits are tracked against the user's account.
// =====================================================

import { handleOptions, jsonResponse, corsHeaders } from "../_shared/cors.ts";
import { guardRequest, AuthError } from "../_shared/auth-guard.ts";
import { routeRequest, USER_SAFE_ERROR } from "../_shared/provider-router.ts";
import { buildSystemPrompt } from "../_shared/prompt-builder.ts";
import { renderDocumentIntelligenceContract } from "../_shared/document-intelligence.ts";
import { trackAiEdit } from "../_shared/cost-tracker.ts";
import { sseEvent, sseDone, SSE_HEADERS } from "../_shared/orchestration.ts";
import { parseEditResponse } from "./edit-response.ts";
import { loadUserMemoryContext } from "../_shared/user-memory.ts";

type EditAction = "improve" | "shorten" | "expand" | "change_tone" | "add_detail";

interface EditBody {
  action?: EditAction;
  /** The full current section content (plain text or markdown). */
  content?: string;
  /** Optional selected substring — when present, only this is edited. */
  selection?: string;
  /** Optional steering, e.g. the target tone for "change_tone". */
  instruction?: string;
  domain?: string;
  clari?: Record<string, unknown>;
}

const ACTION_INSTRUCTION: Record<EditAction, string> = {
  improve: "Improve the clarity, flow, and impact of the text without changing its meaning.",
  shorten: "Make the text more concise. Remove redundancy while keeping every key point.",
  expand: "Expand the text with relevant detail and supporting points. Do not pad with filler.",
  change_tone:
    "Rewrite the text in the requested tone while preserving all facts and intent.",
  add_detail:
    "Add concrete, specific detail to the text. Do not invent facts the user has not implied.",
};

function isEditAction(value: unknown): value is EditAction {
  return (
    value === "improve" ||
    value === "shorten" ||
    value === "expand" ||
    value === "change_tone" ||
    value === "add_detail"
  );
}

/**
 * Emit `text` to the controller as a sequence of SSE "delta" events so the
 * client editor fills in progressively. The model call itself returns the full
 * revision; chunking here gives a responsive, cancel-able streaming UX over the
 * existing (non-token-streaming) provider router.
 */
function streamText(
  controller: ReadableStreamDefaultController<Uint8Array>,
  text: string,
): void {
  // Chunk on word boundaries to keep deltas small but meaningful.
  const tokens = text.match(/\S+\s*/g) ?? [text];
  for (const token of tokens) {
    controller.enqueue(sseEvent({ type: "delta", text: token }));
  }
}

function hasWeakEditOutput(value: string): boolean {
  if (!value.trim()) return true;
  return /\b(this section will|the user should|consider including|insert|replace this scaffold|draft scaffold|no matching sections|here you would)\b/i.test(value);
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") {
    return jsonResponse({ error: { message: "Method not allowed" } }, 405, origin);
  }

  let auth;
  try {
    auth = await guardRequest(req, { enforceCap: false });
  } catch (err) {
    if (err instanceof AuthError) return jsonResponse(err.payload, err.status, origin);
    return jsonResponse(USER_SAFE_ERROR, 500, origin);
  }

  let body: EditBody;
  try {
    body = auth.body as unknown as EditBody;
  } catch {
    return jsonResponse({ error: { message: "Invalid JSON body" } }, 400, origin);
  }

  if (!isEditAction(body.action)) {
    return jsonResponse({ error: { message: "Unknown edit action" } }, 400, origin);
  }
  const action = body.action;

  const fullContent = String(body.content ?? "").slice(0, 20000);
  const selection = body.selection ? String(body.selection).slice(0, 20000) : "";
  const target = selection || fullContent;
  if (!target.trim()) {
    return jsonResponse({ error: { message: "Nothing to edit" } }, 400, origin);
  }

  const instruction = String(body.instruction ?? "").slice(0, 500).trim();

  const memory = auth.userId !== "anonymous"
    ? await loadUserMemoryContext(auth.admin, auth.userId)
    : "";
  const intelligenceContract = renderDocumentIntelligenceContract({
    task: "edit",
    domain: body.domain,
    profileHint: [fullContent, instruction].filter(Boolean).join(" ").slice(0, 3000),
  });
  const systemPrompt = buildSystemPrompt({
    task: "edit",
    domain: body.domain as never,
    clari: body.clari as never,
    extra: [intelligenceContract, ACTION_INSTRUCTION[action], memory].filter(Boolean).join("\n\n"),
  });

  const userContent = [
    selection
      ? "Edit only the SELECTED text below. Return the revised selection only — do not return the surrounding text."
      : "Edit the text below.",
    instruction && `Additional instruction: ${instruction}`,
    selection ? `Surrounding context:\n${fullContent}` : "",
    `Text to edit:\n${target}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  if (auth.userId !== "anonymous") {
    trackAiEdit(auth.admin, {
      userId: auth.userId,
      task: "edit",
      provider: "gateway",
      inputTokens: 0,
      outputTokens: 0,
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const result = await routeRequest({
          task: "edit",
          systemPrompt,
          messages: [{ role: "user", content: userContent }],
          // Was 1500 when this returned raw text only. Now the same budget
          // must also fit the JSON envelope and the "changes" list, so it's
          // raised proportionally rather than left at the old raw-text
          // figure — see tonight's document-pipeline.ts truncation fixes
          // for the same failure shape (maxTokens too tight once a call
          // moved from raw text to a structured JSON response).
          maxTokens: 2200,
          requireJson: true,
          signal: req.signal,
        });
        const { content: revised, changes } = parseEditResponse(result.text);
        streamText(controller, hasWeakEditOutput(revised) ? target : revised);
        if (changes.length > 0) {
          controller.enqueue(sseEvent({ type: "changes", changes }));
        }
        controller.enqueue(sseDone());
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown";
        controller.enqueue(
          sseEvent({
            type: "error",
            ...USER_SAFE_ERROR,
            detail_code: /abort/i.test(message) ? "aborted" : "failed",
          }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { ...corsHeaders(origin), ...SSE_HEADERS },
  });
});
