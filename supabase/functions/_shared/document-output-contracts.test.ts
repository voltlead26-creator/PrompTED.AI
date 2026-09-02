// deno-lint-ignore no-import-prefix -- repository Edge tests pin the JSR assertion API.
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  EDIT_SECTION_OUTPUT_SCHEMA,
  groundingAuditOutputSchema,
  intentBriefOutputSchema,
  qualityAuditOutputSchema,
  sectionPlanOutputSchema,
  validateEditSectionOutput,
  validateGroundingAuditOutput,
  validateIntentBriefOutput,
  validateQualityAuditOutput,
  validateSectionPlanOutput,
} from "./document-output-contracts.ts";

function assertClosedSchemaNode(value: unknown, path = "root"): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const node = value as Record<string, unknown>;
  if (node.type === "object") {
    assertEquals(
      node.additionalProperties,
      false,
      `${path} must reject extra keys`,
    );
    const properties = node.properties as Record<string, unknown>;
    assert(properties && typeof properties === "object", `${path} properties`);
    assertEquals(
      [...((node.required as string[]) ?? [])].sort(),
      Object.keys(properties).sort(),
      `${path} must require every declared key`,
    );
    for (const [key, child] of Object.entries(properties)) {
      assertClosedSchemaNode(child, `${path}.${key}`);
    }
  }
  if (node.type === "array") {
    assertClosedSchemaNode(node.items, `${path}[]`);
  }
  for (const keyword of ["anyOf", "oneOf", "allOf"]) {
    const branches = node[keyword];
    if (Array.isArray(branches)) {
      branches.forEach((branch, index) =>
        assertClosedSchemaNode(branch, `${path}.${keyword}[${index}]`)
      );
    }
  }
}

function intentFixture() {
  return {
    user_goal: "Prepare a complete application.",
    primary_outcome: "A send-ready document.",
    audience: "The hiring panel.",
    author_perspective: "First person.",
    tone: ["clear", "professional"],
    required_content: ["Evidence"],
    prohibited_content: ["Invented claims"],
    known_facts: ["The user supplied one example."],
    safe_assumptions: ["Use Australian English."],
    missing_critical_information: ["Recipient name"],
    section_readiness: [{
      key: "summary",
      ready: false,
      missing_information: ["Recipient name"],
      missing_information_keys: ["recipient_name"],
    }, {
      key: "evidence",
      ready: true,
      missing_information: [],
      missing_information_keys: [],
    }],
    confidence: 0.8,
  };
}

Deno.test("all document output schemas are versioned, recursively closed, and require every key", () => {
  const schemas = [
    intentBriefOutputSchema(["summary", "evidence"]),
    sectionPlanOutputSchema(["summary", "evidence"]),
    qualityAuditOutputSchema(["summary", "evidence"]),
    groundingAuditOutputSchema(["summary:0", "evidence:0"]),
    EDIT_SECTION_OUTPUT_SCHEMA,
  ];
  assertEquals(
    schemas.map((schema) => schema.version),
    [
      "document-intent-brief.1",
      "document-section-plan.1",
      "document-quality-audit.1",
      "document-grounding-audit.1",
      "legacy-section-edit-output.1",
    ],
  );
  for (const output of schemas) assertClosedSchemaNode(output.schema);
  assertThrows(
    () => intentBriefOutputSchema([" summary"]),
    Error,
    "DOCUMENT_INTENT_SCHEMA_INPUT_INVALID",
  );
});

Deno.test("intent validation accepts one exact ordered readiness entry per section", () => {
  const parsed = validateIntentBriefOutput(
    intentFixture(),
    ["summary", "evidence"],
    { summary: ["recipient_name"], evidence: [] },
  );
  assertEquals(parsed.section_readiness.map((item) => item.key), [
    "summary",
    "evidence",
  ]);

  assertThrows(
    () =>
      validateIntentBriefOutput(
        { ...intentFixture(), unexpected: true },
        ["summary", "evidence"],
        { summary: ["recipient_name"], evidence: [] },
      ),
    Error,
    "DOCUMENT_INTENT_OUTPUT_INVALID",
  );
  assertThrows(
    () =>
      validateIntentBriefOutput(
        {
          ...intentFixture(),
          section_readiness: [
            intentFixture().section_readiness[1],
            intentFixture().section_readiness[0],
          ],
        },
        ["summary", "evidence"],
        { summary: ["recipient_name"], evidence: [] },
      ),
    Error,
    "DOCUMENT_INTENT_OUTPUT_INVALID",
  );
  assertThrows(
    () =>
      validateIntentBriefOutput(
        {
          ...intentFixture(),
          section_readiness: [{
            ...intentFixture().section_readiness[0],
            missing_information_keys: ["invented_key"],
          }, intentFixture().section_readiness[1]],
        },
        ["summary", "evidence"],
        { summary: ["recipient_name"], evidence: [] },
      ),
    Error,
    "DOCUMENT_INTENT_OUTPUT_INVALID",
  );
  assertThrows(
    () =>
      validateIntentBriefOutput(
        {
          ...intentFixture(),
          section_readiness: [intentFixture().section_readiness[0], {
            ...intentFixture().section_readiness[1],
            missing_information: ["Should be empty while ready"],
          }],
        },
        ["summary", "evidence"],
        { summary: ["recipient_name"], evidence: [] },
      ),
    Error,
    "DOCUMENT_INTENT_OUTPUT_INVALID",
  );
  assertThrows(
    () =>
      validateIntentBriefOutput(
        {
          ...intentFixture(),
          section_readiness: [{
            ...intentFixture().section_readiness[0],
            key: " summary",
          }, intentFixture().section_readiness[1]],
        },
        ["summary", "evidence"],
        { summary: ["recipient_name"], evidence: [] },
      ),
    Error,
    "DOCUMENT_INTENT_OUTPUT_INVALID",
  );
  assertThrows(
    () =>
      validateIntentBriefOutput(
        { ...intentFixture(), confidence: 1.1 },
        ["summary", "evidence"],
        { summary: ["recipient_name"], evidence: [] },
      ),
    Error,
    "DOCUMENT_INTENT_OUTPUT_INVALID",
  );
});

Deno.test("planner validation rejects partial, duplicate, out-of-order, and extra-key output", () => {
  const valid = {
    section_context: [{
      key: "summary",
      relevant_content: "Source-backed summary facts.",
      display_label: "Professional Summary",
    }, {
      key: "evidence",
      relevant_content: "",
      display_label: "Evidence",
    }],
  };
  assertEquals(
    validateSectionPlanOutput(valid, ["summary", "evidence"]),
    valid,
  );
  for (
    const invalid of [
      { section_context: valid.section_context.slice(0, 1) },
      { section_context: [valid.section_context[0], valid.section_context[0]] },
      { section_context: [...valid.section_context].reverse() },
      {
        section_context: [
          { ...valid.section_context[0], extra: true },
          valid.section_context[1],
        ],
      },
    ]
  ) {
    assertThrows(
      () => validateSectionPlanOutput(invalid, ["summary", "evidence"]),
      Error,
      "DOCUMENT_PLAN_OUTPUT_INVALID",
    );
  }
});

Deno.test("quality validation enforces decision consistency and known section keys", () => {
  const issue = {
    severity: "high",
    category: "tone",
    section_key: "summary",
    finding: "Tone is too abrupt.",
    required_correction: "Use calm wording.",
  };
  const parsed = validateQualityAuditOutput(
    { decision: "changes_required", issues: [issue] },
    ["summary"],
  );
  // Existing product policy keeps editorial findings advisory.
  assertEquals(parsed.issues[0]?.severity, "low");
  assertThrows(
    () =>
      validateQualityAuditOutput(
        { decision: "approve", issues: [issue] },
        ["summary"],
      ),
    Error,
    "DOCUMENT_QUALITY_OUTPUT_INVALID",
  );
  assertThrows(
    () =>
      validateQualityAuditOutput(
        {
          decision: "changes_required",
          issues: [{ ...issue, section_key: "wrong" }],
        },
        ["summary"],
      ),
    Error,
    "DOCUMENT_QUALITY_OUTPUT_INVALID",
  );
  assertThrows(
    () =>
      validateQualityAuditOutput(
        { decision: "changes_required", issues: [{ ...issue, extra: true }] },
        ["summary"],
      ),
    Error,
    "DOCUMENT_QUALITY_OUTPUT_INVALID",
  );
});

Deno.test("grounding validation requires one semantically complete entry per audit unit", () => {
  const valid = {
    units: [{
      unit_id: "summary:0",
      classification: "supported" as const,
      evidence_quotes: ["Exact source words"],
      unsupported_fragments: [],
    }, {
      unit_id: "evidence:0",
      classification: "guidance" as const,
      evidence_quotes: [],
      unsupported_fragments: [],
    }],
  };
  assertEquals(
    validateGroundingAuditOutput(valid, ["summary:0", "evidence:0"]),
    valid,
  );
  for (
    const invalid of [
      { units: valid.units.slice(0, 1) },
      { units: [valid.units[0], valid.units[0]] },
      {
        units: [{ ...valid.units[0], evidence_quotes: [] }, valid.units[1]],
      },
      {
        units: [{
          ...valid.units[0],
          classification: "unsupported",
          evidence_quotes: [],
          unsupported_fragments: [],
        }, valid.units[1]],
      },
      { units: [{ ...valid.units[0], extra: true }, valid.units[1]] },
    ]
  ) {
    assertThrows(
      () => validateGroundingAuditOutput(invalid, ["summary:0", "evidence:0"]),
      Error,
      "DOCUMENT_GROUNDING_OUTPUT_INVALID",
    );
  }
});

Deno.test("durable edit validation rejects malformed, partial, blank, duplicate, and extra-key output", () => {
  assertEquals(
    validateEditSectionOutput({
      content: "Clear revised wording.",
      changes: ["Made the wording clearer."],
    }),
    {
      content: "Clear revised wording.",
      changes: ["Made the wording clearer."],
    },
  );
  for (
    const invalid of [
      null,
      { content: "Clear revised wording." },
      { content: "   ", changes: [] },
      { content: "Clear", changes: ["same", "same"] },
      { content: "Clear", changes: [], explanation: "extra" },
    ]
  ) {
    assertThrows(
      () => validateEditSectionOutput(invalid),
      Error,
      "EDIT_SECTION_OUTPUT_INVALID",
    );
  }
});
