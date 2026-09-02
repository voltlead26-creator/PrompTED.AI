import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({ createClient: createClientMock }));
vi.mock("@/lib/supabase/owner-client", () => ({
  withOwnerSupabase: vi.fn(async (_lease, operation) => operation(createClientMock())),
}));

import { updateOwnChecklistItem } from "./checklists";
import { testOwnerDispatchLease } from "@/test/owner-dispatch-lease";

const USER_ID = "b1000000-0000-4000-8000-000000000001";
const OUTCOME_ID = "b2000000-0000-4000-8000-000000000001";
const ITEM_ID = "b3000000-0000-4000-8000-000000000001";
const TOKEN_1 = "b4000000-0000-4000-8000-000000000001";
const TOKEN_2 = "b4000000-0000-4000-8000-000000000002";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ITEM_ID,
    outcome_id: OUTCOME_ID,
    user_id: USER_ID,
    text: "Authoritative task",
    due_date: null,
    reason: null,
    done: true,
    reminder_offset_days: null,
    reminder_sent: false,
    order_index: 0,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:01:00.000Z",
    mutation_token: TOKEN_2,
    ...overrides,
  };
}

describe("checklist item mutation API", () => {
  beforeEach(() => createClientMock.mockReset());

  it.each([
    ["committed", 1],
    ["revision_conflict", 0],
  ] as const)("validates the complete %s envelope", async (status, affectedRows) => {
    const rpc = vi.fn().mockResolvedValue({
      data: { status, affected_rows: affectedRows, item: row() },
      error: null,
    });
    createClientMock.mockReturnValue({ rpc });

    await expect(
      updateOwnChecklistItem(
        {
          itemId: ITEM_ID,
          outcomeId: OUTCOME_ID,
          expectedMutationToken: TOKEN_1,
          expectedUserId: USER_ID,
          done: true,
        },
        testOwnerDispatchLease(USER_ID),
      ),
    ).resolves.toMatchObject({ status, affectedRows, item: row() });
    expect(rpc).toHaveBeenCalledWith("update_own_checklist_item", {
      p_item_id: ITEM_ID,
      p_outcome_id: OUTCOME_ID,
      p_expected_mutation_token: TOKEN_1,
      p_done: true,
      p_text: null,
    });
  });

  it.each([
    ["foreign owner", row({ user_id: "b1000000-0000-4000-8000-000000000099" })],
    ["unchanged token", row({ mutation_token: TOKEN_1 })],
    ["wrong affected count", row()],
    ["partial row", { id: ITEM_ID, mutation_token: TOKEN_2 }],
  ])("rejects a malformed %s result", async (label, item) => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        status: label === "wrong affected count" ? "committed" : "revision_conflict",
        affected_rows: label === "wrong affected count" ? 0 : 0,
        item,
      },
      error: null,
    });
    createClientMock.mockReturnValue({ rpc });

    await expect(
      updateOwnChecklistItem(
        {
          itemId: ITEM_ID,
          outcomeId: OUTCOME_ID,
          expectedMutationToken: TOKEN_1,
          expectedUserId: USER_ID,
          text: "Changed",
        },
        testOwnerDispatchLease(USER_ID),
      ),
    ).rejects.toThrow("CHECKLIST_ITEM_MUTATION_INVALID");
  });
});
