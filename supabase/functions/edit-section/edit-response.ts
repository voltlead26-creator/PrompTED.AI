import { parseModelJson } from "../_shared/orchestration.ts";

export interface ParsedEditResponse {
  content: string;
  changes: string[];
}

/**
 * Parse the model's structured { content, changes } JSON response. Content
 * must be plain, final wording -- see the "edit" task instructions in
 * prompt-builder.ts for why this is a structured field rather than raw text.
 */
export function parseEditResponse(rawText: string): ParsedEditResponse {
  const parsed = parseModelJson(rawText) as
    | { content?: unknown; changes?: unknown }
    | null;
  const content = String(parsed?.content ?? "").trim();
  const changes = Array.isArray(parsed?.changes)
    ? parsed.changes.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    : [];
  return { content, changes };
}
