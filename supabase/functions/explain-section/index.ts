// =====================================================
// PrompTED — explain-section
// Explains a section or selected text in plain English without
// rewriting the document. Returns a structured explanation payload.
// =====================================================

import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { guardRequest, AuthError } from "../_shared/auth-guard.ts";
import { routeRequest, USER_SAFE_ERROR } from "../_shared/provider-router.ts";
import { buildSystemPrompt, type ClariPrefs } from "../_shared/prompt-builder.ts";
import { parseModelJson } from "../_shared/orchestration.ts";
import { loadUserMemoryContext } from "../_shared/user-memory.ts";

interface ExplainBody {
  content?: string;
  selection?: string;
  question?: string;
  section_name?: string;
  domain?: string;
  clari?: ClariPrefs;
}

function fallbackTitle(sectionName?: string, question?: string): string {
  return sectionName?.trim() || question?.trim() || "TED explanation";
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

  try {
    const body = auth.body as unknown as ExplainBody;
    const content = String(body.content ?? "").slice(0, 20000).trim();
    const selection = String(body.selection ?? "").slice(0, 12000).trim();
    const question = String(body.question ?? "").slice(0, 500).trim();
    const sectionName = String(body.section_name ?? "").slice(0, 200).trim();

    if (!content && !selection) {
      return jsonResponse({ error: { message: "content is required" } }, 400, origin);
    }

    const memory = auth.userId === "anonymous"
      ? ""
      : await loadUserMemoryContext(auth.admin, auth.userId);
    const systemPrompt = buildSystemPrompt({
      task: "explain",
      domain: body.domain as never,
      clari: body.clari,
      profileHint: [sectionName, question, selection || content].filter(Boolean).join("\n\n"),
      extra: memory,
    });

    const userContent = [
      sectionName && `Section name: ${sectionName}`,
      question && `User question: ${question}`,
      selection ? `Selected text:\n${selection}` : "",
      `Full section text:\n${content}`,
      "Explain the section in plain English without rewriting it. Focus on meaning, importance, risks or missing details, and any useful next step.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const result = await routeRequest({
      task: "explain",
      systemPrompt,
      messages: [{ role: "user", content: userContent }],
      maxTokens: 1800,
      signal: req.signal,
    });

    const parsed = parseModelJson(result.text);
    if (parsed && typeof parsed === "object") {
      return jsonResponse(parsed, 200, origin);
    }

    return jsonResponse(
      {
        title: fallbackTitle(sectionName, question),
        plain_english: result.text.trim() || "TED couldn't generate an explanation just now.",
        why_it_matters: [],
        what_to_watch: [],
        missing_or_risky: [],
        suggested_next_step: null,
      },
      200,
      origin,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    const isAbort = /abort|timeout/i.test(message);
    return jsonResponse(USER_SAFE_ERROR, isAbort ? 504 : 500, origin);
  }
});
