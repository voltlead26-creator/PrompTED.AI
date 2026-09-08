import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";
import { RetainedWorkspaceUploads } from "./RetainedWorkspaceUploads";

const mocks = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), download: vi.fn(), create: vi.fn(), revoke: vi.fn(), click: vi.fn() }));
const auth = vi.hoisted(() => ({ user: null as { id: string } | null, loading: false }));
vi.mock("@/components/providers", () => ({ useAuth: () => auth }));
vi.mock("@/lib/api/import-workspace", () => ({ listWorkspaceUploads: mocks.list, getWorkspaceUpload: mocks.detail, downloadWorkspaceUpload: mocks.download }));
const owner = "95071240-0000-4000-8000-000000000001";
const a = "95071240-0000-8000-8000-000000000011";
const b = "95071240-0000-8000-8000-000000000012";
const source = (id = a) => ({ upload_id: id, file_name: id === a ? "First.pdf" : "Second.docx", mime_type: "application/pdf", byte_length: 3,
  created_at: "2026-09-07T01:02:03.123456+00:00", status: "failed", ingest_status: "failed", format: "pdf",
  original: { storage_path: `${owner}/${id}/source.pdf`, sha256: null }, imported_document: null,
  preview: { text: "  <script>plain text only</script>\n", truncated: null } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
describe("retained workspace originals", () => {
  beforeEach(() => {
    vi.resetAllMocks(); auth.user = { id: owner }; auth.loading = false; recordBrowserPrincipal(owner);
    mocks.list.mockResolvedValue({ items: [source()], next_cursor: null }); mocks.detail.mockImplementation(async (id: string) => source(id));
    mocks.download.mockResolvedValue({ blob: new Blob(["abc"]), fileName: "First.pdf" });
    mocks.create.mockReturnValue("blob:synthetic");
    vi.stubGlobal("URL", class extends URL { static override createObjectURL = mocks.create; static override revokeObjectURL = mocks.revoke; });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(mocks.click);
  });
  afterEach(() => { cleanup(); recordBrowserPrincipal(undefined); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("deep-links to an original with inert preview and no edit or import actions", async () => {
    render(<RetainedWorkspaceUploads selectedUploadId={a} />);
    expect(await screen.findByRole("button", { name: "Download original" })).toBeEnabled();
    expect(screen.getByText(/Preview completeness has not been verified/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Extracted text preview" })).toHaveValue(source().preview.text);
    expect(screen.getByRole("textbox", { name: "Extracted text preview" })).toHaveAttribute("readonly");
    expect(document.querySelector("textarea script")).toBeNull();
    expect(screen.queryByRole("button", { name: /edit|approve|import/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "First.pdf" })).toHaveAttribute("href", `/workspace?upload=${a}`);
  });
  it("distinguishes missing from unavailable and retries an unavailable read", async () => {
    mocks.detail.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(null);
    render(<RetainedWorkspaceUploads selectedUploadId={a} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("availability is not confirmed");
    expect(screen.queryByText("This file was not found in this account.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh files" }));
    expect(await screen.findByText("This file was not found in this account.")).toBeInTheDocument();
  });
  it("does not dispatch an invalid deep-link identity", async () => {
    render(<RetainedWorkspaceUploads selectedUploadId="invalid" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("link is invalid");
    expect(mocks.detail).not.toHaveBeenCalled();
  });
  it("preserves a historical imported document's exact workspace link", async () => {
    mocks.detail.mockResolvedValue({ ...source(), status: "committed", imported_document: { document_id: b, outcome_id: owner } });
    render(<RetainedWorkspaceUploads selectedUploadId={a} />);
    expect(await screen.findByRole("link", { name: "Open saved workspace" })).toHaveAttribute("href", `/outcomes/${owner}`);
    expect(screen.getByText(/saved wording may differ/)).toBeInTheDocument();
  });
  it("hides retired owner data and gives a real reconnect action after A to B to A", async () => {
    const view = render(<RetainedWorkspaceUploads selectedUploadId={a} />);
    await screen.findByRole("heading", { name: "First.pdf" });
    recordBrowserPrincipal(b); recordBrowserPrincipal(owner);
    view.rerender(<RetainedWorkspaceUploads selectedUploadId={a} />);
    expect(screen.queryByRole("heading", { name: "First.pdf" })).not.toBeInTheDocument();
    expect(screen.getByText("Refresh files to reconnect to this account.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh files" }));
    expect(await screen.findByRole("heading", { name: "First.pdf" })).toBeInTheDocument();
  });
  it("fences a late A response after A to B to A selection", async () => {
    const old = deferred<ReturnType<typeof source>>();
    mocks.detail.mockReturnValueOnce(old.promise);
    const view = render(<RetainedWorkspaceUploads selectedUploadId={a} />);
    view.rerender(<RetainedWorkspaceUploads selectedUploadId={b} />);
    await screen.findByRole("heading", { name: "Second.docx" });
    view.rerender(<RetainedWorkspaceUploads selectedUploadId={a} />);
    await screen.findByRole("heading", { name: "First.pdf" });
    await act(async () => old.resolve({ ...source(), file_name: "Stale private source" }));
    expect(screen.queryByText("Stale private source")).not.toBeInTheDocument();
  });
  it.each(["selection", "unmount", "owner"])("fences a delayed original download on %s change", async (change) => {
    const pending = deferred<{ blob: Blob; fileName: string }>(); mocks.download.mockReturnValue(pending.promise);
    const view = render(<RetainedWorkspaceUploads selectedUploadId={a} />);
    fireEvent.click(await screen.findByRole("button", { name: "Download original" }));
    if (change === "unmount") view.unmount();
    else {
      if (change === "owner") { recordBrowserPrincipal(b); auth.user = { id: b }; }
      view.rerender(<RetainedWorkspaceUploads selectedUploadId={b} />);
    }
    await act(async () => pending.resolve({ blob: new Blob(["abc"]), fileName: "First.pdf" }));
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.click).not.toHaveBeenCalled();
  });
  it("prepares an ephemeral verified download with truthful wording", async () => {
    render(<RetainedWorkspaceUploads selectedUploadId={a} />);
    fireEvent.click(await screen.findByRole("button", { name: "Download original" }));
    await waitFor(() => expect(mocks.click).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toHaveTextContent("prepared for download");
    expect(mocks.download).toHaveBeenCalledWith(a, expect.objectContaining({ expectedUserId: owner }));
  });
  it.each(["link", "refresh"])("immediately fences download during pending %s navigation", async (action) => {
    const pending = deferred<{ blob: Blob; fileName: string }>(); mocks.download.mockReturnValue(pending.promise);
    mocks.list.mockResolvedValue({ items: [source(a), source(b)], next_cursor: null });
    render(<RetainedWorkspaceUploads selectedUploadId={a} />);
    fireEvent.click(await screen.findByRole("button", { name: "Download original" }));
    // The real Link handler runs first; prevent JSDOM's unsupported document
    // navigation afterward, leaving the App Router transition uncommitted.
    const stopNavigation = (event: Event) => event.preventDefault();
    if (action === "link") { document.addEventListener("click", stopNavigation); fireEvent.click(screen.getByRole("link", { name: "Second.docx" })); document.removeEventListener("click", stopNavigation); }
    else fireEvent.click(screen.getByRole("button", { name: "Refresh files" }));
    await act(async () => pending.resolve({ blob: new Blob(["abc"]), fileName: "First.pdf" }));
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.click).not.toHaveBeenCalled();
  });
  it("keeps a failed download recoverable without creating a URL", async () => {
    mocks.download.mockRejectedValueOnce(new Error("wrong bytes"));
    render(<RetainedWorkspaceUploads selectedUploadId={a} />);
    fireEvent.click(await screen.findByRole("button", { name: "Download original" }));
    expect(await screen.findByText(/could not be verified/)).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Download original" })).toBeEnabled();
  });
});
