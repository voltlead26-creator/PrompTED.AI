import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkflowTruth } from "./WorkflowTruth";

describe("independent device and account save truth", () => {
  it.each(["unknown", "quota_exceeded", "unavailable"] as const)(
    "does not claim device durability after %s and account failure",
    (deviceSaveStatus) => {
      render(<WorkflowTruth syncStatus="failed" deviceSaveStatus={deviceSaveStatus} />);
      expect(screen.getByRole("status")).not.toHaveTextContent(
        /saved on this device|saved in this tab|saved to your account/i,
      );
      expect(screen.getByRole("status")).toHaveTextContent(/account save needs attention/i);
    },
  );
  it("can prove a tab copy while account saving has failed", () => {
    render(<WorkflowTruth syncStatus="failed" deviceSaveStatus="saved" />);
    expect(screen.getByRole("status")).toHaveTextContent(/saved in this tab/i);
    expect(screen.getByRole("status")).toHaveTextContent(/account save needs attention/i);
  });
  it("does not downgrade a confirmed account save because browser caching failed", () => {
    render(<WorkflowTruth syncStatus="saved" deviceSaveStatus="quota_exceeded" />);
    expect(screen.getByRole("status")).toHaveTextContent("Saved to your account");
    expect(screen.getByRole("status")).not.toHaveTextContent(/saved in this tab/i);
  });
});
