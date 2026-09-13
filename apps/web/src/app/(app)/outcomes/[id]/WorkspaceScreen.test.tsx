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
  showToast: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@prompted/shared/api-client", () => ({
  ApiError: class ApiError extends Error {},
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
vi.mock("@/components/organisms/WorkspacePane", () => ({ WorkspacePane: () => null }));
vi.mock("@/hooks/useExport", () => ({
  useExport: () => mocks.useExport(),
}));
vi.mock("@/hooks/useDeferredTour", () => ({ useDeferredTour: () => false }));
vi.mock("@/components/providers", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@/components/atoms/Toast", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
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

  it.each(["quota_exceeded", "unavailable"] as const)(
    "keeps an uncertain account save explicit alongside %s browser recovery",
    async (deviceSaveStatus) => {
      const retry = vi.fn();
      mocks.useWorkspace.mockReturnValue({
        loading: false, title: "Synthetic document", sections: [], activeSectionId: null,
        generationIssues: [], missingInfoQuestions: [], syncStatus: "failed", deviceSaveStatus,
        currentRevision: 1, approvedRevision: null, drafting: false, captured: false,
        retrySync: retry, isAllApproved: false, dirtySectionCount: 1,
      });
      render(<WorkspaceScreen outcomeId="22222222-2222-4222-8222-222222222222" />);
      await userEvent.click(screen.getByRole("button", { name: /^Save problem:/ }));
      const deviceMessage = deviceSaveStatus === "quota_exceeded"
        ? "Browser storage is full."
        : "PrompTED could not create a browser recovery copy.";
      expect(screen.getByText(`${deviceMessage} PrompTED could not confirm that the latest changes are saved to your account. Keep this page open and try saving again.`)).toBeVisible();
      expect(screen.queryByRole("button", { name: "Saved" })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Try saving again" }));
      expect(retry).toHaveBeenCalledOnce();
    },
  );

  it.each(["idle", "local_only", "failed"] as const)(
    "attempts saving from %s instead of fabricating a saved toast",
    async (syncStatus) => {
      const retry = vi.fn();
      mocks.useWorkspace.mockReturnValue({
        loading: false,
        title: "Synthetic document",
        sections: [],
        activeSectionId: null,
        generationIssues: [],
        missingInfoQuestions: [],
        syncStatus,
        deviceSaveStatus: "quota_exceeded",
        currentRevision: 1,
        approvedRevision: null,
        drafting: false,
        captured: false,
        retrySync: retry,
        isAllApproved: false,
        dirtySectionCount: 0,
      });
      render(<WorkspaceScreen outcomeId="22222222-2222-4222-8222-222222222222" />);
      await userEvent.click(screen.getByRole("button", { name: /^Save$/ }));
      expect(retry).toHaveBeenCalledTimes(1);
      expect(mocks.showToast).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: /^Save problem:/ }));
      expect(screen.queryByText("This version is saved on this device")).toBeNull();
      expect(screen.getByText(/browser storage is full/i)).toBeInTheDocument();
    },
  );

  it.each([
    {
      sectionName: "Monthly document limit reached",
      reason: "You've reached your document limit for this month. New allowance becomes available next month.",
    },
    {
      sectionName: "Document generation paused",
      reason: "PrompTED could not confirm the document limit details. New generation is paused. You can still edit your existing wording.",
    },
  ])("shows the $sectionName notice without an upgrade action", async ({ sectionName, reason }) => {
    const retry = vi.fn();
    mocks.useWorkspace.mockReturnValue({
      loading: false,
      title: "Synthetic complaint",
      sections: [],
      activeSectionId: "issue",
      generationIssues: [{ sectionId: "__document_limit__", sectionName, reason, retryable: false, attempts: 0 }],
      missingInfoQuestions: [],
      syncStatus: "saved",
      deviceSaveStatus: "saved",
      currentRevision: 1,
      approvedRevision: null,
      drafting: false,
      captured: false,
      retryGenerationSection: retry,
      dirtySectionCount: 0,
      isAllApproved: false,
    });
    render(<WorkspaceScreen outcomeId={initialState.intake!.outcomeId} />);

    await userEvent.click(screen.getByRole("button", { name: `Needs attention: ${sectionName}` }));
    expect(screen.getByText((text) => text.includes(reason))).toBeVisible();
    expect(screen.getByText(/read, edit and export/)).toBeVisible();
    expect(screen.queryByRole("link", { name: /view plans|update subscription|upgrade/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /try this section again|regenerate/i })).toBeNull();
    expect(retry).not.toHaveBeenCalled();
  });

  it("retains View plans for a lower-plan paywall", async () => {
    mocks.useWorkspace.mockReturnValue({
      loading: false,
      title: "Synthetic complaint",
      sections: [],
      activeSectionId: "issue",
      generationIssues: [{
        sectionId: "__paywall__",
        sectionName: "Out of document credits",
        reason: "You've used all your document credits for this month. Update your subscription to keep using TED.",
        attempts: 0,
      }],
      missingInfoQuestions: [],
      syncStatus: "saved",
      currentRevision: 1,
      approvedRevision: null,
      drafting: false,
      captured: false,
      dirtySectionCount: 0,
      isAllApproved: false,
    });
    render(<WorkspaceScreen outcomeId={initialState.intake!.outcomeId} />);

    await userEvent.click(screen.getByRole("button", { name: "Needs attention: Document credits used" }));
    expect(screen.getByRole("link", { name: "View plans" })).toHaveAttribute("href", "/settings/account");
  });

  it.each([true, false])(
    "shows the actual generation reason with retryable=%s",
    async (retryable) => {
      const user = userEvent.setup();
      const retry = vi.fn();
      const reason = retryable
        ? "Generation did not complete. Try this section again, or edit its wording."
        : "TED could not confirm whether the previous generation finished. New generation is paused for this section. You can still edit its wording.";
      mocks.useWorkspace.mockReturnValue({
        loading: false,
        title: "Synthetic complaint",
        sections: [],
        activeSectionId: "issue",
        generationIssues: [
          { sectionId: "issue", sectionName: "Issue", reason, retryable, attempts: 0 },
        ],
        missingInfoQuestions: [],
        syncStatus: "saved",
        currentRevision: 1,
        approvedRevision: null,
        drafting: false,
        captured: false,
        retryGenerationSection: retry,
      });
      render(
        <WorkspaceScreen
          outcomeId={initialState.intake!.outcomeId}
          initialState={{
            ...initialState,
            truth: {
              ...initialState.truth,
              ledgerBindingStatus: "legacy_unversioned",
              operationStatus: null,
              operationId: null,
              operationRevision: null,
            },
          }}
        />,
      );
      const trigger = screen.getByRole("button", {
        name: "Needs attention: Issue needs attention",
      });
      await user.click(trigger);
      expect(screen.getByText(reason)).toBeVisible();
      if (retryable) {
        await user.click(screen.getByRole("button", { name: "Try this section again" }));
        expect(retry).toHaveBeenCalledExactlyOnceWith("issue");
      } else {
        expect(screen.queryByRole("button", { name: "Try this section again" })).toBeNull();
        await user.tab();
        expect(trigger).not.toHaveFocus();
        await user.keyboard("{Escape}");
        expect(trigger).toHaveFocus();
        expect(screen.queryByText(reason)).toBeNull();
        expect(retry).not.toHaveBeenCalled();
      }
    },
  );

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

    expect(
      await screen.findByRole("heading", { name: /I can build your Business Proposal/i }),
    ).toBeVisible();
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

  it("keeps extracted upload context when durable outcome attachment fails", async () => {
    const user = userEvent.setup();
    const uploadId = "99999999-9999-4999-8999-999999999999";
    const extractedText = "Retained source wording for document generation.";
    mocks.ingestUpload.mockResolvedValue({
      upload_id: uploadId,
      extracted_text: extractedText,
    });
    mocks.attachOutcomeUpload.mockRejectedValue(new Error("temporary attachment failure"));

    const { container } = render(
      <WorkspaceScreen
        outcomeId={uploadGateInitialState.intake!.outcomeId}
        initialState={uploadGateInitialState}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: /I can build your Business Proposal/i }),
    ).toBeVisible();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    await user.upload(input!, new File(["source"], "source.txt", { type: "text/plain" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "TED read the file and will use it for this draft",
    );
    expect(mocks.savePendingOutcome).toHaveBeenCalledWith(
      { kind: "user", userId: "user-1" },
      uploadGateInitialState.intake!.outcomeId,
      expect.objectContaining({ uploadContext: extractedText, uploadId }),
    );
    expect(mocks.refresh).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Build with these" }));
    await waitFor(() => expect(mocks.useWorkspace).toHaveBeenCalled());
    const latest = mocks.useWorkspace.mock.calls.at(-1)?.[1] as WorkspaceInitialState;
    expect(latest.intake?.uploadId).toBe(uploadId);
    expect(latest.intake?.uploadContext).toBe(extractedText);
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
