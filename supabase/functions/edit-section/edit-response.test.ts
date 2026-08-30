import { assertEquals } from "jsr:@std/assert";
import { parseEditResponse } from "./edit-response.ts";

Deno.test("parseEditResponse extracts content and changes from well-formed JSON", () => {
  const raw = JSON.stringify({
    content: "Accomplished operations leader with 10+ years of experience.",
    changes: [
      "Removed 'Commercially focused' as a standalone claim.",
      "Tightened the closing sentence to a measurable outcome.",
    ],
  });
  const result = parseEditResponse(raw);
  assertEquals(result.content, "Accomplished operations leader with 10+ years of experience.");
  assertEquals(result.changes.length, 2);
});

Deno.test("parseEditResponse never leaks explanation text into content", () => {
  // Regression: before the structured-response fix, the model sometimes
  // appended a bullet-point explanation directly onto the revised text
  // instead of returning it separately, and the raw string (explanation
  // included) was streamed to the client as if it were final wording.
  const raw = JSON.stringify({
    content: "Final revised wording only.",
    changes: ["Explanation of the edit goes here, not in content."],
  });
  const { content } = parseEditResponse(raw);
  assertEquals(content.includes("Explanation of the edit"), false);
});

Deno.test("parseEditResponse drops non-string entries from changes", () => {
  const raw = JSON.stringify({ content: "Text.", changes: ["Real change", 42, null, ""] });
  const result = parseEditResponse(raw);
  assertEquals(result.changes, ["Real change"]);
});

Deno.test("parseEditResponse handles missing changes gracefully", () => {
  const raw = JSON.stringify({ content: "Text with no listed changes." });
  const result = parseEditResponse(raw);
  assertEquals(result.content, "Text with no listed changes.");
  assertEquals(result.changes, []);
});

Deno.test("parseEditResponse returns empty content for malformed JSON rather than throwing", () => {
  const result = parseEditResponse("not json at all");
  assertEquals(result.content, "");
  assertEquals(result.changes, []);
});

Deno.test("parseEditResponse handles a JSON-fenced response", () => {
  const raw = "```json\n" + JSON.stringify({ content: "Fenced text.", changes: [] }) + "\n```";
  const result = parseEditResponse(raw);
  assertEquals(result.content, "Fenced text.");
});
