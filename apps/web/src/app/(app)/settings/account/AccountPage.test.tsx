import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageState } from "@prompted/shared";
import type { EffectiveProductAccess } from "@prompted/shared/plans";
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

const accountOwnerId = "81001111-0000-4000-8000-000000000001";
const confirmedFreeAccess: EffectiveProductAccess = {
  userId: accountOwnerId,
  subscriptionPlan: "free",
  effectivePlan: "free",
  subscriptionStatus: null,
  currentPeriodEnd: null,
  accessProfile: "subscription",
  monthlyDocumentCap: 3,
  aiEditing: false,
  businessFeatures: false,
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

  it("shows plan, subscription period end, sign out and delete account", async () => {
    render(<AccountPage />);
    await waitFor(() => expect(screen.getByText("Pro")).toBeInTheDocument());
    expect(screen.getByText(/subscription period end:/i)).toBeInTheDocument();
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

  it.each(["expired", "cancelled"] as const)(
    "does not claim the monthly limit was reached when comparing an unused %s Business account",
    async (subscriptionStatus) => {
      mocks.user = { id: accountOwnerId, email: "kai@example.com" };
      recordBrowserPrincipal(accountOwnerId);
      mocks.fetchUsageState.mockResolvedValueOnce({
        plan: "business",
        documentsThisMonth: 0,
        subscriptionStatus,
        currentPeriodEnd: "2020-01-15T12:00:00.000Z",
        access: {
          ...confirmedFreeAccess,
          subscriptionPlan: "business",
          subscriptionStatus,
          currentPeriodEnd: "2020-01-15T12:00:00.000Z",
        },
      } satisfies UsageState);
      render(<AccountPage />);
      await screen.findByRole("heading", { name: "Business" });
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
      const dialog = within(screen.getByRole("dialog", { name: "Upgrade your plan" }));
      expect(dialog.queryByText(/reached.*limit|upgrade to keep going/i)).not.toBeInTheDocument();
      for (const plan of ["Pro", "Premium", "Business"]) {
        expect(dialog.getByRole("button", { name: `Select ${plan} plan` })).toBeInTheDocument();
      }
      expect(mocks.fetchUsageState).toHaveBeenCalledTimes(1);
      expect(mocks.showToast).not.toHaveBeenCalled();
    },
  );

  it("retains the confirmed monthly cap warning when opening and closing plan comparison", async () => {
    mocks.user = { id: accountOwnerId, email: "kai@example.com" };
    recordBrowserPrincipal(accountOwnerId);
    mocks.fetchUsageState.mockResolvedValueOnce({
      plan: "free",
      documentsThisMonth: 3,
      subscriptionStatus: null,
      currentPeriodEnd: null,
      access: confirmedFreeAccess,
    } satisfies UsageState);
    render(<AccountPage />);
    const warning = await screen.findByRole("alert");
    expect(warning).toHaveTextContent(
      "You've reached your monthly limit. Upgrade to create more documents.",
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");

    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
    expect(screen.getByRole("dialog", { name: "Upgrade your plan" })).toBeInTheDocument();
    expect(warning).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBe(warning);
    expect(warning).toHaveTextContent("You've reached your monthly limit.");
    expect(mocks.fetchUsageState).toHaveBeenCalledTimes(1);
    expect(mocks.showToast).not.toHaveBeenCalled();
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

  it.each(["expired", "cancelled"] as const)(
    "compares upgrades from effective Free for a historical %s Business subscription",
    async (subscriptionStatus) => {
      mocks.user = { id: accountOwnerId, email: "kai@example.com" };
      recordBrowserPrincipal(accountOwnerId);
      mocks.fetchUsageState.mockResolvedValueOnce({
        plan: "business",
        documentsThisMonth: 3,
        subscriptionStatus,
        currentPeriodEnd: "2026-09-01T00:00:00.000Z",
        access: {
          ...confirmedFreeAccess,
          subscriptionPlan: "business",
          subscriptionStatus,
          currentPeriodEnd: "2026-09-01T00:00:00.000Z",
        },
      } satisfies UsageState);
      render(<AccountPage />);
      await screen.findByRole("heading", { name: "Business" });
      expect(screen.getByRole("list", { name: "Free plan features" })).toHaveTextContent(
        "3 documents per month",
      );
      fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      for (const plan of ["Pro", "Premium", "Business"]) {
        expect(screen.getByRole("button", { name: `Select ${plan} plan` })).toBeInTheDocument();
      }
      expect(screen.getByRole("heading", { name: "Business" })).toBeInTheDocument();
      expect(screen.getByRole("note")).toHaveTextContent("Online checkout isn't available yet");
      expect(mocks.showToast).not.toHaveBeenCalled();
    },
  );

  it.each(["pending", "ready"] as const)(
    "renews a %s account read after A-to-B-to-A without rendering the intervening owner",
    async (initialStatus) => {
      mocks.user = { id: accountOwnerId, email: "kai@example.com" };
      recordBrowserPrincipal(accountOwnerId);
      const previousUsage: UsageState = {
        ...usage,
        access: {
          ...confirmedFreeAccess,
          subscriptionPlan: "pro",
          effectivePlan: "pro",
          subscriptionStatus: "active",
          currentPeriodEnd: usage.currentPeriodEnd ?? null,
          monthlyDocumentCap: 20,
          aiEditing: true,
        },
      };
      const freshUsage: UsageState = {
        plan: "free",
        documentsThisMonth: 1,
        subscriptionStatus: null,
        currentPeriodEnd: null,
        access: confirmedFreeAccess,
      };
      let completePrevious!: (value: UsageState) => void;
      let completeFresh!: (value: UsageState) => void;
      mocks.fetchUsageState
        .mockReturnValueOnce(new Promise<UsageState>((resolve) => { completePrevious = resolve; }))
        .mockReturnValueOnce(new Promise<UsageState>((resolve) => { completeFresh = resolve; }));
      const view = render(<AccountPage />);
      expect(mocks.fetchUsageState).toHaveBeenCalledTimes(1);
      const previousSignal = mocks.fetchUsageState.mock.calls[0]![1] as AbortSignal;
      if (initialStatus === "ready") {
        await act(async () => completePrevious(previousUsage));
        fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      }

      act(() => {
        recordBrowserPrincipal("81001111-0000-4000-8000-000000000002");
        recordBrowserPrincipal(accountOwnerId);
        view.rerender(<AccountPage />);
      });
      expect(screen.queryByRole("heading", { name: "Pro" })).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await waitFor(() => expect(mocks.fetchUsageState).toHaveBeenCalledTimes(2));
      expect(previousSignal.aborted).toBe(true);
      expect(mocks.fetchUsageState.mock.calls[1]![0]).toBe(accountOwnerId);
      const freshSignal = mocks.fetchUsageState.mock.calls[1]![1] as AbortSignal;
      expect(freshSignal).not.toBe(previousSignal);
      expect(freshSignal.aborted).toBe(false);

      await act(async () => completeFresh(freshUsage));
      await screen.findByRole("heading", { name: "Free" });
      if (initialStatus === "pending") {
        await act(async () => completePrevious(previousUsage));
      }
      expect(screen.getByRole("heading", { name: "Free" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Pro" })).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(mocks.fetchUsageState).toHaveBeenCalledTimes(2);
    },
  );
});
