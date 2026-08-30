import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StatusCheckbox } from "./StatusCheckbox";

describe("StatusCheckbox", () => {
  it("shows a visible tick for a completed item and keeps its accessible label", () => {
    render(
      <StatusCheckbox
        checked
        label="Mark Prepare notes as incomplete"
        onToggle={vi.fn()}
      />,
    );

    const checkbox = screen.getByRole("checkbox", {
      name: "Mark Prepare notes as incomplete",
    });
    expect(checkbox).toHaveAttribute("aria-checked", "true");
    expect(checkbox).toHaveTextContent("✓");
  });

  it("shows an empty box for an incomplete item and toggles when selected", async () => {
    const onToggle = vi.fn();
    render(
      <StatusCheckbox
        checked={false}
        label="Mark Prepare notes as complete"
        onToggle={onToggle}
      />,
    );

    const checkbox = screen.getByRole("checkbox", {
      name: "Mark Prepare notes as complete",
    });
    expect(checkbox).toHaveAttribute("aria-checked", "false");
    expect(checkbox).not.toHaveTextContent("✓");

    await userEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
