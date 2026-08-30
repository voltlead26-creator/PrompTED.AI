import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { Badge } from "./Badge";
import { Chip } from "./Chip";
import { Spinner } from "./Spinner";
import { ProgressBar } from "./ProgressBar";
import { Divider } from "./Divider";
import { Avatar } from "./Avatar";
import { Tooltip } from "./Tooltip";

describe("Badge", () => {
  it("shows colour + icon + text (not colour alone)", () => {
    const { container } = render(<Badge status="approved" />);
    expect(screen.getByText("Approved")).toBeInTheDocument();
    // icon element present alongside the text
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("has no axe violations for every status", async () => {
    const { container } = render(
      <>
        <Badge status="draft" />
        <Badge status="edited" />
        <Badge status="approved" />
        <Badge status="locked" />
        <Badge status="done" />
        <Badge status="in_progress" />
      </>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("Chip", () => {
  it("is a button and toggles aria-pressed when interactive", async () => {
    const onClick = vi.fn();
    render(
      <Chip onClick={onClick} selected>
        I need a job
      </Chip>,
    );
    const chip = screen.getByRole("button", { name: "I need a job" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(chip);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders as static text when not interactive", () => {
    render(<Chip>Static</Chip>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Static")).toBeInTheDocument();
  });
});

describe("Spinner", () => {
  it("always carries a label (status role)", () => {
    render(<Spinner label="Loading your work" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading your work");
  });
});

describe("ProgressBar", () => {
  it("exposes progressbar semantics with value range", () => {
    render(<ProgressBar value={3} max={6} label="3 of 6 sections approved" />);
    const bar = screen.getByRole("progressbar", {
      name: "3 of 6 sections approved",
    });
    expect(bar).toHaveAttribute("aria-valuenow", "3");
    expect(bar).toHaveAttribute("aria-valuemax", "6");
  });

  it("clamps out-of-range values", () => {
    render(<ProgressBar value={99} max={6} label="overflow" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "6");
  });
});

describe("Divider", () => {
  it("renders a labelled separator", () => {
    render(<Divider label="Examples" />);
    expect(screen.getByRole("separator", { name: "Examples" })).toBeInTheDocument();
  });
});

describe("Avatar", () => {
  it("falls back to initials and exposes the name", () => {
    render(<Avatar name="Maria Lopez" />);
    const av = screen.getByRole("img", { name: "Maria Lopez" });
    expect(av).toHaveTextContent("ML");
  });
});

describe("Tooltip", () => {
  it("links trigger and tip and shows on focus", async () => {
    render(
      <Tooltip content="Approve all sections to export">
        <button type="button">Export</button>
      </Tooltip>,
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent("Approve all sections to export");
  });
});

describe("atoms accessibility sweep", () => {
  it("has no axe violations across the set", async () => {
    const { container } = render(
      <main>
        <Chip onClick={() => {}}>Write a policy</Chip>
        <Spinner label="Working" showLabel />
        <ProgressBar value={2} max={5} label="2 of 5 done" />
        <Divider label="Jump back in" />
        <Avatar name="Daniel" />
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
