import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { describe, expect, it, vi } from "vitest";
import type { Section } from "@prompted/shared";
import { ImportReviewPanel } from "@/app/(app)/workspace/ImportReviewPanel";
import { TedChangeReview } from "./TedChangeReview";
import { GenerationRecoveryPanel } from "./GenerationRecoveryPanel";
import { WorkspaceSaveNotice } from "./WorkspaceSaveNotice";

const section: Section = {
  id: "section-1",
  document_id: "document-1",
  user_id: "user-1",
  name: "Summary",
  order_index: 0,
  content: "A complete summary with enough information for review and editing.",
  status: "draft",
  version_history: [],
  is_required: true,
  created_at: "2026-07-11T00:00:00.000Z",
  updated_at: "2026-07-11T00:00:00.000Z",
};

const fidelity = {
  sourceType: "docx" as const,
  warnings: ["Word tables and text boxes still need review."],
  confidenceBySectionId: { "section-1": "medium" as const },
  evidenceBySectionId: { "section-1": ["A distinct heading was detected."] },
};

describe("repair workflow accessibility", () => {
  it("has no automated accessibility violations in import review", async () => {
    const { container } = render(
      <ImportReviewPanel
        title="Resume"
        initialSections={[section]}
        fidelity={fidelity}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("supports keyboard activation for import confirmation", async () => {
    const confirm = vi.fn();
    const user = userEvent.setup();
    const { getByRole } = render(
      <ImportReviewPanel
        title="Resume"
        initialSections={[section]}
        fidelity={fidelity}
        onBack={vi.fn()}
        onConfirm={confirm}
      />,
    );

    const button = getByRole("button", { name: "Create workspace" });
    button.focus();
    await user.keyboard("{Enter}");
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("has no automated violations in TED change review", async () => {
    const { container } = render(
      <TedChangeReview
        suggested="Suggested wording"
        changes={["Removed a weak qualifier.", "Tightened the closing sentence."]}
        explanation="TED improved clarity."
        onApply={vi.fn()}
        onRetry={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no automated violations in recovery and sync states", async () => {
    const { container } = render(
      <>
        <GenerationRecoveryPanel
          issues={[{
            sectionId: "section-1",
            sectionName: "Summary",
            reason: "TED could not safely finish this section.",
            attempts: 1,
          }]}
          regeneratingSectionId={null}
          onRetry={vi.fn()}
        />
        <WorkspaceSaveNotice
          authenticated
          syncStatus="failed"
          lastSyncedAt={null}
          onRetry={vi.fn()}
        />
      </>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
