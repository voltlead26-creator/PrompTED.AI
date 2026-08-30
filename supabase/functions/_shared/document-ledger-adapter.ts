// =====================================================
// PrompTED — Ledger migration adapter (shadow mode only)
//
// Compiles reviewed catalogue and Document Intelligence Profile assets into
// the shared ledger contract. Nothing in the live generation path imports this
// adapter yet; it is evidence for Phase L0 and deliberately fails on drift.
// =====================================================

import {
  assertValidDocumentGenerationLedger,
  type DocumentGenerationLedger,
  type DocumentTemplateLedgerEntry,
  type LedgerInputDefinition,
  type LedgerInputType,
  type LedgerSectionDefinition,
  type SectionQualityExpectation,
  type SectionRequiredDetailType,
} from "../../../packages/shared/src/document-ledger.ts";
import coreTemplates from "../../../packages/shared/src/templates/templates.data.json" with {
  type: "json",
};
import phase2Templates from "../../../packages/shared/src/templates/phase2-templates.data.json" with {
  type: "json",
};
import {
  DIPS,
  type DocumentIntelligenceProfile,
  type DocumentProofFixture,
} from "./document-intelligence-profiles.ts";
import type {
  InformationFactType,
  RequiredInformationDefinition,
  SectionInformationContract,
} from "./document-placeholder-policy.ts";

const SHADOW_SCHEMA_VERSION = "1.0.0";
export const SHADOW_LEDGER_VERSION = "2026-08-24.shadow.1";

interface CatalogueSectionInput {
  key: string;
  name: string;
  description: string;
  is_required: boolean;
  order: number;
  vital?: string[];
  improver?: string[];
}

export interface CatalogueTemplateInput {
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

export interface CatalogueProfileSectionMismatch {
  templateId: string;
  catalogueSectionKeys: string[];
  profileSectionKeys: string[];
}

const CATALOGUE: CatalogueTemplateInput[] = [
  ...(coreTemplates as CatalogueTemplateInput[]),
  ...(phase2Templates as CatalogueTemplateInput[]),
];

function normalizedKeys(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function exactKeyMatch(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const normalizedLeft = normalizedKeys(left);
  const normalizedRight = normalizedKeys(right);
  return normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

export function auditCatalogueProfileSectionKeys(): CatalogueProfileSectionMismatch[] {
  const mismatches: CatalogueProfileSectionMismatch[] = [];
  for (const template of CATALOGUE) {
    const profile = DIPS.find((candidate) => candidate.key === template.slug);
    const profileSectionKeys =
      profile?.informationContract?.sections.map((section) =>
        section.sectionKey
      ) ?? [];
    const catalogueSectionKeys = template.sections.map((section) =>
      section.key
    );
    if (!exactKeyMatch(catalogueSectionKeys, profileSectionKeys)) {
      mismatches.push({
        templateId: template.slug,
        catalogueSectionKeys,
        profileSectionKeys,
      });
    }
  }
  return mismatches.sort((left, right) =>
    left.templateId.localeCompare(right.templateId)
  );
}

function scopedInputKey(sectionKey: string, informationKey: string): string {
  return `${sectionKey}.${informationKey}`;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(
    /^_+|_+$/g,
    "",
  );
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

function requiredInput(
  sectionKey: string,
  item: RequiredInformationDefinition,
): LedgerInputDefinition {
  const neutralFallback = Boolean(item.automaticFallback?.trim());
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
    ],
    mayInfer: false,
    mayUsePlaceholder: !neutralFallback,
    sensitivity: sensitivityFor(item.factType),
    validationRules: ["source_value_must_be_present_or_ledger_state_explicit"],
    clarification: {
      behaviour: neutralFallback
        ? "askOnlyIfCannotUseNeutralFallback"
        : "doNotAskUseInteractivePlaceholder",
      question: item.question,
      whyNeeded:
        `${item.label} is required by the ${sectionKey} section contract.`,
      blocksSections: [sectionKey],
      blocksExport: item.requiredForExport,
      canAnswerWithUnknown: neutralFallback,
      fallbackIfUserSkips: neutralFallback
        ? "neutralFallback"
        : "interactivePlaceholder",
      answerValidationRules: ["answer_must_match_declared_fact_type"],
      sensitiveAnswerHandling: sensitivityFor(item.factType) === "standard"
        ? "standard"
        : "redactInLogs",
    },
  };
}

function optionalInputs(
  section: SectionInformationContract,
): LedgerInputDefinition[] {
  const seen = new Set<string>();
  return section.optionalInformation.flatMap((label) => {
    const baseKey = slugify(label);
    if (!baseKey) return [];
    const key = scopedInputKey(section.sectionKey, baseKey);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      key,
      label,
      inputType: "text" as const,
      required: false,
      allowedSources: [
        "user" as const,
        "uploadedDocument" as const,
        "profile" as const,
        "role" as const,
        "savedLibraryItem" as const,
      ],
      mayInfer: false,
      mayUsePlaceholder: false,
      sensitivity: "standard" as const,
      validationRules: ["omit_when_absent"],
      clarification: {
        behaviour: "doNotAskOmitOptional" as const,
        question: `Would you like to add ${label}?`,
        whyNeeded: `${label} may improve the section but is not required.`,
        blocksSections: [],
        blocksExport: false,
        canAnswerWithUnknown: true,
        fallbackIfUserSkips: "omitOptional" as const,
        answerValidationRules: ["optional_answer_must_be_plain_text"],
        sensitiveAnswerHandling: "standard" as const,
      },
    }];
  });
}

function detailTypesFor(
  section: CatalogueSectionInput,
): SectionRequiredDetailType[] {
  const text = `${section.key} ${section.name} ${section.description}`
    .toLowerCase();
  const types = new Set<SectionRequiredDetailType>();
  if (/contact|identity|name|recipient|sender/.test(text)) {
    types.add("identity");
  }
  if (/date|history|timeline|experience/.test(text)) {
    types.add("date_or_timeline");
  }
  if (/role|relationship|experience|employment/.test(text)) {
    types.add("role_or_relationship");
  }
  if (/achievement|result|outcome|impact/.test(text)) {
    types.add("achievement_or_outcome");
  }
  if (/evidence|example|experience/.test(text)) types.add("specific_example");
  if (/action|request|resolution|recommend/.test(text)) {
    types.add("requested_action");
  }
  if (/next|close|follow/.test(text)) types.add("next_step");
  if (types.size === 0) types.add("document_specific");
  return [...types];
}

function outputTypeFor(
  template: CatalogueTemplateInput,
  section: CatalogueSectionInput,
): LedgerSectionDefinition["outputType"] {
  if (template.structure_type === "checklist") return "bulletList";
  if (
    /contact|details|fields/.test(
      `${section.key} ${section.name}`.toLowerCase(),
    )
  ) {
    return "structuredFields";
  }
  if (template.structure_type === "structured_form") return "mixed";
  return "paragraph";
}

function qualityExpectationFor(
  template: CatalogueTemplateInput,
  profile: DocumentIntelligenceProfile,
  section: CatalogueSectionInput,
  contractSection: SectionInformationContract,
  benchmarkExampleId: string,
): SectionQualityExpectation {
  const outputType = outputTypeFor(template, section);
  const requiredLabels = contractSection.requiredInformation.map((item) =>
    item.label
  );
  const semanticRequirements = [
    section.description,
    ...requiredLabels.map((label) =>
      `resolve ${label} from evidence or an explicit ledger state`
    ),
  ].filter((value) => value.trim().length > 0);
  const profileAvoid = profile.quality?.prohibitedInventions ??
    profile.riskChecks;

  return {
    sectionKey: section.key,
    expectedLength: outputType === "structuredFields"
      ? "one_line"
      : outputType === "bulletList"
      ? "bullet_list"
      : "document_specific",
    expectedDepth: requiredLabels.length >= 3 ? "evidence_backed" : "specific",
    requiredDetailTypes: detailTypesFor(section),
    emotionalInvestment: /complaint|apology|reference|appreciation/.test(
        `${template.slug} ${section.key}`,
      )
      ? "carefully_balanced"
      : "low",
    mustInclude: [
      ...requiredLabels.map((label) =>
        `${label} or its declared missing-information state`
      ),
      ...(section.vital ?? []),
    ].filter((value, index, values) => values.indexOf(value) === index),
    shouldInclude: section.improver ?? [],
    mustAvoid: profileAvoid.length > 0
      ? profileAvoid
      : ["unsupported facts", "silent blank output", "instruction leakage"],
    minimumViableOutput: { semanticRequirements },
    acceptableExampleRefs: [benchmarkExampleId],
    unacceptableExampleRefs: [
      `${template.slug}.${section.key}.generic-or-invented`,
    ],
    benchmarkNotes: [
      `Shadow-migrated from the reviewed ${profile.label} profile.`,
      section.description,
      ...(profile.quality?.lengthAndDepth ?? []),
    ].filter(Boolean).join(" "),
  };
}

function testKindFor(
  fixture: DocumentProofFixture,
): DocumentTemplateLedgerEntry["testCases"][number]["kind"] {
  switch (fixture.mode) {
    case "sufficient-context":
      return "successful";
    case "missing-vital":
      return "missing_required_input";
    case "invention-pressure":
      return "hostile_input";
  }
}

export function compileTemplateLedgerEntry(
  template: CatalogueTemplateInput,
  profile: DocumentIntelligenceProfile,
  ledgerVersion: string,
): DocumentTemplateLedgerEntry {
  const informationContract = profile.informationContract;
  if (
    informationContract?.status !== "complete" ||
    profile.internalReview?.status !== "passed"
  ) {
    throw new Error(
      `PROFILE_NOT_APPROVED:${template.slug}: complete information contract and passed internal review are required`,
    );
  }

  const catalogueSectionKeys = template.sections.map((section) => section.key);
  const profileSectionKeys = informationContract.sections.map((section) =>
    section.sectionKey
  );
  if (!exactKeyMatch(catalogueSectionKeys, profileSectionKeys)) {
    throw new Error(
      `SECTION_KEY_MISMATCH:${template.slug}:catalogue=${
        catalogueSectionKeys.join(",")
      }:profile=${profileSectionKeys.join(",")}`,
    );
  }

  const benchmarkVersion = `${template.slug}.shadow-benchmark.1`;
  const benchmarkExampleId = `${template.slug}.enhanced-dip-synthetic.1`;
  const sectionExpectations: Record<string, SectionQualityExpectation> = {};
  const sections = template.sections.map((section): LedgerSectionDefinition => {
    const contractSection = informationContract.sections.find((candidate) =>
      candidate.sectionKey === section.key
    );
    if (!contractSection) {
      throw new Error(
        `MISSING_SECTION_CONTRACT:${template.slug}:${section.key}`,
      );
    }
    const qualityExpectation = qualityExpectationFor(
      template,
      profile,
      section,
      contractSection,
      benchmarkExampleId,
    );
    sectionExpectations[section.key] = qualityExpectation;
    return {
      sectionKey: section.key,
      title: section.name,
      order: section.order,
      required: section.is_required,
      purpose: section.description,
      dependsOnInputs: contractSection.requiredInformation.map((item) =>
        scopedInputKey(section.key, item.key)
      ),
      allowedContent: [
        "wording grounded in the ledger's allowed source facts",
        ...(section.vital ?? []),
        ...(section.improver ?? []),
      ],
      forbiddenContent: [
        "unsupported facts",
        "silent blank output",
        "undeclared placeholders",
        "instructions presented as final document wording",
      ],
      outputType: outputTypeFor(template, section),
      minimumViableOutput:
        outputTypeFor(template, section) === "structuredFields"
          ? {
            requiredFields: contractSection.requiredInformation.map((item) =>
              item.key
            ),
          }
          : {},
      missingInformationBehaviour:
        contractSection.requiredInformation.some((item) =>
            !item.automaticFallback?.trim()
          )
          ? "useInteractivePlaceholder"
          : section.is_required
          ? "useNeutralFallback"
          : "omitIfOptional",
      validationRules: [
        "required_section_must_have_explicit_state",
        "content_must_be_grounded",
        "declared_placeholders_only",
        "quality_expectation_must_pass",
      ],
      qualityExpectation,
    };
  });

  const requiredInputs = informationContract.sections.flatMap((section) =>
    section.requiredInformation.map((item) =>
      requiredInput(section.sectionKey, item)
    )
  );
  const optional = informationContract.sections.flatMap(optionalInputs);
  const exampleSections = sections.map((section) => {
    const example = profile.exampleFinalWording?.sections.find((candidate) =>
      candidate.key === section.sectionKey
    );
    const exampleText = example?.content?.trim() ||
      `Synthetic ${section.title} calibration: resolve required facts through evidence or explicit ledger states.`;
    return {
      sectionKey: section.sectionKey,
      sectionTitle: section.title,
      exampleText,
      observedLength: {
        approximateWords: exampleText.split(/\s+/).filter(Boolean).length,
      },
      observedQualities: ["synthetic", "section-scoped", "placeholder-aware"],
    };
  });

  return {
    templateId: template.slug,
    aliases: [template.id, profile.key].filter((value) =>
      value !== template.slug
    ),
    displayName: template.name,
    category: template.category,
    userIntent: template.plain_description,
    riskLevel: template.advice_boundary === "high-stakes"
      ? "high_risk"
      : "standard",
    supportedLocales: ["en-AU"],
    lifecycle: {
      status: "draft",
      introducedIn: ledgerVersion,
      lastReviewedAt: profile.internalReview.reviewedAt ??
        informationContract.auditedAt ?? "2026-08-24",
    },
    requiredInputs,
    optionalInputs: optional,
    sections,
    sourcePolicy: {
      allowedSources: [
        "currentUserAnswer",
        "uploadedDocument",
        "confirmedProfile",
        "savedLibraryItem",
        "selectedRole",
        "systemDerived",
      ],
      precedence: [
        "currentUserAnswer",
        "confirmedProfile",
        "selectedRole",
        "uploadedDocument",
        "savedLibraryItem",
        "systemDerived",
      ],
      requireProvenanceForClaims: true,
      conflictBehaviour: "askClarification",
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
        "stable_section_keys",
        "required_section_state",
        "declared_placeholders_only",
        "grounded_claims_only",
      ],
      qualityRules: ["section_quality_expectation", "no_generic_filler"],
      exportBlockingIssueCodes: [
        "blank_output",
        "unsupported_fact",
        "instruction_leakage",
        "unresolved_placeholder",
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
      supportedFormats: ["pdf", "docx"],
    },
    qualityBenchmark: {
      benchmarkVersion,
      benchmarkExamples: [{
        exampleId: benchmarkExampleId,
        benchmarkVersion,
        documentType: template.slug,
        sourceType: "synthetic_gold_standard",
        tone: "professional",
        audience: "the confirmed document audience",
        provenance: {
          sourceRef: `internal:enhanced-dip:${profile.key}`,
          capturedAt: informationContract.auditedAt ?? "2026-08-24",
          rightsStatus: "synthetic",
          anonymized: true,
          reviewedAt: profile.internalReview.reviewedAt ??
            informationContract.auditedAt ?? "2026-08-24",
          approvalStatus: "approved",
        },
        sections: exampleSections,
        notes: [
          "Compiled from reviewed synthetic Enhanced DIP final-wording examples for shadow validation only.",
        ],
        knownLimitations: [
          "This adapter does not prove persistence, export rendering, provider behavior, or user workflow completion.",
        ],
      }],
      sectionExpectations,
      emotionalInvestment: template.advice_boundary === "high-stakes"
        ? "high_stakes"
        : "professional",
      detailLevel: template.structure_type === "structured_form"
        ? "detailed"
        : "standard",
      finalWordingStandard: profile.quality?.submitReadyChecks.join("; ") ||
        "Complete, grounded, section-valid wording ready for user review.",
      approvedAt: profile.internalReview.reviewedAt ??
        informationContract.auditedAt ?? "2026-08-24",
    },
    testCases: (profile.proofFixtures ?? []).map((fixture) => ({
      id: fixture.id,
      kind: testKindFor(fixture),
      description: `${fixture.mode}: ${
        fixture.requiredMissingFacts.join(", ") || "complete supported input"
      }`,
    })),
  };
}

export function compileDocumentLedgerShadow(
  templateIds: readonly string[],
): DocumentGenerationLedger {
  const templates: Record<string, DocumentTemplateLedgerEntry> = {};
  for (const templateId of templateIds) {
    const template = CATALOGUE.find((candidate) =>
      candidate.slug === templateId || candidate.id === templateId
    );
    if (!template) throw new Error(`UNKNOWN_TEMPLATE:${templateId}`);
    const profile = DIPS.find((candidate) => candidate.key === template.slug);
    if (!profile) throw new Error(`UNKNOWN_PROFILE:${template.slug}`);
    templates[template.slug] = compileTemplateLedgerEntry(
      template,
      profile,
      SHADOW_LEDGER_VERSION,
    );
  }

  const ledger: DocumentGenerationLedger = {
    schemaVersion: SHADOW_SCHEMA_VERSION,
    ledgerVersion: SHADOW_LEDGER_VERSION,
    templates,
  };
  assertValidDocumentGenerationLedger(ledger);
  return ledger;
}
