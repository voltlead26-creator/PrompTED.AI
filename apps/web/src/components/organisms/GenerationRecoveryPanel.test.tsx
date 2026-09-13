import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/outcomes/outcome-1",
  useSearchParams: () => new URLSearchParams("section=work"),
}));

import { GenerationRecoveryPanel } from "./GenerationRecoveryPanel";

describe("GenerationRecoveryPanel", () => {
  it("stays hidden when every section is complete", () => {
    const { container } = render(
      <GenerationRecoveryPanel
        issues={[]}
        regeneratingSectionId={null}
        onRetry={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("retries only the affected section", async () => {
    const retry = vi.fn();
    render(
      <GenerationRecoveryPanel
        issues={[{
          sectionId: "section-2",
          sectionName: "Work experience",
          reason: "TED did not produce safe final wording for this section.",
          attempts: 0,
        }]}
        regeneratingSectionId={null}
        onRetry={retry}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Regenerate this section" }));
    expect(retry).toHaveBeenCalledWith("section-2");
  });

  it("shows progress and blocks parallel retries", () => {
    render(
      <GenerationRecoveryPanel
        issues={[{
          sectionId: "section-2",
          sectionName: "Work experience",
          reason: "TED did not produce safe final wording for this section.",
          attempts: 1,
        }]}
        regeneratingSectionId="section-2"
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Regenerating…" })).toBeDisabled();
  });

  it.each([
    {
      sectionName: "Monthly document limit reached",
      reason: "You've reached your document limit for this month. New allowance becomes available next month.",
    },
    {
      sectionName: "Document generation paused",
      reason: "PrompTED could not confirm the document limit details. New generation is paused. You can still edit your existing wording.",
    },
  ])("shows $sectionName without an upgrade or regeneration action", ({ sectionName, reason }) => {
    const retry = vi.fn();
    render(
      <GenerationRecoveryPanel
        issues={[{
          sectionId: "__document_limit__",
          sectionName,
          reason,
          attempts: 0,
          retryable: false,
        }]}
        regeneratingSectionId={null}
        onRetry={retry}
      />,
    );

    expect(screen.getByRole("heading", { name: sectionName })).toBeInTheDocument();
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.getByText(/read, edit and export/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /update subscription|view plans|upgrade/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
    expect(screen.queryByText(/choose a plan with more/i)).toBeNull();
    expect(retry).not.toHaveBeenCalled();
  });

  it("retains the subscription action for an actual lower-plan paywall", () => {
    render(
      <GenerationRecoveryPanel
        issues={[{
          sectionId: "__paywall__",
          sectionName: "Out of document credits",
          reason: "You've used all your document credits for this month. Update your subscription to keep using TED.",
          attempts: 0,
        }]}
        regeneratingSectionId={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("link", { name: "Update subscription" })).toHaveAttribute("href", "/settings/account");
    expect(screen.getByText(/choose a plan with more monthly documents/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
  });

  it("returns to the interrupted document after sign-in", () => {
    render(
      <GenerationRecoveryPanel
        issues={[{
          sectionId: "__auth__",
          sectionName: "Sign in again",
          reason: "Your session has expired. Sign in again, then retry this document.",
          attempts: 0,
        }]}
        regeneratingSectionId={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Your session has expired" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in again" })).toHaveAttribute(
      "href",
      "/sign-in?next=%2Foutcomes%2Foutcome-1%3Fsection%3Dwork",
    );
    expect(screen.queryByRole("button", { name: "Regenerate this section" })).not.toBeInTheDocument();
  });
});
