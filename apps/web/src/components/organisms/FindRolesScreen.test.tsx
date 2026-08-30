import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FindRolesScreen, safeExternalHttpUrl } from "./FindRolesScreen";

const mocks = vi.hoisted(() => ({
  jobMatch: vi.fn(),
  saveRole: vi.fn(),
  fetchActionItems: vi.fn(),
  fetchProfileResources: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@prompted/shared/api-client", async () => {
  const actual = await vi.importActual<typeof import("@prompted/shared/api-client")>(
    "@prompted/shared/api-client",
  );
  return { ...actual, jobMatch: mocks.jobMatch, ingestUpload: vi.fn() };
});
vi.mock("@/lib/api", () => ({ ensureApiConfigured: () => undefined }));
vi.mock("@/hooks/useOutcome", () => ({ useOutcome: () => ({ confirm: mocks.confirm }) }));
vi.mock("@/components/providers", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@/lib/api/saved-roles", () => ({
  saveRole: mocks.saveRole,
  fetchActionItems: mocks.fetchActionItems,
  fetchRoleOutcomes: vi.fn(),
  recordRoleOutcome: vi.fn(),
  setActionItemStatus: vi.fn(),
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
    vi.clearAllMocks();
    mocks.fetchProfileResources.mockResolvedValue(snapshot);
    mocks.jobMatch.mockResolvedValue({
      summary: "One match",
      listings: [
        { title: "Building Manager", employer: "Example Co", location: "Melbourne", fit_score: 90 },
      ],
      role_ideas: [],
    });
    mocks.saveRole.mockResolvedValue("saved-role-1");
    mocks.fetchActionItems.mockResolvedValue([
      { id: "action-1", label: "Review the role", status: "pending" },
    ]);
  });

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
      ),
    );
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
    expect(mocks.fetchActionItems).toHaveBeenCalledWith("saved-role-1");
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
  it("allows only absolute HTTP and HTTPS application links", () => {
    expect(safeExternalHttpUrl("https://jobs.example.com/apply?id=1")).toBe(
      "https://jobs.example.com/apply?id=1",
    );
    expect(safeExternalHttpUrl("http://jobs.example.com/apply")).toBe(
      "http://jobs.example.com/apply",
    );
    expect(safeExternalHttpUrl("javascript:alert(document.domain)")).toBeNull();
    expect(safeExternalHttpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeExternalHttpUrl("//attacker.example/apply")).toBeNull();
    expect(safeExternalHttpUrl("/apply")).toBeNull();
  });
});
