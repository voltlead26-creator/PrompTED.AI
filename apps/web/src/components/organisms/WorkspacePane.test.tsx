import { useEffect } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Section } from "@prompted/shared/browser";
import type { UseWorkspace } from "@/hooks/useWorkspace";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";

const editorMounted = vi.hoisted(() => vi.fn());
const historyFetch = vi.hoisted(() => vi.fn());

vi.mock("next/dynamic", () => ({
  default: () => (props: Record<string, unknown>) => {
    if ("versions" in props) {
      const versions = props.versions as Array<{ content: string }>;
      const onRestore = props.onRestore as ((version: { content: string }) => void) | undefined;
      return versions[0] && onRestore ? (
        <button type="button" onClick={() => onRestore(versions[0]!)}>
          Restore test version
        </button>
      ) : null;
    }
    if ("sections" in props) {
      const sections = props.sections as Section[];
      return <div data-testid="loaded-preview">{sections.map((item) => item.name).join(", ")}</div>;
    }
    return null;
  },
}));

vi.mock("@/lib/api/sections", () => ({
  fetchSectionVersionHistory: (...args: unknown[]) => historyFetch(...args),
}));

vi.mock("@/components/providers", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
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

function makeSection(content: string, id = "section-1", name = "Summary"): Section {
  return {
    id,
    document_id: "document-1",
    user_id: "user-1",
    name,
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
    placeholderExportDecision: {
      status: "clear",
      total: 0,
      requiredForExport: 0,
    },
    documentId: "document-1",
    title: "Resume",
    situation: "Apply for a role",
    status: "draft",
    sections: [current],
    activeSection: current,
    activeSectionId: current.id,
    selectSection: vi.fn(),
    loadFullPreview: vi.fn(async () => [current]),
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
    mergePersistedLegacyApply: vi.fn(),
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
    rememberCapturedExportDelivery: vi.fn().mockReturnValue(true),
    createUpdatedCapturedExport: vi.fn().mockReturnValue(true),
  };
}

function workspaceWithSections(
  sections: Section[],
  activeSectionId: string,
  overrides: Partial<UseWorkspace> = {},
): UseWorkspace {
  const base = workspace(sections[0]?.content ?? "");
  return {
    ...base,
    sections,
    activeSectionId,
    activeSection: sections.find((item) => item.id === activeSectionId) ?? null,
    loadFullPreview: vi.fn(async () => sections),
    ...overrides,
  };
}

describe("WorkspacePane editor identity", () => {
  beforeEach(() => {
    recordBrowserPrincipal("user-1");
    editorMounted.mockReset();
    historyFetch.mockReset();
    historyFetch.mockResolvedValue([]);
  });

  afterEach(() => recordBrowserPrincipal(undefined));

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

  it("describes an unloaded authoritative section as saved rather than blank", () => {
    const deferred = {
      ...makeSection("", "section-deferred", "Saved details"),
      content_loaded: false,
      content_sha256: "a".repeat(64),
      content_length: 420,
      revision: 3,
      approved_revision: null,
      ledger_binding_status: "legacy_unversioned" as const,
      section_key: "saved_details",
      section_state: "final" as const,
    } as Section;
    render(
      <WorkspacePane
        workspace={workspaceWithSections([deferred], deferred.id)}
        onExport={vi.fn()}
      />,
    );

    expect(screen.getByText("Saved wording loads when opened")).toBeInTheDocument();
    expect(screen.queryByText("No wording yet")).toBeNull();
  });

  it("offers exact replay separately from an explicit updated captured export", async () => {
    const onExport = vi.fn();
    const onCreateUpdatedExport = vi.fn();
    render(
      <WorkspacePane
        workspace={workspaceWithSections([makeSection("Approved wording")], "section-1", {
          captured: true,
          canExport: true,
        })}
        onExport={onExport}
        allowedFormats={["pdf"]}
        capturedExportDelivered
        onCreateUpdatedExport={onCreateUpdatedExport}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Document options" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Download PDF again" }));
    expect(onExport).toHaveBeenCalledWith("pdf");

    await userEvent.click(screen.getByRole("button", { name: "Document options" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Create updated PDF export" }));
    expect(onCreateUpdatedExport).toHaveBeenCalledOnce();
  });

  it("discards section A history if section B becomes active before A resolves", async () => {
    let resolveHistory!: (versions: Array<{ content: string; saved_at: string }>) => void;
    historyFetch.mockReturnValue(
      new Promise((resolve) => {
        resolveHistory = resolve;
      }),
    );
    const sectionA = makeSection("A wording", "section-a", "Section A");
    const sectionB = makeSection("B wording", "section-b", "Section B");
    const restore = vi.fn();
    const { rerender } = render(
      <WorkspacePane
        workspace={workspaceWithSections([sectionA, sectionB], sectionA.id, {
          versionHistory: { versionsFor: vi.fn(() => []), restore },
        })}
        onExport={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Document options" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Version history/i }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading version history");

    rerender(
      <WorkspacePane
        workspace={workspaceWithSections([sectionA, sectionB], sectionB.id, {
          versionHistory: { versionsFor: vi.fn(() => []), restore },
        })}
        onExport={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Version history" })).toBeNull(),
    );
    await act(async () => {
      resolveHistory([{ content: "Old A", saved_at: "2026-09-01T00:00:00.000Z" }]);
      await Promise.resolve();
    });
    expect(screen.queryByRole("button", { name: "Restore test version" })).toBeNull();
    expect(restore).not.toHaveBeenCalled();
  });

  it("waits for complete preview hydration before presenting the document", async () => {
    let resolvePreview!: (sections: Section[] | null) => void;
    const section = makeSection("Saved wording");
    const loadFullPreview = vi.fn(
      () =>
        new Promise<Section[] | null>((resolve) => {
          resolvePreview = resolve;
        }),
    );
    render(
      <WorkspacePane
        workspace={workspaceWithSections([section], section.id, { loadFullPreview })}
        onExport={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Document options" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Preview document/i }));
    expect(screen.getByRole("status")).toHaveTextContent(/Loading every saved section/i);
    expect(screen.queryByTestId("loaded-preview")).toBeNull();

    await act(async () => {
      resolvePreview([section]);
      await Promise.resolve();
    });
    expect(await screen.findByTestId("loaded-preview")).toHaveTextContent("Summary");
  });
});
