// deno-lint-ignore no-import-prefix -- use the repository's pinned assertions.
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  OpenAIOutputSchemaError,
  prepareOpenAIOutputSchema,
} from "./openai-output-schema.ts";
import {
  ARTIFACT_DRAFT_OUTPUT_SCHEMA,
  ARTIFACT_REQUIREMENTS_OUTPUT_SCHEMA,
  artifactAuditOutputSchema,
  CHECKLIST_OUTPUT_SCHEMA,
  CLARIFY_OUTPUT_SCHEMA,
  EXPLAIN_OUTPUT_SCHEMA,
  INTENT_OUTPUT_SCHEMA,
  JOB_MATCH_OUTPUT_SCHEMA,
  proofreadOutputSchema,
  RECOMMENDATION_OUTPUT_SCHEMA,
  SECTION_DESIGN_OUTPUT_SCHEMA,
} from "./model-output-contracts.ts";
import {
  EDIT_SECTION_OUTPUT_SCHEMA,
  groundingAuditOutputSchema,
  intentBriefOutputSchema,
  qualityAuditOutputSchema,
  sectionPlanOutputSchema,
} from "./document-output-contracts.ts";
import { RESEARCH_OUTPUT_SCHEMA } from "./research-grounding.ts";

const uniqueStrings = {
  type: "array",
  uniqueItems: true,
  items: { type: "string" },
};

Deno.test("all active output contracts project without changing their canonical constraints", () => {
  const contracts = [
    ARTIFACT_DRAFT_OUTPUT_SCHEMA,
    ARTIFACT_REQUIREMENTS_OUTPUT_SCHEMA,
    artifactAuditOutputSchema(["summary"]),
    CHECKLIST_OUTPUT_SCHEMA,
    CLARIFY_OUTPUT_SCHEMA,
    EXPLAIN_OUTPUT_SCHEMA,
    INTENT_OUTPUT_SCHEMA,
    JOB_MATCH_OUTPUT_SCHEMA,
    proofreadOutputSchema(["summary"]),
    RECOMMENDATION_OUTPUT_SCHEMA,
    SECTION_DESIGN_OUTPUT_SCHEMA,
    EDIT_SECTION_OUTPUT_SCHEMA,
    groundingAuditOutputSchema(["summary:0"]),
    intentBriefOutputSchema(["summary"]),
    qualityAuditOutputSchema(["summary"]),
    sectionPlanOutputSchema(["summary"]),
    RESEARCH_OUTPUT_SCHEMA,
  ];
  for (const contract of contracts) {
    const original = structuredClone(contract);
    const prepared = prepareOpenAIOutputSchema(contract.schema);
    assert(
      !JSON.stringify(prepared.schema).includes('"uniqueItems":'),
      contract.name,
    );
    assertEquals(contract, original);
    assertEquals(prepared.schema.additionalProperties, false);
    assertEquals(prepared.schema.required, contract.schema.required);
  }
});

Deno.test("uniqueness is enforced inside nested nullable objects and array items", () => {
  const source = {
    type: "object",
    properties: {
      groups: {
        type: "array",
        items: {
          anyOf: [{
            type: "object",
            additionalProperties: false,
            required: ["names"],
            properties: { names: uniqueStrings },
          }, { type: "null" }],
        },
      },
    },
  };
  const { acceptsUniqueItems } = prepareOpenAIOutputSchema(source);
  assert(acceptsUniqueItems({ groups: [null, { names: ["one", "two"] }] }));
  assertEquals(
    acceptsUniqueItems({ groups: [null, { names: ["one", "one"] }] }),
    false,
  );
  // Distinct whitespace strings are not silently trimmed or deduplicated.
  assert(acceptsUniqueItems({ groups: [{ names: ["one", " one"] }] }));
});

Deno.test("unique object values compare independently of property insertion order", () => {
  const prepared = prepareOpenAIOutputSchema({
    type: "array",
    uniqueItems: true,
    items: { type: "object" },
  });
  assertEquals(
    prepared.acceptsUniqueItems([{ a: 1, b: 2 }, { b: 2, a: 1 }]),
    false,
  );
  assert(prepared.acceptsUniqueItems([{ a: 1 }, { a: 2 }]));
});

Deno.test("closed payload unions enforce the selected branch without borrowing another branch", () => {
  const { acceptsUniqueItems } = prepareOpenAIOutputSchema({
    anyOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["names"],
        properties: { names: uniqueStrings },
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: { text: { type: "string" } },
      },
    ],
  });
  assert(acceptsUniqueItems({ text: "Valid text payload" }));
  assert(acceptsUniqueItems({ names: ["A", "B"] }));
  assertEquals(acceptsUniqueItems({ names: ["A", "A"] }), false);
  assertEquals(acceptsUniqueItems({ names: ["A"], text: "ambiguous" }), false);
});

Deno.test("projection preserves a property named uniqueItems and all other keyword constraints", () => {
  const source = {
    type: "object",
    additionalProperties: false,
    required: ["uniqueItems"],
    properties: {
      uniqueItems: {
        ...uniqueStrings,
        minItems: 1,
        maxItems: 3,
        description: "Unique labels",
      },
    },
  };
  const prepared = prepareOpenAIOutputSchema(source);
  assertEquals(prepared.schema, {
    ...source,
    properties: {
      uniqueItems: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 3,
        description: "Unique labels",
      },
    },
  });
  assertEquals(
    prepared.acceptsUniqueItems({ uniqueItems: ["same", "same"] }),
    false,
  );
  assert(
    prepareOpenAIOutputSchema({ type: "array", uniqueItems: false })
      .acceptsUniqueItems([1, 1]),
  );
});

Deno.test("ambiguous union and reference uniqueness cannot silently lose their local checks", () => {
  assertThrows(
    () =>
      prepareOpenAIOutputSchema({ anyOf: [uniqueStrings, { type: "array" }] }),
    OpenAIOutputSchemaError,
  );
  assertThrows(
    () =>
      prepareOpenAIOutputSchema({
        type: "object",
        properties: { list: { $ref: "#/$defs/list" } },
        $defs: { list: uniqueStrings },
      }),
    OpenAIOutputSchemaError,
  );
});
