import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import DeleteAccountPage from "./page";

const originalApiBase = vi.hoisted(() => {
  const original = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://untrusted.example/functions";
  return original;
});

const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn() },
  showToast: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
  purgeBrowserDataForUser: vi.fn(),
  fetch: vi.fn(),
}));

const OWNER_USER_ID = "81000000-0000-4000-8000-000000000001";

function sessionFor(userId: string, accessToken = "token") {
  return {
    data: {
      session: {
        access_token: accessToken,
        user: { id: userId },
      },
    },
  };
}

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
vi.mock("@/lib/browser-owner-data", () => ({
  purgeBrowserDataForUser: mocks.purgeBrowserDataForUser,
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
    mocks.getSession.mockResolvedValue(sessionFor(OWNER_USER_ID));
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.purgeBrowserDataForUser.mockReturnValue(true);
  });

  afterAll(() => {
    if (originalApiBase === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
    else process.env.NEXT_PUBLIC_API_BASE_URL = originalApiBase;
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
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/account-delete",
      expect.objectContaining({ method: "DELETE" }),
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
    expect(mocks.purgeBrowserDataForUser).toHaveBeenCalledWith(
      OWNER_USER_ID,
    );
    expect(mocks.purgeBrowserDataForUser).toHaveBeenCalledTimes(2);
    expect(mocks.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: "success",
        message: expect.stringMatching(/deleted/i),
      }),
    );
    expect(mocks.router.replace).toHaveBeenCalledWith("/");
  });

  it("reports a browser-local cleanup failure without denying confirmed server deletion", async () => {
    mocks.purgeBrowserDataForUser.mockReturnValue(false);
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          deletion: {
            state: "complete",
            account_deleted: true,
            storage_objects_removed: 3,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(<DeleteAccountPage />);
    await submitDeletion();

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));
    expect(mocks.showToast).toHaveBeenCalledWith({
      tone: "error",
      message: expect.stringMatching(/browser could not clear every local cache/i),
    });
    expect(mocks.router.replace).toHaveBeenCalledWith("/");
  });

  it("reports incomplete browser cleanup when local sign-out fails", async () => {
    mocks.signOut.mockRejectedValue(new Error("storage denied"));
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
    expect(mocks.showToast).toHaveBeenCalledWith({
      tone: "error",
      message: expect.stringMatching(/browser could not clear every local cache/i),
    });
  });

  it("never signs out or redirects a newer principal after the deleted owner's response arrives", async () => {
    let resolveDeletion!: (response: Response) => void;
    mocks.fetch.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveDeletion = resolve;
      }),
    );
    mocks.getSession
      .mockResolvedValueOnce(sessionFor(OWNER_USER_ID, "owner-a-token"))
      .mockResolvedValueOnce(
        sessionFor("82000000-0000-4000-8000-000000000002", "owner-b-token"),
      );

    render(<DeleteAccountPage />);
    await submitDeletion();
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));

    resolveDeletion(
      new Response(
        JSON.stringify({
          success: true,
          deletion: {
            state: "complete",
            account_deleted: true,
            storage_objects_removed: 1,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await waitFor(() => expect(mocks.purgeBrowserDataForUser).toHaveBeenCalledWith(OWNER_USER_ID));
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.router.replace).not.toHaveBeenCalled();
    expect(mocks.showToast).not.toHaveBeenCalled();
  });
});
