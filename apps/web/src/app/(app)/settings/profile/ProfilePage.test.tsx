import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    vi.clearAllMocks();
    mocks.authLoading = false;
    mocks.fetchProfileResources.mockResolvedValue(baseSnapshot);
    mocks.saveProfileDetails.mockResolvedValue(undefined);
    mocks.uploadMasterResume.mockResolvedValue(undefined);
    mocks.restorePreviousResume.mockResolvedValue(undefined);
    mocks.createResumeDownloadUrl.mockResolvedValue("https://example.com/resume");
  });

  afterEach(() => recordBrowserPrincipal(undefined));

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
});
