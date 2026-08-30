// =====================================================
// PrompTED — Orchestration contract + validators
// =====================================================

import type { Domain } from "./types";

export interface RecommendationItem {
  name: string;
  format: string;
  reason: string;
  use_case: string;
  benefits: string[];
}

export interface Recommendation {
  primary: RecommendationItem;
  alternatives: RecommendationItem[];
}

export interface IntentResult {
  domain: Domain | "general";
  situation: string;
  confidence: number;
  intentClear: boolean;
  question: string | null;
  /**
   * 3-4 short selectable answers for `question`, ONLY when TED judged the
   * question to have a genuinely small, enumerable answer set (see the
   * "Selectable answers" prompt rule). Null for open-ended questions —
   * the free-text box is always available regardless of whether options
   * are present.
   */
  questionOptions: string[] | null;
  recommendation: Recommendation | null;
  /**
   * TED's own judgment that the user is explicitly asking to find live job
   * openings right now. Set by the model during interpretation — the client
   * must never decide this with keyword matching. Routing to the job-match
   * flow happens only when TED says so.
   */
  jobSearch: boolean;
  /**
   * Plain-language facts TED did not manage to confirm before committing to
   * this recommendation (e.g. because the clarification-question limit was
   * reached). Empty when TED had everything it needed. Never invented facts —
   * an honest gap report, not a excuse to guess.
   */
  missingInformation: string[];
}

export interface ChecklistItemResult {
  section: string;
  text: string;
  due_date: string | null;
  reason: string;
}

export interface ExplainResult {
  title: string;
  plain_english: string;
  why_it_matters: string[];
  what_to_watch: string[];
  missing_or_risky: string[];
  suggested_next_step: string | null;
}

const DOMAINS: ReadonlyArray<Domain | "general"> = [
  "employment",
  "education",
  "business",
  "personal",
  "finance",
  "general",
];

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => asString(v)).filter((v) => v.length > 0);
}

export function validateRecommendation(raw: unknown): Recommendation | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const primary = coerceItem(rec.primary);
  if (!primary) return null;
  const alternatives = Array.isArray(rec.alternatives)
    ? rec.alternatives.map(coerceItem).filter((i): i is RecommendationItem => i !== null).slice(0, 2)
    : [];
  return { primary, alternatives };
}

function coerceItem(raw: unknown): RecommendationItem | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const name = asString(item.name).trim();
  if (!name) return null;
  return {
    name,
    format: asString(item.format, "document").trim(),
    reason: asString(item.reason).trim(),
    use_case: asString(item.use_case ?? item.useCase).trim(),
    benefits: asStringArray(item.benefits),
  };
}

export function coerceIntentResult(raw: unknown): IntentResult {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const domainRaw = asString(obj.domain, "general");
  const domain = (DOMAINS as readonly string[]).includes(domainRaw)
    ? (domainRaw as Domain | "general")
    : "general";
  const recommendation = validateRecommendation(obj.recommendation);
  const intentClearRaw = obj.intent_clear ?? obj.intentClear;
  const question = asString(obj.question).trim() || null;
  const intentClear = intentClearRaw === true || recommendation !== null;
  const jobSearch = (obj.job_search ?? obj.jobSearch) === true;
  const missingInformation = asStringArray(obj.missing_information ?? obj.missingInformation);
  const questionOptionsRaw = asStringArray(obj.question_options ?? obj.questionOptions)
    // A stray "Other" defeats the point — the free-text box is already
    // always available alongside whatever options TED offers.
    .filter((option) => option.trim() && option.trim().toLowerCase() !== "other")
    .slice(0, 4);
  const questionOptions = !intentClear && question && questionOptionsRaw.length >= 2
    ? questionOptionsRaw
    : null;
  return {
    domain,
    situation: asString(obj.situation).trim(),
    confidence: clampConfidence(obj.confidence),
    intentClear,
    question: intentClear ? null : question,
    questionOptions,
    recommendation,
    jobSearch,
    missingInformation,
  };
}

export function clarifyShouldContinue(result: IntentResult): boolean {
  return !result.intentClear && result.question !== null;
}

/**
 * Web entry-point guard: a new outcome must include one user-confirmed
 * clarification turn before TED can recommend, search, or generate.
 *
 * The intent model normally chooses the most useful question from the active
 * document profile. This deterministic fallback prevents a model or endpoint
 * regression from bypassing that checkpoint. A useful model question is kept;
 * otherwise TED asks the user to confirm the factual summary it understood.
 */
export function requireInitialClarification(
  result: IntentResult,
  originalRequest: string,
): IntentResult {
  if (!result.intentClear && result.question) {
    return result.jobSearch ? { ...result, jobSearch: false } : result;
  }

  const understood = result.situation.trim() || originalRequest.trim();
  const summary = understood || "you want TED's help completing an outcome";
  const punctuation = /[.!?]$/.test(summary) ? "" : ".";

  return {
    ...result,
    intentClear: false,
    question:
      `Here’s what I understand: ${summary}${punctuation} ` +
      "Is that accurate, and is there any factual detail I should correct or add before I continue?",
    questionOptions: ["Yes, that's accurate", "I need to correct or add something"],
    recommendation: null,
    jobSearch: false,
  };
}

export function validateChecklist(raw: unknown): ChecklistItemResult[] {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const items = Array.isArray(obj.items) ? obj.items : Array.isArray(raw) ? raw : [];
  return items
    .map((i): ChecklistItemResult | null => {
      if (!i || typeof i !== "object") return null;
      const item = i as Record<string, unknown>;
      const text = asString(item.text).trim();
      if (!text) return null;
      const due = item.due_date ?? item.dueDate;
      return {
        section: asString(item.section, "General").trim() || "General",
        text,
        due_date: typeof due === "string" && due.trim() ? due.trim() : null,
        reason: asString(item.reason).trim(),
      };
    })
    .filter((i): i is ChecklistItemResult => i !== null);
}

export function validateExplainResult(raw: unknown): ExplainResult | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const title = asString(obj.title).trim();
  const plainEnglish = asString(obj.plain_english ?? obj.plainEnglish ?? obj.explanation).trim();
  if (!title || !plainEnglish) return null;

  return {
    title,
    plain_english: plainEnglish,
    why_it_matters: asStringArray(obj.why_it_matters ?? obj.whyItMatters),
    what_to_watch: asStringArray(obj.what_to_watch ?? obj.whatToWatch),
    missing_or_risky: asStringArray(obj.missing_or_risky ?? obj.missingOrRisky),
    suggested_next_step:
      asString(obj.suggested_next_step ?? obj.suggestedNextStep).trim() || null,
  };
}
