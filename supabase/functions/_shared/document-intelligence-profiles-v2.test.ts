import {
  assertValidEnhancedDocumentIntelligenceProfilesV2,
  ENHANCED_DIPS_V2,
  type EnhancedDocumentIntelligenceProfileV2,
  validateEnhancedDocumentIntelligenceProfilesV2,
} from "./document-intelligence-profiles-v2.ts";

function assert(
  condition: unknown,
  message = "Expected condition to be truthy",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

function assertStringIncludes(actual: string, expected: string): void {
  if (!actual.includes(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(actual)} to include ${
        JSON.stringify(expected)
      }`,
    );
  }
}

function cloneProfiles(): EnhancedDocumentIntelligenceProfileV2[] {
  return structuredClone(ENHANCED_DIPS_V2);
}

function expectIssue(
  mutate: (profiles: EnhancedDocumentIntelligenceProfileV2[]) => void,
  expected: string,
): void {
  const profiles = cloneProfiles();
  mutate(profiles);
  const issues = validateEnhancedDocumentIntelligenceProfilesV2(profiles);
  assert(
    issues.some((issue) => issue.includes(expected)),
    `Expected issue containing ${JSON.stringify(expected)}; got:\n${
      issues.join("\n")
    }`,
  );
}

Deno.test("compiles all 86 Enhanced DIPs into valid ledger-ready shadow profiles", () => {
  assertEquals(ENHANCED_DIPS_V2.length, 86);
  assertValidEnhancedDocumentIntelligenceProfilesV2(ENHANCED_DIPS_V2);
  assertEquals(
    new Set(ENHANCED_DIPS_V2.map((profile) => profile.templateId)).size,
    86,
  );
  for (const profile of ENHANCED_DIPS_V2) {
    assertEquals(profile.lifecycle.status, "draft");
    assertEquals(profile.lifecycle.ownerApprovalRequired, true);
    assertEquals(profile.architecturalRole.liveRuntimeAuthority, false);
    assertEquals(profile.architecturalRole.shadowOnly, true);
    assertEquals(profile.compatibility.liveMigrationImplemented, false);
    assertEquals(profile.compatibility.modelRedistributionAllowed, false);
  }
});

Deno.test("preserves 68 exact profiles and marks the 18 owner-approved shadow profiles", () => {
  const exact = ENHANCED_DIPS_V2.filter((profile) =>
    profile.compatibility.status === "exact"
  );
  const approved = ENHANCED_DIPS_V2.filter((profile) =>
    profile.compatibility.status === "owner_approved_shadow"
  );
  assertEquals(exact.length, 68);
  assertEquals(approved.length, 18);
  assert(
    approved.every((profile) =>
      profile.compatibility.permanentHistoricalReadWhileReferenced &&
      profile.compatibility.ownerDecisionStatus === "approved" &&
      profile.compatibility.unresolvedOwnerDecisions.length === 0
    ),
  );
});

Deno.test("applies the four owner-approved new canonical section policies", () => {
  const approvedNewSections = ENHANCED_DIPS_V2.flatMap((profile) =>
    profile.sections.filter((section) =>
      section.compatibility.classification.includes("new_canonical_section")
    ).map((section) => ({
      templateId: profile.templateId,
      sectionKey: section.sectionKey,
      requiredness: section.requiredness,
      missingInformationBehaviour: section.missingInformationBehaviour,
      questions: section.compatibility.unresolvedQuestions,
    }))
  );
  assertEquals(
    approvedNewSections.map((item) =>
      `${item.templateId}:${item.sectionKey}:${item.requiredness}`
    ).sort(),
    [
      "interview-script:candidate_questions:optional",
      "interview-script:closing:optional",
      "job-follow-up-email:sign_off:required",
      "terms-of-employment:acknowledgement:jurisdiction_controlled",
    ],
  );
  for (const item of approvedNewSections) {
    assertEquals(item.questions, []);
    assert(item.missingInformationBehaviour !== "blockGeneration");
  }
});

Deno.test("represents rename, split, and merge compatibility without discarding historical keys", () => {
  const businessEmail = ENHANCED_DIPS_V2.find((profile) =>
    profile.templateId === "business-email"
  );
  const coverLetter = ENHANCED_DIPS_V2.find((profile) =>
    profile.templateId === "cover-letter"
  );
  const promotionCase = ENHANCED_DIPS_V2.find((profile) =>
    profile.templateId === "promotion-case"
  );
  assert(businessEmail && coverLetter && promotionCase);

  const subject = businessEmail.sections.find((section) =>
    section.sectionKey === "subject_and_greeting"
  );
  assert(subject);
  assertEquals(subject.compatibility.classification, ["one_to_one_rename"]);
  assertEquals(subject.compatibility.legacyKeys, ["subject"]);
  assertEquals(subject.compatibility.preserveHistoricalRead, true);

  const opening = coverLetter.sections.find((section) =>
    section.sectionKey === "opening"
  );
  assert(opening);
  assert(opening.compatibility.classification.includes("one_to_many_split"));
  assertEquals(opening.compatibility.deterministicMigrationPossible, false);
  assert(
    opening.forbiddenContent.some((rule) =>
      rule.includes("model-based redistribution")
    ),
  );

  const capability = promotionCase.sections.find((section) =>
    section.sectionKey === "capability_match"
  );
  assert(capability);
  assert(capability.compatibility.classification.includes("many_to_one_merge"));
  assertEquals(capability.compatibility.legacyKeys.sort(), [
    "impact",
    "readiness",
  ]);
  assertEquals(capability.compatibility.compatibilityAdapterRequired, true);
});

Deno.test("makes factual clarification section-scoped, source-aware, and export-aware", () => {
  const followUp = ENHANCED_DIPS_V2.find((profile) =>
    profile.templateId === "job-follow-up-email"
  );
  const event = followUp?.sections.find((section) =>
    section.sectionKey === "event_reference"
  );
  const eventDate = event?.inputs.find((input) =>
    input.key === "event_reference.event_date"
  );
  const confirmedEvent = event?.inputs.find((input) =>
    input.key === "event_reference.confirmed_event"
  );
  assert(event && eventDate && confirmedEvent);
  assertEquals(event.missingInformationBehaviour, "askClarifyingQuestion");
  assertEquals(eventDate.clarification.blocksSections, ["event_reference"]);
  assertEquals(eventDate.mayInfer, false);
  assertEquals(confirmedEvent.clarification.blocksExport, true);
  assert(
    confirmedEvent.validationRules.includes(
      "value_must_have_an_allowed_source",
    ),
  );
});

Deno.test("gives every section a document-specific quality contract and benchmark observation", () => {
  for (const profile of ENHANCED_DIPS_V2) {
    assert(profile.benchmarks.sourceReferences.length > 0);
    assertStringIncludes(
      profile.benchmarks.benchmarkUseRule,
      "Never copy wording",
    );
    for (const section of profile.sections) {
      assert(section.qualityExpectation.approximateWordRange);
      assert(
        section.qualityExpectation.minimumViableOutput.semanticRequirements
          .length > 0,
      );
      assert(
        profile.benchmarks.sectionExpectations[section.sectionKey],
        `${profile.templateId}:${section.sectionKey} missing benchmark expectation`,
      );
      assert(
        section.qualityExpectation.mustAvoid.some((rule) =>
          rule.includes("benchmark wording")
        ),
      );
    }
  }
});

Deno.test("rejects a missing profile", () => {
  expectIssue((profiles) => profiles.pop(), "profile count must match");
});

Deno.test("rejects duplicate profile identity", () => {
  expectIssue((profiles) => {
    profiles[1].templateId = profiles[0].templateId;
  }, "profile ids must be unique");
});

Deno.test("rejects promotion of a shadow profile to live authority", () => {
  expectIssue((profiles) => {
    (profiles[0].architecturalRole as {
      liveRuntimeAuthority: boolean;
    }).liveRuntimeAuthority = true;
  }, "architectural role must remain shadow source evidence");
});

Deno.test("rejects removal of historical-read compatibility", () => {
  expectIssue((profiles) => {
    const profile = profiles.find((candidate) =>
      candidate.templateId === "business-email"
    );
    if (profile) {
      profile.sections[0].compatibility.preserveHistoricalRead = false;
    }
  }, "historical read support is required");
});

Deno.test("rejects reintroducing unresolved requiredness after owner approval", () => {
  expectIssue(
    (profiles) => {
      const profile = profiles.find((candidate) =>
        candidate.templateId === "interview-script"
      );
      const section = profile?.sections.find((candidate) =>
        candidate.sectionKey === "candidate_questions"
      );
      if (section) section.requiredness = "owner_decision_required";
    },
    "approved new canonical section must have no legacy identity and resolved requiredness",
  );
});

Deno.test("rejects an unknown clarification section reference", () => {
  expectIssue((profiles) => {
    const input = profiles[0].sections[0].inputs[0];
    input.clarification.blocksSections = ["unknown_section"];
  }, "unknown blocked section unknown_section");
});

Deno.test("rejects missing semantic quality requirements", () => {
  expectIssue((profiles) => {
    profiles[0].sections[0].qualityExpectation.minimumViableOutput
      .semanticRequirements = [];
  }, "semantic quality requirements are required");
});

Deno.test("rejects incomplete benchmark coverage", () => {
  expectIssue((profiles) => {
    const profile = profiles[0];
    delete profile.benchmarks
      .sectionExpectations[profile.sections[0].sectionKey];
  }, "benchmark expectations must cover every section exactly once");
});
