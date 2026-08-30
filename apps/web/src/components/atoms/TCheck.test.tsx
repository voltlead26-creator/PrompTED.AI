import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TCheck } from "./TCheck";

describe("TCheck", () => {
  it("remains a semantic checkbox with an accessible label", () => {
    render(<TCheck label="Full name" checked={false} onChange={() => undefined} />);
    expect(screen.getByRole("checkbox", { name: "Full name" })).toBeInTheDocument();
  });

  it("toggles through the full labelled row", () => {
    const onChange = vi.fn();
    render(<TCheck label="Email" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByText("Email"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("exposes status text and respects disabled state", async () => {
    const onChange = vi.fn();
    render(
      <TCheck
        label="Date of birth"
        checked={false}
        disabled
        statusText="Not saved"
        onChange={onChange}
      />,
    );
    expect(screen.getByText("Not saved")).toBeInTheDocument();
    const checkbox = screen.getByRole("checkbox", { name: "Date of birth" });
    expect(checkbox).toBeDisabled();
    await userEvent.click(checkbox);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps supporting copy accessible while visually compact", () => {
    render(
      <TCheck
        label="Full name"
        description="Use the full name saved in Profile."
        checked={false}
        compact
        onChange={() => undefined}
      />,
    );

    const description = screen.getByText("Use the full name saved in Profile.");
    expect(description).toHaveClass("sr-only");
    expect(screen.getByRole("checkbox", { name: "Full name" })).toHaveAccessibleDescription(
      "Use the full name saved in Profile.",
    );
  });
});
