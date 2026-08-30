// =====================================================
// PrompTED — document pipeline utilities
// Pure, dependency-free helpers kept separate so speed and targeted-repair
// behaviour can be tested without calling an AI provider.
// =====================================================

export interface KeyedValue {
  key: string;
}

export interface SectionIssueLike {
  section_key?: string;
  severity?: string;
  category?: string;
  finding?: string;
}

export interface SectionRequirementLike {
  key: string;
  label: string;
  hint?: string;
  vital?: readonly string[];
  improver?: readonly string[];
}

function labelledValue(label: string, value?: string): string {
  return value ? `${label}: ${value}` : "";
}

export function renderSectionRequirements(
  section: SectionRequirementLike,
): string {
  return [
    `${section.key}: ${section.label}`,
    labelledValue("Purpose", section.hint),
    labelledValue(
      "Vital facts required for a complete section",
      section.vital?.join("; "),
    ),
    labelledValue(
      "Optional quality improvers (never block generation)",
      section.improver?.join("; "),
    ),
  ].filter(Boolean).join(" — ");
}

/**
 * Map work with a small concurrency ceiling while preserving input order.
 * This makes multi-section documents faster without creating an unbounded
 * burst against the configured provider.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const concurrency = Math.max(
    1,
    Math.min(Math.floor(limit) || 1, items.length),
  );
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T, index);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return results;
}

/**
 * Keep ordinary conversations intact while bounding unusually long histories.
 * Preserve both the opening request and the latest turns because the first
 * normally defines the goal and the last normally contains corrections or
 * final clarification answers.
 */
export function boundedConversationSource(
  value: string,
  maxChars = 16_000,
): string {
  const source = value.trim();
  if (source.length <= maxChars) return source;

  const marker = "\n\n[Earlier middle turns omitted for prompt size]\n\n";
  const available = Math.max(0, maxChars - marker.length);
  const headLength = Math.ceil(available * 0.58);
  const tailLength = available - headLength;
  return `${source.slice(0, headLength)}${marker}${source.slice(-tailLength)}`;
}

export function hasBlockingQualityIssues(
  issues: readonly { severity: string; category?: string }[],
): boolean {
  return issues.some((issue) =>
    issue.severity === "medium" || issue.severity === "high"
  );
}

/**
 * Only facts that identify who/where a document must address are allowed to
 * stop drafting. Ordinary professional wording (for example, a résumé summary)
 * is TED's job to create from the confirmed evidence.
 */
export function hasIdentityCriticalMissingInformation(
  missingInformation: readonly string[],
): boolean {
  return missingInformation.some((item) =>
    /\b(contact name|recipient|hiring manager|company name|employer name|interviewer|exact date|email address|phone|surname|first name)\b/i
      .test(item)
  );
}

export function actionableMissingInformation(
  missingInformation: readonly string[],
): string[] {
  return missingInformation.filter((item) =>
    !/\b(personal statement|professional summary|value proposition|statement summar(?:ising|izing)|summary based on|draft wording|suggested wording|available on request)\b/i
      .test(item)
  );
}

function numericTokens(value: string): string[] {
  const normalised = value.replace(
    /\b(\d+(?:[.,]\d+)*)\s+per\s*cent\b/gi,
    "$1%",
  );
  return [...normalised.matchAll(/\b\d+(?:[.,]\d+)*(?:\s*%)?/g)]
    .map((match) => match[0].replace(/\s+/g, "").replace(/,/g, ""))
    .filter((token) => token.includes("%") || Number(token) >= 10);
}

export function findUnsupportedNumericClaims(
  draft: string,
  source: string,
): string[] {
  const supported = new Set(numericTokens(source));
  return [
    ...new Set(numericTokens(draft).filter((token) => !supported.has(token))),
  ];
}

export interface FactualAuditUnit {
  id: string;
  sectionKey: string;
  text: string;
}

export interface FactualAuditEntry {
  unit_id: string;
  classification: "supported" | "convention" | "guidance" | "unsupported";
  evidence_quotes?: string[];
  unsupported_fragments?: string[];
}

export interface GroundingIssue {
  severity: "low" | "high";
  category: "fact" | "completeness";
  section_key: string;
  finding: string;
  required_correction: string;
}

function normaliseEvidence(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Distinguish unsafe wording from an incomplete or malformed audit response.
 * Explicitly unsupported clauses remain a hard factual failure. Missing audit
 * entries and evidence-format mismatches are audit-completeness issues: they
 * may be retried, but they must not be presented as proof that user wording is
 * unsafe or erase otherwise usable sections.
 */
export function groundingIssuesFromAudit(
  units: readonly FactualAuditUnit[],
  audit: readonly FactualAuditEntry[],
  source: string,
): GroundingIssue[] {
  const sourceText = normaliseEvidence(source);
  const byId = new Map(audit.map((entry) => [entry.unit_id, entry]));

  return units.flatMap((unit): GroundingIssue[] => {
    const entry = byId.get(unit.id);
    if (!entry) {
      return [{
        severity: "low",
        category: "completeness",
        section_key: unit.sectionKey,
        finding: `Factual audit did not return a result for: ${unit.text}`,
        required_correction:
          "Re-run factual verification for this unit. Do not remove or rewrite source-backed wording merely because the audit response was incomplete.",
      }];
    }

    const unsupported = entry.unsupported_fragments?.filter(Boolean) ?? [];
    if (entry.classification === "unsupported" || unsupported.length > 0) {
      const detail = unsupported.length > 0
        ? ` Unsupported fragment(s): ${unsupported.join("; ")}.`
        : "";
      return [{
        severity: "high",
        category: "fact",
        section_key: unit.sectionKey,
        finding: `Source grounding failed for: ${unit.text}${detail}`,
        required_correction:
          "Remove only the unsupported factual clause. Retain wording supported by the source evidence; do not replace it with plausible duties, methods, results, providers or skills.",
      }];
    }

    if (
      entry.classification === "convention" ||
      entry.classification === "guidance"
    ) return [];

    if (entry.classification === "supported") {
      const evidence = entry.evidence_quotes?.filter(Boolean) ?? [];
      const evidenceExists = evidence.length > 0 &&
        evidence.every((quote) =>
          sourceText.includes(normaliseEvidence(quote))
        );
      if (evidenceExists) return [];

      return [{
        severity: "low",
        category: "completeness",
        section_key: unit.sectionKey,
        finding:
          `Factual audit evidence could not be verified for: ${unit.text}`,
        required_correction:
          "Re-run factual verification with exact source excerpts. Do not treat an evidence-format mismatch as proof that the wording is unsafe.",
      }];
    }

    return [{
      severity: "low",
      category: "completeness",
      section_key: unit.sectionKey,
      finding:
        `Factual audit returned an invalid classification for: ${unit.text}`,
      required_correction:
        "Re-run factual verification for this unit without changing the draft.",
    }];
  });
}

function isAuditInfrastructureIssue(issue: SectionIssueLike): boolean {
  return issue.severity === "low" &&
    issue.category === "completeness" &&
    /factual audit (?:did not return|evidence could not be verified|returned an invalid classification)/i
      .test(issue.finding ?? "");
}

/**
 * A document-level audit issue has no section key and therefore requires a
 * full rewrite. Otherwise rewrite only the named, valid sections. Audit
 * infrastructure warnings do not ask the writer to rewrite good prose: the
 * same draft is re-audited instead.
 */
export function affectedSectionKeys(
  issues: readonly SectionIssueLike[],
  allKeys: readonly string[],
): string[] {
  const actionable = issues.filter((issue) =>
    !isAuditInfrastructureIssue(issue)
  );
  if (actionable.length === 0) return [];
  if (actionable.some((issue) => !issue.section_key)) return [...allKeys];

  const requested = new Set(
    actionable
      .map((issue) => issue.section_key)
      .filter((key): key is string =>
        typeof key === "string" && key.length > 0
      ),
  );
  const valid = allKeys.filter((key) => requested.has(key));
  // An auditor should use canonical keys, but a malformed/unknown key must
  // degrade safely to a full repair rather than silently skipping correction.
  return valid.length > 0 ? valid : [...allKeys];
}

/** Merge rewritten sections into the original draft without changing order. */
export function mergeByKey<T extends KeyedValue>(
  original: readonly T[],
  replacements: readonly T[],
): T[] {
  const replacementByKey = new Map(
    replacements.map((item) => [item.key, item]),
  );
  return original.map((item) => replacementByKey.get(item.key) ?? item);
}
