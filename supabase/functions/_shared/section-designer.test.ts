import { assert } from "jsr:@std/assert@1";

Deno.test("bespoke design owns a stable non-sensitive document checkpoint stage", async () => {
  const source = await Deno.readTextFile(
    new URL("./section-designer.ts", import.meta.url),
  );
  assert(source.includes('logicalStageKey: "generate-document.design"'));
  assert(!source.includes('logicalStageKey: "section-designer.primary"'));
});
