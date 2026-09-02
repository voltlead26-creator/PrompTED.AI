// deno-lint-ignore no-import-prefix -- repository Edge tests pin the JSR assertion API.
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
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
  validateArtifactAuditOutput,
  validateArtifactDraftOutput,
  validateChecklistOutput,
  validateProofreadOutput,
} from "./model-output-contracts.ts";

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
  if (node.type === "array") assertClosedSchemaNode(node.items, `${path}[]`);
  for (const keyword of ["anyOf", "oneOf", "allOf"]) {
    const branches = node[keyword];
    if (Array.isArray(branches)) {
      branches.forEach((branch, index) =>
        assertClosedSchemaNode(branch, `${path}.${keyword}[${index}]`)
      );
    }
  }
}

function actionDraft() {
  return {
    title: "Application plan",
    blocks: [{
      kind: "action",
      stable_key: "prepare_application",
      heading: "Prepare the application",
      payload: {
        title: "Prepare the application",
        objective: "Submit a complete application.",
        instructions: ["Review the confirmed role requirements."],
        required_inputs: ["The confirmed role description"],
        included_materials: [{
          label: "Opening sentence",
          content: "I am applying for the confirmed role.",
        }],
        dependencies: [],
        timing: {
          due_date: null,
          relative_timing: "Before the stated closing date",
          rationale: "This leaves time for review.",
        },
        completion_criteria: ["Every required field has been reviewed."],
        cautions: ["Do not add unsupported experience."],
      },
      due_date: null,
      references: [],
    }],
  };
}

Deno.test("active model output schemas are versioned, recursively closed, and require every object key", () => {
  const schemas = [
    INTENT_OUTPUT_SCHEMA,
    CLARIFY_OUTPUT_SCHEMA,
    RECOMMENDATION_OUTPUT_SCHEMA,
    CHECKLIST_OUTPUT_SCHEMA,
    EXPLAIN_OUTPUT_SCHEMA,
    proofreadOutputSchema(["summary"]),
    JOB_MATCH_OUTPUT_SCHEMA,
    SECTION_DESIGN_OUTPUT_SCHEMA,
    ARTIFACT_REQUIREMENTS_OUTPUT_SCHEMA,
    ARTIFACT_DRAFT_OUTPUT_SCHEMA,
    artifactAuditOutputSchema(["summary"]),
  ];
  for (const output of schemas) {
    assert(output.version, `${output.name} must declare a contract version`);
    assertClosedSchemaNode(output.schema);
  }
});

Deno.test("checklist validation reconstructs bounded exact items and rejects duplicate or extra model data", () => {
  const item = {
    section: "Preparation",
    text: "Collect the confirmed documents.",
    due_date: null,
    reason: "This prevents an incomplete submission.",
  };
  assertEquals(validateChecklistOutput({ items: [item] }), { items: [item] });
  assertThrows(
    () =>
      validateChecklistOutput({ items: [{ ...item, hidden: "retain me" }] }),
    Error,
    "CHECKLIST_OUTPUT_INVALID",
  );
  assertThrows(
    () => validateChecklistOutput({ items: [item, item] }),
    Error,
    "CHECKLIST_OUTPUT_INVALID",
  );
  assertThrows(
    () =>
      validateChecklistOutput({
        items: Array.from({ length: 81 }, () => item),
      }),
    Error,
    "CHECKLIST_OUTPUT_INVALID",
  );
});

Deno.test("artifact draft validation rejects payload/reference extensions, duplicate keys, and kind-shape conflicts", () => {
  const valid = actionDraft();
  assertEquals(
    validateArtifactDraftOutput(valid, true).blocks[0]?.stable_key,
    "prepare_application",
  );

  const extraPayload = structuredClone(valid);
  Object.assign(extraPayload.blocks[0]!.payload, {
    provider_trust_state: "passed",
  });
  assertThrows(
    () => validateArtifactDraftOutput(extraPayload, true),
    Error,
    "ARTIFACT_DRAFT_OUTPUT_INVALID",
  );

  const extraReference = {
    ...structuredClone(valid),
    blocks: [{
      ...structuredClone(valid.blocks[0]!),
      references: [{
        url: "https://example.test/guidance",
        hidden: "must not survive",
      }],
    }],
  };
  assertThrows(
    () => validateArtifactDraftOutput(extraReference, true),
    Error,
    "ARTIFACT_DRAFT_OUTPUT_INVALID",
  );

  const duplicate = structuredClone(valid);
  duplicate.blocks.push(structuredClone(duplicate.blocks[0]!));
  assertThrows(
    () => validateArtifactDraftOutput(duplicate, true),
    Error,
    "ARTIFACT_DRAFT_OUTPUT_INVALID",
  );

  assertThrows(
    () => validateArtifactDraftOutput(valid, false),
    Error,
    "ARTIFACT_DRAFT_OUTPUT_INVALID",
  );
});

Deno.test("artifact audit validation cannot approve known issues or unknown block keys", () => {
  assertEquals(
    validateArtifactAuditOutput({ passed: true, issues: [] }, ["summary"]),
    { passed: true, issues: [] },
  );
  assertThrows(
    () =>
      validateArtifactAuditOutput({
        passed: true,
        issues: [{ block_key: "summary", message: "Unsupported claim." }],
      }, ["summary"]),
    Error,
    "ARTIFACT_AUDIT_OUTPUT_INVALID",
  );
  assertThrows(
    () =>
      validateArtifactAuditOutput({
        passed: false,
        issues: [{ block_key: "invented", message: "Unknown target." }],
      }, ["summary"]),
    Error,
    "ARTIFACT_AUDIT_OUTPUT_INVALID",
  );
});

Deno.test("proofread validation accepts only known unique sections and exact review item fields", () => {
  const review = {
    sections: [{
      key: "summary",
      corrections: [{
        title: "Fix agreement",
        why: "The subject is singular.",
        original_snippet: "They is ready.",
        revised_snippet: "They are ready.",
      }],
      improvements: [],
    }],
  };
  assertEquals(validateProofreadOutput(review, ["summary"]), review);
  assertThrows(
    () =>
      validateProofreadOutput({
        sections: [{ ...review.sections[0], key: "another" }],
      }, ["summary"]),
    Error,
    "PROOFREAD_OUTPUT_INVALID",
  );
  assertThrows(
    () =>
      validateProofreadOutput({
        sections: [{
          ...review.sections[0],
          corrections: [{ ...review.sections[0].corrections[0], hidden: true }],
        }],
      }, ["summary"]),
    Error,
    "PROOFREAD_OUTPUT_INVALID",
  );
});
