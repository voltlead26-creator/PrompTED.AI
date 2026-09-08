/** Real wrapper, autosave, command builder, cache and owner leases; synthetic transport/DB endpoints. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { Editor, UseEditorOptions } from "@tiptap/react";
import type { DependencyList } from "react";
import type { WorkspaceInitialState } from "@/lib/workspace-initial-state";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";
import { useAuth } from "@/components/providers";
import { ApiError, generateDocumentStream } from "@prompted/shared/api-client";
import {
  LegacyWorkspaceSaveError,
  type LegacyWorkspaceSaveReceiptV1,
  type SaveLegacyWorkspaceV1Input,
} from "@/lib/api/documents";
import { currentWorkspaceCacheScope, loadWorkspace, saveWorkspace } from "@/lib/workspace-store";
import type { LegacySectionApplyResult, PersistedSection } from "@/lib/api/sections";
import { useDocument, type UseDocument } from "./useDocument";
import { useSection } from "./useSection";
import { SectionEditor } from "@/components/organisms/SectionEditor";

const observed = vi.hoisted(() => ({
  editor: null as Editor | null,
  document: null as UseDocument | null,
  edit: vi.fn(),
  recover: vi.fn(),
}));
vi.mock("@tiptap/react", async () => {
  const actual = await vi.importActual<typeof import("@tiptap/react")>("@tiptap/react");
  return {
    ...actual,
    useEditor: function useObservedEditor(options: UseEditorOptions, deps?: DependencyList) {
      const editor = actual.useEditor(options, deps);
      observed.editor = editor;
      return editor;
    },
  };
});
vi.mock("@/hooks/useEditWithTED", () => ({
  useEditWithTED: () => ({
    streaming: false,
    draft: "",
    changes: [],
    error: null,
    run: observed.edit,
    recover: observed.recover,
    applyPersisted: vi.fn(),
    discardPersisted: vi.fn(),
    cancel: vi.fn(),
  }),
}));
vi.mock("@/hooks/useExplainWithTED", () => ({
  useExplainWithTED: () => ({
    running: false,
    error: null,
    result: null,
    run: vi.fn(),
    cancel: vi.fn(),
  }),
}));

const endpoints = vi.hoisted(() => ({
  document: vi.fn(),
  sections: vi.fn(),
  outcome: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/components/providers", () => ({ useAuth: vi.fn() }));
vi.mock("@/lib/api/documents", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/documents")>("@/lib/api/documents")),
  fetchDocumentByOutcomeId: (...args: unknown[]) => endpoints.document(...args),
  saveLegacyWorkspaceV1: (...args: unknown[]) => endpoints.save(...args),
}));
vi.mock("@/lib/api/sections", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/sections")>("@/lib/api/sections")),
  fetchSections: (...args: unknown[]) => endpoints.sections(...args),
}));
vi.mock("@/lib/api/outcomes", () => ({
  fetchOutcome: (...args: unknown[]) => endpoints.outcome(...args),
}));
vi.mock("@prompted/shared/api-client", async () => ({
  ...(await vi.importActual<typeof import("@prompted/shared/api-client")>(
    "@prompted/shared/api-client",
  )),
  generateDocumentStream: vi.fn(),
}));
const owner = "11111111-1111-4111-8111-111111111111";
const outcomeA = "22222222-2222-4222-8222-222222222222";
const outcomeB = "99999999-9999-4999-8999-999999999999";
const docA = "33333333-3333-4333-8333-333333333333";
const docB = "88888888-8888-4888-8888-888888888888";
const targetId = "44444444-4444-4444-8444-444444444444";
const siblingId = "55555555-5555-4555-8555-555555555555";
const now = "2026-09-01T00:00:00.000Z";
function document(id = docA, outcomeId = outcomeA) {
  return {
    id,
    user_id: owner,
    outcome_id: outcomeId,
    title: "Cover Letter",
    template_id: null,
    status: "draft",
    current_revision: 1,
    approved_revision: null,
    unresolved_placeholders: [],
    ledger_binding_status: "legacy_unversioned",
    created_at: now,
    updated_at: now,
  };
}
function sections(documentId = docA, empty = true): PersistedSection[] {
  return [
    {
      id: documentId === docA ? targetId : "66666666-6666-4666-8666-666666666666",
      key: "opening",
      document_id: documentId,
      user_id: owner,
      name: "Opening & Role",
      order_index: 0,
      content: empty ? "" : "Previously confirmed wording.",
      status: "draft",
      version_history: [],
      is_required: true,
      created_at: now,
      updated_at: now,
      revision: 1,
      approved_revision: null,
      ledger_binding_status: "legacy_unversioned",
    },
    {
      id: documentId === docA ? siblingId : "77777777-7777-4777-8777-777777777777",
      key: "fit",
      document_id: documentId,
      user_id: owner,
      name: "Why You Fit",
      order_index: 1,
      content: "I managed warehouse operations.",
      status: "approved",
      version_history: [],
      is_required: true,
      created_at: now,
      updated_at: now,
      revision: 1,
      approved_revision: 1,
      ledger_binding_status: "legacy_unversioned",
    },
  ];
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
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

beforeEach(() => {
  observed.editor = null;
  observed.document = null;
  observed.edit.mockReset().mockResolvedValue(null);
  observed.recover.mockReset().mockResolvedValue(null);
  sessionStorage.clear();
  localStorage.clear();
  recordBrowserPrincipal(owner);
  vi.mocked(useAuth).mockReturnValue({ user: { id: owner }, loading: false } as ReturnType<
    typeof useAuth
  >);
  endpoints.document
    .mockReset()
    .mockImplementation((id: string) =>
      Promise.resolve(document(id === outcomeB ? docB : docA, id)),
    );
  endpoints.sections
    .mockReset()
    .mockImplementation((id: string) => Promise.resolve(sections(id, id === docA)));
  endpoints.outcome.mockReset().mockResolvedValue({
    situation_text: "Apply for Warehouse Operations Manager",
    recommendation_payload: {
      primary: { template_id: "cover-letter", reason: "Cover Letter" },
      conversation_context: "Confirmed warehouse experience.",
    },
  });
  endpoints.save
    .mockReset()
    .mockImplementation((input: SaveLegacyWorkspaceV1Input) => aggregateReceipt(input));
  vi.mocked(generateDocumentStream)
    .mockReset()
    .mockImplementation(async (_input, receive) => {
      await receive({
        type: "section",
        key: "opening",
        label: "Opening & Role",
        content: "I am applying for the advertised role.",
      });
    });
});

/** Durable endpoint fixture populated only by accepted aggregate commands. */
function installSeedStore() {
  let committed: {
    input: SaveLegacyWorkspaceV1Input;
    receipt: LegacyWorkspaceSaveReceiptV1;
  } | null = null;
  const receipts = new Map<string, { input: string; receipt: LegacyWorkspaceSaveReceiptV1 }>();
  const bodies = new Map<string, string>();
  let queue: Promise<void> = Promise.resolve();
  const commit = (input: SaveLegacyWorkspaceV1Input) => {
    // Model the existing RPC's outcome lock; this fixture is not database proof.
    const result = queue.then(async () => {
      const prior = receipts.get(input.idempotencyKey);
      if (prior) {
        expect(JSON.stringify(input)).toBe(prior.input);
        return { ...prior.receipt, idempotentReplay: true };
      }
      if (committed && input.expectedDocumentRevision === 0)
        throw new LegacyWorkspaceSaveError("LEGACY_WORKSPACE_CREATE_CONFLICT", false);
      const receipt = await aggregateReceipt(input);
      committed = { input, receipt };
      for (const patch of input.sections) {
        if (patch.content !== undefined) bodies.set(patch.id, patch.content);
      }
      receipts.set(input.idempotencyKey, { input: JSON.stringify(input), receipt });
      return receipt;
    });
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  endpoints.save.mockImplementation(commit);
  endpoints.document.mockImplementation(() =>
    committed
      ? {
          ...document(committed.input.documentId, committed.input.outcomeId),
          title: committed.input.document.title,
          template_id: committed.input.document.template_id,
          status: committed.receipt.documentStatus,
          current_revision: committed.receipt.documentRevision,
          approved_revision: committed.receipt.documentApprovedRevision,
          unresolved_placeholders: committed.input.document.unresolved_placeholders,
        }
      : null,
  );
  endpoints.sections.mockImplementation((id: string) => {
    expect(committed).not.toBeNull();
    expect(id).toBe(committed!.input.documentId);
    return committed!.input.sections.map((patch, index) => ({
      id: patch.id,
      document_id: id,
      user_id: owner,
      name: patch.desired.name,
      order_index: patch.desired.order_index,
      content: bodies.get(patch.id) ?? "",
      is_required: patch.desired.is_required,
      status: committed!.receipt.sections[index]!.status,
      revision: committed!.receipt.sections[index]!.revision,
      approved_revision: committed!.receipt.sections[index]!.approvedRevision,
      version_history: [],
      ledger_binding_status: "legacy_unversioned",
      created_at: now,
      updated_at: committed!.receipt.sections[index]!.updatedAt,
    }));
  });
  return { commit, receipts, current: () => committed };
}

describe("fresh document admission before generation", () => {
  beforeEach(() => {
    endpoints.document.mockResolvedValue(null);
    vi.mocked(generateDocumentStream).mockRejectedValue(
      new ApiError(502, "STREAM_RESPONSE_LOST", {}),
    );
  });

  it("preserves a deliberately cleared required section in an edited server snapshot", async () => {
    const rows = sections(docA, false).map<PersistedSection>((section, index) =>
      index === 0
        ? { ...section, content: "", status: "edited", revision: 2, approved_revision: null }
        : section,
    );
    endpoints.document.mockResolvedValue({
      ...document(docA, outcomeA),
      status: "edited",
      current_revision: 2,
    });
    endpoints.sections.mockResolvedValue(rows);
    const snapshot: WorkspaceInitialState = {
      intake: {
        outcomeId: outcomeA,
        situation: "Apply for Warehouse Operations Manager",
        templateName: "Cover Letter",
        templateId: "cover-letter",
        conversationContext: "Confirmed warehouse experience.",
        uploadContext: "",
      },
      workspace: {
        documentId: docA,
        title: "Cover Letter",
        situation: "Apply for Warehouse Operations Manager",
        status: "edited",
        sections: await Promise.all(
          rows.map(async (section) => ({
            ...section,
            content_loaded: true,
            content_sha256: await digestText(section.content),
            content_length: new TextEncoder().encode(section.content).length,
            section_key: null,
            section_state: null,
          })),
        ),
        generated: true,
        templateId: "cover-letter",
        conversationContext: "Confirmed warehouse experience.",
        uploadContext: "",
        unresolvedPlaceholders: [],
      },
      truth: {
        authenticated: true,
        ownerUserId: owner,
        persistence: "persisted",
        documentId: docA,
        currentRevision: 2,
        approvedRevision: null,
        ledgerBindingStatus: "legacy_unversioned",
        ledgerVersion: null,
        operationId: null,
        operationRevision: null,
        operationStatus: null,
        operationMessage: null,
        safeNextAction: null,
        persistedAt: now,
        snapshotVersion: "workspace-snapshot.v1",
        activeSectionId: targetId,
        exportEligible: false,
        exportBlockingReasons: ["required_sections_not_approved"],
      },
    };
    const view = renderHook(() => useDocument(outcomeA, snapshot));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(generateDocumentStream).not.toHaveBeenCalled();
    expect(endpoints.document).not.toHaveBeenCalled();
    expect(endpoints.sections).not.toHaveBeenCalled();
    expect(view.result.current.state?.sections[0]?.content).toBe("");
    expect(view.result.current.state?.sections[1]?.content).toBe("I managed warehouse operations.");
  });

  it.each([false, true])(
    "resumes the initial server snapshot only without newer owner edits: newer=%s",
    async (newerOwnerEdit) => {
      const store = installSeedStore();
      const first = renderHook(() => useDocument(outcomeA));
      await waitFor(() => expect(first.result.current.loading).toBe(false));
      const accepted = store.current()!;
      const firstRequest = vi.mocked(generateDocumentStream).mock.calls[0]![0];
      const workspace = first.result.current.state!;
      first.unmount();
      sessionStorage.clear();
      const snapshot: WorkspaceInitialState = {
        intake: {
          outcomeId: outcomeA,
          situation: workspace.situation,
          templateName: workspace.title,
          templateId: workspace.templateId,
          conversationContext: workspace.conversationContext,
          uploadContext: workspace.uploadContext,
        },
        workspace: {
          ...workspace,
          unresolvedPlaceholders: workspace.unresolvedPlaceholders ?? [],
          sections: workspace.sections.map((section, index) => ({
            ...section,
            content: accepted.input.sections[index]!.content ?? "",
            content_loaded: index === 0,
            content_sha256: accepted.receipt.sections[index]!.contentSha256,
            content_length: new TextEncoder().encode(accepted.input.sections[index]!.content ?? "")
              .length,
            revision: 1,
            approved_revision: null,
            ledger_binding_status: "legacy_unversioned",
            section_key: null,
            section_state: null,
          })),
        },
        truth: {
          authenticated: true,
          ownerUserId: owner,
          persistence: "persisted",
          documentId: workspace.documentId,
          currentRevision: 1,
          approvedRevision: null,
          ledgerBindingStatus: "legacy_unversioned",
          ledgerVersion: null,
          operationId: null,
          operationRevision: null,
          operationStatus: null,
          operationMessage: null,
          safeNextAction: null,
          persistedAt: accepted.receipt.committedAt,
          snapshotVersion: "workspace-snapshot.v1",
          activeSectionId: workspace.sections[0]!.id,
          exportEligible: false,
          exportBlockingReasons: ["required_sections_not_approved"],
        },
      };
      if (newerOwnerEdit) {
        const updatedRows = (await endpoints.sections(workspace.documentId)).map(
          (section: ReturnType<typeof sections>[number], index: number) =>
            index < 2
              ? {
                  ...section,
                  content: index === 0 ? "" : "Newer saved sibling wording.",
                  status: "edited",
                  revision: index === 0 ? 3 : 2,
                  approved_revision: null,
                }
              : section,
        );
        endpoints.sections.mockResolvedValue(updatedRows);
        endpoints.document.mockResolvedValue({
          ...document(workspace.documentId, outcomeA),
          title: workspace.title,
          template_id: workspace.templateId,
          status: "edited",
          current_revision: 4,
        });
      }
      const resumed = renderHook(() => useDocument(outcomeA, snapshot));
      await waitFor(() => expect(resumed.result.current.loading).toBe(false));
      expect(generateDocumentStream).toHaveBeenCalledTimes(newerOwnerEdit ? 1 : 2);
      if (newerOwnerEdit) {
        expect(resumed.result.current.currentRevision).toBe(4);
        expect(resumed.result.current.state?.sections[0]?.content).toBe("");
        expect(resumed.result.current.state?.sections[1]?.content).toBe(
          "Newer saved sibling wording.",
        );
      } else expect(vi.mocked(generateDocumentStream).mock.calls[1]![0]).toEqual(firstRequest);
      expect(resumed.result.current.state?.documentId).toBe(accepted.input.documentId);
      expect(store.receipts.size).toBe(1);
    },
  );

  it("does not dispatch a previous outcome's sections while the next outcome is still loading", async () => {
    endpoints.document.mockImplementation((id: string) =>
      Promise.resolve(document(id === outcomeB ? docB : docA, id)),
    );
    endpoints.sections.mockImplementation((id: string) => Promise.resolve(sections(id, false)));
    const view = renderHook(({ id }) => useDocument(id), { initialProps: { id: outcomeA } });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    const nextRead = deferred<ReturnType<typeof document> | null>();
    endpoints.document.mockReturnValueOnce(nextRead.promise);
    view.rerender({ id: outcomeB });
    await act(async () => view.result.current.retryGenerationSection(targetId));
    expect(generateDocumentStream).not.toHaveBeenCalled();
    await act(async () => nextRead.resolve(document(docB, outcomeB)));
    await waitFor(() => expect(view.result.current.state?.documentId).toBe(docB));
  });

  it("admits a fresh outcome with revision zero after reusing a previously saved hook", async () => {
    endpoints.document.mockResolvedValueOnce(document(docA, outcomeA)).mockResolvedValue(null);
    endpoints.sections.mockResolvedValue(sections(docA, false));
    const view = renderHook(({ id }) => useDocument(id), { initialProps: { id: outcomeA } });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    view.rerender({ id: outcomeB });
    await waitFor(() => expect(view.result.current.state?.documentId).not.toBe(docA));
    await waitFor(() => expect(endpoints.save).toHaveBeenCalledTimes(1));
    expect(endpoints.save.mock.calls[0]![0]).toMatchObject({
      outcomeId: outcomeB,
      expectedDocumentRevision: 0,
      expectedDocument: null,
    });
    await waitFor(() => expect(generateDocumentStream).toHaveBeenCalledTimes(1));
  });

  it("rejects a scoped callback from before a sibling edit reached React", async () => {
    endpoints.document.mockResolvedValue(document(docA, outcomeA));
    endpoints.sections.mockResolvedValue(sections(docA, false));
    const view = renderHook(() => useDocument(outcomeA));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    let retry!: Promise<void>;
    act(() => {
      view.result.current.setSections((current) =>
        current.map((section) =>
          section.id === siblingId
            ? { ...section, content: "My latest sibling wording.", status: "edited" }
            : section,
        ),
      );
      retry = view.result.current.retryGenerationSection(targetId);
    });
    await act(async () => retry);
    expect(generateDocumentStream).not.toHaveBeenCalled();
    expect(view.result.current.state?.sections[1]?.content).toBe("My latest sibling wording.");
  });

  it.each(["same tab", "new tab"])(
    "recovers an uncertain seed acknowledgement in the %s",
    async (recovery) => {
      const store = installSeedStore();
      endpoints.save.mockImplementationOnce(async (input: SaveLegacyWorkspaceV1Input) => {
        await store.commit(input);
        throw new LegacyWorkspaceSaveError("LEGACY_WORKSPACE_ACKNOWLEDGEMENT_UNKNOWN", true);
      });
      const first = renderHook(() => useDocument(outcomeA));
      await waitFor(() => expect(first.result.current.loading).toBe(false));
      expect(generateDocumentStream).not.toHaveBeenCalled();
      expect(first.result.current.syncStatus).toBe("failed");
      expect(store.receipts.size).toBe(1);
      const accepted = store.current()!.input;
      expect(first.result.current.state?.documentId).toBe(accepted.documentId);
      if (recovery === "same tab") {
        await act(async () =>
          first.result.current.retryGenerationSection(accepted.sections[0]!.id),
        );
        expect(endpoints.save).toHaveBeenCalledTimes(2);
        expect(endpoints.save.mock.calls[1]![0]).toEqual(accepted);
        expect(first.result.current.currentRevision).toBe(1);
      } else {
        first.unmount();
        sessionStorage.clear();
        const resumed = renderHook(() => useDocument(outcomeA));
        await waitFor(() => expect(resumed.result.current.loading).toBe(false));
        expect(resumed.result.current.state?.documentId).toBe(accepted.documentId);
        expect(resumed.result.current.state?.sections.map((section) => section.id)).toEqual(
          accepted.sections.map((section) => section.id),
        );
        expect(endpoints.save).toHaveBeenCalledTimes(1);
        expect(endpoints.sections).toHaveBeenCalledWith(accepted.documentId, expect.anything());
      }
      expect(generateDocumentStream).toHaveBeenCalledTimes(1);
      expect(store.receipts.size).toBe(1);
    },
  );

  it("stops a concurrent losing seed and reopens the single admitted document on explicit reload", async () => {
    const store = installSeedStore();
    endpoints.document.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const first = renderHook(() => useDocument(outcomeA));
    const second = renderHook(() => useDocument(outcomeA));
    await waitFor(() =>
      expect(first.result.current.loading || second.result.current.loading).toBe(false),
    );
    expect(endpoints.save).toHaveBeenCalledTimes(2);
    expect(store.receipts.size).toBe(1);
    expect(generateDocumentStream).toHaveBeenCalledTimes(1);
    const winner = store.current()!.input;
    const loser = first.result.current.state?.documentId === winner.documentId ? second : first;
    expect(loser.result.current.state?.documentId).not.toBe(winner.documentId);
    expect(loser.result.current.syncStatus).toBe("failed");
    expect(loser.result.current.generationIssues[0]?.reason).toMatch(/reload/);
    loser.unmount();
    const reopened = renderHook(() => useDocument(outcomeA));
    await waitFor(() => expect(reopened.result.current.loading).toBe(false));
    expect(reopened.result.current.state?.documentId).toBe(winner.documentId);
    expect(reopened.result.current.state?.sections.map((section) => section.id)).toEqual(
      winner.sections.map((section) => section.id),
    );
    expect(endpoints.save).toHaveBeenCalledTimes(2);
    expect(store.receipts.size).toBe(1);
    expect(vi.mocked(generateDocumentStream).mock.calls[1]![0]).toEqual(
      vi.mocked(generateDocumentStream).mock.calls[0]![0],
    );
  });

  it.each(["unmount", "owner change", "local edit"])(
    "does not continue generation after %s during seed creation",
    async (change) => {
      const receipt = deferred<LegacyWorkspaceSaveReceiptV1>();
      endpoints.save.mockReturnValueOnce(receipt.promise);
      const view = renderHook(() => useDocument(outcomeA));
      await waitFor(() => expect(endpoints.save).toHaveBeenCalledTimes(1));
      expect(generateDocumentStream).not.toHaveBeenCalled();
      const seed: SaveLegacyWorkspaceV1Input = endpoints.save.mock.calls[0]![0];
      if (change === "unmount") view.unmount();
      else if (change === "owner change") {
        recordBrowserPrincipal(undefined);
        vi.mocked(useAuth).mockReturnValue({ user: null, loading: false } as ReturnType<
          typeof useAuth
        >);
        view.rerender();
      } else {
        act(() =>
          view.result.current.setSections((current) =>
            current.map((section, index) =>
              index === 0
                ? { ...section, content: "My newer deliberate wording.", status: "edited" }
                : section,
            ),
          ),
        );
      }
      await act(async () => receipt.resolve(await aggregateReceipt(seed)));
      expect(generateDocumentStream).not.toHaveBeenCalled();
      if (change === "local edit") {
        expect(view.result.current.state?.sections[0]?.content).toBe(
          "My newer deliberate wording.",
        );
        expect(view.result.current.syncStatus).not.toBe("saved");
      } else if (change === "owner change") {
        expect(
          view.result.current.state?.sections.some((section) => section.user_id === owner),
        ).not.toBe(true);
      }
    },
  );

  it("saves final wording against the admitted seed revision and exact section roster", async () => {
    const store = installSeedStore();
    const finalReceipt = deferred<LegacyWorkspaceSaveReceiptV1>();
    endpoints.save.mockImplementation((input: SaveLegacyWorkspaceV1Input) =>
      input.expectedDocumentRevision === 0 ? store.commit(input) : finalReceipt.promise,
    );
    vi.mocked(generateDocumentStream).mockImplementation(async (input, receive) => {
      for (const [index, section] of (input.sections ?? []).entries()) {
        await receive({
          type: "section",
          key: section.key,
          label: section.label,
          content: `Confirmed facts recorded in section ${index + 1}.`,
        });
      }
    });
    const view = renderHook(() => useDocument(outcomeA));
    await waitFor(() => expect(endpoints.save).toHaveBeenCalledTimes(2));
    const seed: SaveLegacyWorkspaceV1Input = endpoints.save.mock.calls[0]![0];
    const final: SaveLegacyWorkspaceV1Input = endpoints.save.mock.calls[1]![0];
    expect(final).toMatchObject({
      documentId: seed.documentId,
      outcomeId: seed.outcomeId,
      expectedDocumentRevision: 1,
    });
    expect(final.sections.map((section) => section.id)).toEqual(
      seed.sections.map((section) => section.id),
    );
    for (const [index, section] of final.sections.entries()) {
      expect(section.expected).toMatchObject({
        revision: 1,
        content_sha256: await digestText(seed.sections[index]!.content ?? ""),
      });
    }
    expect(view.result.current.syncStatus).toBe("saving");
    await act(async () => finalReceipt.resolve(await store.commit(final)));
    await waitFor(() => expect(view.result.current.syncStatus).toBe("saved"));
    expect(generateDocumentStream).toHaveBeenCalledTimes(1);
    expect(endpoints.save).toHaveBeenCalledTimes(2);
    expect(store.current()?.receipt.documentRevision).toBeGreaterThan(1);
    const durable = await endpoints.sections(seed.documentId);
    expect(durable.map((section: { content: string }) => section.content)).toEqual(
      view.result.current.state?.sections.map((section) => section.content),
    );
  });

  it("waits for the exact seed receipt before generation can dispatch", async () => {
    const receipt = deferred<LegacyWorkspaceSaveReceiptV1>();
    endpoints.save.mockReturnValue(receipt.promise);
    const { result } = renderHook(() => useDocument(outcomeA));
    await waitFor(() =>
      expect(
        endpoints.save.mock.calls.length + vi.mocked(generateDocumentStream).mock.calls.length,
      ).toBeGreaterThan(0),
    );
    expect(generateDocumentStream).not.toHaveBeenCalled();
    expect(endpoints.save).toHaveBeenCalledTimes(1);
    const seed: SaveLegacyWorkspaceV1Input = endpoints.save.mock.calls[0]![0];
    expect(seed).toMatchObject({
      outcomeId: outcomeA,
      expectedDocumentRevision: 0,
      expectedDocument: null,
    });
    expect(seed.sections.length).toBeGreaterThan(0);
    expect(seed.sections.every((patch) => patch.expected === null)).toBe(true);
    expect(result.current.state?.documentId).toBe(seed.documentId);
    expect(result.current.state?.sections.map((section) => section.id)).toEqual(
      seed.sections.map((section) => section.id),
    );
    vi.useFakeTimers();
    await act(async () => vi.advanceTimersByTimeAsync(1_500));
    expect(endpoints.save).toHaveBeenCalledTimes(1);
    expect(generateDocumentStream).not.toHaveBeenCalled();
    await act(async () => receipt.resolve(await aggregateReceipt(seed)));
    await act(async () =>
      vi.waitFor(() => expect(generateDocumentStream).toHaveBeenCalledTimes(1)),
    );
    expect(result.current.currentRevision).toBe(1);
  });

  it("does not generate after rejected creation, including a scoped retry", async () => {
    endpoints.save.mockRejectedValue(
      new LegacyWorkspaceSaveError("LEGACY_WORKSPACE_UNAVAILABLE", false),
    );
    const { result } = renderHook(() => useDocument(outcomeA));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.state?.sections.length).toBeGreaterThan(0);
    expect(generateDocumentStream).not.toHaveBeenCalled();
    expect(result.current.syncStatus).toBe("failed");
    expect(result.current.generationIssues[0]?.reason).toMatch(/sav/i);
    const sectionId = result.current.state!.sections[0]!.id;
    await act(async () => result.current.retryGenerationSection(sectionId));
    expect(generateDocumentStream).not.toHaveBeenCalled();
    vi.useFakeTimers();
    const attempts = endpoints.save.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(endpoints.save).toHaveBeenCalledTimes(attempts);
  });

  it("reuses admitted resource and request identities after generation delivery loss without browser storage", async () => {
    const store = installSeedStore();
    const first = renderHook(() => useDocument(outcomeA));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(generateDocumentStream).toHaveBeenCalledTimes(1);
    const firstRequest = vi.mocked(generateDocumentStream).mock.calls[0]![0];
    const firstId = first.result.current.state!.documentId;
    first.unmount();
    sessionStorage.clear();
    const resumed = renderHook(() => useDocument(outcomeA));
    await waitFor(() => expect(resumed.result.current.loading).toBe(false));
    expect(generateDocumentStream).toHaveBeenCalledTimes(2);
    const resumedRequest = vi.mocked(generateDocumentStream).mock.calls[1]![0];
    expect(resumed.result.current.state?.documentId).toBe(firstId);
    expect(resumedRequest).toEqual(firstRequest);
    expect(store.current()?.input.documentId).toBe(firstId);
    expect(store.receipts.size).toBe(1);
  });
});

function RealEditorWorkspace({
  outcomeId = outcomeB,
  activeIndex = 0,
}: { outcomeId?: string; activeIndex?: number } = {}) {
  const document = useDocument(outcomeId);
  const edits = useSection(document.setSections);
  observed.document = document;
  if (document.loading || !document.state) return null;
  return (
    <SectionEditor
      key={document.state.sections[activeIndex]!.id}
      section={document.state.sections[activeIndex]!}
      ledgerBindingStatus="legacy_unversioned"
      workspaceSaved={document.syncStatus === "saved"}
      onEdit={edits.editContent}
      onPersistedLegacyApply={document.mergePersistedLegacyApply}
      onApprove={edits.approve}
      onUnapprove={edits.unapprove}
      onToggleLock={edits.toggleLock}
      onOpenHistory={() => {}}
    />
  );
}

describe("real editor typing through the document save queue", () => {
  it("preserves placeholder identity and caret through a local echo and save receipt", async () => {
    const content = "<p>Meet {{TED_PLACEHOLDER:incident.date:Date &amp; time}} here.</p>";
    endpoints.sections.mockImplementation((id: string) =>
      Promise.resolve(
        sections(id, false).map((section, index) =>
          index === 0 ? { ...section, content } : section,
        ),
      ),
    );
    const receipt = deferred<LegacyWorkspaceSaveReceiptV1>();
    endpoints.save.mockReturnValue(receipt.promise);
    const view = render(<RealEditorWorkspace />);
    const textbox = await screen.findByRole("textbox", { name: "Edit Opening & Role" });
    vi.useFakeTimers();
    act(() => {
      observed.editor!.commands.setTextSelection(2);
      observed.editor!.commands.insertContent("X");
    });
    expect(observed.editor!.state.selection.from).toBe(3);
    const expected = "<p>MXeet {{TED_PLACEHOLDER:incident.date:Date &amp; time}} here.</p>";
    expect(observed.document!.state?.sections[0]?.content).toBe(expected);
    expect(textbox.querySelectorAll('[data-ted-placeholder-id="incident.date"]')).toHaveLength(1);
    expect(textbox.querySelector('[data-ted-placeholder-id="incident.date"]')).toHaveTextContent(
      "Date & time",
    );
    await act(async () => vi.advanceTimersByTimeAsync(500));
    await act(async () => vi.waitFor(() => expect(endpoints.save).toHaveBeenCalledTimes(1)));
    await act(async () =>
      receipt.resolve(await aggregateReceipt(endpoints.save.mock.calls[0]![0])),
    );
    expect(observed.editor!.state.selection.from).toBe(3);
    expect(observed.document!.state?.sections[0]?.content).toBe(expected);
    expect(observed.document!.syncStatus).toBe("saved");
    await act(async () => {
      view.rerender(<RealEditorWorkspace activeIndex={1} />);
    });
    await act(async () => {
      view.rerender(<RealEditorWorkspace />);
    });
    expect(
      screen
        .getByRole("textbox", { name: "Edit Opening & Role" })
        .querySelectorAll('[data-ted-placeholder-id="incident.date"]'),
    ).toHaveLength(1);
    expect(observed.document!.state?.sections[0]?.content).toBe(expected);
  });

  it("fences an earlier generation result as soon as the actual editor publishes input", async () => {
    const release = deferred<void>();
    vi.mocked(generateDocumentStream).mockImplementation(async (_input, receive) => {
      await release.promise;
      await receive({
        type: "section",
        key: "opening",
        label: "Opening & Role",
        content: "Earlier generation wording.",
      });
    });
    render(<RealEditorWorkspace />);
    await screen.findByRole("textbox", { name: "Edit Opening & Role" });
    let regeneration!: Promise<void>;
    act(() => {
      regeneration = observed.document!.retryGenerationSection(
        observed.document!.state!.sections[0]!.id,
      );
    });
    await waitFor(() => expect(generateDocumentStream).toHaveBeenCalledTimes(1));
    vi.useFakeTimers();
    act(() => {
      observed.editor!.commands.setContent("<p>My current wording.</p>");
    });
    await act(async () => {
      release.resolve();
      await regeneration;
    });
    expect(observed.document!.drafting).toBe(false);
    expect(observed.editor!.getHTML()).toBe("<p>My current wording.</p>");
    expect(observed.document!.state?.sections[0]?.content).toBe("<p>My current wording.</p>");
    expect(observed.document!.generationIssues[0]).toMatchObject({
      retryable: false,
      reason: expect.stringContaining("newer wording"),
    });
    expect(endpoints.save).not.toHaveBeenCalled();
  });

  it("keeps the final transaction when an insertion is reverted before React renders", async () => {
    endpoints.sections.mockImplementation((id: string) =>
      Promise.resolve(
        sections(id, false).map((section, index) =>
          index === 0 ? { ...section, content: "<p>Original wording.</p>" } : section,
        ),
      ),
    );
    render(<RealEditorWorkspace />);
    await screen.findByRole("textbox", { name: "Edit Opening & Role" });
    vi.useFakeTimers();
    act(() => {
      observed.editor!.commands.insertContentAt(1, "Inserted ");
      observed.editor!.commands.deleteRange({ from: 1, to: 10 });
    });
    expect(observed.editor!.getHTML()).toBe("<p>Original wording.</p>");
    expect(observed.document!.state?.sections[0]?.content).toBe("<p>Original wording.</p>");
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(
      endpoints.save.mock.calls.every(([command]) =>
        command.sections.every(
          (section: { content?: string }) => !section.content?.includes("Inserted"),
        ),
      ),
    ).toBe(true);
  });

  it("retains typed wording across an immediate keyed section switch", async () => {
    const view = render(<RealEditorWorkspace />);
    await screen.findByRole("textbox", { name: "Edit Opening & Role" });
    vi.useFakeTimers();
    act(() => {
      observed.editor!.commands.setContent("<p>Keep this opening.</p>");
    });
    await act(async () => {
      view.rerender(<RealEditorWorkspace activeIndex={1} />);
    });
    expect(screen.getByRole("textbox", { name: "Edit Why You Fit" })).toHaveTextContent(
      "warehouse",
    );
    await act(async () => {
      view.rerender(<RealEditorWorkspace />);
    });
    expect(screen.getByRole("textbox", { name: "Edit Opening & Role" })).toHaveTextContent(
      "Keep this opening.",
    );
    expect(observed.document!.state?.sections[0]?.content).toBe("<p>Keep this opening.</p>");
    expect(endpoints.save).not.toHaveBeenCalled();
  });

  it("groups immediate transactions into history bursts and keeps the caret on echoes", async () => {
    render(<RealEditorWorkspace />);
    await screen.findByRole("textbox", { name: "Edit Opening & Role" });
    vi.useFakeTimers();
    const original = observed.document!.state!.sections[0]!.content;
    act(() => {
      observed.editor!.commands.setTextSelection(4);
      observed.editor!.commands.insertContent("A");
    });
    const firstCaret = observed.editor!.state.selection.from;
    expect(firstCaret).toBe(5);
    act(() => {
      observed.editor!.commands.insertContent("B");
    });
    expect(observed.editor!.state.selection.from).toBe(6);
    const afterBurst = observed.document!.state!.sections[0]!;
    expect(afterBurst.version_history).toHaveLength(1);
    expect(afterBurst.version_history[0]?.content).toBe(original);
    expect(afterBurst.content).toContain("AB");
    act(() => vi.advanceTimersByTime(500));
    act(() => {
      observed.editor!.commands.insertContent("C");
    });
    expect(observed.document!.state!.sections[0]!.version_history).toHaveLength(2);
    expect(observed.document!.state!.sections[0]!.version_history[1]?.content).toBe(
      afterBurst.content,
    );
  });

  it("requires an account receipt before TED can edit newly typed wording", async () => {
    const receipt = deferred<LegacyWorkspaceSaveReceiptV1>();
    endpoints.save.mockReturnValue(receipt.promise);
    render(<RealEditorWorkspace />);
    const input = await screen.findByRole("textbox", { name: "Edit Opening & Role" });
    await waitFor(() => expect(screen.getByRole("button", { name: "tEdit" })).toBeEnabled());
    vi.useFakeTimers();
    act(() => {
      observed.editor!.commands.setContent("<p>New wording awaiting an account save.</p>");
    });
    fireEvent.click(screen.getByRole("button", { name: "tEdit" }));
    fireEvent.click(screen.getByRole("button", { name: "Make clearer" }));
    expect(observed.edit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Save the current wording");
    expect(input.textContent).toBe("New wording awaiting an account save.");
    await act(async () => vi.advanceTimersByTimeAsync(500));
    await act(async () => vi.waitFor(() => expect(endpoints.save).toHaveBeenCalledTimes(1)));
    const command: SaveLegacyWorkspaceV1Input = endpoints.save.mock.calls[0]![0];
    await act(async () => receipt.resolve(await aggregateReceipt(command)));
    // Receipt-only updates keep the editing panel open and advance its binding.
    fireEvent.click(screen.getByRole("button", { name: "Make clearer" }));
    expect(observed.edit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        content: "<p>New wording awaiting an account save.</p>",
        persistence: expect.objectContaining({ expectedSectionRevision: 2 }),
      }),
    );
  });

  it("publishes typed wording before the persistence debounce", async () => {
    render(<RealEditorWorkspace />);
    await screen.findByRole("textbox", { name: "Edit Opening & Role" });
    vi.useFakeTimers();
    act(() => {
      observed.editor!.commands.setContent("<p>My typed wording.</p>");
    });
    expect(observed.document!.state?.sections[0]?.content).toBe("<p>My typed wording.</p>");
    expect(observed.document!.syncStatus).toBe("idle");
    expect(endpoints.save).not.toHaveBeenCalled();
  });

  it("preserves newer typing when the previous save receipt arrives", async () => {
    const receipt = deferred<LegacyWorkspaceSaveReceiptV1>();
    endpoints.save.mockReturnValueOnce(receipt.promise);
    render(<RealEditorWorkspace />);
    await screen.findByRole("textbox", { name: "Edit Opening & Role" });
    vi.useFakeTimers();
    act(() => {
      observed.editor!.commands.setContent("<p>First typed wording.</p>");
    });
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    await act(async () => vi.waitFor(() => expect(endpoints.save).toHaveBeenCalledTimes(1)));
    const first: SaveLegacyWorkspaceV1Input = endpoints.save.mock.calls[0]![0];
    act(() => {
      observed.editor!.commands.setContent("<p>Newer typed wording.</p>");
    });
    await act(async () => receipt.resolve(await aggregateReceipt(first)));
    expect(observed.editor!.getText()).toBe("Newer typed wording.");
    expect(observed.document!.state?.sections[0]?.content).toBe("<p>Newer typed wording.</p>");
    expect(observed.document!.syncStatus).not.toBe("saved");
    await act(async () => vi.advanceTimersByTimeAsync(500));
    await act(async () => vi.waitFor(() => expect(endpoints.save).toHaveBeenCalledTimes(2)));
    const next: SaveLegacyWorkspaceV1Input = endpoints.save.mock.calls[1]![0];
    expect(next.expectedDocumentRevision).toBe(2);
    expect(next.sections[0]).toMatchObject({
      content: "<p>Newer typed wording.</p>",
      expected: { revision: 2, content_sha256: await digestText("<p>First typed wording.</p>") },
    });
  });

  it("flushes typing when the workspace unmounts before the old editor debounce", async () => {
    const receipt = deferred<LegacyWorkspaceSaveReceiptV1>();
    endpoints.save.mockReturnValue(receipt.promise);
    const { unmount } = render(<RealEditorWorkspace />);
    await screen.findByRole("textbox", { name: "Edit Opening & Role" });
    vi.useFakeTimers();
    act(() => {
      observed.editor!.commands.setContent("<p>Keep my last typed wording.</p>");
    });
    unmount();
    await act(async () => vi.waitFor(() => expect(endpoints.save).toHaveBeenCalledTimes(1)));
    const command: SaveLegacyWorkspaceV1Input = endpoints.save.mock.calls[0]![0];
    expect(command.sections[0]?.content).toBe("<p>Keep my last typed wording.</p>");
    await act(async () => receipt.resolve(await aggregateReceipt(command)));
    expect(loadWorkspace(currentWorkspaceCacheScope(owner), outcomeB)?.sections[0]?.content).toBe(
      "<p>Keep my last typed wording.</p>",
    );
  });
});

async function appliedSection(
  sectionId: string,
  content: string,
): Promise<LegacySectionApplyResult> {
  return {
    state: "applied",
    code: "APPLIED",
    operation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    section_id: sectionId,
    document_id: docB,
    section_content: content,
    section_content_sha256: await digestText(content),
    section_status: "edited",
    section_revision: 2,
    section_approved_revision: null,
    section_updated_at: now,
    document_status: "edited",
    document_revision: 2,
    document_approved_revision: null,
    document_updated_at: now,
    applied_section_revision: 2,
    idempotent_replay: false,
  };
}
afterEach(() => {
  recordBrowserPrincipal(undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("generation acceptance through the real save queue", () => {
  it("does not let a Save callback from the previous render consume a newer edit", async () => {
    const receipt = deferred<LegacyWorkspaceSaveReceiptV1>();
    endpoints.save.mockReturnValue(receipt.promise);
    const { result } = renderHook(() => useDocument(outcomeB));
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.useFakeTimers();
    act(() => {
      result.current.setSections((current) =>
        current.map((item, index) =>
          index === 0
            ? { ...item, content: "New edit awaiting React commit.", status: "edited" }
            : item,
        ),
      );
      result.current.retrySync();
    });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    await act(async () => vi.waitFor(() => expect(endpoints.save).toHaveBeenCalledTimes(1)));
    await act(async () =>
      receipt.resolve(await aggregateReceipt(endpoints.save.mock.calls[0]![0])),
    );
    expect(result.current.syncStatus).toBe("saved");
    expect(endpoints.save).toHaveBeenCalledTimes(1);
    expect(endpoints.save.mock.calls[0]?.[0].sections[0].content).toBe(
      "New edit awaiting React commit.",
    );
    expect(result.current.state?.sections[0]?.content).toBe("New edit awaiting React commit.");
  });

  it.each([100, 800])(
    "does not silently retry an explicit generation save that fails after %i ms",
    async (failureDelay) => {
      const receipt = deferred<LegacyWorkspaceSaveReceiptV1>();
      const recoveryReceipt = deferred<LegacyWorkspaceSaveReceiptV1>();
      endpoints.save
        .mockReturnValueOnce(receipt.promise)
        .mockReturnValueOnce(recoveryReceipt.promise);
      vi.useFakeTimers();
      const { result } = renderHook(() => useDocument(outcomeA));
      await act(async () => vi.waitFor(() => expect(endpoints.save).toHaveBeenCalledTimes(1)));
      await act(async () => vi.advanceTimersByTimeAsync(failureDelay));
      await act(async () => receipt.reject(new Error("Synthetic explicit save failure")));
      await act(async () => vi.advanceTimersByTimeAsync(2_000));
      expect(endpoints.save).toHaveBeenCalledTimes(1);
      expect(result.current.syncStatus).toBe("failed");
      expect(generateDocumentStream).toHaveBeenCalledTimes(1);
      expect(result.current.state?.sections[0]?.content).toBe(
        "I am applying for the advertised role.",
      );
      act(() =>
        result.current.setSections((current) =>
          current.map((item, index) =>
            index === 0
              ? { ...item, content: "Newer wording after explicit failure.", status: "edited" }
              : item,
          ),
        ),
      );
      await act(async () => vi.advanceTimersByTimeAsync(500));
      await act(async () => vi.waitFor(() => expect(endpoints.save).toHaveBeenCalledTimes(2)));
      await act(async () =>
        recoveryReceipt.resolve(await aggregateReceipt(endpoints.save.mock.calls[1]![0])),
      );
      expect(result.current.syncStatus).toBe("saved");
      expect(endpoints.save).toHaveBeenCalledTimes(2);
      expect(endpoints.save.mock.calls[1]?.[0].sections[0].content).toBe(
        "Newer wording after explicit failure.",
      );
      expect(generateDocumentStream).toHaveBeenCalledTimes(1);
    },
  );

  it("does not silently repeat a failed manual save while the edit debounce was pending", async () => {
    const receipt = deferred<LegacyWorkspaceSaveReceiptV1>();
    endpoints.save.mockReturnValue(receipt.promise);
    const { result, unmount } = renderHook(() => useDocument(outcomeB));
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.useFakeTimers();
    act(() =>
      result.current.setSections((current) =>
        current.map((item, index) =>
          index === 0
            ? { ...item, content: "Deliberate current wording.", status: "edited" }
            : item,
        ),
      ),
    );
    act(() => result.current.retrySync());
    await act(async () => vi.waitFor(() => expect(endpoints.save).toHaveBeenCalledTimes(1)));
    await act(async () => receipt.reject(new Error("Synthetic account save failure")));
    expect(result.current.syncStatus).toBe("failed");
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(result.current.syncStatus).toBe("failed");
    });
    expect(endpoints.save).toHaveBeenCalledTimes(1);
    expect(result.current.syncStatus).toBe("failed");
    expect(generateDocumentStream).not.toHaveBeenCalled();
    unmount();
    expect(endpoints.save).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate a slow explicit generation save after its receipt arrives", async () => {
    const receipt = deferred<LegacyWorkspaceSaveReceiptV1>();
    endpoints.save.mockReturnValue(receipt.promise);
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useDocument(outcomeA));
    await act(async () => vi.waitFor(() => expect(endpoints.save).toHaveBeenCalledTimes(1)));
    const command: SaveLegacyWorkspaceV1Input = endpoints.save.mock.calls[0]![0];
    await act(async () => vi.advanceTimersByTimeAsync(800));
    await act(async () => receipt.resolve(await aggregateReceipt(command)));
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(result.current.syncStatus).toBe("saved");
    expect(result.current.currentRevision).toBe(2);
    unmount();
    expect(endpoints.save).toHaveBeenCalledTimes(1);
    expect(generateDocumentStream).toHaveBeenCalledTimes(1);
  });

  it("leaves an ordinary autosave failure recoverable without repeating it", async () => {
    endpoints.save.mockRejectedValue(new Error("Synthetic autosave failure"));
    const { result } = renderHook(() => useDocument(outcomeB));
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.useFakeTimers();
    act(() =>
      result.current.setSections((current) =>
        current.map((item, index) =>
          index === 0 ? { ...item, content: "Retained unsaved wording.", status: "edited" } : item,
        ),
      ),
    );
    await act(async () => vi.advanceTimersByTimeAsync(500));
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(result.current.syncStatus).toBe("failed");
    });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(endpoints.save).toHaveBeenCalledTimes(1);
    expect(result.current.syncStatus).toBe("failed");
    expect(loadWorkspace(currentWorkspaceCacheScope(owner), outcomeB)?.sections[0]?.content).toBe(
      "Retained unsaved wording.",
    );
  });

  it("automatically saves changed order, section metadata and document status together", async () => {
    const { result } = renderHook(() => useDocument(outcomeB));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const original = result.current.state!.sections;
    vi.useFakeTimers();
    act(() => {
      result.current.setSections([
        { ...original[1]!, name: "Confirmed experience", is_required: false, order_index: 0 },
        { ...original[0]!, order_index: 1 },
      ]);
      result.current.setStatus("edited");
    });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    vi.useRealTimers();
    await waitFor(() => expect(result.current.syncStatus).toBe("saved"));
    expect(endpoints.save).toHaveBeenCalledTimes(1);
    const command: SaveLegacyWorkspaceV1Input = endpoints.save.mock.calls[0]![0];
    expect(command.document.status).toBe("edited");
    expect(command.sections.map((section) => section.id)).toEqual([
      original[1]!.id,
      original[0]!.id,
    ]);
    expect(command.sections[0]?.desired).toMatchObject({
      name: "Confirmed experience",
      is_required: false,
      order_index: 0,
    });
    expect(command.sections[1]?.desired.order_index).toBe(1);
    expect(command.sections.every((section) => section.content === undefined)).toBe(true);
    expect(generateDocumentStream).not.toHaveBeenCalled();
  });

  it("does not attach a pending ordinary edit to a different outcome", async () => {
    endpoints.sections.mockImplementation((id: string) => Promise.resolve(sections(id, false)));
    const { result, rerender } = renderHook(({ outcome }) => useDocument(outcome), {
      initialProps: { outcome: outcomeA },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.useFakeTimers();
    act(() =>
      result.current.setSections((current) =>
        current.map((item, index) =>
          index === 0 ? { ...item, content: "Private edit for A.", status: "edited" } : item,
        ),
      ),
    );
    rerender({ outcome: outcomeB });
    await act(async () =>
      vi.waitFor(() =>
        expect(loadWorkspace(currentWorkspaceCacheScope(owner), outcomeB)?.documentId).toBe(docB),
      ),
    );
    expect(result.current.state?.documentId).toBe(docB);
    expect(result.current.loading).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(endpoints.save).not.toHaveBeenCalled();
    expect(result.current.state?.sections[0]?.content).toBe("Previously confirmed wording.");
    expect(loadWorkspace(currentWorkspaceCacheScope(owner), outcomeB)?.sections[0]?.content).toBe(
      "Previously confirmed wording.",
    );
    expect(generateDocumentStream).not.toHaveBeenCalled();
  });

  it("discards pre-Apply wording and does not resend an already persisted section", async () => {
    const { result } = renderHook(() => useDocument(outcomeB));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const applied = await appliedSection(
      result.current.state!.sections[0]!.id,
      "Authoritative applied wording.",
    );
    vi.useFakeTimers();
    act(() =>
      result.current.setSections((current) =>
        current.map((item, index) =>
          index === 0 ? { ...item, content: "Older pending wording.", status: "edited" } : item,
        ),
      ),
    );
    act(() => vi.advanceTimersByTime(400));
    act(() => {
      result.current.mergePersistedLegacyApply(applied);
      vi.advanceTimersByTime(100);
    });
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(result.current.state?.sections[0]?.content).toBe(applied.section_content);
    expect(result.current.currentRevision).toBe(2);
    expect(result.current.syncStatus).toBe("saved");
    expect(endpoints.save).not.toHaveBeenCalled();
  });

  it("saves an unsaved sibling against the applied revision without an interim Saved claim", async () => {
    const receipt = deferred<LegacyWorkspaceSaveReceiptV1>();
    endpoints.save.mockReturnValue(receipt.promise);
    const { result } = renderHook(() => useDocument(outcomeB));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const applied = await appliedSection(
      result.current.state!.sections[0]!.id,
      "Applied target wording.",
    );
    vi.useFakeTimers();
    act(() =>
      result.current.setSections((current) =>
        current.map((item, index) =>
          index === 1 ? { ...item, content: "Unsaved sibling wording.", status: "edited" } : item,
        ),
      ),
    );
    act(() => result.current.mergePersistedLegacyApply(applied));
    expect(result.current.syncStatus).not.toBe("saved");
    await act(async () => vi.advanceTimersByTimeAsync(500));
    vi.useRealTimers();
    await waitFor(() => expect(endpoints.save).toHaveBeenCalledTimes(1));
    const command: SaveLegacyWorkspaceV1Input = endpoints.save.mock.calls[0]![0];
    expect(command.expectedDocumentRevision).toBe(2);
    expect(command.sections[0]?.content).toBeUndefined();
    expect(command.sections[0]?.expected).toMatchObject({
      revision: 2,
      content_sha256: applied.section_content_sha256,
    });
    expect(command.sections[1]?.content).toBe("Unsaved sibling wording.");
    expect(result.current.syncStatus).toBe("saving");
    await act(async () => receipt.resolve(await aggregateReceipt(command)));
    expect(result.current.syncStatus).toBe("saved");
    expect(result.current.state?.sections[0]?.content).toBe(applied.section_content);
    expect(result.current.state?.sections[1]?.content).toBe("Unsaved sibling wording.");
  });

  it("preserves newer typing and Apply revisions when an earlier save receipt returns", async () => {
    const receipt = deferred<LegacyWorkspaceSaveReceiptV1>();
    endpoints.save.mockReturnValueOnce(receipt.promise);
    const { result } = renderHook(() => useDocument(outcomeB));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const applied = await appliedSection(
      result.current.state!.sections[1]!.id,
      "Applied sibling wording.",
    );
    applied.document_revision = 3;
    vi.useFakeTimers();
    const edit = (content: string) =>
      result.current.setSections((current) =>
        current.map((item, index) => (index === 0 ? { ...item, content, status: "edited" } : item)),
      );
    act(() => edit("Earlier edit."));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    vi.useRealTimers();
    await waitFor(() => expect(endpoints.save).toHaveBeenCalledTimes(1));
    const earlier: SaveLegacyWorkspaceV1Input = endpoints.save.mock.calls[0]![0];
    vi.useFakeTimers();
    act(() => edit("Latest deliberate wording."));
    act(() => result.current.mergePersistedLegacyApply(applied));
    await act(async () => receipt.resolve(await aggregateReceipt(earlier)));
    expect(result.current.currentRevision).toBe(3);
    expect(result.current.state?.sections[0]?.content).toBe("Latest deliberate wording.");
    expect(result.current.state?.sections[1]?.content).toBe(applied.section_content);
    expect(result.current.syncStatus).not.toBe("saved");
    await act(async () => vi.advanceTimersByTimeAsync(500));
    vi.useRealTimers();
    await waitFor(() => expect(result.current.syncStatus).toBe("saved"));
    expect(endpoints.save).toHaveBeenCalledTimes(2);
    const latest: SaveLegacyWorkspaceV1Input = endpoints.save.mock.calls[1]![0];
    expect(latest.expectedDocumentRevision).toBe(3);
    expect(latest.sections[0]).toMatchObject({
      expected: { revision: 2, content_sha256: await digestText("Earlier edit.") },
      content: "Latest deliberate wording.",
    });
    expect(latest.sections[1]?.content).toBeUndefined();
  });

  it("automatically saves an ordinary edit using the hydrated baseline", async () => {
    const { result } = renderHook(() => useDocument(outcomeB));
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.useFakeTimers();
    act(() =>
      result.current.setSections((current) =>
        current.map((item, index) =>
          index === 0 ? { ...item, content: "My deliberate edit.", status: "edited" } : item,
        ),
      ),
    );
    expect(result.current.syncStatus).toBe("idle");
    await act(async () => vi.advanceTimersByTimeAsync(500));
    vi.useRealTimers();
    await waitFor(() => expect(endpoints.save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.syncStatus).toBe("saved"));
    const command: SaveLegacyWorkspaceV1Input = endpoints.save.mock.calls[0]![0];
    expect(command.documentId).toBe(docB);
    expect(command.expectedDocumentRevision).toBe(1);
    expect(command.sections[0]).toMatchObject({
      expected: { revision: 1, content_sha256: await digestText("Previously confirmed wording.") },
      content: "My deliberate edit.",
    });
    expect(command.sections[1]?.content).toBeUndefined();
    expect(loadWorkspace(currentWorkspaceCacheScope(owner), outcomeB)?.sections[0]?.content).toBe(
      "My deliberate edit.",
    );
    expect(generateDocumentStream).not.toHaveBeenCalled();
  });

  it("coalesces rapid edits and fences the previous timer before React commits", async () => {
    const { result } = renderHook(() => useDocument(outcomeB));
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.useFakeTimers();
    const edit = (content: string) =>
      result.current.setSections((current) =>
        current.map((item, index) => (index === 0 ? { ...item, content, status: "edited" } : item)),
      );
    act(() => edit("First edit."));
    act(() => vi.advanceTimersByTime(400));
    act(() => {
      edit("Latest edit.");
      // The live mutation fence must invalidate the old scheduled snapshot
      // synchronously, before React commits this setter's new value.
      vi.advanceTimersByTime(100);
    });
    expect(endpoints.save).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(499));
    expect(endpoints.save).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    vi.useRealTimers();
    await waitFor(() => expect(result.current.syncStatus).toBe("saved"));
    expect(endpoints.save).toHaveBeenCalledTimes(1);
    expect(endpoints.save.mock.calls[0]?.[0].sections[0].content).toBe("Latest edit.");
  });

  it("flushes an ordinary accepted edit on unmount without generating again", async () => {
    const { result, unmount } = renderHook(() => useDocument(outcomeB));
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.useFakeTimers();
    act(() =>
      result.current.setSections((current) =>
        current.map((item, index) =>
          index === 0
            ? { ...item, content: "Keep this edit when leaving.", status: "edited" }
            : item,
        ),
      ),
    );
    unmount();
    vi.useRealTimers();
    await waitFor(() => expect(endpoints.save).toHaveBeenCalledTimes(1));
    expect(endpoints.save.mock.calls[0]?.[0].sections[0].content).toBe(
      "Keep this edit when leaving.",
    );
    expect(generateDocumentStream).not.toHaveBeenCalled();
  });

  it("adopts one complete result and dispatches one aggregate save without a user edit or manual autosave", async () => {
    const receipt = deferred<LegacyWorkspaceSaveReceiptV1>();
    endpoints.save.mockReturnValue(receipt.promise);
    const { result, unmount } = renderHook(() => useDocument(outcomeA));
    await waitFor(() => expect(endpoints.save).toHaveBeenCalledTimes(1));
    const command: SaveLegacyWorkspaceV1Input = endpoints.save.mock.calls[0]![0];
    expect(command.documentId).toBe(docA);
    expect(command.expectedDocumentRevision).toBe(1);
    expect(command.sections[0]).toMatchObject({
      id: targetId,
      content: "I am applying for the advertised role.",
      desired: { name: "Opening & Role" },
    });
    expect(command.sections[1]).toMatchObject({
      id: siblingId,
      desired: { status: "approved", name: "Why You Fit" },
    });
    expect(command.sections[1]?.content).toBeUndefined();
    expect(result.current.state?.sections[0]?.content).toBe(
      "I am applying for the advertised role.",
    );
    expect(result.current.syncStatus).toBe("saving");
    expect(loadWorkspace(currentWorkspaceCacheScope(owner), outcomeA)?.sections[0]?.content).toBe(
      "I am applying for the advertised role.",
    );
    vi.useFakeTimers();
    await act(async () => receipt.resolve(await aggregateReceipt(command)));
    expect(result.current.syncStatus).toBe("saved");
    expect(result.current.currentRevision).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    unmount();
    expect(endpoints.save).toHaveBeenCalledTimes(1);
    expect(generateDocumentStream).toHaveBeenCalledTimes(1);
  });

  it("retains accepted wording after cloud failure and retries saving without generation", async () => {
    endpoints.save.mockRejectedValueOnce(new Error("Synthetic account write failure"));
    const { result } = renderHook(() => useDocument(outcomeA));
    await waitFor(() => expect(result.current.syncStatus).toBe("failed"));
    expect(result.current.state?.sections[0]?.content).toBe(
      "I am applying for the advertised role.",
    );
    expect(result.current.generationIssues).toEqual([]);
    act(() => result.current.retrySync());
    await waitFor(() => expect(result.current.syncStatus).toBe("saved"));
    expect(endpoints.save).toHaveBeenCalledTimes(2);
    expect(generateDocumentStream).toHaveBeenCalledTimes(1);
  });

  it("retries the newest desired wording after a failed accepted save", async () => {
    endpoints.save.mockRejectedValueOnce(new Error("Synthetic save failure"));
    const { result } = renderHook(() => useDocument(outcomeA));
    await waitFor(() => expect(result.current.syncStatus).toBe("failed"));
    act(() =>
      result.current.setSections((current) =>
        current.map((item) =>
          item.id === targetId ? { ...item, content: "My newer deliberate wording." } : item,
        ),
      ),
    );
    act(() => result.current.retrySync());
    await waitFor(() => expect(result.current.syncStatus).toBe("saved"));
    expect(endpoints.save.mock.calls[1]?.[0].sections[0].content).toBe(
      "My newer deliberate wording.",
    );
    expect(result.current.state?.sections[0]?.content).toBe("My newer deliberate wording.");
  });

  it("rejects the whole result when a local edit arrives before acceptance", async () => {
    const release = deferred<void>();
    vi.mocked(generateDocumentStream).mockImplementation(async (_input, receive) => {
      await release.promise;
      await receive({
        type: "section",
        key: "opening",
        label: "Opening & Role",
        content: "Earlier generation wording.",
      });
    });
    const { result } = renderHook(() => useDocument(outcomeA));
    await waitFor(() => expect(generateDocumentStream).toHaveBeenCalledTimes(1));
    act(() =>
      result.current.setSections((current) =>
        current.map((item) =>
          item.id === targetId ? { ...item, content: "Newer user wording." } : item,
        ),
      ),
    );
    await act(async () => release.resolve());
    await waitFor(() => expect(result.current.drafting).toBe(false));
    expect(result.current.state?.sections[0]?.content).toBe("Newer user wording.");
    expect(result.current.generationIssues[0]).toMatchObject({
      retryable: false,
      reason: expect.stringContaining("newer wording"),
    });
    expect(endpoints.save).not.toHaveBeenCalled();
  });

  it.each(["another outcome", "unmounted"])(
    "fences a late scoped result after the workspace is %s",
    async (destination) => {
      endpoints.sections.mockImplementation((id: string) => Promise.resolve(sections(id, false)));
      const release = deferred<void>();
      vi.mocked(generateDocumentStream).mockImplementation(async (_input, receive) => {
        await release.promise;
        await receive({
          type: "section",
          key: "opening",
          label: "Opening & Role",
          content: "Late A result.",
        });
      });
      const { result, rerender, unmount } = renderHook(({ id }) => useDocument(id), {
        initialProps: { id: outcomeA },
      });
      await waitFor(() => expect(result.current.loading).toBe(false));
      let retry!: Promise<void>;
      act(() => {
        retry = result.current.retryGenerationSection(targetId);
      });
      await waitFor(() => expect(generateDocumentStream).toHaveBeenCalledTimes(1));
      if (destination === "unmounted") unmount();
      else {
        rerender({ id: outcomeB });
        await waitFor(() => expect(result.current.state?.documentId).toBe(docB));
        expect(result.current.drafting).toBe(false);
        expect(result.current.regeneratingSectionId).toBeNull();
      }
      await act(async () => {
        release.resolve();
        await retry;
      });
      if (destination !== "unmounted") expect(result.current.state?.documentId).toBe(docB);
      expect(loadWorkspace(currentWorkspaceCacheScope(owner), outcomeA)?.sections[0]?.content).toBe(
        "Previously confirmed wording.",
      );
      expect(endpoints.save).not.toHaveBeenCalled();
    },
  );
});

describe("accepted save lifetime", () => {
  it("does not merge an old outcome receipt into a newly loaded outcome's revision baseline", async () => {
    const receiptA = deferred<LegacyWorkspaceSaveReceiptV1>();
    endpoints.save.mockReturnValueOnce(receiptA.promise);
    const { result, rerender } = renderHook(({ id }) => useDocument(id), {
      initialProps: { id: outcomeA },
    });
    await waitFor(() => expect(endpoints.save).toHaveBeenCalledTimes(1));
    const commandA = endpoints.save.mock.calls[0]![0] as SaveLegacyWorkspaceV1Input;
    rerender({ id: outcomeB });
    await waitFor(() => expect(result.current.state?.documentId).toBe(docB));
    expect(result.current.currentRevision).toBe(1);
    await act(async () => receiptA.resolve(await aggregateReceipt(commandA)));
    expect(result.current.state?.documentId).toBe(docB);
    expect(result.current.currentRevision).toBe(1);
    act(() =>
      result.current.setSections((current) =>
        current.map((item, index) => (index === 0 ? { ...item, content: "New B wording." } : item)),
      ),
    );
    act(() => result.current.retrySync());
    await waitFor(() => expect(endpoints.save).toHaveBeenCalledTimes(2));
    expect(endpoints.save.mock.calls[1]![0]).toMatchObject({
      documentId: docB,
      outcomeId: outcomeB,
      expectedDocumentRevision: 1,
    });
    expect(endpoints.save.mock.calls[1]![0].sections[0]).toMatchObject({
      content: "New B wording.",
      expected: { revision: 1 },
    });
  });

  it("allows an already accepted owner-scoped save to finish after unmount", async () => {
    const receipt = deferred<LegacyWorkspaceSaveReceiptV1>();
    endpoints.save.mockReturnValueOnce(receipt.promise);
    const { unmount } = renderHook(() => useDocument(outcomeA));
    await waitFor(() => expect(endpoints.save).toHaveBeenCalledTimes(1));
    const [command, saveLease] = endpoints.save.mock.calls[0]!;
    unmount();
    expect(() => saveLease.assertCurrent()).not.toThrow();
    expect(saveLease.signal?.aborted ?? false).toBe(false);
    await act(async () => receipt.resolve(await aggregateReceipt(command)));
    expect(endpoints.save).toHaveBeenCalledTimes(1);
  });

  it("replays an uncertain exact command before saving newer user wording", async () => {
    endpoints.save.mockRejectedValueOnce(
      new LegacyWorkspaceSaveError("SYNTHETIC_ACK_UNCERTAIN", true),
    );
    const { result } = renderHook(() => useDocument(outcomeA));
    await waitFor(() => expect(result.current.syncStatus).toBe("failed"));
    const original = structuredClone(endpoints.save.mock.calls[0]![0]);
    act(() =>
      result.current.setSections((current) =>
        current.map((item) =>
          item.id === targetId
            ? { ...item, content: "Newer wording after uncertain acknowledgement." }
            : item,
        ),
      ),
    );
    act(() => result.current.retrySync());
    await waitFor(() => expect(result.current.syncStatus).toBe("saved"));
    expect(endpoints.save).toHaveBeenCalledTimes(3);
    expect(endpoints.save.mock.calls[1]![0]).toEqual(original);
    expect(endpoints.save.mock.calls[2]![0]).toMatchObject({ expectedDocumentRevision: 2 });
    expect(endpoints.save.mock.calls[2]![0].sections[0].content).toBe(
      "Newer wording after uncertain acknowledgement.",
    );
    expect(generateDocumentStream).toHaveBeenCalledTimes(1);
  });
});

describe("scoped observation and save recovery", () => {
  it("allows a new outcome to save after another outcome had an uncertain acknowledgement", async () => {
    endpoints.save.mockRejectedValueOnce(
      new LegacyWorkspaceSaveError("SYNTHETIC_ACK_UNCERTAIN", true),
    );
    const { result, rerender } = renderHook(({ id }) => useDocument(id), {
      initialProps: { id: outcomeA },
    });
    await waitFor(() => expect(result.current.syncStatus).toBe("failed"));
    rerender({ id: outcomeB });
    await waitFor(() => expect(result.current.state?.documentId).toBe(docB));
    act(() =>
      result.current.setSections((current) =>
        current.map((item, index) =>
          index === 0 ? { ...item, content: "Confirmed B edit." } : item,
        ),
      ),
    );
    act(() => result.current.retrySync());
    await waitFor(() => expect(endpoints.save).toHaveBeenCalledTimes(2));
    expect(endpoints.save.mock.calls[1]![0]).toMatchObject({
      documentId: docB,
      outcomeId: outcomeB,
      expectedDocumentRevision: 1,
    });
    expect(endpoints.save.mock.calls[1]![0].sections[0].content).toBe("Confirmed B edit.");
  });

  it("admits one scoped retry when two clicks arrive before React commits", async () => {
    endpoints.sections.mockImplementation((id: string) => Promise.resolve(sections(id, false)));
    const release = deferred<void>();
    vi.mocked(generateDocumentStream).mockImplementation(async (_input, receive) => {
      await release.promise;
      await receive({
        type: "section",
        key: "opening",
        label: "Opening & Role",
        content: "One accepted retry result.",
      });
    });
    const { result } = renderHook(() => useDocument(outcomeA));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let retries!: Promise<void[]>;
    act(() => {
      retries = Promise.all([
        result.current.retryGenerationSection(targetId),
        result.current.retryGenerationSection(targetId),
      ]);
    });
    await waitFor(() => expect(generateDocumentStream).toHaveBeenCalled());
    await act(async () => {
      release.resolve();
      await retries;
    });
    expect(generateDocumentStream).toHaveBeenCalledTimes(1);
    expect(endpoints.save).toHaveBeenCalledTimes(1);
    expect(result.current.generationIssues).toEqual([]);
  });
});

describe("browser cache failure during generation acceptance", () => {
  it.each([true, false])(
    "keeps accepted wording and reports each storage outcome with cloudSuccess=%s",
    async (cloudSuccess) => {
      const setItem = Storage.prototype.setItem;
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
        this: Storage,
        key,
        value,
      ) {
        if (key.includes(":workspace:"))
          throw new DOMException("Synthetic quota", "QuotaExceededError");
        return setItem.call(this, key, value);
      });
      if (!cloudSuccess) endpoints.save.mockRejectedValue(new Error("Synthetic account failure"));
      const { result } = renderHook(() => useDocument(outcomeA));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(endpoints.save).toHaveBeenCalledTimes(1);
      expect(result.current.state?.sections[0]?.content).toBe(
        "I am applying for the advertised role.",
      );
      expect(result.current.deviceSaveStatus).toBe("quota_exceeded");
      expect(result.current.syncStatus).toBe(cloudSuccess ? "saved" : "failed");
      expect(result.current.generationIssues).toEqual([]);
      expect(loadWorkspace(currentWorkspaceCacheScope(owner), outcomeA)).toBeNull();
    },
  );
});

describe("current snapshot cache receipts", () => {
  it("invalidates an older successful tab and account label as soon as newer wording is delivered", async () => {
    endpoints.sections.mockImplementation((id: string) => Promise.resolve(sections(id, false)));
    const { result } = renderHook(() => useDocument(outcomeA));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.deviceSaveStatus).toBe("saved");
    expect(result.current.syncStatus).toBe("saved");
    act(() =>
      result.current.setSections((current) =>
        current.map((item) =>
          item.id === targetId ? { ...item, content: "Newer delivered edit." } : item,
        ),
      ),
    );
    expect(result.current.deviceSaveStatus).toBe("unknown");
    expect(result.current.syncStatus).toBe("idle");
    expect(loadWorkspace(currentWorkspaceCacheScope(owner), outcomeA)?.sections[0]?.content).toBe(
      "Previously confirmed wording.",
    );
    const receipt = deferred<LegacyWorkspaceSaveReceiptV1>();
    endpoints.save.mockReturnValueOnce(receipt.promise);
    act(() => result.current.retrySync());
    await waitFor(() => expect(endpoints.save).toHaveBeenCalledTimes(1));
    expect(result.current.deviceSaveStatus).toBe("saved");
    expect(result.current.syncStatus).toBe("saving");
    expect(loadWorkspace(currentWorkspaceCacheScope(owner), outcomeA)?.sections[0]?.content).toBe(
      "Newer delivered edit.",
    );
    await act(async () =>
      receipt.resolve(await aggregateReceipt(endpoints.save.mock.calls[0]![0])),
    );
  });

  it("lets a guest retry the current tab copy without an authenticated save", async () => {
    recordBrowserPrincipal(null);
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false } as ReturnType<
      typeof useAuth
    >);
    const scope = currentWorkspaceCacheScope();
    const guestSections = sections(docA, false).map((item) => ({
      ...item,
      user_id: "anonymous",
      status: "draft" as const,
    }));
    expect(
      saveWorkspace(scope, {
        documentId: docA,
        outcomeId: outcomeA,
        title: "Guest document",
        situation: "",
        status: "draft",
        sections: guestSections,
      }),
    ).toEqual({ status: "saved" });
    const setItem = Storage.prototype.setItem;
    const deny = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key.includes(":workspace:")) throw new DOMException("Synthetic denial", "SecurityError");
      return setItem.call(this, key, value);
    });
    const { result } = renderHook(() => useDocument(outcomeA));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.deviceSaveStatus).toBe("unavailable");
    act(() =>
      result.current.setSections((current) =>
        current.map((item) =>
          item.id === targetId ? { ...item, content: "New guest wording." } : item,
        ),
      ),
    );
    deny.mockRestore();
    // The mounted hook retains its guest identity even when its namespace key is lost.
    const namespaceKey = Array.from({ length: sessionStorage.length }, (_, i) =>
      sessionStorage.key(i),
    ).find((key) => key?.endsWith(":guest-scope"));
    if (!namespaceKey) throw new Error("Expected positive guest namespace fixture");
    sessionStorage.removeItem(namespaceKey);
    act(() => result.current.retrySync());
    expect(result.current.deviceSaveStatus).toBe("saved");
    expect(loadWorkspace(scope, outcomeA)?.sections[0]?.content).toBe("New guest wording.");
    expect(endpoints.save).not.toHaveBeenCalled();
    expect(generateDocumentStream).not.toHaveBeenCalled();
  });
});
