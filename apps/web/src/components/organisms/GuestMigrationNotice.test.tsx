import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GuestMigrationNotice } from "./GuestMigrationNotice";

describe("GuestMigrationNotice", () => {
  it("shows migration progress", () => {
    render(<GuestMigrationNotice status="migrating" result={null} onRetry={vi.fn()} />);
    expect(screen.getByText("Moving your guest documents into your account…")).toBeInTheDocument();
  });

  it("summarises successful migration", () => {
    render(
      <GuestMigrationNotice
        status="complete"
        result={{ migrated: 2, skipped: 0, failed: 0, failedOutcomeIds: [] }}
        onRetry={vi.fn()}
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
        result={{ migrated: 1, skipped: 0, failed: 1, failedOutcomeIds: ["outcome-2"] }}
        onRetry={retry}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry migration" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
