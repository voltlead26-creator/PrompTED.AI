import { useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Section } from "@prompted/shared/browser";
import type { UseWorkspace } from "@/hooks/useWorkspace";

const editorMounted = vi.hoisted(() => vi.fn());

vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

vi.mock("./SectionEditor", () => ({
  SectionEditor: ({ section }: { section: Section }) => {
    useEffect(() => {
      editorMounted(section.id);
    }, [section.id]);
    return <div>{section.content}</div>;
  },
}));

import { WorkspacePane } from "./WorkspacePane";

function makeSection(content: string): Section {
  return {
    id: "section-1",
    document_id: "document-1",
    user_id: "user-1",
    name: "Summary",
    order_index: 0,
    content,
    status: "edited",
    version_history: [],
    is_required: true,
    created_at: "2026-08-31T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:00.000Z",
  };
}

function workspace(content: string): UseWorkspace {
  const current = makeSection(content);
  return {
    loading: false,
    drafting: false,
    syncStatus: "saved",
    lastSyncedAt: null,
    retrySync: vi.fn(),
    generationIssues: [],
    regeneratingSectionId: null,
    retryGenerationSection: vi.fn(),
    missingInfoQuestions: [],
    answerMissingInfo: vi.fn(),
    dismissMissingInfo: vi.fn(),
    applyNeutralReplacement: vi.fn(),
    answeringMissingInfo: false,
    unresolvedPlaceholders: [],
    selectedPlaceholderId: null,
    selectMissingPlaceholder: vi.fn(),
    placeholderExportDecision: { status: "clear", total: 0, requiredForExport: 0 },
    documentId: "document-1",
    title: "Resume",
    situation: "Apply for a role",
    status: "draft",
    sections: [current],
    activeSection: current,
    activeSectionId: current.id,
    selectSection: vi.fn(),
    approval: {
      approved: 0,
      required: 1,
      total: 1,
      allRequiredApproved: false,
      label: "0 of 1 section approved",
    },
    canExport: false,
    section: {
      editContent: vi.fn(),
      approve: vi.fn(),
      unapprove: vi.fn(),
      toggleLock: vi.fn(),
    },
    reorder: {
      moveUp: vi.fn(),
      moveDown: vi.fn(),
      dropAt: vi.fn(),
    },
    versionHistory: {
      versionsFor: vi.fn(() => []),
      restore: vi.fn(),
    },
    markExported: vi.fn(),
    captured: false,
    currentRevision: null,
    approvedRevision: null,
    operationId: null,
    operationRevision: null,
    approving: false,
    approveDocument: vi.fn().mockResolvedValue(false),
    requestCapturedExport: vi.fn().mockResolvedValue(null),
  };
}

describe("WorkspacePane editor identity", () => {
  beforeEach(() => {
    editorMounted.mockReset();
  });

  it("keeps the editor mounted when the same section receives new content", async () => {
    const { rerender } = render(
      <WorkspacePane workspace={workspace("First wording")} onExport={vi.fn()} />,
    );
    await waitFor(() => expect(editorMounted).toHaveBeenCalledTimes(1));

    rerender(<WorkspacePane workspace={workspace("Updated wording")} onExport={vi.fn()} />);

    await waitFor(() => expect(editorMounted).toHaveBeenCalledTimes(1));
  });

  it("renders a bounded plain-text rail excerpt without injecting section HTML", () => {
    const content = `<p>Visible <strong>wording</strong></p>${"x".repeat(240)}`;
    const { container } = render(
      <WorkspacePane workspace={workspace(content)} onExport={vi.fn()} />,
    );

    const excerpt = container.querySelector("aside button p");
    expect(excerpt?.textContent).toContain("Visible wording");
    expect(excerpt?.querySelector("strong")).toBeNull();
    expect(excerpt?.textContent?.length).toBeLessThanOrEqual(120);
  });
});
