import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MasterWorkspaceImport } from "./MasterWorkspaceImport";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";

const auth = vi.hoisted(() => ({ user: null as null | { id: string }, loading: true }));
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  prepareUploadSource: vi.fn(),
  classifiedIngest: vi.fn(),
  commitDocumentImport: vi.fn(),
  getWorkspaceUpload: vi.fn(),
  savePendingOutcome: vi.fn(),
  saveWorkspace: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/components/providers", () => ({
  useAuth: () => auth,
}));
vi.mock("@prompted/shared/api-client", async () => {
  const actual = await vi.importActual<typeof import("@prompted/shared/api-client")>(
    "@prompted/shared/api-client",
  );
  return { ...actual, prepareUploadSource: mocks.prepareUploadSource, ingestUpload: mocks.classifiedIngest };
});
vi.mock("@/lib/api", () => ({ ensureApiConfigured: () => undefined }));
vi.mock("@/lib/api/import-workspace", () => ({
  commitDocumentImport: mocks.commitDocumentImport,
  getWorkspaceUpload: mocks.getWorkspaceUpload,
}));
vi.mock("@/lib/workspace-store", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/workspace-store")>("@/lib/workspace-store");
  return {
    ...actual,
    savePendingOutcome: mocks.savePendingOutcome,
    saveWorkspace: mocks.saveWorkspace,
  };
});

describe("MasterWorkspaceImport", () => {
  beforeEach(() => {
    recordBrowserPrincipal(undefined);
    vi.resetAllMocks();
    auth.loading = true;
    auth.user = null;
    mocks.classifiedIngest.mockRejectedValue(new Error("Provider unavailable"));
    mocks.prepareUploadSource.mockResolvedValue({
      upload_id: "upload-1",
      extracted_text: "Experience\n\nManaged daily workspace operations.",
      truncated: false,
      classification_status: "not_requested",
    });
    mocks.getWorkspaceUpload.mockResolvedValue({ original: { storage_path: "synthetic original" } });
    mocks.commitDocumentImport.mockImplementation(async (input) => ({
      status: "committed",
      outcome_id: input.outcomeId,
      document_id: input.documentId,
      idempotent_replay: false,
    }));
  });

  afterEach(() => recordBrowserPrincipal(undefined));

  it("keeps the destination heading and disables the upload surface while auth loads", () => {
    render(<MasterWorkspaceImport />);
    expect(screen.getByRole("heading", { name: "Master Workspace", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Preparing workspace");
    expect(screen.getByRole("button", { name: /Drop a document/i })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("asks signed-out users to sign in before requesting a personal file", () => {
    auth.loading = false;
    auth.user = null;
    render(<MasterWorkspaceImport />);
    expect(screen.getByRole("link", { name: /Sign in to upload/i })).toHaveAttribute(
      "href",
      "/sign-in",
    );
    expect(screen.queryByRole("button", { name: /Drop a document/i })).not.toBeInTheDocument();
  });

  it("reviews a successful ingest before committing and navigating", async () => {
    auth.loading = false;
    auth.user = { id: "user-1" };
    recordBrowserPrincipal("user-1");
    const { container } = render(<MasterWorkspaceImport />);
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();

    fireEvent.change(input!, {
      target: { files: [new File(["resume"], "Resume.txt", { type: "text/plain" })] },
    });

    await screen.findByRole("region", { name: "Review imported document" });
    expect(mocks.commitDocumentImport).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() => expect(mocks.commitDocumentImport).toHaveBeenCalledTimes(1));
    expect(mocks.savePendingOutcome).toHaveBeenCalledTimes(1);
    expect(mocks.saveWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith(expect.stringMatching(/^\/outcomes\//));
  });

  it("prepares a source for owner review without depending on classified ingestion", async () => {
    auth.loading = false;
    auth.user = { id: "user-1" };
    recordBrowserPrincipal("user-1");
    mocks.prepareUploadSource.mockResolvedValueOnce({
      upload_id: "upload-1", extracted_text: "Experience\n\nManaged daily workspace operations.",
      classification_status: "not_requested", truncated: false,
    });
    const { container } = render(<MasterWorkspaceImport />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("Upload input missing");
    fireEvent.change(input, { target: { files: [new File(["resume"], "Resume.txt", { type: "text/plain" })] } });
    await screen.findByRole("region", { name: "Review imported document" });
    expect(mocks.prepareUploadSource).toHaveBeenCalledTimes(1);
    expect(mocks.classifiedIngest).not.toHaveBeenCalled();
    expect(screen.queryByText(/OpenAI credit was exhausted/)).not.toBeInTheDocument();
    expect(mocks.commitDocumentImport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Choose another file" }));
    expect(screen.queryByText(/OpenAI credit was exhausted/)).not.toBeInTheDocument();
  });

  it("accepts XLSX and rejects oversized text before ingest", async () => {
    auth.loading = false;
    auth.user = { id: "user-1" };
    recordBrowserPrincipal("user-1");
    const { container } = render(<MasterWorkspaceImport />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toHaveAttribute("accept", expect.stringContaining(".xlsx"));
    const workbook = new File(["workbook"], "Evidence.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    fireEvent.change(input!, { target: { files: [workbook] } });
    await screen.findByRole("link", { name: "Open uploaded original" });
    expect(screen.queryByRole("region", { name: "Review imported document" })).not.toBeInTheDocument();
    expect(mocks.prepareUploadSource).toHaveBeenCalledWith(
      workbook,
      expect.any(String),
      expect.objectContaining({ expectedUserId: "user-1" }),
      expect.objectContaining({ beforeDispatch: expect.any(Function) }),
    );

    mocks.prepareUploadSource.mockClear();
    const oversized = new File(["not read"], "Evidence.csv", { type: "text/csv" });
    Object.defineProperty(oversized, "size", { value: 1024 * 1024 + 1 });
    fireEvent.change(input!, { target: { files: [oversized] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "TXT, Markdown and CSV files need to be 1MB or smaller.",
    );
    expect(mocks.prepareUploadSource).not.toHaveBeenCalled();
  });

  it("does not persist or navigate when the authenticated commit fails", async () => {
    auth.loading = false;
    auth.user = { id: "user-1" };
    recordBrowserPrincipal("user-1");
    mocks.commitDocumentImport.mockRejectedValueOnce(new Error("sync failed"));
    const { container } = render(<MasterWorkspaceImport />);

    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(["resume"], "Resume.txt", { type: "text/plain" })] },
    });
    await screen.findByRole("region", { name: "Review imported document" });
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    expect(await screen.findByText(/could not confirm.*save/i)).toBeInTheDocument();
    expect(mocks.savePendingOutcome).not.toHaveBeenCalled();
    expect(mocks.saveWorkspace).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it("rejects oversized RTF before dispatch or creating a document", async () => {
    auth.loading = false; auth.user = { id: "user-1" }; recordBrowserPrincipal("user-1");
    const view = render(<MasterWorkspaceImport />);
    const input = view.container.querySelector('input[type="file"]');
    expect(input).toHaveAttribute("accept", expect.stringContaining(".rtf"));
    const file = new File(["{\\rtf1 Source}"], "source.rtf", { type: "text/rtf" });
    Object.defineProperty(file, "size", { value: 1024 * 1024 + 1 });
    fireEvent.change(input!, { target: { files: [file] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("RTF files need to be 1MB or smaller.");
    expect(mocks.prepareUploadSource).not.toHaveBeenCalled();
    expect(mocks.commitDocumentImport).not.toHaveBeenCalled();
    expect(mocks.saveWorkspace).not.toHaveBeenCalled();
  });

  it.each([
    ["Original.pdf", "application/pdf"],
    ["Original.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["Original.rtf", "application/rtf"],
    ["Original.rtf", "text/rtf"],
    ["Original.rtf", ""],
  ])("retains %s without converting its preview into editor sections", async (name, type) => {
    auth.loading = false; auth.user = { id: "user-1" }; recordBrowserPrincipal("user-1");
    const view = render(<MasterWorkspaceImport />);
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(["original bytes"], name, { type })] } });
    expect(await screen.findByRole("link", { name: "Open uploaded original" })).toHaveAttribute("href", "/workspace?upload=upload-1");
    expect(mocks.prepareUploadSource).toHaveBeenCalledWith(expect.any(File), expect.any(String),
      expect.objectContaining({ expectedUserId: "user-1" }),
      expect.objectContaining({ metadataPolicyVersion: "upload-resource-policy.2", beforeDispatch: expect.any(Function) }));
    expect(screen.queryByRole("region", { name: "Review imported document" })).not.toBeInTheDocument();
    expect(mocks.commitDocumentImport).not.toHaveBeenCalled();
    expect(mocks.saveWorkspace).not.toHaveBeenCalled();
    expect(mocks.savePendingOutcome).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it("does not turn a truncated text preview into a complete editable import", async () => {
    auth.loading = false; auth.user = { id: "user-1" }; recordBrowserPrincipal("user-1");
    mocks.prepareUploadSource.mockResolvedValue({ upload_id: "upload-1", extracted_text: "only the start", truncated: true });
    const view = render(<MasterWorkspaceImport />);
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(["whole original"], "Original.md", { type: "text/markdown" })] } });
    await screen.findByRole("link", { name: "Open uploaded original" });
    expect(screen.queryByRole("region", { name: "Review imported document" })).not.toBeInTheDocument();
    expect(mocks.commitDocumentImport).not.toHaveBeenCalled();
  });
  it.each([true, false])("recovers the prepared upload identity after an uncertain source response with retention read %s", async (readable) => {
    auth.loading = false; auth.user = { id: "user-1" }; recordBrowserPrincipal("user-1");
    mocks.prepareUploadSource.mockImplementation(async (_file, _situation, _lease, options) => {
      options.beforeDispatch({ uploadId: "95071240-0000-8000-8000-000000000011" });
      throw new Error("failed to fetch");
    });
    if (!readable) mocks.getWorkspaceUpload.mockRejectedValue(new Error("read unavailable"));
    const view = render(<MasterWorkspaceImport />);
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(["original"], "Original.pdf", { type: "application/pdf" })] } });
    const link = await screen.findByRole("link", { name: readable ? "Open uploaded original" : "Check uploaded file" });
    expect(link).toHaveAttribute("href", "/workspace?upload=95071240-0000-8000-8000-000000000011");
    expect(screen.getByRole("alert")).toHaveTextContent(readable ? "Your original is available" : "Retention in your account is not yet confirmed");
    expect(mocks.commitDocumentImport).not.toHaveBeenCalled();
  });

  async function openReview(container: HTMLElement) {
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(["original"], "Original.txt", { type: "text/plain" })] },
    });
    await screen.findByRole("region", { name: "Review imported document" });
  }

  function signIn(id = "user-1") {
    auth.loading = false;
    auth.user = { id };
    recordBrowserPrincipal(id);
  }

  it("reopens the persisted destination on repeat-file import without caching candidate wording", async () => {
    signIn();
    mocks.commitDocumentImport.mockResolvedValue({
      status: "committed",
      idempotent_replay: true,
      outcome_id: "94061100-0000-4000-8000-000000000012",
      document_id: "94061100-0000-4000-8000-000000000013",
    });
    const { container } = render(<MasterWorkspaceImport />);
    await openReview(container);
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await screen.findByText(/already in your workspace/i);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Content" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Open saved workspace" }));
    expect(mocks.push).toHaveBeenCalledWith("/outcomes/94061100-0000-4000-8000-000000000012");
    expect(mocks.saveWorkspace).not.toHaveBeenCalled();
    expect(mocks.savePendingOutcome).not.toHaveBeenCalled();
  });

  it("reconciles a lost acknowledgement with the same identities and no replacement cache", async () => {
    signIn();
    mocks.commitDocumentImport
      .mockRejectedValueOnce(new Error("acknowledgement lost"))
      .mockImplementationOnce(async (input) => ({
        status: "committed",
        outcome_id: input.outcomeId,
        document_id: input.documentId,
        idempotent_replay: true,
      }));
    const { container } = render(<MasterWorkspaceImport />);
    await openReview(container);
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not confirm.*save/i);
    expect(screen.getByRole("alert")).not.toHaveTextContent("Nothing was added");
    expect(screen.getByRole("textbox", { name: "Content" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: /Section 1 name/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Choose another file" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Check saved import" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
    const [first] = mocks.commitDocumentImport.mock.calls[0]!;
    const [retry] = mocks.commitDocumentImport.mock.calls[1]!;
    expect(retry).toEqual(first);
    expect(mocks.push).toHaveBeenCalledWith(`/outcomes/${first.outcomeId}`);
    expect(mocks.saveWorkspace).not.toHaveBeenCalled();
    expect(mocks.savePendingOutcome).not.toHaveBeenCalled();
  });

  it.each(["user-2", null])(
    "hides a prior owner's pending original after owner becomes %s",
    async (id) => {
      signIn();
      const view = render(<MasterWorkspaceImport />);
      await openReview(view.container);
      auth.user = id ? { id } : null;
      recordBrowserPrincipal(id);
      view.rerender(<MasterWorkspaceImport />);
      expect(
        screen.queryByRole("region", { name: "Review imported document" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Create workspace" })).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue(/Managed daily workspace/)).not.toBeInTheDocument();
      expect(mocks.commitDocumentImport).not.toHaveBeenCalled();
    },
  );

  it("does not restore a pending original from an earlier same-user epoch", async () => {
    signIn();
    const view = render(<MasterWorkspaceImport />);
    await openReview(view.container);
    recordBrowserPrincipal("user-2");
    recordBrowserPrincipal("user-1");
    view.rerender(<MasterWorkspaceImport />);
    expect(
      screen.queryByRole("region", { name: "Review imported document" }),
    ).not.toBeInTheDocument();
    await openReview(view.container);
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
    expect(mocks.commitDocumentImport.mock.calls[0]![1].principalEpoch).toBeGreaterThan(
      mocks.prepareUploadSource.mock.calls[0]![2].principalEpoch,
    );
  });

  it("fences a late commit acknowledgement after unmount", async () => {
    signIn();
    let resolve!: (value: unknown) => void;
    mocks.commitDocumentImport.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = render(<MasterWorkspaceImport />);
    await openReview(view.container);
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    const [input, context] = mocks.commitDocumentImport.mock.calls[0]!;
    view.unmount();
    await act(async () =>
      resolve({
        status: "committed",
        outcome_id: input.outcomeId,
        document_id: input.documentId,
        idempotent_replay: false,
      }),
    );
    expect(context.signal.aborted).toBe(true);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.saveWorkspace).not.toHaveBeenCalled();
    expect(mocks.savePendingOutcome).not.toHaveBeenCalled();
  });

  it("admits only one confirmation before React renders the busy state", async () => {
    signIn();
    let resolve!: (value: unknown) => void;
    mocks.commitDocumentImport.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = render(<MasterWorkspaceImport />);
    await openReview(view.container);
    const button = screen.getByRole("button", { name: "Create workspace" });
    act(() => {
      button.click();
      button.click();
    });
    expect(mocks.commitDocumentImport).toHaveBeenCalledTimes(1);
    const [input] = mocks.commitDocumentImport.mock.calls[0]!;
    await act(async () =>
      resolve({
        status: "committed",
        outcome_id: input.outcomeId,
        document_id: input.documentId,
        idempotent_replay: false,
      }),
    );
  });

  it("keeps a fresh cloud commit usable when the device cache is unavailable", async () => {
    signIn();
    mocks.saveWorkspace.mockReturnValue({ status: "unavailable", reason: "quota_exceeded" });
    const view = render(<MasterWorkspaceImport />);
    await openReview(view.container);
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
    const [input] = mocks.commitDocumentImport.mock.calls[0]!;
    expect(mocks.push).toHaveBeenCalledWith(`/outcomes/${input.outcomeId}`);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("accepts a file after Strict Mode's setup and cleanup cycle", async () => {
    signIn();
    const view = render(
      <StrictMode>
        <MasterWorkspaceImport />
      </StrictMode>,
    );
    await openReview(view.container);
    const context = mocks.prepareUploadSource.mock.calls[0]![2];
    expect(context.signal.aborted).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
  });

  it("fences an upload result after unmount", async () => {
    signIn();
    let resolve!: (value: unknown) => void;
    mocks.prepareUploadSource.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = render(<MasterWorkspaceImport />);
    fireEvent.change(view.container.querySelector('input[type="file"]')!, {
      target: { files: [new File(["original"], "Original.txt", { type: "text/plain" })] },
    });
    const context = mocks.prepareUploadSource.mock.calls[0]![2];
    view.unmount();
    await act(async () => resolve({ upload_id: "upload-old", extracted_text: "Prior owner text" }));
    expect(context.signal.aborted).toBe(true);
    expect(mocks.commitDocumentImport).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("does not let a stale upload completion reset the new owner's request", async () => {
    signIn();
    let resolveOld!: (value: unknown) => void;
    let resolveNew!: (value: unknown) => void;
    mocks.prepareUploadSource
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolveOld = done;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolveNew = done;
          }),
      );
    const view = render(<MasterWorkspaceImport />);
    const input = view.container.querySelector('input[type="file"]')!;
    const upload = () =>
      fireEvent.change(input, {
        target: { files: [new File(["original"], "Original.txt", { type: "text/plain" })] },
      });
    upload();
    signIn("user-2");
    view.rerender(<MasterWorkspaceImport />);
    upload();
    await act(async () =>
      resolveOld({ upload_id: "old-upload", extracted_text: "Private old text" }),
    );
    expect(screen.getByRole("button", { name: /Drop a document/i })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.queryByText("Private old text")).not.toBeInTheDocument();
    await act(async () =>
      resolveNew({
        upload_id: "new-upload",
        extracted_text: "Current owner's original paragraph.",
      }),
    );
    await screen.findByRole("region", { name: "Review imported document" });
    expect(screen.getByRole("textbox", { name: "Content" })).toHaveValue(
      "Current owner's original paragraph.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() => expect(mocks.commitDocumentImport).toHaveBeenCalledTimes(1));
    expect(mocks.commitDocumentImport.mock.calls[0]![0].uploadId).toBe("new-upload");
    expect(mocks.commitDocumentImport.mock.calls[0]![1].expectedUserId).toBe("user-2");
  });

  it("fences a commit result after an account change", async () => {
    signIn();
    let resolve!: (value: unknown) => void;
    mocks.commitDocumentImport.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = render(<MasterWorkspaceImport />);
    await openReview(view.container);
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    const [input, context] = mocks.commitDocumentImport.mock.calls[0]!;
    signIn("user-2");
    view.rerender(<MasterWorkspaceImport />);
    await act(async () =>
      resolve({
        status: "committed",
        outcome_id: input.outcomeId,
        document_id: input.documentId,
        idempotent_replay: false,
      }),
    );
    expect(context.signal.aborted).toBe(true);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.saveWorkspace).not.toHaveBeenCalled();
    expect(mocks.savePendingOutcome).not.toHaveBeenCalled();
  });
});
