import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FindRolesScreen, safeExternalHttpUrl } from "./FindRolesScreen";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";

const mocks = vi.hoisted(() => ({
  ingestUpload: vi.fn(),
  jobMatch: vi.fn(),
  saveRole: vi.fn(),
  fetchActionItems: vi.fn(),
  fetchRoleOutcomes: vi.fn(),
  recordRoleOutcome: vi.fn(),
  setActionItemStatus: vi.fn(),
  fetchProfileResources: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@prompted/shared/api-client", async () => {
  const actual = await vi.importActual<typeof import("@prompted/shared/api-client")>(
    "@prompted/shared/api-client",
  );
  return { ...actual, jobMatch: mocks.jobMatch, ingestUpload: mocks.ingestUpload };
});
vi.mock("@/lib/api", () => ({ ensureApiConfigured: () => undefined }));
vi.mock("@/hooks/useOutcome", () => ({ useOutcome: () => ({ confirm: mocks.confirm }) }));
vi.mock("@/components/providers", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@/lib/api/saved-roles", () => ({
  saveRole: mocks.saveRole,
  fetchActionItems: mocks.fetchActionItems,
  fetchRoleOutcomes: mocks.fetchRoleOutcomes,
  recordRoleOutcome: mocks.recordRoleOutcome,
  setActionItemStatus: mocks.setActionItemStatus,
  ROLE_OUTCOME_STAGE_LABELS: { applied: "Applied" },
}));
vi.mock("@/lib/profile-resources", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/profile-resources")>("@/lib/profile-resources");
  return { ...actual, fetchProfileResources: mocks.fetchProfileResources };
});

const snapshot = {
  details: {
    fullName: "Kai Churchward",
    preferredName: "Kai",
    email: "kai@example.com",
    phone: "",
    dateOfBirth: "",
    addressLine1: "",
    addressLine2: "",
    suburb: "",
    state: "",
    postcode: "",
    country: "",
  },
  currentResume: {
    id: "r1",
    uploadId: "u1",
    slot: "current" as const,
    acceptedAt: "2026-08-13",
    sourceKind: "upload" as const,
    fileName: "Current resume.pdf",
    fileType: "application/pdf",
    fileSizeBytes: 100,
    storagePath: "user/resume.pdf",
    extractedText: "Experienced building and operations manager",
  },
  previousResume: null,
};

describe("FindRolesScreen Profile resources", () => {
  beforeEach(() => {
    recordBrowserPrincipal("user-1");
    vi.clearAllMocks();
    mocks.fetchProfileResources.mockResolvedValue(snapshot);
    mocks.ingestUpload.mockResolvedValue({
      upload_id: "upload-xlsx",
      extracted_text: "Synthetic resume evidence",
      confirm_payload: { summary: "Synthetic resume" },
    });
    mocks.jobMatch.mockResolvedValue({
      summary: "One match",
      listings: [
        { title: "Building Manager", employer: "Example Co", location: "Melbourne", fit_score: 90 },
      ],
      role_ideas: [],
    });
    mocks.saveRole.mockResolvedValue("saved-role-1");
    mocks.fetchActionItems.mockResolvedValue([
      {
        id: "a4000000-0000-4000-8000-000000000001",
        label: "Review the role",
        description: null,
        status: "pending",
        sort_order: 0,
        mutation_token: "a5000000-0000-4000-8000-000000000001",
      },
    ]);
    mocks.fetchRoleOutcomes.mockResolvedValue([]);
  });

  afterEach(() => recordBrowserPrincipal(undefined));

  it("does not use a Profile resume until the user selects it for this workflow", async () => {
    render(<FindRolesScreen />);
    const findRoles = screen.getByRole("button", { name: "Find roles" });
    expect(findRoles).toBeDisabled();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Current resume" }));
    expect(findRoles).toBeEnabled();
    fireEvent.click(findRoles);
    await waitFor(() =>
      expect(mocks.jobMatch).toHaveBeenCalledWith(
        expect.objectContaining({ experience: "Experienced building and operations manager" }),
        expect.objectContaining({ expectedUserId: "user-1" }),
      ),
    );
  });

  it("accepts XLSX resumes and rejects oversized text before ingest", async () => {
    const { container } = render(<FindRolesScreen />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input).toHaveAttribute("accept", expect.stringContaining(".xlsx"));

    const workbook = new File(["workbook"], "resume.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    fireEvent.change(input!, { target: { files: [workbook] } });
    await waitFor(() => expect(mocks.ingestUpload).toHaveBeenCalledWith(
      workbook,
      expect.stringContaining("Extract this resume"),
      expect.objectContaining({ expectedUserId: "user-1" }),
    ));

    mocks.ingestUpload.mockClear();
    const oversized = new File(["not read"], "resume.txt", { type: "text/plain" });
    Object.defineProperty(oversized, "size", { value: 1024 * 1024 + 1 });
    fireEvent.change(input!, { target: { files: [oversized] } });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "TXT, Markdown and CSV files need to be 1MB or smaller.",
    );
    expect(mocks.ingestUpload).not.toHaveBeenCalled();
  });

  it("explains which Profile resources affect matching and later documents", async () => {
    render(<FindRolesScreen />);

    expect(
      await screen.findByText(
        "Choose a saved resume for matching and any personal details TED may use in documents you create from these results.",
      ),
    ).toBeInTheDocument();
  });

  it("opens an action plan on the first click after saving an unsaved role", async () => {
    render(<FindRolesScreen />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Current resume" }));
    fireEvent.click(screen.getByRole("button", { name: "Find roles" }));
    fireEvent.click(await screen.findByRole("button", { name: "Action plan" }));
    expect(await screen.findByText("Review the role")).toBeInTheDocument();
    const saveLease = mocks.saveRole.mock.calls[0]?.[1];
    const readLease = mocks.fetchActionItems.mock.calls[0]?.[1];
    expect(saveLease).toEqual(expect.objectContaining({ expectedUserId: "user-1" }));
    expect(readLease).toBe(saveLease);
  });

  it("labels and persists a captured vacancy as source-linked, never official", async () => {
    mocks.jobMatch.mockResolvedValueOnce({
      summary: "One source-linked match",
      vacancy_search: { status: "completed", source_linked_count: 1 },
      listings: [{
        title: "Building Manager",
        employer: "Example Co",
        location: "Melbourne",
        source: "Example careers page",
        source_id: "source-1",
        source_status: "source_linked_not_independently_verified",
        url: "https://careers.example.com/jobs/1",
        fit_score: 90,
      }],
      role_ideas: [],
    });
    render(<FindRolesScreen />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Current resume" }));
    fireEvent.click(screen.getByRole("button", { name: "Find roles" }));

    expect(await screen.findByText(/Source-linked apply page:/i)).toBeInTheDocument();
    expect(screen.getByText(/Verify the role details and closing status/i)).toBeInTheDocument();
    expect(screen.queryByText("Official")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save role" }));
    await waitFor(() =>
      expect(mocks.saveRole).toHaveBeenCalledWith(
        expect.objectContaining({
          jobUrl: "https://careers.example.com/jobs/1",
          contactSourceStatus: "public_listing",
        }),
        expect.anything(),
      ),
    );
  });

  it("fails closed when a rollback server omits vacancy source status", async () => {
    mocks.jobMatch.mockResolvedValueOnce({
      summary: "Unconfirmed source",
      listings: [{
        title: "Building Manager",
        employer: "Example Co",
        url: "https://careers.example.com/jobs/1",
      }],
      role_ideas: [],
    });
    render(<FindRolesScreen />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Current resume" }));
    fireEvent.click(screen.getByRole("button", { name: "Find roles" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save role" }));
    await waitFor(() =>
      expect(mocks.saveRole).toHaveBeenCalledWith(
        expect.objectContaining({ contactSourceStatus: "needs_confirmation" }),
        expect.anything(),
      ),
    );
  });

  it("distinguishes retryable vacancy research failure from completed zero results", async () => {
    mocks.jobMatch.mockResolvedValueOnce({
      summary: "Role ideas remain available",
      vacancy_search: {
        status: "failed",
        source_linked_count: 0,
        retryable: true,
        error: {
          code: "VACANCY_RESEARCH_UNAVAILABLE",
          message: "Unavailable",
          safe_next_action: "retry_current_openings",
        },
      },
      listings: [],
      role_ideas: [{ role: "Facilities Coordinator", why_fit: "Relevant background" }],
    });
    render(<FindRolesScreen />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Current resume" }));
    fireEvent.click(screen.getByRole("button", { name: "Find roles" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/not a zero-results finding/i);
    expect(screen.getByRole("button", { name: "Retry current openings" })).toBeInTheDocument();
    expect(screen.getByText("Facilities Coordinator")).toBeInTheDocument();
    expect(screen.queryByText(/broaden the role type/i)).not.toBeInTheDocument();
  });

  it("suppresses an A-to-B-to-A role-save result and releases the busy control", async () => {
    let resolveSave!: (id: string) => void;
    mocks.saveRole.mockReturnValue(new Promise((resolve) => {
      resolveSave = resolve;
    }));
    render(<FindRolesScreen />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Current resume" }));
    fireEvent.click(screen.getByRole("button", { name: "Find roles" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save role" }));
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();

    recordBrowserPrincipal("user-b");
    recordBrowserPrincipal("user-1");
    await act(async () => resolveSave("saved-role-1"));

    await waitFor(() => expect(screen.getByRole("button", { name: "Save role" })).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Saved to library" })).not.toBeInTheDocument();
  });

  it("keeps action truth unchanged on failure and suppresses rapid duplicate toggles", async () => {
    let rejectToggle!: (error: Error) => void;
    mocks.setActionItemStatus.mockReturnValue(new Promise((_resolve, reject) => {
      rejectToggle = reject;
    }));
    render(<FindRolesScreen />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Current resume" }));
    fireEvent.click(screen.getByRole("button", { name: "Find roles" }));
    fireEvent.click(await screen.findByRole("button", { name: "Action plan" }));
    const item = await screen.findByRole("checkbox", { name: "Review the role" });

    fireEvent.click(item);
    fireEvent.click(item);
    expect(mocks.setActionItemStatus).toHaveBeenCalledTimes(1);
    expect(item).toBeDisabled();
    await act(async () => rejectToggle(new Error("write failed")));

    await waitFor(() => expect(item).toBeEnabled());
    expect(item).not.toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "TED couldn't update that action. Its previous status is unchanged.",
    );
  });

  it("fills the location field from the selected Profile address so the live search actually uses it", async () => {
    mocks.fetchProfileResources.mockResolvedValue({
      ...snapshot,
      details: {
        ...snapshot.details,
        addressLine1: "1 Example Street",
        suburb: "Balaclava",
        state: "VIC",
        postcode: "3183",
        country: "Australia",
      },
    });
    render(<FindRolesScreen />);

    const locationInput = await screen.findByLabelText("Location");
    expect(locationInput).toHaveValue("");

    fireEvent.click(await screen.findByRole("checkbox", { name: "Address" }));

    await waitFor(() => expect(locationInput).toHaveValue("Balaclava, VIC, 3183, Australia"));
  });

  it("does not overwrite a location the user already typed with the Profile address", async () => {
    mocks.fetchProfileResources.mockResolvedValue({
      ...snapshot,
      details: { ...snapshot.details, suburb: "Balaclava", state: "VIC" },
    });
    render(<FindRolesScreen />);

    const locationInput = await screen.findByLabelText("Location");
    fireEvent.change(locationInput, { target: { value: "Sydney" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: "Address" }));

    await waitFor(() => expect(locationInput).toHaveValue("Sydney"));
  });

  it("has no automated accessibility violations in the resource-selection state", async () => {
    const { container } = render(<FindRolesScreen />);
    await screen.findByRole("checkbox", { name: "Current resume" });
    expect(await axe(container)).toHaveNoViolations();
  });

  it("grows the situation textarea to fit typed content instead of clipping it", async () => {
    render(<FindRolesScreen />);
    const textarea = await screen.findByLabelText("What should TED know before matching roles?");
    Object.defineProperty(textarea, "scrollHeight", { value: 140, configurable: true });

    await userEvent.type(
      textarea,
      "I want hybrid admin roles over $70k, no heavy lifting, and I can start within two weeks.",
    );

    expect(textarea).toHaveStyle({ height: "140px" });
  });
});

describe("safeExternalHttpUrl", () => {
  it("allows only canonical absolute HTTPS application links", () => {
    expect(safeExternalHttpUrl("https://jobs.example.com/apply?id=1")).toBe(
      "https://jobs.example.com/apply?id=1",
    );
    expect(safeExternalHttpUrl("http://jobs.example.com/apply")).toBeNull();
    expect(safeExternalHttpUrl("javascript:alert(document.domain)")).toBeNull();
    expect(safeExternalHttpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeExternalHttpUrl("//attacker.example/apply")).toBeNull();
    expect(safeExternalHttpUrl("/apply")).toBeNull();
  });
});
