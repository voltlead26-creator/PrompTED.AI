// =====================================================
// PrompTED — generate-checklist
// Produces a sectioned interactive checklist/action plan.
// =====================================================

import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { guardRequest, AuthError } from "../_shared/auth-guard.ts";
import { routeRequest, USER_SAFE_ERROR } from "../_shared/provider-router.ts";
import { buildSystemPrompt, type Domain, type ClariPrefs } from "../_shared/prompt-builder.ts";
import { trackDocumentCreated } from "../_shared/cost-tracker.ts";
import { parseModelJson } from "../_shared/orchestration.ts";
import { loadUserMemoryContext } from "../_shared/user-memory.ts";

interface ChecklistBody {
  situation?: string;
  domain?: Domain;
  clari?: ClariPrefs;
}

interface RawChecklistItem {
  section?: unknown;
  text?: unknown;
  due_date?: unknown;
  reason?: unknown;
}

function usableItems(parsed: unknown): RawChecklistItem[] {
  if (!parsed || typeof parsed !== "object") return [];
  const items = (parsed as Record<string, unknown>).items;
  if (!Array.isArray(items)) return [];
  return items.filter((item) => {
    if (!item || typeof item !== "object") return false;
    return typeof (item as RawChecklistItem).text === "string" &&
      String((item as RawChecklistItem).text).trim().length > 0;
  });
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
    auth = await guardRequest(req);
  } catch (err) {
    if (err instanceof AuthError) return jsonResponse(err.payload, err.status, origin);
    return jsonResponse(USER_SAFE_ERROR, 500, origin);
  }

  try {
    const body = auth.body as unknown as ChecklistBody;
    const situation = String(body.situation ?? "").slice(0, 30000).trim();
    if (!situation) {
      return jsonResponse({ error: { message: "situation is required" } }, 400, origin);
    }

    const memory = auth.userId === "anonymous"
      ? ""
      : await loadUserMemoryContext(auth.admin, auth.userId);
    const systemPrompt = buildSystemPrompt({
      task: "checklist",
      domain: body.domain,
      clari: body.clari,
      profileHint: situation,
      extra: `${memory}\n\nThis is the finished interactive in-app version, not a static document. Organise the result into 3 to 7 practical sections such as Prep, First steps, Daily actions, Weekly actions, Follow-up or Completion, choosing labels that fit the user's goal. Produce at least 8 useful items in total unless the task genuinely requires fewer. Every item must include section, text, due_date and reason. Proposed tasks and routines are allowed; never invent personal facts. Return only JSON in this shape: {"items":[{"section":"Prep","text":"...","due_date":null,"reason":"..."}]}.`,
    });

    const makeRequest = async (retry = false) => routeRequest({
      task: "checklist",
      systemPrompt,
      messages: [{
        role: "user",
        content: retry
          ? `Situation: ${situation}\n\nYour previous response was empty or unusable. Return ONLY valid JSON containing at least 8 concrete, actionable items divided across 3 to 7 named sections. Do not return an empty items array.`
          : `Situation: ${situation}`,
      }],
      maxTokens: 3500,
      signal: req.signal,
    });

    let result = await makeRequest(false);
    let parsed = parseModelJson(result.text);
    let items = usableItems(parsed);

    if (items.length === 0) {
      result = await makeRequest(true);
      parsed = parseModelJson(result.text);
      items = usableItems(parsed);
    }

    if (!parsed || items.length === 0) {
      return jsonResponse(
        { error: { code: "EMPTY_CHECKLIST", message: "TED did not return usable checklist items." } },
        502,
        origin,
      );
    }

    const normalised = {
      items: items.map((item) => ({
        section: typeof item.section === "string" && item.section.trim()
          ? item.section.trim()
          : "General",
        text: String(item.text).trim(),
        due_date: typeof item.due_date === "string" && item.due_date.trim()
          ? item.due_date.trim()
          : null,
        reason: typeof item.reason === "string" ? item.reason.trim() : "",
      })),
    };

    if (auth.userId !== "anonymous") {
      trackDocumentCreated(auth.admin, {
        userId: auth.userId,
        task: "checklist",
        provider: "gateway",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
    }

    return jsonResponse(normalised, 200, origin);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    const isAbort = /abort|timeout/i.test(message);
    return jsonResponse(USER_SAFE_ERROR, isAbort ? 504 : 500, origin);
  }
});
