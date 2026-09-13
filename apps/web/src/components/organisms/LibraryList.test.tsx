import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { LibraryItem } from "@/hooks/useLibrary";

const library = vi.hoisted(() => ({
  items: [] as LibraryItem[],
  loading: false,
  error: null as string | null,
  saveError: null as string | null,
  savingIds: [] as string[],
  hasMore: true,
  load: vi.fn(),
  toggleSaved: vi.fn(),
}));
vi.mock("@/hooks/useLibrary", () => ({ useLibrary: () => library }));
import { LibraryList } from "./LibraryList";

beforeEach(() => {
  library.items = [{
    outcome: {
      id: "one", user_id: "owner", situation_text: "My document", status: "draft",
      is_saved: false, updated_at: "2026-09-11T00:00:00Z",
    },
    documents: [],
  }];
  library.load.mockReset();
  library.toggleSaved.mockReset();
  library.error = null;
  library.saveError = null;
  library.savingIds = [];
  library.loading = false;
});

it("supports arrow, Home and End navigation with one tabbable tab", () => {
  render(<LibraryList userId="owner" />);
  const tabs = [
    screen.getByRole("tab", { name: "Recents" }),
    screen.getByRole("tab", { name: "Saved" }),
    screen.getByRole("tab", { name: "Your Templates" }),
  ] as const;
  expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
  tabs[0].focus();
  fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
  expect(tabs[1]).toHaveFocus();
  expect(tabs[1]).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(tabs[1], { key: "End" });
  expect(tabs[2]).toHaveFocus();
  fireEvent.keyDown(tabs[2], { key: "ArrowRight" });
  expect(tabs[0]).toHaveFocus();
  fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
  expect(tabs[2]).toHaveFocus();
  fireEvent.keyDown(tabs[2], { key: "Home" });
  expect(tabs[0]).toHaveFocus();
  expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", tabs[0].id);
});

it("keeps loaded documents visible on failure and provides a refresh", () => {
  library.error = "Could not load your library. Please try again.";
  render(<LibraryList userId="owner" />);
  expect(screen.getByRole("link", { name: "Open My document" })).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent("try again");
  fireEvent.click(screen.getByRole("button", { name: "Refresh library" }));
  expect(library.load).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole("button", { name: "Save to library" })).toBeDisabled();
});

it("prevents another bookmark while confirmation is pending", () => {
  library.savingIds = ["one"];
  render(<LibraryList userId="owner" />);
  expect(screen.getByRole("button", { name: "Save to library" })).toBeDisabled();
});

it("opens manual work in its editor with the authoritative title and keeps document links", () => {
  const original = library.items[0]!;
  library.items.push({
    outcome: { ...original.outcome, id: "manual-outcome", situation_text: "Manual action plan" },
    documents: [],
    manualPlan: {
      owner_id: "owner", plan_id: "device:plan.1", outcome_id: "manual-outcome", artifact_id: "artifact",
      revision: 1, updated_at: "2026-09-11T00:00:00.123456Z", title: "My actual plan title",
    },
  });
  render(<LibraryList userId="owner" />);
  expect(screen.getByRole("link", { name: "Open My actual plan title" }))
    .toHaveAttribute("href", "/plans?create=manual&plan=device%3Aplan.1");
  expect(screen.getByRole("link", { name: "Open My document" })).toHaveAttribute("href", "/outcomes/one");
  expect(screen.queryByText("Manual action plan")).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "Save to library" })[1]!);
  expect(library.toggleSaved).toHaveBeenCalledWith("manual-outcome", false);
});

it.each(["", " \t "])("gives a blank persisted manual title an accessible editor link: %j", (title) => {
  library.items[0]!.manualPlan = {
    owner_id: "owner", plan_id: "blank", outcome_id: "one", artifact_id: "artifact", revision: 1,
    updated_at: "2026-09-11T00:00:00.123456Z", title,
  };
  render(<LibraryList userId="owner" />);
  expect(screen.getByRole("link", { name: "Open Untitled plan" }))
    .toHaveAttribute("href", "/plans?create=manual&plan=blank");
  expect(screen.queryByRole("link", { name: "Open My document" })).not.toBeInTheDocument();
});
