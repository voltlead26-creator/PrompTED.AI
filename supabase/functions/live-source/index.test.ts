import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

Deno.test("live-source uses the authenticated fail-closed research gate", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  assertStringIncludes(source, "handleResearchRequest");
  assertStringIncludes(source, "LIVE_SOURCE_GATE_DOWNSTREAM_FORBIDDEN");
  assertEquals(source.includes("requestGroundedResearch"), false);
  assertEquals(source.includes("routeRequest"), false);
  assertEquals(source.includes("Deno.env.get"), false);
});
