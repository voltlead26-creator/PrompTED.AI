import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MasterWorkspaceImport } from "./MasterWorkspaceImport";

const auth = vi.hoisted(() => ({ user: null as null | { id: string }, loading: true }));
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  ingestUpload: vi.fn(),
  commitDocumentImport: vi.fn(),
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
  return { ...actual, ingestUpload: mocks.ingestUpload };
});
vi.mock("@/lib/api", () => ({ ensureApiConfigured: () => undefined }));
vi.mock("@/lib/api/import-workspace", () => ({
  commitDocumentImport: mocks.commitDocumentImport,
}));
vi.mock("@/lib/workspace-store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspace-store")>(
    "@/lib/workspace-store",
  );
  return {
    ...actual,
    savePendingOutcome: mocks.savePendingOutcome,
    saveWorkspace: mocks.saveWorkspace,
  };
});

describe("MasterWorkspaceImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.loading = true;
    auth.user = null;
    mocks.ingestUpload.mockResolvedValue({
      upload_id: "upload-1",
      extracted_text: "Experience\n\nManaged daily workspace operations.",
    });
    mocks.commitDocumentImport.mockResolvedValue(undefined);
  });

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

  it("does not persist or navigate when the authenticated commit fails", async () => {
    auth.loading = false;
    auth.user = { id: "user-1" };
    mocks.commitDocumentImport.mockRejectedValueOnce(new Error("sync failed"));
    const { container } = render(<MasterWorkspaceImport />);

    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(["resume"], "Resume.txt", { type: "text/plain" })] },
    });
    await screen.findByRole("region", { name: "Review imported document" });
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    expect(
      await screen.findByText(/could not save it securely to your account/i),
    ).toBeInTheDocument();
    expect(mocks.savePendingOutcome).not.toHaveBeenCalled();
    expect(mocks.saveWorkspace).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
