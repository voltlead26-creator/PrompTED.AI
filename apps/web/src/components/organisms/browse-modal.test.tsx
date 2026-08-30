import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { BrowseModal } from "./BrowseModal";

describe("BrowseModal — template catalogue", () => {
  it("lists templates grouped by category", () => {
    render(<BrowseModal open onClose={vi.fn()} />);
    expect(screen.getByText("Work & jobs")).toBeInTheDocument();
    expect(screen.getByText("Resume").closest("button")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Offer Letter/i }),
    ).toBeInTheDocument();
  });

  it("filters templates by search query", async () => {
    render(<BrowseModal open onClose={vi.fn()} />);
    await userEvent.type(
      screen.getByRole("searchbox", { name: "Search templates" }),
      "budget",
    );
    expect(
      screen.getByRole("button", { name: /Budget Workbook/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Resume")).toBeNull();
  });

  it("picks a template and closes", async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<BrowseModal open onClose={onClose} onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: /Cover Letter/i }));
    expect(onPick).toHaveBeenCalledWith("Cover Letter");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("passes axe", async () => {
    const { container } = render(<BrowseModal open onClose={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  }, 15_000);
});
