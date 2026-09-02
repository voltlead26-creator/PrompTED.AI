import { beforeEach, describe, expect, it, vi } from "vitest";
import { testOwnerDispatchLease } from "@/test/owner-dispatch-lease";

const withOwnerSupabaseMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/owner-client", () => ({
  withOwnerSupabase: withOwnerSupabaseMock,
}));

import {
  fetchActionItems,
  fetchRoleOutcomes,
  fetchSavedRoles,
  recordRoleOutcome,
  saveRole,
  setActionItemStatus,
} from "./saved-roles";

const USER_ID = "a1000000-0000-4000-8000-000000000001";
const ROLE_ID = "a2000000-0000-4000-8000-000000000001";
const OUTCOME_ID = "a3000000-0000-4000-8000-000000000001";
const ITEM_ID = "a4000000-0000-4000-8000-000000000001";
const TOKEN_1 = "a5000000-0000-4000-8000-000000000001";
const TOKEN_2 = "a5000000-0000-4000-8000-000000000002";

const actionItem = {
  id: ITEM_ID,
  label: "Review the role",
  description: null,
  status: "done" as const,
  sort_order: 0,
  mutation_token: TOKEN_2,
};

function installClient(client: unknown) {
  withOwnerSupabaseMock.mockImplementation(
    async (...args: unknown[]) => {
      const operation = args[1];
      if (typeof operation !== "function") {
        throw new Error(`OWNER_TEST_OPERATION_INVALID:${args.length}:${args.map((value) => typeof value).join(",")}`);
      }
      return await operation(client);
    },
  );
}

describe("saved-role owner commands", () => {
  beforeEach(() => {
    withOwnerSupabaseMock.mockReset();
  });

  it("rejects explicit owner mismatches before opening an owner transport", async () => {
    const lease = testOwnerDispatchLease(USER_ID);

    await expect(saveRole({ userId: "different-user", roleTitle: "Builder" }, lease))
      .rejects.toThrow("SAVED_ROLE_OWNER_CONTEXT_MISMATCH");
    await expect(fetchSavedRoles("different-user", lease))
      .rejects.toThrow("SAVED_ROLE_OWNER_CONTEXT_MISMATCH");
    await expect(recordRoleOutcome({
      userId: "different-user",
      savedRoleId: ROLE_ID,
      stage: "applied",
    }, lease)).rejects.toThrow("SAVED_ROLE_OWNER_CONTEXT_MISMATCH");

    expect(withOwnerSupabaseMock).not.toHaveBeenCalled();
  });

  it("saves and seeds through one atomic RPC under the exact lease", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ROLE_ID, error: null });
    installClient({ rpc });
    const lease = testOwnerDispatchLease(USER_ID);

    await expect(saveRole({
      userId: USER_ID,
      roleTitle: " Building Manager ",
      companyName: "Example Co",
      matchPercentage: 91,
      contactSourceStatus: "official",
    }, lease)).resolves.toBe(ROLE_ID);

    expect(withOwnerSupabaseMock.mock.calls[0]?.[0]).toBe(lease);
    expect(rpc).toHaveBeenCalledWith("save_own_role_with_default_actions", {
      p_role_title: " Building Manager ",
      p_company_name: "Example Co",
      p_location: null,
      p_match_percentage: 91,
      p_job_url: null,
      p_source_label: null,
      p_contact_email: null,
      p_contact_source_status: "official",
    });
  });

  it.each([
    ["database error", { data: null, error: new Error("save failed") }],
    ["missing identifier", { data: null, error: null }],
    ["malformed identifier", { data: "not-a-uuid", error: null }],
  ])("rejects an unconfirmed save result: %s", async (_label, result) => {
    installClient({ rpc: vi.fn().mockResolvedValue(result) });

    await expect(saveRole({ userId: USER_ID, roleTitle: "Builder" }, testOwnerDispatchLease(USER_ID)))
      .rejects.toThrow();
  });

  it("returns the exact authoritative inserted outcome and propagates insert errors", async () => {
    const row = {
      id: OUTCOME_ID,
      stage: "applied",
      note: "Submitted",
      occurred_at: "2026-09-02",
    };
    const single = vi.fn().mockResolvedValue({ data: row, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    installClient({ from: vi.fn(() => ({ insert })) });
    const lease = testOwnerDispatchLease(USER_ID);

    await expect(recordRoleOutcome({
      userId: USER_ID,
      savedRoleId: ROLE_ID,
      stage: "applied",
      note: " Submitted ",
      occurredAt: "2026-09-02",
    }, lease)).resolves.toEqual(row);
    expect(withOwnerSupabaseMock.mock.calls[0]?.[0]).toBe(lease);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: USER_ID,
      saved_role_id: ROLE_ID,
      note: "Submitted",
    }));

    single.mockResolvedValueOnce({ data: null, error: new Error("insert failed") });
    await expect(recordRoleOutcome({
      userId: USER_ID,
      savedRoleId: ROLE_ID,
      stage: "applied",
    }, lease)).rejects.toThrow("insert failed");
  });

  it("uses the exact lease for saved-role, outcome, and action reads", async () => {
    const lease = testOwnerDispatchLease(USER_ID);
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    installClient({ from: vi.fn(() => ({ select })) });

    await expect(fetchSavedRoles(USER_ID, lease)).resolves.toEqual([]);
    await expect(fetchRoleOutcomes(ROLE_ID, lease)).resolves.toEqual([]);
    await expect(fetchActionItems(ROLE_ID, lease)).resolves.toEqual([]);

    expect(withOwnerSupabaseMock.mock.calls).toHaveLength(3);
    for (const [actualLease] of withOwnerSupabaseMock.mock.calls) {
      expect(actualLease).toBe(lease);
    }
  });

  it("propagates read failures instead of presenting empty authoritative state", async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: new Error("read failed") });
    installClient({
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ order })) })),
      })),
    });
    const lease = testOwnerDispatchLease(USER_ID);

    await expect(fetchSavedRoles(USER_ID, lease)).rejects.toThrow("read failed");
    await expect(fetchRoleOutcomes(ROLE_ID, lease)).rejects.toThrow("read failed");
    await expect(fetchActionItems(ROLE_ID, lease)).rejects.toThrow("read failed");
  });

  it.each([
    ["committed", 1],
    ["revision_conflict", 0],
  ] as const)("validates an authoritative %s action-item receipt", async (status, affectedRows) => {
    const rpc = vi.fn().mockResolvedValue({
      data: { status, affected_rows: affectedRows, item: actionItem },
      error: null,
    });
    installClient({ rpc });
    const lease = testOwnerDispatchLease(USER_ID);

    await expect(setActionItemStatus({
      id: ITEM_ID,
      expectedMutationToken: TOKEN_1,
      status: "done",
    }, lease)).resolves.toEqual({ status, affectedRows, item: actionItem });
    expect(withOwnerSupabaseMock.mock.calls[0]?.[0]).toBe(lease);
    expect(rpc).toHaveBeenCalledWith("update_own_role_action_item", {
      p_item_id: ITEM_ID,
      p_expected_mutation_token: TOKEN_1,
      p_status: "done",
    });
  });

  it.each([
    ["zero-row success", { status: "committed", affected_rows: 0, item: actionItem }],
    ["unchanged token", {
      status: "committed",
      affected_rows: 1,
      item: { ...actionItem, mutation_token: TOKEN_1 },
    }],
    ["wrong requested status", {
      status: "committed",
      affected_rows: 1,
      item: { ...actionItem, status: "pending" },
    }],
    ["partial row", {
      status: "revision_conflict",
      affected_rows: 0,
      item: { id: ITEM_ID, mutation_token: TOKEN_2 },
    }],
  ])("rejects a malformed action-item receipt: %s", async (_label, data) => {
    installClient({ rpc: vi.fn().mockResolvedValue({ data, error: null }) });

    await expect(setActionItemStatus({
      id: ITEM_ID,
      expectedMutationToken: TOKEN_1,
      status: "done",
    }, testOwnerDispatchLease(USER_ID))).rejects.toThrow("ROLE_ACTION_STATUS_INVALID");
  });
});
