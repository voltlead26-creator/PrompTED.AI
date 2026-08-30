import {
  CERTIFICATION_DIMENSIONS,
  scoreDocumentCertification,
  validateCertificationFixtureSet,
  type DocumentCertificationFixture,
} from "./document-certification.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function fixture(
  mode: DocumentCertificationFixture["mode"],
): DocumentCertificationFixture {
  return {
    id: `resume-${mode}`,
    templateKey: "resume",
    mode,
    conversation:
      "Alex Morgan is a warehouse supervisor targeting warehouse operations manager roles. The supplied facts are intentionally detailed enough for a certification fixture and must remain grounded.",
    expectedFacts: [{ value: "Alex Morgan", section: "contact details" }],
    requiredMissingFacts: mode === "missing-vital" ? ["email address"] : [],
    forbiddenClaims: mode === "invention-pressure" ? ["increased sales by 40%"] : [],
  };
}

Deno.test("certification contract covers all nine PrompTED outcome dimensions", () => {
  assert(CERTIFICATION_DIMENSIONS.length === 9, "expected nine certification dimensions");
  assert(new Set(CERTIFICATION_DIMENSIONS).size === 9, "certification dimensions must be unique");

  for (
    const dimension of [
      "complete",
      "factually_grounded",
      "correctly_structured",
      "appropriately_deep",
      "natural_final_wording",
      "tailored_to_situation",
      "no_instruction_scaffolding",
      "ready_for_real_world_use",
      "outcome_helpfulness",
    ] as const
  ) {
    assert(CERTIFICATION_DIMENSIONS.includes(dimension), `missing ${dimension}`);
  }
});

Deno.test("every template certification set requires the three evidence modes", () => {
  const valid = [
    fixture("sufficient-context"),
    fixture("missing-vital"),
    fixture("invention-pressure"),
  ];
  assert(validateCertificationFixtureSet("resume", valid).length === 0, "complete set should validate");

  const missingMode = validateCertificationFixtureSet("resume", valid.slice(0, 2));
  assert(
    missingMode.some((issue) => issue.includes("invention-pressure")),
    "missing invention-pressure fixture must fail",
  );
});

Deno.test("certification fails closed when deterministic proof fails", () => {
  const scores = Object.fromEntries(
    CERTIFICATION_DIMENSIONS.map((dimension) => [dimension, 10]),
  ) as Record<(typeof CERTIFICATION_DIMENSIONS)[number], number>;

  const result = scoreDocumentCertification({
    deterministicPassed: false,
    scores,
  });

  assert(!result.passed, "deterministic proof failure must block certification");
  assert(result.blockers.some((item) => item.includes("deterministic")), "missing deterministic blocker");
});

Deno.test("certification fails when any quality dimension is below 8", () => {
  const scores = Object.fromEntries(
    CERTIFICATION_DIMENSIONS.map((dimension) => [dimension, 9]),
  ) as Record<(typeof CERTIFICATION_DIMENSIONS)[number], number>;
  scores.natural_final_wording = 7.9;

  const result = scoreDocumentCertification({
    deterministicPassed: true,
    scores,
  });

  assert(!result.passed, "sub-8 quality must fail");
  assert(
    result.blockers.some((item) => item.includes("natural_final_wording")),
    "low-scoring dimension must be named",
  );
});

Deno.test("certification passes only with deterministic proof and PrompTED-level quality", () => {
  const scores = Object.fromEntries(
    CERTIFICATION_DIMENSIONS.map((dimension) => [dimension, 9]),
  ) as Record<(typeof CERTIFICATION_DIMENSIONS)[number], number>;

  const result = scoreDocumentCertification({
    deterministicPassed: true,
    scores,
  });

  assert(result.passed, "9/10 across all dimensions should certify");
  assert(result.average === 9, "expected exact average score");
});
