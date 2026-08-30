import { assertEquals } from "jsr:@std/assert";
import { buildSystemPrompt } from "./prompt-builder.ts";
import {
  findContradictoryPlaceholderRules,
  UNIVERSAL_DOCUMENT_PLACEHOLDER_RULES,
} from "./document-placeholder-policy.ts";

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

Deno.test("document prompt renders each canonical placeholder rule exactly once", () => {
  const prompt = buildSystemPrompt({
    task: "document",
    domain: "employment",
    profileHint: "resume",
  });
  for (const rule of UNIVERSAL_DOCUMENT_PLACEHOLDER_RULES) {
    assertEquals(
      count(prompt, rule),
      1,
      `Expected one canonical occurrence of: ${rule}`,
    );
  }
});

Deno.test("assembled TED prompts contain no legacy conflicting placeholder doctrine", () => {
  for (
    const task of ["intent", "clarify", "recommend", "document", "checklist"]
  ) {
    const prompt = buildSystemPrompt({
      task,
      domain: "employment",
      profileHint: "resume",
    });
    assertEquals(
      findContradictoryPlaceholderRules(prompt.split("\n")),
      [],
      `Legacy placeholder doctrine survived in ${task} prompt`,
    );
  }
});
