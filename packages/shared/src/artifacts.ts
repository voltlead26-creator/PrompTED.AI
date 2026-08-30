// =====================================================
// PrompTED — supporting TED artifact contract
// Primary captured documents are owned only by the immutable document ledger.
// =====================================================

export const TED_ARTIFACT_SCHEMA_VERSION = 2 as const;

export const ACTIVE_TED_ARTIFACT_KINDS = [
  "action_plan",
  "checklist",
  "report",
  "recommendation",
  "research_brief",
  "job_match",
] as const;

export type TedSupportingArtifactKind =
  (typeof ACTIVE_TED_ARTIFACT_KINDS)[number];

/** Historical rows may retain this value; new generation must not select it. */
export type TedHistoricalDocumentArtifactKind = "document";

export type TedArtifactKind =
  | TedHistoricalDocumentArtifactKind
  | TedSupportingArtifactKind;

export function isActiveTedArtifactKind(
  value: unknown,
): value is TedSupportingArtifactKind {
  return typeof value === "string" &&
    (ACTIVE_TED_ARTIFACT_KINDS as readonly string[]).includes(value);
}

export type TedArtifactStatus = "draft" | "ready" | "needs_review" | "approved" | "archived";
export type TedBlockKind = "section" | "action" | "recommendation" | "finding" | "reference";
export type TedApprovalStatus = "draft" | "approved" | "locked";

export interface TedSupportingReference {
  label: string;
  url: string;
  publisher: string;
  retrieved_at: string;
  supports: string;
  /** The useful information must be included here; a link never replaces content. */
  summary: string;
}

export interface TedIncludedMaterial {
  label: string;
  content: string;
}

export interface TedActionTiming {
  due_date?: string;
  relative_timing?: string;
  rationale: string;
}

export interface TedActionStepPayload {
  title: string;
  objective: string;
  instructions: string[];
  required_inputs: string[];
  included_materials: TedIncludedMaterial[];
  dependencies: string[];
  timing: TedActionTiming | null;
  completion_criteria: string[];
  cautions: string[];
}

export interface TedTextBlockPayload {
  content: string;
  missing_vital_information?: string[];
}

export type TedArtifactBlockPayload = TedActionStepPayload | TedTextBlockPayload | Record<string, unknown>;

export interface TedArtifactBlock {
  id: string;
  artifact_id: string;
  kind: TedBlockKind;
  stable_key: string;
  parent_block_id: string | null;
  heading: string;
  order_index: number;
  payload: TedArtifactBlockPayload;
  approval_status: TedApprovalStatus;
  completed_at: string | null;
  due_date: string | null;
  revision: number;
  references: TedSupportingReference[];
}

export interface TedArtifact {
  id: string;
  outcome_id: string;
  user_id: string;
  kind: TedArtifactKind;
  title: string;
  template_id: string | null;
  schema_version: typeof TED_ARTIFACT_SCHEMA_VERSION;
  pipeline_version: string;
  status: TedArtifactStatus;
  quality_status: "pending" | "passed" | "failed";
  current_revision: number;
  request_id: string;
  blocks: TedArtifactBlock[];
  created_at: string;
  updated_at: string;
}

export type TedPipelineStage =
  | "context"
  | "requirements"
  | "grounding"
  | "drafting"
  | "validating"
  | "reviewing"
  | "repairing"
  | "saving"
  | "complete";

export type TedArtifactEvent =
  | { type: "status"; stage: TedPipelineStage }
  | { type: "block"; block: TedArtifactBlock }
  | { type: "quality"; status: "passed" | "repairing" }
  | { type: "complete"; artifact: TedArtifact }
  | { type: "error"; code: string; retryable: boolean };

export interface TedValidationFinding {
  code:
    | "missing_required_field"
    | "not_actionable"
    | "external_content_dependency"
    | "unsupported_claim"
    | "missing_reference_summary"
    | "invalid_sequence"
    | "missing_completion_criteria"
    | "instruction_leakage"
    | "blank_output";
  block_key: string;
  message: string;
}

const externalDependency = /\b(?:visit|read|see|check|refer to|look at|find out from)\s+(?:the\s+)?(?:website|link|source|guide|page|article)\b/i;
const instructionLeakage = /\b(?:this section will|the user should|here you would|consider including|insert|replace this scaffold|draft scaffold|no matching sections)\b/i;

function cleanStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

export function isTedActionStepPayload(value: unknown): value is TedActionStepPayload {
  if (!value || typeof value !== "object") return false;
  const action = value as Partial<TedActionStepPayload>;
  return typeof action.title === "string" && typeof action.objective === "string" &&
    Array.isArray(action.instructions) && Array.isArray(action.required_inputs) &&
    Array.isArray(action.included_materials) && Array.isArray(action.dependencies) &&
    Array.isArray(action.completion_criteria) && Array.isArray(action.cautions);
}

export function validateTedActionStep(
  stableKey: string,
  payload: unknown,
  references: TedSupportingReference[] = [],
): TedValidationFinding[] {
  const findings: TedValidationFinding[] = [];
  if (!isTedActionStepPayload(payload)) {
    return [{ code: "missing_required_field", block_key: stableKey, message: "The action does not match the required structure." }];
  }

  const title = payload.title.trim();
  const objective = payload.objective.trim();
  const instructions = cleanStrings(payload.instructions);
  const completion = cleanStrings(payload.completion_criteria);
  if (!title || !objective || instructions.length === 0) {
    findings.push({ code: "missing_required_field", block_key: stableKey, message: "Every action needs a title, objective and instructions." });
  }
  if (completion.length === 0) {
    findings.push({ code: "missing_completion_criteria", block_key: stableKey, message: "Every action needs a clear completion test." });
  }
  if (instructions.some((instruction) => externalDependency.test(instruction))) {
    findings.push({ code: "external_content_dependency", block_key: stableKey, message: "Required guidance cannot be delegated to an external source." });
  }
  const allText = [title, objective, ...instructions, ...completion].join(" ");
  if (instructionLeakage.test(allText)) {
    findings.push({ code: "instruction_leakage", block_key: stableKey, message: "The action contains drafting instructions instead of finished guidance." });
  }
  for (const reference of references) {
    if (!reference.label.trim() || !reference.url.trim() || !reference.publisher.trim() ||
      !reference.retrieved_at.trim() || !reference.summary.trim() || !reference.supports.trim()) {
      findings.push({ code: "missing_reference_summary", block_key: stableKey, message: "References must include the useful information and the claim they support." });
    }
  }
  return findings;
}

export function validateTedArtifactBlocks(blocks: TedArtifactBlock[]): TedValidationFinding[] {
  if (blocks.length === 0) {
    return [{ code: "blank_output", block_key: "artifact", message: "The artifact contains no usable blocks." }];
  }
  return blocks.flatMap((block) => {
    if (block.kind === "action") return validateTedActionStep(block.stable_key, block.payload, block.references);
    const content = "content" in block.payload ? String(block.payload.content ?? "").trim() : "";
    if (!content) return [{ code: "blank_output" as const, block_key: block.stable_key, message: "The block is blank." }];
    if (instructionLeakage.test(content)) return [{ code: "instruction_leakage" as const, block_key: block.stable_key, message: "The block contains drafting instructions." }];
    return [];
  });
}
