import { describe, expect, it } from "vitest";
import { splitImportedDocument } from "./import-structure";

describe("import provenance", () => {
  it("stores the original imported content as the first restorable version", () => {
    const [section] = splitImportedDocument({
      extracted: "Summary\nExperienced hospitality manager.",
      documentId: "document-1",
      userId: "user-1",
      now: "2026-07-11T00:00:00.000Z",
    });

    expect(section?.version_history).toEqual([
      {
        content: section?.content,
        saved_at: "2026-07-11T00:00:00.000Z",
        label: "Original imported content",
        origin: "imported_original",
      },
    ]);
  });
});
