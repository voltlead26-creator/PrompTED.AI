import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { WorkspaceRecoveryReview } from "./WorkspaceRecoveryReview";
import type { WorkspaceRecoveryReview as Recovery } from "@/lib/workspace-recovery";

const review: Recovery = {
  status: "ready", documentId: "doc-1", documentRevision: 2,
  sections: [{ sectionId: "section-1", name: "Overview", content: "<p>My unsaved wording.</p>",
    expectedRevision: 1, expectedSha256: "a".repeat(64) }],
};

function setup(value = review, onRestore = vi.fn(async () => false)) {
  const onKeepSaved = vi.fn(() => false);
  const onCancel = vi.fn();
  render(<WorkspaceRecoveryReview review={value} onRestore={onRestore} onKeepSaved={onKeepSaved} onCancel={onCancel} />);
  return { onRestore, onKeepSaved, onCancel };
}

describe("WorkspaceRecoveryReview", () => {
  it.each([false, true])("keeps keyboard focus inside the review (reverse: %s)", async shift => {
    setup();
    await userEvent.tab({ shift });
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    const boundary = shift ? within(dialog).getByRole("region") : within(dialog).getByRole("button", { name: "Restore to editor" });
    boundary.focus();
    await userEvent.tab({ shift });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
  it("opens and focuses a foreground review without applying or discarding the copy", () => {
    const { onRestore, onKeepSaved } = setup();
    const dialog = screen.getByRole("dialog", { name: "Review wording kept in this browser" });
    expect(dialog).toHaveAttribute("open");
    expect(within(dialog).getByRole("heading")).toHaveFocus();
    expect(within(dialog).getByText("My unsaved wording.")).toBeVisible();
    expect(onRestore).not.toHaveBeenCalled();
    expect(onKeepSaved).not.toHaveBeenCalled();
  });

  it("keeps the copy available after Escape and reopens it from the foreground control", () => {
    const { onKeepSaved, onCancel } = setup();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onKeepSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Review browser copy" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Review browser copy" }));
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("retains wording and explains an unconfirmed restore", async () => {
    setup();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Restore to editor" })));
    expect(screen.getByRole("alert")).toHaveTextContent("saved version could not be confirmed");
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText("My unsaved wording.")).toBeVisible();
  });

  it("blocks duplicate restores and permits cancellation while a read is pending", async () => {
    let finish!: (value: boolean) => void;
    const onRestore = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const { onCancel } = setup(review, onRestore);
    fireEvent.click(screen.getByRole("button", { name: "Restore to editor" }));
    fireEvent.click(screen.getByRole("button", { name: "Checking saved version…" }));
    expect(onRestore).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Review later" }));
    expect(onCancel).toHaveBeenCalledOnce();
    await act(async () => finish(false));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows conflicting or unsafe wording as text and offers no overwrite action", () => {
    setup({ ...review, status: "conflict", sections: [{ ...review.sections[0]!, content: '<img src=x onerror="alert(1)">' }] });
    expect(screen.queryByRole("button", { name: "Restore to editor" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog").querySelector("img")).toBeNull();
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Keep saved version" }));
    expect(screen.getByRole("alert")).toHaveTextContent("could not be discarded");
  });
});
