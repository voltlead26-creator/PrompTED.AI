import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DeleteAccountPage from "./page";

const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn() },
  showToast: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/components/providers", () => ({
  useAuth: () => ({
    user: {
      id: "81000000-0000-4000-8000-000000000001",
      email: "kai@example.com",
    },
    loading: false,
  }),
}));
vi.mock("@/components/atoms/Toast", () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: mocks.getSession, signOut: mocks.signOut },
  }),
}));

async function submitDeletion() {
  fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), {
    target: { value: "DELETE" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Permanently delete my account" }),
  );
}

describe("DeleteAccountPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: "token" } },
    });
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it("explains the transfer gate and does not sign out", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error:
            "Transfer or remove other business members before deleting your account.",
          code: "BUSINESS_TRANSFER_REQUIRED",
          retryable: false,
          deletion: {
            state: "not_started",
            account_deleted: false,
            storage_objects_removed: 0,
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(<DeleteAccountPage />);
    await submitDeletion();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /transfer ownership or remove the other business members/i,
    );
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("never claims nothing was removed after a partial failure", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error:
            "The account could not be deleted after stored files were removed.",
          code: "AUTH_DELETION_FAILED",
          retryable: true,
          deletion: {
            state: "partial",
            account_deleted: false,
            storage_objects_removed: 2,
          },
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(<DeleteAccountPage />);
    await submitDeletion();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      /some stored data has already been removed/i,
    );
    expect(alert).not.toHaveTextContent(/nothing has been removed/i);
  });

  it("does not describe a late transfer gate as not started after files were removed", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error:
            "Transfer ownership or remove the other business members before deleting your account.",
          code: "BUSINESS_TRANSFER_REQUIRED",
          retryable: false,
          deletion: {
            state: "partial",
            account_deleted: false,
            storage_objects_removed: 1,
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(<DeleteAccountPage />);
    await submitDeletion();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      /some stored data has already been removed/i,
    );
    expect(alert).toHaveTextContent(
      /transfer ownership or remove the other business members/i,
    );
    expect(alert).not.toHaveTextContent(/no deletion has started/i);
  });

  it("uses cautious wording when the response is unavailable after submission", async () => {
    mocks.fetch.mockRejectedValue(new Error("connection lost"));

    render(<DeleteAccountPage />);
    await submitDeletion();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/some data may already have been removed/i);
    expect(alert).not.toHaveTextContent(/nothing has been removed/i);
  });

  it("signs out only after complete deletion", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          deletion: {
            state: "complete",
            account_deleted: true,
            storage_objects_removed: 0,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(<DeleteAccountPage />);
    await submitDeletion();

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));
    expect(mocks.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: "success",
        message: expect.stringMatching(/deleted/i),
      }),
    );
    expect(mocks.router.replace).toHaveBeenCalledWith("/");
  });
});
