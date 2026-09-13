import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordBrowserPrincipal, type OwnerDispatchLease } from "@/lib/browser-principal-state";
import { ApiError } from "@prompted/shared/api-client";

const USER_ID = "e1000000-0000-4000-8000-000000000001";
const OUTCOME_ID = "e2000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "e1000000-0000-4000-8000-000000000002";
const OTHER_OUTCOME_ID = "e2000000-0000-4000-8000-000000000002";
const MONTHLY_LIMIT_MESSAGE =
  "You've reached your document limit for this month. New allowance becomes available next month.";
const UNCONFIRMED_LIMIT_MESSAGE =
  "PrompTED could not confirm the document limit details. New generation is paused. You can still edit your existing wording.";

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  fetchOutcome: vi.fn(),
  fetchArtifactByOutcome: vi.fn(),
  withOwnerSupabase: vi.fn(),
  generateArtifactStream: vi.fn(),
  generateChecklist: vi.fn(),
  createOrReplayArtifact: vi.fn(),
  replaceOwnChecklist: vi.fn(),
}));

vi.mock("@/components/providers", () => ({
  useAuth: mocks.useAuth,
}));
vi.mock("@/components/organisms/ArtifactActionScreen", () => ({
  ArtifactActionScreen: ({ outcomeId }: { outcomeId: string }) => <div data-outcome-id={outcomeId}>Loaded plan</div>,
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
  currentWorkspaceCacheScope: (userId: string) => ({ kind: "user", userId }),
  deterministicGenerationEntityId: vi.fn().mockResolvedValue("e4000000-0000-4000-8000-000000000001"),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function monthlyLimitError(currentPlan = "business", message = MONTHLY_LIMIT_MESSAGE) {
  return new ApiError(402, "DOCUMENT_LIMIT_REACHED", {
    error: { code: "DOCUMENT_LIMIT_REACHED", message, paywall_trigger: false, current_plan: currentPlan },
  });
}

function rejectPreparationGeneration(path: "artifact" | "legacy checklist", error: ApiError) {
  mocks.withOwnerSupabase.mockResolvedValue({ count: 0, error: null });
  if (path === "artifact") mocks.generateArtifactStream.mockRejectedValue(error);
  else {
    mocks.generateArtifactStream.mockRejectedValue(new ApiError(404, "TED_V2_DISABLED", {}));
    mocks.generateChecklist.mockRejectedValue(error);
  }
}

describe("InteractiveChecklistOutcome authoritative preparation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordBrowserPrincipal(USER_ID);
    mocks.useAuth.mockReturnValue({ user: { id: USER_ID }, loading: false });
    mocks.fetchOutcome.mockReset();
    mocks.fetchOutcome.mockResolvedValue(savedOutcome());
    mocks.fetchArtifactByOutcome.mockReset();
    mocks.fetchArtifactByOutcome.mockResolvedValue(null);
    mocks.withOwnerSupabase.mockReset();
    mocks.withOwnerSupabase.mockResolvedValue({ count: 1, error: null });
    mocks.generateArtifactStream.mockReset();
    mocks.generateChecklist.mockReset();
    mocks.createOrReplayArtifact.mockReset();
    mocks.replaceOwnChecklist.mockReset();
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

  it.each([
    ["missing function", new ApiError(404, "NOT_FOUND", { message: "Function not found" })],
    ["unknown 404", new ApiError(404, "UNKNOWN", {})],
    ["mismatched status", new ApiError(503, "TED_V2_DISABLED", {})],
  ])("does not start a second generation after %s", async (_label, error) => {
    mocks.withOwnerSupabase.mockResolvedValue({ count: 0, error: null });
    mocks.generateArtifactStream.mockRejectedValue(error);
    mocks.generateChecklist.mockResolvedValue([]);
    render(<InteractiveChecklistOutcome outcomeId={OUTCOME_ID} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t load this plan/i);
    expect(mocks.generateArtifactStream).toHaveBeenCalledTimes(1);
    expect(mocks.generateChecklist).not.toHaveBeenCalled();
    expect(mocks.createOrReplayArtifact).not.toHaveBeenCalled();
    expect(mocks.replaceOwnChecklist).not.toHaveBeenCalled();
  });

  it.each([
    { path: "artifact" as const, plan: "business", message: MONTHLY_LIMIT_MESSAGE },
    { path: "legacy checklist" as const, plan: "business", message: MONTHLY_LIMIT_MESSAGE },
    { path: "artifact" as const, plan: "free", message: "You have used your 1,000 documents for this month. New allowance becomes available next month." },
    { path: "legacy checklist" as const, plan: "free", message: "You have used your 1,000 documents for this month. New allowance becomes available next month." },
  ])("shows the $plan monthly cap from $path without retrying generation", async ({ path, plan, message }) => {
    rejectPreparationGeneration(path, monthlyLimitError(plan, message));
    const { rerender } = render(<InteractiveChecklistOutcome outcomeId={OUTCOME_ID} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(MONTHLY_LIMIT_MESSAGE);
    expect(screen.getByRole("heading", { name: "Monthly document limit reached" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Retry$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /upgrade|view plans|update subscription/i })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to conversation" })).toHaveAttribute("href", `/outcomes/${OUTCOME_ID}/conversation`);
    expect(screen.queryByText("Loaded plan")).toBeNull();
    rerender(<InteractiveChecklistOutcome outcomeId={OUTCOME_ID} />);
    await act(async () => { await Promise.resolve(); });
    expect(mocks.generateArtifactStream).toHaveBeenCalledTimes(1);
    expect(mocks.generateChecklist).toHaveBeenCalledTimes(path === "artifact" ? 0 : 1);
    expect(mocks.createOrReplayArtifact).not.toHaveBeenCalled();
    expect(mocks.replaceOwnChecklist).not.toHaveBeenCalled();
  });

  it.each([
    { path: "artifact" as const, detail: null },
    { path: "legacy checklist" as const, detail: null },
    { path: "artifact" as const, detail: { code: "DOCUMENT_LIMIT_REACHED", message: "Private diagnostic; upgrade at synthetic-untrusted.example", paywall_trigger: false, current_plan: "business", plan_required: "business" } },
    { path: "legacy checklist" as const, detail: { code: "DOCUMENT_LIMIT_REACHED", message: "Private diagnostic; upgrade at synthetic-untrusted.example", paywall_trigger: false, current_plan: "business", plan_required: "business" } },
  ])("blocks malformed known-cap details from $path without inventing a reset or upgrade", async ({ path, detail }) => {
    rejectPreparationGeneration(path, new ApiError(402, "DOCUMENT_LIMIT_REACHED", { error: detail }));
    render(<InteractiveChecklistOutcome outcomeId={OUTCOME_ID} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(UNCONFIRMED_LIMIT_MESSAGE);
    expect(screen.getByRole("heading", { name: "Document generation paused" })).toBeVisible();
    expect(screen.queryByText(/next month|private diagnostic|synthetic-untrusted/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Retry$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /upgrade|view plans|update subscription/i })).toBeNull();
    expect(mocks.generateArtifactStream).toHaveBeenCalledTimes(1);
    expect(mocks.generateChecklist).toHaveBeenCalledTimes(path === "artifact" ? 0 : 1);
    expect(mocks.createOrReplayArtifact).not.toHaveBeenCalled();
    expect(mocks.replaceOwnChecklist).not.toHaveBeenCalled();
  });

  it("does not dispatch again through a Retry control retained before the cap response", async () => {
    mocks.fetchOutcome.mockRejectedValueOnce(new Error("Read unavailable"));
    rejectPreparationGeneration("artifact", monthlyLimitError());
    const { rerender } = render(<InteractiveChecklistOutcome outcomeId={OUTCOME_ID} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t load this plan/i);
    const retryBeforeCap = screen.getByRole("button", { name: /^Retry$/i });
    fireEvent.click(retryBeforeCap);
    expect(await screen.findByRole("alert")).toHaveTextContent(MONTHLY_LIMIT_MESSAGE);
    expect(screen.queryByRole("button", { name: /^Retry$/i })).toBeNull();
    fireEvent.click(retryBeforeCap);
    fireEvent.click(retryBeforeCap);
    rerender(<InteractiveChecklistOutcome outcomeId={OUTCOME_ID} />);
    await act(async () => { await Promise.resolve(); });
    expect(mocks.fetchOutcome).toHaveBeenCalledTimes(2);
    expect(mocks.generateArtifactStream).toHaveBeenCalledTimes(1);
    expect(mocks.generateChecklist).not.toHaveBeenCalled();
    expect(mocks.createOrReplayArtifact).not.toHaveBeenCalled();
    expect(mocks.replaceOwnChecklist).not.toHaveBeenCalled();
  });

  it.each(["artifact", "legacy rows"])("opens existing %s without starting generation", async (stored) => {
    if (stored === "artifact") mocks.fetchArtifactByOutcome.mockResolvedValue({
      id: "e3000000-0000-4000-8000-000000000001", outcome_id: OUTCOME_ID, user_id: USER_ID, kind: "action_plan",
    });
    render(<InteractiveChecklistOutcome outcomeId={OUTCOME_ID} />);
    expect(await screen.findByText("Loaded plan")).toHaveAttribute("data-outcome-id", OUTCOME_ID);
    expect(mocks.generateArtifactStream).not.toHaveBeenCalled();
    expect(mocks.generateChecklist).not.toHaveBeenCalled();
    expect(mocks.createOrReplayArtifact).not.toHaveBeenCalled();
    expect(mocks.replaceOwnChecklist).not.toHaveBeenCalled();
    expect(mocks.withOwnerSupabase).toHaveBeenCalledTimes(stored === "artifact" ? 0 : 1);
  });

  it("clears the previous cap notice when opening a different saved plan", async () => {
    rejectPreparationGeneration("artifact", monthlyLimitError());
    const { rerender } = render(<InteractiveChecklistOutcome outcomeId={OUTCOME_ID} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(MONTHLY_LIMIT_MESSAGE);
    mocks.fetchOutcome.mockResolvedValue({ ...savedOutcome(), id: OTHER_OUTCOME_ID });
    mocks.fetchArtifactByOutcome.mockResolvedValue({
      id: "e3000000-0000-4000-8000-000000000002", outcome_id: OTHER_OUTCOME_ID, user_id: USER_ID, kind: "action_plan",
    });
    rerender(<InteractiveChecklistOutcome outcomeId={OTHER_OUTCOME_ID} />);
    expect(await screen.findByText("Loaded plan")).toHaveAttribute("data-outcome-id", OTHER_OUTCOME_ID);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.generateArtifactStream).toHaveBeenCalledTimes(1);
    expect(mocks.generateChecklist).not.toHaveBeenCalled();
  });

  it.each([
    { path: "artifact" as const, change: "outcome" },
    { path: "legacy checklist" as const, change: "outcome" },
    { path: "artifact" as const, change: "owner" },
    { path: "legacy checklist" as const, change: "owner" },
    { path: "artifact" as const, change: "principal A-B-A" },
    { path: "legacy checklist" as const, change: "principal A-B-A" },
    { path: "artifact" as const, change: "unmount" },
    { path: "legacy checklist" as const, change: "unmount" },
  ])("ignores a late $path cap after $change", async ({ path, change }) => {
    const generation = deferred<never>();
    mocks.withOwnerSupabase.mockResolvedValue({ count: 0, error: null });
    if (path === "artifact") mocks.generateArtifactStream.mockReturnValue(generation.promise);
    else {
      mocks.generateArtifactStream.mockRejectedValue(new ApiError(404, "TED_V2_DISABLED", {}));
      mocks.generateChecklist.mockReturnValue(generation.promise);
    }
    const { rerender, unmount } = render(<InteractiveChecklistOutcome outcomeId={OUTCOME_ID} />);
    const generator = path === "artifact" ? mocks.generateArtifactStream : mocks.generateChecklist;
    await waitFor(() => expect(generator).toHaveBeenCalledTimes(1));
    const lease = generator.mock.calls[0]?.[path === "artifact" ? 2 : 1] as OwnerDispatchLease;
    expect(lease.expectedUserId).toBe(USER_ID);

    if (change === "unmount") unmount();
    else if (change === "principal A-B-A") {
      recordBrowserPrincipal(OTHER_USER_ID);
      recordBrowserPrincipal(USER_ID);
    } else {
      const nextUserId = change === "owner" ? OTHER_USER_ID : USER_ID;
      if (change === "owner") {
        recordBrowserPrincipal(nextUserId);
        mocks.useAuth.mockReturnValue({ user: { id: nextUserId }, loading: false });
      }
      mocks.fetchOutcome.mockResolvedValue({ ...savedOutcome(), id: OTHER_OUTCOME_ID, user_id: nextUserId });
      mocks.fetchArtifactByOutcome.mockResolvedValue({
        id: "e3000000-0000-4000-8000-000000000002", outcome_id: OTHER_OUTCOME_ID, user_id: nextUserId, kind: "action_plan",
      });
      rerender(<InteractiveChecklistOutcome outcomeId={OTHER_OUTCOME_ID} />);
      expect(await screen.findByText("Loaded plan")).toHaveAttribute("data-outcome-id", OTHER_OUTCOME_ID);
    }
    expect(lease.signal.aborted).toBe(true);
    await act(async () => {
      generation.reject(monthlyLimitError());
      await generation.promise.catch(() => undefined);
    });
    expect(screen.queryByText(MONTHLY_LIMIT_MESSAGE)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    if (change === "outcome" || change === "owner") {
      expect(screen.getByText("Loaded plan")).toHaveAttribute("data-outcome-id", OTHER_OUTCOME_ID);
    }
    expect(mocks.generateArtifactStream).toHaveBeenCalledTimes(1);
    expect(mocks.generateChecklist).toHaveBeenCalledTimes(path === "artifact" ? 0 : 1);
    expect(mocks.createOrReplayArtifact).not.toHaveBeenCalled();
    expect(mocks.replaceOwnChecklist).not.toHaveBeenCalled();
  });

  it("keeps the existing genuine PAYWALL failure separate from a monthly-cap notice", async () => {
    rejectPreparationGeneration("artifact", new ApiError(402, "PAYWALL", {
      error: { code: "PAYWALL", paywall_trigger: true, current_plan: "premium", plan_required: "business" },
    }));
    render(<InteractiveChecklistOutcome outcomeId={OUTCOME_ID} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t load this plan/i);
    expect(screen.getByRole("button", { name: /^Retry$/i })).toBeVisible();
    expect(screen.queryByText(/next month|document generation paused/i)).toBeNull();
    expect(mocks.generateChecklist).not.toHaveBeenCalled();
    expect(mocks.createOrReplayArtifact).not.toHaveBeenCalled();
    expect(mocks.replaceOwnChecklist).not.toHaveBeenCalled();
  });

  it("does not fall back or persist after artifact settlement uncertainty", async () => {
    rejectPreparationGeneration("artifact", new ApiError(409, "GENERATION_RECONCILIATION_REQUIRED", {}));
    render(<InteractiveChecklistOutcome outcomeId={OUTCOME_ID} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t load this plan/i);
    expect(mocks.generateArtifactStream).toHaveBeenCalledTimes(1);
    expect(mocks.generateChecklist).not.toHaveBeenCalled();
    expect(mocks.createOrReplayArtifact).not.toHaveBeenCalled();
    expect(mocks.replaceOwnChecklist).not.toHaveBeenCalled();
  });

  it("retains the explicit disabled-cohort legacy path and awaits its persistence", async () => {
    mocks.withOwnerSupabase.mockResolvedValue({ count: 0, error: null });
    mocks.generateArtifactStream.mockRejectedValue(new ApiError(404, "TED_V2_DISABLED", {}));
    mocks.generateChecklist.mockResolvedValue([{ text: "Confirm the moving date", section: "Plan" }]);
    let acknowledge: () => void = () => {};
    mocks.replaceOwnChecklist.mockReturnValue(new Promise<void>((resolve) => { acknowledge = resolve; }));
    render(<InteractiveChecklistOutcome outcomeId={OUTCOME_ID} />);
    await waitFor(() => expect(mocks.replaceOwnChecklist).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Loaded plan")).toBeNull();
    acknowledge();
    expect(await screen.findByText("Loaded plan")).toBeDefined();
    expect(mocks.generateArtifactStream).toHaveBeenCalledTimes(1);
    expect(mocks.generateChecklist).toHaveBeenCalledTimes(1);
    expect(mocks.replaceOwnChecklist).toHaveBeenCalledWith(expect.objectContaining({
      outcomeId: OUTCOME_ID,
      requestId: "request-id",
      expectedOutcomeUpdatedAt: savedOutcome().updated_at,
      items: [expect.objectContaining({
        id: "e4000000-0000-4000-8000-000000000001",
        text: "Plan␟Confirm the moving date",
      })],
    }), expect.objectContaining({ expectedUserId: USER_ID }));
  });
});
