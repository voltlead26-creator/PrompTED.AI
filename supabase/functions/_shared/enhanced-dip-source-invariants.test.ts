import { assert, assertEquals } from "jsr:@std/assert";

Deno.test("document pipeline has no blocked-section blanking release path", async () => {
  const source = await Deno.readTextFile(
    new URL("./document-pipeline.ts", import.meta.url),
  );
  assert(!source.includes("write around it naturally and do not mention it"));
  assert(!/blockedSectionKeys[\s\S]{0,300}content\s*:\s*["']{2}/.test(source));
  assert(source.includes("missing_information_keys"));
  assert(source.includes("sectionResolutionDirective"));
  assert(source.includes("unresolvedPlaceholdersForBrief"));
});

Deno.test("workspace missing-info answers do not regenerate the whole section", async () => {
  const source = await Deno.readTextFile(
    new URL("../../../apps/web/src/hooks/useWorkspace.ts", import.meta.url),
  );
  assert(
    !source.includes(
      "The user has supplied a missing vital detail for this section",
    ),
  );
  assert(!source.includes("editSectionStream("));
  assert(source.includes("resolvePlaceholderValue"));
});

Deno.test("generation stream exposes canonical unresolved placeholder metadata", async () => {
  const source = await Deno.readTextFile(
    new URL("../generate-document/index.ts", import.meta.url),
  );
  assert(source.includes('type: "unresolved_placeholders"'));
});

Deno.test("renderProfile includes all nine Enhanced DIP information fields", async () => {
  const source = await Deno.readTextFile(
    new URL("./document-intelligence-profiles.ts", import.meta.url),
  );
  for (
    const field of [
      "information_key=",
      "label=",
      "fact_type=",
      "placeholder_label=",
      "question=",
      "automatic_fallback=",
      "required_for_export=",
      "shared_resolution_key=",
      "neutral_replacements=",
    ]
  ) {
    assert(source.includes(field), field);
  }
  assertEquals(
    source.includes("required facts ="),
    false,
  );
});
