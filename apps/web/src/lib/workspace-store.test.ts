import { beforeEach, describe, expect, it } from "vitest";
import type { Section } from "@prompted/shared/browser";
import {
  advanceCapturedExportIntentSequenceForNewExport,
  currentWorkspaceCacheScope,
  deterministicGenerationEntityId,
  loadWorkspace,
  loadPendingOutcome,
  purgeWorkspaceCachesForUser,
  resolveCapturedExportIntentSequence,
  resolveGenerationRequestIdentity,
  savePendingOutcome,
  saveWorkspace,
  userWorkspaceCacheScope,
} from "./workspace-store";

const userA = userWorkspaceCacheScope("user-a");
const userB = userWorkspaceCacheScope("user-b");

describe("generation request identity persistence", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("derives one opaque request ID for identical input across storage loss and devices", async () => {
    const first = await resolveGenerationRequestIdentity(
      userA,
      "outcome-reload",
      "initial-document:document-1",
      {
        situation: "Private situation text",
        sections: [{ key: "summary", required: true }],
      },
    );
    window.sessionStorage.clear();
    const replay = await resolveGenerationRequestIdentity(
      userA,
      "outcome-reload",
      "initial-document:document-1",
      {
        sections: [{ required: true, key: "summary" }],
        situation: "Private situation text",
      },
    );

    expect(replay).toBe(first);
    expect(first).toMatch(/^gen-[0-9a-f]{64}$/);
    const stored = Array.from({ length: sessionStorage.length }, (_, index) =>
      sessionStorage.key(index),
    )
      .filter((key): key is string => Boolean(key?.includes(":generation-identities:")))
      .map((key) => sessionStorage.getItem(key))
      .join("\n");
    expect(stored).toContain(first);
    expect(stored).not.toContain("Private situation text");
    expect(stored).not.toContain("summary");
  });

  it("rotates only when the immutable generation input changes", async () => {
    const first = await resolveGenerationRequestIdentity(
      userA,
      "outcome-change",
      "section-repair:section-1",
      { content: "Original wording", revision: 1 },
    );
    const changed = await resolveGenerationRequestIdentity(
      userA,
      "outcome-change",
      "section-repair:section-1",
      { content: "Confirmed changed wording", revision: 2 },
    );
    const changedReplay = await resolveGenerationRequestIdentity(
      userA,
      "outcome-change",
      "section-repair:section-1",
      { revision: 2, content: "Confirmed changed wording" },
    );

    expect(changed).not.toBe(first);
    expect(changedReplay).toBe(changed);
  });

  it("rotates a captured export intent only after an explicit new-export request", () => {
    const intentKey =
      "55555555-5555-4555-8555-555555555555:33333333-3333-4333-8333-333333333333:4:pdf";
    expect(resolveCapturedExportIntentSequence(userA, "outcome-export", intentKey)).toBe(0);
    expect(resolveCapturedExportIntentSequence(userA, "outcome-export", intentKey)).toBe(0);
    expect(
      advanceCapturedExportIntentSequenceForNewExport(userA, "outcome-export", intentKey, 1),
    ).toBe(false);
    expect(
      advanceCapturedExportIntentSequenceForNewExport(userA, "outcome-export", intentKey, 0),
    ).toBe(true);
    expect(resolveCapturedExportIntentSequence(userA, "outcome-export", intentKey)).toBe(1);
    expect(resolveCapturedExportIntentSequence(userB, "outcome-export", intentKey)).toBe(0);
  });

  it("derives stable UUID rows for replayed generated items", async () => {
    const first = await deterministicGenerationEntityId(
      "11111111-1111-4111-8111-111111111111",
      "checklist-item:0",
    );
    const replay = await deterministicGenerationEntityId(
      "11111111-1111-4111-8111-111111111111",
      "checklist-item:0",
    );
    const sibling = await deterministicGenerationEntityId(
      "11111111-1111-4111-8111-111111111111",
      "checklist-item:1",
    );

    expect(replay).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(sibling).not.toBe(first);
  });

  it("never reopens an intentionally omitted section body as an authoritative blank", () => {
    const partial = {
      documentId: "document-1",
      outcomeId: "outcome-partial",
      title: "Bounded document",
      situation: "Preserve durable wording.",
      status: "draft",
      sections: [
        {
          id: "section-1",
          document_id: "document-1",
          user_id: "user-1",
          name: "Deferred section",
          order_index: 0,
          content: "",
          content_loaded: false,
          content_sha256: "a".repeat(64),
          content_length: 50_000,
          status: "draft",
          version_history: [],
          is_required: true,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-01T00:00:00.000Z",
          revision: 3,
        } as Section,
      ],
    };

    saveWorkspace(userA, partial);
    expect(loadWorkspace(userA, "outcome-partial")).toBeNull();

    sessionStorage.clear();
    saveWorkspace(userA, partial);
    expect(loadWorkspace(userA, "outcome-partial")).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it("binds document and intake caches to one exact authenticated owner", () => {
    const workspace = {
      documentId: "document-owned",
      outcomeId: "outcome-owned",
      title: "User A document",
      situation: "Private user A facts",
      status: "draft",
      sections: [] as Section[],
    };
    const pending = {
      situation: "Private user A facts",
      templateName: "Complaint letter",
    };

    saveWorkspace(userA, workspace);
    savePendingOutcome(userA, workspace.outcomeId, pending);

    expect(loadWorkspace(userA, workspace.outcomeId)).toEqual(workspace);
    expect(loadPendingOutcome(userA, workspace.outcomeId)).toEqual(pending);
    expect(loadWorkspace(userB, workspace.outcomeId)).toBeNull();
    expect(loadPendingOutcome(userB, workspace.outcomeId)).toBeNull();
    expect(loadWorkspace(currentWorkspaceCacheScope(), workspace.outcomeId)).toBeNull();
  });

  it("quarantines ambiguous legacy ownerless entries", () => {
    const legacy = {
      documentId: "legacy-document",
      outcomeId: "legacy-outcome",
      title: "Unknown prior owner",
      situation: "Must not be claimed automatically",
      status: "draft",
      sections: [] as Section[],
    };
    sessionStorage.setItem(`prompted:workspace:${legacy.outcomeId}`, JSON.stringify(legacy));
    sessionStorage.setItem(
      `prompted:pending:${legacy.outcomeId}`,
      JSON.stringify({ situation: legacy.situation, templateName: legacy.title }),
    );

    expect(loadWorkspace(userA, legacy.outcomeId)).toBeNull();
    expect(loadWorkspace(currentWorkspaceCacheScope(), legacy.outcomeId)).toBeNull();
    expect(loadPendingOutcome(userA, legacy.outcomeId)).toBeNull();
    expect(loadPendingOutcome(currentWorkspaceCacheScope(), legacy.outcomeId)).toBeNull();
  });

  it("binds deterministic generation identities to the exact owner", async () => {
    const input = { situation: "Same visible request", revision: 1 };
    const first = await resolveGenerationRequestIdentity(
      userA,
      "shared-outcome",
      "initial-document:shared-document",
      input,
    );
    const second = await resolveGenerationRequestIdentity(
      userB,
      "shared-outcome",
      "initial-document:shared-document",
      input,
    );

    expect(second).not.toBe(first);
  });

  it("purges only one deleted owner's workspace caches", () => {
    const workspace = {
      documentId: "document-owned",
      outcomeId: "outcome-owned",
      title: "Private document",
      situation: "Private facts",
      status: "draft",
      sections: [] as Section[],
    };
    saveWorkspace(userA, workspace);
    savePendingOutcome(userA, workspace.outcomeId, {
      situation: workspace.situation,
      templateName: workspace.title,
    });
    saveWorkspace(userB, { ...workspace, title: "User B document" });

    expect(purgeWorkspaceCachesForUser("user-a")).toBe(true);
    expect(loadWorkspace(userA, workspace.outcomeId)).toBeNull();
    expect(loadPendingOutcome(userA, workspace.outcomeId)).toBeNull();
    expect(loadWorkspace(userB, workspace.outcomeId)?.title).toBe("User B document");
  });
});
