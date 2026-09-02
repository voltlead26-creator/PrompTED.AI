import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("reload-safe generation identity contract", () => {
  it("persists initial and scoped document identities instead of mount-local UUIDs", () => {
    const hook = source("src/hooks/useDocument.ts");
    expect(hook).toContain("resolveGenerationRequestIdentity");
    expect(hook).toContain("initial-document:${target.documentId}");
    expect(hook).toContain("section-repair:${target.id}");
    expect(hook).not.toContain("generationRequestIdRef");
    expect(hook).not.toContain("generationRequestId: crypto.randomUUID()");
  });

  it("persists checklist and artifact identities across load and refinement", () => {
    const initialChecklist = source(
      "src/app/(app)/outcomes/[id]/checklist/InteractiveChecklistOutcome.tsx",
    );
    const refinement = source("src/components/organisms/ConversationView.tsx");

    for (const implementation of [initialChecklist, refinement]) {
      expect(implementation).toContain("resolveGenerationRequestIdentity");
      expect(implementation).not.toMatch(/(?:request_id|generation_request_id):\s*makeId\(\)/);
    }
    expect(initialChecklist).not.toContain("artifactRequestIdRef");
    expect(initialChecklist).not.toContain("checklistRequestIdRef");
    expect(refinement).toContain("TED can't safely replace this saved plan yet");
    expect(refinement).not.toContain("saveArtifact(merged");
    expect(refinement).not.toContain("refine-artifact:${existingArtifact.kind}");
    expect(refinement).toContain('"refine-checklist"');
  });
});
