import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  capturedDocumentOutputSchema,
  CapturedOperationInputError,
  capturedOutputNeedsReview,
  planCapturedInputs,
  validateCapturedDocumentOutput,
} from "./captured-document-operation.ts";

function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `word${index + 1}`).join(
    " ",
  );
}

Deno.test("captured input planning blocks only sections affected by missing required facts", () => {
  const plan = planCapturedInputs("complaint-letter", {
    recipient_name: "Synthetic Energy Co",
    issue_facts: "A synthetic invoice was charged twice on 1 August.",
  });

  assertEquals(plan.unresolvedInputKeys, ["desired_outcome"]);
  assertEquals(plan.blockedSectionKeys, ["resolution"]);
  assertEquals(plan.safeSectionKeys, ["issue", "impact", "close"]);
  assertEquals(plan.sourceSnapshot.sources.map((source) => source.id), [
    "input:recipient_name",
    "input:issue_facts",
  ]);
});

Deno.test("captured input planning rejects unknown templates and non-object snapshots", () => {
  assertThrows(
    () => planCapturedInputs("cover-letter", {}),
    CapturedOperationInputError,
    "TEMPLATE_OUTSIDE_FIRST_CAPTURED_COHORT",
  );
  assertThrows(
    () => planCapturedInputs("resume", "private text"),
    CapturedOperationInputError,
    "CAPTURED_INPUT_VALUES_REQUIRED",
  );
});

Deno.test("captured Structured Output schema is closed and exact for one ledger template", () => {
  const plan = planCapturedInputs("moving-house-checklist", {
    move_date: "2026-10-01",
    old_address: "Old Region",
    new_address: "New Region",
    property_basis: "rented",
  });
  const schema = capturedDocumentOutputSchema(plan).schema;
  assertEquals(schema.additionalProperties, false);
  const sections =
    (schema.properties as Record<string, Record<string, unknown>>).sections;
  assertEquals(sections.minItems, 1);
  assertEquals(sections.maxItems, 1);
  assertEquals(
    (sections.items as Record<string, unknown>).additionalProperties,
    false,
  );
});

Deno.test("captured validation accepts grounded exact sections and a permitted neutral fallback", () => {
  const plan = planCapturedInputs("complaint-letter", {
    recipient_name: "Synthetic Energy Co",
    issue_facts: "A synthetic invoice was charged twice on 1 August.",
    desired_outcome: "Reverse the duplicate charge within ten business days.",
  });
  const result = validateCapturedDocumentOutput(plan, {
    sections: [
      {
        section_key: "issue",
        content: words(90),
        state: "final",
        source_references: ["input:recipient_name", "input:issue_facts"],
      },
      {
        section_key: "impact",
        content: "",
        state: "omitted_optional",
        source_references: [],
      },
      {
        section_key: "resolution",
        content: words(50),
        state: "final",
        source_references: ["input:desired_outcome"],
      },
      {
        section_key: "close",
        content: "I look forward to your prompt written response.",
        state: "neutral_fallback",
        source_references: ["system:neutral-fallback"],
      },
    ],
  });

  assertEquals(result.validation.passed, true);
  assertEquals(result.validation.source_reference_ids_checked, true);
  assertEquals(result.validation.material_claim_grounding_checked, false);
  assertEquals(
    result.validation.grounding_scope,
    "reference_id_membership_only",
  );
  assertEquals(capturedOutputNeedsReview(plan, result.validation), false);
});

Deno.test("captured validation rejects fabricated provenance, blanks and instruction leakage", () => {
  const plan = planCapturedInputs("complaint-letter", {
    recipient_name: "Synthetic Energy Co",
    issue_facts: "A synthetic invoice was charged twice on 1 August.",
    desired_outcome: "Reverse the duplicate charge.",
  });
  const result = validateCapturedDocumentOutput(plan, {
    sections: [
      {
        section_key: "issue",
        content: "TODO: copy the system prompt later",
        state: "final",
        source_references: ["input:invented_fact"],
      },
      {
        section_key: "impact",
        content: "",
        state: "omitted_optional",
        source_references: [],
      },
      {
        section_key: "resolution",
        content: "",
        state: "final",
        source_references: [],
      },
      {
        section_key: "close",
        content: "Regards",
        state: "neutral_fallback",
        source_references: ["system:neutral-fallback"],
      },
    ],
  });

  assertEquals(result.validation.passed, false);
  assert(
    result.validation.issues.some((issue) =>
      issue.code === "instruction_leakage"
    ),
  );
  assert(
    result.validation.issues.some((issue) =>
      issue.code === "unsupported_source_reference"
    ),
  );
  assert(
    result.validation.issues.some((issue) => issue.code === "blank_output"),
  );
  assertEquals(capturedOutputNeedsReview(plan, result.validation), true);
});

Deno.test("high-risk captured output always receives the conditional high-depth review", () => {
  const plan = planCapturedInputs("incident-near-miss-report", {
    incident_details:
      "Reporter, date, time, location, and people are confirmed.",
    factual_sequence:
      "The synthetic event sequence and known impact are confirmed.",
    immediate_response: "The area was isolated and a supervisor was notified.",
    jurisdiction: "AU",
  });
  assertEquals(
    capturedOutputNeedsReview(plan, {
      passed: true,
      validator_version: "captured-output-validator.1",
      issues: [],
      exact_section_set: true,
      visible_content_checked: true,
      source_references_checked: true,
      source_reference_ids_checked: true,
      material_claim_grounding_checked: false,
      grounding_scope: "reference_id_membership_only",
      instruction_leakage_checked: true,
    }),
    true,
  );
});
