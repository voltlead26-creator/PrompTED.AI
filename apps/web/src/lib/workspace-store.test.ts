import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("observable workspace cache writes", () => {
  const original = {
    documentId: "document-owned",
    outcomeId: "outcome-owned",
    title: "Original title",
    situation: "Confirmed facts",
    status: "draft",
    sections: [] as Section[],
  };
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("reports a successful write only when the same owner can reload it", () => {
    expect(saveWorkspace(userA, original)).toEqual({ status: "saved" });
    expect(loadWorkspace(userA, original.outcomeId)).toEqual(original);
    expect(loadWorkspace(userB, original.outcomeId)).toBeNull();
  });

  it.each(["QuotaExceededError", "SecurityError"])(
    "reports %s without claiming or overwriting the newer copy",
    (name) => {
      saveWorkspace(userA, original);
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("Synthetic storage denial", name);
      });
      expect(saveWorkspace(userA, { ...original, title: "New unsaved title" })).toEqual({
        status: "unavailable",
        reason: name === "QuotaExceededError" ? "quota_exceeded" : "storage_unavailable",
      });
      expect(loadWorkspace(userA, original.outcomeId)?.title).toBe("Original title");
    },
  );

  it("distinguishes a deliberately incomplete snapshot from storage quota", () => {
    const partial = {
      ...original,
      sections: [
        {
          id: "section-1",
          document_id: original.documentId,
          user_id: "user-a",
          content: "",
          content_loaded: false,
        },
      ] as unknown as Section[],
    };
    const write = vi.spyOn(Storage.prototype, "setItem");
    expect(saveWorkspace(userA, partial)).toEqual({
      status: "unavailable",
      reason: "incomplete_workspace",
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("rejects an incorrect section owner before writing", () => {
    const foreign = {
      ...original,
      sections: [
        {
          id: "foreign",
          document_id: original.documentId,
          user_id: "user-b",
          content: "Foreign wording",
        },
      ] as Section[],
    };
    const write = vi.spyOn(Storage.prototype, "setItem");
    expect(saveWorkspace(userA, foreign)).toEqual({
      status: "unavailable",
      reason: "invalid_workspace",
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("does not claim reload recovery while the guest namespace cannot be written, then retries it", () => {
    const guest = currentWorkspaceCacheScope();
    sessionStorage.clear();
    const setItem = Storage.prototype.setItem;
    const deny = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key.endsWith(":guest-scope"))
        throw new DOMException("Synthetic scope denial", "SecurityError");
      return setItem.call(this, key, value);
    });
    expect(saveWorkspace(guest, original)).toEqual({
      status: "unavailable",
      reason: "guest_scope_unavailable",
    });
    deny.mockRestore();
    expect(saveWorkspace(guest, original)).toEqual({ status: "saved" });
    expect(currentWorkspaceCacheScope()).toEqual(guest);
    expect(loadWorkspace(currentWorkspaceCacheScope(), original.outcomeId)).toEqual(original);
  });
});

it("does not replace a different active guest namespace or write a claimed guest cache", () => {
  sessionStorage.clear();
  const scope = currentWorkspaceCacheScope();
  expect(scope.kind).toBe("guest");
  if (scope.kind !== "guest") throw new Error("Expected guest fixture");
  const scopeKey = Array.from({ length: sessionStorage.length }, (_, i) =>
    sessionStorage.key(i),
  ).find((key) => key?.endsWith(":guest-scope"));
  if (!scopeKey) throw new Error("Guest namespace fixture was not created");
  const workspace = {
    documentId: "guest-document",
    outcomeId: "guest-outcome",
    title: "Guest wording",
    situation: "Confirmed facts",
    status: "draft",
    sections: [] as Section[],
  };
  expect(saveWorkspace(scope, workspace)).toEqual({ status: "saved" });
  sessionStorage.setItem(scopeKey, "different-active-guest");
  expect(saveWorkspace(scope, { ...workspace, title: "Must not replace" })).toEqual({
    status: "unavailable",
    reason: "guest_scope_unavailable",
  });
  expect(sessionStorage.getItem(scopeKey)).toBe("different-active-guest");
  sessionStorage.setItem(scopeKey, scope.guestId);
  const claimKey =
    scopeKey.replace(":guest-scope", ":guest-migration-claim") +
    `:${encodeURIComponent(scope.guestId)}:${encodeURIComponent(workspace.outcomeId)}`;
  sessionStorage.setItem(claimKey, JSON.stringify({ syntheticClaim: true }));
  expect(saveWorkspace(scope, { ...workspace, title: "Must not replace" })).toEqual({
    status: "unavailable",
    reason: "guest_scope_unavailable",
  });
  expect(loadWorkspace(scope, workspace.outcomeId)).toBeNull();
  sessionStorage.clear();
});
