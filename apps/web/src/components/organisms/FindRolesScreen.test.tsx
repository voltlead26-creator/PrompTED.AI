import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FindRolesScreen, safeExternalHttpUrl } from "./FindRolesScreen";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";
import type { RoleActionItem, RoleActionItemMutationResult } from "@/lib/api/saved-roles";

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
vi.mock("@/lib/api/saved-roles", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/saved-roles")>("@/lib/api/saved-roles")),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const actionBeforeToggle: RoleActionItem = {
  id: "a4000000-0000-4000-8000-000000000001",
  label: "Review the role",
  description: null,
  status: "pending",
  sort_order: 0,
  mutation_token: "a5000000-0000-4000-8000-000000000001",
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
    mocks.recordRoleOutcome.mockReset();
    mocks.setActionItemStatus.mockReset();
  });

  afterEach(() => { recordBrowserPrincipal(undefined); vi.useRealTimers(); });

  it("regression: keeps the original local date, event ID and note when retrying an uncertain outcome", async () => {
    vi.setSystemTime(new Date(2026, 8, 13, 0, 5));
    mocks.recordRoleOutcome.mockRejectedValueOnce(new Error("Unconfirmed"));
    render(<FindRolesScreen />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Current resume" }));
    fireEvent.click(screen.getByRole("button", { name: "Find roles" }));
    fireEvent.click(await screen.findByRole("button", { name: "Track outcome" }));
    const note = await screen.findByPlaceholderText("Note (optional) - e.g. what they asked, feedback given");
    fireEvent.change(note, { target: { value: "  Submitted my application  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    vi.setSystemTime(new Date(2026, 8, 14, 0, 5));
    await waitFor(() => expect(mocks.recordRoleOutcome).toHaveBeenCalledTimes(1));
    const first = mocks.recordRoleOutcome.mock.calls[0]![0];
    expect(first.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.occurredAt).toBe("2026-09-13");
    expect(note).toBeDisabled();
    mocks.recordRoleOutcome.mockResolvedValueOnce({ id: first.eventId, stage: "applied", note: "Submitted my application", occurred_at: first.occurredAt });
    fireEvent.click(await screen.findByRole("button", { name: "Retry save" }));
    await waitFor(() => expect(mocks.recordRoleOutcome).toHaveBeenCalledTimes(2));
    expect(mocks.recordRoleOutcome.mock.calls[1]![0]).toEqual(first);
    await waitFor(() => expect(note).toHaveValue(""));
    expect(note).toBeEnabled();
  });

  it("regression: ignores history from a previously selected role", async () => {
    let resolve!: (value: unknown[]) => void;
    mocks.jobMatch.mockResolvedValueOnce({ summary: "Two matches", role_ideas: [], listings: [
      { title: "Building Manager", employer: "Example Co", location: "Melbourne" },
      { title: "Operations Manager", employer: "Other Co", location: "Melbourne" },
    ] });
    mocks.fetchRoleOutcomes.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    mocks.fetchRoleOutcomes.mockResolvedValueOnce([{ id: "b-event", stage: "applied", note: "B history", occurred_at: "2026-09-13" }]);
    render(<FindRolesScreen />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Current resume" }));
    fireEvent.click(screen.getByRole("button", { name: "Find roles" }));
    fireEvent.click(await screen.findByRole("button", { name: "Track outcome" }));
    await waitFor(() => expect(mocks.fetchRoleOutcomes).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /Operations Manager Other Co/ }));
    fireEvent.click(screen.getByRole("button", { name: "Track outcome" }));
    await screen.findByText("B history");
    await act(async () => resolve([{ id: "a-event", stage: "applied", note: "A history", occurred_at: "2026-09-13" }]));
    expect(screen.queryByText("A history")).not.toBeInTheDocument();
    expect(screen.getByText("B history")).toBeInTheDocument();
  });

  it("keeps the user's chosen action plan open when older outcome history arrives", async () => {
    let resolve!: (value: unknown[]) => void;
    mocks.fetchRoleOutcomes.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(<FindRolesScreen />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Current resume" }));
    fireEvent.click(screen.getByRole("button", { name: "Find roles" }));
    fireEvent.click(await screen.findByRole("button", { name: "Track outcome" }));
    await waitFor(() => expect(mocks.fetchRoleOutcomes).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Action plan" }));
    await screen.findByText("Review the role");
    await act(async () => resolve([{ id: "a-event", stage: "applied", note: "Older history", occurred_at: "2026-09-13" }]));
    expect(screen.getByText("Review the role")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Outcome tracker" })).not.toBeInTheDocument();
  });

  it("does not deliver a late save into a different role and reopens the saved event without a phantom retry", async () => {
    let resolve!: (value: unknown) => void;
    mocks.jobMatch.mockResolvedValueOnce({ summary: "Two matches", role_ideas: [], listings: [
      { title: "Building Manager", employer: "Example Co", location: "Melbourne" },
      { title: "Operations Manager", employer: "Other Co", location: "Melbourne" },
    ] });
    mocks.recordRoleOutcome.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(<FindRolesScreen />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Current resume" }));
    fireEvent.click(screen.getByRole("button", { name: "Find roles" }));
    fireEvent.click(await screen.findByRole("button", { name: "Track outcome" }));
    fireEvent.change(await screen.findByPlaceholderText("Note (optional) - e.g. what they asked, feedback given"), { target: { value: "A saved note" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(mocks.recordRoleOutcome).toHaveBeenCalledTimes(1));
    const command = mocks.recordRoleOutcome.mock.calls[0]![0];
    fireEvent.click(screen.getByRole("button", { name: /Operations Manager Other Co/ }));
    mocks.fetchRoleOutcomes.mockResolvedValueOnce([{ id: "b-event", stage: "applied", note: "B history", occurred_at: "2026-09-13" }]);
    fireEvent.click(screen.getByRole("button", { name: "Track outcome" }));
    await screen.findByText("B history");
    const row = { id: command.eventId, stage: "applied", note: "A saved note", occurred_at: command.occurredAt };
    await act(async () => resolve(row));
    expect(screen.getByText("B history")).toBeInTheDocument();
    expect(screen.queryByText("A saved note")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Building Manager Example Co/ }));
    mocks.fetchRoleOutcomes.mockResolvedValueOnce([row]);
    fireEvent.click(screen.getByRole("button", { name: /^Outcome$/ }));
    await screen.findByText("A saved note");
    expect(screen.getByRole("button", { name: /^Add$/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Retry save" })).not.toBeInTheDocument();
  });

  it("does not retry an uncertain outcome under a replacement owner epoch", async () => {
    mocks.recordRoleOutcome.mockRejectedValueOnce(new Error("Unconfirmed"));
    render(<FindRolesScreen />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Current resume" }));
    fireEvent.click(screen.getByRole("button", { name: "Find roles" }));
    fireEvent.click(await screen.findByRole("button", { name: "Track outcome" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    const retry = await screen.findByRole("button", { name: "Retry save" });
    recordBrowserPrincipal("user-2"); recordBrowserPrincipal("user-1");
    fireEvent.click(retry);
    expect(mocks.recordRoleOutcome).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Your signed-in account changed. Refresh this page to reload saved history before recording another outcome.")).toBeInTheDocument();
  });

  it("allocates a new identity only for a deliberate new Add after confirmed success", async () => {
    mocks.recordRoleOutcome.mockImplementation(async command => ({ id: command.eventId,
      stage: command.stage, note: command.note ?? null, occurred_at: command.occurredAt }));
    render(<FindRolesScreen />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Current resume" }));
    fireEvent.click(screen.getByRole("button", { name: "Find roles" }));
    fireEvent.click(await screen.findByRole("button", { name: "Track outcome" }));
    const add = await screen.findByRole("button", { name: "Add" });
    fireEvent.click(add);
    fireEvent.click(add);
    await waitFor(() => expect(mocks.recordRoleOutcome).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(add).toHaveTextContent("Add"));
    fireEvent.click(add);
    await waitFor(() => expect(mocks.recordRoleOutcome).toHaveBeenCalledTimes(2));
    expect(mocks.recordRoleOutcome.mock.calls[1]![0].eventId).not.toBe(mocks.recordRoleOutcome.mock.calls[0]![0].eventId);
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
        expect.objectContaining({ expectedUserId: "user-1" }),
      ),
    );
  });

  it("accepts XLSX resumes and rejects oversized text before ingest", async () => {
    let finishUpload!: () => void;
    mocks.ingestUpload.mockReturnValueOnce(new Promise((resolve) => {
      finishUpload = () => resolve({
        upload_id: "upload-xlsx",
        extracted_text: "Synthetic resume evidence",
        confirm_payload: { summary: "Synthetic resume" },
      });
    }));
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

    expect(input).toBeDisabled();
    // Dispatch alone is not completion: a user cannot select a replacement
    // while this input is disabled for the preceding upload.
    await act(async () => finishUpload());
    expect(await screen.findByText("resume.xlsx", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Synthetic resume", { exact: true })).toBeInTheDocument();
    expect(input).toBeEnabled();
    expect(mocks.ingestUpload).toHaveBeenCalledTimes(1);

    const oversized = new File(["not read"], "resume.txt", { type: "text/plain" });
    Object.defineProperty(oversized, "size", { value: 1024 * 1024 + 1 });
    fireEvent.change(input!, { target: { files: [oversized] } });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "TXT, Markdown and CSV files need to be 1MB or smaller.",
    );
    expect(mocks.ingestUpload).toHaveBeenCalledTimes(1);
    expect(screen.getByText("resume.xlsx", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Synthetic resume", { exact: true })).toBeInTheDocument();
    expect(input).toBeEnabled();
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

  it.each(["committed", "revision_conflict"] as const)(
    "adopts a current %s action receipt and uses its token for the next toggle",
    async (disposition) => {
      const toggle = deferred<RoleActionItemMutationResult>();
      const persistedItem: RoleActionItem = {
        ...actionBeforeToggle,
        status: "done",
        mutation_token: "a5000000-0000-4000-8000-000000000002",
      };
      mocks.setActionItemStatus.mockReturnValueOnce(toggle.promise);
      mocks.setActionItemStatus.mockResolvedValueOnce({
        status: "committed",
        affectedRows: 1,
        item: {
          ...persistedItem,
          status: "pending",
          mutation_token: "a5000000-0000-4000-8000-000000000003",
        },
      });
      render(<FindRolesScreen />);
      fireEvent.click(await screen.findByRole("checkbox", { name: "Current resume" }));
      fireEvent.click(screen.getByRole("button", { name: "Find roles" }));
      fireEvent.click(await screen.findByRole("button", { name: "Action plan" }));
      const item = await screen.findByRole("checkbox", { name: actionBeforeToggle.label });
      fireEvent.click(item);
      expect(item).toBeDisabled();
      expect(item).not.toBeChecked();

      await act(async () => {
        toggle.resolve(disposition === "committed"
          ? { status: "committed", affectedRows: 1, item: persistedItem }
          : { status: "revision_conflict", affectedRows: 0, item: persistedItem });
      });

      expect(item).toBeChecked();
      expect(item).toBeEnabled();
      if (disposition === "revision_conflict") {
        expect(screen.getByRole("alert")).toHaveTextContent(
          "That action changed elsewhere. The latest saved status is shown.",
        );
      } else {
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      }
      fireEvent.click(item);
      expect(mocks.setActionItemStatus).toHaveBeenNthCalledWith(2, {
        id: persistedItem.id,
        expectedMutationToken: persistedItem.mutation_token,
        status: "pending",
      }, expect.objectContaining({ expectedUserId: "user-1" }));
      await waitFor(() => expect(item).not.toBeChecked());
      expect(item).toBeEnabled();
    },
  );

  describe.each([
    "same-role reload",
    "role A-to-B-to-A",
    "another role",
    "owner A-to-B-to-A",
  ] as const)("action acknowledgement after %s", (targetChange) => {
    it.each(["committed", "revision_conflict", "error"] as const)(
      "preserves the newer read and its retry token when the older toggle returns %s",
      async (disposition) => {
        const toggle = deferred<RoleActionItemMutationResult>();
        const olderItem: RoleActionItem = {
          ...actionBeforeToggle,
          status: "done",
          mutation_token: "a5000000-0000-4000-8000-000000000002",
        };
        // The original write (or its conflict snapshot) predates another
        // client's change back to pending. The later read is authoritative
        // even though the original response has not reached this screen yet.
        const newerItem: RoleActionItem = {
          ...actionBeforeToggle,
          mutation_token: "a5000000-0000-4000-8000-000000000003",
        };
        const otherRoleItem: RoleActionItem = {
          ...actionBeforeToggle,
          id: "a4000000-0000-4000-8000-000000000002",
          label: "Prepare the Operations application",
          mutation_token: "a5000000-0000-4000-8000-000000000004",
        };
        const showsOtherRole = targetChange === "another role";
        const switchesRoles = showsOtherRole || targetChange === "role A-to-B-to-A";
        const currentItem = showsOtherRole ? otherRoleItem : newerItem;
        if (switchesRoles) {
          mocks.jobMatch.mockResolvedValueOnce({
            summary: "Two matches",
            role_ideas: [],
            listings: [
              { title: "Building Manager", employer: "Example Co", location: "Melbourne" },
              { title: "Operations Manager", employer: "Other Co", location: "Melbourne" },
            ],
          });
          mocks.saveRole.mockResolvedValueOnce("saved-role-1").mockResolvedValueOnce("saved-role-2");
        }
        mocks.fetchActionItems.mockResolvedValueOnce([actionBeforeToggle]);
        if (switchesRoles) mocks.fetchActionItems.mockResolvedValueOnce([otherRoleItem]);
        if (!showsOtherRole) mocks.fetchActionItems.mockResolvedValueOnce([newerItem]);
        mocks.setActionItemStatus.mockReturnValueOnce(toggle.promise);
        mocks.setActionItemStatus.mockResolvedValueOnce({
          status: "committed",
          affectedRows: 1,
          item: {
            ...currentItem,
            status: "done",
            mutation_token: "a5000000-0000-4000-8000-000000000005",
          },
        });
        render(<FindRolesScreen />);
        fireEvent.click(await screen.findByRole("checkbox", { name: "Current resume" }));
        fireEvent.click(screen.getByRole("button", { name: "Find roles" }));
        fireEvent.click(await screen.findByRole("button", { name: "Action plan" }));
        const originalItem = await screen.findByRole("checkbox", { name: actionBeforeToggle.label });
        fireEvent.click(originalItem);
        expect(mocks.setActionItemStatus).toHaveBeenCalledTimes(1);
        expect(mocks.setActionItemStatus).toHaveBeenNthCalledWith(1, {
          id: actionBeforeToggle.id,
          expectedMutationToken: actionBeforeToggle.mutation_token,
          status: "done",
        }, expect.objectContaining({ expectedUserId: "user-1" }));
        expect(originalItem).toBeDisabled();
        expect(originalItem).not.toBeChecked();

        if (targetChange === "owner A-to-B-to-A") {
          recordBrowserPrincipal("user-2");
          recordBrowserPrincipal("user-1");
        }
        if (switchesRoles) {
          fireEvent.click(screen.getByRole("button", { name: /Operations Manager Other Co/ }));
          fireEvent.click(screen.getByRole("button", { name: "Action plan" }));
          await screen.findByRole("checkbox", { name: otherRoleItem.label });
        }
        if (targetChange === "role A-to-B-to-A") {
          fireEvent.click(screen.getByRole("button", { name: /Building Manager Example Co/ }));
        }
        if (!showsOtherRole) {
          fireEvent.click(screen.getByRole("button", { name: "Action plan" }));
        }
        const currentCheckbox = await screen.findByRole("checkbox", { name: currentItem.label });
        expect(mocks.fetchActionItems).toHaveBeenCalledTimes(
          targetChange === "role A-to-B-to-A" ? 3 : 2,
        );
        expect(currentCheckbox).not.toBeChecked();
        if (!showsOtherRole) expect(currentCheckbox).toBeDisabled();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();

        await act(async () => {
          if (disposition === "error") {
            toggle.reject(new Error("The earlier action write could not be confirmed"));
          } else {
            toggle.resolve(disposition === "committed"
              ? { status: "committed", affectedRows: 1, item: olderItem }
              : { status: "revision_conflict", affectedRows: 0, item: olderItem });
          }
        });

        expect(currentCheckbox).not.toBeChecked();
        expect(currentCheckbox).toBeEnabled();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(mocks.setActionItemStatus).toHaveBeenCalledTimes(1);
        if (showsOtherRole) {
          expect(screen.queryByRole("checkbox", { name: actionBeforeToggle.label })).not.toBeInTheDocument();
        }

        fireEvent.click(currentCheckbox);
        expect(mocks.setActionItemStatus).toHaveBeenNthCalledWith(2, {
          id: currentItem.id,
          expectedMutationToken: currentItem.mutation_token,
          status: "done",
        }, expect.objectContaining({ expectedUserId: "user-1" }));
        await waitFor(() => expect(currentCheckbox).toBeChecked());
        expect(currentCheckbox).toBeEnabled();
      },
    );
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
      "TED couldn't confirm that action was saved. Open Action plan to reload its saved status before trying again.",
    );
  });

  it("reports an unconfirmed write after acknowledgement loss and reloads the committed action before retrying", async () => {
    const lostAcknowledgement = deferred<RoleActionItemMutationResult>();
    let storedItem: RoleActionItem = { ...actionBeforeToggle };
    mocks.fetchActionItems.mockImplementation(async () => [{ ...storedItem }]);
    mocks.setActionItemStatus.mockImplementationOnce(() => {
      storedItem = {
        ...storedItem,
        status: "done",
        mutation_token: "a5000000-0000-4000-8000-000000000002",
      };
      return lostAcknowledgement.promise;
    });
    mocks.setActionItemStatus.mockImplementationOnce(async () => {
      storedItem = {
        ...storedItem,
        status: "pending",
        mutation_token: "a5000000-0000-4000-8000-000000000003",
      };
      return { status: "committed", affectedRows: 1, item: { ...storedItem } };
    });
    render(<FindRolesScreen />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Current resume" }));
    fireEvent.click(screen.getByRole("button", { name: "Find roles" }));
    fireEvent.click(await screen.findByRole("button", { name: "Action plan" }));
    const originalCheckbox = await screen.findByRole("checkbox", { name: actionBeforeToggle.label });
    fireEvent.click(originalCheckbox);
    expect(storedItem.status).toBe("done");
    expect(originalCheckbox).not.toBeChecked();
    expect(originalCheckbox).toBeDisabled();

    await act(async () => lostAcknowledgement.reject(new Error("Connection lost after commit")));
    expect(originalCheckbox).not.toBeChecked();
    expect(originalCheckbox).toBeEnabled();
    const failureNotice = screen.getByRole("alert").textContent;
    expect(mocks.setActionItemStatus).toHaveBeenCalledTimes(1);
    expect(mocks.fetchActionItems).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Action plan" }));
    const reloadedCheckbox = await screen.findByRole("checkbox", { name: actionBeforeToggle.label });
    expect(reloadedCheckbox).toBeChecked();
    expect(reloadedCheckbox).toBeEnabled();
    expect(mocks.fetchActionItems).toHaveBeenNthCalledWith(2, "saved-role-1",
      expect.objectContaining({ expectedUserId: "user-1" }));

    fireEvent.click(reloadedCheckbox);
    expect(mocks.setActionItemStatus).toHaveBeenNthCalledWith(2, {
      id: actionBeforeToggle.id,
      expectedMutationToken: "a5000000-0000-4000-8000-000000000002",
      status: "pending",
    }, expect.objectContaining({ expectedUserId: "user-1" }));
    await waitFor(() => expect(reloadedCheckbox).not.toBeChecked());
    expect(reloadedCheckbox).toBeEnabled();
    expect(storedItem.status).toBe("pending");
    expect(failureNotice).toContain(
      "TED couldn't confirm that action was saved. Open Action plan to reload its saved status before trying again.",
    );
    expect(failureNotice).not.toContain("previous status is unchanged");
  });

  describe.each(["reload", "committed retry"] as const)("action notice recovery by %s", (recovery) => {
    it.each(["unconfirmed write", "revision conflict"] as const)(
      "clears the preceding %s notice only after the current recovery succeeds",
      async (noticeKind) => {
        const reload = deferred<RoleActionItem[]>();
        const retry = deferred<RoleActionItemMutationResult>();
        const conflicted = noticeKind === "revision conflict";
        const conflictedItem: RoleActionItem = {
          ...actionBeforeToggle,
          status: "done",
          mutation_token: "a5000000-0000-4000-8000-000000000002",
        };
        const confirmedItem: RoleActionItem = {
          ...actionBeforeToggle,
          status: recovery === "committed retry" && conflicted ? "pending" : "done",
          mutation_token: "a5000000-0000-4000-8000-000000000003",
        };
        mocks.fetchActionItems.mockResolvedValueOnce([actionBeforeToggle]);
        if (conflicted) {
          mocks.setActionItemStatus.mockResolvedValueOnce({
            status: "revision_conflict", affectedRows: 0, item: conflictedItem,
          });
        } else {
          mocks.setActionItemStatus.mockRejectedValueOnce(new Error("Acknowledgement unavailable"));
        }
        if (recovery === "reload") mocks.fetchActionItems.mockReturnValueOnce(reload.promise);
        else mocks.setActionItemStatus.mockReturnValueOnce(retry.promise);
        render(<FindRolesScreen />);
        fireEvent.click(await screen.findByRole("checkbox", { name: "Current resume" }));
        fireEvent.click(screen.getByRole("button", { name: "Find roles" }));
        fireEvent.click(await screen.findByRole("button", { name: "Action plan" }));
        const item = await screen.findByRole("checkbox", { name: actionBeforeToggle.label });
        fireEvent.click(item);
        const notice = await screen.findByRole("alert");
        const noticeText = notice.textContent ?? "";
        expect(noticeText).not.toBe("");
        await waitFor(() => expect(item).toBeEnabled());
        if (conflicted) expect(item).toBeChecked();
        else expect(item).not.toBeChecked();

        if (recovery === "reload") {
          fireEvent.click(screen.getByRole("button", { name: "Action plan" }));
          expect(mocks.fetchActionItems).toHaveBeenCalledTimes(2);
        } else {
          fireEvent.click(item);
          expect(mocks.setActionItemStatus).toHaveBeenNthCalledWith(2, {
            id: actionBeforeToggle.id,
            expectedMutationToken: conflicted ? conflictedItem.mutation_token : actionBeforeToggle.mutation_token,
            status: confirmedItem.status,
          }, expect.objectContaining({ expectedUserId: "user-1" }));
          expect(item).toBeDisabled();
        }
        expect(screen.getByRole("alert")).toHaveTextContent(noticeText);
        await act(async () => {
          if (recovery === "reload") reload.resolve([confirmedItem]);
          else retry.resolve({ status: "committed", affectedRows: 1, item: confirmedItem });
        });
        const confirmedCheckbox = screen.getByRole("checkbox", { name: confirmedItem.label });
        if (confirmedItem.status === "done") expect(confirmedCheckbox).toBeChecked();
        else expect(confirmedCheckbox).not.toBeChecked();
        expect(confirmedCheckbox).toBeEnabled();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      },
    );

    it("preserves an unrelated apply-page warning raised while recovery is pending", async () => {
      const reload = deferred<RoleActionItem[]>();
      const retry = deferred<RoleActionItemMutationResult>();
      const confirmedItem: RoleActionItem = {
        ...actionBeforeToggle,
        status: "done",
        mutation_token: "a5000000-0000-4000-8000-000000000002",
      };
      mocks.fetchActionItems.mockResolvedValueOnce([actionBeforeToggle]);
      if (recovery === "reload") mocks.fetchActionItems.mockReturnValueOnce(reload.promise);
      else mocks.setActionItemStatus.mockReturnValueOnce(retry.promise);
      render(<FindRolesScreen />);
      fireEvent.click(await screen.findByRole("checkbox", { name: "Current resume" }));
      fireEvent.click(screen.getByRole("button", { name: "Find roles" }));
      fireEvent.click(await screen.findByRole("button", { name: "Action plan" }));
      const item = await screen.findByRole("checkbox", { name: actionBeforeToggle.label });
      if (recovery === "reload") fireEvent.click(screen.getByRole("button", { name: "Action plan" }));
      else fireEvent.click(item);
      fireEvent.click(screen.getByRole("button", { name: "Open apply" }));
      const unrelatedWarning = "No source-linked apply page was returned for this role. Check the employer's careers page directly.";
      expect(screen.getByRole("alert")).toHaveTextContent(unrelatedWarning);

      await act(async () => {
        if (recovery === "reload") reload.resolve([confirmedItem]);
        else retry.resolve({ status: "committed", affectedRows: 1, item: confirmedItem });
      });
      expect(screen.getByRole("checkbox", { name: confirmedItem.label })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: confirmedItem.label })).toBeEnabled();
      expect(screen.getByRole("alert")).toHaveTextContent(unrelatedWarning);
    });
  });

  it.each(["read", "commit"] as const)(
    "does not let an older successful action %s clear a newer action-status notice",
    async (olderOperation) => {
      const olderRead = deferred<RoleActionItem[]>();
      const olderCommit = deferred<RoleActionItemMutationResult>();
      const otherItem: RoleActionItem = {
        ...actionBeforeToggle,
        id: "a4000000-0000-4000-8000-000000000002",
        label: "Prepare your application",
        mutation_token: "a5000000-0000-4000-8000-000000000004",
      };
      const olderItem: RoleActionItem = {
        ...actionBeforeToggle,
        status: "done",
        mutation_token: "a5000000-0000-4000-8000-000000000002",
      };
      const newerItem: RoleActionItem = {
        ...actionBeforeToggle,
        mutation_token: "a5000000-0000-4000-8000-000000000003",
      };
      mocks.fetchActionItems.mockResolvedValueOnce([actionBeforeToggle, otherItem]);
      if (olderOperation === "read") mocks.fetchActionItems.mockReturnValueOnce(olderRead.promise);
      else mocks.setActionItemStatus.mockReturnValueOnce(olderCommit.promise);
      mocks.fetchActionItems.mockResolvedValueOnce([newerItem, otherItem]);
      mocks.setActionItemStatus.mockRejectedValueOnce(new Error("The newer action write is unconfirmed"));
      render(<FindRolesScreen />);
      fireEvent.click(await screen.findByRole("checkbox", { name: "Current resume" }));
      fireEvent.click(screen.getByRole("button", { name: "Find roles" }));
      fireEvent.click(await screen.findByRole("button", { name: "Action plan" }));
      const initialCheckbox = await screen.findByRole("checkbox", { name: actionBeforeToggle.label });
      if (olderOperation === "read") {
        fireEvent.click(screen.getByRole("button", { name: "Action plan" }));
        expect(mocks.fetchActionItems).toHaveBeenCalledTimes(2);
      } else {
        fireEvent.click(initialCheckbox);
        expect(initialCheckbox).toBeDisabled();
      }
      fireEvent.click(screen.getByRole("button", { name: "Action plan" }));
      const otherCheckbox = await screen.findByRole("checkbox", { name: otherItem.label });
      fireEvent.click(otherCheckbox);
      const newerNotice = await screen.findByRole("alert");
      const newerNoticeText = newerNotice.textContent ?? "";
      expect(newerNoticeText).not.toBe("");
      await waitFor(() => expect(otherCheckbox).toBeEnabled());

      await act(async () => {
        if (olderOperation === "read") olderRead.resolve([olderItem, otherItem]);
        else olderCommit.resolve({ status: "committed", affectedRows: 1, item: olderItem });
      });
      expect(screen.getByRole("alert")).toHaveTextContent(newerNoticeText);
      expect(screen.getByRole("checkbox", { name: newerItem.label })).not.toBeChecked();
      expect(screen.getByRole("checkbox", { name: newerItem.label })).toBeEnabled();
      expect(otherCheckbox).not.toBeChecked();
    },
  );

  it.each(["before", "after"] as const)(
    "preserves another item's warning when a successful same-panel toggle starts %s that warning",
    async (startOrder) => {
      const successfulToggle = deferred<RoleActionItemMutationResult>();
      const otherItem: RoleActionItem = {
        ...actionBeforeToggle,
        id: "a4000000-0000-4000-8000-000000000002",
        label: "Prepare your application",
        mutation_token: "a5000000-0000-4000-8000-000000000004",
      };
      mocks.fetchActionItems.mockResolvedValueOnce([actionBeforeToggle, otherItem]);
      mocks.setActionItemStatus.mockImplementation((command: { id: string }) =>
        command.id === actionBeforeToggle.id
          ? successfulToggle.promise
          : Promise.reject(new Error("The other action's saved status is unconfirmed")),
      );
      render(<FindRolesScreen />);
      fireEvent.click(await screen.findByRole("checkbox", { name: "Current resume" }));
      fireEvent.click(screen.getByRole("button", { name: "Find roles" }));
      fireEvent.click(await screen.findByRole("button", { name: "Action plan" }));
      const successfulCheckbox = await screen.findByRole("checkbox", { name: actionBeforeToggle.label });
      const otherCheckbox = screen.getByRole("checkbox", { name: otherItem.label });
      if (startOrder === "before") fireEvent.click(successfulCheckbox);
      fireEvent.click(otherCheckbox);
      const otherNotice = await screen.findByRole("alert");
      const otherNoticeText = otherNotice.textContent ?? "";
      expect(otherNoticeText).not.toBe("");
      await waitFor(() => expect(otherCheckbox).toBeEnabled());
      if (startOrder === "after") fireEvent.click(successfulCheckbox);
      expect(successfulCheckbox).toBeDisabled();
      expect(mocks.setActionItemStatus).toHaveBeenCalledTimes(2);

      await act(async () => successfulToggle.resolve({
        status: "committed",
        affectedRows: 1,
        item: {
          ...actionBeforeToggle,
          status: "done",
          mutation_token: "a5000000-0000-4000-8000-000000000003",
        },
      }));
      expect(successfulCheckbox).toBeChecked();
      expect(successfulCheckbox).toBeEnabled();
      expect(otherCheckbox).not.toBeChecked();
      expect(screen.getByRole("alert")).toHaveTextContent(otherNoticeText);
      expect(mocks.fetchActionItems).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["unconfirmed write", "revision conflict", "unrelated apply warning"] as const)(
    "retires only the prior role's action notice on explicit selection: %s",
    async (noticeKind) => {
      const unrelated = noticeKind === "unrelated apply warning";
      const otherRoleItem: RoleActionItem = {
        ...actionBeforeToggle,
        id: "a4000000-0000-4000-8000-000000000002",
        label: "Prepare the Operations application",
        mutation_token: "a5000000-0000-4000-8000-000000000004",
      };
      mocks.jobMatch.mockResolvedValueOnce({
        summary: "Two matches",
        role_ideas: [],
        listings: [
          { title: "Building Manager", employer: "Example Co", location: "Melbourne" },
          { title: "Operations Manager", employer: "Other Co", location: "Melbourne" },
        ],
      });
      mocks.saveRole.mockResolvedValueOnce("saved-role-1").mockResolvedValueOnce("saved-role-2");
      mocks.fetchActionItems.mockResolvedValueOnce([actionBeforeToggle]).mockResolvedValueOnce([otherRoleItem]);
      if (noticeKind === "unconfirmed write") {
        mocks.setActionItemStatus.mockRejectedValueOnce(new Error("The original action is unconfirmed"));
      } else if (noticeKind === "revision conflict") {
        mocks.setActionItemStatus.mockResolvedValueOnce({
          status: "revision_conflict",
          affectedRows: 0,
          item: {
            ...actionBeforeToggle,
            status: "done",
            mutation_token: "a5000000-0000-4000-8000-000000000002",
          },
        });
      }
      render(<FindRolesScreen />);
      fireEvent.click(await screen.findByRole("checkbox", { name: "Current resume" }));
      fireEvent.click(screen.getByRole("button", { name: "Find roles" }));
      fireEvent.click(await screen.findByRole("button", { name: "Action plan" }));
      const originalCheckbox = await screen.findByRole("checkbox", { name: actionBeforeToggle.label });
      if (unrelated) fireEvent.click(screen.getByRole("button", { name: "Open apply" }));
      else fireEvent.click(originalCheckbox);
      const originalNotice = await screen.findByRole("alert");
      const originalNoticeText = originalNotice.textContent;
      expect(originalNoticeText).toBeTruthy();
      await waitFor(() => expect(originalCheckbox).toBeEnabled());

      fireEvent.click(screen.getByRole("button", { name: /Operations Manager Other Co/ }));
      const noticeAfterSelection = screen.queryByRole("alert")?.textContent ?? null;
      expect(screen.queryByRole("checkbox", { name: actionBeforeToggle.label })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Action plan" }));
      expect(await screen.findByRole("checkbox", { name: otherRoleItem.label })).not.toBeChecked();
      expect(mocks.fetchActionItems).toHaveBeenNthCalledWith(2, "saved-role-2",
        expect.objectContaining({ expectedUserId: "user-1" }));
      const noticeAfterOtherRoleRead = screen.queryByRole("alert")?.textContent ?? null;
      fireEvent.click(screen.getByRole("button", { name: /Building Manager Example Co/ }));
      const noticeAfterReturning = screen.queryByRole("alert")?.textContent ?? null;

      const expectedNotice = unrelated ? originalNoticeText : null;
      expect(noticeAfterSelection).toBe(expectedNotice);
      expect(noticeAfterOtherRoleRead).toBe(expectedNotice);
      expect(noticeAfterReturning).toBe(expectedNotice);
      expect(mocks.setActionItemStatus).toHaveBeenCalledTimes(unrelated ? 0 : 1);
      expect(mocks.fetchActionItems).toHaveBeenCalledTimes(2);
    },
  );

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
