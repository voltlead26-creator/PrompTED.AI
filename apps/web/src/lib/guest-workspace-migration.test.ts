import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  commitGuestWorkspaceImport: vi.fn(),
}));

vi.mock("@/lib/api/import-workspace", () => ({
  commitGuestWorkspaceImport: mocks.commitGuestWorkspaceImport,
}));

import { migrateGuestWorkspaces } from "./guest-workspace-migration";

const workspace = {
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
    sessionStorage.setItem(
      `prompted:workspace:${workspace.outcomeId}`,
      JSON.stringify(workspace),
    );
  });

  it("moves guest work into the signed-in account", async () => {
    const result = await migrateGuestWorkspaces("user-1");

    expect(result).toEqual({ migrated: 1, skipped: 0, failed: 0, failedOutcomeIds: [] });
    expect(mocks.commitGuestWorkspaceImport).toHaveBeenCalledTimes(1);
    expect(mocks.commitGuestWorkspaceImport).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey:
          `guest-workspace:${workspace.outcomeId}:${workspace.documentId}`,
        outcomeId: workspace.outcomeId,
        documentId: workspace.documentId,
        sections: [expect.objectContaining({ user_id: "user-1" })],
      }),
    );
  });

  it("is idempotent for the same user and outcome", async () => {
    await migrateGuestWorkspaces("user-1");
    const second = await migrateGuestWorkspaces("user-1");

    expect(second).toEqual({ migrated: 0, skipped: 1, failed: 0, failedOutcomeIds: [] });
    expect(mocks.commitGuestWorkspaceImport).toHaveBeenCalledTimes(1);
  });

  it("keeps failed work locally and reports it for retry", async () => {
    mocks.commitGuestWorkspaceImport.mockRejectedValueOnce(new Error("offline"));
    const result = await migrateGuestWorkspaces("user-1");

    expect(result.failed).toBe(1);
    expect(result.failedOutcomeIds).toEqual([workspace.outcomeId]);
    expect(sessionStorage.getItem(`prompted:workspace:${workspace.outcomeId}`)).not.toBeNull();
  });
});
