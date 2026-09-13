"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DocumentPlaceholderMetadata,
  DocumentStatus,
  Outcome,
  Section,
} from "@prompted/shared/browser";
import { isVisiblyEmpty } from "@prompted/shared/browser";
import { ApiError } from "@prompted/shared/api-client";
import { applyContentEdit } from "@prompted/shared/workspace-sections";
import { reviewWorkspaceRecovery, type WorkspaceRecoveryReview } from "@/lib/workspace-recovery";
import {
  currentWorkspaceCacheScope,
  loadPendingOutcome,
  loadWorkspace,
  discardReviewedWorkspace,
  advanceCapturedExportIntentSequenceForNewExport,
  type PendingOutcome,
  resolveGenerationRequestIdentity,
  resolveCapturedExportIntentSequence,
  savePendingOutcome,
  saveWorkspace,
  type WorkspaceDeviceSaveStatus,
  type StoredWorkspace,
  type WorkspaceCacheScope,
  type WorkspaceDocumentState,
} from "@/lib/workspace-store";
import {
  applyGeneratedResult,
  applyRequiredSectionFallbacks,
  mergeGenerationMissingInfo,
  type DocumentGenerationResult,
  pendingDefaults,
  sectionsNeedingInitialGeneration,
  shouldGenerateInitialDraft,
  stateFromStored,
  storedFromState,
  streamInitialDraft,
} from "@/lib/document-generation";
import {
  canonicalJsonFingerprint,
  LegacyWorkspaceSaveError,
  fetchDocumentByOutcomeId,
  saveLegacyWorkspaceV1,
  type LegacyWorkspaceDocumentState,
  type LegacyWorkspaceSaveReceiptV1,
  type SaveLegacyWorkspaceV1Input,
} from "@/lib/api/documents";
import { fetchOutcome } from "@/lib/api/outcomes";
import {
  fetchSections,
  fetchWorkspaceSectionBody,
  type LegacySectionApplyResult,
  type LegacySectionMutationTruth,
  type PersistedSection,
  sha256Text,
} from "@/lib/api/sections";
import {
  approveCapturedDocumentRevision,
  type CapturedExportRequestResult,
  editCapturedDocumentSection,
  requestCapturedDocumentExport,
} from "@/lib/api/captured-document-operations";
import { sanitiseSectionContent } from "@/lib/sanitise";
import { generationLimitNotice } from "@/lib/document-limit";
import { useAuth } from "@/components/providers";
import { useAutosave } from "./useAutosave";
import {
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
  type OwnerDispatchLease,
} from "@/lib/browser-principal-state";
import {
  WORKSPACE_SNAPSHOT_VERSION,
  isWorkspaceSectionContentLoaded,
  workspaceSectionMetadata,
  materialiseWorkspaceSectionBody,
  type WorkspaceInitialState,
  type WorkspaceSectionBodyV1,
} from "@/lib/workspace-initial-state";

export type DocumentState = WorkspaceDocumentState;
export type WorkspaceSyncStatus = "local_only" | "idle" | "saving" | "saved" | "failed";

export interface GenerationIssue {
  sectionId: string;
  sectionName: string;
  reason: string;
  attempts: number;
  retryable?: boolean;
}

export interface UseDocument {
  browserRecovery: WorkspaceRecoveryReview | null;
  restoreBrowserRecovery: () => Promise<boolean>;
  discardBrowserRecovery: () => boolean;
  cancelBrowserRecovery: () => void;
  state: DocumentState | null;
  loading: boolean;
  drafting: boolean;
  syncStatus: WorkspaceSyncStatus;
  deviceSaveStatus?: WorkspaceDeviceSaveStatus;
  lastSyncedAt: string | null;
  retrySync: () => void;
  generationIssues: GenerationIssue[];
  regeneratingSectionId: string | null;
  retryGenerationSection: (sectionId: string) => Promise<void>;
  setSections: (next: Section[] | ((prev: Section[]) => Section[])) => void;
  registerWorkspaceSectionBody: (body: WorkspaceSectionBodyV1) => boolean;
  markWorkspaceReadUnavailable: () => void;
  mergePersistedLegacyApply: (result: LegacySectionApplyResult) => void;
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
    requestContext: OwnerDispatchLease,
  ) => Promise<CapturedExportRequestResult | null>;
  rememberCapturedExportDelivery: (
    format: "pdf" | "docx" | "xlsx" | "html_preview",
    exportId: string,
  ) => boolean;
  createUpdatedCapturedExport: (
    format: "pdf" | "docx" | "xlsx" | "html_preview",
    exportId: string,
  ) => boolean;
  exportEligible: boolean;
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

interface LegacySavedSection {
  contentLoaded: boolean;
  content?: string;
  contentSha256: string;
  name: string;
  orderIndex: number;
  status: Section["status"];
  isRequired: boolean;
  revision: number;
  approvedRevision: number | null;
}

interface LegacySavedDocument {
  ownerUserId: string;
  outcomeId: string;
  documentId: string;
  title: string;
  status: DocumentStatus;
  templateId: string | null;
  unresolvedPlaceholders: DocumentPlaceholderMetadata[];
  revision: number;
  approvedRevision: number | null;
}

interface PendingLegacyWorkspaceCommand {
  ownerUserId: string;
  desiredFingerprint: string;
  request: SaveLegacyWorkspaceV1Input;
}

/** Initial hydration is different: the fetched rows are authoritative for
 * content, status, history, and revision, not merely metadata. */
function mergeHydratedSections(
  current: Section[],
  persistedSections: PersistedSection[],
): Section[] {
  const currentById = new Map(current.map((section) => [section.id, section]));
  return persistedSections.map((persisted) => {
    const existing = currentById.get(persisted.id);
    return {
      ...existing,
      ...persisted,
      key: existing?.key ?? persisted.section_key ?? undefined,
    } as Section;
  });
}

function clonePlaceholders(
  value: DocumentPlaceholderMetadata[] | undefined,
): DocumentPlaceholderMetadata[] {
  return (value ?? []).map((placeholder) => ({
    ...placeholder,
    neutralReplacementOptions: placeholder.neutralReplacementOptions.map((option) => ({
      ...option,
    })),
  }));
}

function placeholderFingerprint(value: DocumentPlaceholderMetadata[] | undefined): string {
  return canonicalJsonFingerprint(value ?? []);
}

function laterIsoTimestamp(current: string | null, candidate: string): string {
  if (!current) return candidate;
  return Date.parse(candidate) > Date.parse(current) ? candidate : current;
}

function isDocumentStatus(value: string): value is DocumentStatus {
  return ["draft", "edited", "approved", "exported", "archived"].includes(value);
}

function requiredDocumentStatus(value: string): DocumentStatus {
  if (!isDocumentStatus(value)) throw new Error("LEGACY_DOCUMENT_STATUS_INVALID");
  return value;
}

function legacyTemplateId(value: string | null | undefined): string | null {
  const candidate = value?.trim() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    candidate,
  )
    ? candidate.toLowerCase()
    : null;
}

function legacySavedSectionFromSnapshot(section: PersistedSection): LegacySavedSection | null {
  const metadata = workspaceSectionMetadata(section);
  if (!metadata || metadata.ledgerBindingStatus !== "legacy_unversioned") return null;
  return {
    contentLoaded: metadata.contentLoaded,
    ...(metadata.contentLoaded ? { content: section.content } : {}),
    contentSha256: metadata.contentSha256,
    name: section.name,
    orderIndex: section.order_index,
    status: section.status,
    isRequired: section.is_required,
    revision: metadata.revision,
    approvedRevision: metadata.approvedRevision,
  };
}

async function legacySavedSectionFromFullRow(
  section: PersistedSection,
): Promise<LegacySavedSection | null> {
  const snapshot = legacySavedSectionFromSnapshot(section);
  if (snapshot) return snapshot;
  return typeof section.revision === "number" && section.revision > 0
    ? {
        contentLoaded: true,
        content: section.content,
        contentSha256: await sha256Text(section.content),
        name: section.name,
        orderIndex: section.order_index,
        status: section.status,
        isRequired: section.is_required,
        revision: section.revision,
        approvedRevision: section.approved_revision ?? null,
      }
    : null;
}

function legacyDocumentState(
  title: string,
  status: string,
  templateId: string | null | undefined,
  unresolvedPlaceholders: DocumentPlaceholderMetadata[] | undefined,
): LegacyWorkspaceDocumentState {
  return {
    title,
    status: requiredDocumentStatus(status),
    template_id: legacyTemplateId(templateId),
    unresolved_placeholders: clonePlaceholders(unresolvedPlaceholders),
  };
}

function legacyDesiredFingerprint(snapshot: DocumentState): string {
  return canonicalJsonFingerprint({
    document: legacyDocumentState(
      snapshot.title,
      snapshot.status,
      snapshot.templateId,
      snapshot.unresolvedPlaceholders,
    ),
    sections: snapshot.sections.map((section, orderIndex) => {
      const metadata = workspaceSectionMetadata(section);
      return {
        id: section.id,
        name: section.name,
        order_index: orderIndex,
        status: section.status,
        is_required: section.is_required,
        ...(isWorkspaceSectionContentLoaded(section)
          ? { content: sanitiseSectionContent(section.content) }
          : { content_sha256: metadata?.contentSha256 ?? null }),
      };
    }),
  });
}

async function buildLegacyWorkspaceSaveRequest(input: {
  snapshot: DocumentState;
  outcomeId: string;
  cacheScope: WorkspaceCacheScope;
  savedDocument: LegacySavedDocument | null;
  savedSections: Map<string, LegacySavedSection>;
}): Promise<PendingLegacyWorkspaceCommand | null> {
  const desiredDocument = legacyDocumentState(
    input.snapshot.title,
    input.snapshot.status,
    input.snapshot.templateId,
    input.snapshot.unresolvedPlaceholders,
  );
  const expectedDocument: LegacyWorkspaceDocumentState | null = input.savedDocument
    ? {
        title: input.savedDocument.title,
        status: input.savedDocument.status,
        template_id: input.savedDocument.templateId,
        unresolved_placeholders: clonePlaceholders(input.savedDocument.unresolvedPlaceholders),
      }
    : null;
  let changed =
    input.savedDocument === null ||
    expectedDocument?.title !== desiredDocument.title ||
    expectedDocument?.status !== desiredDocument.status ||
    expectedDocument?.template_id !== desiredDocument.template_id ||
    placeholderFingerprint(expectedDocument?.unresolved_placeholders) !==
      placeholderFingerprint(desiredDocument.unresolved_placeholders);

  const sections = input.snapshot.sections.map((section, orderIndex) => {
    const saved = input.savedSections.get(section.id);
    const contentLoaded = isWorkspaceSectionContentLoaded(section);
    const desired = {
      name: section.name,
      order_index: orderIndex,
      status: section.status,
      is_required: section.is_required,
    };
    if (!saved) {
      if (!contentLoaded) throw new Error("LEGACY_NEW_SECTION_BODY_UNAVAILABLE");
      changed = true;
      return {
        id: section.id,
        expected: null,
        desired,
        content: sanitiseSectionContent(section.content),
      };
    }

    const expected = {
      revision: saved.revision,
      content_sha256: saved.contentSha256,
      name: saved.name,
      order_index: saved.orderIndex,
      status: saved.status,
      is_required: saved.isRequired,
    };
    const metadataChanged =
      desired.name !== saved.name ||
      desired.order_index !== saved.orderIndex ||
      desired.status !== saved.status ||
      desired.is_required !== saved.isRequired;
    if (contentLoaded) {
      if (!saved.contentLoaded || saved.content === undefined) {
        throw new Error("LEGACY_SECTION_BASELINE_CONTENT_UNAVAILABLE");
      }
      const content = sanitiseSectionContent(section.content);
      if (content !== saved.content) {
        changed = true;
        if (metadataChanged) changed = true;
        return { id: section.id, expected, desired, content };
      }
    }
    if (metadataChanged) changed = true;
    return { id: section.id, expected, desired };
  });

  const desiredSectionIds = new Set(input.snapshot.sections.map((section) => section.id));
  if (
    desiredSectionIds.size !== input.snapshot.sections.length ||
    (input.savedDocument &&
      [...input.savedSections.keys()].some((sectionId) => !desiredSectionIds.has(sectionId)))
  ) {
    throw new Error("LEGACY_SECTION_ROSTER_INCOMPLETE");
  }
  if (!changed) return null;

  const commandWithoutKey = {
    outcomeId: input.outcomeId,
    documentId: input.snapshot.documentId,
    expectedDocumentRevision: input.savedDocument?.revision ?? 0,
    expectedDocument,
    document: desiredDocument,
    sections,
  };
  const idempotencyKey = await resolveGenerationRequestIdentity(
    input.cacheScope,
    input.outcomeId,
    `legacy-workspace-save:${input.snapshot.documentId}`,
    {
      contractVersion: "legacy-workspace-save.v1",
      ...commandWithoutKey,
    },
  );
  return {
    ownerUserId: input.cacheScope.kind === "user" ? input.cacheScope.userId : "",
    desiredFingerprint: legacyDesiredFingerprint(input.snapshot),
    request: { idempotencyKey, ...commandWithoutKey },
  };
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
  const intake = initialState?.intake;
  if (intake) {
    return {
      situation: intake.situation,
      templateName: intake.templateName,
      templateId: intake.templateId ?? undefined,
      conversationContext: intake.conversationContext,
      uploadContext: intake.uploadContext,
      uploadId: intake.uploadId ?? undefined,
    };
  }
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
    .filter(
      (section) =>
        isWorkspaceSectionContentLoaded(section) &&
        section.is_required !== false &&
        isVisiblyEmpty(section.content),
    )
    .map((section) => ({
      sectionId: section.id,
      sectionName: section.name,
      reason: "TED did not produce safe final wording for this section.",
      attempts: 0,
    }));
}

function generationFailure(section: Section, error: unknown, attempts = 0): GenerationIssue {
  const code =
    typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (code === "DOCUMENT_GENERATION_SAVE_REQUIRED") {
    return {
      sectionId: section.id,
      sectionName: section.name,
      attempts,
      retryable: true,
      reason:
        "Your document could not be saved, so TED has not started. Retry saving or reload the workspace before continuing.",
    };
  }
  if (code === "DOCUMENT_GENERATION_SCOPE_INVALID" || code === "DOCUMENT_DESIGN_MAPPING_REQUIRED") {
    return {
      sectionId: section.id,
      sectionName: section.name,
      attempts,
      retryable: false,
      reason:
        "TED could not safely attach the returned wording to this document's sections. Regeneration is paused. You can edit the existing wording directly.",
    };
  }
  if (code === "DOCUMENT_GENERATION_STALE_RESULT") {
    return {
      sectionId: section.id,
      sectionName: section.name,
      attempts,
      retryable: false,
      reason:
        "Your document changed while TED was drafting. Your newer wording is preserved, and the earlier result has not been applied.",
    };
  }
  const reconciliationRequired =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "GENERATION_RECONCILIATION_REQUIRED";
  return {
    sectionId: section.id,
    sectionName: section.name,
    attempts,
    retryable: !reconciliationRequired,
    reason: reconciliationRequired
      ? "TED could not confirm whether the previous generation finished. New generation is paused for this section. You can still edit its wording."
      : "Generation did not complete. Try this section again, or edit its wording.",
  };
}

export const PAYWALL_SECTION_ID = "__paywall__";
export const DOCUMENT_LIMIT_SECTION_ID = "__document_limit__";
export const AUTH_SECTION_ID = "__auth__";

function documentLimitIssue(err: unknown): GenerationIssue | null {
  const notice = generationLimitNotice(err);
  if (!notice) return null;
  return {
    sectionId: notice.action === "review_account" ? PAYWALL_SECTION_ID : DOCUMENT_LIMIT_SECTION_ID,
    sectionName: notice.heading,
    reason: notice.reason,
    attempts: 0,
    retryable: false,
  };
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
  return [
    {
      sectionId: AUTH_SECTION_ID,
      sectionName: "Sign in again",
      reason: "Your session has expired. Sign in again, then retry this document.",
      attempts: 0,
    },
  ];
}

export function useDocument(
  outcomeId: string,
  initialState?: WorkspaceInitialState | null,
): UseDocument {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const initialOwnerUserId = initialState?.truth.ownerUserId ?? null;
  const ownerMismatch = Boolean(
    initialState?.truth.authenticated &&
    (!initialOwnerUserId || !userId || userId !== initialOwnerUserId),
  );
  const cacheScope = useMemo<WorkspaceCacheScope | null>(
    () =>
      userId
        ? currentWorkspaceCacheScope(userId)
        : initialState?.truth.authenticated
          ? null
          : currentWorkspaceCacheScope(),
    [initialState?.truth.authenticated, userId],
  );
  const ownerEpoch = cacheScope
    ? cacheScope.kind === "user"
      ? `user:${cacheScope.userId}`
      : `guest:${cacheScope.guestId}`
    : "owner-unavailable";
  // Only an untouched initial draft can resume from this compatibility path.
  // A required blank in a later owner-edited revision is not generation intent.
  const resumesInitialLegacyGeneration = Boolean(
    initialState?.truth.persistence === "persisted" &&
    initialState.truth.ledgerBindingStatus === "legacy_unversioned" &&
    initialState.truth.snapshotVersion === WORKSPACE_SNAPSHOT_VERSION &&
    initialState.truth.currentRevision === 1 &&
    initialState.truth.approvedRevision === null &&
    initialState.workspace?.status === "draft" &&
    initialState.workspace.sections.every(
      (section) => section.status === "draft" && workspaceSectionMetadata(section)?.revision === 1,
    ) &&
    initialState.workspace?.sections.some(
      (section) =>
        section.is_required !== false && workspaceSectionMetadata(section)?.contentLength === 0,
    ),
  );
  const requiresInitialLegacyHydration =
    resumesInitialLegacyGeneration ||
    Boolean(
      initialState?.workspace &&
      initialState.truth.persistence === "persisted" &&
      initialState.truth.ledgerBindingStatus === "legacy_unversioned" &&
      initialState.truth.snapshotVersion !== WORKSPACE_SNAPSHOT_VERSION,
    );
  const [state, setState] = useState<DocumentState | null>(() => initialState?.workspace ?? null);
  // A workspace observation has one owner/outcome lifetime. Accepted saves
  // may finish after unmount, but cannot adopt receipts into a reused hook.
  const resource = useMemo(
    () => ({
      outcomeId,
      ownerEpoch,
      observing: true,
      scopedGenerationPending: false,
      generationLimitBlocked: false,
    }),
    [outcomeId, ownerEpoch],
  );
  const activeResourceRef = useRef(resource);
  activeResourceRef.current = resource;
  const activeDocumentIdRef = useRef(state?.documentId ?? null);
  activeDocumentIdRef.current = state?.documentId ?? null;
  const activeStateRef = useRef(state);
  activeStateRef.current = state;
  type RecoveryRecord = {
    resource: typeof resource;
    expectedJson: string;
    snapshot: DocumentState;
    review: WorkspaceRecoveryReview | null;
    controller: AbortController | null;
  };
  const recoveryHoldRef = useRef<RecoveryRecord | null>(null);
  const [recoveryRecord, setRecoveryRecord] = useState<RecoveryRecord | null>(null);
  const [deviceReceipt, setDeviceReceipt] = useState<{
    resource: typeof resource;
    snapshot: DocumentState;
    status: WorkspaceDeviceSaveStatus;
  } | null>(null);
  const deviceSaveStatus: WorkspaceDeviceSaveStatus =
    !ownerMismatch &&
    deviceReceipt?.resource === resource &&
    deviceReceipt.snapshot.documentId === state?.documentId &&
    (deviceReceipt.status !== "saved" || deviceReceipt.snapshot === state)
      ? deviceReceipt.status
      : "unknown";
  useEffect(() => {
    resource.observing = true;
    resource.generationLimitBlocked = false;
    setDrafting(false);
    setRegeneratingSectionId(null);
    setGenerationIssues([]);
    setMissingInfo([]);
    const pending = pendingLegacyWorkspaceCommandRef.current;
    if (pending && (pending.request.outcomeId !== outcomeId || pending.ownerUserId !== userId)) {
      pendingLegacyWorkspaceCommandRef.current = null;
    }
    return () => {
      resource.observing = false;
    };
  }, [outcomeId, resource, userId]);
  const [loading, setLoading] = useState(
    () => !initialState?.workspace || requiresInitialLegacyHydration,
  );
  const [drafting, setDrafting] = useState(false);
  const [syncStatus, setSyncStatus] = useState<WorkspaceSyncStatus>(() =>
    initialState?.truth.persistence === "persisted" ? "saved" : userId ? "idle" : "local_only",
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
  const [durableExportEligible, setDurableExportEligible] = useState(
    () => initialState?.truth.exportEligible === true,
  );
  const [legacyDocumentRevision, setLegacyDocumentRevision] = useState<number | null>(() =>
    initialState?.truth.ledgerBindingStatus === "legacy_unversioned"
      ? (initialState.truth.currentRevision ?? null)
      : null,
  );
  const [legacyApprovedRevision, setLegacyApprovedRevision] = useState<number | null>(() =>
    initialState?.truth.ledgerBindingStatus === "legacy_unversioned"
      ? (initialState.truth.approvedRevision ?? null)
      : null,
  );

  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveRevisionRef = useRef(0);
  const localMutationEpochRef = useRef(0);
  const renderedMutationEpoch = localMutationEpochRef.current;
  // Explicit persistence consumes the pending debounce without pretending a
  // new user edit occurred. Later edits still advance the local epoch and save.
  const explicitSaveEpochRef = useRef({ sequence: 0, mutationEpoch: -1 });
  const markExplicitSave = useCallback(() => {
    explicitSaveEpochRef.current = {
      sequence: explicitSaveEpochRef.current.sequence + 1,
      mutationEpoch: localMutationEpochRef.current,
    };
  }, []);
  const failedSnapshotRef = useRef<DocumentState | null>(null);
  const pendingRef = useRef<PendingOutcome | null>(
    ownerMismatch ? null : pendingFromInitialState(initialState),
  );
  const captured = !ownerMismatch && initialState?.truth.ledgerBindingStatus === "captured";
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
      (captured ? (initialState?.workspace?.sections ?? []) : []).flatMap((rawSection) => {
        const section = rawSection as CapturedSectionClient;
        const key = capturedSectionKey(section);
        const revision = section.revision;
        return isWorkspaceSectionContentLoaded(section) && key && typeof revision === "number"
          ? [
              [
                key,
                {
                  content: section.content,
                  revision,
                  state: section.section_state,
                },
              ] as const,
            ]
          : [];
      }),
    ),
  );
  const legacySavedSectionsRef = useRef<Map<string, LegacySavedSection>>(
    new Map(
      (!captured && initialState?.truth.persistence === "persisted"
        ? (initialState?.workspace?.sections ?? [])
        : []
      ).flatMap((rawSection) => {
        const saved = legacySavedSectionFromSnapshot(rawSection as PersistedSection);
        return saved ? [[rawSection.id, saved] as const] : [];
      }),
    ),
  );
  const legacySavedDocumentRef = useRef<LegacySavedDocument | null>(
    !captured &&
      initialState?.truth.persistence === "persisted" &&
      initialState.workspace &&
      typeof initialState.truth.currentRevision === "number" &&
      initialState.truth.currentRevision > 0
      ? {
          ownerUserId: userId ?? "",
          outcomeId,
          documentId: initialState.workspace.documentId,
          title: initialState.workspace.title,
          status: requiredDocumentStatus(initialState.workspace.status),
          templateId: legacyTemplateId(initialState.workspace.templateId),
          unresolvedPlaceholders: clonePlaceholders(initialState.workspace.unresolvedPlaceholders),
          revision: initialState.truth.currentRevision,
          approvedRevision: initialState.truth.approvedRevision,
        }
      : null,
  );
  const pendingLegacyWorkspaceCommandRef = useRef<PendingLegacyWorkspaceCommand | null>(null);
  const capturedExportRequestsRef = useRef(
    new Map<string, { sequence: number; result: CapturedExportRequestResult }>(),
  );

  useEffect(() => {
    capturedExportRequestsRef.current.clear();
  }, [outcomeId, ownerEpoch]);

  useEffect(() => {
    const pendingCommand = pendingLegacyWorkspaceCommandRef.current;
    if (!pendingCommand) return;
    if (!userId || pendingCommand.ownerUserId !== userId) {
      pendingLegacyWorkspaceCommandRef.current = null;
    }
  }, [ownerEpoch, userId]);

  const cacheWorkspaceSnapshot = useCallback(
    (snapshot: DocumentState) => {
      if (!cacheScope || ownerMismatch || activeResourceRef.current !== resource) return;
      if (recoveryHoldRef.current?.resource === resource) {
        // Preserve the exact copy still awaiting its owner's review.
        setDeviceReceipt({ resource, snapshot, status: "unavailable" });
        return;
      }
      let recoverySnapshot = snapshot;
      const savedDocument = legacySavedDocumentRef.current;
      if (
        !captured && cacheScope.kind === "user" &&
        savedDocument?.ownerUserId === cacheScope.userId &&
        savedDocument.outcomeId === outcomeId && savedDocument.documentId === snapshot.documentId
      ) {
        // A read body is already retained in the authoritative save baseline.
        // Include an exact matching sibling in the recovery copy without
        // promoting that read into a canonical edit or another remote write.
        const sections = snapshot.sections.map((section) => {
          if (isWorkspaceSectionContentLoaded(section)) return section;
          const metadata = workspaceSectionMetadata(section);
          const saved = legacySavedSectionsRef.current.get(section.id);
          if (
            section.document_id !== snapshot.documentId || section.user_id !== cacheScope.userId ||
            section.content !== "" || metadata?.ledgerBindingStatus !== "legacy_unversioned" ||
            !saved?.contentLoaded || typeof saved.content !== "string" ||
            saved.revision !== metadata.revision || saved.contentSha256 !== metadata.contentSha256 ||
            saved.approvedRevision !== metadata.approvedRevision ||
            new TextEncoder().encode(saved.content).length !== metadata.contentLength
          ) return section;
          return { ...section, content: saved.content, content_loaded: true };
        });
        recoverySnapshot = { ...snapshot, sections };
      }
      const result = saveWorkspace(cacheScope, storedFromState(outcomeId, recoverySnapshot));
      const status =
        result?.status === "saved"
          ? "saved"
          : result?.reason === "quota_exceeded"
            ? "quota_exceeded"
            : "unavailable";
      setDeviceReceipt({ resource, snapshot, status });
    },
    [cacheScope, captured, outcomeId, ownerMismatch, resource],
  );

  const cachePendingOutcome = useCallback(
    (pending: PendingOutcome) => {
      if (!cacheScope || ownerMismatch) return;
      savePendingOutcome(cacheScope, outcomeId, pending);
    },
    [cacheScope, outcomeId, ownerMismatch],
  );

  useEffect(() => {
    if (ownerMismatch) {
      failedSnapshotRef.current = null;
      setLastSyncedAt(null);
      setDurableExportEligible(false);
      setSyncStatus("idle");
      return;
    }
    setSyncStatus(
      userId ? (initialState?.truth.persistence === "persisted" ? "saved" : "idle") : "local_only",
    );
    if (!userId) {
      failedSnapshotRef.current = null;
      setLastSyncedAt(null);
    }
  }, [initialState?.truth.persistence, ownerMismatch, userId]);

  const mergeLegacyMutationTruth = useCallback(
    (result: LegacySectionMutationTruth, authoritativeContent: boolean) => {
      localMutationEpochRef.current += 1;
      const existingSection = legacySavedSectionsRef.current.get(result.section_id);
      if (existingSection) {
        legacySavedSectionsRef.current.set(result.section_id, {
          ...existingSection,
          contentLoaded: true,
          content: result.section_content,
          contentSha256: result.section_content_sha256,
          status: result.section_status,
          revision: result.section_revision,
          approvedRevision: result.section_approved_revision,
        });
      }
      const savedDocument = legacySavedDocumentRef.current;
      if (savedDocument) {
        savedDocument.status = requiredDocumentStatus(result.document_status);
        savedDocument.revision = result.document_revision;
        savedDocument.approvedRevision = result.document_approved_revision;
      }
      setLegacyDocumentRevision(result.document_revision);
      setLegacyApprovedRevision(result.document_approved_revision);
      setState((current) => {
        if (!current || current.documentId !== result.document_id) {
          return current;
        }
        let changed = current.status !== result.document_status;
        const sections = current.sections.map((rawSection) => {
          if (rawSection.id !== result.section_id) return rawSection;
          const section = rawSection as PersistedSection;
          const metadata = workspaceSectionMetadata(section);
          const content = authoritativeContent ? result.section_content : section.content;
          const status = authoritativeContent ? result.section_status : section.status;
          if (
            content === section.content &&
            status === section.status &&
            result.section_revision === section.revision &&
            result.section_approved_revision === (section.approved_revision ?? null) &&
            result.section_updated_at === section.updated_at
          )
            return section;
          changed = true;
          return {
            ...section,
            content,
            status,
            ...(authoritativeContent && metadata
              ? {
                  content_loaded: true,
                  content_sha256: result.section_content_sha256,
                  content_length: new TextEncoder().encode(result.section_content).length,
                }
              : {}),
            revision: result.section_revision,
            approved_revision: result.section_approved_revision,
            updated_at: result.section_updated_at,
          };
        });
        return changed ? { ...current, status: result.document_status, sections } : current;
      });
    },
    [],
  );

  const mergePersistedLegacyApply = useCallback(
    (result: LegacySectionApplyResult) => {
      mergeLegacyMutationTruth(result, true);
      failedSnapshotRef.current = null;
      setLastSyncedAt((current) => laterIsoTimestamp(current, result.document_updated_at));
      // The receipt proves this section. The rescheduled aggregate must still
      // compare siblings and metadata before the whole workspace is Saved.
      setSyncStatus("idle");
    },
    [mergeLegacyMutationTruth],
  );

  const mergeLegacyWorkspaceReceipt = useCallback(
    (command: PendingLegacyWorkspaceCommand, receipt: LegacyWorkspaceSaveReceiptV1) => {
      const receiptBySection = new Map(
        receipt.sections.map((section) => [section.sectionId, section]),
      );
      const previousBaselines = legacySavedSectionsRef.current;
      const nextBaselines = new Map(previousBaselines);
      const adoptedSectionIds = new Set<string>();
      for (const patch of command.request.sections) {
        const persisted = receiptBySection.get(patch.id);
        if (!persisted) throw new Error("LEGACY_WORKSPACE_RECEIPT_SECTION_MISSING");
        const previous = previousBaselines.get(patch.id);
        const expectedRevision = patch.expected?.revision ?? 0;
        if (previous && previous.revision > persisted.revision) {
          continue;
        }
        if (
          previous &&
          previous.revision === persisted.revision &&
          (previous.contentSha256 !== persisted.contentSha256 ||
            previous.status !== persisted.status ||
            previous.approvedRevision !== persisted.approvedRevision)
        ) {
          throw new Error("LEGACY_WORKSPACE_RECEIPT_SECTION_REGRESSION");
        }
        if (
          previous &&
          previous.revision !== expectedRevision &&
          previous.revision !== persisted.revision
        ) {
          throw new Error("LEGACY_WORKSPACE_RECEIPT_SECTION_REGRESSION");
        }
        const contentWasSent = Object.prototype.hasOwnProperty.call(patch, "content");
        nextBaselines.set(patch.id, {
          contentLoaded: contentWasSent || previous?.contentLoaded === true,
          ...(contentWasSent
            ? { content: patch.content ?? "" }
            : previous?.contentLoaded && previous.content !== undefined
              ? { content: previous.content }
              : {}),
          contentSha256: persisted.contentSha256,
          name: patch.desired.name,
          orderIndex: patch.desired.order_index,
          status: persisted.status,
          isRequired: patch.desired.is_required,
          revision: persisted.revision,
          approvedRevision: persisted.approvedRevision,
        });
        adoptedSectionIds.add(patch.id);
      }
      legacySavedSectionsRef.current = nextBaselines;
      const previousDocument = legacySavedDocumentRef.current;
      const documentAlreadyMatches =
        previousDocument?.revision === receipt.documentRevision &&
        previousDocument.status === receipt.documentStatus &&
        previousDocument.approvedRevision === receipt.documentApprovedRevision;
      const documentIsNewer =
        previousDocument !== null && previousDocument.revision > receipt.documentRevision;
      if (
        previousDocument &&
        previousDocument.revision !== command.request.expectedDocumentRevision &&
        !documentAlreadyMatches &&
        !documentIsNewer
      ) {
        throw new Error("LEGACY_WORKSPACE_RECEIPT_DOCUMENT_REGRESSION");
      }
      const adoptDocument = !documentIsNewer && !documentAlreadyMatches;
      if (adoptDocument) {
        legacySavedDocumentRef.current = {
          ownerUserId: command.ownerUserId,
          outcomeId: command.request.outcomeId,
          documentId: command.request.documentId,
          title: command.request.document.title,
          status: receipt.documentStatus,
          templateId: command.request.document.template_id,
          unresolvedPlaceholders: clonePlaceholders(
            command.request.document.unresolved_placeholders,
          ),
          revision: receipt.documentRevision,
          approvedRevision: receipt.documentApprovedRevision,
        };
        setLegacyDocumentRevision(receipt.documentRevision);
        setLegacyApprovedRevision(receipt.documentApprovedRevision);
        if (receipt.documentApprovedRevision !== receipt.documentRevision) {
          setDurableExportEligible(false);
        }
      } else if (documentIsNewer && previousDocument && command.request.expectedDocument) {
        const expected = command.request.expectedDocument;
        legacySavedDocumentRef.current = {
          ...previousDocument,
          title:
            previousDocument.title === expected.title
              ? command.request.document.title
              : previousDocument.title,
          templateId:
            previousDocument.templateId === expected.template_id
              ? command.request.document.template_id
              : previousDocument.templateId,
          unresolvedPlaceholders:
            placeholderFingerprint(previousDocument.unresolvedPlaceholders) ===
            placeholderFingerprint(expected.unresolved_placeholders)
              ? clonePlaceholders(command.request.document.unresolved_placeholders)
              : previousDocument.unresolvedPlaceholders,
        };
      }

      setState((current) => {
        if (!current || current.documentId !== command.request.documentId) return current;
        const patchBySection = new Map(command.request.sections.map((patch) => [patch.id, patch]));
        const status =
          adoptDocument && current.status === command.request.document.status
            ? receipt.documentStatus
            : current.status;
        const sections = current.sections.map((rawSection) => {
          const patch = patchBySection.get(rawSection.id);
          const persisted = receiptBySection.get(rawSection.id);
          if (!patch || !persisted || !adoptedSectionIds.has(rawSection.id)) {
            return rawSection;
          }
          const contentWasSent = Object.prototype.hasOwnProperty.call(patch, "content");
          const previous = previousBaselines.get(rawSection.id);
          const bodyMatches = contentWasSent
            ? sanitiseSectionContent(rawSection.content) === (patch.content ?? "")
            : !isWorkspaceSectionContentLoaded(rawSection) ||
              !previous?.contentLoaded ||
              previous.content === sanitiseSectionContent(rawSection.content);
          const localMatchesCommand =
            bodyMatches &&
            rawSection.name === patch.desired.name &&
            rawSection.order_index === patch.desired.order_index &&
            rawSection.status === patch.desired.status &&
            rawSection.is_required === patch.desired.is_required;
          const metadata = workspaceSectionMetadata(rawSection);
          return {
            ...rawSection,
            status: localMatchesCommand ? persisted.status : rawSection.status,
            revision: persisted.revision,
            approved_revision: localMatchesCommand ? persisted.approvedRevision : null,
            updated_at: persisted.updatedAt,
            ...(metadata
              ? {
                  content_sha256: persisted.contentSha256,
                  content_length: contentWasSent
                    ? new TextEncoder().encode(patch.content ?? "").length
                    : metadata.contentLength,
                }
              : {}),
          };
        });
        return { ...current, status, sections };
      });
    },
    [],
  );

  const persistCapturedSnapshot = useCallback(
    async (
      snapshot: DocumentState,
      sanitisedSections: CapturedSectionClient[],
      requestContext: OwnerDispatchLease,
    ) => {
      requestContext.assertCurrent();
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
        requestContext.assertCurrent();
        const sectionKey = capturedSectionKey(section);
        if (!sectionKey) {
          throw new Error("CAPTURED_SECTION_KEY_UNAVAILABLE");
        }
        const saved = capturedSavedSectionsRef.current.get(sectionKey);
        if (!saved) {
          throw new Error("CAPTURED_SECTION_REVISION_UNAVAILABLE");
        }
        let sectionState = capturedEditableState(section);
        if (sectionState === "omitted_optional" && !isVisiblyEmpty(section.content)) {
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

        const result = await editCapturedDocumentSection(
          {
            operationId: identity.operationId,
            expectedOperationRevision: identity.operationRevision,
            documentId: snapshot.documentId,
            expectedDocumentRevision: identity.documentRevision,
            sectionKey,
            expectedSectionRevision: saved.revision,
            content: section.content,
            sectionState,
          },
          requestContext,
        );
        requestContext.assertCurrent();
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
        requestContext.assertCurrent();
        setDurableExportEligible(false);
        setState((current) =>
          current
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
            : current,
        );
      }
    },
    [captured, initialState?.truth.documentId, userId],
  );

  const persistRemote = useCallback(
    (
      snapshot: DocumentState,
      revision: number,
      existingRequestContext?: OwnerDispatchLease,
    ): Promise<boolean> => {
      if (!userId || ownerMismatch) return Promise.resolve(false);
      let requestContext: OwnerDispatchLease;
      try {
        requestContext = existingRequestContext ?? captureOwnerDispatch(userId);
      } catch {
        return Promise.resolve(false);
      }
      const mutationEpoch = localMutationEpochRef.current;
      const resourceIsCurrent = () =>
        activeResourceRef.current === resource &&
        (activeDocumentIdRef.current === null ||
          activeDocumentIdRef.current === snapshot.documentId);
      const mutationIsCurrent = () =>
        resourceIsCurrent() && mutationEpoch === localMutationEpochRef.current;
      setSyncStatus("saving");

      const run = async () => {
        if (!ownerDispatchIsCurrent(requestContext) || !mutationIsCurrent()) return false;
        const sanitised = snapshot.sections
          .filter(isWorkspaceSectionContentLoaded)
          .map((section) => ({
            ...section,
            user_id: userId,
            content: sanitiseSectionContent(section.content),
          }));
        let durableTimestamp: string | null = null;

        try {
          if (captured) {
            await persistCapturedSnapshot(snapshot, sanitised, requestContext);
            durableTimestamp = new Date().toISOString();
          } else {
            if (!cacheScope || cacheScope.kind !== "user") {
              throw new Error("LEGACY_WORKSPACE_OWNER_UNAVAILABLE");
            }
            const desiredFingerprint = legacyDesiredFingerprint(snapshot);
            const dispatch = async (
              command: PendingLegacyWorkspaceCommand,
            ): Promise<LegacyWorkspaceSaveReceiptV1> => {
              if (
                !resourceIsCurrent() ||
                command.request.documentId !== snapshot.documentId ||
                command.request.outcomeId !== outcomeId
              )
                throw new Error("LEGACY_WORKSPACE_RESOURCE_CHANGED");
              if (command.ownerUserId !== requestContext.expectedUserId) {
                if (pendingLegacyWorkspaceCommandRef.current === command)
                  pendingLegacyWorkspaceCommandRef.current = null;
                throw new Error("LEGACY_WORKSPACE_OWNER_CONTEXT_MISMATCH");
              }
              pendingLegacyWorkspaceCommandRef.current = command;
              try {
                const receipt = await saveLegacyWorkspaceV1(command.request, requestContext);
                requestContext.assertCurrent();
                if (!resourceIsCurrent()) throw new Error("LEGACY_WORKSPACE_RESOURCE_CHANGED");
                mergeLegacyWorkspaceReceipt(command, receipt);
                if (pendingLegacyWorkspaceCommandRef.current === command)
                  pendingLegacyWorkspaceCommandRef.current = null;
                return receipt;
              } catch (error) {
                if (
                  !(error instanceof LegacyWorkspaceSaveError) ||
                  !error.ambiguous ||
                  !ownerDispatchIsCurrent(requestContext)
                ) {
                  if (pendingLegacyWorkspaceCommandRef.current === command)
                    pendingLegacyWorkspaceCommandRef.current = null;
                }
                throw error;
              }
            };

            let pendingCommand = pendingLegacyWorkspaceCommandRef.current;
            if (
              pendingCommand &&
              (pendingCommand.request.documentId !== snapshot.documentId ||
                pendingCommand.request.outcomeId !== outcomeId ||
                pendingCommand.ownerUserId !== userId)
            ) {
              if (pendingLegacyWorkspaceCommandRef.current === pendingCommand)
                pendingLegacyWorkspaceCommandRef.current = null;
              pendingCommand = null;
            }
            if (pendingCommand) {
              const receipt = await dispatch(pendingCommand);
              durableTimestamp = receipt.documentUpdatedAt;
              if (!mutationIsCurrent()) return false;
              if (pendingCommand.desiredFingerprint === desiredFingerprint) {
                if (
                  ownerDispatchIsCurrent(requestContext) &&
                  mutationIsCurrent() &&
                  revision === saveRevisionRef.current
                ) {
                  failedSnapshotRef.current = null;
                  const acknowledgedAt = durableTimestamp;
                  setLastSyncedAt((current) => laterIsoTimestamp(current, acknowledgedAt));
                  setSyncStatus("saved");
                }
                return true;
              }
            }

            const command = await buildLegacyWorkspaceSaveRequest({
              snapshot,
              outcomeId,
              cacheScope,
              savedDocument: legacySavedDocumentRef.current,
              savedSections: legacySavedSectionsRef.current,
            });
            requestContext.assertCurrent();
            if (!mutationIsCurrent()) return false;
            if (command) {
              const receipt = await dispatch(command);
              durableTimestamp = receipt.documentUpdatedAt;
            }
          }

          if (
            ownerDispatchIsCurrent(requestContext) &&
            mutationIsCurrent() &&
            revision === saveRevisionRef.current
          ) {
            failedSnapshotRef.current = null;
            if (durableTimestamp) {
              const acknowledgedAt = durableTimestamp;
              setLastSyncedAt((current) => laterIsoTimestamp(current, acknowledgedAt));
            }
            setSyncStatus("saved");
          }
          return mutationIsCurrent();
        } catch {
          if (
            ownerDispatchIsCurrent(requestContext) &&
            mutationIsCurrent() &&
            revision === saveRevisionRef.current
          ) {
            failedSnapshotRef.current = snapshot;
            setSyncStatus("failed");
          }
          return false;
        }
      };

      const completion = saveQueueRef.current.catch(() => undefined).then(run);
      saveQueueRef.current = completion.then(() => undefined);
      return completion;
    },
    [
      captured,
      cacheScope,
      mergeLegacyWorkspaceReceipt,
      outcomeId,
      ownerMismatch,
      persistCapturedSnapshot,
      resource,
      userId,
    ],
  );

  const retrySync = useCallback(() => {
    const snapshot = state;
    if (
      !snapshot ||
      ownerMismatch ||
      !resource.observing ||
      activeResourceRef.current !== resource ||
      renderedMutationEpoch !== localMutationEpochRef.current
    )
      return;
    markExplicitSave();
    cacheWorkspaceSnapshot(snapshot);
    if (!userId) return;
    const revision = ++saveRevisionRef.current;
    void persistRemote(snapshot, revision);
  }, [
    cacheWorkspaceSnapshot,
    markExplicitSave,
    ownerMismatch,
    persistRemote,
    renderedMutationEpoch,
    resource,
    state,
    userId,
  ]);

  const approveDocument = useCallback(async (): Promise<boolean> => {
    const identity = capturedIdentityRef.current;
    if (
      !captured ||
      !state ||
      !identity ||
      !userId ||
      approving ||
      ownerMismatch ||
      !resource.observing ||
      activeResourceRef.current !== resource ||
      renderedMutationEpoch !== localMutationEpochRef.current
    )
      return false;
    const requestContext = captureOwnerDispatch(userId);
    const snapshot = state;
    const mutationEpoch = localMutationEpochRef.current;
    setApproving(true);
    markExplicitSave();
    const revision = ++saveRevisionRef.current;
    try {
      const persisted = await persistRemote(snapshot, revision, requestContext);
      if (!persisted || mutationEpoch !== localMutationEpochRef.current) return false;
      requestContext.assertCurrent();
      const currentIdentity = capturedIdentityRef.current;
      if (!currentIdentity) return false;
      const result = await approveCapturedDocumentRevision(
        {
          operationId: currentIdentity.operationId,
          expectedOperationRevision: currentIdentity.operationRevision,
          documentId: snapshot.documentId,
          expectedDocumentRevision: currentIdentity.documentRevision,
        },
        requestContext,
      );
      requestContext.assertCurrent();
      currentIdentity.operationRevision = result.operation_revision;
      currentIdentity.approvedRevision = result.document_revision;
      if (mutationEpoch !== localMutationEpochRef.current) {
        setDurableExportEligible(false);
        return false;
      }
      setDurableExportEligible(true);
      setState((current) =>
        current
          ? {
              ...current,
              status: "approved",
              sections: current.sections.map((section) => ({
                ...section,
                status: "approved" as const,
              })),
            }
          : current,
      );
      failedSnapshotRef.current = null;
      setLastSyncedAt(new Date().toISOString());
      setSyncStatus("saved");
      return true;
    } catch {
      if (ownerDispatchIsCurrent(requestContext)) {
        failedSnapshotRef.current = snapshot;
        setSyncStatus("failed");
      }
      return false;
    } finally {
      if (ownerDispatchIsCurrent(requestContext)) setApproving(false);
    }
  }, [
    approving,
    captured,
    markExplicitSave,
    ownerMismatch,
    persistRemote,
    renderedMutationEpoch,
    resource,
    state,
    userId,
  ]);

  const requestCapturedExport = useCallback(
    async (
      format: "pdf" | "docx" | "xlsx" | "html_preview",
      requestContext: OwnerDispatchLease,
    ): Promise<CapturedExportRequestResult | null> => {
      const identity = capturedIdentityRef.current;
      if (
        !captured ||
        !state ||
        !identity ||
        !userId ||
        !cacheScope ||
        ownerMismatch ||
        !durableExportEligible ||
        identity.approvedRevision !== identity.documentRevision
      ) {
        return null;
      }
      if (requestContext.expectedUserId !== userId.toLowerCase()) return null;
      requestContext.assertCurrent();
      const mutationEpoch = localMutationEpochRef.current;
      const documentId = state.documentId;
      const operationId = identity.operationId;
      const documentRevision = identity.documentRevision;
      const intentKey = `${operationId}:${documentId}:${documentRevision}:${format}`;
      const intentSequence = resolveCapturedExportIntentSequence(cacheScope, outcomeId, intentKey);
      const cacheKey = `${intentKey}:${intentSequence}`;
      const existing = capturedExportRequestsRef.current.get(cacheKey);
      if (existing) return existing.result;
      const idempotencyKey = await resolveGenerationRequestIdentity(
        cacheScope,
        outcomeId,
        `captured-export:${intentKey}:intent:${intentSequence}`,
        {
          contract: "captured-export-request.2",
          operationId,
          documentId,
          approvedDocumentRevision: documentRevision,
          format,
          exportIntentSequence: intentSequence,
        },
      );
      requestContext.assertCurrent();
      if (
        mutationEpoch !== localMutationEpochRef.current ||
        capturedIdentityRef.current !== identity ||
        !durableExportEligible
      ) {
        return null;
      }
      const result = await requestCapturedDocumentExport(
        {
          operationId,
          expectedOperationRevision: identity.operationRevision,
          documentId,
          approvedDocumentRevision: documentRevision,
          format,
          idempotencyKey,
        },
        requestContext,
      );
      requestContext.assertCurrent();
      identity.operationRevision = result.operation_revision;
      if (mutationEpoch !== localMutationEpochRef.current) {
        setDurableExportEligible(false);
        return null;
      }
      capturedExportRequestsRef.current.set(cacheKey, {
        sequence: intentSequence,
        result,
      });
      return result;
    },
    [cacheScope, captured, durableExportEligible, outcomeId, ownerMismatch, state, userId],
  );

  const rememberCapturedExportDelivery = useCallback(
    (format: "pdf" | "docx" | "xlsx" | "html_preview", exportId: string): boolean => {
      const identity = capturedIdentityRef.current;
      if (!identity || !state || !cacheScope || ownerMismatch || !userId) return false;
      const intentKey = `${identity.operationId}:${state.documentId}:${identity.documentRevision}:${format}`;
      const sequence = resolveCapturedExportIntentSequence(cacheScope, outcomeId, intentKey);
      const cacheKey = `${intentKey}:${sequence}`;
      const pending = capturedExportRequestsRef.current.get(cacheKey);
      if (
        !pending ||
        pending.sequence !== sequence ||
        pending.result.export_id !== exportId ||
        pending.result.operation_id !== identity.operationId ||
        pending.result.document_id !== state.documentId ||
        pending.result.document_revision !== identity.documentRevision ||
        pending.result.format !== format
      ) {
        return false;
      }
      return true;
    },
    [cacheScope, outcomeId, ownerMismatch, state, userId],
  );

  const createUpdatedCapturedExport = useCallback(
    (format: "pdf" | "docx" | "xlsx" | "html_preview", exportId: string): boolean => {
      if (!rememberCapturedExportDelivery(format, exportId)) return false;
      const identity = capturedIdentityRef.current;
      if (!identity || !state || !cacheScope || ownerMismatch || !userId) return false;
      const intentKey = `${identity.operationId}:${state.documentId}:${identity.documentRevision}:${format}`;
      const sequence = resolveCapturedExportIntentSequence(cacheScope, outcomeId, intentKey);
      const cacheKey = `${intentKey}:${sequence}`;
      if (
        !advanceCapturedExportIntentSequenceForNewExport(cacheScope, outcomeId, intentKey, sequence)
      ) {
        return false;
      }
      capturedExportRequestsRef.current.delete(cacheKey);
      return true;
    },
    [cacheScope, outcomeId, ownerMismatch, rememberCapturedExportDelivery, state, userId],
  );

  const adoptGenerationResult = useCallback(
    async (
      baseline: DocumentState,
      result: DocumentGenerationResult,
      expectedMutationEpoch: number,
      generationContext: OwnerDispatchLease,
    ): Promise<void> => {
      generationContext.assertCurrent();
      if (
        captured ||
        !resource.observing ||
        activeResourceRef.current !== resource ||
        (activeDocumentIdRef.current !== null &&
          activeDocumentIdRef.current !== baseline.documentId) ||
        expectedMutationEpoch !== localMutationEpochRef.current
      ) {
        throw new ApiError(409, "DOCUMENT_GENERATION_STALE_RESULT", {});
      }
      const candidate = applyGeneratedResult(baseline, result);
      // Validate metadata before any React update; the updater below only merges
      // the still-current transient questions within this exact result scope.
      mergeGenerationMissingInfo([], result);
      generationContext.assertCurrent();
      if (expectedMutationEpoch !== localMutationEpochRef.current) {
        throw new ApiError(409, "DOCUMENT_GENERATION_STALE_RESULT", {});
      }
      localMutationEpochRef.current += 1;
      markExplicitSave();
      setState(candidate);
      setUnresolvedPlaceholders(candidate.unresolvedPlaceholders ?? []);
      setMissingInfo((current) => mergeGenerationMissingInfo(current, result));
      const completedIds = new Set(result.scope.map((binding) => binding.sectionId));
      setGenerationIssues((current) =>
        current.filter((issue) => !completedIds.has(issue.sectionId)),
      );
      cacheWorkspaceSnapshot(candidate);
      // Accepted wording uses the existing owner-scoped save lifetime. Ending
      // stream observation or navigating away must not cancel an accepted save.
      await persistRemote(candidate, ++saveRevisionRef.current);
    },
    [cacheWorkspaceSnapshot, captured, markExplicitSave, persistRemote, resource],
  );

  const ensureLegacyGenerationIdentity = useCallback(
    async (
      snapshot: DocumentState,
      expectedMutationEpoch: number,
      requestContext: OwnerDispatchLease,
    ): Promise<void> => {
      const assertObservation = () => {
        requestContext.assertCurrent();
        if (
          !resource.observing ||
          activeResourceRef.current !== resource ||
          expectedMutationEpoch !== localMutationEpochRef.current
        ) {
          throw new ApiError(409, "DOCUMENT_GENERATION_STALE_RESULT", {});
        }
      };
      assertObservation();
      const saved = legacySavedDocumentRef.current;
      if (
        saved &&
        (saved.ownerUserId !== requestContext.expectedUserId ||
          saved.outcomeId !== outcomeId ||
          saved.documentId !== snapshot.documentId)
      ) {
        throw new ApiError(409, "DOCUMENT_GENERATION_STALE_RESULT", {});
      }
      if (
        saved &&
        snapshot.sections.every((section) => legacySavedSectionsRef.current.has(section.id))
      )
        return;
      // The random seed IDs must be durable before they enter the immutable
      // generation request key. Use the existing queue and exact replay receipt.
      markExplicitSave();
      const persisted = await persistRemote(snapshot, ++saveRevisionRef.current);
      // An accepted save may finish after navigation; provider work may not.
      assertObservation();
      if (!persisted) throw new ApiError(409, "DOCUMENT_GENERATION_SAVE_REQUIRED", {});
    },
    [markExplicitSave, outcomeId, persistRemote, resource],
  );

  const retryGenerationSection = useCallback(
    async (sectionId: string) => {
      if (captured) {
        setGenerationIssues((current) =>
          current.map((issue) =>
            issue.sectionId === sectionId
              ? {
                  ...issue,
                  reason:
                    "Regeneration is unavailable for this document. You can edit its wording directly.",
                  retryable: false,
                }
              : issue,
          ),
        );
        return;
      }
      if (
        !state ||
        loading ||
        !resource.observing ||
        activeResourceRef.current !== resource ||
        renderedMutationEpoch !== localMutationEpochRef.current ||
        resource.scopedGenerationPending ||
        resource.generationLimitBlocked ||
        regeneratingSectionId ||
        !cacheScope ||
        ownerMismatch ||
        !userId
      )
        return;
      if (
        generationIssues.some((issue) => issue.sectionId === sectionId && issue.retryable === false)
      )
        return;
      const target = state.sections.find((section) => section.id === sectionId);
      if (!target) return;
      const requestContext = captureOwnerDispatch(userId);
      const mutationEpoch = localMutationEpochRef.current;

      resource.scopedGenerationPending = true;
      setRegeneratingSectionId(sectionId);
      setDrafting(true);
      try {
        await ensureLegacyGenerationIdentity(state, mutationEpoch, requestContext);
        await streamInitialDraft({
          outcomeId,
          state,
          sectionIds: [target.id],
          pending: pendingRef.current,
          requestContext,
          // A section repair has different immutable input from the initial
          // whole-document request, so it requires its own allowance identity.
          // Reusing the settled initial ID would correctly fail closed as a
          // conflicting replay before any provider work.
          generationRequestId: (input) =>
            resolveGenerationRequestIdentity(
              cacheScope,
              outcomeId,
              `section-repair:${target.id}`,
              input,
            ),
          onComplete: (result) =>
            adoptGenerationResult(state, result, mutationEpoch, requestContext),
        });
        requestContext.assertCurrent();
      } catch (err) {
        if (
          !resource.observing ||
          activeResourceRef.current !== resource ||
          !ownerDispatchIsCurrent(requestContext)
        )
          return;
        const limitIssue = documentLimitIssue(err);
        if (limitIssue) {
          // Fence captured retry callbacks before the next React render.
          resource.generationLimitBlocked = true;
          setGenerationIssues((current) => [
            ...current.filter((issue) => issue.retryable === false &&
              issue.sectionId !== DOCUMENT_LIMIT_SECTION_ID && issue.sectionId !== PAYWALL_SECTION_ID),
            limitIssue,
          ]);
        } else if (isAuthError(err)) {
          setGenerationIssues((current) => [
            ...current.filter((issue) => issue.retryable === false),
            ...authIssues(),
          ]);
        } else {
          setGenerationIssues((current) => {
            const previous = current.find((issue) => issue.sectionId === sectionId);
            return [
              ...current.filter((issue) => issue.sectionId !== sectionId),
              generationFailure(target, err, (previous?.attempts ?? 0) + 1),
            ];
          });
        }
      } finally {
        resource.scopedGenerationPending = false;
        if (
          resource.observing &&
          activeResourceRef.current === resource &&
          ownerDispatchIsCurrent(requestContext)
        ) {
          setDrafting(false);
          setRegeneratingSectionId(null);
        }
      }
    },
    [
      adoptGenerationResult,
      cacheScope,
      captured,
      ensureLegacyGenerationIdentity,
      generationIssues,
      loading,
      outcomeId,
      ownerMismatch,
      regeneratingSectionId,
      renderedMutationEpoch,
      resource,
      state,
      userId,
    ],
  );

  useEffect(() => {
    if (
      authLoading || ownerMismatch || captured || cacheScope?.kind !== "user" ||
      initialState?.truth.snapshotVersion !== WORKSPACE_SNAPSHOT_VERSION ||
      initialState.truth.persistence !== "persisted" || !initialState.workspace ||
      !initialState.truth.currentRevision || resumesInitialLegacyGeneration
    ) return;
    const cached = loadWorkspace(cacheScope, outcomeId);
    if (!cached) return;
    const record: RecoveryRecord = {
      resource, expectedJson: JSON.stringify(cached), snapshot: initialState.workspace,
      review: null, controller: null,
    };
    recoveryHoldRef.current = record;
    let disposed = false;
    void reviewWorkspaceRecovery(
      cached, record.snapshot, cacheScope.userId, outcomeId, initialState.truth.currentRevision,
    ).then((review) => {
      if (disposed || !resource.observing || activeResourceRef.current !== resource ||
        recoveryHoldRef.current !== record) return;
      if (!review) { recoveryHoldRef.current = null; return; }
      record.review = review;
      setRecoveryRecord(record);
    }).catch(() => {
      // An unreadable copy never replaces authoritative wording. Retain its bytes.
      if (!disposed && recoveryHoldRef.current === record) {
        setDeviceReceipt({ resource, snapshot: record.snapshot, status: "unavailable" });
        record.review = { status: "unavailable", documentId: record.snapshot.documentId,
          documentRevision: initialState.truth.currentRevision!, sections: [] };
        setRecoveryRecord(record);
      }
    });
    return () => {
      disposed = true;
      record.controller?.abort();
      if (recoveryHoldRef.current === record) recoveryHoldRef.current = null;
    };
  }, [authLoading, cacheScope, captured, initialState, outcomeId, ownerMismatch, resource, resumesInitialLegacyGeneration]);

  useEffect(() => {
    if (authLoading) return;
    if (ownerMismatch) {
      pendingRef.current = null;
      failedSnapshotRef.current = null;
      setState(null);
      setUnresolvedPlaceholders([]);
      setGenerationIssues([]);
      setDurableExportEligible(false);
      setLoading(true);
      return;
    }
    if (!cacheScope) {
      setState(null);
      setLoading(false);
      return;
    }
    const activeCacheScope = cacheScope;
    if (captured && initialState?.truth.persistence === "persisted" && initialState.workspace) {
      // Captured workspaces were already hydrated through the versioned
      // operation read. Their section identities and revisions belong to the
      // captured mutation contract, not the legacy sections table.
      pendingRef.current = pendingFromInitialState(initialState);
      setLoading(false);
      return;
    }
    if (
      initialState?.truth.persistence === "persisted" &&
      initialState.workspace &&
      !resumesInitialLegacyGeneration
    ) {
      pendingRef.current = pendingFromInitialState(initialState);
      if (initialState.truth.snapshotVersion === WORKSPACE_SNAPSHOT_VERSION) {
        // Snapshot v1 intentionally contains one body. The other summaries are
        // not blank sections and must never trigger an eager compatibility read.
        setLoading(false);
        return;
      }
      if (!userId) {
        setSyncStatus("failed");
        setLoading(false);
        return;
      }
      setLoading(true);
      let hydrationCancelled = false;
      const hydrationController = new AbortController();
      const hydrationContext = captureOwnerDispatch(userId, hydrationController.signal);
      const hydrationMutationEpoch = localMutationEpochRef.current;
      const initialDocumentId = initialState.workspace.documentId;
      void fetchSections(initialDocumentId, hydrationContext)
        .then(async (persisted) => {
          if (hydrationCancelled || !ownerDispatchIsCurrent(hydrationContext)) return;
          const authoritative = persisted as PersistedSection[];
          const savedEntries = await Promise.all(
            authoritative.map(
              async (section) =>
                [section.id, await legacySavedSectionFromFullRow(section)] as const,
            ),
          );
          hydrationContext.assertCurrent();
          if (
            hydrationCancelled ||
            activeResourceRef.current !== resource ||
            activeStateRef.current?.documentId !== initialDocumentId
          )
            return;
          if (hydrationMutationEpoch !== localMutationEpochRef.current) {
            failedSnapshotRef.current = activeStateRef.current;
            setSyncStatus("failed");
            setLoading(false);
            return;
          }
          legacySavedSectionsRef.current = new Map(
            savedEntries.flatMap(([id, saved]) => (saved ? [[id, saved] as const] : [])),
          );
          const current = activeStateRef.current;
          if (current && current.documentId === initialDocumentId) {
            const sections = mergeHydratedSections(current.sections, authoritative);
            const next = { ...current, sections };
            cacheWorkspaceSnapshot(next);
            setState(next);
          }
          setLoading(false);
        })
        .catch(() => {
          // Fail closed: SectionEditor receives no binding and refuses a durable
          // edit until an authoritative section read/save succeeds.
          if (ownerDispatchIsCurrent(hydrationContext)) {
            setSyncStatus("failed");
            setLoading(false);
          }
        });
      return () => {
        hydrationCancelled = true;
        hydrationController.abort();
      };
    }
    let cancelled = false;
    setLoading(true);
    const loadMutationEpoch = localMutationEpochRef.current;
    const generationController = new AbortController();
    const generationRequestContext = userId
      ? captureOwnerDispatch(userId, generationController.signal)
      : null;

    async function generateDraft(
      target: DocumentState,
      pending: PendingOutcome | null,
      adoptionBaseline: DocumentState = target,
    ): Promise<void> {
      if (resource.generationLimitBlocked) return;
      if (!shouldGenerateInitialDraft(target, pending)) {
        if (!cancelled) {
          const next = applyRequiredSectionFallbacks(target);
          setUnresolvedPlaceholders(next.unresolvedPlaceholders ?? []);
          setGenerationIssues(missingRequiredSections(next.sections));
          if (next !== target) {
            setState(next);
            cacheWorkspaceSnapshot(next);
          }
        }
        return;
      }
      if (!cancelled) setDrafting(true);
      const mutationEpoch = localMutationEpochRef.current;
      try {
        const requestContext = generationRequestContext;
        if (!requestContext) throw new Error("AUTH_REQUIRED");
        await ensureLegacyGenerationIdentity(target, mutationEpoch, requestContext);
        await streamInitialDraft({
          outcomeId,
          state: target,
          pending,
          generationRequestId: (input) =>
            resolveGenerationRequestIdentity(
              activeCacheScope,
              outcomeId,
              `initial-document:${target.documentId}`,
              input,
            ),
          signal: generationController.signal,
          requestContext,
          onComplete: (result) =>
            adoptGenerationResult(adoptionBaseline, result, mutationEpoch, requestContext),
        });
        requestContext.assertCurrent();
      } catch (err) {
        if (generationRequestContext && !ownerDispatchIsCurrent(generationRequestContext)) {
          return;
        }
        if (!cancelled) {
          const limitIssue = documentLimitIssue(err);
          if (limitIssue) {
            resource.generationLimitBlocked = true;
            setGenerationIssues((current) => [
              ...current.filter((issue) => issue.retryable === false &&
                issue.sectionId !== DOCUMENT_LIMIT_SECTION_ID && issue.sectionId !== PAYWALL_SECTION_ID),
              limitIssue,
            ]);
          } else if (isAuthError(err)) {
            setGenerationIssues((current) => [
              ...current.filter((issue) => issue.retryable === false),
              ...authIssues(),
            ]);
          } else {
            const affected = sectionsNeedingInitialGeneration(target);
            setGenerationIssues(
              (affected.length ? affected : target.sections).map((section) =>
                generationFailure(section, err),
              ),
            );
          }
        }
      } finally {
        if (
          !cancelled &&
          (!generationRequestContext || ownerDispatchIsCurrent(generationRequestContext))
        ) {
          setDrafting(false);
        }
      }
    }

    async function load() {
      let pending = pendingFromInitialState(initialState);
      let savedOutcome: Outcome | null = null;

      if (userId) {
        if (!generationRequestContext) throw new Error("AUTH_REQUIRED");
        savedOutcome = await fetchOutcome(outcomeId, generationRequestContext);
        if (!pending) {
          pending = pendingFromOutcome(savedOutcome);
          if (pending) cachePendingOutcome(pending);
        }
      } else if (!pending) {
        pending = loadPendingOutcome(activeCacheScope, outcomeId);
      }
      pendingRef.current = pending;

      const defaults = pendingDefaults(pending);
      const savedSituation = savedOutcome?.situation_text ?? pending?.situation ?? "";

      if (userId) {
        if (!generationRequestContext) throw new Error("AUTH_REQUIRED");
        const dbDoc = await fetchDocumentByOutcomeId(outcomeId, userId, generationRequestContext);
        if (dbDoc && !cancelled) {
          const sections = await fetchSections(dbDoc.id, generationRequestContext);
          generationRequestContext.assertCurrent();
          if (!cancelled) {
            const persistedSections = sections as PersistedSection[];
            const savedEntries = await Promise.all(
              persistedSections.map(
                async (section) =>
                  [section.id, await legacySavedSectionFromFullRow(section)] as const,
              ),
            );
            generationRequestContext.assertCurrent();
            if (cancelled || activeResourceRef.current !== resource) return;
            legacySavedSectionsRef.current = new Map(
              savedEntries.flatMap(([id, saved]) => (saved ? [[id, saved] as const] : [])),
            );
            const persistedDocument = dbDoc as typeof dbDoc & {
              current_revision?: number;
              approved_revision?: number | null;
            };
            const currentRevision = persistedDocument.current_revision;
            if (!Number.isInteger(currentRevision) || Number(currentRevision) <= 0) {
              throw new Error("LEGACY_DOCUMENT_REVISION_UNAVAILABLE");
            }
            legacySavedDocumentRef.current = {
              ownerUserId: userId,
              outcomeId,
              documentId: dbDoc.id,
              title: dbDoc.title,
              status: dbDoc.status,
              templateId: legacyTemplateId(dbDoc.template_id),
              unresolvedPlaceholders: clonePlaceholders(dbDoc.unresolved_placeholders),
              revision: Number(currentRevision),
              approvedRevision: persistedDocument.approved_revision ?? null,
            };
            setLegacyDocumentRevision(Number(currentRevision));
            setLegacyApprovedRevision(persistedDocument.approved_revision ?? null);
            const workspace: StoredWorkspace = {
              documentId: dbDoc.id,
              outcomeId,
              title: dbDoc.title,
              situation: savedSituation,
              status: dbDoc.status,
              sections,
              generated: sections.some((section) => section.content.trim().length > 0),
              templateId: dbDoc.template_id ?? defaults.templateId ?? undefined,
              conversationContext: defaults.conversationContext,
              uploadContext: defaults.uploadContext,
              unresolvedPlaceholders: dbDoc.unresolved_placeholders ?? [],
            };
            const nextState = stateFromStored(workspace, defaults);
            // A server snapshot may predate another tab's edit. Recheck the
            // freshly read rows before resuming its initial generation intent.
            const canResumeInitial =
              !resumesInitialLegacyGeneration ||
              (currentRevision === 1 &&
                dbDoc.status === "draft" &&
                persistedDocument.approved_revision == null &&
                savedEntries.length > 0 &&
                savedEntries.every(
                  ([, saved]) =>
                    saved?.revision === 1 &&
                    saved.status === "draft" &&
                    saved.approvedRevision === null,
                ));
            const guardedState = canResumeInitial
              ? applyRequiredSectionFallbacks(nextState)
              : nextState;
            setUnresolvedPlaceholders(guardedState.unresolvedPlaceholders ?? []);
            cacheWorkspaceSnapshot(guardedState);
            setState(guardedState);
            setSyncStatus("saved");
            setLastSyncedAt(dbDoc.updated_at);
            if (canResumeInitial) await generateDraft(nextState, pending, guardedState);
            if (!cancelled) setLoading(false);
            return;
          }
        }
      }

      const cached = userId ? null : loadWorkspace(activeCacheScope, outcomeId);
      if (cached && !cancelled) {
        const nextState = stateFromStored(
          { ...cached, situation: cached.situation || savedSituation },
          defaults,
        );
        const guardedState = applyRequiredSectionFallbacks(nextState);
        setUnresolvedPlaceholders(guardedState.unresolvedPlaceholders ?? []);
        cacheWorkspaceSnapshot(guardedState);
        setState(guardedState);
        if (!userId) setSyncStatus("local_only");
        await generateDraft(nextState, pending, guardedState);
        if (!cancelled) setLoading(false);
        return;
      }

      if (!cancelled && (!userId || pending)) {
        const { buildSeedDocument } = await import("@prompted/shared/workspace");
        generationRequestContext?.assertCurrent();
        if (cancelled || activeResourceRef.current !== resource) return;
        if (loadMutationEpoch !== localMutationEpochRef.current) {
          setLoading(false);
          return;
        }
        const seed = buildSeedDocument({
          outcomeId,
          templateName: defaults.templateName,
          situation: savedSituation,
          userId: userId ?? "anonymous",
          sourceText: [defaults.uploadContext, defaults.conversationContext]
            .filter(Boolean)
            .join("\n\n"),
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
        // The owner-scoped read found no document. Prior outcome baselines
        // cannot turn this new identity into an update of another document.
        legacySavedDocumentRef.current = null;
        legacySavedSectionsRef.current = new Map();
        setLegacyDocumentRevision(null);
        setLegacyApprovedRevision(null);
        cacheWorkspaceSnapshot(fresh);
        setState(fresh);
        activeDocumentIdRef.current = fresh.documentId;
        activeStateRef.current = fresh;
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
  }, [
    adoptGenerationResult,
    authLoading,
    cachePendingOutcome,
    cacheScope,
    cacheWorkspaceSnapshot,
    captured,
    ensureLegacyGenerationIdentity,
    initialState,
    outcomeId,
    ownerMismatch,
    resource,
    resumesInitialLegacyGeneration,
    userId,
  ]);

  useAutosave(
    ownerMismatch ? null : state,
    (snapshot, requestContext) => {
      if (!snapshot || !cacheScope || ownerMismatch) return;
      cacheWorkspaceSnapshot(snapshot);
      if (!userId) {
        setSyncStatus("local_only");
        return;
      }
      if (!requestContext) return;
      const revision = ++saveRevisionRef.current;
      persistRemote(snapshot, revision, requestContext);
    },
    500,
    ownerEpoch,
    () => `${localMutationEpochRef.current}:${explicitSaveEpochRef.current.sequence}`,
    explicitSaveEpochRef.current.mutationEpoch === localMutationEpochRef.current
      ? "discard"
      : "schedule-current",
  );

  const setCanonicalUnresolvedPlaceholders = useCallback(
    (
      next:
        | DocumentPlaceholderMetadata[]
        | ((prev: DocumentPlaceholderMetadata[]) => DocumentPlaceholderMetadata[]),
    ) => {
      localMutationEpochRef.current += 1;
      setSyncStatus(userId ? "idle" : "local_only");
      if (captured) setDurableExportEligible(false);
      setUnresolvedPlaceholders((previous) => {
        const resolved = typeof next === "function" ? next(previous) : next;
        setState((current) =>
          current ? { ...current, unresolvedPlaceholders: resolved } : current,
        );
        return resolved;
      });
    },
    [captured, userId],
  );

  const setSections = useCallback(
    (next: Section[] | ((previous: Section[]) => Section[])) => {
      localMutationEpochRef.current += 1;
      setSyncStatus(userId ? "idle" : "local_only");
      if (captured) setDurableExportEligible(false);
      setState((previous) => {
        if (!previous) return previous;
        const sections = typeof next === "function" ? next(previous.sections) : next;
        setGenerationIssues((issues) =>
          issues.filter((issue) => {
            // Editing wording cannot establish the result of an uncertain
            // provider attempt or make an unavailable generation route safe.
            if (issue.retryable === false) return true;
            const section = sections.find((item) => item.id === issue.sectionId);
            return !section?.content.trim();
          }),
        );
        return { ...previous, sections };
      });
    },
    [captured, userId],
  );

  const registerWorkspaceSectionBody = useCallback(
    (body: WorkspaceSectionBodyV1): boolean => {
      const expectedDocumentRevision = captured
        ? capturedIdentityRef.current?.documentRevision
        : legacyDocumentRevision;
      if (
        body.outcomeId !== outcomeId ||
        body.documentId !== initialState?.truth.documentId ||
        body.documentRevision !== expectedDocumentRevision
      )
        return false;

      const source = state?.sections.find((section) => section.id === body.sectionId);
      const metadata = source ? workspaceSectionMetadata(source) : null;
      if (
        !source ||
        !metadata ||
        metadata.contentLoaded ||
        metadata.revision !== body.sectionRevision ||
        metadata.contentSha256 !== body.contentSha256 ||
        metadata.contentLength !== body.contentLength ||
        source.document_id !== body.documentId ||
        metadata.ledgerBindingStatus !== body.ledgerBindingStatus ||
        metadata.sectionKey !== body.sectionKey
      )
        return false;

      if (captured) {
        const identity = capturedIdentityRef.current;
        const sectionKey = body.sectionKey ?? capturedSectionKey(source as CapturedSectionClient);
        if (
          !identity ||
          identity.documentRevision !== body.documentRevision ||
          body.ledgerBindingStatus !== "captured" ||
          !sectionKey
        )
          return false;
        capturedSavedSectionsRef.current.set(sectionKey, {
          content: body.content,
          revision: body.sectionRevision,
          state: body.sectionState,
        });
      } else {
        if (body.ledgerBindingStatus !== "legacy_unversioned") return false;
        const existing = legacySavedSectionsRef.current.get(body.sectionId);
        legacySavedSectionsRef.current.set(body.sectionId, {
          contentLoaded: true,
          content: body.content,
          contentSha256: body.contentSha256,
          name: existing?.name ?? source.name,
          orderIndex: existing?.orderIndex ?? source.order_index,
          status: body.status,
          isRequired: existing?.isRequired ?? source.is_required,
          revision: body.sectionRevision,
          approvedRevision: body.approvedRevision,
        });
      }
      return true;
    },
    [captured, initialState?.truth.documentId, legacyDocumentRevision, outcomeId, state],
  );

  const restoreBrowserRecovery = useCallback(async (): Promise<boolean> => {
    const record = recoveryHoldRef.current;
    const review = record?.review;
    if (
      !record || record !== recoveryRecord || record.resource !== resource ||
      !review || review.status !== "ready" || !userId || ownerMismatch || captured ||
      record.controller || !resource.observing || activeResourceRef.current !== resource ||
      activeStateRef.current !== record.snapshot ||
      legacySavedDocumentRef.current?.revision !== review.documentRevision
    ) return false;
    const controller = new AbortController();
    record.controller = controller;
    const timer = setTimeout(() => controller.abort(), 30_000);
    const mutationEpoch = localMutationEpochRef.current;
    try {
      const lease = captureOwnerDispatch(userId, controller.signal);
      const replacements = new Map<string, Section>();
      const changes = new Map(review.sections.map(section => [section.sectionId, section]));
      for (const current of record.snapshot.sections) {
        const change = changes.get(current.id);
        if (!change && isWorkspaceSectionContentLoaded(current)) continue;
        const metadata = workspaceSectionMetadata(current);
        if (!metadata) return false;
        const body = await fetchWorkspaceSectionBody({
          outcomeId, sectionId: current.id,
          expectedDocumentRevision: review.documentRevision,
          expectedSectionRevision: metadata.revision,
        }, lease);
        if (
          !ownerDispatchIsCurrent(lease) || controller.signal.aborted ||
          !resource.observing || activeResourceRef.current !== resource ||
          recoveryHoldRef.current !== record || activeStateRef.current !== record.snapshot ||
          localMutationEpochRef.current !== mutationEpoch ||
          legacySavedDocumentRef.current?.revision !== review.documentRevision ||
          body.contentSha256 !== metadata.contentSha256
        ) return false;
        let baseline = current;
        if (isWorkspaceSectionContentLoaded(current)) {
          if (current.content !== body.content) return false;
        } else {
          if (!registerWorkspaceSectionBody(body)) return false;
          baseline = materialiseWorkspaceSectionBody(current, body);
        }
        if (!change) continue;
        const edited = applyContentEdit(baseline, change.content);
        if (edited === baseline) return false;
        replacements.set(change.sectionId, {
          ...edited, version_history: [...baseline.version_history, {
            content: baseline.content, saved_at: edited.updated_at,
            label: "Before restoring your browser copy", origin: "user_edit",
          }],
        });
      }
      recoveryHoldRef.current = null;
      setRecoveryRecord(null);
      setSections(record.snapshot.sections.map(section => replacements.get(section.id) ?? section));
      return true;
    } catch {
      // The foreground review keeps the wording and exposes an explicit retry.
      return false;
    } finally {
      clearTimeout(timer);
      if (record.controller === controller) record.controller = null;
    }
  }, [captured, outcomeId, ownerMismatch, recoveryRecord, registerWorkspaceSectionBody, resource, setSections, userId]);

  const discardBrowserRecovery = useCallback((): boolean => {
    const record = recoveryHoldRef.current;
    if (!record || record !== recoveryRecord || record.resource !== resource ||
      !resource.observing || activeResourceRef.current !== resource || ownerMismatch ||
      cacheScope?.kind !== "user" || record.controller) return false;
    try { captureOwnerDispatch(cacheScope.userId).assertCurrent(); } catch { return false; }
    if (!discardReviewedWorkspace(cacheScope, outcomeId, record.expectedJson)) return false;
    recoveryHoldRef.current = null;
    setRecoveryRecord(null);
    return true;
  }, [cacheScope, outcomeId, ownerMismatch, recoveryRecord, resource]);

  const cancelBrowserRecovery = useCallback(() => {
    if (recoveryHoldRef.current?.resource === resource) recoveryHoldRef.current.controller?.abort();
  }, [resource]);

  const markWorkspaceReadUnavailable = useCallback(() => {
    setDurableExportEligible(false);
    failedSnapshotRef.current = null;
    setSyncStatus("failed");
  }, []);

  const setStatus = useCallback(
    (status: string) => {
      localMutationEpochRef.current += 1;
      setSyncStatus(userId ? "idle" : "local_only");
      if (captured) setDurableExportEligible(false);
      setState((previous) => (previous ? { ...previous, status } : previous));
    },
    [captured, userId],
  );

  const dismissMissingInfo = useCallback((sectionKey: string, item?: string) => {
    setMissingInfo((previous) =>
      previous
        .map((entry) =>
          entry.key === sectionKey
            ? {
                ...entry,
                missing: item ? entry.missing.filter((missing) => missing !== item) : [],
              }
            : entry,
        )
        .filter((entry) => entry.missing.length > 0),
    );
  }, []);

  return {
    browserRecovery: !ownerMismatch && recoveryRecord?.resource === resource
      ? recoveryRecord.review : null,
    restoreBrowserRecovery,
    discardBrowserRecovery,
    cancelBrowserRecovery,
    state: ownerMismatch ? null : state,
    loading: authLoading || ownerMismatch || loading,
    drafting,
    syncStatus,
    deviceSaveStatus,
    lastSyncedAt,
    retrySync,
    generationIssues,
    regeneratingSectionId,
    retryGenerationSection,
    setSections,
    registerWorkspaceSectionBody,
    markWorkspaceReadUnavailable,
    mergePersistedLegacyApply,
    setStatus,
    missingInfo,
    dismissMissingInfo,
    unresolvedPlaceholders,
    setUnresolvedPlaceholders: setCanonicalUnresolvedPlaceholders,
    captured,
    currentRevision:
      capturedIdentityRef.current?.documentRevision ??
      legacyDocumentRevision ??
      initialState?.truth.currentRevision ??
      null,
    approvedRevision:
      capturedIdentityRef.current?.approvedRevision ??
      legacyApprovedRevision ??
      initialState?.truth.approvedRevision ??
      null,
    operationId:
      capturedIdentityRef.current?.operationId ?? initialState?.truth.operationId ?? null,
    operationRevision:
      capturedIdentityRef.current?.operationRevision ??
      initialState?.truth.operationRevision ??
      null,
    approving,
    approveDocument,
    requestCapturedExport,
    rememberCapturedExportDelivery,
    createUpdatedCapturedExport,
    exportEligible: durableExportEligible,
  };
}
