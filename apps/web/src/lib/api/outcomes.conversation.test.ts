import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Outcome } from "@prompted/shared/browser";
import { testOwnerDispatchLease } from "@/test/owner-dispatch-lease";

const withOwnerSupabaseMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/owner-client", () => ({
  withOwnerSupabase: withOwnerSupabaseMock,
}));

import { fetchOutcome, saveOutcomeConversation } from "./outcomes";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OUTCOME_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = `conversation-${"a".repeat(64)}`;
const UPDATED_AT = "2026-09-02T01:02:03.000Z";

function outcome(overrides: Partial<Outcome> = {}): Outcome {
  return {
    id: OUTCOME_ID,
    user_id: USER_ID,
    business_id: null,
    bundle_id: null,
    situation_text: "Prepare an accurate proposal",
    recommendation_payload: {
      primary: { template_id: "business-proposal", reason: "Best fit" },
      alternatives: [],
    },
    status: "in_progress",
    is_saved: false,
    conversation_revision: 3,
    created_at: UPDATED_AT,
    updated_at: UPDATED_AT,
    ...overrides,
  };
}

describe("outcome conversation persistence", () => {
  beforeEach(() => {
    withOwnerSupabaseMock.mockReset();
  });

  it("sends one owner-scoped CAS command and accepts only its exact receipt", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        contract_version: "outcome-conversation-save.1",
        state: "committed",
        request_id: REQUEST_ID,
        outcome_id: OUTCOME_ID,
        user_id: USER_ID,
        accepted_conversation_revision: 3,
        conversation_revision: 4,
        conversation_sha256: "b".repeat(64),
        updated_at: UPDATED_AT,
        idempotent_replay: false,
      },
      error: null,
    });
    withOwnerSupabaseMock.mockImplementation(async (_lease, operation) =>
      operation({ rpc }),
    );

    const receipt = await saveOutcomeConversation(
      {
        outcomeId: OUTCOME_ID,
        expectedConversationRevision: 3,
        requestId: REQUEST_ID,
        conversation: [
          { role: "user", text: "Use the retained facts." },
          { role: "ted", text: "I will preserve the source record." },
        ],
      },
      testOwnerDispatchLease(USER_ID),
    );

    expect(rpc).toHaveBeenCalledWith("save_own_outcome_conversation", {
      p_outcome_id: OUTCOME_ID,
      p_expected_conversation_revision: 3,
      p_request_id: REQUEST_ID,
      p_conversation: [
        { role: "user", text: "Use the retained facts." },
        { role: "ted", text: "I will preserve the source record." },
      ],
    });
    expect(receipt).toEqual({
      state: "committed",
      requestId: REQUEST_ID,
      outcomeId: OUTCOME_ID,
      userId: USER_ID,
      acceptedConversationRevision: 3,
      conversationRevision: 4,
      conversationSha256: "b".repeat(64),
      updatedAt: UPDATED_AT,
      idempotentReplay: false,
    });
  });

  it("accepts a strict superseded replay envelope without presenting it as a save", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        contract_version: "outcome-conversation-save.1",
        state: "superseded",
        request_id: REQUEST_ID,
        outcome_id: OUTCOME_ID,
        user_id: USER_ID,
        accepted_conversation_revision: 3,
        committed_conversation_revision: 4,
        conversation_revision: 5,
        conversation_sha256: "b".repeat(64),
        updated_at: UPDATED_AT,
        idempotent_replay: true,
        retryable: false,
        safe_next_action: "reload",
      },
      error: null,
    });
    withOwnerSupabaseMock.mockImplementation(async (_lease, operation) =>
      operation({ rpc }),
    );

    await expect(
      saveOutcomeConversation(
        {
          outcomeId: OUTCOME_ID,
          expectedConversationRevision: 3,
          requestId: REQUEST_ID,
          conversation: [{ role: "user", text: "Keep this exact request." }],
        },
        testOwnerDispatchLease(USER_ID),
      ),
    ).resolves.toMatchObject({
      state: "superseded",
      acceptedConversationRevision: 3,
      committedConversationRevision: 4,
      conversationRevision: 5,
      idempotentReplay: true,
      retryable: false,
      safeNextAction: "reload",
    });
  });

  it.each([
    ["wrong owner", { user_id: "33333333-3333-4333-8333-333333333333" }],
    ["wrong accepted revision", { accepted_conversation_revision: 2 }],
    ["non-monotonic committed revision", { conversation_revision: 3 }],
    ["invalid digest", { conversation_sha256: "not-a-digest" }],
    ["invalid timestamp", { updated_at: 42 }],
  ])("rejects a malformed %s receipt", async (_label, replacement) => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        contract_version: "outcome-conversation-save.1",
        state: "committed",
        request_id: REQUEST_ID,
        outcome_id: OUTCOME_ID,
        user_id: USER_ID,
        accepted_conversation_revision: 3,
        conversation_revision: 4,
        conversation_sha256: "b".repeat(64),
        updated_at: UPDATED_AT,
        idempotent_replay: false,
        ...replacement,
      },
      error: null,
    });
    withOwnerSupabaseMock.mockImplementation(async (_lease, operation) =>
      operation({ rpc }),
    );

    await expect(
      saveOutcomeConversation(
        {
          outcomeId: OUTCOME_ID,
          expectedConversationRevision: 3,
          requestId: REQUEST_ID,
          conversation: [{ role: "user", text: "Keep this." }],
        },
        testOwnerDispatchLease(USER_ID),
      ),
    ).rejects.toThrow("OUTCOME_CONVERSATION_RECEIPT_INVALID");
  });

  it("rejects a fetched row that does not belong to the captured owner", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: outcome({ user_id: "33333333-3333-4333-8333-333333333333" }),
      error: null,
    });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    withOwnerSupabaseMock.mockImplementation(async (_lease, operation) =>
      operation({ from: vi.fn(() => ({ select })) }),
    );

    await expect(
      fetchOutcome(OUTCOME_ID, testOwnerDispatchLease(USER_ID)),
    ).rejects.toThrow("OUTCOME_READ_INVALID");
  });

  it("rejects a conversation whose aggregate encoded body exceeds the server boundary", async () => {
    const rpc = vi.fn();
    withOwnerSupabaseMock.mockImplementation(async (_lease, operation) =>
      operation({ rpc }),
    );

    await expect(
      saveOutcomeConversation(
        {
          outcomeId: OUTCOME_ID,
          expectedConversationRevision: 3,
          requestId: REQUEST_ID,
          conversation: Array.from({ length: 14 }, (_, index) => ({
            role: index % 2 === 0 ? ("user" as const) : ("ted" as const),
            text: "x".repeat(19_000),
          })),
        },
        testOwnerDispatchLease(USER_ID),
      ),
    ).rejects.toThrow("OUTCOME_CONVERSATION_INPUT_INVALID");
    expect(rpc).not.toHaveBeenCalled();
  });
});
