"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DocumentStatus,
  Outcome,
  DocumentPlaceholderMetadata,
  Section,
} from "@prompted/shared/browser";
import { isVisiblyEmpty } from "@prompted/shared/browser";
import {
  loadWorkspace,
  saveWorkspace,
  loadPendingOutcome,
  savePendingOutcome,
  type PendingOutcome,
  type WorkspaceDocumentState,
  type StoredWorkspace,
} from "@/lib/workspace-store";
import {
  applyGeneratedSection,
  applyRequiredSectionFallbacks,
  pendingDefaults,
  shouldGenerateInitialDraft,
  stateFromStored,
  storedFromState,
  streamInitialDraft,
} from "@/lib/document-generation";
import {
  fetchDocumentByOutcomeId,
  upsertDocument,
} from "@/lib/api/documents";
import { fetchOutcome } from "@/lib/api/outcomes";
import { fetchSections, upsertSections } from "@/lib/api/sections";
import {
  approveCapturedDocumentRevision,
  editCapturedDocumentSection,
  requestCapturedDocumentExport,
  type CapturedExportRequestResult,
} from "@/lib/api/captured-document-operations";
import { sanitiseSectionContent } from "@/lib/sanitise";
import { useAuth } from "@/components/providers";
import { useAutosave } from "./useAutosave";
import type { WorkspaceInitialState } from "@/lib/workspace-initial-state";

export type DocumentState = WorkspaceDocumentState;
export type WorkspaceSyncStatus = "local_only" | "idle" | "saving" | "saved" | "failed";

export interface GenerationIssue {
  sectionId: string;
  sectionName: string;
  reason: string;
  attempts: number;
}

export interface UseDocument {
  state: DocumentState | null;
  loading: boolean;
  drafting: boolean;
  syncStatus: WorkspaceSyncStatus;
  lastSyncedAt: string | null;
  retrySync: () => void;
  generationIssues: GenerationIssue[];
  regeneratingSectionId: string | null;
  retryGenerationSection: (sectionId: string) => Promise<void>;
  setSections: (next: Section[] | ((prev: Section[]) => Section[])) => void;
  setStatus: (status: string) => void;
  missingInfo: Array<{ key: string; label: string; missing: string[] }>;
  dismissMissingInfo: (sectionKey: string, item?: string) => void;
  unresolvedPlaceholders: DocumentPlaceholderMetadata[];
  setUnresolvedPlaceholders: (
    next:
      | DocumentPlaceholderMetadata[]
      | ((prev: DocumentPlaceholderMetadata[]) => DocumentPlaceholderMetadata[]),
  ) => void;
  captured: boolean;
  currentRevision: number | null;
  approvedRevision: number | null;
  operationId: string | null;
  operationRevision: number | null;
  approving: boolean;
  approveDocument: () => Promise<boolean>;
  requestCapturedExport: (
    format: "pdf" | "docx" | "xlsx" | "html_preview",
  ) => Promise<CapturedExportRequestResult | null>;
}

interface CapturedSectionClient extends Section {
  section_key?: string | null;
  revision?: number;
  section_state?:
    | "final"
    | "needs_clarification"
    | "interactive_placeholder"
    | "neutral_fallback"
    | "omitted_optional"
    | "failed_validation"
    | null;
}

interface CapturedIdentity {
  operationId: string;
  operationRevision: number;
  documentRevision: number;
  approvedRevision: number | null;
}

interface CapturedSavedSection {
  content: string;
  revision: number;
  state: CapturedSectionClient["section_state"];
}

function capturedSectionKey(section: CapturedSectionClient): string | null {
  return section.key?.trim() || section.section_key?.trim() || null;
}

function capturedEditableState(
  section: CapturedSectionClient,
): "final" | "interactive_placeholder" | "neutral_fallback" | "omitted_optional" {
  if (section.section_state === "omitted_optional") return "omitted_optional";
  if (section.section_state === "interactive_placeholder") {
    return "interactive_placeholder";
  }
  if (section.section_state === "neutral_fallback") return "neutral_fallback";
  return "final";
}

function pendingFromOutcome(outcome: Outcome | null): PendingOutcome | null {
  if (!outcome) return null;
  const payload = outcome.recommendation_payload;
  const templateId = payload?.primary?.template_id;
  const templateName = payload?.primary?.reason || templateId || "Untitled document";
  return {
    situation: payload?.situation ?? outcome.situation_text,
    templateName,
    templateId,
    conversationContext: payload?.conversation_context ?? "",
    uploadContext: payload?.upload_context ?? "",
    uploadId: payload?.upload_id,
    conversation: payload?.conversation ?? [],
    alternateFormats: payload?.alternatives?.map((item) => ({
      name: item.reason,
      format: "document",
      reason: item.reason,
      use_case: "Open this alternate format in the workspace.",
      benefits: [item.reason],
    })),
  };
}

function pendingFromInitialState(
  initialState: WorkspaceInitialState | null | undefined,
): PendingOutcome | null {
  const workspace = initialState?.workspace;
  if (!workspace) return null;
  return {
    situation: workspace.situation,
    templateName: workspace.title,
    templateId: workspace.templateId ?? undefined,
    conversationContext: workspace.conversationContext,
    uploadContext: workspace.uploadContext,
  };
}

function missingRequiredSections(sections: Section[]): GenerationIssue[] {
  return sections
    .filter((section) =>
      section.is_required !== false && isVisiblyEmpty(section.content)
    )
    .map((section) => ({
      sectionId: section.id,
      sectionName: section.name,
      reason: "TED did not produce safe final wording for this section.",
      attempts: 0,
    }));
}


export const PAYWALL_SECTION_ID = "__paywall__";
export const AUTH_SECTION_ID = "__auth__";

function isPaywallError(err: unknown): boolean {
  const e = err as {
    status?: number;
    code?: string;
    payload?: { error?: { code?: string } };
  } | null;
  return Boolean(
    e && (e.status === 402 || e.code === "PAYWALL" || e.payload?.error?.code === "PAYWALL"),
  );
}

function paywallIssues(): GenerationIssue[] {
  return [{
    sectionId: PAYWALL_SECTION_ID,
    sectionName: "Out of document credits",
    reason: "You've used all your document credits for this month. Update your subscription to keep using TED.",
    attempts: 0,
  }];
}

function isAuthError(err: unknown): boolean {
  const e = err as {
    status?: number;
    code?: string;
    payload?: { error?: { code?: string } };
  } | null;
  return Boolean(
    e &&
      (e.status === 401 ||
        e.code === "UNAUTHENTICATED" ||
        e.code === "INVALID_TOKEN" ||
        e.payload?.error?.code === "UNAUTHENTICATED" ||
        e.payload?.error?.code === "INVALID_TOKEN"),
  );
}

function authIssues(): GenerationIssue[] {
  return [{
    sectionId: AUTH_SECTION_ID,
    sectionName: "Sign in again",
    reason: "Your session has expired. Sign in again, then retry this document.",
    attempts: 0,
  }];
}

export function useDocument(
  outcomeId: string,
  initialState?: WorkspaceInitialState | null,
): UseDocument {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const [state, setState] = useState<DocumentState | null>(
    () => initialState?.workspace ?? null,
  );
  const [loading, setLoading] = useState(() => !initialState?.workspace);
  const [drafting, setDrafting] = useState(false);
  const [syncStatus, setSyncStatus] = useState<WorkspaceSyncStatus>(() =>
    initialState?.truth.persistence === "persisted"
      ? "saved"
      : userId
        ? "idle"
        : "local_only",
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(
    () => initialState?.truth.persistedAt ?? null,
  );
  const [generationIssues, setGenerationIssues] = useState<GenerationIssue[]>([]);
  const [regeneratingSectionId, setRegeneratingSectionId] = useState<string | null>(null);
  const [missingInfo, setMissingInfo] = useState<
    Array<{ key: string; label: string; missing: string[] }>
  >([]);
  const [unresolvedPlaceholders, setUnresolvedPlaceholders] = useState<
    DocumentPlaceholderMetadata[]
  >(() => initialState?.workspace?.unresolvedPlaceholders ?? []);
  const [approving, setApproving] = useState(false);

  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveRevisionRef = useRef(0);
  const failedSnapshotRef = useRef<DocumentState | null>(null);
  const pendingRef = useRef<PendingOutcome | null>(pendingFromInitialState(initialState));
  const generationRequestIdRef = useRef<string>(crypto.randomUUID());
  const captured = initialState?.truth.ledgerBindingStatus === "captured";
  const capturedIdentityRef = useRef<CapturedIdentity | null>(
    captured &&
      initialState?.truth.operationId &&
      initialState.truth.operationRevision &&
      initialState.truth.currentRevision
      ? {
          operationId: initialState.truth.operationId,
          operationRevision: initialState.truth.operationRevision,
          documentRevision: initialState.truth.currentRevision,
          approvedRevision: initialState.truth.approvedRevision,
        }
      : null,
  );
  const capturedSavedSectionsRef = useRef<Map<string, CapturedSavedSection>>(
    new Map(
      (captured ? initialState?.workspace?.sections ?? [] : []).flatMap(
        (rawSection) => {
          const section = rawSection as CapturedSectionClient;
          const key = capturedSectionKey(section);
          const revision = section.revision;
          return key && typeof revision === "number"
            ? [[key, {
                content: section.content,
                revision,
                state: section.section_state,
              }] as const]
            : [];
        },
      ),
    ),
  );
  const capturedExportRequestsRef = useRef(
    new Map<string, CapturedExportRequestResult>(),
  );

  useEffect(() => {
    setSyncStatus(
      userId
        ? initialState?.truth.persistence === "persisted"
          ? "saved"
          : "idle"
        : "local_only",
    );
    if (!userId) {
      failedSnapshotRef.current = null;
      setLastSyncedAt(null);
    }
  }, [initialState?.truth.persistence, userId]);

  const persistCapturedSnapshot = useCallback(
    async (snapshot: DocumentState, sanitisedSections: CapturedSectionClient[]) => {
      const identity = capturedIdentityRef.current;
      if (!captured || !userId || !identity) {
        throw new Error("CAPTURED_OPERATION_IDENTITY_UNAVAILABLE");
      }
      if (snapshot.documentId !== initialState?.truth.documentId) {
        throw new Error("CAPTURED_DOCUMENT_IDENTITY_MISMATCH");
      }

      const updatedMetadata = new Map<
        string,
        { revision: number; state: CapturedSectionClient["section_state"] }
      >();
      for (const section of sanitisedSections) {
        const sectionKey = capturedSectionKey(section);
        if (!sectionKey) {
          throw new Error("CAPTURED_SECTION_KEY_UNAVAILABLE");
        }
        const saved = capturedSavedSectionsRef.current.get(sectionKey);
        if (!saved) {
          throw new Error("CAPTURED_SECTION_REVISION_UNAVAILABLE");
        }
        let sectionState = capturedEditableState(section);
        if (
          sectionState === "omitted_optional" &&
          !isVisiblyEmpty(section.content)
        ) {
          sectionState = "final";
        }
        if (
          sectionState === "interactive_placeholder" &&
          !section.content.includes("{{TED_PLACEHOLDER:")
        ) {
          sectionState = "final";
        }
        if (section.content === saved.content && sectionState === saved.state) {
          continue;
        }

        const result = await editCapturedDocumentSection({
          operationId: identity.operationId,
          expectedOperationRevision: identity.operationRevision,
          documentId: snapshot.documentId,
          expectedDocumentRevision: identity.documentRevision,
          sectionKey,
          expectedSectionRevision: saved.revision,
          content: section.content,
          sectionState,
        });
        identity.operationRevision = result.operation_revision;
        identity.documentRevision = result.document_revision;
        identity.approvedRevision = null;
        capturedSavedSectionsRef.current.set(sectionKey, {
          content: section.content,
          revision: result.section_revision,
          state: sectionState,
        });
        updatedMetadata.set(sectionKey, {
          revision: result.section_revision,
          state: sectionState,
        });
      }

      if (updatedMetadata.size > 0) {
        setState((current) => current
          ? {
              ...current,
              status: "edited",
              sections: current.sections.map((rawSection) => {
                const section = rawSection as CapturedSectionClient;
                const key = capturedSectionKey(section);
                const metadata = key ? updatedMetadata.get(key) : undefined;
                return metadata
                  ? {
                      ...section,
                      revision: metadata.revision,
                      section_state: metadata.state,
                      status: "edited" as const,
                    }
                  : section;
              }),
            }
          : current);
      }
    },
    [captured, initialState?.truth.documentId, userId],
  );

  const persistRemote = useCallback(
    (snapshot: DocumentState, revision: number): Promise<boolean> => {
      if (!userId) return Promise.resolve(false);
      setSyncStatus("saving");

      const run = async () => {
        const sanitised = snapshot.sections.map((section) => ({
          ...section,
          user_id: userId,
          content: sanitiseSectionContent(section.content),
        }));

        try {
          if (captured) {
            await persistCapturedSnapshot(snapshot, sanitised);
          } else {
            await upsertDocument({
              id: snapshot.documentId,
              user_id: userId,
              outcome_id: outcomeId,
              title: snapshot.title,
              status: snapshot.status as DocumentStatus,
              template_id: snapshot.templateId ?? undefined,
              unresolved_placeholders: snapshot.unresolvedPlaceholders,
            });
            await upsertSections(sanitised);
          }

          if (revision === saveRevisionRef.current) {
            failedSnapshotRef.current = null;
            setLastSyncedAt(new Date().toISOString());
            setSyncStatus("saved");
          }
          return true;
        } catch {
          if (revision === saveRevisionRef.current) {
            failedSnapshotRef.current = snapshot;
            setSyncStatus("failed");
          }
          return false;
        }
      };

      const completion = saveQueueRef.current
        .catch(() => undefined)
        .then(run);
      saveQueueRef.current = completion.then(() => undefined);
      return completion;
    },
    [captured, outcomeId, persistCapturedSnapshot, userId],
  );

  const retrySync = useCallback(() => {
    const snapshot = failedSnapshotRef.current ?? state;
    if (!snapshot || !userId) return;
    const revision = ++saveRevisionRef.current;
    persistRemote(snapshot, revision);
  }, [persistRemote, state, userId]);

  const approveDocument = useCallback(async (): Promise<boolean> => {
    const identity = capturedIdentityRef.current;
    if (!captured || !state || !identity || approving) return false;
    setApproving(true);
    const revision = ++saveRevisionRef.current;
    try {
      const persisted = await persistRemote(state, revision);
      if (!persisted) return false;
      const currentIdentity = capturedIdentityRef.current;
      if (!currentIdentity) return false;
      const result = await approveCapturedDocumentRevision({
        operationId: currentIdentity.operationId,
        expectedOperationRevision: currentIdentity.operationRevision,
        documentId: state.documentId,
        expectedDocumentRevision: currentIdentity.documentRevision,
      });
      currentIdentity.operationRevision = result.operation_revision;
      currentIdentity.approvedRevision = result.document_revision;
      setState((current) => current
        ? {
            ...current,
            status: "approved",
            sections: current.sections.map((section) => ({
              ...section,
              status: "approved" as const,
            })),
          }
        : current);
      failedSnapshotRef.current = null;
      setLastSyncedAt(new Date().toISOString());
      setSyncStatus("saved");
      return true;
    } catch {
      failedSnapshotRef.current = state;
      setSyncStatus("failed");
      return false;
    } finally {
      setApproving(false);
    }
  }, [approving, captured, persistRemote, state]);

  const requestCapturedExport = useCallback(
    async (
      format: "pdf" | "docx" | "xlsx" | "html_preview",
    ): Promise<CapturedExportRequestResult | null> => {
      const identity = capturedIdentityRef.current;
      if (
        !captured ||
        !state ||
        !identity ||
        identity.approvedRevision !== identity.documentRevision
      ) {
        return null;
      }
      const cacheKey = `${identity.documentRevision}:${format}`;
      const existing = capturedExportRequestsRef.current.get(cacheKey);
      if (existing) return existing;
      const result = await requestCapturedDocumentExport({
        operationId: identity.operationId,
        expectedOperationRevision: identity.operationRevision,
        documentId: state.documentId,
        approvedDocumentRevision: identity.documentRevision,
        format,
        idempotencyKey: crypto.randomUUID(),
      });
      identity.operationRevision = result.operation_revision;
      capturedExportRequestsRef.current.set(cacheKey, result);
      return result;
    },
    [captured, state],
  );

  const retryGenerationSection = useCallback(async (sectionId: string) => {
    if (captured) {
      setGenerationIssues((current) => current.map((issue) =>
        issue.sectionId === sectionId
          ? {
              ...issue,
              reason:
                "This captured revision cannot use the legacy regenerate path. Edit the wording directly while the scoped repair route is unavailable.",
            }
          : issue
      ));
      return;
    }
    if (!state || regeneratingSectionId) return;
    const target = state.sections.find((section) => section.id === sectionId);
    if (!target) return;

    setRegeneratingSectionId(sectionId);
    setDrafting(true);
    let accepted = false;
    try {
      await streamInitialDraft({
        outcomeId,
        state: { ...state, sections: [target], generated: false },
        pending: pendingRef.current,
        generationRequestId: generationRequestIdRef.current,
        onSection: (event) => {
          setState((previous) => {
            if (!previous) return previous;
            const next = applyGeneratedSection(previous, event);
            if (next !== previous) accepted = true;
            return next;
          });
        },
        onMissingInfo: (event) => setMissingInfo(event.sections),
        onUnresolvedPlaceholders: (event) => {
          setUnresolvedPlaceholders(event.placeholders);
          setState((previous) => previous
            ? { ...previous, unresolvedPlaceholders: event.placeholders }
            : previous);
        },
      });

      setGenerationIssues((current) => {
        if (accepted) return current.filter((issue) => issue.sectionId !== sectionId);
        return current.map((issue) => issue.sectionId === sectionId
          ? {
              ...issue,
              attempts: issue.attempts + 1,
              reason: issue.attempts >= 1
                ? "TED still could not produce safe final wording. Add more detail or write this section manually."
                : "TED could not safely regenerate this section. Try once more or edit it manually.",
            }
          : issue);
      });
    } catch (err) {
      if (isPaywallError(err)) {
        setGenerationIssues(paywallIssues());
      } else if (isAuthError(err)) {
        setGenerationIssues(authIssues());
      } else {
        setGenerationIssues((current) => current.map((issue) => issue.sectionId === sectionId
          ? { ...issue, attempts: issue.attempts + 1, reason: "Regeneration failed. Your existing document was not changed." }
          : issue));
      }
    } finally {
      setDrafting(false);
      setRegeneratingSectionId(null);
    }
  }, [captured, outcomeId, regeneratingSectionId, state]);

  useEffect(() => {
    if (authLoading) return;
    if (
      initialState?.truth.persistence === "persisted" &&
      initialState.workspace
    ) {
      pendingRef.current = pendingFromInitialState(initialState);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const generationController = new AbortController();

    async function generateDraft(target: DocumentState, pending: PendingOutcome | null): Promise<void> {
      if (!shouldGenerateInitialDraft(target, pending)) {
        if (!cancelled) {
          const next = applyRequiredSectionFallbacks(target);
          setUnresolvedPlaceholders(next.unresolvedPlaceholders ?? []);
          setGenerationIssues(missingRequiredSections(next.sections));
          if (next !== target) {
            setState(next);
            saveWorkspace(storedFromState(outcomeId, next));
          }
        }
        return;
      }
      if (!cancelled) setDrafting(true);
      try {
        await streamInitialDraft({
          outcomeId,
          state: target,
          pending,
          generationRequestId: generationRequestIdRef.current,
          signal: generationController.signal,
          onMissingInfo: (event) => {
            if (!cancelled) setMissingInfo(event.sections);
          },
          onUnresolvedPlaceholders: (event) => {
            if (cancelled) return;
            setUnresolvedPlaceholders(event.placeholders);
            setState((previous) => {
              if (!previous) return previous;
              const next = {
                ...previous,
                unresolvedPlaceholders: event.placeholders,
              };
              saveWorkspace(storedFromState(outcomeId, next));
              return next;
            });
          },
          onSection: (event) => {
            if (cancelled) return;
            setState((previous) => {
              if (!previous) return previous;
              const next = applyGeneratedSection(previous, event);
              saveWorkspace(storedFromState(outcomeId, next));
              return next;
            });
          },
          onDraftSection: (event) => {
            if (cancelled) return;
            setState((previous) => {
              if (!previous) return previous;
              const next = applyGeneratedSection(previous, event);
              saveWorkspace(storedFromState(outcomeId, next));
              return next;
            });
          },
        });
        if (!cancelled) {
          setState((previous) => {
            if (!previous) return previous;
            const next = applyRequiredSectionFallbacks(previous);
            setUnresolvedPlaceholders(next.unresolvedPlaceholders ?? []);
            const issues = missingRequiredSections(next.sections);
            setGenerationIssues(issues);
            saveWorkspace(storedFromState(outcomeId, next));
            return next;
          });
        }
      } catch (err) {
        if (!cancelled) {
          if (isPaywallError(err)) {
            setGenerationIssues(paywallIssues());
          } else if (isAuthError(err)) {
            setGenerationIssues(authIssues());
          } else {
            setState((previous) => {
              if (!previous) {
                setGenerationIssues(missingRequiredSections(target.sections));
                return previous;
              }
              const next = applyRequiredSectionFallbacks(previous);
              setUnresolvedPlaceholders(next.unresolvedPlaceholders ?? []);
              setGenerationIssues(missingRequiredSections(next.sections));
              saveWorkspace(storedFromState(outcomeId, next));
              return next;
            });
          }
        }
      } finally {
        if (!cancelled) setDrafting(false);
      }
    }

    async function load() {
      generationRequestIdRef.current = crypto.randomUUID();
      let pending = loadPendingOutcome(outcomeId);
      let savedOutcome: Outcome | null = null;

      if (userId) {
        savedOutcome = await fetchOutcome(outcomeId);
        if (!pending) {
          pending = pendingFromOutcome(savedOutcome);
          if (pending) savePendingOutcome(outcomeId, pending);
        }
      }
      pendingRef.current = pending;

      const defaults = pendingDefaults(pending);
      const savedSituation = savedOutcome?.situation_text ?? pending?.situation ?? "";

      if (userId) {
        const dbDoc = await fetchDocumentByOutcomeId(outcomeId, userId);
        if (dbDoc && !cancelled) {
          const sections = await fetchSections(dbDoc.id);
          if (!cancelled) {
            const cached = loadWorkspace(outcomeId);
            const workspace: StoredWorkspace = {
              documentId: dbDoc.id,
              outcomeId,
              title: dbDoc.title,
              situation: savedSituation || cached?.situation || "",
              status: dbDoc.status,
              sections,
              generated: sections.some((section) => section.content.trim().length > 0),
              templateId: dbDoc.template_id ?? defaults.templateId ?? undefined,
              conversationContext: defaults.conversationContext || cached?.conversationContext || "",
              uploadContext: defaults.uploadContext || cached?.uploadContext || "",
              unresolvedPlaceholders:
                dbDoc.unresolved_placeholders ??
                cached?.unresolvedPlaceholders ??
                [],
            };
            const nextState = stateFromStored(workspace, defaults);
            const guardedState = applyRequiredSectionFallbacks(nextState);
            setUnresolvedPlaceholders(guardedState.unresolvedPlaceholders ?? []);
            saveWorkspace(storedFromState(outcomeId, guardedState));
            setState(guardedState);
            setSyncStatus("saved");
            setLastSyncedAt(new Date().toISOString());
            await generateDraft(nextState, pending);
            if (!cancelled) setLoading(false);
            return;
          }
        }
      }

      const cached = loadWorkspace(outcomeId);
      if (cached && !cancelled) {
        const nextState = stateFromStored(
          { ...cached, situation: cached.situation || savedSituation },
          defaults,
        );
        const guardedState = applyRequiredSectionFallbacks(nextState);
        setUnresolvedPlaceholders(guardedState.unresolvedPlaceholders ?? []);
        saveWorkspace(storedFromState(outcomeId, guardedState));
        setState(guardedState);
        if (!userId) setSyncStatus("local_only");
        await generateDraft(nextState, pending);
        if (!cancelled) setLoading(false);
        return;
      }

      if (!cancelled) {
        const { buildSeedDocument } = await import("@prompted/shared/workspace");
        const seed = buildSeedDocument({
          outcomeId,
          templateName: defaults.templateName,
          situation: savedSituation,
          sourceText: [defaults.uploadContext, defaults.conversationContext].filter(Boolean).join("\n\n"),
        });
        const fresh = stateFromStored(
          {
            documentId: seed.documentId,
            outcomeId,
            title: seed.title,
            situation: savedSituation,
            status: "draft",
            sections: seed.sections,
            generated: false,
            templateId: defaults.templateId ?? undefined,
            conversationContext: defaults.conversationContext,
            uploadContext: defaults.uploadContext,
            unresolvedPlaceholders: [],
          },
          defaults,
        );
        saveWorkspace(storedFromState(outcomeId, fresh));
        setState(fresh);
        if (!userId) setSyncStatus("local_only");
        await generateDraft(fresh, pending);
      }

      if (!cancelled) setLoading(false);
    }

    void load().catch(() => {
      if (!cancelled) {
        setLoading(false);
        if (userId) setSyncStatus("failed");
      }
    });
    return () => {
      cancelled = true;
      generationController.abort();
    };
  }, [authLoading, initialState, outcomeId, userId]);

  useAutosave(
    state,
    (snapshot) => {
      if (!snapshot) return;
      saveWorkspace(storedFromState(outcomeId, snapshot));
      if (!userId) {
        setSyncStatus("local_only");
        return;
      }
      const revision = ++saveRevisionRef.current;
      persistRemote(snapshot, revision);
    },
    500,
  );

  const setCanonicalUnresolvedPlaceholders = useCallback(
    (
      next:
        | DocumentPlaceholderMetadata[]
        | ((prev: DocumentPlaceholderMetadata[]) => DocumentPlaceholderMetadata[]),
    ) => {
      setUnresolvedPlaceholders((previous) => {
        const resolved = typeof next === "function" ? next(previous) : next;
        setState((current) =>
          current ? { ...current, unresolvedPlaceholders: resolved } : current
        );
        return resolved;
      });
    },
    [],
  );

  const setSections = useCallback(
    (next: Section[] | ((previous: Section[]) => Section[])) => {
      setState((previous) => {
        if (!previous) return previous;
        const sections = typeof next === "function" ? next(previous.sections) : next;
        setGenerationIssues((issues) => issues.filter((issue) => {
          const section = sections.find((item) => item.id === issue.sectionId);
          return !section?.content.trim();
        }));
        return { ...previous, sections };
      });
    },
    [],
  );

  const setStatus = useCallback((status: string) => {
    setState((previous) => previous ? { ...previous, status } : previous);
  }, []);

  const dismissMissingInfo = useCallback((sectionKey: string, item?: string) => {
    setMissingInfo((previous) => previous
      .map((entry) => entry.key === sectionKey
        ? { ...entry, missing: item ? entry.missing.filter((missing) => missing !== item) : [] }
        : entry)
      .filter((entry) => entry.missing.length > 0));
  }, []);

  return {
    state,
    loading,
    drafting,
    syncStatus,
    lastSyncedAt,
    retrySync,
    generationIssues,
    regeneratingSectionId,
    retryGenerationSection,
    setSections,
    setStatus,
    missingInfo,
    dismissMissingInfo,
    unresolvedPlaceholders,
    setUnresolvedPlaceholders: setCanonicalUnresolvedPlaceholders,
    captured,
    currentRevision: capturedIdentityRef.current?.documentRevision ??
      initialState?.truth.currentRevision ?? null,
    approvedRevision: capturedIdentityRef.current?.approvedRevision ??
      initialState?.truth.approvedRevision ?? null,
    operationId: capturedIdentityRef.current?.operationId ??
      initialState?.truth.operationId ?? null,
    operationRevision: capturedIdentityRef.current?.operationRevision ??
      initialState?.truth.operationRevision ?? null,
    approving,
    approveDocument,
    requestCapturedExport,
  };
}
