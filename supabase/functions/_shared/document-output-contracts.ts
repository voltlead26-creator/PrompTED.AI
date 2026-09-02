import type { StrictOutputSchema } from "./provider-router.ts";

const MAX_SECTIONS = 128;
const MAX_LIST_ITEMS = 128;
const MAX_AUDIT_ITEMS = 512;
const MAX_KEY_LENGTH = 200;
const MAX_SHORT_TEXT = 1_000;
const MAX_DETAIL_TEXT = 4_000;
const MAX_SOURCE_EXCERPT = 16_000;
const MAX_EDIT_CONTENT = 20_000;

const QUALITY_CATEGORIES = [
  "fact",
  "intent",
  "tone",
  "structure",
  "layout",
  "completeness",
  "instruction_leakage",
  "blank_output",
] as const;
const EDITORIAL_CATEGORIES = new Set<QualityAuditIssue["category"]>([
  "intent",
  "tone",
  "structure",
  "layout",
  "completeness",
]);
const SEVERITIES = ["low", "medium", "high"] as const;
const GROUNDING_CLASSIFICATIONS = [
  "supported",
  "convention",
  "guidance",
  "unsupported",
] as const;

type QualityCategory = (typeof QUALITY_CATEGORIES)[number];
type Severity = (typeof SEVERITIES)[number];
type GroundingClassification = (typeof GROUNDING_CLASSIFICATIONS)[number];

export interface IntentSectionReadiness {
  key: string;
  ready: boolean;
  missing_information: string[];
  missing_information_keys: string[];
}

export interface IntentBriefOutput {
  user_goal: string;
  primary_outcome: string;
  audience: string;
  author_perspective: string;
  tone: string[];
  required_content: string[];
  prohibited_content: string[];
  known_facts: string[];
  safe_assumptions: string[];
  missing_critical_information: string[];
  section_readiness: IntentSectionReadiness[];
  confidence: number;
}

export interface SectionPlanEntry {
  key: string;
  relevant_content: string;
  display_label: string;
}

export interface SectionPlanOutput {
  section_context: SectionPlanEntry[];
}

export interface QualityAuditIssue {
  severity: Severity;
  category: QualityCategory;
  section_key?: string;
  finding: string;
  required_correction: string;
}

export interface QualityAuditOutput {
  decision: "approve" | "changes_required";
  issues: QualityAuditIssue[];
}

export interface GroundingAuditEntry {
  unit_id: string;
  classification: GroundingClassification;
  evidence_quotes: string[];
  unsupported_fragments: string[];
}

export interface GroundingAuditOutput {
  units: GroundingAuditEntry[];
}

export interface EditSectionOutput {
  content: string;
  changes: string[];
}

export class DocumentOutputContractError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "DocumentOutputContractError";
  }
}

function invalid(code: string): never {
  throw new DocumentOutputContractError(code);
}

function recordWithExactKeys(
  value: unknown,
  keys: readonly string[],
  code: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(code);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) invalid(code);
  return record;
}

function boundedString(
  value: unknown,
  code: string,
  options: { min?: number; max: number },
): string {
  if (typeof value !== "string") invalid(code);
  if (value.length > options.max) invalid(code);
  const normalized = value.trim();
  if (
    normalized.length < (options.min ?? 0) ||
    normalized.length > options.max
  ) invalid(code);
  return normalized;
}

function boundedIdentifier(
  value: unknown,
  code: string,
  options: { min?: number; max: number },
): string {
  const parsed = boundedString(value, code, options);
  if (value !== parsed) invalid(code);
  return parsed;
}

function boundedStringArray(
  value: unknown,
  code: string,
  options: {
    min?: number;
    max: number;
    itemMax: number;
    unique?: boolean;
  },
): string[] {
  if (
    !Array.isArray(value) || value.length < (options.min ?? 0) ||
    value.length > options.max
  ) invalid(code);
  const parsed = value.map((item) =>
    boundedString(item, code, { min: 1, max: options.itemMax })
  );
  if (options.unique !== false && new Set(parsed).size !== parsed.length) {
    invalid(code);
  }
  return parsed;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  code: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) invalid(code);
  return value as T;
}

function expectedIds(
  values: readonly string[],
  code: string,
  maximum: number,
): string[] {
  if (values.length < 1 || values.length > maximum) invalid(code);
  const parsed = values.map((value) =>
    boundedIdentifier(value, code, { min: 1, max: MAX_KEY_LENGTH })
  );
  if (new Set(parsed).size !== parsed.length) invalid(code);
  return parsed;
}

function closedObject(properties: Record<string, unknown>) {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

function stringSchema(maxLength: number, minLength = 0) {
  return { type: "string", minLength, maxLength };
}

function stringArraySchema(
  maxItems: number,
  itemMaxLength: number,
  minItems = 0,
) {
  return {
    type: "array",
    minItems,
    maxItems,
    uniqueItems: true,
    items: stringSchema(itemMaxLength, 1),
  };
}

export function intentBriefOutputSchema(
  rawSectionKeys: readonly string[],
): StrictOutputSchema {
  const sectionKeys = expectedIds(
    rawSectionKeys,
    "DOCUMENT_INTENT_SCHEMA_INPUT_INVALID",
    MAX_SECTIONS,
  );
  return {
    name: "prompted_document_intent_brief",
    version: "document-intent-brief.1",
    schema: closedObject({
      user_goal: stringSchema(MAX_DETAIL_TEXT, 1),
      primary_outcome: stringSchema(MAX_DETAIL_TEXT, 1),
      audience: stringSchema(MAX_SHORT_TEXT, 1),
      author_perspective: stringSchema(MAX_SHORT_TEXT, 1),
      tone: stringArraySchema(16, 240, 1),
      required_content: stringArraySchema(MAX_LIST_ITEMS, MAX_DETAIL_TEXT),
      prohibited_content: stringArraySchema(MAX_LIST_ITEMS, MAX_DETAIL_TEXT),
      known_facts: stringArraySchema(MAX_LIST_ITEMS, MAX_DETAIL_TEXT),
      safe_assumptions: stringArraySchema(MAX_LIST_ITEMS, MAX_DETAIL_TEXT),
      missing_critical_information: stringArraySchema(
        MAX_LIST_ITEMS,
        MAX_DETAIL_TEXT,
      ),
      section_readiness: {
        type: "array",
        minItems: sectionKeys.length,
        maxItems: sectionKeys.length,
        items: closedObject({
          key: { type: "string", enum: sectionKeys },
          ready: { type: "boolean" },
          missing_information: stringArraySchema(64, MAX_DETAIL_TEXT),
          missing_information_keys: stringArraySchema(64, MAX_KEY_LENGTH),
        }),
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    }),
  };
}

export function sectionPlanOutputSchema(
  rawSectionKeys: readonly string[],
): StrictOutputSchema {
  const sectionKeys = expectedIds(
    rawSectionKeys,
    "DOCUMENT_PLAN_SCHEMA_INPUT_INVALID",
    MAX_SECTIONS,
  );
  return {
    name: "prompted_document_section_plan",
    version: "document-section-plan.1",
    schema: closedObject({
      section_context: {
        type: "array",
        minItems: sectionKeys.length,
        maxItems: sectionKeys.length,
        items: closedObject({
          key: { type: "string", enum: sectionKeys },
          relevant_content: stringSchema(MAX_SOURCE_EXCERPT),
          display_label: stringSchema(70, 1),
        }),
      },
    }),
  };
}

export function qualityAuditOutputSchema(
  rawSectionKeys: readonly string[],
): StrictOutputSchema {
  const sectionKeys = expectedIds(
    rawSectionKeys,
    "DOCUMENT_QUALITY_SCHEMA_INPUT_INVALID",
    MAX_SECTIONS,
  );
  return {
    name: "prompted_document_quality_audit",
    version: "document-quality-audit.1",
    schema: closedObject({
      decision: { type: "string", enum: ["approve", "changes_required"] },
      issues: {
        type: "array",
        maxItems: MAX_AUDIT_ITEMS,
        items: closedObject({
          severity: { type: "string", enum: [...SEVERITIES] },
          category: { type: "string", enum: [...QUALITY_CATEGORIES] },
          section_key: {
            anyOf: [
              { type: "string", enum: sectionKeys },
              { type: "null" },
            ],
          },
          finding: stringSchema(MAX_DETAIL_TEXT, 1),
          required_correction: stringSchema(MAX_DETAIL_TEXT, 1),
        }),
      },
    }),
  };
}

export function groundingAuditOutputSchema(
  rawUnitIds: readonly string[],
): StrictOutputSchema {
  const unitIds = expectedIds(
    rawUnitIds,
    "DOCUMENT_GROUNDING_SCHEMA_INPUT_INVALID",
    MAX_AUDIT_ITEMS,
  );
  return {
    name: "prompted_document_grounding_audit",
    version: "document-grounding-audit.1",
    schema: closedObject({
      units: {
        type: "array",
        minItems: unitIds.length,
        maxItems: unitIds.length,
        items: closedObject({
          unit_id: { type: "string", enum: unitIds },
          classification: {
            type: "string",
            enum: [...GROUNDING_CLASSIFICATIONS],
          },
          evidence_quotes: stringArraySchema(16, MAX_DETAIL_TEXT),
          unsupported_fragments: stringArraySchema(16, MAX_DETAIL_TEXT),
        }),
      },
    }),
  };
}

export const EDIT_SECTION_OUTPUT_SCHEMA: StrictOutputSchema = {
  name: "prompted_legacy_section_edit",
  version: "legacy-section-edit-output.1",
  schema: closedObject({
    content: stringSchema(MAX_EDIT_CONTENT, 1),
    changes: stringArraySchema(32, MAX_SHORT_TEXT),
  }),
};

export function validateIntentBriefOutput(
  value: unknown,
  rawSectionKeys: readonly string[],
  allowedInformationKeys: Readonly<Record<string, readonly string[]>> = {},
): IntentBriefOutput {
  const code = "DOCUMENT_INTENT_OUTPUT_INVALID";
  const sectionKeys = expectedIds(rawSectionKeys, code, MAX_SECTIONS);
  const root = recordWithExactKeys(value, [
    "user_goal",
    "primary_outcome",
    "audience",
    "author_perspective",
    "tone",
    "required_content",
    "prohibited_content",
    "known_facts",
    "safe_assumptions",
    "missing_critical_information",
    "section_readiness",
    "confidence",
  ], code);
  if (
    typeof root.confidence !== "number" ||
    !Number.isFinite(root.confidence) || root.confidence < 0 ||
    root.confidence > 1
  ) invalid(code);
  if (
    !Array.isArray(root.section_readiness) ||
    root.section_readiness.length !== sectionKeys.length
  ) invalid(code);

  const section_readiness = root.section_readiness.map((value, index) => {
    const entry = recordWithExactKeys(value, [
      "key",
      "ready",
      "missing_information",
      "missing_information_keys",
    ], code);
    const key = boundedIdentifier(entry.key, code, {
      min: 1,
      max: MAX_KEY_LENGTH,
    });
    if (key !== sectionKeys[index] || typeof entry.ready !== "boolean") {
      invalid(code);
    }
    const missing_information = boundedStringArray(
      entry.missing_information,
      code,
      { max: 64, itemMax: MAX_DETAIL_TEXT },
    );
    const missing_information_keys = boundedStringArray(
      entry.missing_information_keys,
      code,
      { max: 64, itemMax: MAX_KEY_LENGTH },
    );
    if (
      (entry.missing_information_keys as unknown[]).some((value, index) =>
        value !== missing_information_keys[index]
      )
    ) invalid(code);
    if (
      entry.ready &&
      (missing_information.length > 0 || missing_information_keys.length > 0)
    ) invalid(code);
    if (!entry.ready && missing_information.length === 0) invalid(code);
    const allowed = new Set(allowedInformationKeys[key] ?? []);
    if (
      missing_information_keys.some((informationKey) =>
        !allowed.has(informationKey)
      )
    ) invalid(code);
    return {
      key,
      ready: entry.ready,
      missing_information,
      missing_information_keys,
    };
  });

  return {
    user_goal: boundedString(root.user_goal, code, {
      min: 1,
      max: MAX_DETAIL_TEXT,
    }),
    primary_outcome: boundedString(root.primary_outcome, code, {
      min: 1,
      max: MAX_DETAIL_TEXT,
    }),
    audience: boundedString(root.audience, code, {
      min: 1,
      max: MAX_SHORT_TEXT,
    }),
    author_perspective: boundedString(root.author_perspective, code, {
      min: 1,
      max: MAX_SHORT_TEXT,
    }),
    tone: boundedStringArray(root.tone, code, {
      min: 1,
      max: 16,
      itemMax: 240,
    }),
    required_content: boundedStringArray(root.required_content, code, {
      max: MAX_LIST_ITEMS,
      itemMax: MAX_DETAIL_TEXT,
    }),
    prohibited_content: boundedStringArray(root.prohibited_content, code, {
      max: MAX_LIST_ITEMS,
      itemMax: MAX_DETAIL_TEXT,
    }),
    known_facts: boundedStringArray(root.known_facts, code, {
      max: MAX_LIST_ITEMS,
      itemMax: MAX_DETAIL_TEXT,
    }),
    safe_assumptions: boundedStringArray(root.safe_assumptions, code, {
      max: MAX_LIST_ITEMS,
      itemMax: MAX_DETAIL_TEXT,
    }),
    missing_critical_information: boundedStringArray(
      root.missing_critical_information,
      code,
      { max: MAX_LIST_ITEMS, itemMax: MAX_DETAIL_TEXT },
    ),
    section_readiness,
    confidence: root.confidence,
  };
}

export function validateSectionPlanOutput(
  value: unknown,
  rawSectionKeys: readonly string[],
): SectionPlanOutput {
  const code = "DOCUMENT_PLAN_OUTPUT_INVALID";
  const sectionKeys = expectedIds(rawSectionKeys, code, MAX_SECTIONS);
  const root = recordWithExactKeys(value, ["section_context"], code);
  if (
    !Array.isArray(root.section_context) ||
    root.section_context.length !== sectionKeys.length
  ) invalid(code);
  const section_context = root.section_context.map((value, index) => {
    const entry = recordWithExactKeys(
      value,
      ["key", "relevant_content", "display_label"],
      code,
    );
    const key = boundedIdentifier(entry.key, code, {
      min: 1,
      max: MAX_KEY_LENGTH,
    });
    if (key !== sectionKeys[index]) invalid(code);
    return {
      key,
      relevant_content: boundedString(entry.relevant_content, code, {
        max: MAX_SOURCE_EXCERPT,
      }),
      display_label: boundedString(entry.display_label, code, {
        min: 1,
        max: 70,
      }),
    };
  });
  return { section_context };
}

export function validateQualityAuditOutput(
  value: unknown,
  rawSectionKeys: readonly string[],
): QualityAuditOutput {
  const code = "DOCUMENT_QUALITY_OUTPUT_INVALID";
  const sectionKeys = new Set(expectedIds(rawSectionKeys, code, MAX_SECTIONS));
  const root = recordWithExactKeys(value, ["decision", "issues"], code);
  const decision = oneOf(
    root.decision,
    ["approve", "changes_required"] as const,
    code,
  );
  if (!Array.isArray(root.issues) || root.issues.length > MAX_AUDIT_ITEMS) {
    invalid(code);
  }
  const seen = new Set<string>();
  const issues = root.issues.map((value) => {
    const entry = recordWithExactKeys(value, [
      "severity",
      "category",
      "section_key",
      "finding",
      "required_correction",
    ], code);
    const category = oneOf(entry.category, QUALITY_CATEGORIES, code);
    const rawSeverity = oneOf(entry.severity, SEVERITIES, code);
    const section_key = entry.section_key === null
      ? undefined
      : boundedIdentifier(entry.section_key, code, {
        min: 1,
        max: MAX_KEY_LENGTH,
      });
    if (section_key && !sectionKeys.has(section_key)) invalid(code);
    const finding = boundedString(entry.finding, code, {
      min: 1,
      max: MAX_DETAIL_TEXT,
    });
    const required_correction = boundedString(entry.required_correction, code, {
      min: 1,
      max: MAX_DETAIL_TEXT,
    });
    const identity = JSON.stringify([
      rawSeverity,
      category,
      section_key ?? null,
      finding,
      required_correction,
    ]);
    if (seen.has(identity)) invalid(code);
    seen.add(identity);
    return {
      severity: EDITORIAL_CATEGORIES.has(category)
        ? "low" as const
        : rawSeverity,
      category,
      ...(section_key ? { section_key } : {}),
      finding,
      required_correction,
    };
  });
  if (
    (decision === "approve" && issues.length !== 0) ||
    (decision === "changes_required" && issues.length === 0)
  ) invalid(code);
  return { decision, issues };
}

export function validateGroundingAuditOutput(
  value: unknown,
  rawUnitIds: readonly string[],
): GroundingAuditOutput {
  const code = "DOCUMENT_GROUNDING_OUTPUT_INVALID";
  const unitIds = expectedIds(rawUnitIds, code, MAX_AUDIT_ITEMS);
  const root = recordWithExactKeys(value, ["units"], code);
  if (!Array.isArray(root.units) || root.units.length !== unitIds.length) {
    invalid(code);
  }
  const units = root.units.map((value, index) => {
    const entry = recordWithExactKeys(value, [
      "unit_id",
      "classification",
      "evidence_quotes",
      "unsupported_fragments",
    ], code);
    const unit_id = boundedIdentifier(entry.unit_id, code, {
      min: 1,
      max: MAX_KEY_LENGTH,
    });
    if (unit_id !== unitIds[index]) invalid(code);
    const classification = oneOf(
      entry.classification,
      GROUNDING_CLASSIFICATIONS,
      code,
    );
    const evidence_quotes = boundedStringArray(entry.evidence_quotes, code, {
      max: 16,
      itemMax: MAX_DETAIL_TEXT,
    });
    const unsupported_fragments = boundedStringArray(
      entry.unsupported_fragments,
      code,
      { max: 16, itemMax: MAX_DETAIL_TEXT },
    );
    if (classification === "supported" && evidence_quotes.length === 0) {
      invalid(code);
    }
    if (
      classification === "supported" && unsupported_fragments.length > 0
    ) invalid(code);
    if (
      classification === "unsupported" &&
      unsupported_fragments.length === 0
    ) invalid(code);
    if (
      (classification === "convention" || classification === "guidance") &&
      unsupported_fragments.length > 0
    ) invalid(code);
    return {
      unit_id,
      classification,
      evidence_quotes,
      unsupported_fragments,
    };
  });
  return { units };
}

export function validateEditSectionOutput(value: unknown): EditSectionOutput {
  const code = "EDIT_SECTION_OUTPUT_INVALID";
  const root = recordWithExactKeys(value, ["content", "changes"], code);
  return {
    content: boundedString(root.content, code, {
      min: 1,
      max: MAX_EDIT_CONTENT,
    }),
    changes: boundedStringArray(root.changes, code, {
      max: 32,
      itemMax: MAX_SHORT_TEXT,
    }),
  };
}
