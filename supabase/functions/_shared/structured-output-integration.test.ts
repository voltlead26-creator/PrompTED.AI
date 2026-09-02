// deno-lint-ignore no-import-prefix -- repository Edge tests pin the JSR assertion API.
import { assert, assertStringIncludes } from "jsr:@std/assert@1";

interface StageExpectation {
  path: string;
  stage: string;
  schema: string;
}

const EXPECTATIONS: StageExpectation[] = [
  {
    path: "../interpret-intent/index.ts",
    stage: "interpret-intent.primary",
    schema: "INTENT_OUTPUT_SCHEMA",
  },
  {
    path: "../interpret-intent/index.ts",
    stage: "interpret-intent.repair",
    schema: "INTENT_OUTPUT_SCHEMA",
  },
  {
    path: "../clarify/index.ts",
    stage: "clarify.primary",
    schema: "CLARIFY_OUTPUT_SCHEMA",
  },
  {
    path: "../clarify/index.ts",
    stage: "clarify.repair",
    schema: "CLARIFY_OUTPUT_SCHEMA",
  },
  {
    path: "../clarify/index.ts",
    stage: "clarify.forced-commit",
    schema: "CLARIFY_OUTPUT_SCHEMA",
  },
  {
    path: "../recommend/index.ts",
    stage: "recommend.primary",
    schema: "RECOMMENDATION_OUTPUT_SCHEMA",
  },
  {
    path: "../recommend/index.ts",
    stage: "recommend.repair",
    schema: "RECOMMENDATION_OUTPUT_SCHEMA",
  },
  {
    path: "../generate-checklist/index.ts",
    stage: "generate-checklist.primary",
    schema: "CHECKLIST_OUTPUT_SCHEMA",
  },
  {
    path: "../generate-checklist/index.ts",
    stage: "generate-checklist.repair",
    schema: "CHECKLIST_OUTPUT_SCHEMA",
  },
  {
    path: "../explain-section/index.ts",
    stage: "explain-section.primary",
    schema: "EXPLAIN_OUTPUT_SCHEMA",
  },
  {
    path: "../proofread-document/index.ts",
    stage: "proofread-document.primary",
    schema: "proofreadOutputSchema(sectionKeys)",
  },
  {
    path: "../job-match/index.ts",
    stage: "job-match.primary",
    schema: "JOB_MATCH_OUTPUT_SCHEMA",
  },
  {
    path: "./section-designer.ts",
    stage: "generate-document.design",
    schema: "SECTION_DESIGN_OUTPUT_SCHEMA",
  },
  {
    path: "./ted-artifact-pipeline.ts",
    stage: "ted-artifact.requirements",
    schema: "ARTIFACT_REQUIREMENTS_OUTPUT_SCHEMA",
  },
  {
    path: "./ted-artifact-pipeline.ts",
    stage: "ted-artifact.draft",
    schema: "ARTIFACT_DRAFT_OUTPUT_SCHEMA",
  },
  {
    path: "./ted-artifact-pipeline.ts",
    stage: "ted-artifact.audit",
    schema: "artifactAuditOutputSchema(blockKeys)",
  },
];

function callWindow(source: string, stage: string): string {
  const marker = `"${stage}"`;
  const markerIndex = source.indexOf(marker);
  assert(markerIndex >= 0, `Missing model stage ${stage}`);
  return source.slice(markerIndex, markerIndex + 1_200);
}

Deno.test("every active machine-consumed model stage supplies a versioned Structured Output schema", async () => {
  for (const expectation of EXPECTATIONS) {
    const source = await Deno.readTextFile(
      new URL(expectation.path, import.meta.url),
    );
    assertStringIncludes(
      callWindow(source, expectation.stage),
      `outputSchema: ${expectation.schema}`,
      `${expectation.stage} must use ${expectation.schema}`,
    );
  }
});

Deno.test("durable machine-consumed results use structured values and deterministic validation", async () => {
  const checklist = await Deno.readTextFile(
    new URL("../generate-checklist/index.ts", import.meta.url),
  );
  assertStringIncludes(
    checklist,
    "validateChecklistOutput(result.structured)",
  );

  const artifact = await Deno.readTextFile(
    new URL("./ted-artifact-pipeline.ts", import.meta.url),
  );
  for (
    const validator of [
      "validateArtifactRequirementsOutput(",
      "validateArtifactDraftOutput(",
      "validateArtifactAuditOutput(",
    ]
  ) {
    assertStringIncludes(artifact, validator);
  }
  assert(
    !checklist.includes("parseModelJson("),
    "checklist persistence must not recover permissive JSON from provider text",
  );
  assert(
    !artifact.includes("parseModelJson("),
    "artifact persistence must not recover permissive JSON from provider text",
  );
});
