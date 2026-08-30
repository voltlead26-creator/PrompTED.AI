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
