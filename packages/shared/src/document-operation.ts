import { isVisiblyEmpty } from "./visible-content.ts";

/**
 * The first captured cohort is deliberately closed. Expanding this tuple is a
 * release decision because it changes which documents may use captured writes.
 */
export const FIRST_CAPTURED_TEMPLATE_IDS = [
  "resume",
  "selection-criteria-response",
  "moving-house-checklist",
  "complaint-letter",
  "incident-near-miss-report",
] as const;

export type FirstCapturedTemplateId = (typeof FIRST_CAPTURED_TEMPLATE_IDS)[number];

const FIRST_CAPTURED_TEMPLATE_UUID_BY_ID: Readonly<
  Record<FirstCapturedTemplateId, string>
> = Object.freeze({
  resume: "11111111-0000-4000-8000-000000000001",
  "selection-criteria-response": "11111111-0000-4000-8000-000000000024",
  "incident-near-miss-report": "22222222-0000-4000-8000-000000000072",
  "moving-house-checklist": "22222222-0000-4000-8000-000000000080",
  "complaint-letter": "22222222-0000-4000-8000-000000000082",
});

/** Resolve only the closed first cohort without importing the full catalogue. */
export function resolveFirstCapturedTemplateId(
  value: string | null | undefined,
): FirstCapturedTemplateId | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  for (const templateId of FIRST_CAPTURED_TEMPLATE_IDS) {
    if (
      normalized === templateId ||
      normalized === FIRST_CAPTURED_TEMPLATE_UUID_BY_ID[templateId]
    ) {
      return templateId;
    }
  }
  return null;
}

export const DURABLE_GENERATION_OPERATION_STATES = [
  "accepted",
  "awaiting_clarification",
  "awaiting_capacity",
  "generating",
  "validating",
  "persisting",
  "ready_for_review",
  "retryable_failure",
  "terminal_failure",
  "cancelled",
] as const;

export type DurableGenerationOperationState = (typeof DURABLE_GENERATION_OPERATION_STATES)[number];

export const GENERATED_LEDGER_SECTION_STATES = [
  "final",
  "needs_clarification",
  "interactive_placeholder",
  "neutral_fallback",
  "omitted_optional",
  "failed_validation",
] as const;

export type GeneratedLedgerSectionState = (typeof GENERATED_LEDGER_SECTION_STATES)[number];

export const SEMANTIC_OPENAI_ROUTES = ["fast", "deep", "research", "review"] as const;

export type SemanticOpenAIRoute = (typeof SEMANTIC_OPENAI_ROUTES)[number];
export type OpenAIReasoningEffort = "low" | "medium" | "high";
export type OpenAITool = "web_search" | "file_search";

export interface OpenAIRouteFallbackSnapshot {
  readonly fromModel: string;
  readonly reason: "transient_error" | "rate_limit" | "capacity";
  readonly evaluatedConfigurationVersion: string;
}

/** Effective server-owned route captured before provider work begins. */
export interface OpenAIRouteSnapshot {
  readonly provider: "openai";
  readonly semanticRoute: SemanticOpenAIRoute;
  readonly model: string;
  readonly reasoningEffort: OpenAIReasoningEffort;
  readonly routingVersion: string;
  readonly structuredOutputSchemaVersion: string;
  readonly allowedTools: readonly OpenAITool[];
  readonly timeoutMs: number;
  readonly maxAttempts: 1 | 2;
  readonly background: boolean;
  readonly store: false;
  readonly fallback: OpenAIRouteFallbackSnapshot | null;
}

/**
 * Historical provenance is intentionally open-valued. It can be rendered and
 * audited but cannot satisfy the narrower active OpenAIRouteSnapshot contract.
 */
export interface HistoricalProviderProvenance {
  readonly provider: string;
  readonly model: string | null;
  readonly providerOperationId: string | null;
  readonly recordedAt: string | null;
}

export interface DurableGenerationOperation {
  readonly contractVersion: string;
  readonly operationId: string;
  readonly operationRevision: number;
  readonly idempotencyReference: string;
  readonly documentId: string;
  readonly acceptedDocumentRevision: number;
  readonly acceptedInputRevision: number;
  readonly templateId: FirstCapturedTemplateId;
  readonly ledgerVersion: string;
  readonly generationSnapshotId: string;
  readonly status: DurableGenerationOperationState;
  readonly safeSectionKeys: readonly string[];
  readonly blockedSectionKeys: readonly string[];
  readonly retryable: boolean;
  readonly reconnectPath: string;
  readonly route: OpenAIRouteSnapshot;
}

export interface CapturedSectionRevision {
  readonly sectionKey: string;
  readonly required: boolean;
  readonly state: GeneratedLedgerSectionState;
  readonly content: string | null;
  readonly documentRevision: number;
  readonly sectionRevision: number;
  readonly blockingIssueIds: readonly string[];
}

export interface RevisionBoundApproval {
  readonly approvalId: string;
  readonly documentId: string;
  readonly operationId: string;
  readonly generationSnapshotId: string;
  readonly ledgerVersion: string;
  readonly approvedRevision: number;
  readonly revisionSha256: string;
  readonly approvedByUserId: string;
  readonly approvedAt: string;
}

export type CapturedExportFormat = "docx" | "pdf" | "xlsx";

export interface RevisionBoundExport {
  readonly exportId: string;
  readonly exportIdempotencyReference: string;
  readonly approvalId: string;
  readonly documentId: string;
  readonly operationId: string;
  readonly ledgerVersion: string;
  readonly approvedRevision: number;
  readonly format: CapturedExportFormat;
  readonly rendererVersion: string;
  readonly validationVersion: string;
  readonly artifactId: string;
  readonly artifactSha256: string;
  readonly createdAt: string;
}

export type CohortActivationMode = "legacy" | "shadow" | "captured";
export type CohortPointerChangeKind = "activate" | "rollback";

/**
 * Append-only activation record. Rollback creates a successor pointing at the
 * prior record; it never mutates or deletes the captured ledger or documents.
 */
export interface CohortActivationPointer {
  readonly pointerId: string;
  readonly pointerRevision: number;
  readonly changeKind: CohortPointerChangeKind;
  readonly mode: CohortActivationMode;
  readonly environment: string;
  readonly userCohort: string;
  readonly workflowIds: readonly string[];
  readonly templateIds: readonly FirstCapturedTemplateId[];
  readonly ledgerVersion: string;
  readonly routingVersion: string;
  readonly previousPointerId: string | null;
  readonly rollbackOfPointerId: string | null;
  readonly createdAt: string;
}

export type DocumentOperationValidationIssueCode =
  | "invalid_contract"
  | "missing_identity"
  | "invalid_revision"
  | "invalid_timestamp"
  | "invalid_sha256"
  | "active_provider_not_openai"
  | "invalid_semantic_route"
  | "invalid_route_reasoning"
  | "invalid_route_configuration"
  | "provider_storage_enabled"
  | "invalid_route_tool"
  | "research_tool_on_non_research_route"
  | "fallback_not_fast_route"
  | "invalid_historical_provenance"
  | "invalid_operation_state"
  | "template_not_in_first_cohort"
  | "invalid_section_partition"
  | "section_partition_overlap"
  | "retryability_mismatch"
  | "invalid_reconnect_path"
  | "ready_operation_has_blockers"
  | "invalid_section_state"
  | "required_section_omitted"
  | "omitted_section_has_content"
  | "output_state_is_blank"
  | "blocked_state_without_issue"
  | "final_state_has_blockers"
  | "invalid_approval"
  | "invalid_export"
  | "export_approval_mismatch"
  | "activation_cohort_mismatch"
  | "invalid_activation_pointer"
  | "invalid_rollback_pointer"
  | "pointer_ancestry_mismatch"
  | "pointer_revision_mismatch"
  | "pointer_time_regression";

export interface DocumentOperationValidationIssue {
  code: DocumentOperationValidationIssueCode;
  path: string;
  message: string;
}

type UnknownRecord = Record<string, unknown>;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const ROUTE_REASONING: Record<SemanticOpenAIRoute, OpenAIReasoningEffort> = {
  fast: "low",
  deep: "medium",
  research: "medium",
  review: "high",
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return hasText(value) && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

function isOneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isTextList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(hasText);
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function issue(
  code: DocumentOperationValidationIssueCode,
  path: string,
  message: string,
): DocumentOperationValidationIssue {
  return { code, path, message };
}

function validateRequiredTextFields(
  value: UnknownRecord,
  fields: readonly string[],
  prefix: string,
): DocumentOperationValidationIssue[] {
  return fields.flatMap((field) =>
    hasText(value[field])
      ? []
      : [issue("missing_identity", `${prefix}${field}`, `${field} is required`)],
  );
}

export function validateOpenAIRouteSnapshot(value: unknown): DocumentOperationValidationIssue[] {
  if (!isRecord(value)) {
    return [issue("invalid_contract", "route", "route must be an object")];
  }

  const issues = validateRequiredTextFields(
    value,
    ["model", "routingVersion", "structuredOutputSchemaVersion"],
    "route.",
  );

  if (value.provider !== "openai") {
    issues.push(
      issue(
        "active_provider_not_openai",
        "route.provider",
        "active inference routes must use OpenAI",
      ),
    );
  }
  if (!isOneOf(value.semanticRoute, SEMANTIC_OPENAI_ROUTES)) {
    issues.push(
      issue(
        "invalid_semantic_route",
        "route.semanticRoute",
        "semanticRoute must be fast, deep, research, or review",
      ),
    );
  } else if (value.reasoningEffort !== ROUTE_REASONING[value.semanticRoute]) {
    issues.push(
      issue(
        "invalid_route_reasoning",
        "route.reasoningEffort",
        `${value.semanticRoute} requires ${ROUTE_REASONING[value.semanticRoute]} reasoning in this routing contract`,
      ),
    );
  }
  if (value.store !== false) {
    issues.push(
      issue("provider_storage_enabled", "route.store", "captured routes require store:false"),
    );
  }
  if (
    typeof value.background !== "boolean" ||
    !Number.isInteger(value.timeoutMs) ||
    (value.timeoutMs as number) < 1_000 ||
    (value.timeoutMs as number) > 600_000 ||
    (value.maxAttempts !== 1 && value.maxAttempts !== 2)
  ) {
    issues.push(
      issue(
        "invalid_route_configuration",
        "route",
        "route requires background, a bounded timeout, and one or two attempts",
      ),
    );
  }

  const allowedTools = value.allowedTools;
  if (
    !Array.isArray(allowedTools) ||
    !unique(allowedTools.filter(hasText)) ||
    allowedTools.some((tool) => tool !== "web_search" && tool !== "file_search")
  ) {
    issues.push(
      issue(
        "invalid_route_tool",
        "route.allowedTools",
        "allowedTools must be a unique list of approved OpenAI tools",
      ),
    );
  } else if (allowedTools.includes("web_search") && value.semanticRoute !== "research") {
    issues.push(
      issue(
        "research_tool_on_non_research_route",
        "route.allowedTools",
        "web search is reserved for the approved research route",
      ),
    );
  }

  if (value.fallback !== null) {
    if (value.semanticRoute !== "fast") {
      issues.push(
        issue(
          "fallback_not_fast_route",
          "route.fallback",
          "only the evaluated fast route may use an OpenAI-only fallback",
        ),
      );
    }
    if (
      !isRecord(value.fallback) ||
      !hasText(value.fallback.fromModel) ||
      !hasText(value.fallback.evaluatedConfigurationVersion) ||
      !isOneOf(value.fallback.reason, ["transient_error", "rate_limit", "capacity"] as const)
    ) {
      issues.push(
        issue(
          "invalid_route_configuration",
          "route.fallback",
          "fallback requires its prior model, bounded reason, and evaluated configuration version",
        ),
      );
    }
  }

  return issues;
}

export function validateHistoricalProviderProvenance(
  value: unknown,
): DocumentOperationValidationIssue[] {
  if (
    !isRecord(value) ||
    !hasText(value.provider) ||
    !(value.model === null || hasText(value.model)) ||
    !(value.providerOperationId === null || hasText(value.providerOperationId)) ||
    !(value.recordedAt === null || isIsoTimestamp(value.recordedAt))
  ) {
    return [
      issue(
        "invalid_historical_provenance",
        "historicalProviderProvenance",
        "historical provenance requires its recorded provider and valid optional values",
      ),
    ];
  }
  return [];
}

export function validateDurableGenerationOperation(
  value: unknown,
): DocumentOperationValidationIssue[] {
  if (!isRecord(value)) {
    return [issue("invalid_contract", "operation", "operation must be an object")];
  }
  const issues = validateRequiredTextFields(
    value,
    [
      "contractVersion",
      "operationId",
      "idempotencyReference",
      "documentId",
      "ledgerVersion",
      "generationSnapshotId",
    ],
    "operation.",
  );

  for (const field of [
    "operationRevision",
    "acceptedDocumentRevision",
    "acceptedInputRevision",
  ] as const) {
    if (!isPositiveInteger(value[field])) {
      issues.push(
        issue("invalid_revision", `operation.${field}`, `${field} must be a positive integer`),
      );
    }
  }
  if (!isOneOf(value.templateId, FIRST_CAPTURED_TEMPLATE_IDS)) {
    issues.push(
      issue(
        "template_not_in_first_cohort",
        "operation.templateId",
        "captured operations are limited to the first five-template cohort",
      ),
    );
  }
  if (!isOneOf(value.status, DURABLE_GENERATION_OPERATION_STATES)) {
    issues.push(
      issue(
        "invalid_operation_state",
        "operation.status",
        "operation status is not a durable generation state",
      ),
    );
  }

  const safe = value.safeSectionKeys;
  const blocked = value.blockedSectionKeys;
  if (!isTextList(safe) || !isTextList(blocked) || !unique(safe) || !unique(blocked)) {
    issues.push(
      issue(
        "invalid_section_partition",
        "operation.safeSectionKeys",
        "safe and blocked section keys must be unique non-empty strings",
      ),
    );
  } else if (safe.some((key) => blocked.includes(key))) {
    issues.push(
      issue(
        "section_partition_overlap",
        "operation.blockedSectionKeys",
        "a section cannot be both safe and blocked",
      ),
    );
  }
  if (
    typeof value.retryable !== "boolean" ||
    value.retryable !== (value.status === "retryable_failure")
  ) {
    issues.push(
      issue(
        "retryability_mismatch",
        "operation.retryable",
        "only retryable_failure exposes retryable:true",
      ),
    );
  }
  if (!hasText(value.reconnectPath) || !/^\/(?!\/)[^\s]*$/.test(value.reconnectPath)) {
    issues.push(
      issue(
        "invalid_reconnect_path",
        "operation.reconnectPath",
        "reconnectPath must be an owner-safe relative application path",
      ),
    );
  }
  if (value.status === "ready_for_review" && Array.isArray(blocked) && blocked.length > 0) {
    issues.push(
      issue(
        "ready_operation_has_blockers",
        "operation.blockedSectionKeys",
        "ready-for-review operations cannot retain blocked sections",
      ),
    );
  }
  issues.push(...validateOpenAIRouteSnapshot(value.route));
  return issues;
}

export function validateCapturedSectionRevision(
  value: unknown,
): DocumentOperationValidationIssue[] {
  if (!isRecord(value)) {
    return [issue("invalid_contract", "section", "section revision must be an object")];
  }
  const issues = validateRequiredTextFields(value, ["sectionKey"], "section.");
  for (const field of ["documentRevision", "sectionRevision"] as const) {
    if (!isPositiveInteger(value[field])) {
      issues.push(
        issue("invalid_revision", `section.${field}`, `${field} must be a positive integer`),
      );
    }
  }
  if (typeof value.required !== "boolean") {
    issues.push(issue("invalid_contract", "section.required", "required must be explicit"));
  }
  if (!isOneOf(value.state, GENERATED_LEDGER_SECTION_STATES)) {
    issues.push(
      issue(
        "invalid_section_state",
        "section.state",
        "section state is not part of the ledger contract",
      ),
    );
  }
  if (!isTextList(value.blockingIssueIds) || !unique(value.blockingIssueIds)) {
    issues.push(
      issue(
        "invalid_contract",
        "section.blockingIssueIds",
        "blocking issue identities must be a unique string list",
      ),
    );
  }

  if (value.required === true && value.state === "omitted_optional") {
    issues.push(
      issue("required_section_omitted", "section.state", "required sections cannot be omitted"),
    );
  }
  if (
    value.state === "omitted_optional" &&
    typeof value.content === "string" &&
    !isVisiblyEmpty(value.content)
  ) {
    issues.push(
      issue(
        "omitted_section_has_content",
        "section.content",
        "omitted optional sections cannot retain hidden output content",
      ),
    );
  }
  if (
    value.state === "final" ||
    value.state === "interactive_placeholder" ||
    value.state === "neutral_fallback"
  ) {
    if (typeof value.content !== "string" || isVisiblyEmpty(value.content)) {
      issues.push(
        issue(
          "output_state_is_blank",
          "section.content",
          "output-bearing section states require visible content",
        ),
      );
    }
  } else if (!(value.content === null || typeof value.content === "string")) {
    issues.push(
      issue("invalid_contract", "section.content", "section content must be text or null"),
    );
  }
  if (
    (value.state === "needs_clarification" || value.state === "failed_validation") &&
    (!Array.isArray(value.blockingIssueIds) || value.blockingIssueIds.length === 0)
  ) {
    issues.push(
      issue(
        "blocked_state_without_issue",
        "section.blockingIssueIds",
        "blocked states require durable issue identity",
      ),
    );
  }
  if (
    value.state === "final" &&
    Array.isArray(value.blockingIssueIds) &&
    value.blockingIssueIds.length > 0
  ) {
    issues.push(
      issue(
        "final_state_has_blockers",
        "section.blockingIssueIds",
        "final sections cannot retain blocking issues",
      ),
    );
  }
  return issues;
}

export function validateRevisionBoundApproval(value: unknown): DocumentOperationValidationIssue[] {
  if (!isRecord(value)) {
    return [issue("invalid_approval", "approval", "approval must be an object")];
  }
  const issues = validateRequiredTextFields(
    value,
    [
      "approvalId",
      "documentId",
      "operationId",
      "generationSnapshotId",
      "ledgerVersion",
      "approvedByUserId",
    ],
    "approval.",
  );
  if (!isPositiveInteger(value.approvedRevision)) {
    issues.push(
      issue(
        "invalid_revision",
        "approval.approvedRevision",
        "approvedRevision must be a positive integer",
      ),
    );
  }
  if (!hasText(value.revisionSha256) || !SHA256_HEX.test(value.revisionSha256)) {
    issues.push(
      issue(
        "invalid_sha256",
        "approval.revisionSha256",
        "approval requires the exact lowercase revision SHA-256",
      ),
    );
  }
  if (!isIsoTimestamp(value.approvedAt)) {
    issues.push(
      issue("invalid_timestamp", "approval.approvedAt", "approvedAt must be an ISO timestamp"),
    );
  }
  return issues;
}

export function validateRevisionBoundExport(
  value: unknown,
  approval?: unknown,
): DocumentOperationValidationIssue[] {
  if (!isRecord(value)) {
    return [issue("invalid_export", "export", "export must be an object")];
  }
  const issues = validateRequiredTextFields(
    value,
    [
      "exportId",
      "exportIdempotencyReference",
      "approvalId",
      "documentId",
      "operationId",
      "ledgerVersion",
      "rendererVersion",
      "validationVersion",
      "artifactId",
    ],
    "export.",
  );
  if (!isPositiveInteger(value.approvedRevision)) {
    issues.push(
      issue(
        "invalid_revision",
        "export.approvedRevision",
        "approvedRevision must be a positive integer",
      ),
    );
  }
  if (!isOneOf(value.format, ["docx", "pdf", "xlsx"] as const)) {
    issues.push(
      issue(
        "invalid_export",
        "export.format",
        "captured exports must be real docx, pdf, or template-approved xlsx artifacts",
      ),
    );
  }
  if (!hasText(value.artifactSha256) || !SHA256_HEX.test(value.artifactSha256)) {
    issues.push(
      issue(
        "invalid_sha256",
        "export.artifactSha256",
        "export requires the immutable artifact SHA-256",
      ),
    );
  }
  if (!isIsoTimestamp(value.createdAt)) {
    issues.push(
      issue("invalid_timestamp", "export.createdAt", "createdAt must be an ISO timestamp"),
    );
  }

  if (approval !== undefined) {
    issues.push(...validateRevisionBoundApproval(approval));
    if (
      !isRecord(approval) ||
      value.approvalId !== approval.approvalId ||
      value.documentId !== approval.documentId ||
      value.operationId !== approval.operationId ||
      value.ledgerVersion !== approval.ledgerVersion ||
      value.approvedRevision !== approval.approvedRevision
    ) {
      issues.push(
        issue(
          "export_approval_mismatch",
          "export.approvalId",
          "export identity must match the exact persisted approval revision",
        ),
      );
    }
  }
  return issues;
}

function exactFirstCohort(value: unknown): value is readonly FirstCapturedTemplateId[] {
  return (
    Array.isArray(value) &&
    value.length === FIRST_CAPTURED_TEMPLATE_IDS.length &&
    FIRST_CAPTURED_TEMPLATE_IDS.every((templateId, index) => value[index] === templateId)
  );
}

export function validateCohortActivationPointer(
  value: unknown,
): DocumentOperationValidationIssue[] {
  if (!isRecord(value)) {
    return [
      issue("invalid_activation_pointer", "activation", "activation pointer must be an object"),
    ];
  }
  const issues = validateRequiredTextFields(
    value,
    ["pointerId", "environment", "userCohort", "ledgerVersion", "routingVersion"],
    "activation.",
  );
  if (
    !isPositiveInteger(value.pointerRevision) ||
    !isOneOf(value.changeKind, ["activate", "rollback"] as const) ||
    !isOneOf(value.mode, ["legacy", "shadow", "captured"] as const) ||
    !isTextList(value.workflowIds) ||
    value.workflowIds.length === 0 ||
    !unique(value.workflowIds) ||
    !isIsoTimestamp(value.createdAt)
  ) {
    issues.push(
      issue(
        "invalid_activation_pointer",
        "activation",
        "pointer revision, change, mode, workflows, and timestamp must be explicit",
      ),
    );
  }
  if (!exactFirstCohort(value.templateIds)) {
    issues.push(
      issue(
        "activation_cohort_mismatch",
        "activation.templateIds",
        "activation must capture the exact ordered first five-template cohort",
      ),
    );
  }
  if (!(value.previousPointerId === null || hasText(value.previousPointerId))) {
    issues.push(
      issue(
        "invalid_activation_pointer",
        "activation.previousPointerId",
        "previous pointer identity must be explicit",
      ),
    );
  }
  if (value.changeKind === "rollback") {
    if (!hasText(value.previousPointerId) || !hasText(value.rollbackOfPointerId)) {
      issues.push(
        issue(
          "invalid_rollback_pointer",
          "activation.rollbackOfPointerId",
          "rollback creates a successor linked to the pointer it reverses",
        ),
      );
    }
  } else if (value.rollbackOfPointerId !== null) {
    issues.push(
      issue(
        "invalid_rollback_pointer",
        "activation.rollbackOfPointerId",
        "activation records cannot claim rollback ancestry",
      ),
    );
  }
  return issues;
}

export function validateCohortActivationTransition(
  previous: unknown,
  next: unknown,
): DocumentOperationValidationIssue[] {
  const issues = [
    ...validateCohortActivationPointer(previous),
    ...validateCohortActivationPointer(next),
  ];
  if (!isRecord(previous) || !isRecord(next)) return issues;

  if (
    next.previousPointerId !== previous.pointerId ||
    (next.changeKind === "rollback" && next.rollbackOfPointerId !== previous.pointerId)
  ) {
    issues.push(
      issue(
        "pointer_ancestry_mismatch",
        "activation.previousPointerId",
        "successor and rollback ancestry must reference the current pointer",
      ),
    );
  }
  if (
    !isPositiveInteger(previous.pointerRevision) ||
    next.pointerRevision !== previous.pointerRevision + 1
  ) {
    issues.push(
      issue(
        "pointer_revision_mismatch",
        "activation.pointerRevision",
        "pointer revisions must advance exactly once",
      ),
    );
  }
  if (
    isIsoTimestamp(previous.createdAt) &&
    isIsoTimestamp(next.createdAt) &&
    Date.parse(next.createdAt) < Date.parse(previous.createdAt)
  ) {
    issues.push(
      issue(
        "pointer_time_regression",
        "activation.createdAt",
        "successor pointers cannot predate their parent",
      ),
    );
  }
  return issues;
}
