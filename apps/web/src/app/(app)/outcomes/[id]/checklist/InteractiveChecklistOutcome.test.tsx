import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";

const USER_ID = "e1000000-0000-4000-8000-000000000001";
const OUTCOME_ID = "e2000000-0000-4000-8000-000000000001";

const mocks = vi.hoisted(() => ({
  fetchOutcome: vi.fn(),
  fetchArtifactByOutcome: vi.fn(),
  withOwnerSupabase: vi.fn(),
  generateArtifactStream: vi.fn(),
  generateChecklist: vi.fn(),
  createOrReplayArtifact: vi.fn(),
  replaceOwnChecklist: vi.fn(),
}));

vi.mock("@/components/providers", () => ({
  useAuth: () => ({ user: { id: USER_ID }, loading: false }),
}));
vi.mock("@/components/organisms/ArtifactActionScreen", () => ({
  ArtifactActionScreen: () => <div>Loaded plan</div>,
}));
vi.mock("@/components/organisms/AlternateFormats", () => ({
  AlternateFormats: () => null,
}));
vi.mock("@/lib/api/outcomes", () => ({
  fetchOutcome: mocks.fetchOutcome,
  updateOutcome: vi.fn(),
}));
vi.mock("@/lib/api/artifacts", () => ({
  fetchArtifactByOutcome: mocks.fetchArtifactByOutcome,
  createOrReplayArtifact: mocks.createOrReplayArtifact,
}));
vi.mock("@/lib/api/checklists", () => ({
  replaceOwnChecklist: mocks.replaceOwnChecklist,
}));
vi.mock("@/lib/supabase/owner-client", () => ({
  withOwnerSupabase: mocks.withOwnerSupabase,
}));
vi.mock("@prompted/shared/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prompted/shared/api-client")>();
  return {
    ...actual,
    generateArtifactStream: mocks.generateArtifactStream,
    generateChecklist: mocks.generateChecklist,
  };
});
vi.mock("@/lib/local-checklist-store", () => ({
  isLocalChecklistSaved: () => false,
  loadLocalChecklist: () => [],
  markLocalChecklistSaved: vi.fn(),
  saveLocalChecklist: vi.fn(),
}));
vi.mock("@/lib/owner-bound-device-store", () => ({
  currentDeviceDataScope: () => ({ kind: "user", userId: USER_ID }),
}));
vi.mock("@/lib/workspace-store", () => ({
  currentWorkspaceCacheScope: () => ({ kind: "user", userId: USER_ID }),
  deterministicGenerationEntityId: vi.fn(),
  loadPendingOutcome: vi.fn(),
  resolveGenerationRequestIdentity: vi.fn().mockResolvedValue("request-id"),
}));
vi.mock("@/lib/api", () => ({ ensureApiConfigured: vi.fn() }));

import { InteractiveChecklistOutcome } from "./InteractiveChecklistOutcome";

function savedOutcome() {
  return {
    id: OUTCOME_ID,
    user_id: USER_ID,
    situation_text: "Prepare an action plan",
    recommendation_payload: {
      primary: { template_id: "action-plan", reason: "Action plan" },
      alternatives: [],
    },
    is_saved: false,
    updated_at: "2026-09-02T04:00:00.000Z",
  };
}

describe("InteractiveChecklistOutcome authoritative preparation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordBrowserPrincipal(USER_ID);
    mocks.fetchOutcome.mockResolvedValue(savedOutcome());
    mocks.fetchArtifactByOutcome.mockResolvedValue(null);
    mocks.withOwnerSupabase.mockResolvedValue({ count: 1, error: null });
  });

  afterEach(() => recordBrowserPrincipal(undefined));

  it("fails closed when the outcome read fails and retries before rendering the plan", async () => {
    mocks.fetchOutcome.mockRejectedValueOnce(new Error("database unavailable"));
    mocks.fetchArtifactByOutcome.mockResolvedValueOnce({
      id: "e3000000-0000-4000-8000-000000000001",
      kind: "action_plan",
    });

    render(<InteractiveChecklistOutcome outcomeId={OUTCOME_ID} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t load this plan/i);
    expect(screen.queryByText("Loaded plan")).toBeNull();
    expect(mocks.fetchOutcome).toHaveBeenCalledTimes(1);
    expect(mocks.generateArtifactStream).not.toHaveBeenCalled();
    expect(mocks.generateChecklist).not.toHaveBeenCalled();
    expect(mocks.createOrReplayArtifact).not.toHaveBeenCalled();
    expect(mocks.replaceOwnChecklist).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));
    expect(await screen.findByText("Loaded plan")).toBeDefined();
    expect(mocks.fetchOutcome).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["query error", { count: null, error: new Error("count failed") }],
    ["malformed null count", { count: null, error: null }],
  ])("does not generate after a %s", async (_label, countResult) => {
    mocks.withOwnerSupabase.mockResolvedValue(countResult);

    render(<InteractiveChecklistOutcome outcomeId={OUTCOME_ID} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t load this plan/i);
    expect(mocks.generateArtifactStream).not.toHaveBeenCalled();
    expect(mocks.generateChecklist).not.toHaveBeenCalled();
    expect(mocks.createOrReplayArtifact).not.toHaveBeenCalled();
    expect(mocks.replaceOwnChecklist).not.toHaveBeenCalled();
  });
});
