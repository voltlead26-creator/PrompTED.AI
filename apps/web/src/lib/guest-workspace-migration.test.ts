import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  commitGuestWorkspaceImport: vi.fn(),
}));

vi.mock("@/lib/api/import-workspace", () => ({
  commitGuestWorkspaceImport: mocks.commitGuestWorkspaceImport,
}));

import { migrateGuestWorkspaces as migrateGuestWorkspacesWithLease } from "./guest-workspace-migration";
import { testOwnerDispatchLease } from "@/test/owner-dispatch-lease";
import {
  claimUnclaimedGuestWorkspacesForMigration,
  currentWorkspaceCacheScope,
  loadWorkspace,
  savePendingOutcome,
  saveWorkspace,
  type StoredWorkspace,
  userWorkspaceCacheScope,
} from "./workspace-store";

const workspace: StoredWorkspace = {
  documentId: "11111111-1111-4111-8111-111111111111",
  outcomeId: "22222222-2222-4222-8222-222222222222",
  title: "Guest document",
  situation: "Help with a document",
  status: "draft",
  generated: true,
  sections: [{
    id: "33333333-3333-4333-8333-333333333333",
    document_id: "11111111-1111-4111-8111-111111111111",
    user_id: "",
    name: "Summary",
    order_index: 0,
    content: "Finished wording",
    status: "draft",
    version_history: [],
    is_required: true,
    created_at: "2026-07-11T00:00:00.000Z",
    updated_at: "2026-07-11T00:00:00.000Z",
  }],
};

function migrateGuestWorkspaces(userId: string) {
  return migrateGuestWorkspacesWithLease(userId, testOwnerDispatchLease(userId));
}

describe("migrateGuestWorkspaces", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    mocks.commitGuestWorkspaceImport.mockResolvedValue({
      status: "committed",
      outcome_id: workspace.outcomeId,
      document_id: workspace.documentId,
      idempotent_replay: false,
    });
    const guest = currentWorkspaceCacheScope();
    saveWorkspace(guest, workspace);
    savePendingOutcome(guest, workspace.outcomeId, {
      situation: workspace.situation,
      templateName: workspace.title,
    });
  });

  it("moves guest work into the signed-in account", async () => {
    expect(await migrateGuestWorkspaces("user-1")).toEqual({
      migrated: 0,
      skipped: 0,
      failed: 0,
      failedOutcomeIds: [],
      cleanupFailed: 0,
      cleanupFailedOutcomeIds: [],
    });
    expect(mocks.commitGuestWorkspaceImport).not.toHaveBeenCalled();
    expect(claimUnclaimedGuestWorkspacesForMigration("user-1")).toBe(1);
    const result = await migrateGuestWorkspaces("user-1");

    expect(result).toEqual({
      migrated: 1,
      skipped: 0,
      failed: 0,
      failedOutcomeIds: [],
      cleanupFailed: 0,
      cleanupFailedOutcomeIds: [],
    });
    expect(mocks.commitGuestWorkspaceImport).toHaveBeenCalledTimes(1);
    expect(mocks.commitGuestWorkspaceImport).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey:
          `guest-workspace:${workspace.outcomeId}:${workspace.documentId}`,
        outcomeId: workspace.outcomeId,
        documentId: workspace.documentId,
        sections: [expect.objectContaining({ user_id: "user-1" })],
      }),
      expect.objectContaining({ expectedUserId: "user-1" }),
    );
    expect(loadWorkspace(currentWorkspaceCacheScope(), workspace.outcomeId)).toBeNull();
  });

  it("removes the guest source after one atomic import", async () => {
    expect(claimUnclaimedGuestWorkspacesForMigration("user-1")).toBe(1);
    await migrateGuestWorkspaces("user-1");
    const second = await migrateGuestWorkspaces("user-1");

    expect(second).toEqual({
      migrated: 0,
      skipped: 0,
      failed: 0,
      failedOutcomeIds: [],
      cleanupFailed: 0,
      cleanupFailedOutcomeIds: [],
    });
    expect(mocks.commitGuestWorkspaceImport).toHaveBeenCalledTimes(1);
  });

  it("claims failed guest work to the first account and permits only that account to retry", async () => {
    expect(claimUnclaimedGuestWorkspacesForMigration("user-1")).toBe(1);
    mocks.commitGuestWorkspaceImport.mockRejectedValueOnce(new Error("offline"));
    const result = await migrateGuestWorkspaces("user-1");

    expect(result.failed).toBe(1);
    expect(result.failedOutcomeIds).toEqual([workspace.outcomeId]);
    expect(loadWorkspace(currentWorkspaceCacheScope(), workspace.outcomeId)).toBeNull();
    expect(await migrateGuestWorkspaces("user-2")).toEqual({
      migrated: 0,
      skipped: 0,
      failed: 0,
      failedOutcomeIds: [],
      cleanupFailed: 0,
      cleanupFailedOutcomeIds: [],
    });

    expect(await migrateGuestWorkspaces("user-1")).toEqual({
      migrated: 1,
      skipped: 0,
      failed: 0,
      failedOutcomeIds: [],
      cleanupFailed: 0,
      cleanupFailedOutcomeIds: [],
    });
    expect(mocks.commitGuestWorkspaceImport).toHaveBeenCalledTimes(2);
  });

  it("retries partial browser cleanup from the immutable imported claim without replaying the import", async () => {
    expect(claimUnclaimedGuestWorkspacesForMigration("user-1")).toBe(1);
    const originalRemove = Storage.prototype.removeItem;
    let blockedOnce = true;
    const removeSpy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (
      this: Storage,
      key,
    ) {
      if (blockedOnce && key.includes(":workspace:")) {
        blockedOnce = false;
        return;
      }
      return originalRemove.call(this, key);
    });

    try {
      expect(await migrateGuestWorkspaces("user-1")).toEqual({
        migrated: 1,
        skipped: 0,
        failed: 0,
        failedOutcomeIds: [],
        cleanupFailed: 1,
        cleanupFailedOutcomeIds: [workspace.outcomeId],
      });
    } finally {
      removeSpy.mockRestore();
    }

    expect(await migrateGuestWorkspaces("user-1")).toEqual({
      migrated: 0,
      skipped: 0,
      failed: 0,
      failedOutcomeIds: [],
      cleanupFailed: 0,
      cleanupFailedOutcomeIds: [],
    });
    expect(mocks.commitGuestWorkspaceImport).toHaveBeenCalledTimes(1);
  });

  it("never imports ambiguous legacy ownerless or another user's scoped cache", async () => {
    sessionStorage.clear();
    sessionStorage.setItem(
      `prompted:workspace:${workspace.outcomeId}`,
      JSON.stringify({ ...workspace, title: "Ambiguous legacy workspace" }),
    );
    saveWorkspace(userWorkspaceCacheScope("user-2"), {
      ...workspace,
      outcomeId: "44444444-4444-4444-8444-444444444444",
      title: "User 2 workspace",
      sections: workspace.sections.map((section) => ({ ...section, user_id: "user-2" })),
    });

    expect(await migrateGuestWorkspaces("user-1")).toEqual({
      migrated: 0,
      skipped: 0,
      failed: 0,
      failedOutcomeIds: [],
      cleanupFailed: 0,
      cleanupFailedOutcomeIds: [],
    });
    expect(mocks.commitGuestWorkspaceImport).not.toHaveBeenCalled();
  });
});
