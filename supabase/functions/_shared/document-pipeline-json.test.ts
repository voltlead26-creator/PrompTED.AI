import { parsePipelineJson } from "./document-pipeline-json.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("pipeline JSON accepts one valid object followed by model commentary", () => {
  const parsed = parsePipelineJson<{ decision: string }>(
    '{"decision":"approve"}\nThe review is complete.',
  );

  assert(parsed.decision === "approve", "did not recover the first JSON object");
});

Deno.test("pipeline JSON accepts fenced model output", () => {
  const parsed = parsePipelineJson<{ section_context: unknown[] }>(
    '```json\n{"section_context":[]}\n```',
  );

  assert(Array.isArray(parsed.section_context), "did not parse fenced JSON");
});

Deno.test("pipeline JSON rejects output without an object or array", () => {
  let threw = false;
  try {
    parsePipelineJson("The model did not return JSON.");
  } catch {
    threw = true;
  }

  assert(threw, "invalid model output must fail closed");
});

Deno.test("editorial audit findings remain advisory after repair attempts", () => {
  const parsed = parsePipelineJson<{
    decision: string;
    issues: Array<{ severity: string; category: string }>;
  }>(JSON.stringify({
    decision: "changes_required",
    issues: [
      { severity: "high", category: "tone" },
      { severity: "medium", category: "structure" },
      { severity: "high", category: "layout" },
      { severity: "medium", category: "completeness" },
    ],
  }));

  assert(
    parsed.issues.every((issue) => issue.severity === "low"),
    "editorial findings were left able to erase usable draft sections",
  );
});

Deno.test("safety audit findings retain blocking severity", () => {
  const parsed = parsePipelineJson<{
    decision: string;
    issues: Array<{ severity: string; category: string }>;
  }>(JSON.stringify({
    decision: "changes_required",
    issues: [
      { severity: "high", category: "fact" },
      { severity: "medium", category: "instruction_leakage" },
      { severity: "high", category: "blank_output" },
    ],
  }));

  assert(parsed.issues[0]?.severity === "high", "factual failure was downgraded");
  assert(
    parsed.issues[1]?.severity === "medium",
    "instruction leakage was downgraded",
  );
  assert(parsed.issues[2]?.severity === "high", "blank output was downgraded");
});

Deno.test("non-audit JSON is not modified", () => {
  const parsed = parsePipelineJson<{
    section_context: Array<{ category: string; severity: string }>;
  }>(JSON.stringify({
    section_context: [{ category: "tone", severity: "high" }],
  }));

  assert(
    parsed.section_context[0]?.severity === "high",
    "ordinary pipeline JSON was unexpectedly normalised",
  );
});
