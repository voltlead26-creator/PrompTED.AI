import { parseModelJson } from "./orchestration.ts";

const EDITORIAL_AUDIT_CATEGORIES = new Set([
  "intent",
  "tone",
  "structure",
  "layout",
  "completeness",
]);

function normaliseAuditResult(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  const record = value as Record<string, unknown>;
  if (
    (record.decision !== "approve" && record.decision !== "changes_required") ||
    !Array.isArray(record.issues)
  ) return value;

  return {
    ...record,
    issues: record.issues.map((issue) => {
      if (!issue || typeof issue !== "object" || Array.isArray(issue)) return issue;
      const item = issue as Record<string, unknown>;
      return EDITORIAL_AUDIT_CATEGORIES.has(String(item.category ?? ""))
        ? { ...item, severity: "low" }
        : item;
    }),
  };
}

/**
 * Parse a model response that is required to contain one JSON object or array.
 * Providers occasionally append commentary after otherwise valid JSON; use the
 * shared balanced-JSON recovery instead of failing the entire document.
 *
 * Audit findings about tone, structure, layout, intent and non-safety
 * completeness remain useful repair guidance, but they are advisory at the
 * release boundary. Only genuine safety categories such as unsupported facts,
 * instruction leakage and blank output retain medium/high blocking severity.
 */
export function parsePipelineJson<T = unknown>(text: string): T {
  const parsed = parseModelJson(text);
  if (parsed === null || (typeof parsed !== "object")) {
    throw new Error("MODEL_JSON_INVALID");
  }
  return normaliseAuditResult(parsed) as T;
}
