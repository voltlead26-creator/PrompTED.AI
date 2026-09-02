import { routeRequest } from "./provider-router.ts";
import {
  canonicalHttpsUrl,
  type GroundedResearchClaim,
  type ProviderWebSource,
  requestGroundedResearch,
} from "./research-grounding.ts";
import { validateSection } from "./draft-validator.ts";
import { TED_WORKFLOW_POLICY } from "./ted-workflow-policy.ts";
import {
  ARTIFACT_DRAFT_OUTPUT_SCHEMA,
  ARTIFACT_REQUIREMENTS_OUTPUT_SCHEMA,
  artifactAuditOutputSchema,
  type ArtifactDraftBlockOutput,
  validateArtifactAuditOutput,
  validateArtifactDraftOutput,
  validateArtifactRequirementsOutput,
} from "./model-output-contracts.ts";

export type ArtifactKind =
  | "document"
  | "action_plan"
  | "checklist"
  | "report"
  | "recommendation"
  | "research_brief"
  | "job_match";

export interface ArtifactBlock {
  id: string;
  artifact_id: string;
  kind: "section" | "action" | "recommendation" | "finding" | "reference";
  stable_key: string;
  parent_block_id: null;
  heading: string;
  order_index: number;
  payload: Record<string, unknown>;
  approval_status: "draft";
  completed_at: null;
  due_date: string | null;
  revision: 1;
  references: Array<Record<string, string>>;
}

export interface ArtifactDraft {
  id: string;
  outcome_id: string;
  user_id: string;
  kind: ArtifactKind;
  title: string;
  template_id: string | null;
  schema_version: 2;
  pipeline_version: "ted-v2";
  status: "ready";
  quality_status: "passed";
  current_revision: 1;
  request_id: string;
  blocks: ArtifactBlock[];
  created_at: string;
  updated_at: string;
}

export interface ArtifactPipelineInput {
  artifactId: string;
  requestId: string;
  outcomeId: string;
  userId: string;
  kind: ArtifactKind;
  templateId?: string;
  situation: string;
  context: string;
  locale: string;
  timezone: string;
  signal?: AbortSignal;
  onStage?: (stage: string) => void;
}

export interface ArtifactGroundingSnapshot {
  capturedAt: string;
  claims: GroundedResearchClaim[];
  sources: ProviderWebSource[];
}

interface ValidationIssue {
  block_key: string;
  message: string;
}

export function bindArtifactReferencesToGrounding(
  references: ArtifactDraftBlockOutput["references"],
  grounding: ArtifactGroundingSnapshot | null,
): Array<Record<string, string>> {
  if (references.length === 0) return [];
  if (!grounding) throw new Error("ARTIFACT_REFERENCE_NOT_CAPTURED");
  if (Number.isNaN(Date.parse(grounding.capturedAt))) {
    throw new Error("ARTIFACT_REFERENCE_CAPTURE_TIME_INVALID");
  }

  const sourceByUrl = new Map<string, ProviderWebSource>();
  for (const source of grounding.sources) {
    const url = canonicalHttpsUrl(source.url);
    if (url) sourceByUrl.set(url, { ...source, url });
  }
  const seen = new Set<string>();
  return references.map((reference) => {
    const url = canonicalHttpsUrl(reference.url);
    const source = url ? sourceByUrl.get(url) : undefined;
    if (!url || !source) throw new Error("ARTIFACT_REFERENCE_NOT_CAPTURED");
    if (seen.has(url)) throw new Error("ARTIFACT_REFERENCE_DUPLICATE");
    seen.add(url);

    const supportedClaims = grounding.claims.filter((claim) =>
      claim.source_ids.includes(source.id) &&
      claim.source_urls.some((claimUrl) => canonicalHttpsUrl(claimUrl) === url)
    ).map((claim) => claim.text.trim()).filter(Boolean);
    if (supportedClaims.length === 0) {
      throw new Error("ARTIFACT_REFERENCE_CLAIM_REQUIRED");
    }
    const support = [...new Set(supportedClaims)].join("\n\n").slice(0, 4_000);
    const publisher = new URL(url).hostname;
    return {
      label: source.title.trim() || publisher,
      url,
      publisher,
      retrieved_at: grounding.capturedAt,
      summary: support,
      supports: support,
    };
  });
}

function materializeBlock(
  block: ArtifactDraftBlockOutput,
  artifactId: string,
  index: number,
  grounding: ArtifactGroundingSnapshot | null,
): ArtifactBlock {
  return {
    id: crypto.randomUUID(),
    artifact_id: artifactId,
    kind: block.kind,
    stable_key: block.stable_key,
    parent_block_id: null,
    heading: block.heading,
    order_index: index,
    payload: { ...block.payload },
    approval_status: "draft",
    completed_at: null,
    due_date: block.due_date,
    revision: 1,
    references: bindArtifactReferencesToGrounding(block.references, grounding),
  };
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string =>
      typeof item === "string" && item.trim().length > 0
    )
    : [];
}

function validate(blocks: ArtifactBlock[]): ValidationIssue[] {
  if (!blocks.length) {
    return [{
      block_key: "artifact",
      message: "No usable blocks were returned.",
    }];
  }

  const issues: ValidationIssue[] = [];
  const external =
    /\b(?:visit|go to|read|see|check|refer to|look at|consult|find out from)\s+(?:the\s+|an?\s+)?(?:website|link|source|guide|page|article|portal)\b/i;

  for (const block of blocks) {
    if (!block.heading.trim()) {
      issues.push({
        block_key: block.stable_key,
        message: "Block requires a clear heading.",
      });
    }

    if (block.kind === "action") {
      const payload = block.payload;
      const instructions = strings(payload.instructions);
      if (
        !String(payload.title ?? "").trim() ||
        !String(payload.objective ?? "").trim() ||
        !instructions.length
      ) {
        issues.push({
          block_key: block.stable_key,
          message: "Action requires title, objective and instructions.",
        });
      }
      if (!strings(payload.completion_criteria).length) {
        issues.push({
          block_key: block.stable_key,
          message: "Action requires completion criteria.",
        });
      }
      if (instructions.some((instruction) => external.test(instruction))) {
        issues.push({
          block_key: block.stable_key,
          message: "Action delegates required content to an external source.",
        });
      }
      for (
        const reason of validateSection({ content: instructions.join("\n") })
      ) {
        issues.push({
          block_key: block.stable_key,
          message: `Instructions are not final wording (${reason}).`,
        });
      }
    } else {
      const text = String(block.payload.content ?? "").trim();
      if (!text) {
        issues.push({
          block_key: block.stable_key,
          message: "Block has no usable content.",
        });
      } else {
        for (const reason of validateSection({ content: text })) {
          issues.push({
            block_key: block.stable_key,
            message: `Content is not final wording (${reason}).`,
          });
        }
      }
    }

    for (const reference of block.references) {
      if (
        !String(reference.label ?? "").trim() ||
        !String(reference.url ?? "").trim() ||
        !String(reference.publisher ?? "").trim() ||
        !String(reference.retrieved_at ?? "").trim() ||
        !String(reference.summary ?? "").trim() ||
        !String(reference.supports ?? "").trim()
      ) {
        issues.push({
          block_key: block.stable_key,
          message: "Reference lacks included information or supported claim.",
        });
      }
    }
  }

  return issues;
}

function outputShape(kind: ArtifactKind): string {
  if (kind === "action_plan" || kind === "checklist") {
    return `Each block kind is "action". payload must contain title, objective, instructions[], required_inputs[], included_materials[{label,content}], dependencies[], timing ({due_date: "YYYY-MM-DD" | null, relative_timing: string | null, rationale} or null), completion_criteria[], cautions[].`;
  }
  return `Use section, recommendation, finding or reference blocks as appropriate. Each payload must contain complete finished content in "content" and an explicit missing_vital_information[] list. Do not use action payload fields.`;
}

async function generateBlocks(
  input: ArtifactPipelineInput,
  requirements: unknown,
  grounding: ArtifactGroundingSnapshot | null,
  corrections: ValidationIssue[] = [],
): Promise<{ title: string; blocks: ArtifactBlock[] }> {
  const result = await routeRequest({
    task: input.kind === "action_plan" || input.kind === "checklist"
      ? "checklist"
      : "document",
    logicalStageKey: "ted-artifact.draft",
    outputSchema: ARTIFACT_DRAFT_OUTPUT_SCHEMA,
    systemPrompt:
      `${TED_WORKFLOW_POLICY}\n\nReturn the strict structured result: {"title":"...","blocks":[{"kind":"...","stable_key":"unique_snake_case_key","heading":"...","payload":{},"due_date":null,"references":[]}]}. Each reference is exactly {"url":"..."}; use only an exact captured source URL supplied below, and use [] when there is no captured source. The server owns all other citation metadata.\n${
        outputShape(input.kind)
      }`,
    messages: [{
      role: "user",
      content: [
        `Output kind: ${input.kind}`,
        `Situation: ${input.situation}`,
        `Context: ${input.context}`,
        `Requirements: ${JSON.stringify(requirements)}`,
        grounding && `Current grounded information:\n${
          JSON.stringify({
            claims: grounding.claims,
            captured_sources: grounding.sources,
          })
        }`,
        corrections.length > 0 &&
        `Correct these validation failures without weakening or removing blocks that already satisfy the requirements:\n${
          JSON.stringify(corrections)
        }`,
      ].filter(Boolean).join("\n\n"),
    }],
    maxTokens: 5000,
    signal: input.signal,
  });
  try {
    const parsed = validateArtifactDraftOutput(
      result.structured,
      input.kind === "action_plan" || input.kind === "checklist",
    );
    return {
      title: parsed.title,
      blocks: parsed.blocks.map((block, index) =>
        materializeBlock(block, input.artifactId, index, grounding)
      ),
    };
  } catch {
    // The bounded repair pass below receives a deterministic blank-output
    // issue. No unvalidated provider field survives into the durable result.
    return { title: "Your finished output", blocks: [] };
  }
}

async function auditBlocks(
  input: ArtifactPipelineInput,
  requirements: unknown,
  draft: { title: string; blocks: ArtifactBlock[] },
): Promise<ValidationIssue[]> {
  const blockKeys = draft.blocks.map((block) => block.stable_key);
  if (blockKeys.length === 0) {
    return [{
      block_key: "artifact",
      message: "The quality audit cannot approve an empty artifact.",
    }];
  }
  const audit = await routeRequest({
    task: "edit",
    logicalStageKey: "ted-artifact.audit",
    outputSchema: artifactAuditOutputSchema(blockKeys),
    systemPrompt:
      `${TED_WORKFLOW_POLICY}\nAudit only. Return the strict structured result {"passed":true|false,"issues":[{"block_key":"...","message":"..."}]}. passed must be true exactly when issues is empty. Fail vague, incomplete, externally dependent, unsupported or instruction-like output. Use only stable block keys present in the supplied artifact.`,
    messages: [{
      role: "user",
      content: JSON.stringify({
        requirements,
        title: draft.title,
        blocks: draft.blocks,
      }),
    }],
    maxTokens: 1800,
    signal: input.signal,
  });
  let auditResult;
  try {
    auditResult = validateArtifactAuditOutput(audit.structured, blockKeys);
  } catch {
    return [{
      block_key: "artifact",
      message: "The quality audit did not return a valid approval.",
    }];
  }
  return auditResult.passed ? [] : auditResult.issues;
}

function needsGrounding(input: ArtifactPipelineInput): boolean {
  return /\b(current|today|latest|law|legal|regulation|deadline|price|rate|vacanc|government|official|medical|financial)\b/i
    .test(`${input.situation} ${input.context}`);
}

export async function runTedArtifactPipeline(
  input: ArtifactPipelineInput,
): Promise<ArtifactDraft> {
  input.onStage?.("requirements");
  const requirementsResult = await routeRequest({
    task: "intent",
    logicalStageKey: "ted-artifact.requirements",
    outputSchema: ARTIFACT_REQUIREMENTS_OUTPUT_SCHEMA,
    systemPrompt:
      `${TED_WORKFLOW_POLICY}\nReturn the strict structured result with goal, audience, outcome, confirmed_facts, constraints, urgency, missing_vital_information and required_content. Do not recommend a different output type.`,
    messages: [{
      role: "user",
      content:
        `Output kind: ${input.kind}\nSituation: ${input.situation}\nContext: ${input.context}\nLocale: ${input.locale}\nTimezone: ${input.timezone}`,
    }],
    maxTokens: 1400,
    signal: input.signal,
  });
  const requirements = validateArtifactRequirementsOutput(
    requirementsResult.structured,
  );

  let grounding: ArtifactGroundingSnapshot | null = null;
  if (needsGrounding(input)) {
    input.onStage?.("grounding");
    const grounded = await requestGroundedResearch({
      systemPrompt:
        `${TED_WORKFLOW_POLICY}\nFind only reliable current information needed for this output. Return only claims supported by web-search sources captured for this response. Every claim must cite one or more exact source URLs in source_urls.`,
      messages: [{
        role: "user",
        content:
          `${input.situation}\n${input.context}\nLocale: ${input.locale}`,
      }],
      maxTokens: 1800,
      signal: input.signal,
    });
    grounding = {
      capturedAt: new Date().toISOString(),
      claims: grounded.claims,
      sources: grounded.sources,
    };
  }

  input.onStage?.("drafting");
  let draft = await generateBlocks(input, requirements, grounding);

  input.onStage?.("validating");
  let issues = validate(draft.blocks);

  input.onStage?.("reviewing");
  issues = [...issues, ...await auditBlocks(input, requirements, draft)];

  if (issues.length > 0) {
    input.onStage?.("repairing");
    draft = await generateBlocks(input, requirements, grounding, issues);

    input.onStage?.("validating_repair");
    issues = validate(draft.blocks);

    input.onStage?.("reviewing_repair");
    issues = [...issues, ...await auditBlocks(input, requirements, draft)];
  }

  if (issues.length > 0) {
    throw new Error(
      `ARTIFACT_QUALITY_FAILED:${
        [...new Set(issues.map((issue) => issue.block_key))].join(",")
      }`,
    );
  }

  const now = new Date().toISOString();
  return {
    id: input.artifactId,
    outcome_id: input.outcomeId,
    user_id: input.userId,
    kind: input.kind,
    title: draft.title,
    template_id: input.templateId ?? null,
    schema_version: 2,
    pipeline_version: "ted-v2",
    status: "ready",
    quality_status: "passed",
    current_revision: 1,
    request_id: input.requestId,
    blocks: draft.blocks,
    created_at: now,
    updated_at: now,
  };
}
