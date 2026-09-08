import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileResourceSnapshot } from "@/lib/profile-resources";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";
import ProfilePage from "./page";

const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn() },
  fetchProfileResources: vi.fn(),
  saveProfileDetails: vi.fn(),
  uploadMasterResume: vi.fn(),
  restorePreviousResume: vi.fn(),
  createResumeDownloadUrl: vi.fn(),
  showToast: vi.fn(),
  ensureApiConfigured: vi.fn(),
  authLoading: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
}));

vi.mock("@/lib/api", () => ({
  ensureApiConfigured: mocks.ensureApiConfigured,
}));

vi.mock("@/components/providers", () => ({
  useAuth: () => ({ user: { id: "user-1", email: "kai@example.com" }, loading: mocks.authLoading }),
}));

vi.mock("@/components/atoms/Toast", () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));

vi.mock("@/lib/profile-resources", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/profile-resources")>("@/lib/profile-resources");
  return {
    ...actual,
    fetchProfileResources: mocks.fetchProfileResources,
    saveProfileDetails: mocks.saveProfileDetails,
    uploadMasterResume: mocks.uploadMasterResume,
    restorePreviousResume: mocks.restorePreviousResume,
    createResumeDownloadUrl: mocks.createResumeDownloadUrl,
  };
});

const baseSnapshot: ProfileResourceSnapshot = {
  details: {
    fullName: "Kai Churchward",
    preferredName: "Kai",
    email: "kai@example.com",
    phone: "0400000000",
    dateOfBirth: "1990-01-02",
    addressLine1: "1 Example Street",
    addressLine2: "",
    suburb: "Balaclava",
    state: "VIC",
    postcode: "3183",
    country: "Australia",
  },
  currentResume: null,
  previousResume: null,
};

const withResumes: ProfileResourceSnapshot = {
  ...baseSnapshot,
  currentResume: {
    id: "current-id",
    uploadId: "current-upload",
    slot: "current",
    acceptedAt: "2026-08-12T10:00:00.000Z",
    sourceKind: "ted_update",
    fileName: "Kai Current Resume.pdf",
    fileType: "application/pdf",
    fileSizeBytes: 200000,
    storagePath: "user/current/resume.pdf",
    extractedText: "Current resume text",
  },
  previousResume: {
    id: "previous-id",
    uploadId: "previous-upload",
    slot: "previous",
    acceptedAt: "2026-08-01T10:00:00.000Z",
    sourceKind: "upload",
    fileName: "Kai Previous Resume.pdf",
    fileType: "application/pdf",
    fileSizeBytes: 180000,
    storagePath: "user/previous/resume.pdf",
    extractedText: "Previous resume text",
  },
};

describe("ProfilePage", () => {
  beforeEach(() => {
    recordBrowserPrincipal("user-1");
    vi.resetAllMocks();
    mocks.authLoading = false;
    mocks.fetchProfileResources.mockResolvedValue(baseSnapshot);
    mocks.saveProfileDetails.mockResolvedValue(undefined);
    mocks.uploadMasterResume.mockResolvedValue(undefined);
    mocks.restorePreviousResume.mockResolvedValue(undefined);
    mocks.createResumeDownloadUrl.mockResolvedValue("https://example.com/resume");
  });

  afterEach(() => {
    recordBrowserPrincipal(undefined);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function first<T>(items: readonly T[]): T {
    const item = items[0];
    if (item === undefined) throw new Error("Expected a test item");
    return item;
  }

  function pendingWindow() {
    const location = { href: "about:blank", replace: vi.fn() };
    const popup = { location, closed: false, close: vi.fn(), opener: window,
      document: { title: "", body: { textContent: "" } } };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    return popup;
  }

  it("acknowledges resume Open immediately and suppresses duplicate signing requests", async () => {
    mocks.fetchProfileResources.mockResolvedValue(withResumes);
    let resolveUrl!: (value: string) => void;
    mocks.createResumeDownloadUrl.mockReturnValue(new Promise<string>(resolve => { resolveUrl = resolve; }));
    const popup = pendingWindow();
    render(<ProfilePage />);
    const open = first(await screen.findAllByRole("button", { name: "Open" }));
    fireEvent.click(open);
    fireEvent.click(open);
    expect(window.open).toHaveBeenCalledTimes(1);
    expect(popup.opener).toBeNull();
    expect(open).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Opening resume");
    expect(mocks.createResumeDownloadUrl).toHaveBeenCalledTimes(1);
    expect(first(vi.mocked(window.open).mock.invocationCallOrder)).toBeLessThan(first(mocks.createResumeDownloadUrl.mock.invocationCallOrder));
    await act(async () => resolveUrl("https://example.com/resume"));
    expect(popup.location.replace).toHaveBeenCalledWith("https://example.com/resume");
    expect(popup.close).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: "Open" })[0]).toBeEnabled();
  });

  it("cancels a pending resume download on unmount and never clicks a late link", async () => {
    mocks.fetchProfileResources.mockResolvedValue(withResumes);
    let resolveUrl!: (value: string) => void;
    mocks.createResumeDownloadUrl.mockReturnValue(new Promise<string>(resolve => { resolveUrl = resolve; }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const view = render(<ProfilePage />);
    fireEvent.click(first(await screen.findAllByRole("button", { name: "Download" })));
    expect(screen.getByRole("status")).toHaveTextContent("Preparing download");
    const lease = first(mocks.createResumeDownloadUrl.mock.calls)[1];
    view.unmount();
    expect(lease.signal.aborted).toBe(true);
    await act(async () => resolveUrl("https://example.com/resume"));
    expect(click).not.toHaveBeenCalled();
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it("closes the pending tab and permits retry after a signing failure", async () => {
    mocks.fetchProfileResources.mockResolvedValue(withResumes);
    mocks.createResumeDownloadUrl.mockRejectedValueOnce(new Error("Resume link unavailable."));
    const popup = pendingWindow();
    render(<ProfilePage />);
    fireEvent.click(first(await screen.findAllByRole("button", { name: "Open" })));
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith({ message: "Resume link unavailable.", tone: "error" }));
    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button", { name: "Open" })[0]).toBeEnabled();
    expect(popup.location.replace).not.toHaveBeenCalled();
  });

  it("reports a blocked popup without dispatching a signing request", async () => {
    mocks.fetchProfileResources.mockResolvedValue(withResumes);
    vi.spyOn(window, "open").mockReturnValue(null);
    render(<ProfilePage />);
    fireEvent.click(first(await screen.findAllByRole("button", { name: "Open" })));
    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith({
      message: "Your browser blocked the resume tab. Allow popups for this site or use Download.", tone: "error",
    }));
    expect(mocks.createResumeDownloadUrl).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: "Open" })[0]).toBeEnabled();
  });

  it("bounds an unresponsive signing request and retries without accepting its late result", async () => {
    mocks.fetchProfileResources.mockResolvedValue(withResumes);
    let resolveFirst!: (value: string) => void;
    mocks.createResumeDownloadUrl.mockReturnValueOnce(new Promise<string>(resolve => { resolveFirst = resolve; }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<ProfilePage />);
    const download = first(await screen.findAllByRole("button", { name: "Download" }));
    vi.useFakeTimers();
    fireEvent.click(download);
    const firstLease = first(mocks.createResumeDownloadUrl.mock.calls)[1];
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(firstLease.signal.aborted).toBe(true);
    expect(mocks.showToast).toHaveBeenCalledWith({
      message: "Preparing the resume file took too long. Please try again.", tone: "error",
    });
    expect(download).toBeEnabled();
    fireEvent.click(download);
    await act(async () => {});
    expect(mocks.createResumeDownloadUrl).toHaveBeenCalledTimes(2);
    expect(click).toHaveBeenCalledTimes(1);
    await act(async () => resolveFirst("https://example.com/late-resume"));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("closes its pending tab on owner change and ignores a late signed URL", async () => {
    mocks.fetchProfileResources.mockResolvedValue(withResumes);
    let resolveUrl!: (value: string) => void;
    mocks.createResumeDownloadUrl.mockReturnValue(new Promise<string>(resolve => { resolveUrl = resolve; }));
    const popup = pendingWindow();
    render(<ProfilePage />);
    fireEvent.click(first(await screen.findAllByRole("button", { name: "Open" })));
    const lease = first(mocks.createResumeDownloadUrl.mock.calls)[1];
    await act(async () => recordBrowserPrincipal("user-2"));
    expect(lease.signal.aborted).toBe(true);
    expect(popup.close).toHaveBeenCalledTimes(1);
    await act(async () => resolveUrl("https://example.com/resume"));
    expect(popup.location.replace).not.toHaveBeenCalled();
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it("does not navigate or close a tab that the user navigated while signing", async () => {
    mocks.fetchProfileResources.mockResolvedValue(withResumes);
    let resolveUrl!: (value: string) => void;
    mocks.createResumeDownloadUrl.mockReturnValue(new Promise<string>(resolve => { resolveUrl = resolve; }));
    const popup = pendingWindow();
    render(<ProfilePage />);
    fireEvent.click(first(await screen.findAllByRole("button", { name: "Open" })));
    popup.location.href = "https://example.com/user-selected-page";
    await act(async () => resolveUrl("https://example.com/resume"));
    expect(popup.location.replace).not.toHaveBeenCalled();
    expect(popup.close).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith({
      message: "The resume tab is no longer available. Try Open again or use Download.", tone: "error",
    });
  });

  it("keeps the Profile destination labelled while authentication loads", () => {
    mocks.authLoading = true;
    render(<ProfilePage />);
    expect(screen.getByRole("heading", { name: "Profile", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your Profile");
  });

  it("renders the complete personal-details and address workflow", async () => {
    render(<ProfilePage />);
    await screen.findByLabelText("Full name");
    expect(screen.getByRole("heading", { name: "Profile" })).toBeInTheDocument();

    for (const label of [
      "Full name",
      "Preferred name",
      "Email",
      "Contact number",
      "Date of birth",
      "Address line 1",
      "Address line 2",
      "Suburb / locality",
      "State / territory",
      "Postcode",
      "Country",
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(
      screen.getByText(/Other workflows only use saved Profile resources when you select them/i),
    ).toBeInTheDocument();
  });

  it("saves edited details and clears the dirty state", async () => {
    render(<ProfilePage />);
    const phone = await screen.findByLabelText("Contact number");
    fireEvent.change(phone, { target: { value: "0411111111" } });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));
    await waitFor(() =>
      expect(mocks.saveProfileDetails).toHaveBeenCalledWith(
        expect.objectContaining({ phone: "0411111111", email: "kai@example.com" }),
        expect.objectContaining({
          expectedUserId: "user-1",
          signal: expect.any(AbortSignal),
          assertCurrent: expect.any(Function),
        }),
      ),
    );
    await waitFor(() => expect(screen.getByText("Profile up to date")).toBeInTheDocument());
  });

  it("shows a meaningful empty resume state and uploads through the existing master-resume workflow", async () => {
    const { container } = render(<ProfilePage />);
    expect(await screen.findByText("No Current resume saved")).toBeInTheDocument();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["resume"], "Kai Resume.pdf", { type: "application/pdf" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(mocks.uploadMasterResume).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        expectedUserId: "user-1",
        signal: expect.any(AbortSignal),
        assertCurrent: expect.any(Function),
      }),
    ));
    await waitFor(() => expect(mocks.fetchProfileResources).toHaveBeenCalledTimes(2));
    // Regression: the API client must be configured (so ingestUpload actually
    // attaches an Authorization header) before the upload is attempted —
    // this page previously never called it, so uploads silently went out
    // unauthenticated and the server rejected them with a bare 401.
    expect(mocks.ensureApiConfigured).toHaveBeenCalled();
  });

  it("rejects oversized text before changing the saved resume workflow", async () => {
    const { container } = render(<ProfilePage />);
    await screen.findByText("No Current resume saved");
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toHaveAttribute("accept", expect.stringContaining(".xlsx"));
    const oversized = new File(["not read"], "resume.md", { type: "text/markdown" });
    Object.defineProperty(oversized, "size", { value: 1024 * 1024 + 1 });

    fireEvent.change(input!, { target: { files: [oversized] } });

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith({
      message: "TXT, Markdown and CSV files need to be 1MB or smaller.",
      tone: "error",
    }));
    expect(mocks.uploadMasterResume).not.toHaveBeenCalled();
    expect(mocks.fetchProfileResources).toHaveBeenCalledTimes(1);
  });

  it("renders Current and Previous resume resources with explicit restore confirmation", async () => {
    mocks.fetchProfileResources.mockResolvedValue(withResumes);
    render(<ProfilePage />);

    expect(await screen.findByText("Kai Current Resume.pdf")).toBeInTheDocument();
    expect(screen.getByText("Kai Previous Resume.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore as Current" }));
    expect(
      screen.getByText(/Make this Previous resume your Current master resume/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore resume" }));
    await waitFor(() => expect(mocks.restorePreviousResume).toHaveBeenCalledTimes(1));
  });

  it("does not replace resume state when upload fails", async () => {
    mocks.uploadMasterResume.mockRejectedValue(new Error("Resume could not be read"));
    const { container } = render(<ProfilePage />);
    await screen.findByText("No Current resume saved");
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["bad"], "bad.pdf", { type: "application/pdf" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        expect.objectContaining({ tone: "error", message: "Resume could not be read" }),
      ),
    );
    expect(mocks.fetchProfileResources).toHaveBeenCalledTimes(1);
  });

  async function changeResume(container: HTMLElement, action: "upload" | "restore") {
    if (action === "upload") {
      fireEvent.change(container.querySelector('input[type="file"]')!, {
        target: { files: [new File(["resume"], "Replacement.pdf", { type: "application/pdf" })] },
      });
    } else {
      fireEvent.click(screen.getByRole("button", { name: "Restore as Current" }));
      fireEvent.click(screen.getByRole("button", { name: "Restore resume" }));
    }
    await waitFor(() => expect(mocks.fetchProfileResources).toHaveBeenCalledTimes(2));
  }

  it("hydrates details after an initial read failure and bounded retry", async () => {
    let finish!: (value: ProfileResourceSnapshot) => void;
    mocks.fetchProfileResources.mockRejectedValueOnce(new Error("Profile is unavailable."))
      .mockImplementationOnce(() => new Promise<ProfileResourceSnapshot>(resolve => { finish = resolve; }));
    render(<ProfilePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Profile is unavailable.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(mocks.fetchProfileResources).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Try again" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing Profile…");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.fetchProfileResources).toHaveBeenCalledTimes(2);
    await act(async () => finish(withResumes));
    expect(await screen.findByLabelText("Full name")).toHaveValue(baseSnapshot.details.fullName);
    expect(screen.getByText("Kai Current Resume.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["upload", "restore"] as const)("preserves unsaved details before and during %s refresh", async (action) => {
    let finish!: (value: ProfileResourceSnapshot) => void;
    mocks.fetchProfileResources.mockResolvedValueOnce(withResumes)
      .mockImplementationOnce(() => new Promise<ProfileResourceSnapshot>(resolve => { finish = resolve; }));
    const { container } = render(<ProfilePage />);
    const phone = await screen.findByLabelText("Contact number");
    fireEvent.change(phone, { target: { value: "0411111111" } });
    await changeResume(container, action);
    fireEvent.change(screen.getByLabelText("Address line 1"), { target: { value: "2 Unsaved Street" } });
    await act(async () => finish({ ...withResumes, currentResume: { ...withResumes.currentResume!, fileName: "Replacement.pdf" } }));
    expect(await screen.findByText("Replacement.pdf")).toBeInTheDocument();
    expect(phone).toHaveValue("0411111111");
    expect(screen.getByLabelText("Address line 1")).toHaveValue("2 Unsaved Street");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(mocks.saveProfileDetails).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(phone).toHaveValue(baseSnapshot.details.phone);
    expect(screen.getByLabelText("Address line 1")).toHaveValue(baseSnapshot.details.addressLine1);
  });

  it.each(["upload", "restore"] as const)("reports a saved %s with failed refresh and retries only the read", async (action) => {
    let finishRetry!: (value: ProfileResourceSnapshot) => void;
    mocks.fetchProfileResources.mockResolvedValueOnce(withResumes)
      .mockRejectedValueOnce(new Error("Saved resume resources are temporarily unavailable."))
      .mockImplementationOnce(() => new Promise<ProfileResourceSnapshot>(resolve => { finishRetry = resolve; }));
    const { container } = render(<ProfilePage />);
    const phone = await screen.findByLabelText("Contact number");
    fireEvent.change(phone, { target: { value: "0411111111" } });
    await changeResume(container, action);
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved resume resources are temporarily unavailable.");
    expect(screen.getByRole("alert")).toHaveTextContent("Last loaded resources");
    expect(screen.queryByText("Profile up to date")).not.toBeInTheDocument();
    expect(phone).toHaveValue("0411111111");
    expect(screen.getByRole("button", { name: "Replace Current" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Restore as Current" })).toBeDisabled();
    expect(mocks.showToast).not.toHaveBeenCalledWith(expect.objectContaining({ tone: "success" }));
    expect(mocks.showToast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/change was saved.*refresh/i) }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(mocks.fetchProfileResources).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("button", { name: "Try again" })).toBeDisabled();
    expect(screen.getByText("Refreshing Profile…")).toBeInTheDocument();
    fireEvent.change(phone, { target: { value: "0422222222" } });
    await act(async () => finishRetry({ ...withResumes, currentResume: { ...withResumes.currentResume!, fileName: "Recovered.pdf" } }));
    expect(await screen.findByText("Recovered.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(phone).toHaveValue("0422222222");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(mocks.uploadMasterResume).toHaveBeenCalledTimes(action === "upload" ? 1 : 0);
    expect(mocks.restorePreviousResume).toHaveBeenCalledTimes(action === "restore" ? 1 : 0);
  });

  it.each(["save-first", "refresh-first"] as const)("keeps the accepted detail save when resume refresh completes %s", async (order) => {
    let finishRefresh!: (value: ProfileResourceSnapshot) => void;
    let finishSave!: () => void;
    mocks.fetchProfileResources.mockResolvedValueOnce(withResumes)
      .mockImplementationOnce(() => new Promise<ProfileResourceSnapshot>(resolve => { finishRefresh = resolve; }));
    mocks.saveProfileDetails.mockImplementationOnce(() => new Promise<void>(resolve => { finishSave = resolve; }));
    const { container } = render(<ProfilePage />);
    const phone = await screen.findByLabelText("Contact number");
    fireEvent.change(phone, { target: { value: "0433333333" } });
    await changeResume(container, "upload");
    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));
    await waitFor(() => expect(mocks.saveProfileDetails).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Address line 1"), { target: { value: "3 Later Edit Street" } });
    if (order === "save-first") await act(async () => finishSave());
    await act(async () => finishRefresh(withResumes));
    if (order === "refresh-first") await act(async () => finishSave());
    expect(phone).toHaveValue("0433333333");
    expect(screen.getByLabelText("Address line 1")).toHaveValue("3 Later Edit Street");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.change(phone, { target: { value: "0444444444" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(phone).toHaveValue("0433333333");
    expect(screen.getByLabelText("Address line 1")).toHaveValue(baseSnapshot.details.addressLine1);
  });
});
