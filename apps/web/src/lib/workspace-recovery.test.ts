import { describe, expect, it } from "vitest";
import type { WorkspaceDocumentState } from "./workspace-store";
import { sha256Text } from "./api/sections";
import { reviewWorkspaceRecovery } from "./workspace-recovery";

async function fixture() {
  const section = {
    id: "section-1", document_id: "document-1", user_id: "owner-1", name: "Overview", order_index: 0,
    content: "Saved wording", status: "draft" as const, version_history: [], is_required: true,
    created_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T00:00:00Z",
    content_loaded: true, content_sha256: await sha256Text("Saved wording"), content_length: 13,
    revision: 2, approved_revision: null, ledger_binding_status: "legacy_unversioned",
    section_key: null, section_state: null,
  };
  const current: WorkspaceDocumentState = { documentId: "document-1", title: "My document", situation: "",
    status: "draft", generated: false, templateId: null, conversationContext: "", uploadContext: "", sections: [section] };
  const cached = { ...current, templateId: undefined, outcomeId: "outcome-1",
    sections: [{ ...section, content: "My unsaved wording" }] };
  return { current, cached };
}

describe("browser wording recovery boundary", () => {
  it.each([
    ["owner", { user_id: "another-owner" }],
    ["document", { document_id: "another-document" }],
    ["section", { id: "another-section" }],
    ["unloaded", { content_loaded: false }],
    ["malformed body", { content: { text: "Fake body" } }],
    ["oversized body", { content: "x".repeat(1_048_577) }],
  ])("rejects an untrusted %s instead of recovering it", async (_name, change) => {
    const { current, cached } = await fixture();
    const candidate = { ...cached, sections: [{ ...cached.sections[0], ...change }] };
    expect(await reviewWorkspaceRecovery(candidate, current, "owner-1", "outcome-1", 3)).toBeNull();
  });

  it.each([null, { sections: [] }, { documentId: "document-1", outcomeId: "outcome-1", sections: [null] }])(
    "rejects malformed or incomplete cache envelopes", async cached => {
      const { current } = await fixture();
      expect(await reviewWorkspaceRecovery(cached, current, "owner-1", "outcome-1", 3)).toBeNull();
    },
  );

  it.each([
    ["revision", { revision: 1 }],
    ["baseline digest", { content_sha256: "a".repeat(64) }],
    ["approval", { approved_revision: 2 }],
    ["required policy", { is_required: false }],
    ["name", { name: "A replacement policy" }],
    ["unsafe markup", { content: '<p onclick="alert(1)">My wording</p>' }],
    ["truncating edit", { content: "x".repeat(20_001) }],
  ])("keeps a readable copy but prohibits restore for a conflicting %s", async (_name, change) => {
    const { current, cached } = await fixture();
    const candidate = { ...cached, sections: [{ ...cached.sections[0], ...change }] };
    const review = await reviewWorkspaceRecovery(candidate, current, "owner-1", "outcome-1", 3);
    expect(review?.status).toBe("conflict");
    expect(review?.sections[0]?.content).toBe(candidate.sections[0]!.content);
  });

  it("captures literal wording before async work and returns an immutable review", async () => {
    const { current, cached } = await fixture();
    const checking = reviewWorkspaceRecovery(cached, current, "owner-1", "outcome-1", 3);
    cached.sections[0]!.content = "Changed while checking";
    const review = await checking;
    expect(review?.sections[0]?.content).toBe("My unsaved wording");
    expect(review?.status).toBe("ready");
    expect(Object.isFrozen(review)).toBe(true);
    expect(Object.isFrozen(review?.sections[0])).toBe(true);
  });
});
