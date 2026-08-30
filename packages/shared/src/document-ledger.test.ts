import { describe, expect, it } from "vitest";
import {
  assertValidDocumentGenerationLedger,
  CAPTURED_DOCUMENT_LEDGER,
  FIRST_CAPTURED_LEDGER_VERSION,
  type DocumentGenerationLedger,
  validateCapturedDocumentLedger,
  validateImmutableGenerationSnapshotIdentity,
  validateDocumentGenerationLedger,
  validatePersistedLedgerIdentity,
  validatePersistedRevisionState,
  validatePersistedSectionLedgerIdentity,
} from "@prompted/shared/document-ledger";

function validLedger(): DocumentGenerationLedger {
  return {
    schemaVersion: "1.0.0",
    ledgerVersion: "2026-08-24.resume-pilot.1",
    templates: {
      resume: {
        templateId: "resume",
        aliases: ["cv"],
        displayName: "Resume",
        category: "employment",
        userIntent: "Create an evidence-backed resume for a confirmed work direction.",
        riskLevel: "standard",
        supportedLocales: ["en-AU"],
        lifecycle: {
          status: "active",
          introducedIn: "2026-08-24.resume-pilot.1",
          lastReviewedAt: "2026-08-24",
        },
        requiredInputs: [
          {
            key: "full_name",
            label: "Full name",
            inputType: "text",
            required: true,
            allowedSources: ["user", "uploadedDocument", "profile"],
            mayInfer: false,
            mayUsePlaceholder: true,
            sensitivity: "personal",
            validationRules: ["non_empty"],
            clarification: {
              behaviour: "doNotAskUseInteractivePlaceholder",
              question: "What full name should appear on your resume?",
              whyNeeded: "The resume header must identify the candidate.",
              blocksSections: ["contact_details"],
              blocksExport: true,
              canAnswerWithUnknown: false,
              fallbackIfUserSkips: "interactivePlaceholder",
              answerValidationRules: ["non_empty"],
              sensitiveAnswerHandling: "redactInLogs",
            },
          },
        ],
        optionalInputs: [],
        sections: [
          {
            sectionKey: "contact_details",
            title: "Contact details",
            order: 0,
            required: true,
            purpose: "Identify the candidate and provide approved contact details.",
            dependsOnInputs: ["full_name"],
            allowedContent: ["confirmed identity and contact facts"],
            forbiddenContent: ["invented identity or contact facts"],
            outputType: "structuredFields",
            minimumViableOutput: { requiredFields: ["full_name"] },
            missingInformationBehaviour: "useInteractivePlaceholder",
            validationRules: ["required_fields_present"],
            qualityExpectation: {
              sectionKey: "contact_details",
              expectedLength: "one_line",
              expectedDepth: "basic",
              requiredDetailTypes: ["identity"],
              emotionalInvestment: "none",
              mustInclude: ["candidate name or declared placeholder"],
              mustAvoid: ["invented contact information"],
              minimumViableOutput: {
                semanticRequirements: ["identifies the candidate"],
              },
              acceptableExampleRefs: ["resume-header-synthetic-1"],
              unacceptableExampleRefs: ["resume-header-invented-1"],
              benchmarkNotes: "A resume header is concise and factually exact.",
            },
          },
          {
            sectionKey: "professional_summary",
            title: "Professional summary",
            order: 1,
            required: true,
            purpose: "Summarise supported experience and direction.",
            dependsOnInputs: [],
            dependsOnSections: ["contact_details"],
            allowedContent: ["source-backed experience and direction"],
            forbiddenContent: ["unsupported achievements"],
            outputType: "paragraph",
            minimumViableOutput: { minWords: 35, maxWords: 100 },
            missingInformationBehaviour: "useNeutralFallback",
            validationRules: ["grounded_claims_only", "not_blank"],
            qualityExpectation: {
              sectionKey: "professional_summary",
              expectedLength: "short_paragraph",
              approximateWordRange: { min: 35, max: 100 },
              expectedDepth: "specific",
              requiredDetailTypes: ["role_or_relationship"],
              emotionalInvestment: "low",
              mustInclude: ["supported professional direction"],
              mustAvoid: ["generic objective statement"],
              minimumViableOutput: {
                semanticRequirements: ["states supported experience and direction"],
                approximateWordRange: { min: 35, max: 100 },
                paragraphRange: { min: 1, max: 1 },
              },
              acceptableExampleRefs: ["resume-summary-synthetic-1"],
              unacceptableExampleRefs: ["resume-summary-generic-1"],
              benchmarkNotes: "The summary is concise, specific, and evidence-backed.",
            },
          },
        ],
        sourcePolicy: {
          allowedSources: ["currentUserAnswer", "uploadedDocument", "confirmedProfile"],
          precedence: ["currentUserAnswer", "confirmedProfile", "uploadedDocument"],
          requireProvenanceForClaims: true,
          conflictBehaviour: "askClarification",
        },
        missingInformationPolicy: {
          requiredSectionStates: [
            "final",
            "needs_clarification",
            "interactive_placeholder",
            "neutral_fallback",
          ],
          optionalSectionOmissionAllowed: true,
          silentBlankAllowed: false,
        },
        validationPolicy: {
          deterministicRules: ["required_section_state", "grounded_claims_only"],
          qualityRules: ["benchmark_fit"],
          exportBlockingIssueCodes: ["blank_output", "unsupported_fact"],
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
          benchmarkVersion: "resume-benchmark.1",
          benchmarkExamples: [
            {
              exampleId: "resume-header-synthetic-1",
              benchmarkVersion: "resume-benchmark.1",
              documentType: "resume",
              sourceType: "synthetic_gold_standard",
              tone: "professional",
              audience: "employer",
              provenance: {
                sourceRef: "internal:resume-header-synthetic-1",
                capturedAt: "2026-08-24",
                rightsStatus: "synthetic",
                anonymized: true,
                reviewedAt: "2026-08-24",
                approvalStatus: "approved",
              },
              sections: [
                {
                  sectionKey: "contact_details",
                  sectionTitle: "Contact details",
                  exampleText: "Alex Morgan — Melbourne — approved contact details",
                  observedLength: { approximateWords: 7 },
                  observedQualities: ["concise", "factually scoped"],
                },
              ],
              notes: ["Synthetic structural calibration only."],
              knownLimitations: ["Does not demonstrate every contact field."],
            },
          ],
          sectionExpectations: {
            contact_details: {
              sectionKey: "contact_details",
              expectedLength: "one_line",
              expectedDepth: "basic",
              requiredDetailTypes: ["identity"],
              emotionalInvestment: "none",
              mustInclude: ["candidate name or declared placeholder"],
              mustAvoid: ["invented contact information"],
              minimumViableOutput: {
                semanticRequirements: ["identifies the candidate"],
              },
              acceptableExampleRefs: ["resume-header-synthetic-1"],
              unacceptableExampleRefs: ["resume-header-invented-1"],
              benchmarkNotes: "A resume header is concise and exact.",
            },
            professional_summary: {
              sectionKey: "professional_summary",
              expectedLength: "short_paragraph",
              approximateWordRange: { min: 35, max: 100 },
              expectedDepth: "specific",
              requiredDetailTypes: ["role_or_relationship"],
              emotionalInvestment: "low",
              mustInclude: ["supported professional direction"],
              mustAvoid: ["generic objective statement"],
              minimumViableOutput: {
                semanticRequirements: ["states supported experience and direction"],
              },
              acceptableExampleRefs: ["resume-summary-synthetic-1"],
              unacceptableExampleRefs: ["resume-summary-generic-1"],
              benchmarkNotes: "The summary is concise, specific, and evidence-backed.",
            },
          },
          emotionalInvestment: "professional",
          detailLevel: "detailed",
          finalWordingStandard: "A concise, evidence-backed resume ready for user review.",
          approvedAt: "2026-08-24",
        },
        testCases: [
          {
            id: "resume-complete-input",
            kind: "successful",
            description: "Supported facts produce all required sections.",
          },
          {
            id: "resume-missing-name",
            kind: "missing_required_input",
            description: "A missing name produces an interactive placeholder and blocks export.",
          },
        ],
      },
    },
  };
}

function resumeContract(ledger: DocumentGenerationLedger) {
  const contract = ledger.templates.resume;
  if (!contract) throw new Error("resume fixture contract is required");
  return contract;
}

describe("document generation ledger validation", () => {
  it("accepts a complete representative pilot contract", () => {
    const ledger = validLedger();

    expect(validateDocumentGenerationLedger(ledger)).toEqual([]);
    expect(() => assertValidDocumentGenerationLedger(ledger)).not.toThrow();
  });

  it("fails closed on unknown input and clarification section references", () => {
    const ledger = validLedger();
    const resume = resumeContract(ledger);
    resume.sections[0]!.dependsOnInputs.push("unknown_input");
    resume.requiredInputs[0]!.clarification.blocksSections.push("unknown_section");

    const issues = validateDocumentGenerationLedger(ledger);

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["unknown_input_reference", "unknown_section_reference"]),
    );
  });

  it("rejects duplicate order values and dependency cycles", () => {
    const ledger = validLedger();
    const resume = resumeContract(ledger);
    resume.sections[1]!.order = 0;
    resume.sections[0]!.dependsOnSections = ["professional_summary"];

    const issues = validateDocumentGenerationLedger(ledger);

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["duplicate_section_order", "section_dependency_cycle"]),
    );
  });

  it("rejects an active contract with missing benchmark coverage or test cases", () => {
    const ledger = validLedger();
    const resume = resumeContract(ledger);
    delete resume.qualityBenchmark.sectionExpectations.professional_summary;
    resume.testCases = [];

    const issues = validateDocumentGenerationLedger(ledger);

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["missing_section_benchmark", "missing_template_test_case"]),
    );
  });

  it("rejects template identity drift and silent-blank policy", () => {
    const ledger = validLedger();
    const resume = resumeContract(ledger);
    resume.templateId = "resume-v2";
    resume.missingInformationPolicy.silentBlankAllowed = true;

    const issues = validateDocumentGenerationLedger(ledger);

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["template_identity_mismatch", "silent_blank_permitted"]),
    );
    expect(() => assertValidDocumentGenerationLedger(ledger)).toThrow(/template_identity_mismatch/);
  });
});

describe("immutable ledger persistence boundary validation", () => {
  it("keeps historical identities explicit instead of inferring partial keys", () => {
    expect(
      validatePersistedLedgerIdentity({
        bindingStatus: "legacy_unversioned",
        templateId: null,
        ledgerVersion: null,
        benchmarkVersion: null,
        generationSnapshotId: null,
      }),
    ).toEqual([]);

    expect(
      validatePersistedLedgerIdentity({
        bindingStatus: "legacy_unversioned",
        templateId: "cover-letter",
        ledgerVersion: null,
        benchmarkVersion: null,
        generationSnapshotId: null,
      }).map((issue) => issue.code),
    ).toEqual(["partial_legacy_identity"]);
  });

  it("requires complete immutable identity for captured artifacts and sections", () => {
    expect(
      validatePersistedLedgerIdentity({
        bindingStatus: "captured",
        templateId: "cover-letter",
        ledgerVersion: "ledger.1",
        benchmarkVersion: "cover-letter-benchmark.1",
        generationSnapshotId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toEqual([]);

    expect(
      validatePersistedSectionLedgerIdentity({
        bindingStatus: "captured",
        sectionKey: null,
        ledgerVersion: "ledger.1",
        required: true,
        sourceSectionKey: null,
        transformationVersion: null,
      }).map((issue) => issue.code),
    ).toEqual(["incomplete_captured_section_identity"]);
  });

  it("requires complete replay identity and a lowercase SHA-256 digest", () => {
    expect(
      validateImmutableGenerationSnapshotIdentity({
        generationSnapshotId: "11111111-1111-4111-8111-111111111111",
        generationRequestId: "request-1",
        templateId: "cover-letter",
        ledgerVersion: "ledger.1",
        benchmarkVersion: "cover-letter-benchmark.1",
        pipelineVersion: "pipeline.1",
        snapshotSha256: "a".repeat(64),
      }),
    ).toEqual([]);

    expect(
      validateImmutableGenerationSnapshotIdentity({
        generationSnapshotId: "11111111-1111-4111-8111-111111111111",
        generationRequestId: "request-1",
        templateId: "cover-letter",
        ledgerVersion: "ledger.1",
        benchmarkVersion: "cover-letter-benchmark.1",
        pipelineVersion: "pipeline.1",
        snapshotSha256: "NOT-A-DIGEST",
      }).map((issue) => issue.code),
    ).toEqual(["invalid_snapshot_identity"]);
  });

  it("rejects stale approval metadata after a later edit", () => {
    expect(
      validatePersistedRevisionState({
        currentRevision: 4,
        approvedRevision: 4,
        approvalStatus: "approved",
      }),
    ).toEqual([]);

    expect(
      validatePersistedRevisionState({
        currentRevision: 5,
        approvedRevision: 4,
        approvalStatus: "approved",
      }).map((issue) => issue.code),
    ).toEqual(["approval_revision_mismatch"]);
  });
});

describe("first captured cohort ledger", () => {
  it("contains exactly the five owner-selected templates", () => {
    expect(Object.keys(CAPTURED_DOCUMENT_LEDGER.templates)).toEqual([
      "resume",
      "selection-criteria-response",
      "moving-house-checklist",
      "complaint-letter",
      "incident-near-miss-report",
    ]);
    expect(CAPTURED_DOCUMENT_LEDGER.ledgerVersion).toBe(FIRST_CAPTURED_LEDGER_VERSION);
    expect(validateCapturedDocumentLedger(CAPTURED_DOCUMENT_LEDGER)).toEqual([]);
  });

  it("is recursively frozen once published", () => {
    expect(Object.isFrozen(CAPTURED_DOCUMENT_LEDGER)).toBe(true);
    expect(Object.isFrozen(CAPTURED_DOCUMENT_LEDGER.templates)).toBe(true);
    expect(Object.isFrozen(CAPTURED_DOCUMENT_LEDGER.templates.resume!.sections)).toBe(true);
    expect(Object.isFrozen(CAPTURED_DOCUMENT_LEDGER.templates.resume!.sections[0])).toBe(true);
  });

  it("rejects a ledger with a missing cohort member", () => {
    const changed = JSON.parse(
      JSON.stringify(CAPTURED_DOCUMENT_LEDGER),
    ) as DocumentGenerationLedger;
    delete changed.templates["complaint-letter"];

    expect(validateCapturedDocumentLedger(changed).map((issue) => issue.code)).toContain(
      "captured_cohort_mismatch",
    );
  });

  it("gives every required section a non-blank-capable state policy", () => {
    for (const template of Object.values(CAPTURED_DOCUMENT_LEDGER.templates)) {
      expect(template.missingInformationPolicy.silentBlankAllowed).toBe(false);
      expect(template.missingInformationPolicy.requiredSectionStates).not.toContain(
        "omitted_optional",
      );
      for (const section of template.sections.filter((item) => item.required)) {
        expect(section.missingInformationBehaviour).not.toBe("omitIfOptional");
      }
    }
  });

  it("fails closed on missing high-risk incident facts", () => {
    const incident = CAPTURED_DOCUMENT_LEDGER.templates["incident-near-miss-report"]!;

    for (const input of incident.requiredInputs) {
      expect(input.mayUsePlaceholder).toBe(false);
      expect(input.clarification.behaviour).toBe("blockUntilAnswered");
      expect(input.clarification.fallbackIfUserSkips).toBe("blockGeneration");
    }
  });

  it("records approved provenance without authorising benchmark copying", () => {
    for (const template of Object.values(CAPTURED_DOCUMENT_LEDGER.templates)) {
      expect(template.qualityBenchmark.benchmarkProvenance).toMatchObject({
        approvalStatus: "approved",
        usePolicy: "form_and_depth_only",
      });
      expect(template.qualityBenchmark.benchmarkProvenance?.sourceRefs.length).toBeGreaterThan(0);
    }
  });
});
