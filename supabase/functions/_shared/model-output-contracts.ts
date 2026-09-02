import type { StrictOutputSchema } from "./provider-router.ts";

type JsonSchema = Record<string, unknown>;

const MAX_SHORT_TEXT = 1_000;
const MAX_DETAIL_TEXT = 4_000;
const MAX_CONTENT_TEXT = 20_000;
const MAX_LIST_ITEMS = 80;

export class ModelOutputContractError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ModelOutputContractError";
  }
}

function invalid(code: string): never {
  throw new ModelOutputContractError(code);
}

function closedObject(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

function stringSchema(maxLength: number, minLength = 0): JsonSchema {
  return { type: "string", minLength, maxLength };
}

function nullable(schema: JsonSchema): JsonSchema {
  return { anyOf: [schema, { type: "null" }] };
}

function arraySchema(
  items: JsonSchema,
  maxItems: number,
  minItems = 0,
  uniqueItems = false,
): JsonSchema {
  return {
    type: "array",
    minItems,
    maxItems,
    ...(uniqueItems ? { uniqueItems: true } : {}),
    items,
  };
}

function stringArraySchema(
  maxItems: number,
  itemMaxLength: number,
  minItems = 0,
): JsonSchema {
  return arraySchema(
    stringSchema(itemMaxLength, 1),
    maxItems,
    minItems,
    true,
  );
}

const RECOMMENDATION_ITEM_SCHEMA = closedObject({
  name: stringSchema(240, 1),
  format: stringSchema(120, 1),
  reason: stringSchema(MAX_DETAIL_TEXT, 1),
  use_case: stringSchema(MAX_DETAIL_TEXT, 1),
  benefits: stringArraySchema(12, MAX_SHORT_TEXT, 1),
});

const RECOMMENDATION_SCHEMA = closedObject({
  primary: RECOMMENDATION_ITEM_SCHEMA,
  alternatives: arraySchema(RECOMMENDATION_ITEM_SCHEMA, 2, 2),
});

const QUESTION_OPTIONS_SCHEMA = nullable(
  stringArraySchema(4, 240, 2),
);

export const INTENT_OUTPUT_SCHEMA: StrictOutputSchema = {
  name: "prompted_intent_result",
  version: "intent-result.1",
  schema: closedObject({
    domain: {
      type: "string",
      enum: [
        "employment",
        "education",
        "business",
        "personal",
        "finance",
        "general",
      ],
    },
    situation: stringSchema(MAX_DETAIL_TEXT, 1),
    confidence: { type: "number", minimum: 0, maximum: 1 },
    intent_clear: { type: "boolean" },
    question: nullable(stringSchema(MAX_SHORT_TEXT, 1)),
    question_options: QUESTION_OPTIONS_SCHEMA,
    recommendation: nullable(RECOMMENDATION_SCHEMA),
    job_search: { type: "boolean" },
    missing_information: stringArraySchema(32, MAX_DETAIL_TEXT),
  }),
};

export const CLARIFY_OUTPUT_SCHEMA: StrictOutputSchema = {
  name: "prompted_clarification_result",
  version: "clarification-result.1",
  schema: closedObject({
    intent_clear: { type: "boolean" },
    question: nullable(stringSchema(MAX_SHORT_TEXT, 1)),
    question_options: QUESTION_OPTIONS_SCHEMA,
    recommendation: nullable(RECOMMENDATION_SCHEMA),
    job_search: { type: "boolean" },
    missing_information: stringArraySchema(32, MAX_DETAIL_TEXT),
  }),
};

export const RECOMMENDATION_OUTPUT_SCHEMA: StrictOutputSchema = {
  name: "prompted_recommendation_result",
  version: "recommendation-result.1",
  schema: RECOMMENDATION_SCHEMA,
};

export const CHECKLIST_OUTPUT_SCHEMA: StrictOutputSchema = {
  name: "prompted_checklist_result",
  version: "checklist-result.1",
  schema: closedObject({
    items: arraySchema(
      closedObject({
        section: stringSchema(200, 1),
        text: stringSchema(2_000, 1),
        due_date: nullable(stringSchema(240, 1)),
        reason: stringSchema(MAX_SHORT_TEXT),
      }),
      MAX_LIST_ITEMS,
      1,
    ),
  }),
};

export const EXPLAIN_OUTPUT_SCHEMA: StrictOutputSchema = {
  name: "prompted_section_explanation",
  version: "section-explanation.1",
  schema: closedObject({
    title: stringSchema(240, 1),
    plain_english: stringSchema(MAX_CONTENT_TEXT, 1),
    why_it_matters: stringArraySchema(16, MAX_DETAIL_TEXT),
    what_to_watch: stringArraySchema(16, MAX_DETAIL_TEXT),
    missing_or_risky: stringArraySchema(16, MAX_DETAIL_TEXT),
    suggested_next_step: nullable(stringSchema(MAX_DETAIL_TEXT, 1)),
  }),
};

const PROOFREAD_ITEM_SCHEMA = closedObject({
  title: stringSchema(120, 1),
  why: stringSchema(240),
  original_snippet: stringSchema(600, 1),
  revised_snippet: stringSchema(600, 1),
});

export function proofreadOutputSchema(
  rawSectionKeys: readonly string[],
): StrictOutputSchema {
  const sectionKeys = checkedIdentifiers(
    rawSectionKeys,
    "PROOFREAD_SCHEMA_INPUT_INVALID",
    24,
    80,
  );
  return {
    name: "prompted_document_proofread",
    version: "document-proofread.1",
    schema: closedObject({
      sections: arraySchema(
        closedObject({
          key: { type: "string", enum: sectionKeys },
          corrections: arraySchema(PROOFREAD_ITEM_SCHEMA, 4),
          improvements: arraySchema(PROOFREAD_ITEM_SCHEMA, 3),
        }),
        sectionKeys.length,
      ),
    }),
  };
}

const FIT_BREAKDOWN_SCHEMA = closedObject({
  skills_match: { type: "number", minimum: 0, maximum: 100 },
  experience_match: { type: "number", minimum: 0, maximum: 100 },
  work_style_fit: { type: "number", minimum: 0, maximum: 100 },
  location_fit: { type: "string", enum: ["pass", "fail", "flag"] },
  career_alignment: { type: "number", minimum: 0, maximum: 100 },
});

const JOB_LISTING_SCHEMA = closedObject({
  title: stringSchema(240, 1),
  employer: stringSchema(240, 1),
  location: stringSchema(240),
  source: stringSchema(240, 1),
  url: stringSchema(2_048, 1),
  pay: stringSchema(240),
  closing: stringSchema(240),
  fit_score: { type: "number", minimum: 0, maximum: 100 },
  fit_breakdown: FIT_BREAKDOWN_SCHEMA,
  why_fit: stringSchema(MAX_SHORT_TEXT, 1),
  risk_flags: stringArraySchema(8, 500),
  improve_before_applying: stringArraySchema(8, 500),
  application_actions: stringArraySchema(8, 500, 1),
});

const JOB_ROLE_IDEA_SCHEMA = closedObject({
  dataset_role_id: stringSchema(128, 1),
  fit_score: { type: "number", minimum: 0, maximum: 100 },
  fit_breakdown: FIT_BREAKDOWN_SCHEMA,
  why_fit: stringSchema(MAX_SHORT_TEXT, 1),
  evidence_to_show: stringArraySchema(8, 500),
  first_steps: stringArraySchema(8, 500),
  application_actions: stringArraySchema(8, 500, 1),
});

export const JOB_MATCH_OUTPUT_SCHEMA: StrictOutputSchema = {
  name: "prompted_job_match_result",
  version: "job-match-result.1",
  schema: closedObject({
    need_more_context: { type: "boolean" },
    ask: nullable(stringSchema(MAX_SHORT_TEXT, 1)),
    missing: arraySchema(
      {
        type: "string",
        enum: [
          "location",
          "experience",
          "qualifications",
          "situation",
          "constraints",
        ],
      },
      5,
      0,
      true,
    ),
    urgency: nullable({ type: "string", enum: ["high", "normal"] }),
    location_used: stringSchema(240),
    summary: stringSchema(MAX_DETAIL_TEXT),
    resume_signals: stringArraySchema(16, 500),
    application_gaps: stringArraySchema(16, 500),
    listings: arraySchema(JOB_LISTING_SCHEMA, 8),
    role_ideas: arraySchema(JOB_ROLE_IDEA_SCHEMA, 12),
    tips: stringArraySchema(16, 500),
    next_best_documents: stringArraySchema(8, 240),
  }),
};

export const SECTION_DESIGN_OUTPUT_SCHEMA: StrictOutputSchema = {
  name: "prompted_bespoke_section_design",
  version: "bespoke-section-design.1",
  schema: closedObject({
    name: stringSchema(120, 1),
    domain: {
      type: "string",
      enum: ["employment", "education", "business", "finance", "general"],
    },
    structure_type: {
      type: "string",
      enum: ["compose", "structured_form", "checklist"],
    },
    sections: arraySchema(
      closedObject({
        label: stringSchema(120, 1),
        required: { type: "boolean" },
        hint: stringSchema(300),
        vital: stringArraySchema(6, 200, 2),
        improver: stringArraySchema(10, 200, 4),
      }),
      9,
      3,
    ),
  }),
};

export const ARTIFACT_REQUIREMENTS_OUTPUT_SCHEMA: StrictOutputSchema = {
  name: "prompted_artifact_requirements",
  version: "artifact-requirements.1",
  schema: closedObject({
    goal: stringSchema(MAX_DETAIL_TEXT, 1),
    audience: stringSchema(MAX_DETAIL_TEXT, 1),
    outcome: stringSchema(MAX_DETAIL_TEXT, 1),
    confirmed_facts: stringArraySchema(64, MAX_DETAIL_TEXT),
    constraints: stringArraySchema(64, MAX_DETAIL_TEXT),
    urgency: stringSchema(240),
    missing_vital_information: stringArraySchema(64, MAX_DETAIL_TEXT),
    required_content: stringArraySchema(64, MAX_DETAIL_TEXT),
  }),
};

const INCLUDED_MATERIAL_SCHEMA = closedObject({
  label: stringSchema(240, 1),
  content: stringSchema(MAX_CONTENT_TEXT, 1),
});

const ACTION_TIMING_SCHEMA = closedObject({
  due_date: nullable(stringSchema(10, 10)),
  relative_timing: nullable(stringSchema(240, 1)),
  rationale: stringSchema(MAX_SHORT_TEXT, 1),
});

const ACTION_PAYLOAD_SCHEMA = closedObject({
  title: stringSchema(300, 1),
  objective: stringSchema(MAX_DETAIL_TEXT, 1),
  instructions: stringArraySchema(24, MAX_DETAIL_TEXT, 1),
  required_inputs: stringArraySchema(24, MAX_DETAIL_TEXT),
  included_materials: arraySchema(INCLUDED_MATERIAL_SCHEMA, 16),
  dependencies: stringArraySchema(24, MAX_DETAIL_TEXT),
  timing: nullable(ACTION_TIMING_SCHEMA),
  completion_criteria: stringArraySchema(16, MAX_DETAIL_TEXT, 1),
  cautions: stringArraySchema(16, MAX_DETAIL_TEXT),
});

const TEXT_PAYLOAD_SCHEMA = closedObject({
  content: stringSchema(MAX_CONTENT_TEXT, 1),
  missing_vital_information: stringArraySchema(32, MAX_DETAIL_TEXT),
});

const ARTIFACT_REFERENCE_SCHEMA = closedObject({
  url: stringSchema(2_048, 1),
});

export const ARTIFACT_DRAFT_OUTPUT_SCHEMA: StrictOutputSchema = {
  name: "prompted_artifact_draft",
  version: "artifact-draft.2",
  schema: closedObject({
    title: stringSchema(500, 1),
    blocks: arraySchema(
      closedObject({
        kind: {
          type: "string",
          enum: ["section", "action", "recommendation", "finding", "reference"],
        },
        stable_key: stringSchema(72, 1),
        heading: stringSchema(300, 1),
        payload: { anyOf: [ACTION_PAYLOAD_SCHEMA, TEXT_PAYLOAD_SCHEMA] },
        due_date: nullable(stringSchema(10, 10)),
        references: arraySchema(ARTIFACT_REFERENCE_SCHEMA, 20),
      }),
      32,
      1,
    ),
  }),
};

export function artifactAuditOutputSchema(
  rawBlockKeys: readonly string[],
): StrictOutputSchema {
  const blockKeys = checkedIdentifiers(
    rawBlockKeys,
    "ARTIFACT_AUDIT_SCHEMA_INPUT_INVALID",
    32,
    72,
  );
  return {
    name: "prompted_artifact_quality_audit",
    version: "artifact-quality-audit.1",
    schema: closedObject({
      passed: { type: "boolean" },
      issues: arraySchema(
        closedObject({
          block_key: { type: "string", enum: ["artifact", ...blockKeys] },
          message: stringSchema(MAX_DETAIL_TEXT, 1),
        }),
        64,
      ),
    }),
  };
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
  max: number,
  min = 0,
): string {
  if (typeof value !== "string" || value.length > max) invalid(code);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) invalid(code);
  return normalized;
}

function nullableString(
  value: unknown,
  code: string,
  max: number,
  min = 1,
): string | null {
  if (value === null) return null;
  return boundedString(value, code, max, min);
}

function boundedStringArray(
  value: unknown,
  code: string,
  options: { min?: number; max: number; itemMax: number },
): string[] {
  if (
    !Array.isArray(value) || value.length < (options.min ?? 0) ||
    value.length > options.max
  ) invalid(code);
  const result = value.map((item) =>
    boundedString(item, code, options.itemMax, 1)
  );
  if (new Set(result).size !== result.length) invalid(code);
  return result;
}

function checkedIdentifiers(
  values: readonly string[],
  code: string,
  maxItems: number,
  maxLength: number,
): string[] {
  if (values.length < 1 || values.length > maxItems) invalid(code);
  const result = values.map((value) => {
    if (value !== value.trim()) invalid(code);
    return boundedString(value, code, maxLength, 1);
  });
  if (new Set(result).size !== result.length) invalid(code);
  return result;
}

function booleanValue(value: unknown, code: string): boolean {
  if (typeof value !== "boolean") invalid(code);
  return value;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  code: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) invalid(code);
  return value as T;
}

export interface ChecklistOutputItem {
  section: string;
  text: string;
  due_date: string | null;
  reason: string;
}

export function validateChecklistOutput(value: unknown): {
  items: ChecklistOutputItem[];
} {
  const code = "CHECKLIST_OUTPUT_INVALID";
  const root = recordWithExactKeys(value, ["items"], code);
  if (
    !Array.isArray(root.items) || root.items.length < 1 ||
    root.items.length > MAX_LIST_ITEMS
  ) {
    invalid(code);
  }
  const seen = new Set<string>();
  const items = root.items.map((value) => {
    const item = recordWithExactKeys(
      value,
      ["section", "text", "due_date", "reason"],
      code,
    );
    const result = {
      section: boundedString(item.section, code, 200, 1),
      text: boundedString(item.text, code, 2_000, 1),
      due_date: nullableString(item.due_date, code, 240),
      reason: boundedString(item.reason, code, MAX_SHORT_TEXT),
    };
    const identity =
      `${result.section.toLowerCase()}\u0000${result.text.toLowerCase()}`;
    if (seen.has(identity)) invalid(code);
    seen.add(identity);
    return result;
  });
  return { items };
}

export interface ArtifactRequirementsOutput {
  goal: string;
  audience: string;
  outcome: string;
  confirmed_facts: string[];
  constraints: string[];
  urgency: string;
  missing_vital_information: string[];
  required_content: string[];
}

export function validateArtifactRequirementsOutput(
  value: unknown,
): ArtifactRequirementsOutput {
  const code = "ARTIFACT_REQUIREMENTS_OUTPUT_INVALID";
  const root = recordWithExactKeys(value, [
    "goal",
    "audience",
    "outcome",
    "confirmed_facts",
    "constraints",
    "urgency",
    "missing_vital_information",
    "required_content",
  ], code);
  return {
    goal: boundedString(root.goal, code, MAX_DETAIL_TEXT, 1),
    audience: boundedString(root.audience, code, MAX_DETAIL_TEXT, 1),
    outcome: boundedString(root.outcome, code, MAX_DETAIL_TEXT, 1),
    confirmed_facts: boundedStringArray(root.confirmed_facts, code, {
      max: 64,
      itemMax: MAX_DETAIL_TEXT,
    }),
    constraints: boundedStringArray(root.constraints, code, {
      max: 64,
      itemMax: MAX_DETAIL_TEXT,
    }),
    urgency: boundedString(root.urgency, code, 240),
    missing_vital_information: boundedStringArray(
      root.missing_vital_information,
      code,
      { max: 64, itemMax: MAX_DETAIL_TEXT },
    ),
    required_content: boundedStringArray(root.required_content, code, {
      max: 64,
      itemMax: MAX_DETAIL_TEXT,
    }),
  };
}

export interface ArtifactReferenceOutput {
  url: string;
}

export interface ArtifactActionPayloadOutput {
  title: string;
  objective: string;
  instructions: string[];
  required_inputs: string[];
  included_materials: Array<{ label: string; content: string }>;
  dependencies: string[];
  timing: {
    due_date?: string;
    relative_timing?: string;
    rationale: string;
  } | null;
  completion_criteria: string[];
  cautions: string[];
}

export interface ArtifactTextPayloadOutput {
  content: string;
  missing_vital_information: string[];
}

export interface ArtifactDraftBlockOutput {
  kind: "section" | "action" | "recommendation" | "finding" | "reference";
  stable_key: string;
  heading: string;
  payload: ArtifactActionPayloadOutput | ArtifactTextPayloadOutput;
  due_date: string | null;
  references: ArtifactReferenceOutput[];
}

export interface ArtifactDraftOutput {
  title: string;
  blocks: ArtifactDraftBlockOutput[];
}

function validateReference(
  value: unknown,
  code: string,
): ArtifactReferenceOutput {
  const reference = recordWithExactKeys(value, ["url"], code);
  return {
    url: boundedString(reference.url, code, 2_048, 1),
  };
}

function validateActionPayload(
  value: unknown,
  code: string,
): ArtifactActionPayloadOutput {
  const payload = recordWithExactKeys(value, [
    "title",
    "objective",
    "instructions",
    "required_inputs",
    "included_materials",
    "dependencies",
    "timing",
    "completion_criteria",
    "cautions",
  ], code);
  if (
    !Array.isArray(payload.included_materials) ||
    payload.included_materials.length > 16
  ) invalid(code);
  const included_materials = payload.included_materials.map((value) => {
    const item = recordWithExactKeys(value, ["label", "content"], code);
    return {
      label: boundedString(item.label, code, 240, 1),
      content: boundedString(item.content, code, MAX_CONTENT_TEXT, 1),
    };
  });
  let timing: ArtifactActionPayloadOutput["timing"] = null;
  if (payload.timing !== null) {
    const rawTiming = recordWithExactKeys(
      payload.timing,
      ["due_date", "relative_timing", "rationale"],
      code,
    );
    const dueDate = nullableString(rawTiming.due_date, code, 10, 10);
    const relativeTiming = nullableString(
      rawTiming.relative_timing,
      code,
      240,
    );
    if (!dueDate && !relativeTiming) invalid(code);
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) invalid(code);
    timing = {
      ...(dueDate ? { due_date: dueDate } : {}),
      ...(relativeTiming ? { relative_timing: relativeTiming } : {}),
      rationale: boundedString(rawTiming.rationale, code, MAX_SHORT_TEXT, 1),
    };
  }
  return {
    title: boundedString(payload.title, code, 300, 1),
    objective: boundedString(payload.objective, code, MAX_DETAIL_TEXT, 1),
    instructions: boundedStringArray(payload.instructions, code, {
      min: 1,
      max: 24,
      itemMax: MAX_DETAIL_TEXT,
    }),
    required_inputs: boundedStringArray(payload.required_inputs, code, {
      max: 24,
      itemMax: MAX_DETAIL_TEXT,
    }),
    included_materials,
    dependencies: boundedStringArray(payload.dependencies, code, {
      max: 24,
      itemMax: MAX_DETAIL_TEXT,
    }),
    timing,
    completion_criteria: boundedStringArray(
      payload.completion_criteria,
      code,
      { min: 1, max: 16, itemMax: MAX_DETAIL_TEXT },
    ),
    cautions: boundedStringArray(payload.cautions, code, {
      max: 16,
      itemMax: MAX_DETAIL_TEXT,
    }),
  };
}

function validateTextPayload(
  value: unknown,
  code: string,
): ArtifactTextPayloadOutput {
  const payload = recordWithExactKeys(
    value,
    ["content", "missing_vital_information"],
    code,
  );
  return {
    content: boundedString(payload.content, code, MAX_CONTENT_TEXT, 1),
    missing_vital_information: boundedStringArray(
      payload.missing_vital_information,
      code,
      { max: 32, itemMax: MAX_DETAIL_TEXT },
    ),
  };
}

export function validateArtifactDraftOutput(
  value: unknown,
  actionOnly: boolean,
): ArtifactDraftOutput {
  const code = "ARTIFACT_DRAFT_OUTPUT_INVALID";
  const root = recordWithExactKeys(value, ["title", "blocks"], code);
  if (
    !Array.isArray(root.blocks) || root.blocks.length < 1 ||
    root.blocks.length > 32
  ) {
    invalid(code);
  }
  const seen = new Set<string>();
  const blocks = root.blocks.map((value) => {
    const block = recordWithExactKeys(value, [
      "kind",
      "stable_key",
      "heading",
      "payload",
      "due_date",
      "references",
    ], code);
    const kind = oneOf(
      block.kind,
      [
        "section",
        "action",
        "recommendation",
        "finding",
        "reference",
      ] as const,
      code,
    );
    if (
      (actionOnly && kind !== "action") || (!actionOnly && kind === "action")
    ) {
      invalid(code);
    }
    const stable_key = boundedString(block.stable_key, code, 72, 1);
    if (
      !/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(stable_key) || seen.has(stable_key)
    ) {
      invalid(code);
    }
    seen.add(stable_key);
    const due_date = nullableString(block.due_date, code, 10, 10);
    if (due_date && !/^\d{4}-\d{2}-\d{2}$/.test(due_date)) invalid(code);
    if (!Array.isArray(block.references) || block.references.length > 20) {
      invalid(code);
    }
    return {
      kind,
      stable_key,
      heading: boundedString(block.heading, code, 300, 1),
      payload: kind === "action"
        ? validateActionPayload(block.payload, code)
        : validateTextPayload(block.payload, code),
      due_date,
      references: block.references.map((value) =>
        validateReference(value, code)
      ),
    };
  });
  return {
    title: boundedString(root.title, code, 500, 1),
    blocks,
  };
}

export interface ArtifactAuditIssueOutput {
  block_key: string;
  message: string;
}

export function validateArtifactAuditOutput(
  value: unknown,
  rawBlockKeys: readonly string[],
): { passed: boolean; issues: ArtifactAuditIssueOutput[] } {
  const code = "ARTIFACT_AUDIT_OUTPUT_INVALID";
  const blockKeys = checkedIdentifiers(rawBlockKeys, code, 32, 72);
  const validKeys = new Set(["artifact", ...blockKeys]);
  const root = recordWithExactKeys(value, ["passed", "issues"], code);
  if (!Array.isArray(root.issues) || root.issues.length > 64) invalid(code);
  const issues = root.issues.map((value) => {
    const issue = recordWithExactKeys(value, ["block_key", "message"], code);
    const block_key = boundedString(issue.block_key, code, 72, 1);
    if (!validKeys.has(block_key)) invalid(code);
    return {
      block_key,
      message: boundedString(issue.message, code, MAX_DETAIL_TEXT, 1),
    };
  });
  const passed = booleanValue(root.passed, code);
  if (passed !== (issues.length === 0)) invalid(code);
  return { passed, issues };
}

export function validateProofreadOutput(
  value: unknown,
  rawSectionKeys: readonly string[],
): {
  sections: Array<{
    key: string;
    corrections: Array<Record<string, string>>;
    improvements: Array<Record<string, string>>;
  }>;
} {
  const code = "PROOFREAD_OUTPUT_INVALID";
  const sectionKeys = checkedIdentifiers(rawSectionKeys, code, 24, 80);
  const validKeys = new Set(sectionKeys);
  const root = recordWithExactKeys(value, ["sections"], code);
  if (
    !Array.isArray(root.sections) || root.sections.length > sectionKeys.length
  ) {
    invalid(code);
  }
  const seen = new Set<string>();
  const parseItems = (value: unknown, max: number) => {
    if (!Array.isArray(value) || value.length > max) invalid(code);
    return value.map((value) => {
      const item = recordWithExactKeys(value, [
        "title",
        "why",
        "original_snippet",
        "revised_snippet",
      ], code);
      return {
        title: boundedString(item.title, code, 120, 1),
        why: boundedString(item.why, code, 240),
        original_snippet: boundedString(item.original_snippet, code, 600, 1),
        revised_snippet: boundedString(item.revised_snippet, code, 600, 1),
      };
    });
  };
  const sections = root.sections.map((value) => {
    const section = recordWithExactKeys(
      value,
      ["key", "corrections", "improvements"],
      code,
    );
    const key = boundedString(section.key, code, 80, 1);
    if (!validKeys.has(key) || seen.has(key)) invalid(code);
    seen.add(key);
    return {
      key,
      corrections: parseItems(section.corrections, 4),
      improvements: parseItems(section.improvements, 3),
    };
  });
  return { sections };
}

export function validateExplainOutput(value: unknown): Record<string, unknown> {
  const code = "EXPLAIN_OUTPUT_INVALID";
  const root = recordWithExactKeys(value, [
    "title",
    "plain_english",
    "why_it_matters",
    "what_to_watch",
    "missing_or_risky",
    "suggested_next_step",
  ], code);
  return {
    title: boundedString(root.title, code, 240, 1),
    plain_english: boundedString(root.plain_english, code, MAX_CONTENT_TEXT, 1),
    why_it_matters: boundedStringArray(root.why_it_matters, code, {
      max: 16,
      itemMax: MAX_DETAIL_TEXT,
    }),
    what_to_watch: boundedStringArray(root.what_to_watch, code, {
      max: 16,
      itemMax: MAX_DETAIL_TEXT,
    }),
    missing_or_risky: boundedStringArray(root.missing_or_risky, code, {
      max: 16,
      itemMax: MAX_DETAIL_TEXT,
    }),
    suggested_next_step: nullableString(
      root.suggested_next_step,
      code,
      MAX_DETAIL_TEXT,
    ),
  };
}
