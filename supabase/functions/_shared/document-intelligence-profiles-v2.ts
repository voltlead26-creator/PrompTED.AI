// =====================================================
// PrompTED — Enhanced Document Intelligence Profiles V2
//
// Shadow-only migration representation. This module restructures the 86
// reviewed Enhanced DIPs into ledger-ready, versioned profile inputs without
// changing the live DIPS registry, generation, persistence, export, billing,
// or workflow behaviour. The immutable ledger remains the future authority.
// =====================================================

import type {
  ClarificationPolicy,
  LedgerInputDefinition,
  LedgerInputType,
  LedgerMissingInformationBehaviour,
  LedgerRiskLevel,
  LedgerSectionOutputType,
  SectionQualityExpectation,
  SectionRequiredDetailType,
  SourcePolicy,
} from "../../../packages/shared/src/document-ledger.ts";
import coreTemplates from "../../../packages/shared/src/templates/templates.data.json" with {
  type: "json",
};
import phase2Templates from "../../../packages/shared/src/templates/phase2-templates.data.json" with {
  type: "json",
};
import compatibilityProposal from "../../../docs/architecture/document-section-key-compatibility.proposed.json" with {
  type: "json",
};
import {
  DIPS,
  type DocumentIntelligenceProfile,
  type DocumentProofFixture,
} from "./document-intelligence-profiles.ts";
import type {
  InformationFactType,
  NeutralReplacementOption,
  RequiredInformationDefinition,
  SectionInformationContract,
} from "./document-placeholder-policy.ts";

export const ENHANCED_DIP_V2_SCHEMA_VERSION = "2.0.0";
export const ENHANCED_DIP_V2_PROFILE_VERSION = "2026-08-25.shadow-profile.2";

export type EnhancedProfileLifecycleStatus =
  | "draft"
  | "approved"
  | "deprecated";

export type EnhancedSectionRequiredness =
  | "required"
  | "optional"
  | "jurisdiction_controlled"
  | "owner_decision_required";

type ApprovedNewSectionRequiredness = Exclude<
  EnhancedSectionRequiredness,
  "owner_decision_required"
>;

export type SectionCompatibilityClassification =
  | "unchanged"
  | "one_to_one_rename"
  | "one_to_many_split"
  | "many_to_one_merge"
  | "semantic_replacement"
  | "legacy_alias_only"
  | "new_canonical_section"
  | "unresolved";

export interface EnhancedProfileInput extends LedgerInputDefinition {
  factType: InformationFactType | "optional_context";
  sharedResolutionKey?: string;
  neutralReplacementOptions: NeutralReplacementOption[];
}

export interface EnhancedSectionCompatibility {
  legacyKeys: string[];
  classification: SectionCompatibilityClassification[];
  preserveHistoricalRead: boolean;
  deterministicMigrationPossible: boolean;
  compatibilityAdapterRequired: boolean;
  durableMigrationRequired: boolean;
  ownerDecisionRequired: boolean;
  unresolvedQuestions: string[];
}

export interface EnhancedProfileSectionV2 {
  sectionKey: string;
  title: string;
  order: number;
  requiredness: EnhancedSectionRequiredness;
  purpose: string;
  inputs: EnhancedProfileInput[];
  optionalInputs: EnhancedProfileInput[];
  dependsOnSections: string[];
  outputType: LedgerSectionOutputType;
  missingInformationBehaviour: LedgerMissingInformationBehaviour;
  allowedContent: string[];
  forbiddenContent: string[];
  validationRules: string[];
  qualityExpectation: SectionQualityExpectation;
  compatibility: EnhancedSectionCompatibility;
}

export interface EnhancedProfileBenchmarkV2 {
  benchmarkVersion: string;
  sourceReferences: Array<{
    authority: string;
    title: string;
    url: string;
    appliesTo: string[];
    acceptanceSignals: string[];
  }>;
  exampleStatus: "reviewed" | "migration_review_required";
  exampleSectionKeys: string[];
  sectionExpectations: Record<string, SectionQualityExpectation>;
  finalWordingStandard: string;
  benchmarkUseRule: string;
}

export interface EnhancedProfileCompatibilityV2 {
  status: "exact" | "owner_approved_shadow";
  ownerDecisionStatus: "not_applicable" | "approved";
  historicalSectionKeys: string[];
  proposedCanonicalSectionKeys: string[];
  permanentHistoricalReadWhileReferenced: boolean;
  modelRedistributionAllowed: false;
  liveMigrationImplemented: false;
  unresolvedOwnerDecisions: string[];
}

export interface EnhancedDocumentIntelligenceProfileV2 {
  schemaVersion: typeof ENHANCED_DIP_V2_SCHEMA_VERSION;
  profileVersion: typeof ENHANCED_DIP_V2_PROFILE_VERSION;
  templateId: string;
  aliases: string[];
  displayName: string;
  category: string;
  domains: string[];
  userIntent: string;
  riskLevel: LedgerRiskLevel;
  supportedLocales: string[];
  lifecycle: {
    status: EnhancedProfileLifecycleStatus;
    introducedIn: string;
    lastReviewedAt: string;
    ownerApprovalRequired: true;
  };
  architecturalRole: {
    sourceEvidenceForImmutableLedger: true;
    liveRuntimeAuthority: false;
    shadowOnly: true;
  };
  routing: {
    matches: string[];
    intendedOutcome: string;
  };
  sourcePolicy: SourcePolicy;
  sections: EnhancedProfileSectionV2[];
  riskChecks: string[];
  benchmarks: EnhancedProfileBenchmarkV2;
  proofFixtures: DocumentProofFixture[];
  compatibility: EnhancedProfileCompatibilityV2;
}

interface CatalogueSectionInput {
  key: string;
  name: string;
  description: string;
  is_required: boolean;
  order: number;
  vital?: string[];
  improver?: string[];
}

interface CatalogueTemplateInput {
  id: string;
  slug: string;
  name: string;
  domain: string;
  category: string;
  plain_description: string;
  structure_type: "compose" | "structured_form" | "checklist";
  sections: CatalogueSectionInput[];
  advice_boundary: "none" | "light" | "high-stakes";
}

interface CompatibilityMappingInput {
  legacyKeys: string[];
  profileKeys: string[];
  proposedCanonicalKeys: string[];
  classification: SectionCompatibilityClassification;
  preserveHistoricalRead: boolean;
  deterministicMigrationPossible: boolean;
  compatibilityAdapterRequired: boolean;
  durableMigrationRequired: boolean;
  ownerDecisionRequired: boolean;
  unresolvedQuestions: string[];
  ownerDecisionStatus?: "approved";
  approvedAt?: string;
  newSectionPolicy?: {
    requiredness: ApprovedNewSectionRequiredness;
    historicalContentStrategy: string;
    newWriteStrategy: string;
    renderingStrategy: string;
    activationAuthority: string;
  };
}

interface CompatibilityTemplateInput {
  templateId: string;
  catalogueSectionKeys: string[];
  profileSectionKeys: string[];
  proposedCanonicalSectionKeys: string[];
  mappings: CompatibilityMappingInput[];
  unresolvedQuestions: string[];
  ownerApprovalRequired: boolean;
}

interface CompatibilityProposalInput {
  status: "owner_approved";
  ownerApprovalRequired: boolean;
  liveMigrationImplemented: boolean;
  ownerApproval: {
    status: "approved";
    approvedBy: "PrompTED owner";
    approvedAt: string;
    liveImplementationAuthorized: false;
    phaseL02Authorized: true;
    protectedActionsAuthorized: false;
  };
  adoptionPlan: {
    l02Implementation: {
      status:
        "implemented_and_verified_locally_live_integration_not_authorized";
      liveLedgerSelectionEnabled: false;
      compatibilityAdaptersImplemented: false;
      applicationWorkflowExercised: false;
      hostedMutationPerformed: false;
    };
  };
  templates: CompatibilityTemplateInput[];
}

const CATALOGUE: CatalogueTemplateInput[] = [
  ...(coreTemplates as CatalogueTemplateInput[]),
  ...(phase2Templates as CatalogueTemplateInput[]),
];

const COMPATIBILITY_PROPOSAL =
  compatibilityProposal as CompatibilityProposalInput;

const REQUIRED_SOURCE_POLICY: SourcePolicy = {
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
  conflictBehaviour: "askClarification",
};

function nonEmpty(value: string | undefined): value is string {
  return Boolean(value?.trim());
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function humaniseKey(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function scopedInputKey(sectionKey: string, inputKey: string): string {
  return `${sectionKey}.${inputKey}`;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(
    /^_+|_+$/g,
    "",
  );
}

function riskLevelFor(template: CatalogueTemplateInput): LedgerRiskLevel {
  if (template.advice_boundary === "high-stakes") return "high_risk";
  if (
    /complaint|incident|insurance|employment|policy|agreement|appeal/.test(
      `${template.slug} ${template.category}`.toLowerCase(),
    )
  ) return "sensitive";
  return "standard";
}

function inputTypeFor(factType: InformationFactType): LedgerInputType {
  switch (factType) {
    case "date":
    case "date_range":
      return "date";
    case "address":
      return "address";
    case "amount":
      return "currency";
    case "contact_detail":
      return "text";
    default:
      return "text";
  }
}

function sensitivityFor(
  factType: InformationFactType,
): LedgerInputDefinition["sensitivity"] {
  switch (factType) {
    case "person_name":
    case "address":
    case "contact_detail":
    case "identifier":
      return "personal";
    default:
      return "standard";
  }
}

function clarificationFor(
  sectionKey: string,
  item: RequiredInformationDefinition,
): ClarificationPolicy {
  const hasAutomaticFallback = nonEmpty(item.automaticFallback);
  return {
    behaviour: hasAutomaticFallback
      ? "askOnlyIfCannotUseNeutralFallback"
      : item.requiredForExport
      ? "alwaysAskIfMissing"
      : "doNotAskUseInteractivePlaceholder",
    question: item.question,
    whyNeeded: `${item.label} is required by the ${
      humaniseKey(sectionKey)
    } section.`,
    blocksSections: [sectionKey],
    blocksExport: item.requiredForExport,
    canAnswerWithUnknown: hasAutomaticFallback || !item.requiredForExport,
    fallbackIfUserSkips: hasAutomaticFallback
      ? "neutralFallback"
      : item.requiredForExport
      ? "blockGeneration"
      : "interactivePlaceholder",
    answerValidationRules: [
      "answer_must_match_declared_fact_type",
      "answer_must_preserve_source_provenance",
      "answer_must_not_overwrite_a_newer_approved_value",
    ],
    sensitiveAnswerHandling: sensitivityFor(item.factType) === "standard"
      ? "standard"
      : "redactInLogs",
  };
}

function requiredInputFor(
  sectionKey: string,
  item: RequiredInformationDefinition,
): EnhancedProfileInput {
  const hasAutomaticFallback = nonEmpty(item.automaticFallback);
  return {
    key: scopedInputKey(sectionKey, item.key),
    label: item.label,
    inputType: inputTypeFor(item.factType),
    required: true,
    allowedSources: [
      "user",
      "uploadedDocument",
      "profile",
      "role",
      "savedLibraryItem",
      "externalSource",
    ],
    mayInfer: false,
    mayUsePlaceholder: !hasAutomaticFallback,
    sensitivity: sensitivityFor(item.factType),
    validationRules: [
      "value_must_match_declared_fact_type",
      "value_must_have_an_allowed_source",
      "missing_value_must_resolve_to_an_explicit_ledger_state",
    ],
    clarification: clarificationFor(sectionKey, item),
    factType: item.factType,
    sharedResolutionKey: item.sharedResolutionKey,
    neutralReplacementOptions: item.neutralReplacementOptions,
  };
}

function optionalInputsFor(
  section: SectionInformationContract,
): EnhancedProfileInput[] {
  return unique(section.optionalInformation).flatMap((label) => {
    const inputKey = slugify(label);
    if (!inputKey) return [];
    return [
      {
        key: scopedInputKey(section.sectionKey, inputKey),
        label,
        inputType: "text",
        required: false,
        allowedSources: [
          "user",
          "uploadedDocument",
          "profile",
          "role",
          "savedLibraryItem",
          "externalSource",
        ],
        mayInfer: false,
        mayUsePlaceholder: false,
        sensitivity: "standard",
        validationRules: [
          "omit_when_absent",
          "present_value_must_have_an_allowed_source",
        ],
        clarification: {
          behaviour: "doNotAskOmitOptional",
          question: `Would you like to add ${label}?`,
          whyNeeded: `${label} can improve this section but is not required.`,
          blocksSections: [],
          blocksExport: false,
          canAnswerWithUnknown: true,
          fallbackIfUserSkips: "omitOptional",
          answerValidationRules: [
            "optional_answer_must_be_plain_text",
            "optional_answer_must_preserve_source_provenance",
          ],
          sensitiveAnswerHandling: "standard",
        },
        factType: "optional_context",
        neutralReplacementOptions: [],
      } satisfies EnhancedProfileInput,
    ];
  });
}

function detailTypesFor(
  section: SectionInformationContract,
): SectionRequiredDetailType[] {
  const types = new Set<SectionRequiredDetailType>();
  for (const item of section.requiredInformation) {
    switch (item.factType) {
      case "person_name":
      case "company_name":
      case "address":
      case "contact_detail":
      case "identifier":
        types.add("identity");
        break;
      case "date":
      case "date_range":
        types.add("date_or_timeline");
        break;
      case "role_title":
        types.add("role_or_relationship");
        break;
      case "achievement":
        types.add("achievement_or_outcome");
        types.add("specific_example");
        break;
      case "amount":
        types.add("quantitative_evidence");
        break;
      case "reference":
        types.add("source_or_authority");
        break;
      case "responsibility":
      case "event":
        types.add("specific_example");
        break;
      default:
        types.add("document_specific");
    }
  }
  if (/request|action|resolution|acceptance/.test(section.sectionKey)) {
    types.add("requested_action");
  }
  if (/close|next|follow|handover/.test(section.sectionKey)) {
    types.add("next_step");
  }
  if (types.size === 0) types.add("document_specific");
  return [...types];
}

function outputTypeFor(
  template: CatalogueTemplateInput,
  sectionKey: string,
): LedgerSectionOutputType {
  const text = sectionKey.toLowerCase();
  if (/matrix|register|forecast|items|schedule|count|table/.test(text)) {
    return "table";
  }
  if (
    template.structure_type === "checklist" ||
    /checklist|steps|questions|actions|requirements/.test(text)
  ) return "bulletList";
  if (/details|identity|contact|parties|header/.test(text)) {
    return "structuredFields";
  }
  if (template.structure_type === "structured_form") return "mixed";
  return "paragraph";
}

function lengthContractFor(
  outputType: LedgerSectionOutputType,
  sectionKey: string,
): Pick<
  SectionQualityExpectation,
  "expectedLength" | "approximateWordRange" | "minimumViableOutput"
> {
  if (outputType === "table" || outputType === "bulletList") {
    return {
      expectedLength: "bullet_list",
      approximateWordRange: { min: 20, max: 600 },
      minimumViableOutput: {
        semanticRequirements: [],
        approximateWordRange: { min: 20, max: 600 },
        bulletRange: { min: 2, max: 24 },
      },
    };
  }
  if (outputType === "structuredFields") {
    return {
      expectedLength: "one_line",
      approximateWordRange: { min: 2, max: 100 },
      minimumViableOutput: {
        semanticRequirements: [],
        approximateWordRange: { min: 2, max: 100 },
      },
    };
  }
  if (
    /opening|closing|close|signoff|notice|subject|greeting/.test(sectionKey)
  ) {
    return {
      expectedLength: "short_paragraph",
      approximateWordRange: { min: 20, max: 140 },
      minimumViableOutput: {
        semanticRequirements: [],
        approximateWordRange: { min: 20, max: 140 },
        paragraphRange: { min: 1, max: 3 },
      },
    };
  }
  if (
    /analysis|evidence|findings|background|method|criteria|case/.test(
      sectionKey,
    )
  ) {
    return {
      expectedLength: "detailed_section",
      approximateWordRange: { min: 80, max: 600 },
      minimumViableOutput: {
        semanticRequirements: [],
        approximateWordRange: { min: 80, max: 600 },
        paragraphRange: { min: 1, max: 8 },
      },
    };
  }
  return {
    expectedLength: "standard_paragraph",
    approximateWordRange: { min: 40, max: 320 },
    minimumViableOutput: {
      semanticRequirements: [],
      approximateWordRange: { min: 40, max: 320 },
      paragraphRange: { min: 1, max: 5 },
    },
  };
}

function emotionalInvestmentFor(
  template: CatalogueTemplateInput,
  sectionKey: string,
): SectionQualityExpectation["emotionalInvestment"] {
  const text = `${template.slug} ${template.category} ${sectionKey}`
    .toLowerCase();
  if (/incident|financial|terms-of-employment|policy|sop|risk/.test(text)) {
    return "none";
  }
  if (/complaint|appeal|resignation|apology/.test(text)) {
    return "carefully_balanced";
  }
  if (/cover-letter|personal-statement|reference|motivation/.test(text)) {
    return "warm";
  }
  return "low";
}

function depthFor(
  section: SectionInformationContract,
): SectionQualityExpectation["expectedDepth"] {
  const detailTypes = detailTypesFor(section);
  if (
    detailTypes.includes("source_or_authority") ||
    detailTypes.includes("quantitative_evidence")
  ) return "evidence_backed";
  if (section.requiredInformation.length >= 3) return "detailed";
  if (section.requiredInformation.length >= 1) return "specific";
  return "moderate";
}

function qualityExpectationFor(
  template: CatalogueTemplateInput,
  profile: DocumentIntelligenceProfile,
  section: SectionInformationContract,
  title: string,
): SectionQualityExpectation {
  const outputType = outputTypeFor(template, section.sectionKey);
  const length = lengthContractFor(outputType, section.sectionKey);
  const requiredLabels = section.requiredInformation.map((item) => item.label);
  const semanticRequirements = [
    `The ${title} section must fulfil its document-specific purpose.`,
    ...requiredLabels.map((label) =>
      `${label} must be supported by an allowed source or represented by the declared missing-information state.`
    ),
  ];
  return {
    sectionKey: section.sectionKey,
    expectedLength: length.expectedLength,
    approximateWordRange: length.approximateWordRange,
    expectedDepth: depthFor(section),
    requiredDetailTypes: detailTypesFor(section),
    emotionalInvestment: emotionalInvestmentFor(
      template,
      section.sectionKey,
    ),
    mustInclude: requiredLabels.length > 0
      ? requiredLabels.map((label) =>
        `${label} or its explicit clarification, placeholder, or fallback state`
      )
      : [`A complete ${title.toLowerCase()} appropriate to ${profile.label}`],
    shouldInclude: unique([
      ...section.optionalInformation,
      ...(profile.quality?.intentRelevance ?? []),
    ]),
    mustAvoid: unique([
      ...(profile.quality?.prohibitedInventions ?? profile.riskChecks),
      "silent blank output",
      "generic filler",
      "instruction leakage",
      "undeclared placeholders",
      "benchmark wording copied into a user document",
    ]),
    minimumViableOutput: {
      ...length.minimumViableOutput,
      semanticRequirements,
    },
    acceptableExampleRefs: [`${template.slug}.${section.sectionKey}.v2`],
    unacceptableExampleRefs: [
      `${template.slug}.${section.sectionKey}.blank`,
      `${template.slug}.${section.sectionKey}.generic`,
      `${template.slug}.${section.sectionKey}.invented`,
    ],
    benchmarkNotes:
      `Calibrated from the reviewed ${profile.label} profile, its approved benchmark observations, and the ${title} information contract. Length is a guardrail; factual completeness and purpose take precedence over padding.`,
  };
}

function matchingMappings(
  templateId: string,
  profileSectionKey: string,
): CompatibilityMappingInput[] {
  const template = COMPATIBILITY_PROPOSAL.templates.find((candidate) =>
    candidate.templateId === templateId
  );
  return template?.mappings.filter((mapping) =>
    mapping.profileKeys.includes(profileSectionKey) ||
    mapping.proposedCanonicalKeys.includes(profileSectionKey)
  ) ?? [];
}

function exactCompatibilityFor(
  sectionKey: string,
): EnhancedSectionCompatibility {
  return {
    legacyKeys: [sectionKey],
    classification: ["unchanged"],
    preserveHistoricalRead: true,
    deterministicMigrationPossible: true,
    compatibilityAdapterRequired: false,
    durableMigrationRequired: false,
    ownerDecisionRequired: false,
    unresolvedQuestions: [],
  };
}

function sectionCompatibilityFor(
  templateId: string,
  sectionKey: string,
): EnhancedSectionCompatibility {
  const mappings = matchingMappings(templateId, sectionKey);
  if (mappings.length === 0) return exactCompatibilityFor(sectionKey);
  return {
    legacyKeys: unique(mappings.flatMap((mapping) => mapping.legacyKeys)),
    classification: unique(
      mappings.map((mapping) => mapping.classification),
    ),
    preserveHistoricalRead: mappings.every((mapping) =>
      mapping.preserveHistoricalRead
    ),
    deterministicMigrationPossible: mappings.every((mapping) =>
      mapping.deterministicMigrationPossible
    ),
    compatibilityAdapterRequired: mappings.some((mapping) =>
      mapping.compatibilityAdapterRequired
    ),
    durableMigrationRequired: mappings.some((mapping) =>
      mapping.durableMigrationRequired
    ),
    ownerDecisionRequired: mappings.some((mapping) =>
      mapping.ownerDecisionRequired
    ),
    unresolvedQuestions: unique(
      mappings.flatMap((mapping) => mapping.unresolvedQuestions),
    ),
  };
}

function requirednessFor(
  template: CatalogueTemplateInput,
  sectionKey: string,
  compatibility: EnhancedSectionCompatibility,
): EnhancedSectionRequiredness {
  if (compatibility.classification.includes("unresolved")) {
    return "owner_decision_required";
  }
  if (compatibility.classification.includes("new_canonical_section")) {
    const approvedRequiredness = unique(
      matchingMappings(template.slug, sectionKey)
        .filter((mapping) => mapping.classification === "new_canonical_section")
        .map((mapping) => mapping.newSectionPolicy?.requiredness)
        .filter((value): value is ApprovedNewSectionRequiredness =>
          value !== undefined
        ),
    );
    return approvedRequiredness.length === 1
      ? approvedRequiredness[0]
      : "owner_decision_required";
  }
  const legacySections = template.sections.filter((section) =>
    compatibility.legacyKeys.includes(section.key)
  );
  if (legacySections.length === 0) return "owner_decision_required";
  return legacySections.some((section) => section.is_required)
    ? "required"
    : "optional";
}

function missingInformationBehaviourFor(
  requiredness: EnhancedSectionRequiredness,
  section: SectionInformationContract,
): LedgerMissingInformationBehaviour {
  if (requiredness === "owner_decision_required") return "blockGeneration";
  if (requiredness === "jurisdiction_controlled") {
    return "askClarifyingQuestion";
  }
  if (section.requiredInformation.some((item) => item.requiredForExport)) {
    return "askClarifyingQuestion";
  }
  if (
    section.requiredInformation.some((item) => nonEmpty(item.automaticFallback))
  ) return "useNeutralFallback";
  if (section.requiredInformation.length > 0) {
    return "useInteractivePlaceholder";
  }
  return requiredness === "required" ? "useNeutralFallback" : "omitIfOptional";
}

function titleFor(
  profile: DocumentIntelligenceProfile,
  sectionKey: string,
): string {
  return profile.exampleFinalWording?.sections.find((section) =>
    section.key === sectionKey
  )?.label ?? humaniseKey(sectionKey);
}

function purposeFor(
  profile: DocumentIntelligenceProfile,
  section: SectionInformationContract,
  title: string,
): string {
  const required = section.requiredInformation.map((item) => item.label);
  if (required.length > 0) {
    return `${title} resolves ${
      required.join(", ")
    } into supported, user-ready wording for the ${profile.label}.`;
  }
  return `${title} completes the document-specific ${title.toLowerCase()} function of the ${profile.label} without unsupported facts or filler.`;
}

function sectionFor(
  template: CatalogueTemplateInput,
  profile: DocumentIntelligenceProfile,
  section: SectionInformationContract,
  index: number,
): EnhancedProfileSectionV2 {
  const compatibility = sectionCompatibilityFor(
    template.slug,
    section.sectionKey,
  );
  const requiredness = requirednessFor(
    template,
    section.sectionKey,
    compatibility,
  );
  const title = titleFor(profile, section.sectionKey);
  return {
    sectionKey: section.sectionKey,
    title,
    order: index + 1,
    requiredness,
    purpose: purposeFor(profile, section, title),
    inputs: section.requiredInformation.map((item) =>
      requiredInputFor(section.sectionKey, item)
    ),
    optionalInputs: optionalInputsFor(section),
    dependsOnSections: [],
    outputType: outputTypeFor(template, section.sectionKey),
    missingInformationBehaviour: missingInformationBehaviourFor(
      requiredness,
      section,
    ),
    allowedContent: [
      "wording grounded in allowed source facts",
      "model-derived phrasing that does not add facts",
      "declared interactive placeholders where the contract permits them",
      "approved neutral fallbacks with recorded provenance",
    ],
    forbiddenContent: unique([
      "silent blank output",
      "unsupported facts",
      "hidden assumptions presented as facts",
      "scaffold or instruction text presented as final wording",
      "undeclared placeholders",
      "model-based redistribution of historical aggregate content",
      ...(profile.quality?.prohibitedInventions ?? []),
    ]),
    validationRules: [
      "section_key_must_match_the_captured_profile_version",
      "required_section_must_resolve_to_one_explicit_state",
      "factual_claims_must_map_to_allowed_source_provenance",
      "clarification_must_update_only_affected_sections",
      "repair_must_not_overwrite_newer_edits_or_approvals",
      "export_must_revalidate_the_persisted_approved_revision",
    ],
    qualityExpectation: qualityExpectationFor(
      template,
      profile,
      section,
      title,
    ),
    compatibility,
  };
}

function benchmarksFor(
  template: CatalogueTemplateInput,
  profile: DocumentIntelligenceProfile,
  sections: EnhancedProfileSectionV2[],
): EnhancedProfileBenchmarkV2 {
  const exampleKeys =
    profile.exampleFinalWording?.sections.map((section) => section.key) ?? [];
  const allSectionsCovered = sections.every((section) =>
    exampleKeys.includes(section.sectionKey)
  );
  return {
    benchmarkVersion: `${template.slug}.enhanced-dip-v2.1`,
    sourceReferences: (profile.benchmarks ?? []).map((benchmark) => ({
      authority: benchmark.authority,
      title: benchmark.title,
      url: benchmark.url,
      appliesTo: benchmark.appliesTo,
      acceptanceSignals: benchmark.acceptanceSignals ?? [],
    })),
    exampleStatus: allSectionsCovered
      ? "reviewed"
      : "migration_review_required",
    exampleSectionKeys: exampleKeys,
    sectionExpectations: Object.fromEntries(
      sections.map((section) => [
        section.sectionKey,
        section.qualityExpectation,
      ]),
    ),
    finalWordingStandard: profile.quality?.submitReadyChecks.join("; ") ||
      "Every section must be complete, grounded, document-specific, and ready for user review.",
    benchmarkUseRule:
      "Use approved benchmark observations to calibrate structure, depth, tone, and completeness. Never copy wording or invent facts to imitate an example.",
  };
}

function compatibilityFor(
  template: CatalogueTemplateInput,
  profile: DocumentIntelligenceProfile,
): EnhancedProfileCompatibilityV2 {
  const proposal = COMPATIBILITY_PROPOSAL.templates.find((candidate) =>
    candidate.templateId === template.slug
  );
  const profileSectionKeys =
    profile.informationContract?.sections.map((section) =>
      section.sectionKey
    ) ?? [];
  return {
    status: proposal ? "owner_approved_shadow" : "exact",
    ownerDecisionStatus: proposal ? "approved" : "not_applicable",
    historicalSectionKeys: proposal
      ? proposal.catalogueSectionKeys
      : template.sections.map((section) => section.key),
    proposedCanonicalSectionKeys: proposal
      ? proposal.proposedCanonicalSectionKeys
      : profileSectionKeys,
    permanentHistoricalReadWhileReferenced: true,
    modelRedistributionAllowed: false,
    liveMigrationImplemented: false,
    unresolvedOwnerDecisions: proposal?.unresolvedQuestions ?? [],
  };
}

function compileProfile(
  template: CatalogueTemplateInput,
  profile: DocumentIntelligenceProfile,
): EnhancedDocumentIntelligenceProfileV2 {
  const informationContract = profile.informationContract;
  if (
    informationContract?.status !== "complete" ||
    profile.internalReview?.status !== "passed"
  ) {
    throw new Error(
      `PROFILE_NOT_REVIEWED:${template.slug}: complete information contract and passed internal review are required`,
    );
  }
  const sections = informationContract.sections.map((section, index) =>
    sectionFor(template, profile, section, index)
  );
  return {
    schemaVersion: ENHANCED_DIP_V2_SCHEMA_VERSION,
    profileVersion: ENHANCED_DIP_V2_PROFILE_VERSION,
    templateId: template.slug,
    aliases: unique([template.id, profile.key]).filter((alias) =>
      alias !== template.slug
    ),
    displayName: template.name,
    category: template.category,
    domains: unique([template.domain, ...profile.domains]),
    userIntent: template.plain_description,
    riskLevel: riskLevelFor(template),
    supportedLocales: ["en-AU"],
    lifecycle: {
      status: "draft",
      introducedIn: ENHANCED_DIP_V2_PROFILE_VERSION,
      lastReviewedAt: profile.internalReview.reviewedAt ??
        informationContract.auditedAt ?? "2026-08-24",
      ownerApprovalRequired: true,
    },
    architecturalRole: {
      sourceEvidenceForImmutableLedger: true,
      liveRuntimeAuthority: false,
      shadowOnly: true,
    },
    routing: {
      matches: profile.matches,
      intendedOutcome: template.plain_description,
    },
    sourcePolicy: structuredClone(REQUIRED_SOURCE_POLICY),
    sections,
    riskChecks: unique([
      ...profile.riskChecks,
      "Preserve the distinction between user assertions, extracted facts, externally verified facts, system-derived values, and model-derived phrasing.",
      "Do not represent a generated draft, persistence event, export response, or provider completion as a completed outcome without its required evidence.",
    ]),
    benchmarks: benchmarksFor(template, profile, sections),
    proofFixtures: profile.proofFixtures ?? [],
    compatibility: compatibilityFor(template, profile),
  };
}

export function compileEnhancedDocumentIntelligenceProfilesV2(): EnhancedDocumentIntelligenceProfileV2[] {
  if (
    COMPATIBILITY_PROPOSAL.status !== "owner_approved" ||
    COMPATIBILITY_PROPOSAL.ownerApprovalRequired !== true ||
    COMPATIBILITY_PROPOSAL.liveMigrationImplemented !== false ||
    COMPATIBILITY_PROPOSAL.ownerApproval.status !== "approved" ||
    COMPATIBILITY_PROPOSAL.ownerApproval.liveImplementationAuthorized !==
      false ||
    COMPATIBILITY_PROPOSAL.ownerApproval.phaseL02Authorized !== true ||
    COMPATIBILITY_PROPOSAL.ownerApproval.protectedActionsAuthorized !== false ||
    COMPATIBILITY_PROPOSAL.adoptionPlan.l02Implementation.status !==
      "implemented_and_verified_locally_live_integration_not_authorized" ||
    COMPATIBILITY_PROPOSAL.adoptionPlan.l02Implementation
        .liveLedgerSelectionEnabled !== false ||
    COMPATIBILITY_PROPOSAL.adoptionPlan.l02Implementation
        .compatibilityAdaptersImplemented !== false ||
    COMPATIBILITY_PROPOSAL.adoptionPlan.l02Implementation
        .applicationWorkflowExercised !== false ||
    COMPATIBILITY_PROPOSAL.adoptionPlan.l02Implementation
        .hostedMutationPerformed !== false
  ) {
    throw new Error("COMPATIBILITY_PROPOSAL_NOT_SAFE_FOR_SHADOW_COMPILATION");
  }
  return CATALOGUE.map((template) => {
    const profile = DIPS.find((candidate) => candidate.key === template.slug);
    if (!profile) throw new Error(`MISSING_PROFILE:${template.slug}`);
    return compileProfile(template, profile);
  });
}

function arrayEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

export function validateEnhancedDocumentIntelligenceProfilesV2(
  profiles: readonly EnhancedDocumentIntelligenceProfileV2[],
): string[] {
  const issues: string[] = [];
  if (profiles.length !== CATALOGUE.length) {
    issues.push(
      `profile count must match catalogue count ${CATALOGUE.length}; received ${profiles.length}`,
    );
  }
  const ids = profiles.map((profile) => profile.templateId);
  if (new Set(ids).size !== ids.length) {
    issues.push("profile ids must be unique");
  }
  for (const template of CATALOGUE) {
    const profile = profiles.find((candidate) =>
      candidate.templateId === template.slug
    );
    if (!profile) {
      issues.push(`missing profile: ${template.slug}`);
      continue;
    }
    const source = DIPS.find((candidate) => candidate.key === template.slug);
    if (!source?.informationContract) {
      issues.push(`${template.slug}: source information contract is missing`);
      continue;
    }
    const prefix = template.slug;
    if (profile.schemaVersion !== ENHANCED_DIP_V2_SCHEMA_VERSION) {
      issues.push(`${prefix}: schema version mismatch`);
    }
    if (profile.profileVersion !== ENHANCED_DIP_V2_PROFILE_VERSION) {
      issues.push(`${prefix}: profile version mismatch`);
    }
    if (profile.lifecycle.status !== "draft") {
      issues.push(`${prefix}: shadow profile lifecycle must remain draft`);
    }
    if (profile.lifecycle.ownerApprovalRequired !== true) {
      issues.push(`${prefix}: owner approval must remain required`);
    }
    if (
      profile.architecturalRole.liveRuntimeAuthority !== false ||
      profile.architecturalRole.shadowOnly !== true ||
      profile.architecturalRole.sourceEvidenceForImmutableLedger !== true
    ) {
      issues.push(
        `${prefix}: architectural role must remain shadow source evidence`,
      );
    }
    if (
      profile.compatibility.liveMigrationImplemented !== false ||
      profile.compatibility.modelRedistributionAllowed !== false ||
      profile.compatibility.permanentHistoricalReadWhileReferenced !== true
    ) {
      issues.push(`${prefix}: compatibility safety invariants are invalid`);
    }
    if (!nonEmpty(profile.displayName) || !nonEmpty(profile.userIntent)) {
      issues.push(`${prefix}: identity metadata must be non-empty`);
    }
    if (profile.supportedLocales.length === 0) {
      issues.push(`${prefix}: supported locale is required`);
    }
    if (profile.routing.matches.length === 0) {
      issues.push(`${prefix}: routing matches are required`);
    }
    const expectedSectionKeys = source.informationContract.sections.map(
      (section) => section.sectionKey,
    );
    const actualSectionKeys = profile.sections.map((section) =>
      section.sectionKey
    );
    if (!arrayEqual(expectedSectionKeys, actualSectionKeys)) {
      issues.push(
        `${prefix}: V2 section order must match the reviewed profile source`,
      );
    }
    if (new Set(actualSectionKeys).size !== actualSectionKeys.length) {
      issues.push(`${prefix}: section keys must be unique`);
    }
    const proposed = COMPATIBILITY_PROPOSAL.templates.find((candidate) =>
      candidate.templateId === template.slug
    );
    const expectedCompatibilityStatus = proposed
      ? "owner_approved_shadow"
      : "exact";
    if (profile.compatibility.status !== expectedCompatibilityStatus) {
      issues.push(`${prefix}: compatibility status is incorrect`);
    }
    if (
      !arrayEqual(
        profile.compatibility.proposedCanonicalSectionKeys,
        expectedSectionKeys,
      )
    ) {
      issues.push(
        `${prefix}: proposed canonical keys must match profile sections`,
      );
    }
    const allInputKeys = new Set<string>();
    for (const [index, section] of profile.sections.entries()) {
      const sectionPrefix = `${prefix}:${section.sectionKey}`;
      if (section.order !== index + 1) {
        issues.push(
          `${sectionPrefix}: section order must be stable and sequential`,
        );
      }
      if (!nonEmpty(section.title) || !nonEmpty(section.purpose)) {
        issues.push(`${sectionPrefix}: title and purpose are required`);
      }
      if (section.qualityExpectation.sectionKey !== section.sectionKey) {
        issues.push(`${sectionPrefix}: quality expectation key mismatch`);
      }
      if (
        section.qualityExpectation.minimumViableOutput.semanticRequirements
          .length === 0
      ) {
        issues.push(
          `${sectionPrefix}: semantic quality requirements are required`,
        );
      }
      if (!section.qualityExpectation.approximateWordRange) {
        issues.push(
          `${sectionPrefix}: document-specific word range is required`,
        );
      }
      if (
        section.allowedContent.length === 0 ||
        section.forbiddenContent.length === 0 ||
        section.validationRules.length === 0
      ) {
        issues.push(`${sectionPrefix}: section policy must be complete`);
      }
      if (!section.compatibility.preserveHistoricalRead) {
        issues.push(`${sectionPrefix}: historical read support is required`);
      }
      if (
        section.compatibility.classification.includes("unresolved") &&
        (section.requiredness !== "owner_decision_required" ||
          section.compatibility.unresolvedQuestions.length === 0)
      ) {
        issues.push(
          `${sectionPrefix}: unresolved mapping must remain owner-controlled`,
        );
      }
      if (
        section.compatibility.classification.includes(
          "new_canonical_section",
        ) &&
        (section.compatibility.legacyKeys.length !== 0 ||
          section.requiredness === "owner_decision_required" ||
          section.compatibility.unresolvedQuestions.length !== 0)
      ) {
        issues.push(
          `${sectionPrefix}: approved new canonical section must have no legacy identity and resolved requiredness`,
        );
      }
      if (
        section.requiredness === "owner_decision_required" &&
        section.missingInformationBehaviour !== "blockGeneration"
      ) {
        issues.push(`${sectionPrefix}: owner decision must fail closed`);
      }
      for (const input of [...section.inputs, ...section.optionalInputs]) {
        if (allInputKeys.has(input.key)) {
          issues.push(`${prefix}: duplicate input key ${input.key}`);
        }
        allInputKeys.add(input.key);
        if (!nonEmpty(input.label) || input.validationRules.length === 0) {
          issues.push(
            `${sectionPrefix}:${input.key}: input contract is incomplete`,
          );
        }
        for (const blockedSection of input.clarification.blocksSections) {
          if (!actualSectionKeys.includes(blockedSection)) {
            issues.push(
              `${sectionPrefix}:${input.key}: unknown blocked section ${blockedSection}`,
            );
          }
        }
      }
    }
    const benchmarkKeys = Object.keys(profile.benchmarks.sectionExpectations);
    if (
      !arrayEqual([...benchmarkKeys].sort(), [...actualSectionKeys].sort())
    ) {
      issues.push(
        `${prefix}: benchmark expectations must cover every section exactly once`,
      );
    }
    if (
      profile.benchmarks.sourceReferences.length === 0 ||
      profile.benchmarks.sourceReferences.some((benchmark) =>
        !benchmark.url.startsWith("https://") ||
        benchmark.acceptanceSignals.length === 0
      )
    ) {
      issues.push(`${prefix}: approved benchmark observations are required`);
    }
    if (profile.proofFixtures.length === 0) {
      issues.push(`${prefix}: proof fixtures are required`);
    }
  }
  const approvedShadowProfiles = profiles.filter((profile) =>
    profile.compatibility.status === "owner_approved_shadow"
  );
  if (
    approvedShadowProfiles.length !== COMPATIBILITY_PROPOSAL.templates.length
  ) {
    issues.push(
      `owner-approved shadow compatibility count must be ${COMPATIBILITY_PROPOSAL.templates.length}; received ${approvedShadowProfiles.length}`,
    );
  }
  const newCanonicalSections = profiles.flatMap((profile) =>
    profile.sections.filter((section) =>
      section.compatibility.classification.includes("new_canonical_section")
    ).map((section) => `${profile.templateId}:${section.sectionKey}`)
  );
  if (newCanonicalSections.length !== 4) {
    issues.push(
      `exactly four owner-approved new canonical sections are required; received ${newCanonicalSections.length}`,
    );
  }
  const unresolvedSections = profiles.flatMap((profile) =>
    profile.sections.filter((section) =>
      section.compatibility.classification.includes("unresolved")
    ).map((section) => `${profile.templateId}:${section.sectionKey}`)
  );
  if (unresolvedSections.length !== 0) {
    issues.push(
      `owner-approved shadow profiles must not retain unresolved sections; received ${unresolvedSections.length}`,
    );
  }
  return issues;
}

export function assertValidEnhancedDocumentIntelligenceProfilesV2(
  profiles: readonly EnhancedDocumentIntelligenceProfileV2[],
): void {
  const issues = validateEnhancedDocumentIntelligenceProfilesV2(profiles);
  if (issues.length > 0) {
    throw new Error(
      `Enhanced Document Intelligence Profile V2 validation failed:\n- ${
        issues.join("\n- ")
      }`,
    );
  }
}

export const ENHANCED_DIPS_V2: EnhancedDocumentIntelligenceProfileV2[] =
  compileEnhancedDocumentIntelligenceProfilesV2();
