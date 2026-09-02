import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

Deno.test("job-match labels source linkage without claiming entailment", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  assertStringIncludes(
    source,
    'grounding_status: "source_linked_not_independently_verified"',
  );
  assertStringIncludes(source, "source_linked_count: vacancies.length");
  assertEquals(source.includes('grounding_status: "verified"'), false);
});
