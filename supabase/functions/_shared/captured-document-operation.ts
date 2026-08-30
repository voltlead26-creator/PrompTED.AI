import { CAPTURED_DOCUMENT_LEDGER } from "../../../packages/shared/src/document-ledger.ts";
import {
  FIRST_CAPTURED_TEMPLATE_IDS,
  type FirstCapturedTemplateId,
} from "../../../packages/shared/src/document-operation.ts";
import { isVisiblyEmpty } from "../../../packages/shared/src/visible-content.ts";
import type { StrictOutputSchema } from "./provider-router.ts";

const MAX_INPUT_SNAPSHOT_BYTES = 256_000;
const MAX_SECTION_CONTENT = 40_000;
const OUTPUT_STATES = [
  "final",
  "neutral_fallback",
  "omitted_optional",
] as const;

export type CapturedReadySectionState = (typeof OUTPUT_STATES)[number];
type CapturedTemplateContract =
  (typeof CAPTURED_DOCUMENT_LEDGER.templates)[FirstCapturedTemplateId];
type CapturedInputContract = CapturedTemplateContract["requiredInputs"][number];
type CapturedSectionContract = CapturedTemplateContract["sections"][number];

export interface CapturedSectionOutput {
  section_key: string;
  content: string;
  state: CapturedReadySectionState;
  source_references: string[];
}

export interface CapturedInputPlan {
  templateId: FirstCapturedTemplateId;
  template: CapturedTemplateContract;
  inputValues: Record<string, unknown>;
  safeSectionKeys: string[];
  blockedSectionKeys: string[];
  unresolvedInputKeys: string[];
  sourceSnapshot: {
    sources: Array<{
      id: string;
      input_key: string;
      source_type: "confirmed_request_input";
      value: unknown;
    }>;
  };
  evidenceSnapshot: {
    permitted_source_ids: string[];
    material_claims_require_source_reference: true;
  };
  confirmations: Record<string, { confirmed: true; source_id: string }>;
}

export interface CapturedValidationIssue {
  code: string;
  sectionKey?: string;
  message: string;
}

export interface CapturedValidationResult {
  passed: boolean;
  validator_version: "captured-output-validator.1";
  issues: CapturedValidationIssue[];
  exact_section_set: boolean;
  visible_content_checked: true;
  /** Compatibility field: only reference-ID membership was checked. */
  source_references_checked: true;
  source_reference_ids_checked: true;
  material_claim_grounding_checked: false;
  grounding_scope: "reference_id_membership_only";
  instruction_leakage_checked: true;
}

export class CapturedOperationInputError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "CapturedOperationInputError";
  }
}

export function isFirstCapturedTemplateId(
  value: string,
): value is FirstCapturedTemplateId {
  return (FIRST_CAPTURED_TEMPLATE_IDS as readonly string[]).includes(value);
}

export function capturedTemplate(
  templateId: string,
): CapturedTemplateContract | null {
  if (!isFirstCapturedTemplateId(templateId)) return null;
  return CAPTURED_DOCUMENT_LEDGER.templates[templateId] ?? null;
}

function hasValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(hasValue);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(hasValue);
  }
  return false;
}

function snapshotSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function relevantInputs(
  template: CapturedTemplateContract,
): readonly CapturedInputContract[] {
  return [...template.requiredInputs, ...template.optionalInputs];
}

function sectionBlockers(
  section: CapturedSectionContract,
  missingRequired: ReadonlySet<string>,
): boolean {
  return section.dependsOnInputs.some((key) => missingRequired.has(key));
}

export function planCapturedInputs(
  templateId: string,
  rawInputValues: unknown,
): CapturedInputPlan {
  const template = capturedTemplate(templateId);
  if (!template) {
    throw new CapturedOperationInputError(
      "TEMPLATE_OUTSIDE_FIRST_CAPTURED_COHORT",
    );
  }
  if (
    !rawInputValues ||
    typeof rawInputValues !== "object" ||
    Array.isArray(rawInputValues)
  ) {
    throw new CapturedOperationInputError("CAPTURED_INPUT_VALUES_REQUIRED");
  }

  const requested = rawInputValues as Record<string, unknown>;
  const allowedKeys = new Set(
    relevantInputs(template).map((input) => input.key),
  );
  const inputValues = Object.fromEntries(
    Object.entries(requested).filter(([key, value]) =>
      allowedKeys.has(key) && hasValue(value)
    ),
  );
  if (snapshotSize(inputValues) > MAX_INPUT_SNAPSHOT_BYTES) {
    throw new CapturedOperationInputError("CAPTURED_INPUT_VALUES_TOO_LARGE");
  }

  const unresolvedInputKeys = template.requiredInputs
    .filter((input) => !hasValue(inputValues[input.key]))
    .map((input) => input.key)
    .sort();
  const missingRequired = new Set(unresolvedInputKeys);
  const blockedSectionKeys = template.sections
    .filter((section) => sectionBlockers(section, missingRequired))
    .map((section) => section.sectionKey);
  const blocked = new Set(blockedSectionKeys);
  const safeSectionKeys = template.sections
    .map((section) => section.sectionKey)
    .filter((key) => !blocked.has(key));

  const sources = Object.entries(inputValues).map(([key, value]) => ({
    id: `input:${key}`,
    input_key: key,
    source_type: "confirmed_request_input" as const,
    value,
  }));
  const confirmations = Object.fromEntries(
    sources.map((source) => [
      source.input_key,
      { confirmed: true as const, source_id: source.id },
    ]),
  );

  return {
    templateId: templateId as FirstCapturedTemplateId,
    template,
    inputValues,
    safeSectionKeys,
    blockedSectionKeys,
    unresolvedInputKeys,
    sourceSnapshot: { sources },
    evidenceSnapshot: {
      permitted_source_ids: sources.map((source) => source.id),
      material_claims_require_source_reference: true,
    },
    confirmations,
  };
}

export function capturedDocumentOutputSchema(
  plan: CapturedInputPlan,
): StrictOutputSchema {
  return {
    name: "prompted_captured_document",
    version: `${plan.templateId}.captured-output.1`,
    schema: {
      type: "object",
      properties: {
        sections: {
          type: "array",
          minItems: plan.template.sections.length,
          maxItems: plan.template.sections.length,
          items: {
            type: "object",
            properties: {
              section_key: {
                type: "string",
                enum: plan.template.sections.map((section) =>
                  section.sectionKey
                ),
              },
              content: { type: "string", maxLength: MAX_SECTION_CONTENT },
              state: { type: "string", enum: [...OUTPUT_STATES] },
              source_references: {
                type: "array",
                items: { type: "string", maxLength: 160 },
                maxItems: 32,
              },
            },
            required: [
              "section_key",
              "content",
              "state",
              "source_references",
            ],
            additionalProperties: false,
          },
        },
      },
      required: ["sections"],
      additionalProperties: false,
    },
  };
}

function promptContract(template: CapturedTemplateContract) {
  return {
    template_id: template.templateId,
    display_name: template.displayName,
    user_intent: template.userIntent,
    risk_level: template.riskLevel,
    source_policy: template.sourcePolicy,
    sections: template.sections.map((section) => ({
      section_key: section.sectionKey,
      title: section.title,
      required: section.required,
      purpose: section.purpose,
      depends_on_inputs: section.dependsOnInputs,
      output_type: section.outputType,
      missing_information_behaviour: section.missingInformationBehaviour,
      minimum_viable_output: section.minimumViableOutput,
      quality: section.qualityExpectation,
      forbidden_content: section.forbiddenContent,
    })),
  };
}

export function capturedDocumentSystemPrompt(
  plan: CapturedInputPlan,
  review = false,
): string {
  return [
    "You are TED's protected document intelligence engine.",
    `The immutable captured template is ${plan.templateId}.`,
    "Return only the strict structured result requested by the response schema.",
    "Use only facts in confirmed_inputs. Never invent, infer, generalise, or silently fill a missing material fact.",
    "Every final section must list the exact input:<key> references supporting its material claims.",
    "Use neutral_fallback only when the contract explicitly permits it, with source reference system:neutral-fallback.",
    "Use omitted_optional only for an optional section and return empty content and no source references.",
    "Never copy instructions, benchmarks, schema text, or source-control metadata into the document.",
    review
      ? "This is a conditional high-depth repair pass. Correct every supplied validation issue while preserving supported wording."
      : "Write polished user-ready wording at the contract's required depth.",
  ].join("\n");
}

export function capturedDocumentUserMessage(
  plan: CapturedInputPlan,
  prior?: { output: unknown; issues: CapturedValidationIssue[] },
): string {
  return JSON.stringify({
    contract: promptContract(plan.template),
    confirmed_inputs: plan.inputValues,
    permitted_source_ids: plan.evidenceSnapshot.permitted_source_ids,
    prior_output: prior?.output,
    validation_issues: prior?.issues,
  });
}

function asSectionOutput(value: unknown): CapturedSectionOutput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const section = value as Record<string, unknown>;
  if (
    typeof section.section_key !== "string" ||
    typeof section.content !== "string" ||
    !OUTPUT_STATES.includes(section.state as CapturedReadySectionState) ||
    !Array.isArray(section.source_references) ||
    !section.source_references.every((source) => typeof source === "string")
  ) {
    return null;
  }
  return {
    section_key: section.section_key,
    content: section.content,
    state: section.state as CapturedReadySectionState,
    source_references: section.source_references as string[],
  };
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function bulletCount(value: string): number {
  return value.split(/\r?\n/).filter((line) =>
    /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(line)
  ).length;
}

function hasInstructionLeakage(value: string): boolean {
  return /(?:\bTODO\b|TED_PLACEHOLDER|prompted:template-draft|system prompt|response schema|as an AI|ignore (?:all )?(?:prior|previous) instructions)/i
    .test(value);
}

function allowedReferences(
  plan: CapturedInputPlan,
  section: CapturedSectionContract,
): Set<string> {
  const refs = section.dependsOnInputs
    .filter((key) => hasValue(plan.inputValues[key]))
    .map((key) => `input:${key}`);
  if (section.missingInformationBehaviour === "useNeutralFallback") {
    refs.push("system:neutral-fallback");
  }
  return new Set(refs);
}

export function validateCapturedDocumentOutput(
  plan: CapturedInputPlan,
  raw: unknown,
): { sections: CapturedSectionOutput[]; validation: CapturedValidationResult } {
  const issues: CapturedValidationIssue[] = [];
  const rawSections = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).sections
    : null;
  const sections = Array.isArray(rawSections)
    ? rawSections.map(asSectionOutput).filter((
      value,
    ): value is CapturedSectionOutput => value !== null)
    : [];
  if (!Array.isArray(rawSections) || sections.length !== rawSections.length) {
    issues.push({
      code: "invalid_output_shape",
      message: "Every section must match the strict output shape.",
    });
  }

  const expectedKeys = plan.template.sections.map((section) =>
    section.sectionKey
  );
  const actualKeys = sections.map((section) => section.section_key);
  const exactSectionSet = actualKeys.length === expectedKeys.length &&
    new Set(actualKeys).size === actualKeys.length &&
    expectedKeys.every((key) => actualKeys.includes(key));
  if (!exactSectionSet) {
    issues.push({
      code: "section_set_mismatch",
      message: "Output must contain every ledger section exactly once.",
    });
  }

  for (const contract of plan.template.sections) {
    const section = sections.find((candidate) =>
      candidate.section_key === contract.sectionKey
    );
    if (!section) continue;
    const issue = (code: string, message: string) =>
      issues.push({ code, sectionKey: contract.sectionKey, message });

    if (section.content.length > MAX_SECTION_CONTENT) {
      issue("section_too_large", "Section content exceeds the captured limit.");
    }
    if (contract.required && section.state === "omitted_optional") {
      issue(
        "required_section_omitted",
        "A required section cannot be omitted.",
      );
    }
    if (!contract.required && section.state === "omitted_optional") {
      if (section.content.trim() || section.source_references.length > 0) {
        issue(
          "omitted_section_has_content",
          "An omitted optional section must be empty.",
        );
      }
      continue;
    }
    if (isVisiblyEmpty(section.content)) {
      issue(
        "blank_output",
        "A generated or fallback section needs visible content.",
      );
    }
    if (hasInstructionLeakage(section.content)) {
      issue(
        "instruction_leakage",
        "Instruction or scaffold wording is forbidden.",
      );
    }

    const permitted = allowedReferences(plan, contract);
    if (section.state === "neutral_fallback") {
      if (
        contract.missingInformationBehaviour !== "useNeutralFallback" ||
        section.source_references.length !== 1 ||
        section.source_references[0] !== "system:neutral-fallback"
      ) {
        issue(
          "invalid_neutral_fallback",
          "Neutral fallback is not permitted or is not explicitly sourced.",
        );
      }
    } else {
      if (section.source_references.length === 0) {
        issue(
          "missing_source_reference",
          "Final wording requires at least one source reference.",
        );
      }
      for (const source of section.source_references) {
        if (!permitted.has(source)) {
          issue(
            "unsupported_source_reference",
            `Source ${source} is not allowed for this section.`,
          );
        }
      }
    }

    if (section.state === "final") {
      const minWords = contract.minimumViableOutput.minWords;
      const minBullets = contract.minimumViableOutput.minBullets;
      if (minWords && wordCount(section.content) < minWords) {
        issue(
          "below_minimum_depth",
          `Section requires at least ${minWords} words.`,
        );
      }
      if (minBullets && bulletCount(section.content) < minBullets) {
        issue(
          "below_minimum_depth",
          `Section requires at least ${minBullets} list items.`,
        );
      }
    }
  }

  return {
    sections,
    validation: {
      passed: issues.length === 0,
      validator_version: "captured-output-validator.1",
      issues,
      exact_section_set: exactSectionSet,
      visible_content_checked: true,
      source_references_checked: true,
      source_reference_ids_checked: true,
      material_claim_grounding_checked: false,
      grounding_scope: "reference_id_membership_only",
      instruction_leakage_checked: true,
    },
  };
}

export function capturedOutputNeedsReview(
  plan: CapturedInputPlan,
  validation: CapturedValidationResult,
): boolean {
  return plan.template.riskLevel === "high_risk" || !validation.passed;
}
