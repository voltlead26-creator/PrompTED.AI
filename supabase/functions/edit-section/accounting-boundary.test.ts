import { assert } from "jsr:@std/assert@1";

Deno.test("edit-section does not emit a pre-success gateway ai_edit event", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  assert(!source.includes("trackAiEdit("));
  assert(!source.includes('provider: "gateway"'));
  assert(source.includes('logicalStageKey: "edit-section.primary"'));
});
