import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  fetchOutcome: vi.fn(),
  fetchArtifactByOutcome: vi.fn(),
  generateChecklist: vi.fn(),
  replaceOwnChecklist: vi.fn(),
  withOwnerSupabase: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("@/components/providers", () => ({
  useAuth: () => ({
    user: { id: "d1000000-0000-4000-8000-000000000001" },
    loading: false,
  }),
}));
vi.mock("@/components/atoms/Toast", () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));
vi.mock("@/hooks/useOutcome", () => ({
  useOutcome: () => ({ confirm: vi.fn() }),
}));
vi.mock("@/lib/api/outcomes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/outcomes")>();
  return {
    ...actual,
    fetchOutcome: mocks.fetchOutcome,
    saveOutcomeConversation: vi.fn(),
    updateOutcome: vi.fn(),
  };
});
vi.mock("@/lib/api/artifacts", () => ({
  fetchArtifactByOutcome: mocks.fetchArtifactByOutcome,
}));
vi.mock("@/lib/api/checklists", () => ({
  replaceOwnChecklist: mocks.replaceOwnChecklist,
}));
vi.mock("@prompted/shared/api-client", () => ({
  generateChecklist: mocks.generateChecklist,
}));
vi.mock("@/lib/supabase/owner-client", () => ({
  withOwnerSupabase: mocks.withOwnerSupabase,
}));
vi.mock("@/lib/local-checklist-store", () => ({
  loadLocalChecklist: () => [],
  saveLocalChecklist: vi.fn(),
}));
vi.mock("@/lib/owner-bound-device-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/owner-bound-device-store")>();
  return {
    ...actual,
    currentDeviceDataScope: () => ({
      kind: "user" as const,
      userId: "d1000000-0000-4000-8000-000000000001",
    }),
  };
});
vi.mock("@/app/(app)/home/HomeScreen", () => ({
  HomeScreen: ({ onConfirm }: {
    onConfirm?: (item: { name: string }, situation: string) => Promise<void>;
  }) => (
    <button
      type="button"
      onClick={() => void onConfirm?.({ name: "Action plan" }, "Updated facts")}
    >
      Refine saved plan
    </button>
  ),
}));

import { ConversationView } from "./ConversationView";

const USER_ID = "d1000000-0000-4000-8000-000000000001";
const OUTCOME_ID = "d2000000-0000-4000-8000-000000000001";

describe("ConversationView saved-artifact refinement boundary", () => {
  beforeEach(() => {
    recordBrowserPrincipal(USER_ID);
    vi.clearAllMocks();
    mocks.fetchOutcome.mockResolvedValue({
      id: OUTCOME_ID,
      situation_text: "Original facts",
      recommendation_payload: {
        primary: { template_id: "action-plan", reason: "Action plan" },
        alternatives: [],
        conversation: [{ role: "user", text: "Please update my plan" }],
      },
    });
    mocks.fetchArtifactByOutcome.mockResolvedValue({
      id: "d3000000-0000-4000-8000-000000000001",
      outcome_id: OUTCOME_ID,
      kind: "action_plan",
      template_id: "action-plan",
      blocks: [],
    });
    mocks.withOwnerSupabase.mockResolvedValue({ count: 0, error: null });
  });

  afterEach(() => recordBrowserPrincipal(undefined));

  it("stops before provider work when a saved artifact lacks atomic replacement", async () => {
    render(<ConversationView outcomeId={OUTCOME_ID} />);
    const refine = await screen.findByRole("button", { name: "Refine saved plan" });
    fireEvent.click(refine);

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith({
      tone: "error",
      message: "TED can't safely replace this saved plan yet. Your current plan is unchanged; edit individual steps instead.",
    }));
    expect(mocks.fetchArtifactByOutcome).toHaveBeenCalled();
    expect(mocks.generateChecklist).not.toHaveBeenCalled();
    expect(mocks.replaceOwnChecklist).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
