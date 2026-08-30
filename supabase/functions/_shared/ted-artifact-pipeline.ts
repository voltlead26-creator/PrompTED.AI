import { routeRequest } from "./provider-router.ts";
import { requestGroundedResearch } from "./research-grounding.ts";
import { validateSection } from "./draft-validator.ts";
import { parseModelJson } from "./orchestration.ts";
import { TED_WORKFLOW_POLICY } from "./ted-workflow-policy.ts";

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

interface ModelBlock {
  kind?: unknown;
  stable_key?: unknown;
  heading?: unknown;
  payload?: unknown;
  due_date?: unknown;
  references?: unknown;
}

interface ValidationIssue {
  block_key: string;
  message: string;
}

function safeKey(value: string, index: number): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
    .slice(0, 72) || `block_${index + 1}`;
}

function parseBlocks(raw: unknown, artifactId: string): ArtifactBlock[] {
  const value = raw && typeof raw === "object"
    ? raw as Record<string, unknown>
    : {};
  if (!Array.isArray(value.blocks)) return [];

  return value.blocks.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const block = item as ModelBlock;
    const heading = typeof block.heading === "string"
      ? block.heading.trim()
      : "";
    const payload = block.payload && typeof block.payload === "object" &&
        !Array.isArray(block.payload)
      ? block.payload as Record<string, unknown>
      : {};
    const kind = [
        "section",
        "action",
        "recommendation",
        "finding",
        "reference",
      ].includes(String(block.kind))
      ? String(block.kind) as ArtifactBlock["kind"]
      : "section";

    return [{
      id: crypto.randomUUID(),
      artifact_id: artifactId,
      kind,
      stable_key: safeKey(
        typeof block.stable_key === "string" ? block.stable_key : heading,
        index,
      ),
      parent_block_id: null,
      heading,
      order_index: index,
      payload,
      approval_status: "draft" as const,
      completed_at: null,
      due_date: typeof block.due_date === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(block.due_date)
        ? block.due_date
        : null,
      revision: 1 as const,
      references: Array.isArray(block.references)
        ? block.references.filter((
          reference,
        ): reference is Record<string, string> =>
          Boolean(reference) && typeof reference === "object"
        )
        : [],
    }];
  });
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
      const text = String(
        block.payload.content ?? block.payload.summary ?? "",
      ).trim();
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
    return `Each block kind is "action". payload must contain title, objective, instructions[], required_inputs[], included_materials[{label,content}], dependencies[], timing ({due_date or relative_timing, rationale} or null), completion_criteria[], cautions[].`;
  }
  return `Use section, recommendation or finding blocks as appropriate. Each payload must contain complete finished content in a "content" or "summary" field.`;
}

async function generateBlocks(
  input: ArtifactPipelineInput,
  requirements: unknown,
  grounding: string,
  corrections: ValidationIssue[] = [],
): Promise<{ title: string; blocks: ArtifactBlock[] }> {
  const result = await routeRequest({
    task: input.kind === "action_plan" || input.kind === "checklist"
      ? "checklist"
      : "document",
    systemPrompt:
      `${TED_WORKFLOW_POLICY}\n\nReturn strict JSON only: {"title":"...","blocks":[{"kind":"...","stable_key":"...","heading":"...","payload":{},"due_date":null,"references":[]}]}.\n${
        outputShape(input.kind)
      }`,
    messages: [{
      role: "user",
      content: [
        `Output kind: ${input.kind}`,
        `Situation: ${input.situation}`,
        `Context: ${input.context}`,
        `Requirements: ${JSON.stringify(requirements)}`,
        grounding && `Current grounded information:\n${grounding}`,
        corrections.length > 0 &&
        `Correct these validation failures without weakening or removing blocks that already satisfy the requirements:\n${
          JSON.stringify(corrections)
        }`,
      ].filter(Boolean).join("\n\n"),
    }],
    maxTokens: 5000,
    signal: input.signal,
  });
  const parsed = parseModelJson(result.text) as Record<string, unknown> | null;
  return {
    title: typeof parsed?.title === "string"
      ? parsed.title.trim()
      : "Your finished output",
    blocks: parseBlocks(parsed, input.artifactId),
  };
}

async function auditBlocks(
  input: ArtifactPipelineInput,
  requirements: unknown,
  draft: { title: string; blocks: ArtifactBlock[] },
): Promise<ValidationIssue[]> {
  const audit = await routeRequest({
    task: "edit",
    systemPrompt:
      `${TED_WORKFLOW_POLICY}\nAudit only. Return strict JSON {"passed":true|false,"issues":[{"block_key":"...","message":"..."}]}. Fail vague, incomplete, externally dependent, unsupported or instruction-like output. Use only stable block keys present in the supplied artifact.`,
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
  const auditJson = parseModelJson(audit.text) as
    | Record<string, unknown>
    | null;
  if (auditJson?.passed === true) return [];

  if (!Array.isArray(auditJson?.issues) || auditJson.issues.length === 0) {
    return [{
      block_key: "artifact",
      message: "The quality audit did not return a valid approval.",
    }];
  }

  const validKeys = new Set(draft.blocks.map((block) => block.stable_key));
  return auditJson.issues.flatMap((issue) => {
    if (!issue || typeof issue !== "object") return [];
    const rawKey = String(
      (issue as Record<string, unknown>).block_key ?? "artifact",
    );
    return [{
      block_key: validKeys.has(rawKey) ? rawKey : "artifact",
      message: String(
        (issue as Record<string, unknown>).message ?? "Quality review failed.",
      ),
    }];
  });
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
    systemPrompt:
      `${TED_WORKFLOW_POLICY}\nReturn strict JSON with goal, audience, outcome, confirmed_facts, constraints, urgency, missing_vital_information and required_content. Do not recommend a different output type.`,
    messages: [{
      role: "user",
      content:
        `Output kind: ${input.kind}\nSituation: ${input.situation}\nContext: ${input.context}\nLocale: ${input.locale}\nTimezone: ${input.timezone}`,
    }],
    maxTokens: 1400,
    signal: input.signal,
  });
  const requirements = parseModelJson(requirementsResult.text) ?? {};

  let grounding = "";
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
    grounding = grounded.claims.map((claim) =>
      `${claim.text}\nCaptured sources: ${claim.source_urls.join(", ")}`
    ).join("\n\n");
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
