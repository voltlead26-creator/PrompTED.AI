import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { Button } from "./Button";

describe("Button", () => {
  it("renders its label", () => {
    render(<Button>Ask TED</Button>);
    expect(screen.getByRole("button", { name: "Ask TED" })).toBeInTheDocument();
  });

  it("fires onClick when activated", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is disabled and aria-busy while loading, with a labelled spinner", () => {
    render(
      <Button loading loadingLabel="Generating">
        Generate
      </Button>,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Generating")).toBeInTheDocument();
  });

  it("does not fire onClick when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Nope
      </Button>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("has no axe violations across variants", async () => {
    const { container } = render(
      <>
        <Button variant="primary">Primary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="text">Text</Button>
      </>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
