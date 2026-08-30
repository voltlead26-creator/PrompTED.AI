/**
 * Layer 14 — DB persistence wiring tests.
 *
 * Verifies that useDocument loads from the DB for authenticated users,
 * falls back to sessionStorage for anonymous users, and that autosave
 * flushes to DB after changes.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { User } from "@supabase/supabase-js";
import { ApiError, generateDocumentStream } from "@prompted/shared/api-client";
import type { Section } from "@prompted/shared/browser";

const mockUpsertDocument = vi.fn().mockResolvedValue(undefined);
const mockUpsertSections = vi.fn().mockResolvedValue(undefined);
const mockFetchDocumentByOutcomeId = vi.fn().mockResolvedValue(null);
const mockFetchSections = vi.fn().mockResolvedValue([]);
const mockFetchOutcome = vi.fn().mockResolvedValue(null);
const mockSaveWorkspace = vi.fn();
const mockLoadWorkspace = vi.fn().mockReturnValue(null);
const mockLoadPendingOutcome = vi.fn().mockReturnValue(null);
const mockSavePendingOutcome = vi.fn();
const mockEditCapturedSection = vi.fn();
const mockApproveCapturedRevision = vi.fn();
const mockRequestCapturedExport = vi.fn();

vi.mock("@/lib/api/documents", () => ({
  fetchDocumentByOutcomeId: (...args: unknown[]) => mockFetchDocumentByOutcomeId(...args),
  upsertDocument: (...args: unknown[]) => mockUpsertDocument(...args),
  fetchDocument: vi.fn().mockResolvedValue(null),
  updateDocumentStatus: vi.fn().mockResolvedValue(undefined),
  updateDocumentTitle: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/api/outcomes", () => ({
  fetchOutcome: (...args: unknown[]) => mockFetchOutcome(...args),
}));

vi.mock("@/lib/api/sections", () => ({
  fetchSections: (...args: unknown[]) => mockFetchSections(...args),
  upsertSections: (...args: unknown[]) => mockUpsertSections(...args),
  updateSectionContent: vi.fn().mockResolvedValue(undefined),
  updateSectionStatus: vi.fn().mockResolvedValue(undefined),
  persistSectionOrder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/api/captured-document-operations", () => ({
  editCapturedDocumentSection: (...args: unknown[]) =>
    mockEditCapturedSection(...args),
  approveCapturedDocumentRevision: (...args: unknown[]) =>
    mockApproveCapturedRevision(...args),
  requestCapturedDocumentExport: (...args: unknown[]) =>
    mockRequestCapturedExport(...args),
}));

vi.mock("@/lib/workspace-store", () => ({
  loadWorkspace: (...args: unknown[]) => mockLoadWorkspace(...args),
  saveWorkspace: (...args: unknown[]) => mockSaveWorkspace(...args),
  loadPendingOutcome: (...args: unknown[]) => mockLoadPendingOutcome(...args),
  savePendingOutcome: (...args: unknown[]) => mockSavePendingOutcome(...args),
}));

vi.mock("@/components/providers", () => ({
  useAuth: vi.fn(),
}));

let capturedAutosaveCallback: ((value: unknown) => void) | null = null;
vi.mock("./useAutosave", () => ({
  useAutosave: vi.fn().mockImplementation(
    (_value: unknown, callback: (value: unknown) => void) => {
      capturedAutosaveCallback = callback;
    },
  ),
}));

vi.mock("@prompted/shared/api-client", async () => {
  const actual = await vi.importActual<typeof import("@prompted/shared/api-client")>(
    "@prompted/shared/api-client",
  );
  return {
    ...actual,
    generateDocumentStream: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@prompted/shared/workspace", async () => {
  const actual = await vi.importActual<typeof import("@prompted/shared/workspace")>(
    "@prompted/shared/workspace",
  );
  return {
    ...actual,
    buildSeedDocument: vi.fn().mockReturnValue({
      documentId: "seed-doc-id",
      title: "Untitled document",
      sections: [] as Section[],
    }),
  };
});

import { useAuth } from "@/components/providers";
import { useDocument } from "./useDocument";
import type { WorkspaceInitialState } from "@/lib/workspace-initial-state";

const dbDocument = {
  id: "db-doc-id",
  user_id: "user-1",
  outcome_id: "outcome-1",
  title: "DB Title",
  status: "draft" as const,
  format: "word" as const,
  is_template: false,
  template_id: null,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

const dbSections: Section[] = [
  {
    id: "s1",
    document_id: "db-doc-id",
    user_id: "user-1",
    name: "Introduction",
    order_index: 0,
    content: "Hello",
    status: "draft",
    version_history: [],
    is_required: true,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
  },
];

const cachedWorkspace = {
  documentId: "cached-doc-id",
  outcomeId: "outcome-1",
  title: "Cached Title",
  situation: "I need help",
  status: "draft",
  sections: [] as Section[],
};

const serverInitialState: WorkspaceInitialState = {
  workspace: {
    documentId: "server-doc-id",
    title: "Server Title",
    situation: "Persisted situation",
    status: "draft",
    sections: [{
      ...dbSections[0]!,
      id: "server-section",
      document_id: "server-doc-id",
      content: "Server wording",
    }],
    generated: true,
    templateId: null,
    conversationContext: "",
    uploadContext: "",
    unresolvedPlaceholders: [],
  },
  truth: {
    authenticated: true,
    persistence: "persisted",
    documentId: "server-doc-id",
    currentRevision: 4,
    approvedRevision: null,
    ledgerBindingStatus: "legacy_unversioned",
    ledgerVersion: null,
    operationId: null,
    operationRevision: null,
    operationStatus: null,
    operationMessage: null,
    safeNextAction: null,
    persistedAt: "2026-08-31T00:00:00.000Z",
  },
};

const capturedInitialState: WorkspaceInitialState = {
  workspace: {
    ...serverInitialState.workspace!,
    documentId: "33333333-3333-4333-8333-333333333333",
    templateId: "complaint-letter",
    sections: [{
      ...serverInitialState.workspace!.sections[0]!,
      id: "44444444-4444-4444-8444-444444444444",
      document_id: "33333333-3333-4333-8333-333333333333",
      key: "issue",
      section_key: "issue",
      revision: 2,
      section_state: "final",
    } as Section],
  },
  truth: {
    ...serverInitialState.truth,
    documentId: "33333333-3333-4333-8333-333333333333",
    currentRevision: 4,
    ledgerBindingStatus: "captured",
    ledgerVersion: "ledger.2026-08-first-cohort.1",
    operationId: "55555555-5555-4555-8555-555555555555",
    operationRevision: 7,
    operationStatus: "ready_for_review",
  },
};

function mockUser(id: string): User {
  return { id } as User;
}

function authValue(user: User | null, loading = false) {
  return {
    user,
    session: null,
    loading,
    guestMigrationStatus: "idle" as const,
    guestMigrationResult: null,
    retryGuestMigration: vi.fn(),
  };
}

describe("useDocument — DB persistence wiring", () => {
  beforeEach(() => {
    capturedAutosaveCallback = null;
    mockFetchDocumentByOutcomeId.mockReset();
    mockFetchDocumentByOutcomeId.mockResolvedValue(null);
    mockFetchSections.mockReset();
    mockFetchSections.mockResolvedValue([]);
    mockFetchOutcome.mockReset();
    mockFetchOutcome.mockResolvedValue(null);
    mockLoadWorkspace.mockReset();
    mockLoadWorkspace.mockReturnValue(null);
    mockLoadPendingOutcome.mockReset();
    mockLoadPendingOutcome.mockReturnValue(null);
    mockSavePendingOutcome.mockReset();
    mockUpsertDocument.mockReset();
    mockUpsertDocument.mockResolvedValue(undefined);
    mockUpsertSections.mockReset();
    mockUpsertSections.mockResolvedValue(undefined);
    mockSaveWorkspace.mockReset();
    mockEditCapturedSection.mockReset();
    mockEditCapturedSection.mockResolvedValue({
      operation_id: "55555555-5555-4555-8555-555555555555",
      operation_revision: 8,
      document_id: "33333333-3333-4333-8333-333333333333",
      document_revision: 5,
      section_id: "44444444-4444-4444-8444-444444444444",
      section_key: "issue",
      section_revision: 3,
      persisted: true,
    });
    mockApproveCapturedRevision.mockReset();
    mockApproveCapturedRevision.mockResolvedValue({
      approval_id: "66666666-6666-4666-8666-666666666666",
      operation_id: "55555555-5555-4555-8555-555555555555",
      operation_revision: 9,
      document_id: "33333333-3333-4333-8333-333333333333",
      document_revision: 4,
      approved: true,
      idempotent_replay: false,
    });
    mockRequestCapturedExport.mockReset();
    vi.mocked(generateDocumentStream).mockReset();
    vi.mocked(generateDocumentStream).mockResolvedValue(undefined);
    vi.mocked(useAuth).mockReset();
    vi.mocked(useAuth).mockReturnValue(authValue(null));
  });

  it("loads document from DB when authenticated user has an existing document", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    mockFetchDocumentByOutcomeId.mockResolvedValue(dbDocument);
    mockFetchSections.mockResolvedValue(dbSections);

    const { result } = renderHook(() => useDocument("outcome-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.state?.documentId).toBe("db-doc-id");
    expect(result.current.state?.title).toBe("DB Title");
    expect(result.current.state?.sections).toHaveLength(1);
    expect(mockFetchDocumentByOutcomeId).toHaveBeenCalledWith("outcome-1", "user-1");
    expect(mockFetchSections).toHaveBeenCalledWith("db-doc-id");
  });

  it("keeps a persisted server snapshot without issuing a mount refetch that can overwrite edits", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    mockFetchDocumentByOutcomeId.mockResolvedValue(dbDocument);
    mockFetchSections.mockResolvedValue(dbSections);

    const { result } = renderHook(() => useDocument("outcome-1", serverInitialState));

    expect(result.current.loading).toBe(false);
    expect(result.current.state?.documentId).toBe("server-doc-id");
    expect(mockFetchOutcome).not.toHaveBeenCalled();
    expect(mockFetchDocumentByOutcomeId).not.toHaveBeenCalled();
    expect(mockFetchSections).not.toHaveBeenCalled();

    act(() => {
      result.current.setSections((sections) =>
        sections.map((item) => ({ ...item, content: "Immediate local edit" })),
      );
    });

    await act(async () => Promise.resolve());
    expect(result.current.state?.sections[0]?.content).toBe("Immediate local edit");
    expect(mockFetchDocumentByOutcomeId).not.toHaveBeenCalled();
  });

  it("persists captured edits only through the revision-checked RPC", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    const { result } = renderHook(() =>
      useDocument("outcome-1", capturedInitialState)
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setSections((sections) => sections.map((section) => ({
        ...section,
        content: "Revised captured wording",
        status: "edited" as const,
      })));
    });
    await act(async () => {
      capturedAutosaveCallback?.(result.current.state);
    });

    await waitFor(() => expect(result.current.syncStatus).toBe("saved"));
    expect(mockEditCapturedSection).toHaveBeenCalledWith({
      operationId: "55555555-5555-4555-8555-555555555555",
      expectedOperationRevision: 7,
      documentId: "33333333-3333-4333-8333-333333333333",
      expectedDocumentRevision: 4,
      sectionKey: "issue",
      expectedSectionRevision: 2,
      content: "Revised captured wording",
      sectionState: "final",
    });
    expect(mockUpsertDocument).not.toHaveBeenCalled();
    expect(mockUpsertSections).not.toHaveBeenCalled();
    expect(result.current.currentRevision).toBe(5);
  });

  it("flushes captured wording before revision-bound approval", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    const { result } = renderHook(() =>
      useDocument("outcome-1", capturedInitialState)
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      expect(await result.current.approveDocument()).toBe(true);
    });

    expect(mockApproveCapturedRevision).toHaveBeenCalledWith({
      operationId: "55555555-5555-4555-8555-555555555555",
      expectedOperationRevision: 7,
      documentId: "33333333-3333-4333-8333-333333333333",
      expectedDocumentRevision: 4,
    });
    expect(result.current.approvedRevision).toBe(4);
    expect(result.current.state?.status).toBe("approved");
  });

  it("normalises blank DB sections before the editor mounts", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    mockFetchDocumentByOutcomeId.mockResolvedValue({
      ...dbDocument,
      title: "Complaint Letter",
      template_id: "complaint_letter",
    });
    mockFetchSections.mockResolvedValue([{
      ...dbSections[0]!,
      key: "issue",
      name: "The Issue",
      content: '<p><br class="ProseMirror-trailingBreak"></p>',
    }]);

    const { result } = renderHook(() => useDocument("outcome-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.state?.sections[0]?.content).toBe(
      "{{TED_PLACEHOLDER:complaint_letter.issue.section_content:The Issue needs your input}}",
    );
    expect(result.current.unresolvedPlaceholders).toEqual([
      expect.objectContaining({
        id: "complaint_letter.issue.section_content",
        sectionKey: "issue",
        requiredForExport: true,
      }),
    ]);
    expect(mockSaveWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        sections: [
          expect.objectContaining({
            content:
              "{{TED_PLACEHOLDER:complaint_letter.issue.section_content:The Issue needs your input}}",
          }),
        ],
      }),
    );
  });

  it("shows placeholders for stored DB blanks while regeneration is still pending", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    mockFetchOutcome.mockResolvedValue({
      id: "outcome-1",
      user_id: "user-1",
      situation_text: "I need a complaint letter about a billing issue.",
      recommendation_payload: {
        primary: {
          template_id: "complaint_letter",
          reason: "Complaint Letter",
        },
        situation: "I need a complaint letter about a billing issue.",
      },
    });
    mockFetchDocumentByOutcomeId.mockResolvedValue({
      ...dbDocument,
      title: "Complaint Letter",
      template_id: "complaint_letter",
    });
    mockFetchSections.mockResolvedValue([{
      ...dbSections[0]!,
      key: "issue",
      name: "The Issue",
      content: '<p><br class="ProseMirror-trailingBreak"></p>',
    }]);
    vi.mocked(generateDocumentStream).mockReturnValue(new Promise(() => undefined));

    const { result, unmount } = renderHook(() => useDocument("outcome-1"));

    await waitFor(() => {
      expect(result.current.state?.sections[0]?.content).toBe(
        "{{TED_PLACEHOLDER:complaint_letter.issue.section_content:The Issue needs your input}}",
      );
    });

    expect(result.current.loading).toBe(true);
    expect(generateDocumentStream).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("keeps placeholders for stored DB blanks when regeneration finishes without content", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    mockFetchOutcome.mockResolvedValue({
      id: "outcome-1",
      user_id: "user-1",
      situation_text: "I need a complaint letter about a billing issue.",
      recommendation_payload: {
        primary: {
          template_id: "complaint_letter",
          reason: "Complaint Letter",
        },
        situation: "I need a complaint letter about a billing issue.",
      },
    });
    mockFetchDocumentByOutcomeId.mockResolvedValue({
      ...dbDocument,
      title: "Complaint Letter",
      template_id: "complaint_letter",
    });
    mockFetchSections.mockResolvedValue([{
      ...dbSections[0]!,
      key: "issue",
      name: "The Issue",
      content: '<p><br class="ProseMirror-trailingBreak"></p>',
    }]);

    const { result } = renderHook(() => useDocument("outcome-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.state?.sections[0]?.content).toBe(
      "{{TED_PLACEHOLDER:complaint_letter.issue.section_content:The Issue needs your input}}",
    );
    expect(result.current.unresolvedPlaceholders).toEqual([
      expect.objectContaining({
        id: "complaint_letter.issue.section_content",
        sectionKey: "issue",
        requiredForExport: true,
      }),
    ]);
  });

  it("keeps placeholders for cached blanks when regeneration finishes without content", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    mockLoadWorkspace.mockReturnValue({
      ...cachedWorkspace,
      templateId: "complaint_letter",
      conversationContext: "",
      uploadContext: "",
      situation: "I need a complaint letter about a billing issue.",
      sections: [{
        ...dbSections[0]!,
        key: "issue",
        name: "The Issue",
        content: '<p><br class="ProseMirror-trailingBreak"></p>',
      }],
    });

    const { result } = renderHook(() => useDocument("outcome-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.state?.sections[0]?.content).toBe(
      "{{TED_PLACEHOLDER:complaint_letter.issue.section_content:The Issue needs your input}}",
    );
    expect(result.current.unresolvedPlaceholders).toEqual([
      expect.objectContaining({
        id: "complaint_letter.issue.section_content",
        sectionKey: "issue",
        requiredForExport: true,
      }),
    ]);
  });

  it("waits for authentication before loading or generating a document", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(null, true));
    mockLoadPendingOutcome.mockReturnValue({
      situation: "Need to write a resume",
      templateName: "Resume",
    });

    const { result, rerender } = renderHook(() => useDocument("outcome-1"));

    expect(result.current.loading).toBe(true);
    expect(mockFetchOutcome).not.toHaveBeenCalled();
    expect(mockLoadPendingOutcome).not.toHaveBeenCalled();

    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    rerender();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockFetchOutcome).toHaveBeenCalledTimes(1);
    expect(mockLoadPendingOutcome).toHaveBeenCalledTimes(1);
  });

  it("reports an expired session instead of blaming every document section", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    mockLoadPendingOutcome.mockReturnValue({
      situation: "Create a resume",
      templateName: "Resume",
      templateId: "resume",
    });
    mockLoadWorkspace.mockReturnValue({
      ...cachedWorkspace,
      sections: [{
        ...dbSections[0]!,
        id: "summary",
        name: "Professional Summary",
        content: "",
      }],
    });
    vi.mocked(generateDocumentStream).mockRejectedValueOnce(
      new ApiError(401, "INVALID_TOKEN", {
        error: { code: "INVALID_TOKEN", message: "Your session has expired." },
      }),
    );

    const { result } = renderHook(() => useDocument("outcome-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.generationIssues).toEqual([
      expect.objectContaining({
        sectionId: "__auth__",
        sectionName: "Sign in again",
      }),
    ]);
  });

  it("falls back to sessionStorage when user is anonymous", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(null));
    mockLoadWorkspace.mockReturnValue(cachedWorkspace);

    const { result } = renderHook(() => useDocument("outcome-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.state?.documentId).toBe("cached-doc-id");
    expect(result.current.state?.title).toBe("Cached Title");
    expect(mockFetchDocumentByOutcomeId).not.toHaveBeenCalled();
  });

  it("does not reopen a skipped-generation workspace with blank required sections", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(null));
    mockLoadWorkspace.mockReturnValue({
      ...cachedWorkspace,
      templateId: "complaint_letter",
      conversationContext: "",
      uploadContext: "",
      situation: "",
      sections: [{
        ...dbSections[0]!,
        key: "issue",
        name: "The Issue",
        content: '<p><br class="ProseMirror-trailingBreak"></p>',
      }],
    });

    const { result } = renderHook(() => useDocument("outcome-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(generateDocumentStream).not.toHaveBeenCalled();
    expect(result.current.state?.sections[0]?.content).toBe(
      "{{TED_PLACEHOLDER:complaint_letter.issue.section_content:The Issue needs your input}}",
    );
    expect(result.current.unresolvedPlaceholders).toEqual([
      expect.objectContaining({
        id: "complaint_letter.issue.section_content",
        sectionKey: "issue",
        requiredForExport: true,
      }),
    ]);
    expect(mockSaveWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        sections: [
          expect.objectContaining({
            content:
              "{{TED_PLACEHOLDER:complaint_letter.issue.section_content:The Issue needs your input}}",
          }),
        ],
      }),
    );
  });

  it("seeds a fresh document when no DB record and no sessionStorage", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(null));
    mockLoadPendingOutcome.mockReturnValue({
      situation: "Need to write a resume",
      templateName: "Resume",
    });

    const { result } = renderHook(() => useDocument("outcome-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.state?.documentId).toBe("seed-doc-id");
    expect(mockSaveWorkspace).toHaveBeenCalled();
  });

  it("autosave callback calls upsertDocument and upsertSections for authenticated users", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    mockFetchDocumentByOutcomeId.mockResolvedValue(dbDocument);
    mockFetchSections.mockResolvedValue(dbSections);

    const { result } = renderHook(() => useDocument("outcome-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(capturedAutosaveCallback).not.toBeNull();

    mockUpsertDocument.mockClear();
    mockUpsertSections.mockClear();

    act(() => {
      capturedAutosaveCallback!(result.current.state);
    });

    await waitFor(() => expect(mockUpsertDocument).toHaveBeenCalledTimes(1));
    expect(mockUpsertDocument).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", outcome_id: "outcome-1" }),
    );
    await waitFor(() => expect(mockUpsertSections).toHaveBeenCalledTimes(1));
  });

  it("reports failed sync when a captured-row direct write is rejected", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    mockFetchDocumentByOutcomeId.mockResolvedValue(dbDocument);
    mockFetchSections.mockResolvedValue(dbSections);

    const { result } = renderHook(() => useDocument("outcome-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockUpsertDocument.mockRejectedValueOnce(new Error("CAPTURED_DOCUMENT_RPC_REQUIRED"));
    act(() => {
      capturedAutosaveCallback!(result.current.state);
    });

    await waitFor(() => expect(result.current.syncStatus).toBe("failed"));
    expect(mockUpsertSections).not.toHaveBeenCalled();
  });

  it("autosave callback does not call DB functions for anonymous users", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(null));
    mockLoadWorkspace.mockReturnValue(cachedWorkspace);

    const { result } = renderHook(() => useDocument("outcome-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(capturedAutosaveCallback).not.toBeNull();

    act(() => {
      capturedAutosaveCallback!(result.current.state);
    });

    expect(mockUpsertDocument).not.toHaveBeenCalled();
    expect(mockUpsertSections).not.toHaveBeenCalled();
  });

  it("autosave callback writes to sessionStorage for all users", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(null));
    mockLoadWorkspace.mockReturnValue(cachedWorkspace);

    const { result } = renderHook(() => useDocument("outcome-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    mockSaveWorkspace.mockClear();

    act(() => {
      capturedAutosaveCallback!(result.current.state);
    });

    expect(mockSaveWorkspace).toHaveBeenCalledTimes(1);
  });
});
