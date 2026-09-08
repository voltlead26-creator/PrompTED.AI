import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceSaveNotice } from "./WorkspaceSaveNotice";

describe("WorkspaceSaveNotice", () => {
  it("warns guests that work is stored on this device only", () => {
    render(
      <WorkspaceSaveNotice
        authenticated={false}
        syncStatus="local_only"
        deviceSaveStatus="saved"
        lastSyncedAt={null}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText("Saved in this browser tab only.")).toBeInTheDocument();
  });

  it("renders nothing while saving (healthy state)", () => {
    const { container } = render(
      <WorkspaceSaveNotice
        authenticated
        syncStatus="saving"
        lastSyncedAt={null}
        onRetry={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing once saved (healthy state)", () => {
    const { container } = render(
      <WorkspaceSaveNotice
        authenticated
        syncStatus="saved"
        lastSyncedAt="2026-07-11T08:30:00.000Z"
        onRetry={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers retry after sync failure", async () => {
    const retry = vi.fn();
    render(
      <WorkspaceSaveNotice authenticated syncStatus="failed" lastSyncedAt={null} onRetry={retry} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry sync" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("shows an offline warning when connectivity is lost", () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    try {
      render(
        <WorkspaceSaveNotice
          authenticated
          syncStatus="saved"
          lastSyncedAt={null}
          onRetry={vi.fn()}
        />,
      );
      expect(screen.getByText("Offline.")).toBeInTheDocument();
    } finally {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    }
  });
});

it.each(["failed", "local_only"] as const)("does not infer a tab copy from %s", (syncStatus) => {
  render(
    <WorkspaceSaveNotice
      authenticated={syncStatus !== "local_only"}
      syncStatus={syncStatus}
      deviceSaveStatus="quota_exceeded"
      lastSyncedAt={null}
      onRetry={vi.fn()}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(/browser storage is full/i);
  expect(screen.getByRole("alert")).toHaveTextContent(/keep this page open/i);
  expect(screen.getByRole("alert")).not.toHaveTextContent(
    /saved on this device|saved in this tab/i,
  );
});
