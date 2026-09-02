/**
 * Layer 14 — DB persistence wiring tests.
 *
 * Verifies that useDocument loads from the DB for authenticated users,
 * falls back to sessionStorage for anonymous users, and that autosave
 * flushes to DB after changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { User } from "@supabase/supabase-js";
import { ApiError, generateDocumentStream } from "@prompted/shared/api-client";
import type { Section } from "@prompted/shared/browser";
import { captureOwnerDispatch, recordBrowserPrincipal } from "@/lib/browser-principal-state";

const mockUpsertDocument = vi.fn().mockResolvedValue(undefined);
const mockUpsertSections = vi.fn().mockResolvedValue(undefined);
const mockFetchDocumentByOutcomeId = vi.fn().mockResolvedValue(null);
const mockFetchSections = vi.fn().mockResolvedValue([]);
const mockSaveLegacySection = vi.fn();
const mockSaveLegacyWorkspaceV1 = vi.fn();
const mockFetchOutcome = vi.fn().mockResolvedValue(null);
const mockSaveWorkspace = vi.fn();
const mockLoadWorkspace = vi.fn().mockReturnValue(null);
const mockLoadPendingOutcome = vi.fn().mockReturnValue(null);
const mockSavePendingOutcome = vi.fn();
const generationIdentities = new Map<string, { fingerprint: string; requestId: string }>();
const capturedExportIntentSequences = new Map<string, number>();
const mockResolveGenerationRequestIdentity = vi.fn(
  async (
    scope: { kind: "user"; userId: string } | { kind: "guest"; guestId: string },
    outcomeId: string,
    operationKey: string,
    input: unknown,
  ) => {
    const owner = scope.kind === "user" ? `user:${scope.userId}` : `guest:${scope.guestId}`;
    const key = `${owner}:${outcomeId}:${operationKey}`;
    const fingerprint = JSON.stringify(input);
    const existing = generationIdentities.get(key);
    if (existing?.fingerprint === fingerprint) return existing.requestId;
    const requestId = crypto.randomUUID();
    generationIdentities.set(key, { fingerprint, requestId });
    return requestId;
  },
);
const mockEditCapturedSection = vi.fn();
const mockApproveCapturedRevision = vi.fn();
const mockRequestCapturedExport = vi.fn();

vi.mock("@/lib/api/documents", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/documents")>("@/lib/api/documents");
  return {
    ...actual,
    fetchDocumentByOutcomeId: (...args: unknown[]) => mockFetchDocumentByOutcomeId(...args),
    saveLegacyWorkspaceV1: (...args: unknown[]) => mockSaveLegacyWorkspaceV1(...args),
    upsertDocument: (...args: unknown[]) => mockUpsertDocument(...args),
    fetchDocument: vi.fn().mockResolvedValue(null),
    updateDocumentStatus: vi.fn().mockResolvedValue(undefined),
    updateDocumentTitle: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/lib/api/outcomes", () => ({
  fetchOutcome: (...args: unknown[]) => mockFetchOutcome(...args),
}));

vi.mock("@/lib/api/sections", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/sections")>("@/lib/api/sections");
  return {
    ...actual,
    fetchSections: (...args: unknown[]) => mockFetchSections(...args),
    saveLegacySection: (...args: unknown[]) => mockSaveLegacySection(...args),
    upsertSections: (...args: unknown[]) => mockUpsertSections(...args),
    updateSectionContent: vi.fn().mockResolvedValue(undefined),
    updateSectionStatus: vi.fn().mockResolvedValue(undefined),
    persistSectionOrder: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/lib/api/captured-document-operations", () => ({
  editCapturedDocumentSection: (...args: unknown[]) => mockEditCapturedSection(...args),
  approveCapturedDocumentRevision: (...args: unknown[]) => mockApproveCapturedRevision(...args),
  requestCapturedDocumentExport: (...args: unknown[]) => mockRequestCapturedExport(...args),
}));

vi.mock("@/lib/workspace-store", () => ({
  currentWorkspaceCacheScope: (userId?: string | null) =>
    userId ? { kind: "user", userId } : { kind: "guest", guestId: "test-guest" },
  loadWorkspace: (...args: unknown[]) => mockLoadWorkspace(...args),
  saveWorkspace: (...args: unknown[]) => mockSaveWorkspace(...args),
  loadPendingOutcome: (...args: unknown[]) => mockLoadPendingOutcome(...args),
  savePendingOutcome: (...args: unknown[]) => mockSavePendingOutcome(...args),
  resolveCapturedExportIntentSequence: (
    scope: { kind: "user"; userId: string } | { kind: "guest"; guestId: string },
    outcomeId: string,
    intentKey: string,
  ) => {
    const owner = scope.kind === "user" ? `user:${scope.userId}` : `guest:${scope.guestId}`;
    return capturedExportIntentSequences.get(`${owner}:${outcomeId}:${intentKey}`) ?? 0;
  },
  advanceCapturedExportIntentSequenceForNewExport: (
    scope: { kind: "user"; userId: string } | { kind: "guest"; guestId: string },
    outcomeId: string,
    intentKey: string,
    expectedSequence: number,
  ) => {
    const owner = scope.kind === "user" ? `user:${scope.userId}` : `guest:${scope.guestId}`;
    const key = `${owner}:${outcomeId}:${intentKey}`;
    const current = capturedExportIntentSequences.get(key) ?? 0;
    if (current !== expectedSequence) return false;
    capturedExportIntentSequences.set(key, current + 1);
    return true;
  },
  resolveGenerationRequestIdentity: (
    ...args: [
      { kind: "user"; userId: string } | { kind: "guest"; guestId: string },
      string,
      string,
      unknown,
    ]
  ) => mockResolveGenerationRequestIdentity(...args),
}));

vi.mock("@/components/providers", () => ({
  useAuth: vi.fn(),
}));

let capturedAutosaveCallback: ((value: unknown) => void) | null = null;
vi.mock("./useAutosave", () => ({
  useAutosave: vi
    .fn()
    .mockImplementation(
      (
        _value: unknown,
        callback: (value: unknown, lease: ReturnType<typeof captureOwnerDispatch> | null) => void,
        _delay: number,
        ownerEpoch: string,
      ) => {
        capturedAutosaveCallback = (value: unknown) => {
          const lease = ownerEpoch.startsWith("user:")
            ? captureOwnerDispatch(ownerEpoch.slice("user:".length))
            : null;
          callback(value, lease);
        };
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
import {
  LegacyWorkspaceSaveError,
  type LegacyWorkspaceSaveReceiptV1,
  type SaveLegacyWorkspaceV1Input,
} from "@/lib/api/documents";
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
  unresolved_placeholders: [],
  current_revision: 1,
  approved_revision: null,
  ledger_binding_status: "legacy_unversioned" as const,
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
    revision: 1,
    approved_revision: null,
    ledger_binding_status: "legacy_unversioned",
  },
] as unknown as Section[];

const cachedWorkspace = {
  documentId: "cached-doc-id",
  outcomeId: "outcome-1",
  title: "Cached Title",
  situation: "I need help",
  status: "draft",
  sections: [] as Section[],
};

const serverInitialState: WorkspaceInitialState = {
  intake: {
    outcomeId: "outcome-1",
    situation: "Persisted situation",
    templateName: "Server Title",
    templateId: null,
    conversationContext: "",
    uploadContext: "",
  },
  workspace: {
    documentId: "server-doc-id",
    title: "Server Title",
    situation: "Persisted situation",
    status: "draft",
    sections: [
      {
        ...dbSections[0]!,
        id: "server-section",
        document_id: "server-doc-id",
        content: "Server wording",
      },
    ],
    generated: true,
    templateId: null,
    conversationContext: "",
    uploadContext: "",
    unresolvedPlaceholders: [],
  },
  truth: {
    authenticated: true,
    ownerUserId: "user-1",
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

const progressiveInitialState: WorkspaceInitialState = {
  intake: serverInitialState.intake,
  workspace: {
    ...serverInitialState.workspace!,
    sections: [
      {
        ...serverInitialState.workspace!.sections[0]!,
        content_loaded: true,
        content_sha256: "a".repeat(64),
        content_length: new TextEncoder().encode("Server wording").length,
        revision: 3,
        section_key: null,
        section_state: null,
      } as Section,
      {
        ...serverInitialState.workspace!.sections[0]!,
        id: "server-section-2",
        name: "Second section",
        order_index: 1,
        content: "",
        content_loaded: false,
        content_sha256: "b".repeat(64),
        content_length: 29,
        revision: 4,
        section_key: null,
        section_state: null,
      } as Section,
    ],
  },
  truth: {
    ...serverInitialState.truth,
    snapshotVersion: "workspace-snapshot.v1",
    activeSectionId: "server-section",
    exportEligible: false,
    exportBlockingReasons: ["required_sections_not_approved"],
  },
};

const capturedInitialState: WorkspaceInitialState = {
  intake: {
    ...serverInitialState.intake!,
    templateId: "complaint-letter",
    templateName: "Complaint Letter",
  },
  workspace: {
    ...serverInitialState.workspace!,
    documentId: "33333333-3333-4333-8333-333333333333",
    templateId: "complaint-letter",
    sections: [
      {
        ...serverInitialState.workspace!.sections[0]!,
        id: "44444444-4444-4444-8444-444444444444",
        document_id: "33333333-3333-4333-8333-333333333333",
        key: "issue",
        section_key: "issue",
        revision: 2,
        section_state: "final",
      } as Section,
    ],
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
  recordBrowserPrincipal(user?.id ?? null);
  return {
    user,
    session: null,
    loading,
    guestMigrationStatus: "idle" as const,
    guestMigrationResult: null,
    retryGuestMigration: vi.fn(),
    confirmGuestMigration: vi.fn(),
    discardGuestMigration: vi.fn(),
  };
}

async function digestText(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function aggregateReceipt(
  input: SaveLegacyWorkspaceV1Input,
  idempotentReplay = false,
): Promise<LegacyWorkspaceSaveReceiptV1> {
  const committedAt = "2026-09-01T00:03:00.000Z";
  let changedExistingSections = 0;
  let newSections = 0;
  const sections = await Promise.all(
    input.sections.map(async (patch) => {
      const expected = patch.expected;
      const structuralChange =
        expected === null ||
        patch.content !== undefined ||
        patch.desired.name !== expected.name ||
        patch.desired.order_index !== expected.order_index ||
        patch.desired.status !== expected.status ||
        patch.desired.is_required !== expected.is_required;
      if (expected === null) newSections += 1;
      else if (structuralChange) changedExistingSections += 1;
      const revision = expected === null ? 1 : expected.revision + Number(structuralChange);
      const invalidatesApproval =
        expected === null ||
        patch.content !== undefined ||
        patch.desired.name !== expected.name ||
        patch.desired.order_index !== expected.order_index ||
        patch.desired.is_required !== expected.is_required;
      const status =
        invalidatesApproval && patch.desired.status === "approved"
          ? "edited"
          : patch.desired.status;
      return {
        sectionId: patch.id,
        status,
        revision,
        approvedRevision: status === "approved" ? revision : null,
        contentSha256:
          patch.content === undefined
            ? (expected?.content_sha256 ?? "")
            : await digestText(patch.content),
        updatedAt: committedAt,
      };
    }),
  );
  const creation = input.expectedDocumentRevision === 0;
  const expectedDocument = input.expectedDocument;
  const documentMetadataChanged =
    !creation &&
    expectedDocument !== null &&
    (input.document.title !== expectedDocument.title ||
      input.document.template_id !== expectedDocument.template_id ||
      JSON.stringify(input.document.unresolved_placeholders) !==
        JSON.stringify(expectedDocument.unresolved_placeholders));
  const structuralChange =
    creation || changedExistingSections > 0 || newSections > 0 || documentMetadataChanged;
  const documentRevision = creation
    ? 1
    : input.expectedDocumentRevision +
      changedExistingSections +
      Number(documentMetadataChanged || newSections > 0);
  const documentStatus =
    structuralChange &&
    (input.document.status === "approved" || input.document.status === "exported")
      ? "edited"
      : input.document.status;
  const state = creation
    ? "created"
    : structuralChange || input.document.status !== expectedDocument?.status
      ? "saved"
      : "unchanged";
  return {
    contractVersion: "legacy-workspace-save.v1",
    state,
    outcomeId: input.outcomeId,
    documentId: input.documentId,
    idempotencyKey: input.idempotencyKey,
    acceptedDocumentRevision: input.expectedDocumentRevision,
    documentRevision,
    documentStatus,
    documentApprovedRevision:
      documentStatus === "approved" || documentStatus === "exported" ? documentRevision : null,
    documentUpdatedAt: committedAt,
    sections,
    committedAt,
    idempotentReplay,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => recordBrowserPrincipal(undefined));

describe("useDocument — DB persistence wiring", () => {
  beforeEach(() => {
    generationIdentities.clear();
    capturedExportIntentSequences.clear();
    mockResolveGenerationRequestIdentity.mockClear();
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
    mockSaveLegacySection.mockReset();
    mockSaveLegacySection.mockRejectedValue(new Error("SPLIT_LEGACY_WRITE_PROHIBITED"));
    mockSaveLegacyWorkspaceV1.mockReset();
    mockSaveLegacyWorkspaceV1.mockImplementation(async (input: SaveLegacyWorkspaceV1Input) =>
      aggregateReceipt(input),
    );
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
    const loadLease = mockFetchDocumentByOutcomeId.mock.calls[0]?.[2];
    expect(mockFetchDocumentByOutcomeId).toHaveBeenCalledWith("outcome-1", "user-1", loadLease);
    expect(mockFetchSections).toHaveBeenCalledWith("db-doc-id", loadLease);
  });

  it("hydrates authoritative wording and revision before autosave without a stale write", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    mockFetchDocumentByOutcomeId.mockResolvedValue(dbDocument);
    mockFetchSections.mockResolvedValue([
      {
        ...serverInitialState.workspace!.sections[0]!,
        content: "Authoritative B",
        status: "edited",
        revision: 2,
        approved_revision: null,
        ledger_binding_status: "legacy_unversioned",
      },
    ]);

    const { result } = renderHook(() => useDocument("outcome-1", serverInitialState));

    expect(result.current.loading).toBe(true);
    expect(result.current.state?.documentId).toBe("server-doc-id");
    expect(mockFetchOutcome).not.toHaveBeenCalled();
    expect(mockFetchDocumentByOutcomeId).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mockFetchSections).toHaveBeenCalledWith(
        "server-doc-id",
        expect.objectContaining({ expectedUserId: "user-1" }),
      ),
    );
    await waitFor(() =>
      expect(
        (
          result.current.state?.sections[0] as Section & {
            revision?: number;
            ledger_binding_status?: string;
          }
        )?.ledger_binding_status,
      ).toBe("legacy_unversioned"),
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.state?.sections[0]?.content).toBe("Authoritative B");
    expect((result.current.state?.sections[0] as Section & { revision?: number })?.revision).toBe(
      2,
    );

    await act(async () => {
      capturedAutosaveCallback?.(result.current.state);
    });
    expect(mockSaveLegacyWorkspaceV1).not.toHaveBeenCalled();
    expect(mockSaveLegacySection).not.toHaveBeenCalled();
    expect(mockUpsertSections).not.toHaveBeenCalled();
    expect(mockUpsertDocument).not.toHaveBeenCalled();

    act(() => {
      result.current.setSections((sections) =>
        sections.map((item) => ({ ...item, content: "Immediate local edit" })),
      );
    });

    await act(async () => Promise.resolve());
    expect(result.current.state?.sections[0]?.content).toBe("Immediate local edit");
    expect(mockFetchDocumentByOutcomeId).not.toHaveBeenCalled();
  });

  it("gates compatibility edits until authoritative baselines can be saved", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    const hydration = deferred<Section[]>();
    mockFetchSections.mockImplementationOnce(() => hydration.promise);

    const { result } = renderHook(() => useDocument("outcome-1", serverInitialState));
    await waitFor(() => expect(mockFetchSections).toHaveBeenCalledTimes(1));
    expect(result.current.loading).toBe(true);
    await act(async () => {
      hydration.resolve([
        {
          ...serverInitialState.workspace!.sections[0]!,
          content: "Authoritative wording",
          revision: 2,
          approved_revision: null,
          ledger_binding_status: "legacy_unversioned",
        } as Section,
      ]);
      await hydration.promise;
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.state?.sections[0]?.content).toBe("Authoritative wording");
    act(() => {
      result.current.setSections((sections) =>
        sections.map((section) => ({ ...section, content: "Edit after hydration" })),
      );
    });
    await waitFor(() =>
      expect(result.current.state?.sections[0]?.content).toBe("Edit after hydration"),
    );
    await act(async () => {
      capturedAutosaveCallback?.(result.current.state);
    });
    await waitFor(() => expect(result.current.currentRevision).toBe(5));

    expect(mockSaveLegacyWorkspaceV1).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedDocumentRevision: 4,
        sections: [
          expect.objectContaining({
            expected: expect.objectContaining({
              revision: 2,
              content_sha256: await digestText("Authoritative wording"),
            }),
            content: "Edit after hydration",
          }),
        ],
      }),
      expect.objectContaining({ expectedUserId: "user-1" }),
    );
  });

  it("treats reordered placeholder object keys as the same JSONB state", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    const placeholder = {
      id: "proposal.summary.contact",
      profileKey: "proposal",
      sectionKey: "summary",
      informationKey: "contact",
      label: "Contact",
      question: "Who is the contact?",
      factType: "person",
      requiredForExport: true,
      neutralReplacementOptions: [],
    };
    const stateWithPlaceholder: WorkspaceInitialState = {
      ...progressiveInitialState,
      workspace: {
        ...progressiveInitialState.workspace!,
        unresolvedPlaceholders: [placeholder],
      },
    };
    const { result } = renderHook(() => useDocument("outcome-1", stateWithPlaceholder));

    act(() => {
      result.current.setUnresolvedPlaceholders([
        {
          neutralReplacementOptions: [],
          requiredForExport: true,
          factType: "person",
          question: "Who is the contact?",
          label: "Contact",
          informationKey: "contact",
          sectionKey: "summary",
          profileKey: "proposal",
          id: "proposal.summary.contact",
        },
      ]);
    });
    await act(async () => {
      capturedAutosaveCallback?.(result.current.state);
    });

    expect(mockSaveLegacyWorkspaceV1).not.toHaveBeenCalled();
  });

  it("saves one complete progressive roster without loading or sending omitted bodies", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));

    const { result } = renderHook(() => useDocument("outcome-1", progressiveInitialState));

    expect(result.current.loading).toBe(false);
    expect(mockFetchSections).not.toHaveBeenCalled();

    await act(async () => {
      capturedAutosaveCallback?.(result.current.state);
    });
    expect(mockSaveLegacyWorkspaceV1).not.toHaveBeenCalled();
    expect(mockSaveLegacySection).not.toHaveBeenCalled();
    expect(mockUpsertSections).not.toHaveBeenCalled();

    act(() => {
      result.current.setSections((sections) =>
        sections.map((section) =>
          section.id === "server-section"
            ? { ...section, content: "User-edited wording.", status: "edited" as const }
            : section,
        ),
      );
    });
    await act(async () => {
      capturedAutosaveCallback?.(result.current.state);
    });

    await waitFor(() => expect(mockSaveLegacyWorkspaceV1).toHaveBeenCalledTimes(1));
    const [request, lease] = mockSaveLegacyWorkspaceV1.mock.calls[0] as [
      SaveLegacyWorkspaceV1Input,
      { expectedUserId: string },
    ];
    expect(lease).toEqual(expect.objectContaining({ expectedUserId: "user-1" }));
    expect(request).toEqual(
      expect.objectContaining({
        outcomeId: "outcome-1",
        documentId: "server-doc-id",
        expectedDocumentRevision: 4,
        sections: [
          expect.objectContaining({
            id: "server-section",
            expected: expect.objectContaining({
              revision: 3,
              content_sha256: "a".repeat(64),
            }),
            desired: expect.objectContaining({ order_index: 0, status: "edited" }),
            content: "User-edited wording.",
          }),
          expect.objectContaining({
            id: "server-section-2",
            expected: expect.objectContaining({
              revision: 4,
              content_sha256: "b".repeat(64),
              order_index: 1,
            }),
            desired: expect.objectContaining({ order_index: 1 }),
          }),
        ],
      }),
    );
    expect(Object.prototype.hasOwnProperty.call(request.sections[1], "content")).toBe(false);
    expect(mockFetchSections).not.toHaveBeenCalled();
    expect(mockSaveLegacySection).not.toHaveBeenCalled();
    expect(mockUpsertSections).not.toHaveBeenCalled();
    expect(mockUpsertDocument).not.toHaveBeenCalled();
  });

  it("carries the exact SSR upload identity into a focused generation repair", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    const uploadId = "77777777-7777-4777-8777-777777777777";
    const uploadBackedInitialState: WorkspaceInitialState = {
      ...progressiveInitialState,
      intake: {
        ...progressiveInitialState.intake!,
        uploadContext: "A bounded upload excerpt.",
        uploadId,
      },
    };

    const { result } = renderHook(() => useDocument("outcome-1", uploadBackedInitialState));
    expect(result.current.loading).toBe(false);
    vi.mocked(generateDocumentStream).mockClear();

    await act(async () => {
      await result.current.retryGenerationSection("server-section");
    });

    expect(generateDocumentStream).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generateDocumentStream).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        upload_id: uploadId,
        upload_context: "A bounded upload excerpt.",
      }),
    );
  });

  it("merges the authoritative aggregate receipt after one atomic autosave", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    mockFetchSections.mockResolvedValue([
      {
        ...serverInitialState.workspace!.sections[0]!,
        revision: 3,
        approved_revision: 3,
        ledger_binding_status: "legacy_unversioned",
      },
    ]);
    const { result } = renderHook(() => useDocument("outcome-1", serverInitialState));
    await waitFor(() =>
      expect((result.current.state?.sections[0] as Section & { revision?: number })?.revision).toBe(
        3,
      ),
    );

    act(() => {
      result.current.setSections((sections) =>
        sections.map((section) => ({
          ...section,
          content: "Direct saved edit",
          status: "edited" as const,
        })),
      );
    });
    await act(async () => {
      capturedAutosaveCallback?.(result.current.state);
    });

    await waitFor(() =>
      expect((result.current.state?.sections[0] as Section & { revision?: number })?.revision).toBe(
        4,
      ),
    );
    expect(mockSaveLegacyWorkspaceV1).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedDocumentRevision: 4,
        sections: [
          expect.objectContaining({
            id: "server-section",
            expected: expect.objectContaining({
              revision: 3,
              content_sha256: await digestText("Server wording"),
            }),
            desired: expect.objectContaining({ status: "edited" }),
            content: "Direct saved edit",
          }),
        ],
      }),
      expect.objectContaining({ expectedUserId: "user-1" }),
    );
    expect(result.current.currentRevision).toBe(5);
    expect(mockSaveLegacySection).not.toHaveBeenCalled();
    expect(mockUpsertSections).not.toHaveBeenCalled();
    expect(mockUpsertDocument).not.toHaveBeenCalled();
  });

  it("merges an authoritative Apply without scheduling a second generic write", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    mockFetchSections.mockResolvedValue([
      {
        ...serverInitialState.workspace!.sections[0]!,
        revision: 3,
        approved_revision: 3,
        status: "approved",
        ledger_binding_status: "legacy_unversioned",
      },
    ]);
    const { result } = renderHook(() => useDocument("outcome-1", serverInitialState));
    await waitFor(() =>
      expect((result.current.state?.sections[0] as Section & { revision?: number })?.revision).toBe(
        3,
      ),
    );

    act(() => {
      result.current.mergePersistedLegacyApply({
        state: "applied",
        code: "APPLIED",
        operation_id: "44444444-4444-4444-8444-444444444444",
        section_id: "server-section",
        document_id: "server-doc-id",
        section_content: "<p>Applied authoritative wording.</p>",
        section_content_sha256: "b".repeat(64),
        section_status: "edited",
        section_revision: 4,
        section_approved_revision: null,
        section_updated_at: "2026-09-01T00:02:00.000Z",
        document_status: "edited",
        document_revision: 5,
        document_approved_revision: null,
        document_updated_at: "2026-09-01T00:02:00.000Z",
        applied_section_revision: 4,
        idempotent_replay: false,
      });
    });

    expect(result.current.state).toMatchObject({
      status: "edited",
      sections: [
        {
          content: "<p>Applied authoritative wording.</p>",
          status: "edited",
          revision: 4,
          approved_revision: null,
        },
      ],
    });
    expect(result.current.currentRevision).toBe(5);
    mockUpsertDocument.mockClear();
    mockUpsertSections.mockClear();
    mockSaveLegacySection.mockClear();
    mockSaveLegacyWorkspaceV1.mockClear();
    await act(async () => {
      capturedAutosaveCallback?.(result.current.state);
    });
    expect(mockSaveLegacySection).not.toHaveBeenCalled();
    expect(mockSaveLegacyWorkspaceV1).not.toHaveBeenCalled();
    expect(mockUpsertSections).not.toHaveBeenCalled();
    expect(mockUpsertDocument).not.toHaveBeenCalled();
  });

  it("materialises authoritative Apply wording for a previously unloaded section", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    const { result } = renderHook(() => useDocument("outcome-1", progressiveInitialState));
    const content = "<p>Durable wording for the second section.</p>";
    const digest = await digestText(content);

    act(() => {
      result.current.mergePersistedLegacyApply({
        state: "applied",
        code: "APPLIED",
        operation_id: "44444444-4444-4444-8444-444444444444",
        section_id: "server-section-2",
        document_id: "server-doc-id",
        section_content: content,
        section_content_sha256: digest,
        section_status: "edited",
        section_revision: 5,
        section_approved_revision: null,
        section_updated_at: "2026-09-01T00:02:00.000Z",
        document_status: "edited",
        document_revision: 5,
        document_approved_revision: null,
        document_updated_at: "2026-09-01T00:02:00.000Z",
        applied_section_revision: 5,
        idempotent_replay: false,
      });
    });

    const section = result.current.state?.sections[1] as
      | (Section & {
          content_loaded?: boolean;
          content_sha256?: string;
          content_length?: number;
        })
      | undefined;
    expect(section).toMatchObject({
      content,
      content_loaded: true,
      content_sha256: digest,
      content_length: new TextEncoder().encode(content).length,
      revision: 5,
    });
    await act(async () => {
      capturedAutosaveCallback?.(result.current.state);
    });
    expect(mockSaveLegacyWorkspaceV1).not.toHaveBeenCalled();
  });

  it("persists captured edits only through the revision-checked RPC", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    const { result } = renderHook(() => useDocument("outcome-1", capturedInitialState));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setSections((sections) =>
        sections.map((section) => ({
          ...section,
          content: "Revised captured wording",
          status: "edited" as const,
        })),
      );
    });
    await act(async () => {
      capturedAutosaveCallback?.(result.current.state);
    });

    await waitFor(() => expect(result.current.syncStatus).toBe("saved"));
    expect(mockEditCapturedSection).toHaveBeenCalledWith(
      {
        operationId: "55555555-5555-4555-8555-555555555555",
        expectedOperationRevision: 7,
        documentId: "33333333-3333-4333-8333-333333333333",
        expectedDocumentRevision: 4,
        sectionKey: "issue",
        expectedSectionRevision: 2,
        content: "Revised captured wording",
        sectionState: "final",
      },
      expect.objectContaining({ expectedUserId: "user-1" }),
    );
    expect(mockUpsertDocument).not.toHaveBeenCalled();
    expect(mockUpsertSections).not.toHaveBeenCalled();
    expect(result.current.currentRevision).toBe(5);
  });

  it("flushes captured wording before revision-bound approval", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    const { result } = renderHook(() => useDocument("outcome-1", capturedInitialState));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      expect(await result.current.approveDocument()).toBe(true);
    });

    expect(mockApproveCapturedRevision).toHaveBeenCalledWith(
      {
        operationId: "55555555-5555-4555-8555-555555555555",
        expectedOperationRevision: 7,
        documentId: "33333333-3333-4333-8333-333333333333",
        expectedDocumentRevision: 4,
      },
      expect.objectContaining({ expectedUserId: "user-1" }),
    );
    expect(result.current.approvedRevision).toBe(4);
    expect(result.current.state?.status).toBe("approved");
    expect(result.current.exportEligible).toBe(true);
  });

  it("reuses browser-delivered captured exports and rotates only on explicit update", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    mockRequestCapturedExport
      .mockResolvedValueOnce({
        export_id: "77777777-7777-4777-8777-777777777777",
        operation_id: "55555555-5555-4555-8555-555555555555",
        operation_revision: 10,
        document_id: "33333333-3333-4333-8333-333333333333",
        document_revision: 4,
        format: "pdf",
        status: "requested",
        idempotent_replay: false,
      })
      .mockResolvedValueOnce({
        export_id: "88888888-8888-4888-8888-888888888888",
        operation_id: "55555555-5555-4555-8555-555555555555",
        operation_revision: 11,
        document_id: "33333333-3333-4333-8333-333333333333",
        document_revision: 4,
        format: "pdf",
        status: "requested",
        idempotent_replay: false,
      });
    const { result } = renderHook(() => useDocument("outcome-1", capturedInitialState));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      expect(await result.current.approveDocument()).toBe(true);
    });
    const lease = captureOwnerDispatch("user-1");
    let first: Awaited<ReturnType<typeof result.current.requestCapturedExport>> = null;
    let replay: Awaited<ReturnType<typeof result.current.requestCapturedExport>> = null;
    await act(async () => {
      first = await result.current.requestCapturedExport("pdf", lease);
      replay = await result.current.requestCapturedExport("pdf", lease);
    });

    expect(replay).toEqual(first);
    expect(mockRequestCapturedExport).toHaveBeenCalledTimes(1);
    const firstIdempotencyKey = mockRequestCapturedExport.mock.calls[0]?.[0].idempotencyKey;
    expect(result.current.rememberCapturedExportDelivery("pdf", "wrong-export")).toBe(false);
    expect(result.current.rememberCapturedExportDelivery("pdf", first!.export_id)).toBe(true);

    let deliveredReplay: Awaited<ReturnType<typeof result.current.requestCapturedExport>> = null;
    await act(async () => {
      deliveredReplay = await result.current.requestCapturedExport("pdf", lease);
    });
    expect(deliveredReplay).toEqual(first);
    expect(mockRequestCapturedExport).toHaveBeenCalledTimes(1);
    expect(result.current.createUpdatedCapturedExport("pdf", "wrong-export")).toBe(false);
    expect(result.current.createUpdatedCapturedExport("pdf", first!.export_id)).toBe(true);

    let next: Awaited<ReturnType<typeof result.current.requestCapturedExport>> = null;
    await act(async () => {
      next = await result.current.requestCapturedExport("pdf", lease);
    });
    expect(next!.export_id).not.toBe(first!.export_id);
    expect(mockRequestCapturedExport).toHaveBeenCalledTimes(2);
    expect(mockRequestCapturedExport.mock.calls[1]?.[0].idempotencyKey).not.toBe(
      firstIdempotencyKey,
    );
    expect(mockResolveGenerationRequestIdentity).toHaveBeenNthCalledWith(
      1,
      { kind: "user", userId: "user-1" },
      "outcome-1",
      expect.stringContaining(":intent:0"),
      expect.objectContaining({
        contract: "captured-export-request.2",
        exportIntentSequence: 0,
      }),
    );
    expect(mockResolveGenerationRequestIdentity).toHaveBeenNthCalledWith(
      2,
      { kind: "user", userId: "user-1" },
      "outcome-1",
      expect.stringContaining(":intent:1"),
      expect.objectContaining({
        contract: "captured-export-request.2",
        exportIntentSequence: 1,
      }),
    );
  });

  it("normalises blank DB sections before the editor mounts", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    mockFetchDocumentByOutcomeId.mockResolvedValue({
      ...dbDocument,
      title: "Complaint Letter",
      template_id: "complaint_letter",
    });
    mockFetchSections.mockResolvedValue([
      {
        ...dbSections[0]!,
        key: "issue",
        name: "The Issue",
        content: '<p><br class="ProseMirror-trailingBreak"></p>',
      },
    ]);

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
      { kind: "user", userId: "user-1" },
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
    mockFetchSections.mockResolvedValue([
      {
        ...dbSections[0]!,
        key: "issue",
        name: "The Issue",
        content: '<p><br class="ProseMirror-trailingBreak"></p>',
      },
    ]);
    vi.mocked(generateDocumentStream).mockReturnValue(new Promise(() => undefined));

    const { result, unmount } = renderHook(() => useDocument("outcome-1"));

    await waitFor(() => {
      expect(result.current.state?.sections[0]?.content).toBe(
        "{{TED_PLACEHOLDER:complaint_letter.issue.section_content:The Issue needs your input}}",
      );
    });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(generateDocumentStream).toHaveBeenCalledTimes(1));
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
    mockFetchSections.mockResolvedValue([
      {
        ...dbSections[0]!,
        key: "issue",
        name: "The Issue",
        content: '<p><br class="ProseMirror-trailingBreak"></p>',
      },
    ]);

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

  it("never resurrects an authenticated document from a stale cached blank", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    mockLoadWorkspace.mockReturnValue({
      ...cachedWorkspace,
      templateId: "complaint_letter",
      conversationContext: "",
      uploadContext: "",
      situation: "I need a complaint letter about a billing issue.",
      sections: [
        {
          ...dbSections[0]!,
          key: "issue",
          name: "The Issue",
          content: '<p><br class="ProseMirror-trailingBreak"></p>',
        },
      ],
    });

    const { result } = renderHook(() => useDocument("outcome-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.state).toBeNull();
    expect(mockLoadWorkspace).not.toHaveBeenCalled();
    expect(mockUpsertDocument).not.toHaveBeenCalled();
  });

  it("reuses the exact generation request identity after a response-loss remount", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    const blankWorkspace = {
      ...cachedWorkspace,
      templateId: "complaint_letter",
      situation: "I need a complaint letter about a billing issue.",
      sections: [
        {
          ...dbSections[0]!,
          id: "issue",
          key: "issue",
          name: "The Issue",
          content: "",
        },
      ],
    };
    mockFetchOutcome.mockResolvedValue({
      situation_text: blankWorkspace.situation,
      recommendation_payload: {
        situation: blankWorkspace.situation,
        primary: { template_id: "complaint_letter", reason: "Complaint Letter" },
      },
    });
    mockFetchDocumentByOutcomeId.mockResolvedValue({
      ...dbDocument,
      id: blankWorkspace.documentId,
      outcome_id: "outcome-reload",
      title: blankWorkspace.title,
      template_id: "complaint_letter",
    });
    mockFetchSections.mockResolvedValue(blankWorkspace.sections);
    vi.mocked(generateDocumentStream).mockRejectedValueOnce(
      new ApiError(502, "STREAM_RESPONSE_LOST", {
        error: { code: "STREAM_RESPONSE_LOST" },
      }),
    );

    const firstMount = renderHook(() => useDocument("outcome-reload"));
    await waitFor(() => expect(generateDocumentStream).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(firstMount.result.current.loading).toBe(false));
    const firstRequest = vi.mocked(generateDocumentStream).mock.calls[0]?.[0];
    firstMount.unmount();

    vi.mocked(generateDocumentStream).mockResolvedValueOnce(undefined);
    const replayMount = renderHook(() => useDocument("outcome-reload"));
    await waitFor(() => expect(generateDocumentStream).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(replayMount.result.current.loading).toBe(false));
    const replayRequest = vi.mocked(generateDocumentStream).mock.calls[1]?.[0];

    expect(firstRequest?.generation_request_id).toBeTruthy();
    expect(replayRequest?.generation_request_id).toBe(firstRequest?.generation_request_id);
    expect(mockResolveGenerationRequestIdentity).toHaveBeenCalledWith(
      { kind: "user", userId: "user-1" },
      "outcome-reload",
      "initial-document:cached-doc-id",
      expect.objectContaining({
        template_id: "complaint-letter",
        situation: blankWorkspace.situation,
      }),
    );
  });

  it("reuses the exact scoped repair identity until its input changes", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    const repairWorkspace = {
      ...cachedWorkspace,
      situation: "Repair the missing issue wording.",
      templateId: "complaint_letter",
      sections: [
        {
          ...dbSections[0]!,
          id: "issue",
          key: "issue",
          name: "The Issue",
          content: "",
        },
      ],
    };
    mockFetchOutcome.mockResolvedValue({
      situation_text: repairWorkspace.situation,
      recommendation_payload: {
        situation: repairWorkspace.situation,
        primary: { template_id: "complaint_letter", reason: "Complaint Letter" },
      },
    });
    mockFetchDocumentByOutcomeId.mockResolvedValue({
      ...dbDocument,
      id: repairWorkspace.documentId,
      outcome_id: "outcome-repair",
      title: repairWorkspace.title,
      template_id: "complaint_letter",
    });
    mockFetchSections.mockResolvedValue(repairWorkspace.sections);

    const { result } = renderHook(() => useDocument("outcome-repair"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.mocked(generateDocumentStream).mockClear();
    vi.mocked(generateDocumentStream).mockRejectedValueOnce(
      new ApiError(502, "STREAM_RESPONSE_LOST", {
        error: { code: "STREAM_RESPONSE_LOST" },
      }),
    );

    await act(async () => {
      await result.current.retryGenerationSection("issue");
    });
    const firstRepair = vi.mocked(generateDocumentStream).mock.calls[0]?.[0];

    vi.mocked(generateDocumentStream).mockResolvedValueOnce(undefined);
    await act(async () => {
      await result.current.retryGenerationSection("issue");
    });
    const replayRepair = vi.mocked(generateDocumentStream).mock.calls[1]?.[0];

    expect(firstRepair?.generation_request_id).toBeTruthy();
    expect(replayRepair?.generation_request_id).toBe(firstRepair?.generation_request_id);
    expect(mockResolveGenerationRequestIdentity).toHaveBeenCalledWith(
      { kind: "user", userId: "user-1" },
      "outcome-repair",
      "section-repair:issue",
      expect.any(Object),
    );
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
    expect(mockLoadPendingOutcome).not.toHaveBeenCalled();
  });

  it("reports an expired session instead of blaming every document section", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    mockFetchOutcome.mockResolvedValue({
      id: "outcome-1",
      user_id: "user-1",
      situation_text: "Create a resume",
      recommendation_payload: {
        primary: { template_id: "resume", reason: "Resume" },
        alternatives: [],
      },
      status: "in_progress",
      is_saved: false,
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
      sections: [
        {
          ...dbSections[0]!,
          key: "issue",
          name: "The Issue",
          content: '<p><br class="ProseMirror-trailingBreak"></p>',
        },
      ],
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
      { kind: "guest", guestId: "test-guest" },
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

  it("autosave routes an existing legacy workspace only through aggregate revision/hash CAS", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    mockFetchDocumentByOutcomeId.mockResolvedValue(dbDocument);
    mockFetchSections.mockResolvedValue(dbSections);

    const { result } = renderHook(() => useDocument("outcome-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(capturedAutosaveCallback).not.toBeNull();

    mockUpsertDocument.mockClear();
    mockUpsertSections.mockClear();

    act(() => {
      result.current.setSections((sections) =>
        sections.map((section) => ({
          ...section,
          content: "Next cross-tab-safe wording",
          status: "edited" as const,
        })),
      );
    });
    await act(async () => {
      capturedAutosaveCallback!(result.current.state);
    });

    await waitFor(() => expect(mockSaveLegacyWorkspaceV1).toHaveBeenCalledTimes(1));
    expect(mockSaveLegacyWorkspaceV1).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedDocumentRevision: 1,
        expectedDocument: expect.objectContaining({ title: "DB Title", status: "draft" }),
        document: expect.objectContaining({ title: "DB Title", status: "draft" }),
        sections: [
          expect.objectContaining({
            id: "s1",
            expected: expect.objectContaining({
              revision: 1,
              content_sha256: await digestText("Hello"),
            }),
            desired: expect.objectContaining({ status: "edited" }),
            content: "Next cross-tab-safe wording",
          }),
        ],
      }),
      expect.objectContaining({ expectedUserId: "user-1" }),
    );
    expect(mockSaveLegacySection).not.toHaveBeenCalled();
    expect(mockUpsertDocument).not.toHaveBeenCalled();
    expect(mockUpsertSections).not.toHaveBeenCalled();
  });

  it("adds a new loaded section without rejecting the complete existing roster", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    mockFetchDocumentByOutcomeId.mockResolvedValue(dbDocument);
    mockFetchSections.mockResolvedValue(dbSections);

    const { result } = renderHook(() => useDocument("outcome-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setSections((sections) => [
        ...sections,
        {
          ...sections[0]!,
          id: "s2",
          name: "Next step",
          order_index: 1,
          content: "New complete wording",
          status: "draft" as const,
          revision: undefined,
          approved_revision: null,
        } as Section,
      ]);
    });
    act(() => {
      capturedAutosaveCallback!(result.current.state);
    });

    await waitFor(() => expect(mockSaveLegacyWorkspaceV1).toHaveBeenCalledTimes(1));
    expect(mockSaveLegacyWorkspaceV1.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        sections: [
          expect.objectContaining({ id: "s1", expected: expect.any(Object) }),
          expect.objectContaining({
            id: "s2",
            expected: null,
            desired: expect.objectContaining({ order_index: 1 }),
            content: "New complete wording",
          }),
        ],
      }),
    );
    expect(mockSaveLegacySection).not.toHaveBeenCalled();
    expect(mockUpsertDocument).not.toHaveBeenCalled();
    expect(mockUpsertSections).not.toHaveBeenCalled();
  });

  it("fails closed when the atomic legacy workspace CAS is deterministically rejected", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    mockFetchDocumentByOutcomeId.mockResolvedValue(dbDocument);
    mockFetchSections.mockResolvedValue(dbSections);

    const { result } = renderHook(() => useDocument("outcome-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockSaveLegacyWorkspaceV1.mockRejectedValueOnce(
      new LegacyWorkspaceSaveError("LEGACY_WORKSPACE_DOCUMENT_CONFLICT", false),
    );
    act(() => {
      result.current.setSections((sections) =>
        sections.map((section) => ({
          ...section,
          content: "Stale local wording",
          status: "edited" as const,
        })),
      );
    });
    act(() => {
      capturedAutosaveCallback!(result.current.state);
    });

    await waitFor(() => expect(result.current.syncStatus).toBe("failed"));
    expect(mockSaveLegacyWorkspaceV1).toHaveBeenCalledTimes(1);
    expect(mockSaveLegacySection).not.toHaveBeenCalled();
    expect(mockUpsertDocument).not.toHaveBeenCalled();
    expect(mockUpsertSections).not.toHaveBeenCalled();
  });

  it("replays an acknowledgement-uncertain aggregate exactly before saving a newer edit", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    mockFetchDocumentByOutcomeId.mockResolvedValue(dbDocument);
    mockFetchSections.mockResolvedValue(dbSections);

    const { result } = renderHook(() => useDocument("outcome-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockSaveLegacyWorkspaceV1.mockRejectedValueOnce(
      new LegacyWorkspaceSaveError("LEGACY_WORKSPACE_ACKNOWLEDGEMENT_UNKNOWN", true),
    );
    act(() => {
      result.current.setSections((sections) =>
        sections.map((section) => ({
          ...section,
          content: "First uncertain wording",
          status: "edited" as const,
        })),
      );
    });
    act(() => {
      capturedAutosaveCallback!(result.current.state);
    });
    await waitFor(() => expect(result.current.syncStatus).toBe("failed"));
    const uncertainRequest = mockSaveLegacyWorkspaceV1.mock.calls[0]?.[0] as
      SaveLegacyWorkspaceV1Input | undefined;
    expect(uncertainRequest).toBeDefined();

    mockSaveLegacyWorkspaceV1.mockImplementation(async (input: SaveLegacyWorkspaceV1Input) =>
      aggregateReceipt(input, true),
    );
    act(() => {
      result.current.setSections((sections) =>
        sections.map((section) => ({
          ...section,
          content: "Newer queued wording",
          status: "edited" as const,
        })),
      );
    });
    act(() => {
      capturedAutosaveCallback!(result.current.state);
    });

    await waitFor(() => expect(mockSaveLegacyWorkspaceV1).toHaveBeenCalledTimes(3));
    const replayRequest = mockSaveLegacyWorkspaceV1.mock.calls[1]?.[0] as
      SaveLegacyWorkspaceV1Input | undefined;
    const newerRequest = mockSaveLegacyWorkspaceV1.mock.calls[2]?.[0] as
      SaveLegacyWorkspaceV1Input | undefined;
    expect(replayRequest).toBe(uncertainRequest);
    expect(newerRequest).toEqual(
      expect.objectContaining({
        expectedDocumentRevision: 2,
        idempotencyKey: expect.not.stringMatching(uncertainRequest!.idempotencyKey),
        sections: [
          expect.objectContaining({
            expected: expect.objectContaining({ revision: 2 }),
            content: "Newer queued wording",
          }),
        ],
      }),
    );
    await waitFor(() => expect(result.current.syncStatus).toBe("saved"));
    expect(result.current.state?.sections[0]?.content).toBe("Newer queued wording");
    expect(mockSaveLegacySection).not.toHaveBeenCalled();
    expect(mockUpsertDocument).not.toHaveBeenCalled();
    expect(mockUpsertSections).not.toHaveBeenCalled();
  });

  it("does not regress a newer focused apply or dispatch a queued pre-apply snapshot", async () => {
    vi.mocked(useAuth).mockReturnValue(authValue(mockUser("user-1")));
    mockFetchDocumentByOutcomeId.mockResolvedValue(dbDocument);
    mockFetchSections.mockResolvedValue(dbSections);
    const firstAcknowledgement = deferred<LegacyWorkspaceSaveReceiptV1>();
    mockSaveLegacyWorkspaceV1.mockImplementationOnce(async () => firstAcknowledgement.promise);

    const { result } = renderHook(() => useDocument("outcome-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const aggregateAPlaceholder = {
      id: "proposal.summary.contact",
      profileKey: "proposal",
      sectionKey: "summary",
      informationKey: "contact",
      label: "Contact",
      question: "Who is the contact?",
      factType: "person",
      requiredForExport: true,
      neutralReplacementOptions: [],
    };
    act(() => {
      result.current.setUnresolvedPlaceholders([aggregateAPlaceholder]);
      result.current.setSections((sections) =>
        sections.map((section) => ({
          ...section,
          content: "Aggregate A wording",
          status: "edited" as const,
        })),
      );
    });
    act(() => {
      capturedAutosaveCallback!(result.current.state);
    });
    await waitFor(() => expect(mockSaveLegacyWorkspaceV1).toHaveBeenCalledTimes(1));
    const aggregateA = mockSaveLegacyWorkspaceV1.mock.calls[0]?.[0] as SaveLegacyWorkspaceV1Input;

    act(() => {
      result.current.setSections((sections) =>
        sections.map((section) => ({ ...section, content: "Queued pre-apply wording" })),
      );
    });
    act(() => {
      capturedAutosaveCallback!(result.current.state);
    });
    expect(mockSaveLegacyWorkspaceV1).toHaveBeenCalledTimes(1);

    const appliedContent = "Newer focused TED wording";
    const appliedDigest = await digestText(appliedContent);
    act(() => {
      result.current.mergePersistedLegacyApply({
        state: "applied",
        code: "APPLIED",
        operation_id: "e4000000-0000-4000-8000-000000000001",
        section_id: "s1",
        document_id: "db-doc-id",
        section_content: appliedContent,
        section_content_sha256: appliedDigest,
        section_status: "edited",
        section_revision: 3,
        section_approved_revision: null,
        section_updated_at: "2026-09-01T00:04:00.000Z",
        document_status: "edited",
        document_revision: 4,
        document_approved_revision: null,
        document_updated_at: "2026-09-01T00:04:00.000Z",
        applied_section_revision: 3,
        idempotent_replay: false,
      });
    });
    await act(async () => {
      firstAcknowledgement.resolve(await aggregateReceipt(aggregateA));
      await firstAcknowledgement.promise;
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.lastSyncedAt).toBe("2026-09-01T00:04:00.000Z"));

    await waitFor(() =>
      expect((result.current.state?.sections[0] as Section & { revision?: number })?.revision).toBe(
        3,
      ),
    );
    expect(result.current.state?.sections[0]?.content).toBe(appliedContent);
    expect(result.current.currentRevision).toBe(4);

    mockSaveLegacyWorkspaceV1.mockImplementation(async (input: SaveLegacyWorkspaceV1Input) =>
      aggregateReceipt(input),
    );
    act(() => {
      result.current.setSections((sections) =>
        sections.map((section) => ({ ...section, content: "Edit after focused apply" })),
      );
    });
    await waitFor(() =>
      expect(result.current.state?.sections[0]?.content).toBe("Edit after focused apply"),
    );
    act(() => {
      capturedAutosaveCallback!(result.current.state);
    });
    await waitFor(() => expect(result.current.syncStatus).toBe("saved"));
    expect(mockSaveLegacyWorkspaceV1).toHaveBeenCalledTimes(2);
    expect(mockSaveLegacyWorkspaceV1.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        expectedDocumentRevision: 4,
        expectedDocument: expect.objectContaining({
          unresolved_placeholders: [aggregateAPlaceholder],
        }),
        document: expect.objectContaining({
          unresolved_placeholders: [aggregateAPlaceholder],
        }),
        sections: [
          expect.objectContaining({
            expected: expect.objectContaining({
              revision: 3,
              content_sha256: appliedDigest,
            }),
            content: "Edit after focused apply",
          }),
        ],
      }),
    );
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
    expect(mockSaveLegacyWorkspaceV1).not.toHaveBeenCalled();
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
