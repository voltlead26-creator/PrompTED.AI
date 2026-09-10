import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageState } from "@prompted/shared";
import AccountPage from "./page";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";

const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn() },
  fetchUsageState: vi.fn(),
  showToast: vi.fn(),
  authLoading: false,
  user: { id: "user-1", email: "kai@example.com" } as { id: string; email: string } | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
}));

vi.mock("@/components/providers", () => ({
  useAuth: () => ({ user: mocks.user, loading: mocks.authLoading }),
}));

vi.mock("@/components/atoms/Toast", () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));

vi.mock("@/lib/usage", () => ({
  fetchUsageState: (...args: unknown[]) => mocks.fetchUsageState(...args),
}));

const usage: UsageState = {
  plan: "pro",
  documentsThisMonth: 4,
  subscriptionStatus: "active",
  currentPeriodEnd: "2026-09-12T00:00:00.000Z",
};

describe("AccountPage", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    mocks.router.replace.mockReset();
    mocks.fetchUsageState.mockReset().mockResolvedValue(usage);
    mocks.user = { id: "user-1", email: "kai@example.com" };
    mocks.showToast.mockReset();
    mocks.authLoading = false;
    recordBrowserPrincipal("user-1");
  });

  it("redirects to sign-in when signed out", () => {
    mocks.user = null;
    render(<AccountPage />);
    expect(mocks.router.replace).toHaveBeenCalledWith("/sign-in");
  });

  it("shows plan, renewal date, sign out and delete account", async () => {
    render(<AccountPage />);
    await waitFor(() => expect(screen.getByText("Pro")).toBeInTheDocument());
    expect(screen.getByText(/renews/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign out" })).toHaveAttribute("href", "/sign-out");
    expect(screen.getByRole("link", { name: "Delete account" })).toHaveAttribute(
      "href",
      "/settings/delete-account",
    );
  });

  it("does not promise an upgrade request or follow-up when checkout is unavailable", async () => {
    render(<AccountPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Upgrade" }));
    expect(screen.getByRole("note")).not.toHaveTextContent(/follow up|lets TED know/i);
    fireEvent.click(screen.getByRole("button", { name: "Select Premium plan" }));
    expect(mocks.showToast).toHaveBeenCalledWith({
      message:
        "Online checkout isn't available yet. No upgrade request was sent, and your plan is unchanged.",
      tone: "info",
    });
  });

  it("hides the previous account plan and rejects its delayed response after an account switch", async () => {
    let completeFirst!: (value: UsageState) => void;
    mocks.fetchUsageState
      .mockReturnValueOnce(
        new Promise<UsageState>((resolve) => {
          completeFirst = resolve;
        }),
      )
      .mockResolvedValueOnce({ ...usage, plan: "free", documentsThisMonth: 1 });
    const view = render(<AccountPage />);
    mocks.user = { id: "user-2", email: "second@example.com" };
    recordBrowserPrincipal("user-2");
    view.rerender(<AccountPage />);
    await screen.findByRole("heading", { name: "Free" });
    await act(async () => completeFirst(usage));
    expect(screen.getByRole("heading", { name: "Free" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pro" })).toBeNull();
  });

  it("shows a safe retry after a failed read and recovers the confirmed plan", async () => {
    mocks.fetchUsageState.mockRejectedValueOnce(new Error("private database details"));
    render(<AccountPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be confirmed");
    expect(screen.queryByText(/private database/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Free" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry plan details" }));
    await screen.findByRole("heading", { name: "Pro" });
    expect(mocks.fetchUsageState).toHaveBeenCalledTimes(2);
  });

  it("times out a read, aborts it and ignores late success", async () => {
    vi.useFakeTimers();
    let finish!: (value: UsageState) => void;
    mocks.fetchUsageState.mockReturnValueOnce(
      new Promise<UsageState>((resolve) => {
        finish = resolve;
      }),
    );
    render(<AccountPage />);
    const signal = mocks.fetchUsageState.mock.calls[0]?.[1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent("could not be confirmed");
    await act(async () => finish(usage));
    expect(screen.queryByRole("heading", { name: "Pro" })).toBeNull();
  });

  it("aborts pending work on unmount", () => {
    mocks.fetchUsageState.mockReturnValueOnce(new Promise(() => {}));
    const view = render(<AccountPage />);
    const signal = mocks.fetchUsageState.mock.calls[0]?.[1] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
});
