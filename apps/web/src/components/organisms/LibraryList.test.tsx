import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const library = vi.hoisted(() => ({
  items: [
    {
      outcome: {
        id: "one",
        situation_text: "My document",
        status: "draft",
        is_saved: false,
        updated_at: "2026-09-11T00:00:00Z",
      },
      documents: [],
    },
  ],
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
