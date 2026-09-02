// deno-lint-ignore no-import-prefix -- repository Edge tests pin the JSR assertion API.
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { bindArtifactReferencesToGrounding } from "./ted-artifact-pipeline.ts";

const grounding = {
  capturedAt: "2026-09-02T10:30:00.000Z",
  sources: [{
    id: "source-1",
    title: "Official deadline guidance",
    url: "https://agency.example/guidance",
    type: "web" as const,
  }],
  claims: [{
    text: "Applications close on 30 September 2026.",
    source_ids: ["source-1"],
    source_urls: ["https://agency.example/guidance"],
  }],
};

Deno.test("artifact references are materialized only from captured research provenance", () => {
  assertEquals(
    bindArtifactReferencesToGrounding(
      [{ url: "https://agency.example/guidance" }],
      grounding,
    ),
    [{
      label: "Official deadline guidance",
      url: "https://agency.example/guidance",
      publisher: "agency.example",
      retrieved_at: "2026-09-02T10:30:00.000Z",
      summary: "Applications close on 30 September 2026.",
      supports: "Applications close on 30 September 2026.",
    }],
  );
});

Deno.test("artifact references fail closed for uncaptured, unclaimed, or duplicate URLs", () => {
  assertThrows(
    () =>
      bindArtifactReferencesToGrounding(
        [{ url: "https://attacker.example/invented" }],
        grounding,
      ),
    Error,
    "ARTIFACT_REFERENCE_NOT_CAPTURED",
  );

  assertThrows(
    () =>
      bindArtifactReferencesToGrounding(
        [
          { url: "https://agency.example/guidance" },
          { url: "https://agency.example/guidance" },
        ],
        grounding,
      ),
    Error,
    "ARTIFACT_REFERENCE_DUPLICATE",
  );

  assertThrows(
    () =>
      bindArtifactReferencesToGrounding(
        [{ url: "https://agency.example/guidance" }],
        { ...grounding, claims: [] },
      ),
    Error,
    "ARTIFACT_REFERENCE_CLAIM_REQUIRED",
  );

  assertThrows(
    () =>
      bindArtifactReferencesToGrounding(
        [{ url: "https://agency.example/guidance" }],
        null,
      ),
    Error,
    "ARTIFACT_REFERENCE_NOT_CAPTURED",
  );
});
