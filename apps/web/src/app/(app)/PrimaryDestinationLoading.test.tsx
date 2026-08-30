import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LibraryPage from "./library/page";
import PlansPage from "./plans/page";
import SettingsPage from "./settings/page";

const auth = vi.hoisted(() => ({
  loading: true,
  user: null as null | { id: string; email: string },
}));
vi.mock("@/components/providers", () => ({ useAuth: () => auth }));
vi.mock("next/navigation", () => ({ usePathname: () => "/home" }));
vi.mock("@/components/organisms/LibraryList", () => ({ LibraryList: () => null }));
vi.mock("@/components/organisms/ChecklistLibrary", () => ({ ChecklistLibrary: () => null }));
vi.mock("@/components/organisms/WhatsDue", () => ({ WhatsDue: () => null }));
vi.mock("@/hooks/useChecklist", () => ({ useWhatsDue: () => ({ items: [] }) }));
vi.mock("./plans/ManualPlansLibrary", () => ({ ManualPlansLibrary: () => null }));
vi.mock("./plans/PlansCreatePanel", () => ({ PlansCreatePanel: () => null }));

describe("primary destination loading layouts", () => {
  beforeEach(() => {
    auth.loading = true;
    auth.user = null;
  });

  it.each([
    ["My work", LibraryPage],
    ["Checklists / Action Plans", PlansPage],
    ["Settings", SettingsPage],
  ] as const)("keeps %s visibly labelled while authentication loads", (heading, Page) => {
    render(<Page />);
    expect(screen.getByRole("heading", { name: heading, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("offers account entry instead of sign-out or deletion controls when Settings is signed out", () => {
    auth.loading = false;
    render(<SettingsPage />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    expect(screen.queryByRole("link", { name: "Sign out" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Delete account" })).not.toBeInTheDocument();
  });
});
