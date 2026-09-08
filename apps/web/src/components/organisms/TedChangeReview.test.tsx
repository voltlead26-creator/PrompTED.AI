import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
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
  it.each(["heading-backward", "first-backward", "last-forward"] as const)("contains Tab at the %s boundary", async (boundary) => {
    render(<button type="button">Before review</button>);
    renderReview();
    render(<button type="button">After review</button>);
    const dialog = screen.getByRole("dialog");
    const first = within(dialog).getByRole("region", { name: "TED suggested changes" });
    const last = within(dialog).getByRole("button", { name: "Apply" });
    if (boundary === "first-backward") first.focus();
    if (boundary === "last-forward") last.focus();
    await userEvent.tab({ shift: boundary !== "last-forward" });
    expect(boundary === "last-forward" ? first : last).toHaveFocus();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it.each([false, true])("keeps keyboard access to wording when every action is disabled (shift: %s)", async (shift) => {
    render(<button type="button">Before review</button>);
    renderReview({ busy: true });
    render(<button type="button">After review</button>);
    const dialog = screen.getByRole("dialog");
    const content = within(dialog).getByRole("region", { name: "TED suggested changes" });
    await userEvent.tab({ shift });
    expect(content).toHaveFocus();
    await userEvent.tab({ shift });
    expect(content).toHaveFocus();
    expect(within(dialog).getAllByRole("button").every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });

  it("opens a native modal and focuses its heading without applying anything", () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const props = renderReview();
    const dialog = screen.getByRole("dialog", { name: "Check the change before applying it" });
    expect(showModal).toHaveBeenCalledOnce();
    expect(dialog).toHaveAttribute("open");
    expect(within(dialog).getByRole("heading")).toHaveFocus();
    expect(props.onApply).not.toHaveBeenCalled();
    showModal.mockRestore();
  });

  it("keeps the modal open until its owner confirms an Escape discard", async () => {
    const props = renderReview();
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      expect(fireEvent(dialog, new Event("cancel", { cancelable: true }))).toBe(false);
    });
    expect(props.onDiscard).toHaveBeenCalledOnce();
    expect(dialog).toHaveAttribute("open");
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it("shows recovery guidance inside the modal", () => {
    renderReview({ notice: "The saved change could not be confirmed. Try Apply again." });
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("could not be confirmed");
  });

  it("blocks duplicate actions and Escape while an async Apply is unresolved", async () => {
    let finish!: () => void;
    const onApply = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const props = renderReview({ onApply });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Applying…" }));
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(onApply).toHaveBeenCalledOnce();
    expect(props.onDiscard).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDisabled();
    await act(async () => finish());
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
  });

  it("restores a connected caller toolbar after the review is removed", () => {
    const returnFocusRef = createRef<HTMLDivElement>();
    const props = {
      suggested: "Revised wording", changes: [], explanation: "Review before applying.",
      onApply: vi.fn(), onRetry: vi.fn(), onDiscard: vi.fn(), returnFocusRef,
    };
    const view = render(<><div ref={returnFocusRef} role="toolbar" tabIndex={-1}>Edit content</div><TedChangeReview {...props} /></>);
    view.rerender(<div ref={returnFocusRef} role="toolbar" tabIndex={-1}>Edit content</div>);
    expect(screen.getByRole("toolbar")).toHaveFocus();
  });

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
