import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert@1";
import {
  CAPTURED_GROUNDING_PIPELINE_VERSION,
  capturedDocumentOutputSchema,
  capturedDocumentSystemPrompt,
  capturedDocumentUserMessage,
  type CapturedGroundingIdentity,
  capturedGroundingReviewSchema,
  capturedGroundingSystemPrompt,
  CapturedOperationInputError,
  planCapturedInputs,
  prepareCapturedDocumentAssessment,
  validateCapturedDocumentAssessment,
} from "./captured-document-operation.ts";
import {
  GROUNDED_CAPTURED_DOCUMENT_LEDGER,
  GROUNDED_CAPTURED_LEDGER_VERSION,
} from "../../../packages/shared/src/document-ledger.ts";

import {
  facts,
  output,
  passingReview,
} from "./captured-document-grounding.fixtures.ts";

const identity: CapturedGroundingIdentity = {
  operation_id: "00000000-0000-4000-8000-000000000111",
  document_id: "00000000-0000-4000-8000-000000000222",
  accepted_document_revision: 1,
  input_revision: 1,
  generation_snapshot_sha256: "a".repeat(64),
  ledger_version: GROUNDED_CAPTURED_LEDGER_VERSION,
  pipeline_version: CAPTURED_GROUNDING_PIPELINE_VERSION,
};
function plan() {
  return planCapturedInputs(
    "complaint-letter",
    facts,
    GROUNDED_CAPTURED_DOCUMENT_LEDGER,
  );
}

Deno.test("SQL grounding fixture retains the real ledger and accepted synthetic plan", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../tests/captured_exact_wording_assessment.test.sql",
      import.meta.url,
    ),
  );
  const match = sql.match(
    /\$grounded_fixture\$([\s\S]*?)\$grounded_fixture\$::jsonb/,
  );
  assert(
    match,
    "The SQL behavioral fixture must embed its attributable inputs.",
  );
  // PostgreSQL receives the JSON wire form; optional JS undefined properties
  // are absent there, just as they are in the real RPC request.
  assertEquals(
    JSON.parse(match[1]),
    JSON.parse(JSON.stringify({
      ledger: GROUNDED_CAPTURED_DOCUMENT_LEDGER,
      plan: plan(),
      candidate: output(),
    })),
  );
});
// These four assertions initially ran against the original production validator
// and all failed (wp1-captured-grounding-before.log). They now target the new
// final assessment boundary, whose runner/SQL integration is a separate gate.

for (
  const [name, index, invented] of [
    [
      "five-million-dollar damages",
      0,
      "The duplicate debit caused five-million-dollar damages.",
    ],
    [
      "invented criminal admission",
      0,
      "Synthetic Energy Co admitted criminal fraud.",
    ],
    [
      "unrelated claim with a legitimate source ID",
      2,
      "The regulator awarded me a lifetime free electricity supply.",
    ],
    [
      "fabricated neutral fallback",
      3,
      "Synthetic Energy Co admitted criminal fraud and owes five-million-dollar damages.",
    ],
  ] as const
) {
  Deno.test(`captured grounding blocks ${name}`, async () => {
    const candidate = output();
    candidate.sections[index].content += ` ${invented}`;
    const result = await validateCapturedDocumentAssessment(
      plan(),
      candidate,
      identity,
      undefined,
    );
    assertEquals(result.validation.passed, false);
    assertEquals(result.validation.material_claim_grounding_checked, false);
    assert(
      result.validation.issues.some((issue) =>
        issue.code === "grounding_review_required"
      ),
    );
  });
}

Deno.test("specific supported synthetic wording passes only its complete exact assessment", async () => {
  const candidate = output();
  const prepared = await prepareCapturedDocumentAssessment(
    plan(),
    candidate,
    identity,
  );
  assertEquals(prepared.issues, []);
  const result = await validateCapturedDocumentAssessment(
    plan(),
    candidate,
    identity,
    passingReview(prepared.target),
  );
  assertEquals(result.validation.passed, true);
  assertEquals(result.validation.mandatory_checks_complete, true);
  assertEquals(result.validation.material_claim_grounding_checked, true);
  assertEquals(result.sections, candidate.sections);
  assertEquals(result.validation.identity, identity);
  assertEquals(
    result.validation.validator_version,
    "captured-output-validator.2",
  );
});

for (
  const [name, mutate] of [
    [
      "missing section",
      (review: ReturnType<typeof passingReview>) => review.sections.pop(),
    ],
    [
      "duplicate section",
      (review: ReturnType<typeof passingReview>) =>
        review.sections[1] = review.sections[0],
    ],
    [
      "out of order section",
      (review: ReturnType<typeof passingReview>) => review.sections.reverse(),
    ],
    [
      "wrong wording digest",
      (review: ReturnType<typeof passingReview>) =>
        review.sections[0].content_sha256 = "b".repeat(64),
    ],
    [
      "wrong target digest",
      (review: ReturnType<typeof passingReview>) =>
        review.target_sha256 = "b".repeat(64),
    ],
    [
      "missing source evidence",
      (review: ReturnType<typeof passingReview>) =>
        review.sections[0].evidence.pop(),
    ],
    [
      "invented source quote",
      (review: ReturnType<typeof passingReview>) =>
        review.sections[0].evidence[0].quote = "Criminal fraud was admitted.",
    ],
    [
      "unrelated section evidence",
      (review: ReturnType<typeof passingReview>) =>
        review.sections[0].evidence.push({
          source_id: "input:desired_outcome",
          quote: facts.desired_outcome,
        }),
    ],
    [
      "empty source quote",
      (review: ReturnType<typeof passingReview>) =>
        review.sections[0].evidence[0].quote = "  ",
    ],
    [
      "rejected review",
      (review: ReturnType<typeof passingReview>) =>
        review.sections[0].checks.material_claim_support = "fail",
    ],
    [
      "uncertain review",
      (review: ReturnType<typeof passingReview>) =>
        review.sections[0].checks.material_claim_support = "uncertain",
    ],
    [
      "unsupported issue despite passing flags",
      (review: ReturnType<typeof passingReview>) =>
        review.sections[0].issues.push({
          code: "unsupported_fact",
          detail: "The amount is unsupported.",
        }),
    ],
  ] as const
) {
  Deno.test(`captured assessment rejects ${name}`, async () => {
    const { target } = await prepareCapturedDocumentAssessment(
      plan(),
      output(),
      identity,
    );
    const review = passingReview(target);
    mutate(review);
    assertEquals(
      (await validateCapturedDocumentAssessment(
        plan(),
        output(),
        identity,
        review,
      )).validation.passed,
      false,
    );
  });
}

for (
  const [name, reviewValue] of [
    ["malformed response", { passed: true }],
    ["replacement wording", output()],
    ["null response", null],
    ["JSON string", JSON.stringify({ passed: true })],
  ] as const
) {
  Deno.test(`captured assessment rejects ${name}`, async () => {
    const result = await validateCapturedDocumentAssessment(
      plan(),
      output(),
      identity,
      reviewValue,
    );
    assertEquals(result.validation.passed, false);
    assertEquals(result.validation.mandatory_checks_complete, false);
  });
}

Deno.test("every grounding check is mandatory and closed", async () => {
  const { target } = await prepareCapturedDocumentAssessment(
    plan(),
    output(),
    identity,
  );
  const review = passingReview(target);
  const base = review.sections[0];
  for (
    const checks of [
      { ...base.checks, invented_check: "pass" },
      Object.fromEntries(
        Object.entries(base.checks).filter(([key]) =>
          key !== "material_claim_support"
        ),
      ),
      { ...base.checks, material_claim_support: true },
    ]
  ) {
    const malformed = {
      ...review,
      sections: [{ ...base, checks }, ...review.sections.slice(1)],
    };
    assertEquals(
      (await validateCapturedDocumentAssessment(
        plan(),
        output(),
        identity,
        malformed,
      )).validation.passed,
      false,
    );
  }
});

for (
  const [name, change] of [
    ["operation", { operation_id: "00000000-0000-4000-8000-000000000333" }],
    ["document", { document_id: "00000000-0000-4000-8000-000000000333" }],
    ["document revision", { accepted_document_revision: 2 }],
    ["input revision", { input_revision: 2 }],
    ["accepted snapshot", { generation_snapshot_sha256: "b".repeat(64) }],
  ] as const
) {
  Deno.test(`assessment cannot move to a different ${name}`, async () => {
    const { target } = await prepareCapturedDocumentAssessment(
      plan(),
      output(),
      identity,
    );
    assertEquals(
      (await validateCapturedDocumentAssessment(plan(), output(), {
        ...identity,
        ...change,
      }, passingReview(target))).validation.passed,
      false,
    );
  });
}

Deno.test("wording, source and provenance changes invalidate the old assessment", async () => {
  const { target } = await prepareCapturedDocumentAssessment(
    plan(),
    output(),
    identity,
  );
  const review = passingReview(target);
  const edited = output();
  edited.sections[0].content += " Synthetic Energy Co admitted criminal fraud.";
  const changed = planCapturedInputs("complaint-letter", {
    ...facts,
    issue_facts: facts.issue_facts + " The original entry was later reversed.",
  }, GROUNDED_CAPTURED_DOCUMENT_LEDGER);
  assertEquals(
    (await validateCapturedDocumentAssessment(plan(), edited, identity, review))
      .validation.passed,
    false,
  );
  assertEquals(
    (await validateCapturedDocumentAssessment(
      changed,
      output(),
      identity,
      review,
    )).validation.passed,
    false,
  );
  const invalid = plan();
  invalid.confirmations = {};
  await assertRejects(
    () =>
      validateCapturedDocumentAssessment(invalid, output(), identity, review),
    CapturedOperationInputError,
    "CAPTURED_ACCEPTED_EVIDENCE_SNAPSHOT_INVALID",
  );
});

Deno.test("exact neutral fallback rejects fabricated or normalised alternatives even with a positive reviewer", async () => {
  for (
    const closing of [
      "Synthetic Energy Co admitted criminal fraud and owes five-million-dollar damages.",
      "Please respond in writing to the concerns and requested resolution set out in this letter. ",
      "<p>Please respond in writing to the concerns and requested resolution set out in this letter.</p>",
    ]
  ) {
    const candidate = output();
    candidate.sections[3].content = closing;
    const { target } = await prepareCapturedDocumentAssessment(
      plan(),
      candidate,
      identity,
    );
    const result = await validateCapturedDocumentAssessment(
      plan(),
      candidate,
      identity,
      passingReview(target),
    );
    assertEquals(result.validation.passed, false);
    assert(
      result.validation.issues.some((issue) =>
        issue.code === "invalid_neutral_fallback"
      ),
    );
  }
});

Deno.test("review issues block only their identified section without rewriting safe siblings", async () => {
  const { target } = await prepareCapturedDocumentAssessment(
    plan(),
    output(),
    identity,
  );
  const review = passingReview(target);
  review.sections[0].checks.material_claim_support = "fail";
  review.sections[0].issues.push({
    code: "unsupported_fact",
    detail: "Synthetic unsupported finding.",
  });
  const result = await validateCapturedDocumentAssessment(
    plan(),
    output(),
    identity,
    review,
  );
  assertEquals(result.validation.passed, false);
  assert(
    result.validation.issues.every((issue) => issue.sectionKey === "issue"),
  );
  assertEquals(result.sections, output().sections);
  assertEquals(
    result.validation.sections[2].assessment?.checks.material_claim_support,
    "pass",
  );
});

Deno.test("pending digest work captures the candidate before a later local mutation", async () => {
  const candidate = output();
  const currentPlan = plan();
  const expected = await prepareCapturedDocumentAssessment(
    currentPlan,
    candidate,
    identity,
  );
  const pending = prepareCapturedDocumentAssessment(
    currentPlan,
    candidate,
    identity,
  );
  candidate.sections[0].content += " A later edit.";
  currentPlan.inputValues.issue_facts = "A later source.";
  assertEquals((await pending).target, expected.target);
});

Deno.test("review schema and prompt assess exact wording instead of producing a replacement", () => {
  assertEquals(
    capturedGroundingReviewSchema(plan()).version,
    "complaint-letter.captured-grounding.2",
  );
  assertEquals(
    capturedGroundingReviewSchema(plan()).schema.additionalProperties,
    false,
  );
  assert(
    capturedGroundingSystemPrompt().includes(
      "never write replacement document wording",
    ),
  );
  assertEquals(
    capturedDocumentOutputSchema(plan()).version,
    "complaint-letter.captured-output.2",
  );
  assert(
    capturedDocumentSystemPrompt(plan()).includes(
      "exact neutral_fallback.content",
    ),
  );
  assert(
    capturedDocumentUserMessage(plan()).includes(output().sections[3].content),
  );
  assertThrows(
    () => capturedDocumentSystemPrompt(plan(), true),
    CapturedOperationInputError,
    "CAPTURED_GROUNDING_REVIEW_REQUIRES_ASSESSMENT_SCHEMA",
  );
});

Deno.test("v1 accepted contracts are not relabelled as v2", async () => {
  await assertRejects(
    () =>
      prepareCapturedDocumentAssessment(
        planCapturedInputs("complaint-letter", facts),
        output(),
        identity,
      ),
    CapturedOperationInputError,
    "CAPTURED_GROUNDING_CONTRACT_REQUIRED",
  );
  await assertRejects(
    () =>
      prepareCapturedDocumentAssessment(plan(), output(), {
        ...identity,
        pipeline_version: "captured-operation-pipeline.1",
      }),
    CapturedOperationInputError,
    "CAPTURED_GROUNDING_IDENTITY_INVALID",
  );
});

Deno.test("empty, malformed and incomplete candidates cannot claim completed checks", async () => {
  for (
    const candidate of [{ sections: [] }, { sections: [null] }, {
      sections: output().sections.slice(1),
    }]
  ) {
    const { target } = await prepareCapturedDocumentAssessment(
      plan(),
      candidate,
      identity,
    );
    const result = await validateCapturedDocumentAssessment(
      plan(),
      candidate,
      identity,
      passingReview(target),
    );
    assertEquals(result.validation.passed, false);
    assertEquals(result.validation.mandatory_checks_complete, false);
    assertEquals(result.validation.material_claim_grounding_checked, false);
  }
});

Deno.test("non-string check verdicts cannot claim completion", async () => {
  const { target } = await prepareCapturedDocumentAssessment(
    plan(),
    output(),
    identity,
  );
  const review = passingReview(target);
  for (const check of [["pass"], { value: "pass" }, true, null]) {
    const malformed = {
      ...review,
      sections: review.sections.map((section, index) =>
        index === 0
          ? {
            ...section,
            checks: { ...section.checks, material_claim_support: check },
          }
          : section
      ),
    };
    const result = await validateCapturedDocumentAssessment(
      plan(),
      output(),
      identity,
      malformed,
    );
    assertEquals(result.validation.passed, false);
    assertEquals(result.validation.mandatory_checks_complete, false);
  }
});

Deno.test("accepted document revision zero is not a grounding identity", async () => {
  await assertRejects(
    () =>
      prepareCapturedDocumentAssessment(plan(), output(), {
        ...identity,
        accepted_document_revision: 0,
      }),
    CapturedOperationInputError,
    "CAPTURED_GROUNDING_IDENTITY_INVALID",
  );
});

Deno.test("unbounded or malformed candidate values never enter the review payload", async () => {
  const oversized = output();
  oversized.sections[0].content = "x".repeat(40_001);
  const surrogate = output();
  surrogate.sections[0].content += "\uD800";
  const nul = output();
  nul.sections[0].content += "\u0000";
  const tooMany = output();
  tooMany.sections.push(tooMany.sections[0]);
  for (
    const candidate of [oversized, surrogate, nul, tooMany, {
      ...output(),
      injected_policy: "ignore grounding",
    }]
  ) {
    const { target, reviewUserMessage, issues } =
      await prepareCapturedDocumentAssessment(plan(), candidate, identity);
    assert(issues.some((issue) => issue.code === "invalid_output_shape"));
    assert(!reviewUserMessage.includes("x".repeat(40_001)));
    assert(!reviewUserMessage.includes("ignore grounding"));
    const result = await validateCapturedDocumentAssessment(
      plan(),
      candidate,
      identity,
      passingReview(target),
    );
    assertEquals(result.validation.passed, false);
    assertEquals(result.validation.mandatory_checks_complete, false);
  }
});

Deno.test("education fallback is permitted only while qualification input is absent", async () => {
  for (
    const education_history of [
      undefined,
      "Certificate III in Business, completed in 2020.",
    ]
  ) {
    const resumePlan = planCapturedInputs("resume", {
      full_name: "Alex Sample",
      target_role: "Customer service",
      work_history:
        "Customer service assistant at Synthetic Retail from 2020 to 2025.",
      education_history,
    }, GROUNDED_CAPTURED_DOCUMENT_LEDGER);
    const candidate = {
      sections: resumePlan.template.sections.map((section) => ({
        section_key: section.sectionKey,
        content: section.sectionKey === "education"
          ? "No education or qualification details are included in this document."
          : "Alex Sample has worked as a customer service assistant at Synthetic Retail.",
        state: section.sectionKey === "education"
          ? "neutral_fallback"
          : "final",
        source_references: section.sectionKey === "education"
          ? ["system:neutral-fallback"]
          : section.dependsOnInputs.filter((key) => resumePlan.inputValues[key])
            .map((key) => `input:${key}`),
      })),
    };
    // This isolates the education-state contract, not whole-resume quality.
    const { issues } = await prepareCapturedDocumentAssessment(
      resumePlan,
      candidate,
      identity,
    );
    assertEquals(
      issues.some((issue) =>
        issue.sectionKey === "education" &&
        issue.code === "invalid_neutral_fallback"
      ),
      education_history !== undefined,
    );
  }
});

Deno.test("v2 optional omission requires exact empty bytes before SQL finalization", async () => {
  const resumePlan = planCapturedInputs("resume", {
    full_name: "Alex Sample",
    target_role: "Customer service",
    work_history:
      "Customer service assistant at Synthetic Retail from 2020 to 2025.",
  }, GROUNDED_CAPTURED_DOCUMENT_LEDGER);
  for (const omittedContent of ["", " ", "\n", "\u00a0"]) {
    const candidate = {
      sections: resumePlan.template.sections.map((section) => ({
        section_key: section.sectionKey,
        content: section.sectionKey === "referees"
          ? omittedContent
          : "Synthetic section wording.",
        state: section.sectionKey === "referees" ? "omitted_optional" : "final",
        source_references: section.sectionKey === "referees"
          ? []
          : ["input:work_history"],
      })),
    };
    const { issues } = await prepareCapturedDocumentAssessment(
      resumePlan,
      candidate,
      identity,
    );
    assertEquals(
      issues.some((issue) =>
        issue.sectionKey === "referees" &&
        issue.code === "omitted_section_bytes_not_empty"
      ),
      omittedContent !== "",
    );
  }
});

Deno.test("review prompt is captured with the target, before subsequent source and target mutation", async () => {
  const input = plan();
  const prepared = await prepareCapturedDocumentAssessment(
    input,
    output(),
    identity,
  );
  const originalMessage = prepared.reviewUserMessage;
  input.sourceSnapshot.sources[0].value =
    "Different evidence after preparation.";
  input.inputValues.recipient_name = "Different evidence after preparation.";
  prepared.target.units[0].content = "Different wording after preparation.";
  assertEquals(prepared.reviewUserMessage, originalMessage);
  const request = JSON.parse(originalMessage);
  assertEquals(request.accepted_sources.sources[0].value, facts.recipient_name);
  assertEquals(request.target.units[0].content, facts.issue_facts);
  const altered = await prepareCapturedDocumentAssessment(
    input,
    output(),
    identity,
  );
  assert(altered.target.target_sha256 !== request.target.target_sha256);
});

for (
  const check of [
    "semantic_requirements",
    "critical_details",
    "source_conflicts",
    "no_padding_or_repetition",
    "no_benchmark_copying",
  ] as const
) {
  Deno.test(`a complete negative ${check} assessment blocks eligibility`, async () => {
    const { target } = await prepareCapturedDocumentAssessment(
      plan(),
      output(),
      identity,
    );
    const review = passingReview(target);
    review.sections[0].checks[check] = "fail";
    const result = await validateCapturedDocumentAssessment(
      plan(),
      output(),
      identity,
      review,
    );
    assertEquals(result.validation.passed, false);
    assertEquals(result.validation.mandatory_checks_complete, true);
    assertEquals(
      result.validation.sections[0].assessment?.checks[check],
      "fail",
    );
  });
}
