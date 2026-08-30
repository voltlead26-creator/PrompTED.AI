import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  createDocumentPlaceholderToken,
  parseDocumentPlaceholderTokens,
  UNIVERSAL_DOCUMENT_PLACEHOLDER_RULES,
} from "./document-placeholder-policy.ts";
import { stripResidual, validateSection } from "./draft-validator.ts";
import {
  renderProfile,
  selectProfile,
} from "./document-intelligence-profiles.ts";
import { assertDeliverableSections } from "./document-delivery-guard.ts";

Deno.test("declared TED placeholder is allowed inside final wording", () => {
  const token = createDocumentPlaceholderToken(
    "resume.summary.target_role",
    "target role",
  );
  const content =
    `I am applying for ${token} and bring strong customer-facing experience.`;
  assertEquals(parseDocumentPlaceholderTokens(content).length, 1);
  assertEquals(validateSection({ content, label: "Summary" }), []);
  assertEquals(stripResidual(content), content);
});

Deno.test("raw placeholders and scaffold markers remain rejected", () => {
  for (
    const content of [
      "Dear [recipient name],",
      "I work at {{company}}.",
      "Start date: TBD",
      "This section will explain the user's experience.",
    ]
  ) {
    assert(
      validateSection({ content }).length > 0,
      `Expected rejection: ${content}`,
    );
  }
});

Deno.test("resolved DIP renders the canonical missing-information doctrine", () => {
  const profile = selectProfile("resume", "employment");
  assert(profile);
  const rendered = renderProfile(profile, "document");
  for (const rule of UNIVERSAL_DOCUMENT_PLACEHOLDER_RULES) {
    assertStringIncludes(rendered, rule);
  }
  assert(!rendered.includes("Never use bracketed placeholders"));
  assert(!rendered.includes("Missing vital details:"));
});

Deno.test("blank sections cannot cross the delivery boundary", () => {
  let threw = false;
  try {
    assertDeliverableSections([
      { key: "summary", label: "Summary", content: "Ready." },
      { key: "experience", label: "Experience", content: "" },
    ]);
  } catch (error) {
    threw = error instanceof Error &&
      error.message === "DOCUMENT_QUALITY_FAILED:blank_output";
  }
  assert(threw);
});
