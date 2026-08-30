import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SettingsPage from "./page";

vi.mock("@/components/providers", () => ({
  useAuth: () => ({ user: { id: "user-1", email: "kai@example.com" }, loading: false }),
}));

describe("SettingsPage", () => {
  it("lists Profile, Appearance, Business & Brand, Account", () => {
    render(<SettingsPage />);
    expect(screen.getByRole("link", { name: /^profile/i })).toHaveAttribute(
      "href",
      "/settings/profile",
    );
    expect(screen.getByRole("link", { name: /appearance/i })).toHaveAttribute(
      "href",
      "/settings/appearance",
    );
    expect(screen.getByRole("link", { name: /business & brand/i })).toHaveAttribute(
      "href",
      "/settings/business",
    );
    expect(screen.getByRole("link", { name: /^account/i })).toHaveAttribute(
      "href",
      "/settings/account",
    );
  });

  it("no longer shows a separate Plan & Usage entry or inline sign-out block", () => {
    render(<SettingsPage />);
    expect(screen.queryByText(/plan & usage/i)).toBeNull();
    expect(screen.queryByRole("link", { name: "Sign out" })).toBeNull();
  });
});
