import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Section } from "@prompted/shared";
import { ImportReviewPanel } from "./ImportReviewPanel";

function section(id: string, name: string, content: string, order: number): Section {
  return {
    id,
    document_id: "document-1",
    user_id: "user-1",
    name,
    order_index: order,
    content,
    status: "draft",
    version_history: [],
    is_required: true,
    created_at: "2026-07-11T00:00:00.000Z",
    updated_at: "2026-07-11T00:00:00.000Z",
  };
}

const fidelity = {
  sourceType: "docx" as const,
  warnings: [],
  confidenceBySectionId: { one: "high" as const },
  evidenceBySectionId: { one: ["A distinct heading was detected."] },
};

describe("ImportReviewPanel", () => {
  it("does not create a workspace until the user confirms", async () => {
    const onConfirm = vi.fn();
    render(
      <ImportReviewPanel
        title="Resume"
        initialSections={[section("one", "Experience", "First paragraph.\n\nSecond paragraph.", 0)]}
        fidelity={fidelity}
        onBack={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("allows sections to be split before confirmation", async () => {
    render(
      <ImportReviewPanel
        title="Resume"
        initialSections={[section("one", "Experience", "First paragraph.\n\nSecond paragraph.", 0)]}
        fidelity={fidelity}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Split in half" }));
    expect(screen.getByRole("button", { name: "Edit section 1: Experience" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit section 2: Experience — continued" })).toBeInTheDocument();
  });

  it("uses one active editor with a section preview rail", async () => {
    render(
      <ImportReviewPanel
        title="Resume"
        initialSections={[
          section("one", "Experience", "First role", 0),
          section("two", "Education", "Qualification", 1),
        ]}
        fidelity={{
          ...fidelity,
          confidenceBySectionId: { one: "high", two: "medium" },
        }}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole("complementary", { name: "Imported document sections" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Experience")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Education")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit section 2: Education" }));
    expect(screen.getByDisplayValue("Education")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Experience")).not.toBeInTheDocument();
  });

  it("starts directly with the editor without duplicate headings or warnings", () => {
    render(
      <ImportReviewPanel
        title="Resume"
        initialSections={[section("one", "Experience", "First role", 0)]}
        fidelity={{
          ...fidelity,
          warnings: ["Formatting check recommended"],
        }}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.queryByText("Review before creating workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("Check how TED organised Resume")).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing has been added/)).not.toBeInTheDocument();
    expect(screen.queryByText("Formatting check recommended")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Experience")).toBeInTheDocument();
  });

  it("prevents removing the only remaining section", () => {
    render(
      <ImportReviewPanel
        title="Resume"
        initialSections={[section("one", "Experience", "Content", 0)]}
        fidelity={fidelity}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Remove section" })).toBeDisabled();
  });

  it("requires a confirm step before a section is actually removed", async () => {
    render(
      <ImportReviewPanel
        title="Resume"
        initialSections={[
          section("one", "Experience", "First role", 0),
          section("two", "Education", "Qualification", 1),
        ]}
        fidelity={{
          ...fidelity,
          confidenceBySectionId: { one: "high", two: "medium" },
        }}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Remove section" }));
    expect(screen.getByText("Remove this section?")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Experience")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Remove this section?")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Experience")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remove section" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm remove" }));
    expect(screen.queryByDisplayValue("Experience")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Education")).toBeInTheDocument();
  });

  it("does not carry a pending remove-confirmation onto a section produced by split or merge", async () => {
    render(
      <ImportReviewPanel
        title="Resume"
        initialSections={[
          section("one", "Experience", "First paragraph.\n\nSecond paragraph.", 0),
          section("two", "Education", "Qualification", 1),
        ]}
        fidelity={{
          ...fidelity,
          confidenceBySectionId: { one: "high", two: "medium" },
        }}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    // Arm the remove-confirmation, then split the section instead of confirming.
    await userEvent.click(screen.getByRole("button", { name: "Remove section" }));
    expect(screen.getByText("Remove this section?")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Split in half" }));

    // The split section keeps the original id — the pending confirmation must
    // not have carried over onto it.
    expect(screen.queryByText("Remove this section?")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove section" })).toBeInTheDocument();
  });

  it("does not load external resources embedded in imported HTML previews", () => {
    const { container } = render(
      <ImportReviewPanel
        title="Resume"
        initialSections={[
          section(
            "one",
            "Experience",
            '<p>Safe wording</p><img src="https://tracker.example/pixel"><video poster="https://tracker.example/poster"></video>',
            0,
          ),
        ]}
        fidelity={fidelity}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(container.querySelector(".previewPageInner img")).not.toBeInTheDocument();
    expect(container.querySelector(".previewPageInner video")).not.toBeInTheDocument();
    expect(container.querySelector(".previewPageInner")).toHaveTextContent("Safe wording");
  });

  it("grows the content box to fit large content instead of leaving it scrollable at a fixed height", async () => {
    render(
      <ImportReviewPanel
        title="Resume"
        initialSections={[section("one", "Experience", "Short.", 0)]}
        fidelity={fidelity}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    const textarea = screen.getByLabelText("Content") as HTMLTextAreaElement;
    // jsdom never lays out real content, so scrollHeight is stubbed here the
    // same way a real browser would report it for a tall block of text —
    // the resize effect re-reads it whenever the section's content changes.
    Object.defineProperty(textarea, "scrollHeight", { value: 640, configurable: true });
    await userEvent.type(textarea, " More.");

    expect(textarea.style.height).toBe("640px");
  });

  it("shrinks the content box back down when switching to a short section", async () => {
    render(
      <ImportReviewPanel
        title="Resume"
        initialSections={[
          section("one", "Experience", "Long content.", 0),
          section("two", "Education", "One sentence.", 1),
        ]}
        fidelity={fidelity}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Edit section 2: Education" }));
    const secondTextarea = screen.getByLabelText("Content") as HTMLTextAreaElement;
    Object.defineProperty(secondTextarea, "scrollHeight", { value: 130, configurable: true });
    await userEvent.type(secondTextarea, "!");

    expect(secondTextarea.style.height).toBe("130px");
  });
});
