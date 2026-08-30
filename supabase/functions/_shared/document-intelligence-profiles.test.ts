import {
  DIPS,
  type DocumentIntelligenceProfile,
  EXTENDED_CATALOGUE,
  renderProfile,
  selectProfile,
} from "./document-intelligence-profiles.ts";
import {
  createDocumentPlaceholderToken,
  parseDocumentPlaceholderTokens,
  validateDocumentInformationContract,
} from "./document-placeholder-policy.ts";
import { assertEquals } from "jsr:@std/assert";

const JOB_APPLICATION_PROFILE_KEYS = [
  "resume",
  "cover-letter",
  "job-search-checklist",
  "interview-prep-questions",
  "interview-script",
  "job-follow-up-email",
  "selection-criteria-response",
  "linkedin-profile-rewrite",
  "star-achievement-bank",
  "recruiter-introduction-email",
] as const;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("every launch job-application document has a complete intelligence profile", () => {
  for (const key of JOB_APPLICATION_PROFILE_KEYS) {
    const profile = DIPS.find((candidate) => candidate.key === key);
    assert(Boolean(profile), `missing Document Intelligence Profile: ${key}`);
    if (!profile) continue;

    assert(
      profile.outputStructure.length >= 2,
      `${key}: missing ordered output structure`,
    );
    assert(
      profile.clarificationQuestions.length >= 1,
      `${key}: missing clarification questions`,
    );
    assert(Boolean(profile.quality), `${key}: missing quality contract`);
    assert(Boolean(profile.benchmarks), `${key}: missing benchmark set`);
    if (!profile.quality || !profile.benchmarks) continue;

    assert(
      profile.quality.requiredStructure.length >= 2,
      `${key}: missing structure gate`,
    );
    assert(
      profile.quality.lengthAndDepth.length >= 1,
      `${key}: missing length/depth gate`,
    );
    assert(
      profile.quality.evidenceRequirements.length >= 1,
      `${key}: missing evidence gate`,
    );
    assert(
      profile.quality.toneAndWording.length >= 1,
      `${key}: missing tone gate`,
    );
    assert(
      profile.quality.intentRelevance.length >= 1,
      `${key}: missing relevance gate`,
    );
    assert(
      profile.quality.prohibitedInventions.length >= 1,
      `${key}: missing invention gate`,
    );
    assert(
      profile.quality.submitReadyChecks.length >= 1,
      `${key}: missing submit-ready gate`,
    );
    assert(
      profile.benchmarks.length >= 1,
      `${key}: missing real-world benchmark`,
    );

    for (const benchmark of profile.benchmarks) {
      assert(
        /^https:\/\//.test(benchmark.url),
        `${key}: benchmark must use HTTPS`,
      );
      assert(
        benchmark.authority.trim().length > 0,
        `${key}: benchmark authority missing`,
      );
      assert(
        benchmark.appliesTo.length >= 1,
        `${key}: benchmark purpose missing`,
      );
      assert(
        Boolean(benchmark.acceptanceSignals?.length),
        `${key}: benchmark acceptance signals missing`,
      );
    }
  }
});

Deno.test("job-application profiles forbid unsupported candidate facts", () => {
  for (const key of JOB_APPLICATION_PROFILE_KEYS) {
    const profile = DIPS.find((candidate) => candidate.key === key);
    assert(Boolean(profile), `missing Document Intelligence Profile: ${key}`);
    if (!profile) continue;

    assert(Boolean(profile.quality), `${key}: missing quality contract`);
    if (!profile.quality) continue;
    const rules = profile.quality.prohibitedInventions.join(" ").toLowerCase();
    assert(
      ["achievement", "qualification", "date", "metric"].every((term) =>
        rules.includes(term)
      ),
      `${key}: prohibited-invention gate must cover achievements, qualifications, dates and metrics`,
    );
  }
});

Deno.test("rendered job profile includes the benchmarked final quality gate", () => {
  const profile = DIPS.find((candidate) => candidate.key === "resume");
  assert(Boolean(profile), "resume profile missing");
  if (!profile) return;

  const rendered = renderProfile(profile, "document");
  for (
    const heading of [
      "REQUIRED STRUCTURE AND SECTION ORDER",
      "APPROPRIATE LENGTH AND DEPTH",
      "SPECIFIC EVIDENCE REQUIREMENTS",
      "PROFESSIONAL TONE AND NATURAL FINAL WORDING",
      "RELEVANCE TO THE USER'S INTENT",
      "PROHIBITED INVENTIONS",
      "GENUINELY READY TO SUBMIT",
      "REAL-WORLD BENCHMARKS",
      "CONTRACT-BACKED EXAMPLE FINAL WORDING",
    ]
  ) {
    assert(rendered.includes(heading), `rendered profile omitted ${heading}`);
  }
  assert(
    rendered.includes("{{TED_PLACEHOLDER:"),
    "rendered document profile omitted interactive placeholder examples",
  );
});

Deno.test("resume contract is internally consistent and matches a submit-ready header", () => {
  const profile = DIPS.find((candidate) => candidate.key === "resume");
  assert(Boolean(profile?.quality), "resume quality contract missing");
  if (!profile?.quality) return;

  const required = profile.requiredInformation.join(" ").toLowerCase();
  assert(
    required.includes("contact"),
    "resume does not require contact details",
  );
  assert(
    required.includes("target role"),
    "resume does not require a target role",
  );

  const structure = [
    ...profile.outputStructure,
    ...profile.quality.requiredStructure,
  ].join(" ").toLowerCase();
  assert(
    structure.includes("name") && structure.includes("contact"),
    "resume structure has no candidate header",
  );

  const wording = [
    ...profile.riskChecks,
    ...profile.quality.toneAndWording,
  ].join(" ").toLowerCase();
  assert(
    !wording.includes("first person,"),
    "resume contract incorrectly requests first-person wording",
  );
  assert(
    !wording.includes("raw markdown markers"),
    "resume contract contradicts the pipeline's markdown output format",
  );
});

Deno.test("resume has executable proof fixtures for sufficiency, missing facts and invention pressure", () => {
  const profile = DIPS.find((candidate) => candidate.key === "resume") as
    | (DocumentIntelligenceProfile & {
      proofFixtures?: Array<{
        id: string;
        mode: string;
        conversation: string;
        expectedFacts: Array<{ value: string; section: string }>;
        requiredMissingFacts: string[];
        forbiddenClaims: string[];
      }>;
    })
    | undefined;
  assert(Boolean(profile), "resume profile missing");
  if (!profile) return;

  const fixtures = profile.proofFixtures ?? [];
  assert(
    fixtures.length === 3,
    "resume must have exactly three proof fixtures",
  );
  assert(
    new Set(fixtures.map((fixture) => fixture.mode)).size === 3,
    "resume proof fixtures must cover three distinct evidence modes",
  );
  assert(
    fixtures.some((fixture) => fixture.mode === "sufficient-context"),
    "resume is missing a sufficient-context fixture",
  );
  assert(
    fixtures.some((fixture) => fixture.mode === "missing-vital"),
    "resume is missing a missing-vital fixture",
  );
  assert(
    fixtures.some((fixture) => fixture.mode === "invention-pressure"),
    "resume is missing an invention-pressure fixture",
  );

  for (const fixture of fixtures) {
    assert(fixture.id.trim().length > 0, "resume proof fixture id is blank");
    assert(
      fixture.conversation.trim().length >= 80,
      `${fixture.id}: conversation is too thin to prove generation behaviour`,
    );
    assert(
      fixture.expectedFacts.length + fixture.requiredMissingFacts.length >= 2,
      `${fixture.id}: fixture has no meaningful factual oracle`,
    );
    assert(
      fixture.forbiddenClaims.length >= 1,
      `${fixture.id}: fixture has no anti-invention oracle`,
    );
    for (const expected of fixture.expectedFacts) {
      assert(
        expected.value.trim().length > 0,
        `${fixture.id}: expected fact is blank`,
      );
      assert(
        expected.section.trim().length > 0,
        `${fixture.id}: fact has no destination section`,
      );
    }
  }
});

Deno.test("proof evaluator rejects a supplied fact placed in the wrong resume section", async () => {
  let evaluateDocumentProof:
    | ((input: {
      profile: DocumentIntelligenceProfile;
      fixture: NonNullable<
        DocumentIntelligenceProfile["proofFixtures"]
      >[number];
      sections: Array<
        { key: string; label: string; content: string; required: boolean }
      >;
      reportedMissingFacts: string[];
    }) => { passed: boolean; issues: Array<{ code: string }> })
    | undefined;
  try {
    const proofModule = await import("./document-proof.ts");
    evaluateDocumentProof = proofModule.evaluateDocumentProof;
  } catch {
    // The first red run proves the evaluator does not exist yet.
  }
  assert(Boolean(evaluateDocumentProof), "document proof evaluator is missing");
  if (!evaluateDocumentProof) return;

  const profile = DIPS.find((candidate) => candidate.key === "resume");
  const fixture = profile?.proofFixtures?.find((candidate) =>
    candidate.id === "resume-sufficient-warehouse-manager"
  );
  assert(
    Boolean(profile && fixture),
    "resume sufficient-context fixture missing",
  );
  if (!profile || !fixture) return;

  const result = evaluateDocumentProof({
    profile,
    fixture,
    sections: [
      {
        key: "contact_details",
        label: "Contact Details",
        content: "Alex Morgan | 0400 123 456 | alex.morgan@example.com",
        required: true,
      },
      {
        key: "summary",
        label: "Professional Summary",
        content:
          "Warehouse supervisor targeting warehouse operations management roles. Diploma of Logistics.",
        required: true,
      },
      {
        key: "experience",
        label: "Employment History",
        content:
          "Northstar Distribution — Warehouse Supervisor. Improved on-time dispatch from 88% to 97%.",
        required: true,
      },
    ],
    reportedMissingFacts: [],
  });

  assert(!result.passed, "misplaced Diploma of Logistics must fail proof");
  assert(
    result.issues.some((issue) => issue.code === "FACT_MISSING_FROM_SECTION"),
    "misplaced fact did not produce a section-specific issue",
  );
});

Deno.test("resume invention-pressure proof rejects a fabricated sales metric", async () => {
  const { evaluateDocumentProof } = await import("./document-proof.ts");
  const profile = DIPS.find((candidate) => candidate.key === "resume");
  const fixture = profile?.proofFixtures?.find((candidate) =>
    candidate.id === "resume-resists-invention-pressure"
  );
  assert(
    Boolean(profile && fixture),
    "resume invention-pressure fixture missing",
  );
  if (!profile || !fixture) return;

  const result = evaluateDocumentProof({
    profile,
    fixture,
    sections: [
      {
        key: "summary",
        label: "Value Proposition",
        content: "Store Assistant pursuing a Store Supervisor role.",
        required: true,
      },
      {
        key: "experience",
        label: "Employment History",
        content:
          "Harbour Retail — Store Assistant, June 2023 to present. Increased sales by 40% while leading a five-person team.",
        required: true,
      },
    ],
    reportedMissingFacts: [],
  });

  assert(!result.passed, "fabricated sales metric must fail proof");
  assert(
    result.issues.some((issue) => issue.code === "FORBIDDEN_CLAIM_PRESENT"),
    "fabricated sales metric did not produce an invention issue",
  );
});

Deno.test("all 86 extended-catalogue documents have one complete profile", () => {
  assert(
    EXTENDED_CATALOGUE.length === 86,
    `extended catalogue must contain 86 documents, received ${EXTENDED_CATALOGUE.length}`,
  );
  assert(
    DIPS.length === 86,
    `DIP registry must contain 86 profiles, received ${DIPS.length}`,
  );
  assert(
    new Set(DIPS.map((profile) => profile.key)).size === 86,
    "DIP keys must be unique",
  );

  for (const profile of DIPS) {
    assert(
      profile.outputStructure.length >= 2,
      `${profile.key}: missing ordered output structure`,
    );
    assert(
      !profile.outputStructure.includes(
        "required core content in conventional order",
      ),
      `${profile.key}: still uses the generic fallback structure`,
    );
    assert(
      profile.requiredInformation.length >= 1,
      `${profile.key}: missing required information`,
    );
    assert(
      profile.clarificationQuestions.length >= 1,
      `${profile.key}: missing clarification questions`,
    );
    assert(
      Boolean(profile.quality),
      `${profile.key}: missing seven-part quality contract`,
    );
    assert(
      Boolean(profile.benchmarks?.length),
      `${profile.key}: missing benchmark`,
    );
    for (const benchmark of profile.benchmarks ?? []) {
      assert(
        Boolean(benchmark.acceptanceSignals?.length),
        `${profile.key}: benchmark has no observable acceptance signals`,
      );
    }
    if (!profile.quality) continue;
    assert(
      profile.quality.requiredStructure.length >= 2,
      `${profile.key}: missing structure check`,
    );
    assert(
      profile.quality.lengthAndDepth.length >= 1,
      `${profile.key}: missing length/depth check`,
    );
    assert(
      profile.quality.evidenceRequirements.length >= 1,
      `${profile.key}: missing evidence check`,
    );
    assert(
      profile.quality.toneAndWording.length >= 1,
      `${profile.key}: missing tone check`,
    );
    assert(
      profile.quality.intentRelevance.length >= 1,
      `${profile.key}: missing intent check`,
    );
    assert(
      profile.quality.prohibitedInventions.length >= 1,
      `${profile.key}: missing invention check`,
    );
    assert(
      profile.quality.submitReadyChecks.length >= 1,
      `${profile.key}: missing submit-ready check`,
    );
  }
});

Deno.test("every canonical catalogue name selects its own intelligence profile", () => {
  for (const [key, label, domain] of EXTENDED_CATALOGUE) {
    const selected = selectProfile(`${label}\n${key}`, domain);
    assert(
      selected?.key === key,
      `${key}: selected ${selected?.key ?? "no profile"}`,
    );
  }
});

// Originally 38 of 79 pre-existing catalogue templates had hand-authored
// profiles; the other 41 (47, once the 6 workplace-governance documents
// that only had informationContract/internalReview but not authored
// clarificationQuestions/requiredInformation/riskChecks are counted
// correctly) ran on generic completeProfile() fallbacks for those three
// fields. Every EXTENDED_CATALOGUE entry — the original 79 and the 7 that
// closed the personal-track gap — is now hand-authored to the same
// benchmark: multiple template-specific clarification questions covering
// the vital facts, not the single generic fallback question.
Deno.test("every catalogue template is authored to the same benchmark — none left on the generic fallback", () => {
  const GENERIC_CLARIFICATION_PATTERN = /^What must this .+ achieve/;
  const GENERIC_REQUIRED_INFO = [
    "purpose",
    "audience",
    "confirmed facts needed by the document",
  ];

  for (const [key] of EXTENDED_CATALOGUE) {
    const profile = DIPS.find((p) => p.key === key);
    assert(Boolean(profile), `${key}: missing from DIPS`);
    if (!profile) continue;

    assert(
      profile.clarificationQuestions.length >= 2,
      `${key}: only ${profile.clarificationQuestions.length} clarification question(s) — expected multiple, template-specific questions like the other authored profiles`,
    );
    assert(
      !profile.clarificationQuestions.some((q) =>
        GENERIC_CLARIFICATION_PATTERN.test(q)
      ),
      `${key}: still using the generic fallback clarification question`,
    );
    assert(
      JSON.stringify(profile.requiredInformation) !==
        JSON.stringify(GENERIC_REQUIRED_INFO),
      `${key}: still using the generic fallback requiredInformation`,
    );
    assert(
      profile.requiredInformation.length >= 2,
      `${key}: requiredInformation too thin (${profile.requiredInformation.length})`,
    );
    assert(
      profile.matches.length > 2,
      `${key}: matches only cover the name itself, no real keyword variations`,
    );
    assert(
      profile.riskChecks.length >= 2,
      `${key}: riskChecks too thin (${profile.riskChecks.length})`,
    );
  }
});

// The mechanical anti-boilerplate check: catches the "copy-pasted and
// changed one word" failure mode directly, across the whole catalogue, not
// just by eyeballing each entry.
Deno.test("no two catalogue templates share identical clarification questions or required information", () => {
  const seenQuestions = new Map<string, string>();
  const seenRequiredInfo = new Map<string, string>();

  for (const [key] of EXTENDED_CATALOGUE) {
    const profile = DIPS.find((p) => p.key === key);
    if (!profile) continue;

    const requiredInfoSignature = JSON.stringify(
      [...profile.requiredInformation].sort(),
    );
    const priorRequiredInfoOwner = seenRequiredInfo.get(requiredInfoSignature);
    assert(
      !priorRequiredInfoOwner,
      `${key}: requiredInformation is identical to ${priorRequiredInfoOwner}`,
    );
    seenRequiredInfo.set(requiredInfoSignature, key);

    for (const question of profile.clarificationQuestions) {
      const priorOwner = seenQuestions.get(question);
      assert(
        !priorOwner || priorOwner === key,
        `${key}: clarification question "${question}" is reused verbatim from ${priorOwner}`,
      );
      seenQuestions.set(question, key);
    }
  }
});

// Generic gate for every Enhanced DIP (informationContract + internalReview),
// independent of the bespoke per-profile "strict workflow review" suites for
// the earliest templates. Catches the same class of defect — malformed
// contracts, thin sign-offs — across the whole catalogue as Enhanced DIP
// coverage grows, without requiring a new bespoke test file per template.
const ENHANCED_DIP_REVIEW_AREAS = [
  "contract completeness",
  "intake and context reuse",
  "generation resilience",
  "factual safety",
  "placeholder integrity",
  "resolution behaviour",
  "proofread behaviour",
  "workspace persistence",
  "issue navigation",
  "export behaviour",
  "accessibility and recovery",
  "regression and release evidence",
] as const;

Deno.test("every profile with an Enhanced DIP information contract passes the universal validator and 12-point review benchmark", () => {
  const withContract = DIPS.filter((profile) => profile.informationContract);
  assert(
    withContract.length > 0,
    "expected at least one profile to carry an Enhanced DIP information contract",
  );

  for (const profile of withContract) {
    const contract = profile.informationContract!;
    assertEquals(
      contract.status,
      "complete",
      `${profile.key}: contract status must be complete`,
    );
    assertEquals(
      validateDocumentInformationContract(profile.key, contract),
      [],
      `${profile.key}: information contract failed validation`,
    );

    assert(
      Boolean(profile.internalReview),
      `${profile.key}: missing internalReview alongside informationContract`,
    );
    if (!profile.internalReview) continue;
    assertEquals(
      profile.internalReview.status,
      "passed",
      `${profile.key}: internalReview.status must be "passed"`,
    );
    assertEquals(
      profile.internalReview.criteria.length,
      12,
      `${profile.key}: internalReview must have exactly 12 criteria`,
    );
    for (const area of ENHANCED_DIP_REVIEW_AREAS) {
      assert(
        profile.internalReview.criteria.some((criterion) =>
          criterion.startsWith(`${area}:`)
        ),
        `${profile.key}: internalReview missing review area "${area}"`,
      );
    }

    for (const section of contract.sections) {
      for (const item of section.requiredInformation) {
        assert(
          item.factType.trim().length > 0,
          `${profile.key}:${section.sectionKey}:${item.key} missing factType`,
        );
      }
    }
  }
});

Deno.test("every catalogue profile exposes contract-backed example final wording with interactive placeholders", () => {
  for (const profile of DIPS) {
    assert(
      Boolean(profile.exampleFinalWording),
      `${profile.key}: missing example final wording`,
    );
    const example = profile.exampleFinalWording!;
    assertEquals(
      example.source,
      "enhanced-dip-information-contract",
      `${profile.key}: example must be sourced from the Enhanced DIP contract`,
    );
    assert(
      example.purpose.includes("canonical authored final-wording example"),
      `${profile.key}: example must use a manually authored final-wording template`,
    );
    assert(
      example.sections.length > 0,
      `${profile.key}: example has no sections`,
    );

    const declaredTokens = new Set<string>();
    for (const section of profile.informationContract?.sections ?? []) {
      for (const item of section.requiredInformation) {
        declaredTokens.add(
          createDocumentPlaceholderToken(
            `${profile.key}.${section.sectionKey}.${item.key}`,
            item.placeholderLabel,
          ),
        );
      }
    }

    const rendered = example.sections.map((section) => section.content).join(
      "\n\n",
    );
    assert(
      !/\[[^\]]+\]/.test(rendered),
      `${profile.key}: example uses legacy square-bracket placeholders`,
    );

    const tokens = parseDocumentPlaceholderTokens(rendered);
    if (declaredTokens.size > 0) {
      assert(
        tokens.length > 0,
        `${profile.key}: contract-backed example has no interactive placeholders`,
      );
    }
    for (const token of tokens) {
      assert(
        declaredTokens.has(token.token),
        `${profile.key}: example used undeclared placeholder token ${token.token}`,
      );
    }
  }
});
