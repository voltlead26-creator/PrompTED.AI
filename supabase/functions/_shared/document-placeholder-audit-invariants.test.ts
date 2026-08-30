import { assert, assertStringIncludes } from "jsr:@std/assert";
import { buildSystemPrompt } from "./prompt-builder.ts";
import { UNIVERSAL_DOCUMENT_PLACEHOLDER_RULES } from "./document-placeholder-policy.ts";

Deno.test("document prompt uses the canonical structured-placeholder doctrine", () => {
  const prompt = buildSystemPrompt({
    task: "document",
    domain: "employment",
    profileHint: "resume",
    extra: "",
  });
  assert(!prompt.includes("Never use bracketed placeholders"));
  assert(
    !prompt.includes(
      "If a non-critical detail is unavailable, proceed with complete neutral wording that does not expose the gap.",
    ),
  );
  for (const rule of UNIVERSAL_DOCUMENT_PLACEHOLDER_RULES) {
    assertStringIncludes(prompt, rule);
  }
});

Deno.test("document prompt preserves factual-safety and zero-blank requirements", () => {
  const prompt = buildSystemPrompt({
    task: "document",
    domain: "employment",
    profileHint: "resume",
    extra: "",
  });
  assertStringIncludes(prompt, "Never invent");
  assertStringIncludes(
    prompt,
    "Never blank, omit, discard, or fail an otherwise valid section because information is missing.",
  );
  assertStringIncludes(prompt, "Continue to block genuine blank output");
});
