import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import type { WorkspaceInitialState } from "@/lib/workspace-initial-state";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";

const mocks = vi.hoisted(() => ({
  capturedAdmission: vi.fn(),
  ensureApiConfigured: vi.fn(),
  attachOutcomeUpload: vi.fn(),
  ingestUpload: vi.fn(),
  loadPendingOutcome: vi.fn(),
  loadWorkspace: vi.fn(),
  refresh: vi.fn(),
  savePendingOutcome: vi.fn(),
  useExport: vi.fn(),
  useWorkspace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@prompted/shared/api-client", () => ({
  ingestUpload: mocks.ingestUpload,
}));
vi.mock("@/components/organisms/CapturedAdmission", () => ({
  CapturedAdmission: ({
    initialOperation,
    templateId,
  }: {
    initialOperation?: { operation_id: string; status: string };
    templateId: string;
  }) => {
    mocks.capturedAdmission({ initialOperation, templateId });
    return (
      <section data-testid="captured-operation-recovery">
        {templateId}:
        {initialOperation ? `${initialOperation.operation_id}:${initialOperation.status}` : "new"}
      </section>
    );
  },
}));
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: (...args: unknown[]) => mocks.useWorkspace(...args),
}));
vi.mock("@/hooks/useExport", () => ({
  useExport: () => mocks.useExport(),
}));
vi.mock("@/hooks/useDeferredTour", () => ({ useDeferredTour: () => false }));
vi.mock("@/components/providers", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@/components/atoms/Toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/lib/api", () => ({ ensureApiConfigured: mocks.ensureApiConfigured }));
vi.mock("@/lib/api/outcomes", () => ({
  attachOutcomeUpload: (...args: unknown[]) => mocks.attachOutcomeUpload(...args),
}));
vi.mock("@/lib/workspace-store", () => ({
  currentWorkspaceCacheScope: (userId?: string | null) =>
    userId ? { kind: "user", userId } : { kind: "guest", guestId: "test-guest" },
  loadPendingOutcome: mocks.loadPendingOutcome,
  loadWorkspace: mocks.loadWorkspace,
  savePendingOutcome: mocks.savePendingOutcome,
}));

import { WorkspaceScreen } from "./WorkspaceScreen";

const initialState: WorkspaceInitialState = {
  intake: {
    outcomeId: "22222222-2222-4222-8222-222222222222",
    situation: "Apply for a synthetic role",
    templateName: "Resume",
    templateId: "resume",
    conversationContext: "",
    uploadContext: "",
  },
  workspace: {
    documentId: "33333333-3333-4333-8333-333333333333",
    title: "Resume",
    situation: "Apply for a synthetic role",
    status: "draft",
    sections: [],
    generated: false,
    templateId: "resume",
    conversationContext: "",
    uploadContext: "",
    unresolvedPlaceholders: [],
  },
  truth: {
    authenticated: true,
    ownerUserId: "user-1",
    persistence: "persisted",
    documentId: "33333333-3333-4333-8333-333333333333",
    currentRevision: 1,
    approvedRevision: null,
    ledgerBindingStatus: "captured",
    ledgerVersion: "ledger.2026-08-first-cohort.1",
    operationId: "55555555-5555-4555-8555-555555555555",
    operationRevision: 7,
    operationStatus: "generating",
    operationMessage: "The accepted operation is still drafting.",
    safeNextAction: "Keep this page open or reconnect later.",
    persistedAt: "2026-08-31T00:00:00.000Z",
  },
};

const unavailableInitialState: WorkspaceInitialState = {
  intake: null,
  workspace: null,
  truth: {
    authenticated: true,
    ownerUserId: "user-1",
    persistence: "unavailable",
    documentId: null,
    currentRevision: null,
    approvedRevision: null,
    ledgerBindingStatus: null,
    ledgerVersion: null,
    operationId: null,
    operationRevision: null,
    operationStatus: null,
    operationMessage: null,
    safeNextAction: null,
    persistedAt: null,
  },
};

const notFoundInitialState: WorkspaceInitialState = {
  ...unavailableInitialState,
  intake: {
    outcomeId: "22222222-2222-4222-8222-222222222222",
    situation: "Apply for a synthetic role",
    templateName: "Resume",
    templateId: "resume",
    conversationContext: "",
    uploadContext: "",
  },
  truth: {
    ...unavailableInitialState.truth,
    persistence: "not_found",
  },
};

const uploadGateInitialState: WorkspaceInitialState = {
  ...notFoundInitialState,
  intake: {
    ...notFoundInitialState.intake!,
    templateName: "Business Proposal",
    templateId: "business-proposal",
  },
};

describe("WorkspaceScreen durable recovery", () => {
  beforeEach(() => {
    recordBrowserPrincipal("user-1");
    vi.clearAllMocks();
    mocks.loadPendingOutcome.mockReturnValue(null);
    mocks.loadWorkspace.mockReturnValue(null);
    mocks.attachOutcomeUpload.mockReset();
    mocks.useExport.mockReturnValue({ exporting: false, error: null, run: vi.fn() });
    mocks.useWorkspace.mockReturnValue({ loading: true });
  });

  afterEach(() => recordBrowserPrincipal(undefined));

  it("fails closed when authoritative workspace state is unavailable", async () => {
    const { container } = render(
      <WorkspaceScreen
        outcomeId="22222222-2222-4222-8222-222222222222"
        initialState={unavailableInitialState}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Your saved workspace is temporarily unavailable" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(mocks.loadPendingOutcome).not.toHaveBeenCalled();
    expect(mocks.loadWorkspace).not.toHaveBeenCalled();
    expect(mocks.capturedAdmission).not.toHaveBeenCalled();
    expect(mocks.useWorkspace).not.toHaveBeenCalled();
    expect(mocks.useExport).not.toHaveBeenCalled();
    expect(mocks.ensureApiConfigured).not.toHaveBeenCalled();
    expect(mocks.ingestUpload).not.toHaveBeenCalled();
    expect(mocks.savePendingOutcome).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("re-fetches authoritative server state when the unavailable view is retried", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceScreen
        outcomeId="22222222-2222-4222-8222-222222222222"
        initialState={unavailableInitialState}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.loadPendingOutcome).not.toHaveBeenCalled();
    expect(mocks.loadWorkspace).not.toHaveBeenCalled();
    expect(mocks.capturedAdmission).not.toHaveBeenCalled();
    expect(mocks.useWorkspace).not.toHaveBeenCalled();
    expect(mocks.useExport).not.toHaveBeenCalled();
    expect(mocks.ensureApiConfigured).not.toHaveBeenCalled();
    expect(mocks.ingestUpload).not.toHaveBeenCalled();
    expect(mocks.savePendingOutcome).not.toHaveBeenCalled();
  });

  it("uses owner-bound server intake and ignores device cache for a new persisted outcome", async () => {
    render(
      <WorkspaceScreen
        outcomeId="22222222-2222-4222-8222-222222222222"
        initialState={notFoundInitialState}
      />,
    );

    expect(await screen.findByTestId("captured-operation-recovery")).toHaveTextContent(
      "resume:new",
    );
    expect(mocks.loadPendingOutcome).not.toHaveBeenCalled();
    expect(mocks.loadWorkspace).not.toHaveBeenCalled();
  });

  it("routes a persisted non-terminal captured operation to recovery", async () => {
    render(
      <WorkspaceScreen
        outcomeId="22222222-2222-4222-8222-222222222222"
        initialState={initialState}
      />,
    );

    expect(await screen.findByTestId("captured-operation-recovery")).toHaveTextContent(
      "resume:55555555-5555-4555-8555-555555555555:generating",
    );
  });

  it("returns a completed captured operation to its persisted workspace", () => {
    render(
      <WorkspaceScreen
        outcomeId="22222222-2222-4222-8222-222222222222"
        initialState={{
          ...initialState,
          truth: {
            ...initialState.truth,
            operationStatus: "ready_for_review",
          },
        }}
      />,
    );

    expect(screen.queryByTestId("captured-operation-recovery")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your workspace");
    expect(mocks.useWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.capturedAdmission).not.toHaveBeenCalled();
  });

  it("enters authoritative captured intake after a retry changes unavailable to not-found", async () => {
    const { rerender } = render(
      <WorkspaceScreen
        outcomeId="22222222-2222-4222-8222-222222222222"
        initialState={unavailableInitialState}
      />,
    );

    rerender(
      <WorkspaceScreen
        outcomeId="22222222-2222-4222-8222-222222222222"
        initialState={notFoundInitialState}
      />,
    );

    await waitFor(() => expect(mocks.loadPendingOutcome).not.toHaveBeenCalled());
    expect(await screen.findByTestId("captured-operation-recovery")).toHaveTextContent(
      "resume:new",
    );
  });

  it("keeps a newly persisted upload identity in the same-page intake before refresh", async () => {
    const user = userEvent.setup();
    const uploadId = "88888888-8888-4888-8888-888888888888";
    mocks.ingestUpload.mockResolvedValue({
      upload_id: uploadId,
      extracted_text: "Authoritative synthetic source wording.",
    });
    mocks.attachOutcomeUpload.mockResolvedValue({
      outcomeId: uploadGateInitialState.intake!.outcomeId,
      situation: uploadGateInitialState.intake!.situation,
      templateName: "Business Proposal",
      templateId: "business-proposal",
      conversationContext: "",
      uploadContext: "Authoritative synthetic source wording.",
      uploadId,
      updatedAt: "2026-09-01T00:01:00.000Z",
    });

    const { container } = render(
      <WorkspaceScreen
        outcomeId={uploadGateInitialState.intake!.outcomeId}
        initialState={uploadGateInitialState}
      />,
    );

    expect(await screen.findByRole("heading", { name: /I can build your Business Proposal/i }))
      .toBeVisible();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    await user.upload(input!, new File(["source"], "source.txt", { type: "text/plain" }));

    await waitFor(() => expect(mocks.attachOutcomeUpload).toHaveBeenCalledTimes(1));
    expect(mocks.attachOutcomeUpload).toHaveBeenCalledWith(
      uploadGateInitialState.intake!.outcomeId,
      uploadId,
      expect.objectContaining({
        expectedUserId: "user-1",
        signal: expect.any(AbortSignal),
        assertCurrent: expect.any(Function),
      }),
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Build with these" }));
    await waitFor(() => expect(mocks.useWorkspace).toHaveBeenCalled());
    const latest = mocks.useWorkspace.mock.calls.at(-1)?.[1] as WorkspaceInitialState;
    expect(latest.intake?.uploadId).toBe(uploadId);
    expect(latest.intake?.uploadContext).toBe("Authoritative synthetic source wording.");
    expect(mocks.loadPendingOutcome).not.toHaveBeenCalled();
    expect(mocks.loadWorkspace).not.toHaveBeenCalled();
  });

  it("rejects oversized text before ingesting or attaching an outcome upload", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <WorkspaceScreen
        outcomeId={uploadGateInitialState.intake!.outcomeId}
        initialState={uploadGateInitialState}
      />,
    );
    await screen.findByRole("heading", { name: /I can build your Business Proposal/i });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    const oversized = new File(["not read"], "source.txt", { type: "text/plain" });
    Object.defineProperty(oversized, "size", { value: 1024 * 1024 + 1 });

    await user.upload(input!, oversized);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "TXT, Markdown and CSV files need to be 1MB or smaller.",
    );
    expect(mocks.ingestUpload).not.toHaveBeenCalled();
    expect(mocks.attachOutcomeUpload).not.toHaveBeenCalled();
  });
});
