import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageState } from "@prompted/shared";
import AccountPage from "./page";

const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn() },
  fetchUsageState: vi.fn(),
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
  useToast: () => ({ showToast: vi.fn() }),
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
  beforeEach(() => {
    mocks.router.replace.mockReset();
    mocks.fetchUsageState.mockReset().mockResolvedValue(usage);
    mocks.user = { id: "user-1", email: "kai@example.com" };
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
});
