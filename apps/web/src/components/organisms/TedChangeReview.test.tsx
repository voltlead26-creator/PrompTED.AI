import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TedChangeReview } from "./TedChangeReview";

function renderReview(overrides: Partial<React.ComponentProps<typeof TedChangeReview>> = {}) {
  const props: React.ComponentProps<typeof TedChangeReview> = {
    suggested: "Revised section content.",
    changes: ["Removed a weak qualifier.", "Tightened the closing sentence."],
    explanation: "TED improved clarity.",
    onApply: vi.fn(),
    onRetry: vi.fn(),
    onDiscard: vi.fn(),
    ...overrides,
  };
  render(<TedChangeReview {...props} />);
  return props;
}

describe("TedChangeReview", () => {
  it("shows the suggested wording and a list of what changed", () => {
    renderReview();
    expect(screen.getByText("Revised section content.")).toBeInTheDocument();
    expect(screen.getByText("Removed a weak qualifier.")).toBeInTheDocument();
    expect(screen.getByText("Tightened the closing sentence.")).toBeInTheDocument();
  });

  it("falls back to a plain notice when TED didn't report specific changes", () => {
    renderReview({ changes: [] });
    expect(screen.getByText("Review the suggested wording before applying it.")).toBeInTheDocument();
  });

  it("lets the user discard the suggestion", async () => {
    const onDiscard = vi.fn();
    renderReview({ onDiscard });
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("lets the user request another suggestion", async () => {
    const onRetry = vi.fn();
    renderReview({ onRetry });
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("requires an explicit apply action", async () => {
    const onApply = vi.fn();
    renderReview({ onApply });
    expect(onApply).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
