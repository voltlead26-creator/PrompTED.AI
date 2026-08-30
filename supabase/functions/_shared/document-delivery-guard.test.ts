import { assertEquals, assertThrows } from "jsr:@std/assert";
import { assertDeliverableSections } from "./document-delivery-guard.ts";

Deno.test("delivery guard rejects any blank section", () => {
  const error = assertThrows(
    () =>
      assertDeliverableSections([
        { key: "summary", label: "Summary", content: "Ready to use." },
        { key: "experience", label: "Experience", content: "   " },
      ]),
    Error,
  );
  assertEquals(error.message, "DOCUMENT_QUALITY_FAILED:blank_output");
});

Deno.test("delivery guard accepts complete non-blank sections", () => {
  assertDeliverableSections([
    { key: "summary", label: "Summary", content: "Ready to use." },
    { key: "experience", label: "Experience", content: "Managed the centre." },
  ]);
});
