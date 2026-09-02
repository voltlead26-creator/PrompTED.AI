import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GuestMigrationNotice } from "./GuestMigrationNotice";

describe("GuestMigrationNotice", () => {
  it("shows migration progress", () => {
    render(
      <GuestMigrationNotice
        status="migrating"
        result={null}
        onRetry={vi.fn()}
        onConfirm={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.getByText("Moving your guest documents into your account…")).toBeInTheDocument();
  });

  it("summarises successful migration", () => {
    render(
      <GuestMigrationNotice
        status="complete"
        result={{
          migrated: 2,
          skipped: 0,
          failed: 0,
          failedOutcomeIds: [],
          cleanupFailed: 0,
          cleanupFailedOutcomeIds: [],
        }}
        onRetry={vi.fn()}
        onConfirm={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.getByText("Guest documents moved into your account.")).toBeInTheDocument();
    expect(screen.getByText(/2 documents can now sync/i)).toBeInTheDocument();
  });

  it("offers retry when some documents fail", async () => {
    const retry = vi.fn();
    render(
      <GuestMigrationNotice
        status="failed"
        result={{
          migrated: 1,
          skipped: 0,
          failed: 1,
          failedOutcomeIds: ["outcome-2"],
          cleanupFailed: 0,
          cleanupFailedOutcomeIds: [],
        }}
        onRetry={retry}
        onConfirm={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry migration" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("uses unknown-safe wording when migration throws before a result exists", () => {
    render(
      <GuestMigrationNotice
        status="failed"
        result={null}
        onRetry={vi.fn()}
        onConfirm={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /could not confirm which guest documents moved/i,
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(/0 still remain/i);
  });

  it("treats a skipped guest document as unresolved", () => {
    render(
      <GuestMigrationNotice
        status="failed"
        result={{
          migrated: 0,
          skipped: 1,
          failed: 0,
          failedOutcomeIds: [],
          cleanupFailed: 0,
          cleanupFailedOutcomeIds: [],
        }}
        onRetry={vi.fn()}
        onConfirm={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be safely claimed yet/i);
  });

  it("requires an explicit owner choice before moving unclaimed browser drafts", async () => {
    const confirm = vi.fn();
    const discard = vi.fn();
    render(
      <GuestMigrationNotice
        status="review_required"
        result={null}
        onRetry={vi.fn()}
        onConfirm={confirm}
        onDiscard={discard}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/not yet proven to belong to this account/i);
    await userEvent.click(screen.getByRole("button", { name: "Move my browser drafts" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(discard).not.toHaveBeenCalled();
  });
});
