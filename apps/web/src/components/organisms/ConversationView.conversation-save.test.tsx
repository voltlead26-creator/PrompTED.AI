import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";

const mocks = vi.hoisted(() => ({
  user: { id: "a1000000-0000-4000-8000-000000000001" },
  showToast: vi.fn(),
  fetchOutcome: vi.fn(),
  fetchArtifactByOutcome: vi.fn(),
  saveOutcomeConversation: vi.fn(),
  updateOutcome: vi.fn(),
  resolveGenerationRequestIdentity: vi.fn(),
  loadConversationSaveCommand: vi.fn(),
  persistConversationSaveCommand: vi.fn(),
  clearConversationSaveCommand: vi.fn(),
  withOwnerSupabase: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/providers", () => ({
  useAuth: () => ({
    user: mocks.user,
    loading: false,
  }),
}));
vi.mock("@/components/atoms/Toast", () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));
vi.mock("@/hooks/useOutcome", () => ({
  useOutcome: () => ({ confirm: vi.fn() }),
}));
vi.mock("@/lib/api/outcomes", () => ({
  fetchOutcome: mocks.fetchOutcome,
  saveOutcomeConversation: mocks.saveOutcomeConversation,
  updateOutcome: mocks.updateOutcome,
}));
vi.mock("@/lib/api/artifacts", () => ({
  fetchArtifactByOutcome: mocks.fetchArtifactByOutcome,
}));
vi.mock("@/lib/api/checklists", () => ({ replaceOwnChecklist: vi.fn() }));
vi.mock("@prompted/shared/api-client", () => ({ generateChecklist: vi.fn() }));
vi.mock("@/lib/supabase/owner-client", () => ({
  withOwnerSupabase: mocks.withOwnerSupabase,
}));
vi.mock("@/lib/local-checklist-store", () => ({
  loadLocalChecklist: () => [],
  saveLocalChecklist: vi.fn(),
}));
vi.mock("@/lib/owner-bound-device-store", () => ({
  currentDeviceDataScope: () => ({ ownerEpoch: "test" }),
}));
vi.mock("@/lib/outcome-conversation-save-spool", () => ({
  loadConversationSaveCommand: mocks.loadConversationSaveCommand,
  persistConversationSaveCommand: mocks.persistConversationSaveCommand,
  clearConversationSaveCommand: mocks.clearConversationSaveCommand,
}));
vi.mock("@/lib/workspace-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace-store")>();
  return {
    ...actual,
    resolveGenerationRequestIdentity: mocks.resolveGenerationRequestIdentity,
  };
});
vi.mock("@/app/(app)/home/HomeScreen", () => ({
  HomeScreen: ({ onMessagesChange }: {
    onMessagesChange?: (messages: Array<{ role: "user" | "ted"; text: string }>) => void;
  }) => (
    <div>
      {(["A", "B", "C"] as const).map((label) => (
        <button
          key={label}
          type="button"
          onClick={() => onMessagesChange?.([
            { role: "user", text: `Message ${label}` },
          ])}
        >
          Save {label}
        </button>
      ))}
    </div>
  ),
}));

import { ConversationView } from "./ConversationView";

const USER_ID = "a1000000-0000-4000-8000-000000000001";
const OUTCOME_ID = "a2000000-0000-4000-8000-000000000001";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function receipt(requestId: string, acceptedRevision: number) {
  return {
    state: "committed" as const,
    requestId,
    outcomeId: OUTCOME_ID,
    userId: USER_ID,
    acceptedConversationRevision: acceptedRevision,
    conversationRevision: acceptedRevision + 1,
    conversationSha256: "d".repeat(64),
    updatedAt: "2026-09-02T03:00:00.000Z",
    idempotentReplay: false,
  };
}

function supersededReceipt(requestId: string, acceptedRevision: number) {
  return {
    state: "superseded" as const,
    requestId,
    outcomeId: OUTCOME_ID,
    userId: USER_ID,
    acceptedConversationRevision: acceptedRevision,
    committedConversationRevision: acceptedRevision + 1,
    conversationRevision: acceptedRevision + 2,
    conversationSha256: "d".repeat(64),
    updatedAt: "2026-09-02T03:00:01.000Z",
    idempotentReplay: true,
    retryable: false,
    safeNextAction: "reload" as const,
  };
}

async function renderConversation(): Promise<void> {
  render(<ConversationView outcomeId={OUTCOME_ID} />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function releaseDebounce(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(800);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ConversationView durable conversation queue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    recordBrowserPrincipal(USER_ID);
    mocks.fetchOutcome.mockResolvedValue({
      id: OUTCOME_ID,
      user_id: USER_ID,
      situation_text: "Prepare a proposal",
      recommendation_payload: {
        primary: { template_id: "business-proposal", reason: "Best fit" },
        alternatives: [],
      },
      conversation_revision: 0,
    });
    mocks.fetchArtifactByOutcome.mockResolvedValue(null);
    mocks.withOwnerSupabase.mockResolvedValue({ count: 0, error: null });
    mocks.loadConversationSaveCommand.mockReturnValue(null);
    mocks.persistConversationSaveCommand.mockReturnValue(true);
    mocks.resolveGenerationRequestIdentity.mockImplementation(
      async (_scope, _outcomeId, _operation, input: {
        expectedConversationRevision: number;
        conversation: Array<{ text: string }>;
      }) => `conversation-${input.expectedConversationRevision}-${input.conversation.at(-1)?.text}`,
    );
  });

  afterEach(() => {
    recordBrowserPrincipal(undefined);
    vi.useRealTimers();
  });

  it("serialises saves and coalesces in-flight updates against server revisions", async () => {
    const first = deferred<ReturnType<typeof receipt>>();
    const second = deferred<ReturnType<typeof receipt>>();
    let inFlight = 0;
    let maximumInFlight = 0;
    mocks.saveOutcomeConversation
      .mockImplementationOnce(async () => {
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        try {
          return await first.promise;
        } finally {
          inFlight -= 1;
        }
      })
      .mockImplementationOnce(async () => {
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        try {
          return await second.promise;
        } finally {
          inFlight -= 1;
        }
      });

    await renderConversation();

    fireEvent.click(screen.getByRole("button", { name: "Save A" }));
    await releaseDebounce();
    expect(mocks.saveOutcomeConversation).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Save B" }));
    fireEvent.click(screen.getByRole("button", { name: "Save C" }));
    await releaseDebounce();
    expect(mocks.saveOutcomeConversation).toHaveBeenCalledTimes(1);

    const firstRequestId = mocks.saveOutcomeConversation.mock.calls[0]![0].requestId;
    await act(async () => {
      first.resolve(receipt(firstRequestId, 0));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.saveOutcomeConversation).toHaveBeenCalledTimes(2);
    expect(mocks.saveOutcomeConversation.mock.calls[1]![0]).toMatchObject({
      expectedConversationRevision: 1,
      conversation: [{ role: "user", text: "Message C" }],
    });
    expect(maximumInFlight).toBe(1);

    const secondRequestId = mocks.saveOutcomeConversation.mock.calls[1]![0].requestId;
    await act(async () => {
      second.resolve(receipt(secondRequestId, 1));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(maximumInFlight).toBe(1);
  });

  it("replays the exact request once when its acknowledgement transport is lost", async () => {
    mocks.saveOutcomeConversation
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockImplementationOnce(async (input) => receipt(input.requestId, 0));

    await renderConversation();
    fireEvent.click(screen.getByRole("button", { name: "Save A" }));
    await releaseDebounce();

    expect(mocks.saveOutcomeConversation).toHaveBeenCalledTimes(2);
    expect(mocks.saveOutcomeConversation.mock.calls[1]![0]).toEqual(
      mocks.saveOutcomeConversation.mock.calls[0]![0],
    );
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it("does not dispatch when the exact command cannot be durably staged on the device", async () => {
    mocks.persistConversationSaveCommand.mockReturnValue(false);

    await renderConversation();
    fireEvent.click(screen.getByRole("button", { name: "Save A" }));
    await releaseDebounce();

    expect(mocks.saveOutcomeConversation).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith({
      tone: "error",
      message:
        "TED couldn't safely stage this conversation save on your device. Your words remain on screen; check browser storage and retry.",
    });
  });

  it("replays a device-staged command after remount before accepting newer saves", async () => {
    let staged: Parameters<typeof mocks.persistConversationSaveCommand>[1] | null = null;
    mocks.persistConversationSaveCommand.mockImplementation((_scope, input) => {
      staged = input;
      return true;
    });
    mocks.saveOutcomeConversation
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const firstMount = render(<ConversationView outcomeId={OUTCOME_ID} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Save A" }));
    await releaseDebounce();
    expect(mocks.saveOutcomeConversation).toHaveBeenCalledTimes(2);
    const exactInput = mocks.saveOutcomeConversation.mock.calls[0]![0];
    expect(staged).toEqual(exactInput);
    firstMount.unmount();

    mocks.loadConversationSaveCommand.mockReturnValue(exactInput);
    mocks.saveOutcomeConversation.mockImplementationOnce(async (input) =>
      receipt(input.requestId, input.expectedConversationRevision),
    );
    await renderConversation();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.saveOutcomeConversation).toHaveBeenCalledTimes(3);
    expect(mocks.saveOutcomeConversation.mock.calls[2]![0]).toEqual(exactInput);
    expect(mocks.clearConversationSaveCommand).toHaveBeenCalledWith(
      expect.anything(),
      OUTCOME_ID,
    );
  });

  it("halts on a cross-tab revision conflict instead of rebasing local wording", async () => {
    mocks.saveOutcomeConversation.mockRejectedValue({
      code: "40001",
      message: "OUTCOME_CONVERSATION_REVISION_CONFLICT",
    });

    await renderConversation();
    fireEvent.click(screen.getByRole("button", { name: "Save A" }));
    await releaseDebounce();

    expect(mocks.saveOutcomeConversation).toHaveBeenCalledTimes(1);
    expect(mocks.showToast).toHaveBeenCalledWith({
      tone: "error",
      message:
        "This conversation changed elsewhere. Your latest words are still here, but reload before saving again.",
    });

    fireEvent.click(screen.getByRole("button", { name: "Save C" }));
    await releaseDebounce();
    expect(mocks.saveOutcomeConversation).toHaveBeenCalledTimes(1);
  });

  it("treats a superseded exact replay as a conflict and never dispatches queued wording", async () => {
    const first = deferred<ReturnType<typeof supersededReceipt>>();
    mocks.saveOutcomeConversation.mockImplementationOnce(() => first.promise);

    await renderConversation();
    fireEvent.click(screen.getByRole("button", { name: "Save A" }));
    await releaseDebounce();
    fireEvent.click(screen.getByRole("button", { name: "Save C" }));

    const firstRequestId = mocks.saveOutcomeConversation.mock.calls[0]![0].requestId;
    await act(async () => {
      first.resolve(supersededReceipt(firstRequestId, 0));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await releaseDebounce();

    expect(mocks.saveOutcomeConversation).toHaveBeenCalledTimes(1);
    expect(mocks.showToast).toHaveBeenCalledWith({
      tone: "error",
      message:
        "This conversation changed elsewhere. Your latest words are still here, but reload before saving again.",
    });
  });

  it("drops an in-flight response and queued text across an A to B to A owner transition", async () => {
    const first = deferred<ReturnType<typeof receipt>>();
    mocks.saveOutcomeConversation.mockImplementationOnce(() => first.promise);

    await renderConversation();
    fireEvent.click(screen.getByRole("button", { name: "Save A" }));
    await releaseDebounce();
    fireEvent.click(screen.getByRole("button", { name: "Save C" }));

    recordBrowserPrincipal("b1000000-0000-4000-8000-000000000001");
    recordBrowserPrincipal(USER_ID);
    const firstRequestId = mocks.saveOutcomeConversation.mock.calls[0]![0].requestId;
    await act(async () => {
      first.resolve(receipt(firstRequestId, 0));
      await Promise.resolve();
      await Promise.resolve();
    });
    await releaseDebounce();

    expect(mocks.saveOutcomeConversation).toHaveBeenCalledTimes(1);
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it("blocks editing after an authoritative load failure and retries before mounting chat", async () => {
    mocks.fetchOutcome.mockRejectedValueOnce(new Error("database unavailable"));

    await renderConversation();

    expect(screen.getByRole("alert")).toHaveTextContent(/couldn.t load this conversation/i);
    expect(screen.queryByRole("button", { name: "Save A" })).toBeNull();
    expect(screen.getByRole("link", { name: /Back to outcome/i })).toHaveAttribute(
      "href",
      `/outcomes/${OUTCOME_ID}`,
    );

    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "Save A" })).toBeDefined();
  });
});
