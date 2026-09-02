// deno-lint-ignore no-import-prefix -- repository Edge tests pin the JSR assertion API.
import { assert, assertEquals } from "jsr:@std/assert@1";

Deno.test("document pipeline assigns a unique stable checkpoint stage to every provider phase", async () => {
  const source = await Deno.readTextFile(
    new URL("./document-pipeline.ts", import.meta.url),
  );
  const compactSource = source.replace(/\s+/g, "");
  for (
    const stage of [
      'logicalStageKey: "generate-document.intent"',
      'logicalStageKey: "generate-document.plan"',
      "generate-document.section:${stageSegment(section.key)}:${phase}",
      "generate-document.quality:round-${round}",
      "generate-document.grounding:round-${round}",
    ]
  ) {
    assert(
      compactSource.includes(stage.replace(/\s+/g, "")),
      `missing durable stage: ${stage}`,
    );
  }
  assert(source.includes("`repair-${repairRound + 1}`"));
  assert(source.includes('"final-repair"'));
  assertEquals(
    source.includes('logicalStageKey: "document-pipeline.section"'),
    false,
  );
});

Deno.test("every machine-consumed document stage uses a strict schema and semantic validator", async () => {
  const source = await Deno.readTextFile(
    new URL("./document-pipeline.ts", import.meta.url),
  );
  for (
    const seam of [
      "outputSchema: intentBriefOutputSchema(sectionKeys)",
      "validateIntentBriefOutput(",
      "outputSchema: sectionPlanOutputSchema(sectionKeys)",
      "validateSectionPlanOutput(result.structured, sectionKeys)",
      "outputSchema: qualityAuditOutputSchema(sectionKeys)",
      "validateQualityAuditOutput(result.structured, sectionKeys)",
      "outputSchema: groundingAuditOutputSchema(unitIds)",
      "validateGroundingAuditOutput(result.structured, unitIds)",
    ]
  ) assert(source.includes(seam), `missing strict output seam: ${seam}`);
  assertEquals(source.includes("requireJson: true"), false);
  assertEquals(source.includes("parsePipelineJson"), false);
});
