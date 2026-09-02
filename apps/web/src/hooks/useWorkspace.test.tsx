import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Section } from "@prompted/shared";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";

const mockSetSections = vi.fn();
const mockSetUnresolvedPlaceholders = vi.fn();
const mockRegisterWorkspaceSectionBody = vi.fn(() => true);
const mockMarkWorkspaceReadUnavailable = vi.fn();
const mockFetchWorkspaceSectionBody = vi.fn();
const mockUseDocument = vi.fn();

vi.mock("@/components/providers", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/lib/api/sections", () => ({
  fetchWorkspaceSectionBody: (...args: unknown[]) => mockFetchWorkspaceSectionBody(...args),
}));

function documentState(sections: Section[]) {
  return {
    state: {
      documentId: "doc-1",
      title: "Complaint Letter",
      situation: "I need a complaint letter about a billing issue.",
      status: "draft",
      generated: false,
      templateId: "complaint_letter",
      conversationContext: "",
      uploadContext: "",
      unresolvedPlaceholders: [],
      sections,
    },
    loading: false,
    drafting: false,
    syncStatus: "saved",
    lastSyncedAt: null,
    retrySync: vi.fn(),
    generationIssues: [],
    regeneratingSectionId: null,
    retryGenerationSection: vi.fn(),
    setSections: mockSetSections,
    registerWorkspaceSectionBody: mockRegisterWorkspaceSectionBody,
    markWorkspaceReadUnavailable: mockMarkWorkspaceReadUnavailable,
    setStatus: vi.fn(),
    missingInfo: [],
    dismissMissingInfo: vi.fn(),
    unresolvedPlaceholders: [],
    setUnresolvedPlaceholders: mockSetUnresolvedPlaceholders,
    captured: false,
    currentRevision: 1,
    approvedRevision: null,
    operationId: null,
    operationRevision: null,
    approving: false,
    approveDocument: vi.fn(),
    requestCapturedExport: vi.fn(),
    exportEligible: false,
    mergePersistedLegacyApply: vi.fn(),
  };
}

vi.mock("./useDocument", () => ({
  AUTH_SECTION_ID: "__auth__",
  useDocument: (...args: unknown[]) => mockUseDocument(...args),
}));

import { useWorkspace } from "./useWorkspace";

describe("useWorkspace", () => {
  beforeEach(() => {
    recordBrowserPrincipal("user-1");
    mockSetSections.mockReset();
    mockSetUnresolvedPlaceholders.mockReset();
    mockRegisterWorkspaceSectionBody.mockReset();
    mockRegisterWorkspaceSectionBody.mockReturnValue(true);
    mockMarkWorkspaceReadUnavailable.mockReset();
    mockFetchWorkspaceSectionBody.mockReset();
    mockUseDocument.mockReset();
    mockUseDocument.mockReturnValue(
      documentState([
        {
          id: "section-1",
          document_id: "doc-1",
          user_id: "user-1",
          key: "issue",
          name: "The Issue",
          order_index: 0,
          content: '<p><br class="ProseMirror-trailingBreak"></p>',
          status: "draft",
          version_history: [],
          is_required: true,
          created_at: "2026-06-01T00:00:00Z",
          updated_at: "2026-06-01T00:00:00Z",
        } satisfies Section,
      ]),
    );
  });

  afterEach(() => recordBrowserPrincipal(undefined));

  it("does not expose blank required sections to the visible workspace", async () => {
    const { result } = renderHook(() => useWorkspace("outcome-1"));

    expect(result.current.sections[0]?.content).toBe(
      "{{TED_PLACEHOLDER:complaint_letter.issue.section_content:The Issue needs your input}}",
    );
    expect(result.current.missingInfoQuestions).toEqual([
      expect.objectContaining({
        placeholderId: "complaint_letter.issue.section_content",
        sectionKey: "issue",
        sectionId: "section-1",
        requiredForExport: true,
      }),
    ]);
    expect(result.current.placeholderExportDecision).toEqual({
      status: "acknowledgement_required",
      total: 1,
      requiredForExport: 1,
    });

    await waitFor(() => {
      expect(mockSetSections).toHaveBeenCalledWith(expect.any(Function));
    });
    expect(mockSetUnresolvedPlaceholders).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "complaint_letter.issue.section_content",
        requiredForExport: true,
      }),
    ]);
  });

  it("exports only a saved persisted document at its exact approved revision", () => {
    const approved = {
      id: "section-approved",
      document_id: "doc-1",
      user_id: "user-1",
      name: "Approved wording",
      order_index: 0,
      content: "Final synthetic wording.",
      status: "approved" as const,
      version_history: [],
      is_required: true,
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
    } satisfies Section;
    const saved = {
      ...documentState([approved]),
      currentRevision: 4,
      approvedRevision: 4,
    };
    mockUseDocument.mockReturnValue(saved);
    const hook = renderHook(() => useWorkspace("outcome-1"));
    expect(hook.result.current.canExport).toBe(true);

    mockUseDocument.mockReturnValue({
      ...saved,
      state: { ...saved.state, documentId: null },
    });
    hook.rerender();
    expect(hook.result.current.canExport).toBe(false);

    mockUseDocument.mockReturnValue({ ...saved, syncStatus: "failed" });
    hook.rerender();
    expect(hook.result.current.canExport).toBe(false);

    mockUseDocument.mockReturnValue({ ...saved, approvedRevision: 3 });
    hook.rerender();
    expect(hook.result.current.canExport).toBe(false);
  });

  it("keeps unloaded sections unavailable and preserves the current editor until activation loads", async () => {
    let resolveBody:
      ((value: Awaited<ReturnType<typeof mockFetchWorkspaceSectionBody>>) => void) | undefined;
    mockFetchWorkspaceSectionBody.mockReturnValue(
      new Promise((resolve) => {
        resolveBody = resolve;
      }),
    );
    mockUseDocument.mockReturnValue(
      documentState([
        {
          id: "section-1",
          document_id: "doc-1",
          user_id: "user-1",
          key: "first",
          name: "First",
          order_index: 0,
          content: "Unsaved local wording remains focused.",
          status: "edited",
          version_history: [],
          is_required: true,
          created_at: "2026-06-01T00:00:00Z",
          updated_at: "2026-06-01T00:00:00Z",
          content_loaded: true,
          content_sha256: "a".repeat(64),
          content_length: 37,
          revision: 2,
          approved_revision: null,
          ledger_binding_status: "legacy_unversioned",
          section_key: null,
          section_state: null,
        } as Section,
        {
          id: "section-2",
          document_id: "doc-1",
          user_id: "user-1",
          key: "second",
          name: "Second",
          order_index: 1,
          content: "",
          status: "draft",
          version_history: [],
          is_required: true,
          created_at: "2026-06-01T00:00:00Z",
          updated_at: "2026-06-01T00:00:00Z",
          content_loaded: false,
          content_sha256: "b".repeat(64),
          content_length: 22,
          revision: 4,
          approved_revision: null,
          ledger_binding_status: "legacy_unversioned",
          section_key: null,
          section_state: null,
        } as Section,
      ]),
    );

    const { result } = renderHook(() => useWorkspace("outcome-1"));
    expect(result.current.activeSectionId).toBe("section-1");
    expect(result.current.sections[1]?.content).toBe("");
    expect(result.current.missingInfoQuestions).toEqual([]);

    act(() => result.current.selectSection("section-2"));
    expect(result.current.activeSectionId).toBe("section-1");
    expect(result.current.activeSection?.content).toBe("Unsaved local wording remains focused.");
    expect(mockFetchWorkspaceSectionBody).toHaveBeenCalledWith(
      {
        outcomeId: "outcome-1",
        sectionId: "section-2",
        expectedDocumentRevision: 1,
        expectedSectionRevision: 4,
      },
      expect.objectContaining({ expectedUserId: "user-1" }),
    );

    await act(async () => {
      resolveBody?.({
        contractVersion: "workspace-section-body.v1",
        outcomeId: "outcome-1",
        documentId: "doc-1",
        documentRevision: 1,
        sectionId: "section-2",
        sectionRevision: 4,
        content: "Loaded second wording.",
        contentSha256: "b".repeat(64),
        contentLength: 22,
        status: "draft",
        approvedRevision: null,
        ledgerBindingStatus: "legacy_unversioned",
        sectionKey: null,
        sectionState: null,
        updatedAt: "2026-09-01T00:00:00.000Z",
      });
    });

    await waitFor(() => expect(result.current.activeSectionId).toBe("section-2"));
    expect(result.current.activeSection?.content).toBe("Loaded second wording.");
    expect(mockRegisterWorkspaceSectionBody).toHaveBeenCalledTimes(1);
    expect(mockSetSections).not.toHaveBeenCalled();
  });

  it("rejects a stale activation body without moving focus or exposing a blank editor", async () => {
    mockFetchWorkspaceSectionBody.mockRejectedValue(new Error("WORKSPACE_SECTION_BODY_INVALID"));
    mockUseDocument.mockReturnValue(
      documentState([
        {
          id: "section-1",
          document_id: "doc-1",
          user_id: "user-1",
          name: "First",
          order_index: 0,
          content: "Current editor wording",
          status: "edited",
          version_history: [],
          is_required: true,
          created_at: "2026-06-01T00:00:00Z",
          updated_at: "2026-06-01T00:00:00Z",
          content_loaded: true,
          content_sha256: "a".repeat(64),
          content_length: 22,
          revision: 2,
          approved_revision: null,
          ledger_binding_status: "legacy_unversioned",
          section_key: null,
          section_state: null,
        } as Section,
        {
          id: "section-2",
          document_id: "doc-1",
          user_id: "user-1",
          name: "Second",
          order_index: 1,
          content: "",
          status: "draft",
          version_history: [],
          is_required: true,
          created_at: "2026-06-01T00:00:00Z",
          updated_at: "2026-06-01T00:00:00Z",
          content_loaded: false,
          content_sha256: "b".repeat(64),
          content_length: 20,
          revision: 3,
          approved_revision: null,
          ledger_binding_status: "legacy_unversioned",
          section_key: null,
          section_state: null,
        } as Section,
      ]),
    );

    const { result } = renderHook(() => useWorkspace("outcome-1"));
    act(() => result.current.selectSection("section-2"));

    await waitFor(() => expect(mockMarkWorkspaceReadUnavailable).toHaveBeenCalledTimes(1));
    expect(result.current.activeSectionId).toBe("section-1");
    expect(result.current.activeSection?.content).toBe("Current editor wording");
    expect(mockRegisterWorkspaceSectionBody).not.toHaveBeenCalled();
  });

  it("rejects a body that becomes stale while its activation request is in flight", async () => {
    let documentRevision = 1;
    let resolveBody:
      ((value: Awaited<ReturnType<typeof mockFetchWorkspaceSectionBody>>) => void) | undefined;
    mockFetchWorkspaceSectionBody.mockReturnValue(
      new Promise((resolve) => {
        resolveBody = resolve;
      }),
    );
    const sections = [
      {
        id: "section-1",
        document_id: "doc-1",
        user_id: "user-1",
        name: "First",
        order_index: 0,
        content: "Current editor wording",
        status: "edited" as const,
        version_history: [],
        is_required: true,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
        content_loaded: true,
        content_sha256: "a".repeat(64),
        content_length: 22,
        revision: 2,
        approved_revision: null,
        ledger_binding_status: "legacy_unversioned",
        section_key: null,
        section_state: null,
      } as Section,
      {
        id: "section-2",
        document_id: "doc-1",
        user_id: "user-1",
        name: "Second",
        order_index: 1,
        content: "",
        status: "draft" as const,
        version_history: [],
        is_required: true,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
        content_loaded: false,
        content_sha256: "b".repeat(64),
        content_length: 20,
        revision: 3,
        approved_revision: null,
        ledger_binding_status: "legacy_unversioned",
        section_key: null,
        section_state: null,
      } as Section,
    ];
    mockUseDocument.mockImplementation(() => ({
      ...documentState(sections),
      currentRevision: documentRevision,
    }));

    const { result, rerender } = renderHook(() => useWorkspace("outcome-1"));
    act(() => result.current.selectSection("section-2"));
    expect(mockFetchWorkspaceSectionBody).toHaveBeenCalledWith(
      expect.objectContaining({ expectedDocumentRevision: 1 }),
      expect.objectContaining({ expectedUserId: "user-1" }),
    );

    documentRevision = 2;
    rerender();
    await act(async () => {
      resolveBody?.({
        contractVersion: "workspace-section-body.v1",
        outcomeId: "outcome-1",
        documentId: "doc-1",
        documentRevision: 1,
        sectionId: "section-2",
        sectionRevision: 3,
        content: "Now-stale wording.",
        contentSha256: "b".repeat(64),
        contentLength: 20,
        status: "draft",
        approvedRevision: null,
        ledgerBindingStatus: "legacy_unversioned",
        sectionKey: null,
        sectionState: null,
        updatedAt: "2026-09-01T00:00:00.000Z",
      });
    });

    await waitFor(() => expect(mockMarkWorkspaceReadUnavailable).toHaveBeenCalledTimes(1));
    expect(mockRegisterWorkspaceSectionBody).not.toHaveBeenCalled();
    expect(result.current.activeSectionId).toBe("section-1");
    expect(result.current.activeSection?.content).toBe("Current editor wording");
  });

  it("hydrates every omitted body at the exact revision before returning a full preview", async () => {
    const loaded = {
      id: "section-1",
      document_id: "doc-1",
      user_id: "user-1",
      name: "First",
      order_index: 0,
      content: "Current editor wording",
      status: "edited" as const,
      version_history: [],
      is_required: true,
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
      content_loaded: true,
      content_sha256: "a".repeat(64),
      content_length: 22,
      revision: 2,
      approved_revision: null,
      ledger_binding_status: "legacy_unversioned" as const,
      section_key: null,
      section_state: null,
    } as Section;
    const deferred = {
      ...loaded,
      id: "section-2",
      name: "Second",
      order_index: 1,
      content: "",
      status: "draft" as const,
      content_loaded: false,
      content_sha256: "b".repeat(64),
      content_length: 22,
      revision: 4,
    } as Section;
    mockUseDocument.mockReturnValue(documentState([loaded, deferred]));
    mockFetchWorkspaceSectionBody.mockResolvedValue({
      contractVersion: "workspace-section-body.v1",
      outcomeId: "outcome-1",
      documentId: "doc-1",
      documentRevision: 1,
      sectionId: "section-2",
      sectionRevision: 4,
      content: "Loaded second wording.",
      contentSha256: "b".repeat(64),
      contentLength: 22,
      status: "draft",
      approvedRevision: null,
      ledgerBindingStatus: "legacy_unversioned",
      sectionKey: null,
      sectionState: null,
      updatedAt: "2026-09-01T00:00:00.000Z",
    });

    const { result } = renderHook(() => useWorkspace("outcome-1"));
    const preview: { value: Section[] | null } = { value: null };
    await act(async () => {
      preview.value = await result.current.loadFullPreview();
    });

    expect(mockFetchWorkspaceSectionBody).toHaveBeenCalledWith(
      {
        outcomeId: "outcome-1",
        sectionId: "section-2",
        expectedDocumentRevision: 1,
        expectedSectionRevision: 4,
      },
      expect.objectContaining({ expectedUserId: "user-1" }),
    );
    expect(preview.value?.map((item) => item.content)).toEqual([
      "Current editor wording",
      "Loaded second wording.",
    ]);
    expect(mockRegisterWorkspaceSectionBody).toHaveBeenCalledTimes(1);
  });

  it("rejects the entire full preview when the document revision changes mid-load", async () => {
    let documentRevision = 1;
    let resolveBody!: (value: Record<string, unknown>) => void;
    const deferred = {
      id: "section-2",
      document_id: "doc-1",
      user_id: "user-1",
      name: "Second",
      order_index: 0,
      content: "",
      status: "draft" as const,
      version_history: [],
      is_required: true,
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
      content_loaded: false,
      content_sha256: "b".repeat(64),
      content_length: 22,
      revision: 4,
      approved_revision: null,
      ledger_binding_status: "legacy_unversioned" as const,
      section_key: null,
      section_state: null,
    } as Section;
    mockUseDocument.mockImplementation(() => ({
      ...documentState([deferred]),
      currentRevision: documentRevision,
    }));
    mockFetchWorkspaceSectionBody.mockReturnValue(
      new Promise((resolve) => { resolveBody = resolve; }),
    );
    const { result, rerender } = renderHook(() => useWorkspace("outcome-1"));
    let previewPromise!: Promise<Section[] | null>;
    act(() => {
      previewPromise = result.current.loadFullPreview();
    });
    documentRevision = 2;
    rerender();
    resolveBody({
      contractVersion: "workspace-section-body.v1",
      outcomeId: "outcome-1",
      documentId: "doc-1",
      documentRevision: 1,
      sectionId: "section-2",
      sectionRevision: 4,
      content: "Now stale wording.",
      contentSha256: "b".repeat(64),
      contentLength: 22,
      status: "draft",
      approvedRevision: null,
      ledgerBindingStatus: "legacy_unversioned",
      sectionKey: null,
      sectionState: null,
      updatedAt: "2026-09-01T00:00:00.000Z",
    });

    await expect(previewPromise).resolves.toBeNull();
    expect(mockRegisterWorkspaceSectionBody).not.toHaveBeenCalled();
  });
});
