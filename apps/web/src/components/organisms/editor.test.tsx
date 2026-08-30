import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { renderHook, act } from "@testing-library/react";
import type { Section, SectionVersion } from "@prompted/shared";

import { EditWithTED } from "./EditWithTED";
import { ExplainWithTED } from "./ExplainWithTED";
import { VersionHistory } from "./VersionHistory";
import { SectionEditor, wouldEraseTedPlaceholder } from "./SectionEditor";
import { renderTedPlaceholdersForEditor } from "./TedPlaceholderExtension";
import { useVersionHistory } from "@/hooks/useVersionHistory";

function section(overrides: Partial<Section>): Section {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: "s1",
    document_id: "d1",
    user_id: "u1",
    name: "Introduction",
    order_index: 0,
    content: "<p>Hello.</p>",
    status: "draft",
    version_history: [],
    is_required: true,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("tEdit panel", () => {
  it("offers five clear edit actions", () => {
    render(
      <EditWithTED
        streaming={false}
        hasSelection={false}
        onRun={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    for (const label of ["Make clearer", "Shorten", "Expand", "Change tone", "Add detail"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("runs an action when clicked", async () => {
    const onRun = vi.fn();
    render(
      <EditWithTED
        streaming={false}
        hasSelection={false}
        onRun={onRun}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Make clearer" }));
    expect(onRun).toHaveBeenCalledWith("improve", undefined);
  });

  it("shows the selected-wording scope", () => {
    render(
      <EditWithTED
        streaming={false}
        hasSelection
        onRun={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Selected wording")).toBeInTheDocument();
  });

  it("disables actions and shows Cancel while streaming", async () => {
    const onCancel = vi.fn();
    render(
      <EditWithTED
        streaming
        hasSelection={false}
        onRun={vi.fn()}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("button", { name: "Make clearer" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("passes axe", async () => {
    const { container } = render(
      <EditWithTED
        streaming={false}
        hasSelection={false}
        onRun={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("ExplainWithTED panel", () => {
  it("offers the explanation prompts", () => {
    render(
      <ExplainWithTED
        running={false}
        hasSelection={false}
        onRun={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    for (const label of ["Plain English", "Make simpler", "Why it matters", "Watch for risks"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("passes axe", async () => {
    const { container } = render(
      <ExplainWithTED
        running={false}
        hasSelection
        onRun={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("VersionHistory", () => {
  const versions: SectionVersion[] = [
    { content: "Newest text", saved_at: "2026-03-03T10:00:00.000Z" },
    { content: "Older text", saved_at: "2026-02-02T10:00:00.000Z" },
  ];

  it("lists versions and restores the selected one", async () => {
    const onRestore = vi.fn();
    render(
      <VersionHistory
        open
        versions={versions}
        onClose={vi.fn()}
        onRestore={onRestore}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Version history" })).toBeInTheDocument();
    expect(screen.getByText("Newest text")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Restore this version/i }));
    expect(onRestore).toHaveBeenCalledWith(versions[0]);
  });

  it("shows an empty state when there are no versions", () => {
    render(<VersionHistory open versions={[]} onClose={vi.fn()} onRestore={vi.fn()} />);
    expect(screen.getByText(/No earlier versions yet/i)).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <VersionHistory open={false} versions={versions} onClose={vi.fn()} onRestore={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("passes axe", async () => {
    const { container } = render(
      <VersionHistory open versions={versions} onClose={vi.fn()} onRestore={vi.fn()} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("useVersionHistory", () => {
  it("sorts versions newest-first and is non-destructive on restore", () => {
    let sections: Section[] = [
      section({
        id: "x",
        content: "current",
        version_history: [
          { content: "v1", saved_at: "2026-01-01T00:00:00.000Z" },
          { content: "v2", saved_at: "2026-02-01T00:00:00.000Z" },
        ],
      }),
    ];
    const setSections = (next: Section[] | ((prev: Section[]) => Section[])) => {
      sections = typeof next === "function" ? next(sections) : next;
    };

    const { result } = renderHook(() => useVersionHistory(setSections));
    const ordered = result.current.versionsFor(sections[0]!);
    expect(ordered[0]?.content).toBe("v2");

    act(() => {
      result.current.restore("x", { content: "v1", saved_at: "2026-01-01T00:00:00.000Z" });
    });

    expect(sections[0]?.content).toBe("v1");
    expect(sections[0]?.status).toBe("edited");
    expect(sections[0]?.version_history).toHaveLength(3);
    expect(sections[0]?.version_history.some((version) => version.content === "current")).toBe(true);
  });
});

describe("SectionEditor", () => {
  beforeEach(() => {
    if (!Range.prototype.getClientRects) {
      Range.prototype.getClientRects = () =>
        ({ length: 0, item: () => null }) as unknown as DOMRectList;
    }
    if (!Range.prototype.getBoundingClientRect) {
      Range.prototype.getBoundingClientRect = () => ({}) as DOMRect;
    }
  });

  it("renders the rich-text toolbar with all six format actions", async () => {
    render(
      <SectionEditor
        section={section({})}
        onEdit={vi.fn()}
        onApprove={vi.fn()}
        onUnapprove={vi.fn()}
        onToggleLock={vi.fn()}
        onOpenHistory={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeInTheDocument());
    for (const label of ["Bold", "Italic", "Heading 2", "Heading 3", "Bullet list", "Numbered list"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("renders TED placeholder-only sections as visible interactive controls", async () => {
    render(
      <SectionEditor
        section={section({
          content:
            "{{TED_PLACEHOLDER:complaint_letter.issue.section_content:The Issue needs your input}}",
        })}
        onEdit={vi.fn()}
        onApprove={vi.fn()}
        onUnapprove={vi.fn()}
        onToggleLock={vi.fn()}
        onOpenHistory={vi.fn()}
        onPlaceholderSelect={vi.fn()}
      />,
    );

    expect(await screen.findByRole("button", {
      name: /Missing information: The Issue needs your input/i,
    })).toBeInTheDocument();
  });

  it("does not allow an empty editor shell to erase a TED placeholder", () => {
    expect(
      wouldEraseTedPlaceholder(
        '<p><br class="ProseMirror-trailingBreak"></p>',
        "{{TED_PLACEHOLDER:complaint_letter.issue.section_content:The Issue needs your input}}",
      ),
    ).toBe(true);

    expect(
      wouldEraseTedPlaceholder(
        "<p>Confirmed issue details.</p>",
        "{{TED_PLACEHOLDER:complaint_letter.issue.section_content:The Issue needs your input}}",
      ),
    ).toBe(false);
  });

  it("keeps tEdit hidden until the user opens it", async () => {
    render(
      <SectionEditor
        section={section({})}
        onEdit={vi.fn()}
        onApprove={vi.fn()}
        onUnapprove={vi.fn()}
        onToggleLock={vi.fn()}
        onOpenHistory={vi.fn()}
      />,
    );
    expect(screen.queryByRole("complementary", { name: "tEdit" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "tEdit" }));
    expect(screen.getByRole("complementary", { name: "tEdit" })).toBeInTheDocument();
  });

  it("keeps the Explain this panel hidden until the button is clicked", async () => {
    render(
      <SectionEditor
        section={section({})}
        onEdit={vi.fn()}
        onApprove={vi.fn()}
        onUnapprove={vi.fn()}
        onToggleLock={vi.fn()}
        onOpenHistory={vi.fn()}
      />,
    );
    expect(screen.queryByRole("complementary", { name: "Explain this" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Explain this/i }));
    expect(screen.getByRole("complementary", { name: "Explain this" })).toBeInTheDocument();
  });

  it("opens version history from the overflow menu", async () => {
    const onOpenHistory = vi.fn();
    render(
      <SectionEditor
        section={section({})}
        onEdit={vi.fn()}
        onApprove={vi.fn()}
        onUnapprove={vi.fn()}
        onToggleLock={vi.fn()}
        onOpenHistory={onOpenHistory}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /History/i }));
    expect(onOpenHistory).toHaveBeenCalledOnce();
  });

  it("approves the section from the overflow menu", async () => {
    const onApprove = vi.fn();
    render(
      <SectionEditor
        section={section({ id: "z", status: "edited" })}
        onEdit={vi.fn()}
        onApprove={onApprove}
        onUnapprove={vi.fn()}
        onToggleLock={vi.fn()}
        onOpenHistory={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Approve section/i }));
    expect(onApprove).toHaveBeenCalledWith("z");
  });
});

describe("renderTedPlaceholdersForEditor", () => {
  it("converts TED placeholder tokens into editor placeholder spans", () => {
    expect(
      renderTedPlaceholdersForEditor(
        "<p>{{TED_PLACEHOLDER:doc.section.fact:confirmed detail}}</p>",
      ),
    ).toContain('data-ted-placeholder-id="doc.section.fact"');
  });
});
