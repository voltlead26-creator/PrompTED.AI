// =====================================================
// PrompTED — Universal Document Generation Ledger
//
// Cross-runtime contract and fail-closed deterministic validation. The
// catalogue and existing Document Intelligence Profiles are migration inputs;
// runtime adapters compile them into this shape during the staged rollout.
// =====================================================

import {
  FIRST_CAPTURED_TEMPLATE_IDS,
  type GeneratedLedgerSectionState,
} from "./document-operation.ts";

export type { GeneratedLedgerSectionState } from "./document-operation.ts";

export type LedgerTemplateLifecycle = "active" | "draft" | "deprecated";
export type LedgerRiskLevel = "standard" | "sensitive" | "high_risk";
export type LedgerInputType =
  | "text"
  | "longText"
  | "date"
  | "email"
  | "phone"
  | "address"
  | "url"
  | "currency"
  | "number"
  | "boolean"
  | "file"
  | "selection"
  | "multiSelection";

export type LedgerInputSource =
  | "user"
  | "uploadedDocument"
  | "profile"
  | "role"
  | "savedLibraryItem"
  | "system"
  | "externalSource";

export type LedgerEvidenceSource =
  | "currentUserAnswer"
  | "uploadedDocument"
  | "confirmedProfile"
  | "savedLibraryItem"
  | "selectedRole"
  | "approvedExternalSource"
  | "systemDerived";

export type ClarificationBehaviour =
  | "alwaysAskIfMissing"
  | "askOnlyIfCannotUsePlaceholder"
  | "askOnlyIfCannotUseNeutralFallback"
  | "doNotAskUseInteractivePlaceholder"
  | "doNotAskOmitOptional"
  | "blockUntilAnswered";

export type ClarificationFallback =
  | "interactivePlaceholder"
  | "neutralFallback"
  | "omitOptional"
  | "blockGeneration";

export type LedgerSectionOutputType =
  | "paragraph"
  | "bulletList"
  | "numberedList"
  | "table"
  | "structuredFields"
  | "mixed";

export type LedgerMissingInformationBehaviour =
  | "askClarifyingQuestion"
  | "useInteractivePlaceholder"
  | "useNeutralFallback"
  | "omitIfOptional"
  | "blockGeneration";

export interface ClarificationPolicy {
  behaviour: ClarificationBehaviour;
  question: string;
  whyNeeded: string;
  blocksSections: string[];
  blocksExport: boolean;
  canAnswerWithUnknown: boolean;
  fallbackIfUserSkips?: ClarificationFallback;
  answerValidationRules: string[];
  sensitiveAnswerHandling?: "standard" | "redactInLogs" | "restricted";
}

export interface LedgerInputDefinition {
  key: string;
  label: string;
  inputType: LedgerInputType;
  required: boolean;
  allowedSources: LedgerInputSource[];
  mayInfer: boolean;
  mayUsePlaceholder: boolean;
  sensitivity: "standard" | "personal" | "sensitive";
  validationRules: string[];
  examples?: string[];
  clarification: ClarificationPolicy;
}

export type SectionRequiredDetailType =
  | "identity"
  | "date_or_timeline"
  | "role_or_relationship"
  | "specific_example"
  | "achievement_or_outcome"
  | "quantitative_evidence"
  | "source_or_authority"
  | "reasoning"
  | "requested_action"
  | "next_step"
  | "document_specific";

export interface SectionQualityExpectation {
  sectionKey: string;
  expectedLength:
    | "one_line"
    | "short_paragraph"
    | "standard_paragraph"
    | "multi_paragraph"
    | "bullet_list"
    | "detailed_section"
    | "document_specific";
  approximateWordRange?: { min: number; max: number };
  expectedDepth:
    | "basic"
    | "moderate"
    | "specific"
    | "detailed"
    | "evidence_backed"
    | "highly_personalised";
  requiredDetailTypes: SectionRequiredDetailType[];
  emotionalInvestment:
    | "none"
    | "low"
    | "moderate"
    | "warm"
    | "strong"
    | "sensitive"
    | "carefully_balanced";
  mustInclude: string[];
  shouldInclude?: string[];
  mustAvoid: string[];
  minimumViableOutput: {
    semanticRequirements: string[];
    approximateWordRange?: { min: number; max: number };
    paragraphRange?: { min: number; max: number };
    bulletRange?: { min: number; max: number };
  };
  acceptableExampleRefs: string[];
  unacceptableExampleRefs: string[];
  benchmarkNotes: string;
}

export interface LedgerSectionDefinition {
  sectionKey: string;
  title: string;
  order: number;
  required: boolean;
  purpose: string;
  dependsOnInputs: string[];
  dependsOnSections?: string[];
  allowedContent: string[];
  forbiddenContent: string[];
  outputType: LedgerSectionOutputType;
  minimumViableOutput: {
    minCharacters?: number;
    maxCharacters?: number;
    minWords?: number;
    maxWords?: number;
    minBullets?: number;
    maxBullets?: number;
    requiredFields?: string[];
  };
  missingInformationBehaviour: LedgerMissingInformationBehaviour;
  validationRules: string[];
  qualityExpectation: SectionQualityExpectation;
  examples?: { good: string[]; bad: string[] };
}

export interface SourcePolicy {
  allowedSources: LedgerEvidenceSource[];
  precedence: string[];
  requireProvenanceForClaims: boolean;
  conflictBehaviour:
    | "askClarification"
    | "preferCurrentUserAnswer"
    | "blockAffectedSections";
  maxSourceAge?: string;
}

export interface MissingInformationPolicy {
  requiredSectionStates: GeneratedLedgerSectionState[];
  optionalSectionOmissionAllowed: boolean;
  silentBlankAllowed: boolean;
}

export interface ValidationPolicy {
  deterministicRules: string[];
  qualityRules: string[];
  exportBlockingIssueCodes: string[];
}

export interface PersistencePolicy {
  snapshotRequired: boolean;
  atomicResultCommitRequired: boolean;
  optimisticConcurrencyRequired: boolean;
  replay: "idempotent";
}

export interface ExportPolicy {
  requiresApprovedRevision: boolean;
  allowExportWithPlaceholders: boolean;
  blockExportIfRequiredQuestionsUnanswered: boolean;
  unresolvedQuestionDisplay: "block" | "watermark" | "placeholder" | "omit";
  supportedFormats: Array<"pdf" | "docx" | "html" | "txt" | "xlsx">;
}

export interface FinalWordingExample {
  exampleId: string;
  benchmarkVersion: string;
  documentType: string;
  sourceType:
    | "approved_internal_example"
    | "user_approved_example"
    | "public_real_world_example"
    | "synthetic_gold_standard";
  jurisdictionOrContext?: string;
  locale?: string;
  tone: string;
  audience: string;
  provenance: {
    sourceRef: string;
    capturedAt: string;
    rightsStatus: "approved" | "licensed" | "public_domain" | "synthetic";
    anonymized: boolean;
    reviewedAt: string;
    approvalStatus: "approved" | "rejected" | "pending";
  };
  sections: Array<{
    sectionKey: string;
    sectionTitle: string;
    exampleText: string;
    observedLength: {
      approximateWords: number;
      paragraphCount?: number;
      bulletCount?: number;
    };
    observedQualities: string[];
  }>;
  notes: string[];
  knownLimitations: string[];
}

export interface TemplateQualityBenchmark {
  benchmarkVersion: string;
  benchmarkProvenance?: {
    approvalStatus: "approved" | "pending" | "rejected";
    sourceRefs: string[];
    reviewedAt: string;
    usePolicy: "form_and_depth_only";
  };
  benchmarkExamples: FinalWordingExample[];
  sectionExpectations: Record<string, SectionQualityExpectation>;
  emotionalInvestment:
    | "minimal"
    | "practical"
    | "professional"
    | "persuasive"
    | "personal"
    | "high_stakes"
    | "sensitive";
  detailLevel:
    | "brief"
    | "standard"
    | "detailed"
    | "evidence_rich"
    | "comprehensive";
  finalWordingStandard: string;
  approvedAt: string;
  reviewAfter?: string;
}

export interface LedgerTemplateTestCase {
  id: string;
  kind:
    | "successful"
    | "missing_required_input"
    | "missing_optional_input"
    | "conflicting_evidence"
    | "hostile_input"
    | "provider_failure"
    | "persistence_failure"
    | "replay"
    | "export";
  description: string;
}

export interface DocumentTemplateLedgerEntry {
  templateId: string;
  aliases?: string[];
  displayName: string;
  category: string;
  userIntent: string;
  riskLevel: LedgerRiskLevel;
  supportedLocales: string[];
  jurisdictionPolicy?: {
    required: boolean;
    supportedJurisdictions: string[];
    behaviourWhenUnknown: "clarify" | "block" | "not_applicable";
  };
  lifecycle: {
    status: LedgerTemplateLifecycle;
    introducedIn: string;
    lastReviewedAt: string;
    supersededBy?: string;
    compatibilityPolicy?: string;
  };
  requiredInputs: LedgerInputDefinition[];
  optionalInputs: LedgerInputDefinition[];
  sections: LedgerSectionDefinition[];
  sourcePolicy: SourcePolicy;
  missingInformationPolicy: MissingInformationPolicy;
  validationPolicy: ValidationPolicy;
  persistencePolicy: PersistencePolicy;
  exportPolicy: ExportPolicy;
  qualityBenchmark: TemplateQualityBenchmark;
  testCases: LedgerTemplateTestCase[];
}

export interface DocumentGenerationLedger {
  schemaVersion: string;
  ledgerVersion: string;
  templates: Record<string, DocumentTemplateLedgerEntry>;
}

// Persistence-boundary contracts introduced by Phase L0.2. These describe
// durable identity and concurrency invariants only; they do not activate the
// shadow ledger or translate historical section keys.
export type LedgerBindingStatus = "legacy_unversioned" | "captured";

export interface PersistedLedgerIdentity {
  bindingStatus: LedgerBindingStatus;
  templateId: string | null;
  ledgerVersion: string | null;
  benchmarkVersion: string | null;
  generationSnapshotId: string | null;
}

export interface PersistedSectionLedgerIdentity {
  bindingStatus: LedgerBindingStatus;
  sectionKey: string | null;
  ledgerVersion: string | null;
  required: boolean | null;
  sourceSectionKey: string | null;
  transformationVersion: string | null;
}

export interface ImmutableGenerationSnapshotIdentity {
  generationSnapshotId: string;
  generationRequestId: string;
  templateId: string;
  ledgerVersion: string;
  benchmarkVersion: string;
  pipelineVersion: string;
  snapshotSha256: string;
}

export interface PersistedRevisionState {
  currentRevision: number;
  approvedRevision: number | null;
  approvalStatus: "draft" | "approved" | "locked";
}

export type PersistenceBoundaryIssueCode =
  | "partial_legacy_identity"
  | "incomplete_captured_identity"
  | "incomplete_captured_section_identity"
  | "invalid_snapshot_identity"
  | "invalid_current_revision"
  | "invalid_approved_revision"
  | "approval_revision_mismatch";

export interface PersistenceBoundaryIssue {
  code: PersistenceBoundaryIssueCode;
  message: string;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function validatePersistedLedgerIdentity(
  identity: PersistedLedgerIdentity,
): PersistenceBoundaryIssue[] {
  const values = [
    identity.templateId,
    identity.ledgerVersion,
    identity.benchmarkVersion,
    identity.generationSnapshotId,
  ];
  if (identity.bindingStatus === "legacy_unversioned") {
    return values.every((value) => value === null) ? [] : [
      {
        code: "partial_legacy_identity",
        message:
          "legacy_unversioned records must not infer or partially capture ledger identity",
      },
    ];
  }

  return values.every(hasText) ? [] : [
    {
      code: "incomplete_captured_identity",
      message:
        "captured records require template, ledger, benchmark, and generation snapshot identity",
    },
  ];
}

export function validatePersistedSectionLedgerIdentity(
  identity: PersistedSectionLedgerIdentity,
): PersistenceBoundaryIssue[] {
  if (identity.bindingStatus === "legacy_unversioned") {
    return identity.sectionKey === null &&
        identity.ledgerVersion === null &&
        identity.required === null &&
        identity.sourceSectionKey === null &&
        identity.transformationVersion === null
      ? []
      : [
        {
          code: "partial_legacy_identity",
          message:
            "legacy_unversioned sections must retain their historical shape without inferred ledger metadata",
        },
      ];
  }

  return hasText(identity.sectionKey) &&
      hasText(identity.ledgerVersion) &&
      typeof identity.required === "boolean"
    ? []
    : [
      {
        code: "incomplete_captured_section_identity",
        message:
          "captured sections require a version-scoped section key, ledger version, and requiredness",
      },
    ];
}

export function validateImmutableGenerationSnapshotIdentity(
  snapshot: ImmutableGenerationSnapshotIdentity,
): PersistenceBoundaryIssue[] {
  return hasText(snapshot.generationSnapshotId) &&
      hasText(snapshot.generationRequestId) &&
      hasText(snapshot.templateId) &&
      hasText(snapshot.ledgerVersion) &&
      hasText(snapshot.benchmarkVersion) &&
      hasText(snapshot.pipelineVersion) &&
      SHA256_HEX.test(snapshot.snapshotSha256)
    ? []
    : [
      {
        code: "invalid_snapshot_identity",
        message:
          "generation snapshots require complete version identity and a lowercase SHA-256 digest",
      },
    ];
}

export function validatePersistedRevisionState(
  state: PersistedRevisionState,
): PersistenceBoundaryIssue[] {
  const issues: PersistenceBoundaryIssue[] = [];
  if (!Number.isInteger(state.currentRevision) || state.currentRevision < 1) {
    issues.push({
      code: "invalid_current_revision",
      message: "currentRevision must be a positive integer",
    });
  }
  if (
    state.approvedRevision !== null &&
    (!Number.isInteger(state.approvedRevision) ||
      state.approvedRevision < 1 ||
      state.approvedRevision > state.currentRevision)
  ) {
    issues.push({
      code: "invalid_approved_revision",
      message:
        "approvedRevision must identify an existing revision at or before currentRevision",
    });
  }
  if (
    state.approvalStatus === "approved" &&
    state.approvedRevision !== state.currentRevision
  ) {
    issues.push({
      code: "approval_revision_mismatch",
      message:
        "approved state must refer to the current revision; later edits must clear approval",
    });
  }
  return issues;
}

export type LedgerValidationIssueCode =
  | "invalid_runtime_shape"
  | "captured_cohort_mismatch"
  | "captured_ledger_version_mismatch"
  | "captured_template_not_active"
  | "captured_export_policy_incomplete"
  | "captured_missing_test_matrix"
  | "captured_benchmark_incomplete"
  | "missing_schema_version"
  | "missing_ledger_version"
  | "missing_templates"
  | "template_identity_mismatch"
  | "missing_template_metadata"
  | "duplicate_template_alias"
  | "missing_supported_locale"
  | "invalid_lifecycle"
  | "duplicate_input_key"
  | "invalid_input_contract"
  | "unknown_section_reference"
  | "duplicate_section_key"
  | "duplicate_section_order"
  | "unknown_input_reference"
  | "section_dependency_cycle"
  | "invalid_section_contract"
  | "invalid_required_section_omission"
  | "silent_blank_permitted"
  | "invalid_required_section_state"
  | "invalid_source_precedence"
  | "missing_validation_policy"
  | "missing_persistence_guarantee"
  | "missing_export_policy"
  | "missing_benchmark_version"
  | "unapproved_benchmark"
  | "missing_section_benchmark"
  | "mismatched_section_benchmark"
  | "missing_template_test_case";

export interface LedgerValidationIssue {
  code: LedgerValidationIssueCode;
  path: string;
  message: string;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasTextItems(values: readonly string[] | undefined): boolean {
  return Boolean(values?.length && values.every(hasText));
}

function hasValidRange(
  range: { min: number; max: number } | undefined,
): boolean {
  return (
    !range ||
    (Number.isFinite(range.min) &&
      Number.isFinite(range.max) &&
      range.min >= 0 &&
      range.max >= range.min)
  );
}

function findDependencyCycle(
  sections: readonly LedgerSectionDefinition[],
): string[] | null {
  const graph = new Map(
    sections.map((
      section,
    ) => [section.sectionKey, section.dependsOnSections ?? []]),
  );
  const visited = new Set<string>();
  const active = new Set<string>();
  const path: string[] = [];

  const visit = (key: string): string[] | null => {
    if (active.has(key)) {
      const start = path.indexOf(key);
      return [...path.slice(start), key];
    }
    if (visited.has(key)) return null;

    visited.add(key);
    active.add(key);
    path.push(key);
    for (const dependency of graph.get(key) ?? []) {
      if (!graph.has(dependency)) continue;
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    path.pop();
    active.delete(key);
    return null;
  };

  for (const key of graph.keys()) {
    const cycle = visit(key);
    if (cycle) return cycle;
  }
  return null;
}

export function validateDocumentGenerationLedger(
  ledger: DocumentGenerationLedger,
): LedgerValidationIssue[] {
  const issues: LedgerValidationIssue[] = [];
  const add = (
    code: LedgerValidationIssueCode,
    path: string,
    message: string,
  ) => issues.push({ code, path, message });

  if (!hasText(ledger.schemaVersion)) {
    add("missing_schema_version", "schemaVersion", "schemaVersion is required");
  }
  if (!hasText(ledger.ledgerVersion)) {
    add("missing_ledger_version", "ledgerVersion", "ledgerVersion is required");
  }

  const templateEntries = Object.entries(ledger.templates ?? {});
  if (templateEntries.length === 0) {
    add(
      "missing_templates",
      "templates",
      "at least one template contract is required",
    );
  }

  const claimedIds = new Set<string>();
  for (const [recordKey, template] of templateEntries) {
    const templatePath = `templates.${recordKey}`;
    if (recordKey !== template.templateId) {
      add(
        "template_identity_mismatch",
        `${templatePath}.templateId`,
        `record key ${recordKey} does not match templateId ${template.templateId}`,
      );
    }
    if (
      !hasText(template.templateId) ||
      !hasText(template.displayName) ||
      !hasText(template.category) ||
      !hasText(template.userIntent)
    ) {
      add(
        "missing_template_metadata",
        templatePath,
        "templateId, displayName, category, and userIntent are required",
      );
    }

    for (
      const claimedId of [template.templateId, ...(template.aliases ?? [])]
    ) {
      const normalized = claimedId.trim().toLowerCase();
      if (!normalized) continue;
      if (claimedIds.has(normalized)) {
        add(
          "duplicate_template_alias",
          `${templatePath}.aliases`,
          `template identity or alias ${claimedId} is declared more than once`,
        );
      }
      claimedIds.add(normalized);
    }

    if (!hasTextItems(template.supportedLocales)) {
      add(
        "missing_supported_locale",
        `${templatePath}.supportedLocales`,
        "at least one supported locale is required",
      );
    }
    if (
      !hasText(template.lifecycle?.introducedIn) ||
      !hasText(template.lifecycle?.lastReviewedAt) ||
      (template.lifecycle?.status === "deprecated" &&
        !hasText(template.lifecycle.compatibilityPolicy))
    ) {
      add(
        "invalid_lifecycle",
        `${templatePath}.lifecycle`,
        "lifecycle dates and deprecated-template compatibility are required",
      );
    }

    const inputKeys = new Set<string>();
    const inputs = [...template.requiredInputs, ...template.optionalInputs];
    for (const input of inputs) {
      const inputPath = `${templatePath}.inputs.${input.key || "<missing>"}`;
      if (inputKeys.has(input.key)) {
        add(
          "duplicate_input_key",
          inputPath,
          `duplicate input key ${input.key}`,
        );
      }
      inputKeys.add(input.key);
      if (
        !hasText(input.key) ||
        !hasText(input.label) ||
        input.allowedSources.length === 0 ||
        !hasTextItems(input.validationRules) ||
        !hasText(input.clarification?.question) ||
        !hasText(input.clarification?.whyNeeded) ||
        !hasTextItems(input.clarification?.answerValidationRules)
      ) {
        add(
          "invalid_input_contract",
          inputPath,
          "input identity, sources, validation, and clarification contract are required",
        );
      }
    }

    const sectionKeys = new Set<string>();
    const sectionOrders = new Set<number>();
    for (const section of template.sections) {
      const sectionPath = `${templatePath}.sections.${
        section.sectionKey || "<missing>"
      }`;
      if (sectionKeys.has(section.sectionKey)) {
        add(
          "duplicate_section_key",
          sectionPath,
          `duplicate section key ${section.sectionKey}`,
        );
      }
      sectionKeys.add(section.sectionKey);
      if (sectionOrders.has(section.order)) {
        add(
          "duplicate_section_order",
          `${sectionPath}.order`,
          `duplicate section order ${section.order}`,
        );
      }
      sectionOrders.add(section.order);

      if (
        !hasText(section.sectionKey) ||
        !hasText(section.title) ||
        !Number.isInteger(section.order) ||
        section.order < 0 ||
        !hasText(section.purpose) ||
        !hasTextItems(section.allowedContent) ||
        !hasTextItems(section.forbiddenContent) ||
        !hasTextItems(section.validationRules) ||
        !hasValidRange(section.qualityExpectation?.approximateWordRange) ||
        !hasValidRange(
          section.qualityExpectation?.minimumViableOutput?.approximateWordRange,
        ) ||
        !hasValidRange(
          section.qualityExpectation?.minimumViableOutput?.paragraphRange,
        ) ||
        !hasValidRange(
          section.qualityExpectation?.minimumViableOutput?.bulletRange,
        )
      ) {
        add(
          "invalid_section_contract",
          sectionPath,
          "section identity, order, purpose, content, validation, and valid quality ranges are required",
        );
      }
      if (
        section.required &&
        section.missingInformationBehaviour === "omitIfOptional"
      ) {
        add(
          "invalid_required_section_omission",
          `${sectionPath}.missingInformationBehaviour`,
          "a required section cannot use omitIfOptional",
        );
      }
      for (const inputKey of section.dependsOnInputs) {
        if (!inputKeys.has(inputKey)) {
          add(
            "unknown_input_reference",
            `${sectionPath}.dependsOnInputs`,
            `unknown input key ${inputKey}`,
          );
        }
      }
    }

    if (template.sections.length === 0) {
      add(
        "invalid_section_contract",
        `${templatePath}.sections`,
        "at least one section contract is required",
      );
    }

    for (const input of inputs) {
      for (const sectionKey of input.clarification.blocksSections) {
        if (!sectionKeys.has(sectionKey)) {
          add(
            "unknown_section_reference",
            `${templatePath}.inputs.${input.key}.clarification.blocksSections`,
            `unknown section key ${sectionKey}`,
          );
        }
      }
    }
    for (const section of template.sections) {
      for (const dependency of section.dependsOnSections ?? []) {
        if (!sectionKeys.has(dependency)) {
          add(
            "unknown_section_reference",
            `${templatePath}.sections.${section.sectionKey}.dependsOnSections`,
            `unknown section key ${dependency}`,
          );
        }
      }
    }
    const cycle = findDependencyCycle(template.sections);
    if (cycle) {
      add(
        "section_dependency_cycle",
        `${templatePath}.sections`,
        `section dependency cycle: ${cycle.join(" -> ")}`,
      );
    }

    if (template.missingInformationPolicy.silentBlankAllowed) {
      add(
        "silent_blank_permitted",
        `${templatePath}.missingInformationPolicy.silentBlankAllowed`,
        "silent blank sections are forbidden",
      );
    }
    if (
      !template.missingInformationPolicy.requiredSectionStates.includes(
        "final",
      ) ||
      template.missingInformationPolicy.requiredSectionStates.includes(
        "omitted_optional",
      )
    ) {
      add(
        "invalid_required_section_state",
        `${templatePath}.missingInformationPolicy.requiredSectionStates`,
        "required section states must include final and exclude omitted_optional",
      );
    }

    const allowedEvidenceSources = new Set(
      template.sourcePolicy.allowedSources,
    );
    for (const source of template.sourcePolicy.precedence) {
      if (!allowedEvidenceSources.has(source as LedgerEvidenceSource)) {
        add(
          "invalid_source_precedence",
          `${templatePath}.sourcePolicy.precedence`,
          `precedence source ${source} is not allowed by this template`,
        );
      }
    }
    if (
      !hasTextItems(template.validationPolicy.deterministicRules) ||
      !hasTextItems(template.validationPolicy.exportBlockingIssueCodes)
    ) {
      add(
        "missing_validation_policy",
        `${templatePath}.validationPolicy`,
        "deterministic and export-blocking validation rules are required",
      );
    }
    if (
      !template.persistencePolicy.snapshotRequired ||
      !template.persistencePolicy.atomicResultCommitRequired ||
      !template.persistencePolicy.optimisticConcurrencyRequired ||
      template.persistencePolicy.replay !== "idempotent"
    ) {
      add(
        "missing_persistence_guarantee",
        `${templatePath}.persistencePolicy`,
        "snapshot, atomic commit, optimistic concurrency, and idempotent replay are required",
      );
    }
    if (
      !template.exportPolicy.requiresApprovedRevision ||
      template.exportPolicy.supportedFormats.length === 0
    ) {
      add(
        "missing_export_policy",
        `${templatePath}.exportPolicy`,
        "approved revision and at least one export format are required",
      );
    }

    if (!hasText(template.qualityBenchmark.benchmarkVersion)) {
      add(
        "missing_benchmark_version",
        `${templatePath}.qualityBenchmark.benchmarkVersion`,
        "benchmarkVersion is required",
      );
    }
    for (const example of template.qualityBenchmark.benchmarkExamples) {
      if (example.provenance.approvalStatus !== "approved") {
        add(
          "unapproved_benchmark",
          `${templatePath}.qualityBenchmark.benchmarkExamples.${example.exampleId}`,
          "active benchmark examples must be approved",
        );
      }
    }
    if (template.lifecycle.status === "active") {
      for (const section of template.sections) {
        const expectation =
          template.qualityBenchmark.sectionExpectations[section.sectionKey];
        if (!expectation) {
          add(
            "missing_section_benchmark",
            `${templatePath}.qualityBenchmark.sectionExpectations.${section.sectionKey}`,
            `active section ${section.sectionKey} requires benchmark coverage`,
          );
        } else if (expectation.sectionKey !== section.sectionKey) {
          add(
            "mismatched_section_benchmark",
            `${templatePath}.qualityBenchmark.sectionExpectations.${section.sectionKey}.sectionKey`,
            `benchmark sectionKey ${expectation.sectionKey} does not match ${section.sectionKey}`,
          );
        }
        if (section.qualityExpectation.sectionKey !== section.sectionKey) {
          add(
            "mismatched_section_benchmark",
            `${templatePath}.sections.${section.sectionKey}.qualityExpectation.sectionKey`,
            "section qualityExpectation must use the same stable sectionKey",
          );
        }
      }
      if (template.testCases.length === 0) {
        add(
          "missing_template_test_case",
          `${templatePath}.testCases`,
          "an active template requires at least one contract test case",
        );
      }
    }
  }

  return issues;
}

export function assertValidDocumentGenerationLedger(
  ledger: DocumentGenerationLedger,
): void {
  const issues = validateDocumentGenerationLedger(ledger);
  if (issues.length === 0) return;
  throw new Error(
    `Invalid document generation ledger: ${
      issues
        .map((issue) => `${issue.code}@${issue.path}: ${issue.message}`)
        .join(" | ")
    }`,
  );
}

// ---------------------------------------------------------------------------
// First captured cohort
// ---------------------------------------------------------------------------

export const FIRST_CAPTURED_LEDGER_VERSION =
  "ledger.2026-08-first-cohort.1" as const;

interface CapturedInputSpec {
  key: string;
  label: string;
  required: boolean;
  blocksSections: string[];
  inputType?: LedgerInputType;
  sensitivity?: LedgerInputDefinition["sensitivity"];
  allowedSources?: LedgerInputSource[];
  blocksExport?: boolean;
  missingStrategy?: "placeholder" | "block";
}

interface CapturedSectionSpec {
  sectionKey: string;
  title: string;
  order: number;
  required: boolean;
  purpose: string;
  dependsOnInputs: string[];
  outputType: LedgerSectionOutputType;
  missingInformationBehaviour: LedgerMissingInformationBehaviour;
  expectedLength: SectionQualityExpectation["expectedLength"];
  expectedDepth: SectionQualityExpectation["expectedDepth"];
  emotionalInvestment: SectionQualityExpectation["emotionalInvestment"];
  requiredDetailTypes: SectionRequiredDetailType[];
  approximateWordRange?: { min: number; max: number };
  bulletRange?: { min: number; max: number };
}

interface CapturedTemplateSpec {
  templateId: (typeof FIRST_CAPTURED_TEMPLATE_IDS)[number];
  displayName: string;
  category: string;
  userIntent: string;
  riskLevel: LedgerRiskLevel;
  emotionalInvestment: TemplateQualityBenchmark["emotionalInvestment"];
  detailLevel: TemplateQualityBenchmark["detailLevel"];
  requiredInputs: CapturedInputSpec[];
  optionalInputs: CapturedInputSpec[];
  sections: CapturedSectionSpec[];
  supportedFormats: ExportPolicy["supportedFormats"];
  aliases?: string[];
  jurisdictionPolicy?: DocumentTemplateLedgerEntry["jurisdictionPolicy"];
}

function capturedInput(spec: CapturedInputSpec): LedgerInputDefinition {
  const required = spec.required;
  const blocking = required && spec.missingStrategy === "block";
  return {
    key: spec.key,
    label: spec.label,
    inputType: spec.inputType ?? "text",
    required,
    allowedSources: spec.allowedSources ?? [
      "user",
      "uploadedDocument",
      "profile",
      "savedLibraryItem",
    ],
    mayInfer: false,
    mayUsePlaceholder: required && !blocking,
    sensitivity: spec.sensitivity ?? "standard",
    validationRules: required
      ? ["source_value_required", "unsupported_inference_forbidden"]
      : ["omit_when_absent", "unsupported_inference_forbidden"],
    clarification: {
      behaviour: blocking
        ? "blockUntilAnswered"
        : required
        ? "alwaysAskIfMissing"
        : "doNotAskOmitOptional",
      question: required
        ? `What should TED use for ${spec.label.toLowerCase()}?`
        : `Would you like to include ${spec.label.toLowerCase()}?`,
      whyNeeded: required
        ? `${spec.label} is required for the affected document section.`
        : `${spec.label} may improve specificity but does not block completion.`,
      blocksSections: spec.blocksSections,
      blocksExport: spec.blocksExport ?? required,
      canAnswerWithUnknown: !required,
      fallbackIfUserSkips: blocking
        ? "blockGeneration"
        : required
        ? "interactivePlaceholder"
        : "omitOptional",
      answerValidationRules: [
        required ? "non_blank_confirmed_answer" : "plain_text_when_supplied",
      ],
      sensitiveAnswerHandling:
        spec.sensitivity === "standard" || spec.sensitivity === undefined
          ? "standard"
          : "redactInLogs",
    },
  };
}

function capturedSection(
  templateId: string,
  spec: CapturedSectionSpec,
): LedgerSectionDefinition {
  const qualityExpectation: SectionQualityExpectation = {
    sectionKey: spec.sectionKey,
    expectedLength: spec.expectedLength,
    approximateWordRange: spec.approximateWordRange,
    expectedDepth: spec.expectedDepth,
    requiredDetailTypes: spec.requiredDetailTypes,
    emotionalInvestment: spec.emotionalInvestment,
    mustInclude: [spec.purpose],
    mustAvoid: [
      "unsupported or invented facts",
      "scaffold instructions or TODO wording",
      "copied benchmark wording",
    ],
    minimumViableOutput: {
      semanticRequirements: [spec.purpose],
      approximateWordRange: spec.approximateWordRange,
      bulletRange: spec.bulletRange,
    },
    acceptableExampleRefs: [`${templateId}.${spec.sectionKey}.approved-form.1`],
    unacceptableExampleRefs: [
      `${templateId}.${spec.sectionKey}.generic-or-invented.1`,
    ],
    benchmarkNotes:
      "Form and depth calibration only; every factual claim still requires an allowed source.",
  };

  return {
    sectionKey: spec.sectionKey,
    title: spec.title,
    order: spec.order,
    required: spec.required,
    purpose: spec.purpose,
    dependsOnInputs: spec.dependsOnInputs,
    allowedContent: [
      "wording supported by the captured source and evidence snapshot",
      "user-confirmed neutral wording permitted by this section contract",
    ],
    forbiddenContent: [
      "invented names, dates, achievements, events, authorities, or outcomes",
      "prompt, schema, benchmark, or scaffold instructions",
      "duplicated sibling-section content",
    ],
    outputType: spec.outputType,
    minimumViableOutput: spec.outputType === "bulletList"
      ? { minBullets: spec.bulletRange?.min ?? 1 }
      : { minWords: spec.approximateWordRange?.min ?? 1 },
    missingInformationBehaviour: spec.missingInformationBehaviour,
    validationRules: [
      "explicit_section_state_required",
      "visible_content_required_for_output_state",
      "grounded_material_claims_only",
      "stable_section_key_once_persisted",
    ],
    qualityExpectation,
  };
}

const REQUIRED_CAPTURED_TEST_KINDS = [
  "successful",
  "missing_required_input",
  "missing_optional_input",
  "conflicting_evidence",
  "hostile_input",
  "replay",
  "export",
] as const satisfies readonly LedgerTemplateTestCase["kind"][];

function capturedTestCases(templateId: string): LedgerTemplateTestCase[] {
  return REQUIRED_CAPTURED_TEST_KINDS.map((kind) => ({
    id: `${templateId}.${kind}.1`,
    kind,
    description: `${templateId} must pass the ${
      kind.replaceAll("_", " ")
    } contract fixture without fabrication, silent blanks, stale writes, or duplicate allowance.`,
  }));
}

function capturedTemplate(
  spec: CapturedTemplateSpec,
): DocumentTemplateLedgerEntry {
  const sections = spec.sections.map((section) =>
    capturedSection(spec.templateId, section)
  );
  return {
    templateId: spec.templateId,
    aliases: spec.aliases,
    displayName: spec.displayName,
    category: spec.category,
    userIntent: spec.userIntent,
    riskLevel: spec.riskLevel,
    supportedLocales: ["en-AU"],
    jurisdictionPolicy: spec.jurisdictionPolicy,
    lifecycle: {
      status: "active",
      introducedIn: FIRST_CAPTURED_LEDGER_VERSION,
      lastReviewedAt: "2026-08-31",
      compatibilityPolicy:
        "Existing non-empty documents remain legacy_unversioned until an explicit preserving migration is approved.",
    },
    requiredInputs: spec.requiredInputs.map(capturedInput),
    optionalInputs: spec.optionalInputs.map(capturedInput),
    sections,
    sourcePolicy: {
      allowedSources: [
        "currentUserAnswer",
        "uploadedDocument",
        "confirmedProfile",
        "savedLibraryItem",
        "selectedRole",
        "approvedExternalSource",
        "systemDerived",
      ],
      precedence: [
        "currentUserAnswer",
        "confirmedProfile",
        "selectedRole",
        "uploadedDocument",
        "savedLibraryItem",
        "approvedExternalSource",
        "systemDerived",
      ],
      requireProvenanceForClaims: true,
      conflictBehaviour: spec.riskLevel === "high_risk"
        ? "blockAffectedSections"
        : "askClarification",
    },
    missingInformationPolicy: {
      requiredSectionStates: [
        "final",
        "needs_clarification",
        "interactive_placeholder",
        "neutral_fallback",
        "failed_validation",
      ],
      optionalSectionOmissionAllowed: true,
      silentBlankAllowed: false,
    },
    validationPolicy: {
      deterministicRules: [
        "explicit_section_state",
        "no_required_silent_blank",
        "source_claim_mapping",
        "stale_revision_rejection",
        "instruction_leakage_rejection",
      ],
      qualityRules: [
        "section_benchmark_fit",
        "document_specificity",
        "no_benchmark_copying",
      ],
      exportBlockingIssueCodes: [
        "blank_output",
        "unresolved_required_clarification",
        "non_exportable_placeholder",
        "unsupported_fact",
        "stale_approval",
        "instruction_leakage",
      ],
    },
    persistencePolicy: {
      snapshotRequired: true,
      atomicResultCommitRequired: true,
      optimisticConcurrencyRequired: true,
      replay: "idempotent",
    },
    exportPolicy: {
      requiresApprovedRevision: true,
      allowExportWithPlaceholders: false,
      blockExportIfRequiredQuestionsUnanswered: true,
      unresolvedQuestionDisplay: "block",
      supportedFormats: spec.supportedFormats,
    },
    qualityBenchmark: {
      benchmarkVersion: `${spec.templateId}.benchmark.1`,
      benchmarkProvenance: {
        approvalStatus: "approved",
        sourceRefs: [
          `immutable-source:ClaudeTED.AI@3a9a7bc7:${spec.templateId}`,
          "owner-contract:PrompTED.AI/AGENTS.md@2026-08-31",
        ],
        reviewedAt: "2026-08-31",
        usePolicy: "form_and_depth_only",
      },
      benchmarkExamples: [],
      sectionExpectations: Object.fromEntries(
        sections.map((
          section,
        ) => [section.sectionKey, section.qualityExpectation]),
      ),
      emotionalInvestment: spec.emotionalInvestment,
      detailLevel: spec.detailLevel,
      finalWordingStandard:
        `${spec.displayName} must be specific, source-grounded, complete for its declared state, and ready for user review without hidden scaffold wording.`,
      approvedAt: "2026-08-31",
      reviewAfter: "2027-02-28",
    },
    testCases: capturedTestCases(spec.templateId),
  };
}

const CAPTURED_TEMPLATE_SPECS: CapturedTemplateSpec[] = [
  {
    templateId: "resume",
    aliases: ["cv", "curriculum-vitae"],
    displayName: "Resume",
    category: "employment",
    userIntent:
      "Create a role-relevant resume using only confirmed identity, experience, qualifications, and skills.",
    riskLevel: "standard",
    emotionalInvestment: "professional",
    detailLevel: "detailed",
    requiredInputs: [
      {
        key: "full_name",
        label: "Full name",
        required: true,
        blocksSections: ["contact_details"],
        sensitivity: "personal",
      },
      {
        key: "target_role",
        label: "Target role or field",
        required: true,
        blocksSections: ["summary", "skills"],
        allowedSources: ["user", "role", "uploadedDocument"],
      },
      {
        key: "work_history",
        label: "Confirmed work history",
        required: true,
        blocksSections: ["experience"],
        inputType: "longText",
        sensitivity: "personal",
      },
    ],
    optionalInputs: [
      {
        key: "contact_methods",
        label: "Approved contact methods and location",
        required: false,
        blocksSections: [],
        sensitivity: "personal",
      },
      {
        key: "education_history",
        label: "Education and qualifications",
        required: false,
        blocksSections: [],
        inputType: "longText",
        sensitivity: "personal",
      },
      {
        key: "referee_details",
        label: "Approved referee details",
        required: false,
        blocksSections: [],
        sensitivity: "sensitive",
      },
    ],
    sections: [
      {
        sectionKey: "contact_details",
        title: "Contact Details",
        order: 0,
        required: true,
        purpose:
          "Identify the candidate using confirmed display and contact facts.",
        dependsOnInputs: ["full_name", "contact_methods"],
        outputType: "structuredFields",
        missingInformationBehaviour: "useInteractivePlaceholder",
        expectedLength: "one_line",
        expectedDepth: "basic",
        emotionalInvestment: "none",
        requiredDetailTypes: ["identity"],
        approximateWordRange: { min: 2, max: 30 },
      },
      {
        sectionKey: "summary",
        title: "Professional Summary",
        order: 1,
        required: true,
        purpose:
          "Summarise supported experience, strengths, and target direction.",
        dependsOnInputs: ["target_role", "work_history"],
        outputType: "paragraph",
        missingInformationBehaviour: "askClarifyingQuestion",
        expectedLength: "short_paragraph",
        expectedDepth: "specific",
        emotionalInvestment: "low",
        requiredDetailTypes: ["role_or_relationship", "achievement_or_outcome"],
        approximateWordRange: { min: 40, max: 100 },
      },
      {
        sectionKey: "experience",
        title: "Work Experience",
        order: 2,
        required: true,
        purpose:
          "Present confirmed roles, dates, responsibilities, and supported outcomes.",
        dependsOnInputs: ["work_history"],
        outputType: "mixed",
        missingInformationBehaviour: "askClarifyingQuestion",
        expectedLength: "detailed_section",
        expectedDepth: "evidence_backed",
        emotionalInvestment: "moderate",
        requiredDetailTypes: [
          "date_or_timeline",
          "role_or_relationship",
          "achievement_or_outcome",
        ],
        approximateWordRange: { min: 120, max: 900 },
      },
      {
        sectionKey: "education",
        title: "Education & Qualifications",
        order: 3,
        required: true,
        purpose:
          "Record supplied qualifications or an explicit confirmed neutral fallback.",
        dependsOnInputs: ["education_history"],
        outputType: "bulletList",
        missingInformationBehaviour: "useNeutralFallback",
        expectedLength: "bullet_list",
        expectedDepth: "specific",
        emotionalInvestment: "none",
        requiredDetailTypes: ["date_or_timeline", "document_specific"],
        bulletRange: { min: 1, max: 12 },
      },
      {
        sectionKey: "skills",
        title: "Key Skills",
        order: 4,
        required: true,
        purpose:
          "List skills evidenced by confirmed experience and relevant to the target role.",
        dependsOnInputs: ["target_role", "work_history"],
        outputType: "bulletList",
        missingInformationBehaviour: "askClarifyingQuestion",
        expectedLength: "bullet_list",
        expectedDepth: "specific",
        emotionalInvestment: "low",
        requiredDetailTypes: ["role_or_relationship", "specific_example"],
        bulletRange: { min: 6, max: 16 },
      },
      {
        sectionKey: "referees",
        title: "Referees",
        order: 5,
        required: false,
        purpose:
          "Include only approved referee details or omit the optional section.",
        dependsOnInputs: ["referee_details"],
        outputType: "structuredFields",
        missingInformationBehaviour: "omitIfOptional",
        expectedLength: "short_paragraph",
        expectedDepth: "basic",
        emotionalInvestment: "none",
        requiredDetailTypes: ["identity", "role_or_relationship"],
        approximateWordRange: { min: 5, max: 80 },
      },
    ],
    supportedFormats: ["docx", "pdf"],
  },
  {
    templateId: "selection-criteria-response",
    aliases: ["key-selection-criteria", "ksc-response"],
    displayName: "Selection Criteria Response",
    category: "employment",
    userIntent:
      "Answer an exact selection criterion with a real, source-supported example and role relevance.",
    riskLevel: "sensitive",
    emotionalInvestment: "persuasive",
    detailLevel: "evidence_rich",
    requiredInputs: [
      {
        key: "criterion_text",
        label: "Exact selection criterion",
        required: true,
        blocksSections: ["heading", "claim", "relevance"],
        inputType: "longText",
        allowedSources: ["user", "role", "uploadedDocument"],
        missingStrategy: "block",
      },
      {
        key: "target_role",
        label: "Target role",
        required: true,
        blocksSections: ["claim", "relevance"],
        allowedSources: ["user", "role", "uploadedDocument"],
        missingStrategy: "block",
      },
      {
        key: "evidence_example",
        label: "Real evidence example",
        required: true,
        blocksSections: ["evidence", "relevance"],
        inputType: "longText",
        sensitivity: "personal",
        missingStrategy: "block",
      },
    ],
    optionalInputs: [],
    sections: [
      {
        sectionKey: "heading",
        title: "Criterion Heading",
        order: 0,
        required: true,
        purpose:
          "Preserve the employer's exact criterion or a faithful confirmed paraphrase.",
        dependsOnInputs: ["criterion_text"],
        outputType: "paragraph",
        missingInformationBehaviour: "askClarifyingQuestion",
        expectedLength: "one_line",
        expectedDepth: "specific",
        emotionalInvestment: "none",
        requiredDetailTypes: ["source_or_authority"],
        approximateWordRange: { min: 3, max: 40 },
      },
      {
        sectionKey: "claim",
        title: "Summary Claim",
        order: 1,
        required: true,
        purpose:
          "State how the applicant meets the criterion without unsupported seniority or scope.",
        dependsOnInputs: ["criterion_text", "target_role", "evidence_example"],
        outputType: "paragraph",
        missingInformationBehaviour: "askClarifyingQuestion",
        expectedLength: "short_paragraph",
        expectedDepth: "specific",
        emotionalInvestment: "strong",
        requiredDetailTypes: ["reasoning", "role_or_relationship"],
        approximateWordRange: { min: 30, max: 90 },
      },
      {
        sectionKey: "evidence",
        title: "Evidence Example",
        order: 2,
        required: true,
        purpose:
          "Present a factual situation, task, action, and result from the supplied example.",
        dependsOnInputs: ["evidence_example"],
        outputType: "mixed",
        missingInformationBehaviour: "askClarifyingQuestion",
        expectedLength: "detailed_section",
        expectedDepth: "evidence_backed",
        emotionalInvestment: "strong",
        requiredDetailTypes: [
          "specific_example",
          "achievement_or_outcome",
          "date_or_timeline",
        ],
        approximateWordRange: { min: 180, max: 500 },
      },
      {
        sectionKey: "relevance",
        title: "Outcome & Relevance",
        order: 3,
        required: true,
        purpose:
          "Connect the supported outcome directly to the target role and criterion.",
        dependsOnInputs: ["criterion_text", "target_role", "evidence_example"],
        outputType: "paragraph",
        missingInformationBehaviour: "askClarifyingQuestion",
        expectedLength: "standard_paragraph",
        expectedDepth: "evidence_backed",
        emotionalInvestment: "strong",
        requiredDetailTypes: ["achievement_or_outcome", "reasoning"],
        approximateWordRange: { min: 60, max: 160 },
      },
    ],
    supportedFormats: ["docx", "pdf"],
  },
  {
    templateId: "moving-house-checklist",
    aliases: ["moving-checklist"],
    displayName: "Moving House Checklist",
    category: "life-admin",
    userIntent:
      "Create a dated, actionable checklist for a confirmed move without inventing providers, obligations, or addresses.",
    riskLevel: "standard",
    emotionalInvestment: "practical",
    detailLevel: "detailed",
    requiredInputs: [
      {
        key: "move_date",
        label: "Move date",
        required: true,
        blocksSections: ["items"],
        inputType: "date",
      },
      {
        key: "old_address",
        label: "Old address or region",
        required: true,
        blocksSections: ["items"],
        inputType: "address",
        sensitivity: "sensitive",
      },
      {
        key: "new_address",
        label: "New address or region",
        required: true,
        blocksSections: ["items"],
        inputType: "address",
        sensitivity: "sensitive",
      },
      {
        key: "property_basis",
        label: "Whether the property is rented or owned",
        required: true,
        blocksSections: ["items"],
        inputType: "selection",
      },
    ],
    optionalInputs: [
      {
        key: "household_logistics",
        label:
          "Household, utility, school, pet, vehicle, and storage logistics",
        required: false,
        blocksSections: [],
        inputType: "longText",
        sensitivity: "personal",
      },
    ],
    sections: [
      {
        sectionKey: "items",
        title: "Action Items",
        order: 0,
        required: true,
        purpose:
          "Provide concrete before, moving-day, and after-move actions with suggested timing.",
        dependsOnInputs: [
          "move_date",
          "old_address",
          "new_address",
          "property_basis",
          "household_logistics",
        ],
        outputType: "bulletList",
        missingInformationBehaviour: "useInteractivePlaceholder",
        expectedLength: "detailed_section",
        expectedDepth: "detailed",
        emotionalInvestment: "low",
        requiredDetailTypes: ["date_or_timeline", "next_step"],
        bulletRange: { min: 12, max: 60 },
      },
    ],
    supportedFormats: ["docx", "pdf", "xlsx"],
  },
  {
    templateId: "complaint-letter",
    aliases: ["consumer-complaint-letter"],
    displayName: "Complaint Letter",
    category: "consumer",
    userIntent:
      "State a complaint factually, explain supported impact, and request a clear user-approved resolution.",
    riskLevel: "sensitive",
    emotionalInvestment: "sensitive",
    detailLevel: "detailed",
    requiredInputs: [
      {
        key: "recipient_name",
        label: "Recipient person or organisation",
        required: true,
        blocksSections: ["issue", "close"],
        sensitivity: "personal",
      },
      {
        key: "issue_facts",
        label: "Confirmed issue facts and timing",
        required: true,
        blocksSections: ["issue"],
        inputType: "longText",
        sensitivity: "sensitive",
        missingStrategy: "block",
      },
      {
        key: "desired_outcome",
        label: "Requested resolution",
        required: true,
        blocksSections: ["resolution"],
        inputType: "longText",
      },
    ],
    optionalInputs: [
      {
        key: "impact_details",
        label: "Supported financial, time, or personal impact",
        required: false,
        blocksSections: [],
        inputType: "longText",
        sensitivity: "sensitive",
      },
      {
        key: "sender_contact",
        label: "Approved sender contact details",
        required: false,
        blocksSections: [],
        sensitivity: "personal",
      },
    ],
    sections: [
      {
        sectionKey: "issue",
        title: "The Issue",
        order: 0,
        required: true,
        purpose:
          "Explain what happened, when, and who was involved using confirmed facts.",
        dependsOnInputs: ["recipient_name", "issue_facts"],
        outputType: "paragraph",
        missingInformationBehaviour: "askClarifyingQuestion",
        expectedLength: "multi_paragraph",
        expectedDepth: "specific",
        emotionalInvestment: "carefully_balanced",
        requiredDetailTypes: ["date_or_timeline", "specific_example"],
        approximateWordRange: { min: 80, max: 300 },
      },
      {
        sectionKey: "impact",
        title: "Impact",
        order: 1,
        required: false,
        purpose:
          "Describe only supplied cost, inconvenience, harm, or ongoing effects.",
        dependsOnInputs: ["impact_details"],
        outputType: "paragraph",
        missingInformationBehaviour: "omitIfOptional",
        expectedLength: "standard_paragraph",
        expectedDepth: "specific",
        emotionalInvestment: "sensitive",
        requiredDetailTypes: ["achievement_or_outcome"],
        approximateWordRange: { min: 30, max: 180 },
      },
      {
        sectionKey: "resolution",
        title: "Requested Resolution",
        order: 2,
        required: true,
        purpose:
          "Request the exact user-approved remedy and any supported reasonable timeframe.",
        dependsOnInputs: ["desired_outcome"],
        outputType: "paragraph",
        missingInformationBehaviour: "askClarifyingQuestion",
        expectedLength: "standard_paragraph",
        expectedDepth: "specific",
        emotionalInvestment: "carefully_balanced",
        requiredDetailTypes: ["requested_action", "next_step"],
        approximateWordRange: { min: 40, max: 160 },
      },
      {
        sectionKey: "close",
        title: "Closing",
        order: 3,
        required: true,
        purpose:
          "Close firmly and professionally using only approved identity and contact details.",
        dependsOnInputs: ["recipient_name", "sender_contact"],
        outputType: "paragraph",
        missingInformationBehaviour: "useNeutralFallback",
        expectedLength: "short_paragraph",
        expectedDepth: "basic",
        emotionalInvestment: "carefully_balanced",
        requiredDetailTypes: ["next_step", "identity"],
        approximateWordRange: { min: 15, max: 80 },
      },
    ],
    supportedFormats: ["docx", "pdf"],
  },
  {
    templateId: "incident-near-miss-report",
    aliases: ["incident-report", "near-miss-report"],
    displayName: "Incident / Near-Miss Report",
    category: "safety-and-operations",
    userIntent:
      "Create a factual safety record separating observations, immediate controls, analysis, and accountable actions.",
    riskLevel: "high_risk",
    emotionalInvestment: "high_stakes",
    detailLevel: "comprehensive",
    jurisdictionPolicy: {
      required: true,
      supportedJurisdictions: ["AU"],
      behaviourWhenUnknown: "clarify",
    },
    requiredInputs: [
      {
        key: "incident_details",
        label: "Reporter, date, time, location, and people involved",
        required: true,
        blocksSections: ["details"],
        inputType: "longText",
        sensitivity: "sensitive",
        missingStrategy: "block",
      },
      {
        key: "factual_sequence",
        label: "Observed factual sequence and known impact",
        required: true,
        blocksSections: ["facts"],
        inputType: "longText",
        sensitivity: "sensitive",
        missingStrategy: "block",
      },
      {
        key: "immediate_response",
        label: "Immediate controls and notifications",
        required: true,
        blocksSections: ["response"],
        inputType: "longText",
        sensitivity: "sensitive",
        missingStrategy: "block",
      },
      {
        key: "jurisdiction",
        label: "Applicable workplace jurisdiction",
        required: true,
        blocksSections: ["response"],
        inputType: "selection",
        missingStrategy: "block",
      },
    ],
    optionalInputs: [
      {
        key: "witness_and_evidence_refs",
        label: "Witness and evidence references",
        required: false,
        blocksSections: [],
        inputType: "longText",
        sensitivity: "sensitive",
      },
      {
        key: "corrective_action_owners",
        label: "Confirmed corrective-action owners and due dates",
        required: false,
        blocksSections: [],
        inputType: "longText",
        sensitivity: "sensitive",
      },
    ],
    sections: [
      {
        sectionKey: "details",
        title: "Report Details",
        order: 0,
        required: true,
        purpose:
          "Record accountable reporter, time, place, and involved-person facts.",
        dependsOnInputs: ["incident_details"],
        outputType: "structuredFields",
        missingInformationBehaviour: "blockGeneration",
        expectedLength: "detailed_section",
        expectedDepth: "specific",
        emotionalInvestment: "carefully_balanced",
        requiredDetailTypes: ["identity", "date_or_timeline"],
        approximateWordRange: { min: 30, max: 180 },
      },
      {
        sectionKey: "facts",
        title: "Factual Sequence and Impact",
        order: 1,
        required: true,
        purpose:
          "Separate observed sequence and known injury or damage from inference.",
        dependsOnInputs: ["factual_sequence", "witness_and_evidence_refs"],
        outputType: "mixed",
        missingInformationBehaviour: "blockGeneration",
        expectedLength: "detailed_section",
        expectedDepth: "evidence_backed",
        emotionalInvestment: "carefully_balanced",
        requiredDetailTypes: [
          "date_or_timeline",
          "specific_example",
          "source_or_authority",
        ],
        approximateWordRange: { min: 100, max: 600 },
      },
      {
        sectionKey: "response",
        title: "Controls, Notifications and Actions",
        order: 2,
        required: true,
        purpose:
          "Record immediate controls, notification status, and only confirmed corrective actions.",
        dependsOnInputs: [
          "immediate_response",
          "jurisdiction",
          "corrective_action_owners",
        ],
        outputType: "mixed",
        missingInformationBehaviour: "blockGeneration",
        expectedLength: "detailed_section",
        expectedDepth: "evidence_backed",
        emotionalInvestment: "carefully_balanced",
        requiredDetailTypes: [
          "requested_action",
          "next_step",
          "source_or_authority",
        ],
        approximateWordRange: { min: 80, max: 500 },
      },
    ],
    supportedFormats: ["docx", "pdf"],
  },
];

const capturedTemplates = Object.fromEntries(
  CAPTURED_TEMPLATE_SPECS.map((
    spec,
  ) => [spec.templateId, capturedTemplate(spec)]),
) as Record<string, DocumentTemplateLedgerEntry>;

const CAPTURED_DOCUMENT_LEDGER_SOURCE: DocumentGenerationLedger = {
  schemaVersion: "1.0.0",
  ledgerVersion: FIRST_CAPTURED_LEDGER_VERSION,
  templates: capturedTemplates,
};

function runtimeLedgerShape(value: unknown): value is DocumentGenerationLedger {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.schemaVersion === "string" &&
    typeof candidate.ledgerVersion === "string" &&
    typeof candidate.templates === "object" &&
    candidate.templates !== null &&
    !Array.isArray(candidate.templates)
  );
}

/** Runtime-safe validator for the closed first cohort and its release matrix. */
export function validateCapturedDocumentLedger(
  value: unknown,
): LedgerValidationIssue[] {
  if (!runtimeLedgerShape(value)) {
    return [
      {
        code: "invalid_runtime_shape",
        path: "ledger",
        message:
          "captured ledger must have schema, version, and template records",
      },
    ];
  }

  let issues: LedgerValidationIssue[];
  try {
    issues = validateDocumentGenerationLedger(value);
  } catch {
    return [
      {
        code: "invalid_runtime_shape",
        path: "ledger",
        message: "captured ledger contains an incomplete runtime contract",
      },
    ];
  }

  const ids = Object.keys(value.templates);
  if (
    ids.length !== FIRST_CAPTURED_TEMPLATE_IDS.length ||
    !FIRST_CAPTURED_TEMPLATE_IDS.every((id, index) => ids[index] === id)
  ) {
    issues.push({
      code: "captured_cohort_mismatch",
      path: "templates",
      message: "captured ledger must contain the exact ordered first cohort",
    });
  }
  if (value.ledgerVersion !== FIRST_CAPTURED_LEDGER_VERSION) {
    issues.push({
      code: "captured_ledger_version_mismatch",
      path: "ledgerVersion",
      message: `captured ledger must use ${FIRST_CAPTURED_LEDGER_VERSION}`,
    });
  }

  for (const [templateId, template] of Object.entries(value.templates)) {
    const path = `templates.${templateId}`;
    if (template.lifecycle?.status !== "active") {
      issues.push({
        code: "captured_template_not_active",
        path: `${path}.lifecycle.status`,
        message:
          "first-cohort contracts must be active in their immutable ledger",
      });
    }
    if (
      template.exportPolicy?.allowExportWithPlaceholders !== false ||
      template.exportPolicy?.blockExportIfRequiredQuestionsUnanswered !==
        true ||
      template.exportPolicy?.unresolvedQuestionDisplay !== "block"
    ) {
      issues.push({
        code: "captured_export_policy_incomplete",
        path: `${path}.exportPolicy`,
        message:
          "captured export must fail closed on placeholders and clarification",
      });
    }
    const testKinds = new Set(template.testCases?.map((test) => test.kind));
    if (REQUIRED_CAPTURED_TEST_KINDS.some((kind) => !testKinds.has(kind))) {
      issues.push({
        code: "captured_missing_test_matrix",
        path: `${path}.testCases`,
        message:
          "captured templates require the complete first-cohort contract matrix",
      });
    }
    if (
      !hasText(template.qualityBenchmark?.approvedAt) ||
      !hasText(template.qualityBenchmark?.finalWordingStandard) ||
      !hasText(template.qualityBenchmark?.reviewAfter) ||
      template.qualityBenchmark?.benchmarkProvenance?.approvalStatus !==
        "approved" ||
      !hasTextItems(
        template.qualityBenchmark?.benchmarkProvenance?.sourceRefs,
      ) ||
      template.qualityBenchmark?.benchmarkProvenance?.usePolicy !==
        "form_and_depth_only"
    ) {
      issues.push({
        code: "captured_benchmark_incomplete",
        path: `${path}.qualityBenchmark`,
        message:
          "captured benchmark needs approval, review, and final-wording policy",
      });
    }
  }

  return issues;
}

export type DeepReadonly<T> = T extends (...args: never[]) => unknown ? T
  : T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[]
  : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
  : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value as DeepReadonly<T>;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value) as DeepReadonly<T>;
}

const capturedIssues = validateCapturedDocumentLedger(
  CAPTURED_DOCUMENT_LEDGER_SOURCE,
);
if (capturedIssues.length > 0) {
  throw new Error(
    `Invalid first captured ledger: ${
      capturedIssues
        .map((item) => `${item.code}@${item.path}`)
        .join(" | ")
    }`,
  );
}

export const CAPTURED_DOCUMENT_LEDGER = deepFreeze(
  CAPTURED_DOCUMENT_LEDGER_SOURCE,
);
