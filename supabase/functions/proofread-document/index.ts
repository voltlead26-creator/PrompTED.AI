// =====================================================
// PrompTED — proofread-document
// Scans the whole document in one pass and returns review items
// grouped by section, split into corrections (spelling, grammar,
// punctuation, formatting/date/email consistency) and improvements
// (stronger wording, clearer structure, better bullets, tone).
// Nothing is applied server-side: every item carries verbatim
// original/revised snippets and the client applies them only on
// the user's explicit approval.
// =====================================================

import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { guardRequest, AuthError } from "../_shared/auth-guard.ts";
import { routeRequest, USER_SAFE_ERROR } from "../_shared/provider-router.ts";
import { parseModelJson } from "../_shared/orchestration.ts";

interface ProofreadBody {
  sections?: Array<{ id?: string; key?: string; label?: string; content?: string }>;
  domain?: string;
}

interface RawItem {
  title?: unknown;
  why?: unknown;
  original_snippet?: unknown;
  revised_snippet?: unknown;
}

function cleanItem(raw: unknown, sectionContent: string) {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as RawItem;
  const title = typeof item.title === "string" ? item.title.slice(0, 120).trim() : "";
  const why = typeof item.why === "string" ? item.why.slice(0, 240).trim() : "";
  const original = typeof item.original_snippet === "string" ? item.original_snippet.slice(0, 600) : "";
  const revised = typeof item.revised_snippet === "string" ? item.revised_snippet.slice(0, 600) : "";
  if (!title || !original || !revised) return null;
  // Only ship items whose original snippet is genuinely present, so the
  // client's approve action is a safe verbatim replacement.
  if (!sectionContent.includes(original)) return null;
  if (original === revised) return null;
  return { title, why, original_snippet: original, revised_snippet: revised };
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
    const body = auth.body as unknown as ProofreadBody;
    const sections = (body.sections ?? [])
      .map((s) => ({
        id: String(s.id ?? "").slice(0, 80),
        key: String(s.key ?? "").slice(0, 80),
        label: String(s.label ?? "").slice(0, 140),
        content: String(s.content ?? "").slice(0, 12000),
      }))
      .filter((s) => s.label && s.content.trim())
      .slice(0, 24);

    if (sections.length === 0) {
      return jsonResponse({ error: { message: "sections are required" } }, 400, origin);
    }

    const systemPrompt = [
      "You are TED, proofreading a user's document inside PrompTED. Australian English.",
      "Scan every section and return review items grouped by section.",
      "CORRECTIONS are objective fixes: spelling, grammar, punctuation, formatting consistency, date format consistency (DD/MM/YYYY), email or phone format issues.",
      "IMPROVEMENTS are optional quality lifts: stronger wording, better role alignment, clearer sentence structure, better bullet phrasing, more natural tone, more scannable layout.",
      "STRICT RULES:",
      "- original_snippet must be copied VERBATIM from the section content (exact characters), short enough to be a precise target (under ~200 chars).",
      "- revised_snippet is the exact replacement wording. Never placeholders, never instructions, never invented facts.",
      "- Each item needs a short plain-English title and a one-line why.",
      "- 0-4 corrections and 0-3 improvements per section. Return empty arrays when a section is clean — do not manufacture issues.",
      'Respond with ONLY this JSON: { "sections": [ { "key": "...", "corrections": [ { "title": "...", "why": "...", "original_snippet": "...", "revised_snippet": "..." } ], "improvements": [ ...same shape... ] } ] }',
    ].join("\n");

    const userContent = sections
      .map((s) => `SECTION key=${s.key || s.id} label=${s.label}\n${s.content}`)
      .join("\n\n---\n\n");

    const res = await routeRequest({
      task: "recommend",
      systemPrompt,
      messages: [{ role: "user", content: userContent }],
      maxTokens: 2800,
      signal: req.signal,
    });

    const parsed = parseModelJson(res.text) as {
      sections?: Array<{ key?: string; corrections?: unknown[]; improvements?: unknown[] }>;
    } | null;
    if (!parsed || !Array.isArray(parsed.sections)) {
      return jsonResponse(USER_SAFE_ERROR, 502, origin);
    }

    const byKey = new Map(sections.map((s) => [s.key || s.id, s]));
    const out = parsed.sections.flatMap((entry) => {
      const src = byKey.get(String(entry.key ?? ""));
      if (!src) return [];
      const corrections = (entry.corrections ?? [])
        .map((raw) => cleanItem(raw, src.content)).filter(Boolean);
      const improvements = (entry.improvements ?? [])
        .map((raw) => cleanItem(raw, src.content)).filter(Boolean);
      if (corrections.length === 0 && improvements.length === 0) return [];
      return [{ id: src.id, key: src.key, label: src.label, corrections, improvements }];
    });

    return jsonResponse({ sections: out }, 200, origin);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return jsonResponse(USER_SAFE_ERROR, /abort|timeout/i.test(message) ? 504 : 500, origin);
  }
});
