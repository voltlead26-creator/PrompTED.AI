import { assert } from "jsr:@std/assert";
import { buildSystemPrompt } from "./prompt-builder.ts";
import coreTemplates from "../../../packages/shared/src/templates/templates.data.json" with {
  type: "json",
};
import phase2Templates from "../../../packages/shared/src/templates/phase2-templates.data.json" with {
  type: "json",
};

Deno.test("recommend prompt embeds every real catalogue name as ground truth", () => {
  const prompt = buildSystemPrompt({ task: "recommend", domain: "business" });
  const names = [...coreTemplates, ...phase2Templates].map((t) =>
    (t as { name: string }).name
  );
  assert(names.length > 50, "expected the catalogue to have a substantial number of templates");
  for (const name of names) {
    assert(prompt.includes(name), `expected prompt to include catalogue name "${name}"`);
  }
});

Deno.test("recommend prompt forbids inventing a plausible-sounding name outside the catalogue", () => {
  const prompt = buildSystemPrompt({ task: "recommend" });
  assert(prompt.includes("MUST be exactly one of these PrompTED catalogue names"));
  assert(
    prompt.includes("choose the closest real catalogue name rather than inventing one"),
  );
  // Regression case: this exact plausible-but-nonexistent name previously
  // slipped through unconstrained and produced a blank generic-blueprint
  // document (Key details / Main content / Next steps / Closing) with no
  // real content, since nothing in the catalogue resolves to it.
  assert(!prompt.includes("Marketing and Sales Strategy"));
});

Deno.test("initial intent always asks one profile-grounded clarification or factual confirmation", () => {
  const prompt = buildSystemPrompt({
    task: "intent",
    profileHint: "I want to contest a towing incident and recover the fee.",
  });

  assert(prompt.includes("On this first turn, you MUST ask exactly ONE"));
  assert(prompt.includes("highest-impact unresolved factual requirement"));
  assert(prompt.includes("confirm or correct your factual understanding"));
  assert(prompt.includes("Do not return a recommendation on this first turn"));
});
