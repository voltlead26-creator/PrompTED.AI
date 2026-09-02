"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DocumentNeutralReplacementOption,
  DocumentPlaceholderMetadata,
  Section,
  SectionVersion,
} from "@prompted/shared/browser";
import {
  type ApprovalSummary,
  sortByOrder,
  summariseApproval,
} from "@prompted/shared/workspace-sections";
import {
  AUTH_SECTION_ID,
  type GenerationIssue,
  useDocument,
  type WorkspaceSyncStatus,
} from "./useDocument";
import { useSection } from "./useSection";
import { useSectionReorder } from "./useSectionReorder";
import { useVersionHistory } from "./useVersionHistory";
import { useAuth } from "@/components/providers";
import { applyRequiredSectionFallbacks } from "@/lib/document-generation";
import {
  isWorkspaceSectionContentLoaded,
  materialiseWorkspaceSectionBody,
  workspaceSectionMetadata,
  type WorkspaceInitialState,
  type WorkspaceSectionBodyV1,
} from "@/lib/workspace-initial-state";
import type { CapturedExportRequestResult } from "@/lib/api/captured-document-operations";
import { fetchWorkspaceSectionBody, type LegacySectionApplyResult } from "@/lib/api/sections";
import {
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
  type OwnerDispatchLease,
} from "@/lib/browser-principal-state";

export interface MissingInfoQuestion {
  placeholderId: string;
  sectionKey: string;
  sectionLabel: string;
  sectionId: string | null;
  label: string;
  question: string;
  factType: string;
  requiredForExport: boolean;
  sharedResolutionKey?: string;
  neutralReplacementOptions: DocumentNeutralReplacementOption[];
}

export interface UseWorkspace {
  loading: boolean;
  drafting: boolean;
  syncStatus: WorkspaceSyncStatus;
  lastSyncedAt: string | null;
  retrySync: () => void;
  generationIssues: GenerationIssue[];
  regeneratingSectionId: string | null;
  retryGenerationSection: (sectionId: string) => Promise<void>;
  missingInfoQuestions: MissingInfoQuestion[];
  answerMissingInfo: (question: MissingInfoQuestion, answer: string) => Promise<void>;
  dismissMissingInfo: (question: MissingInfoQuestion) => void;
  applyNeutralReplacement: (
    question: MissingInfoQuestion,
    option: DocumentNeutralReplacementOption,
  ) => Promise<void>;
  answeringMissingInfo: boolean;
  unresolvedPlaceholders: DocumentPlaceholderMetadata[];
  selectedPlaceholderId: string | null;
  selectMissingPlaceholder: (placeholderId: string) => void;
  placeholderExportDecision: {
    status: "clear" | "warn" | "acknowledgement_required";
    total: number;
    requiredForExport: number;
  };
  documentId: string | null;
  title: string;
  situation: string;
  status: string;
  sections: Section[];
  activeSection: Section | null;
  activeSectionId: string | null;
  selectSection: (id: string) => void;
  loadFullPreview: () => Promise<Section[] | null>;
  approval: ApprovalSummary;
  canExport: boolean;
  section: ReturnType<typeof useSection>;
  mergePersistedLegacyApply: (result: LegacySectionApplyResult) => void;
  reorder: ReturnType<typeof useSectionReorder>;
  versionHistory: ReturnType<typeof useVersionHistory>;
  markExported: () => void;
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
}

export function useWorkspace(
  outcomeId: string,
  initialState?: WorkspaceInitialState | null,
): UseWorkspace {
  const { user } = useAuth();
  const {
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
    registerWorkspaceSectionBody,
    markWorkspaceReadUnavailable,
    mergePersistedLegacyApply,
    setStatus,
    missingInfo,
    dismissMissingInfo: dismissEntry,
    unresolvedPlaceholders,
    setUnresolvedPlaceholders,
    captured,
    currentRevision,
    approvedRevision,
    operationId,
    operationRevision,
    approving,
    approveDocument,
    requestCapturedExport,
    rememberCapturedExportDelivery,
    createUpdatedCapturedExport,
    exportEligible,
  } = useDocument(outcomeId, initialState);
  const [answeringMissingInfo, setAnsweringMissingInfo] = useState(false);
  const [selectedPlaceholderId, setSelectedPlaceholderId] = useState<string | null>(null);
  const [hydratedBodies, setHydratedBodies] = useState(
    () => new Map<string, WorkspaceSectionBodyV1>(),
  );
  const [activeId, setActiveId] = useState<string | null>(
    () => initialState?.truth.activeSectionId ?? null,
  );
  const activationRequestRef = useRef(0);
  const currentRevisionRef = useRef(currentRevision);
  currentRevisionRef.current = currentRevision;
  const sectionsRef = useRef<Section[]>([]);

  const setVisibleSections = useCallback(
    (next: Section[] | ((previous: Section[]) => Section[])) => {
      setSections((baseSections) => {
        const visibleById = new Map<string, Section>();
        const visibleSections = baseSections.map((base) => {
          const body = hydratedBodies.get(base.id);
          if (!body || isWorkspaceSectionContentLoaded(base)) {
            visibleById.set(base.id, base);
            return base;
          }
          try {
            const visible = materialiseWorkspaceSectionBody(base, body);
            visibleById.set(base.id, visible);
            return visible;
          } catch {
            visibleById.set(base.id, base);
            return base;
          }
        });
        const resolved = typeof next === "function" ? next(visibleSections) : next;
        const baseById = new Map(baseSections.map((section) => [section.id, section]));
        return resolved.map((section) => {
          const base = baseById.get(section.id);
          const visible = visibleById.get(section.id);
          if (base && visible && !isWorkspaceSectionContentLoaded(base) && section === visible)
            return base;
          return section;
        });
      });
    },
    [hydratedBodies, setSections],
  );

  const section = useSection(setVisibleSections);
  const reorder = useSectionReorder(setVisibleSections);
  const versionHistory = useVersionHistory(setVisibleSections);

  const hydratedState = useMemo(() => {
    if (!state || hydratedBodies.size === 0) return state;
    let changed = false;
    const sections = state.sections.map((base) => {
      const body = hydratedBodies.get(base.id);
      if (!body || isWorkspaceSectionContentLoaded(base)) return base;
      try {
        changed = true;
        return materialiseWorkspaceSectionBody(base, body);
      } catch {
        return base;
      }
    });
    return changed ? { ...state, sections } : state;
  }, [hydratedBodies, state]);

  const guardedState = useMemo(() => {
    if (!hydratedState) return null;
    const loadedSections = hydratedState.sections.filter(isWorkspaceSectionContentLoaded);
    if (loadedSections.length === hydratedState.sections.length) {
      return applyRequiredSectionFallbacks(hydratedState);
    }
    const guardedLoaded = applyRequiredSectionFallbacks({
      ...hydratedState,
      sections: loadedSections,
    });
    if (guardedLoaded.sections === loadedSections) return hydratedState;
    const guardedById = new Map(guardedLoaded.sections.map((item) => [item.id, item]));
    return {
      ...guardedLoaded,
      sections: hydratedState.sections.map((item) => guardedById.get(item.id) ?? item),
    };
  }, [hydratedState]);

  const effectiveUnresolvedPlaceholders =
    guardedState?.unresolvedPlaceholders ?? unresolvedPlaceholders;

  useEffect(() => {
    if (!hydratedState || !guardedState || guardedState === hydratedState) return;
    setVisibleSections(guardedState.sections);
    setUnresolvedPlaceholders(guardedState.unresolvedPlaceholders ?? []);
  }, [guardedState, hydratedState, setUnresolvedPlaceholders, setVisibleSections]);

  const sections = useMemo(
    () => (guardedState ? sortByOrder(guardedState.sections) : []),
    [guardedState],
  );
  sectionsRef.current = sections;

  const loadFullPreview = useCallback(async (): Promise<Section[] | null> => {
    if (!user?.id) return null;
    const requestContext = captureOwnerDispatch(user.id);
    const acceptedDocumentRevision = currentRevisionRef.current;
    const acceptedSections = sectionsRef.current;
    const unloaded = acceptedSections.filter((item) => !isWorkspaceSectionContentLoaded(item));
    if (unloaded.length === 0) return acceptedSections;
    if (acceptedDocumentRevision === null) return null;

    try {
      const bodies = new Map<string, WorkspaceSectionBodyV1>();
      let nextIndex = 0;
      const worker = async () => {
        while (nextIndex < unloaded.length) {
          const target = unloaded[nextIndex++];
          if (!target) return;
          const metadata = workspaceSectionMetadata(target);
          if (!metadata) throw new Error("WORKSPACE_SECTION_METADATA_INVALID");
          const body = await fetchWorkspaceSectionBody(
            {
              outcomeId,
              sectionId: target.id,
              expectedDocumentRevision: acceptedDocumentRevision,
              expectedSectionRevision: metadata.revision,
            },
            requestContext,
          );
          bodies.set(target.id, body);
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, unloaded.length) }, () => worker()));

      if (
        !ownerDispatchIsCurrent(requestContext) ||
        currentRevisionRef.current !== acceptedDocumentRevision
      )
        return null;
      const currentSections = sectionsRef.current;
      if (currentSections.length !== acceptedSections.length) return null;
      const currentById = new Map(currentSections.map((item) => [item.id, item]));
      const assembled: Section[] = [];
      for (const accepted of acceptedSections) {
        const current = currentById.get(accepted.id);
        if (!current) return null;
        if (isWorkspaceSectionContentLoaded(accepted)) {
          if (
            !isWorkspaceSectionContentLoaded(current) ||
            current.content !== accepted.content ||
            current.updated_at !== accepted.updated_at ||
            current.status !== accepted.status
          )
            return null;
          assembled.push(current);
          continue;
        }
        const acceptedMetadata = workspaceSectionMetadata(accepted);
        const currentMetadata = workspaceSectionMetadata(current);
        const body = bodies.get(accepted.id);
        if (
          !acceptedMetadata ||
          !currentMetadata ||
          currentMetadata.contentLoaded ||
          currentMetadata.revision !== acceptedMetadata.revision ||
          currentMetadata.contentSha256 !== acceptedMetadata.contentSha256 ||
          currentMetadata.contentLength !== acceptedMetadata.contentLength ||
          !body ||
          !registerWorkspaceSectionBody(body)
        )
          return null;
        assembled.push(materialiseWorkspaceSectionBody(current, body));
      }
      setHydratedBodies((previous) => {
        const next = new Map(previous);
        for (const [sectionId, body] of bodies) next.set(sectionId, body);
        return next;
      });
      return assembled;
    } catch {
      return null;
    }
  }, [outcomeId, registerWorkspaceSectionBody, user?.id]);

  const activeSectionId = useMemo(() => {
    if (activeId && sections.some((item) => item.id === activeId)) {
      return activeId;
    }
    return sections[0]?.id ?? null;
  }, [activeId, sections]);

  const activeSection = useMemo(
    () => sections.find((item) => item.id === activeSectionId) ?? null,
    [sections, activeSectionId],
  );

  const selectSection = useCallback(
    (id: string) => {
      const target = sections.find((item) => item.id === id);
      if (!target) return;
      const request = ++activationRequestRef.current;
      if (isWorkspaceSectionContentLoaded(target)) {
        setActiveId(id);
        return;
      }
      const metadata = workspaceSectionMetadata(target);
      if (!metadata || currentRevision === null || !user?.id) {
        markWorkspaceReadUnavailable();
        return;
      }
      const requestContext = captureOwnerDispatch(user.id);
      void fetchWorkspaceSectionBody(
        {
          outcomeId,
          sectionId: id,
          expectedDocumentRevision: currentRevision,
          expectedSectionRevision: metadata.revision,
        },
        requestContext,
      )
        .then((body) => {
          if (!ownerDispatchIsCurrent(requestContext) || activationRequestRef.current !== request)
            return;
          if (body.documentRevision !== currentRevisionRef.current) {
            throw new Error("WORKSPACE_SECTION_BODY_STALE");
          }
          if (!registerWorkspaceSectionBody(body)) {
            throw new Error("WORKSPACE_SECTION_BODY_INVALID");
          }
          materialiseWorkspaceSectionBody(target, body);
          setHydratedBodies((previous) => {
            const next = new Map(previous);
            next.set(id, body);
            return next;
          });
          setActiveId(id);
        })
        .catch(() => {
          if (ownerDispatchIsCurrent(requestContext) && activationRequestRef.current === request) {
            markWorkspaceReadUnavailable();
          }
        });
    },
    [
      currentRevision,
      markWorkspaceReadUnavailable,
      outcomeId,
      registerWorkspaceSectionBody,
      sections,
      user?.id,
    ],
  );

  const effectiveGenerationIssues = useMemo(
    () => generationIssues.filter((issue) => !(user?.id && issue.sectionId === AUTH_SECTION_ID)),
    [generationIssues, user?.id],
  );

  const approval = useMemo(() => summariseApproval(sections), [sections]);
  const markExported = useCallback(() => setStatus("exported"), [setStatus]);

  const missingInfoQuestions = useMemo<MissingInfoQuestion[]>(() => {
    if (effectiveUnresolvedPlaceholders.length > 0) {
      return effectiveUnresolvedPlaceholders.map((placeholder) => {
        const match = sections.find((item) => item.key === placeholder.sectionKey);
        return {
          placeholderId: placeholder.id,
          sectionKey: placeholder.sectionKey,
          sectionLabel: match?.name ?? placeholder.sectionKey,
          sectionId: match?.id ?? null,
          label: placeholder.label,
          question: placeholder.question,
          factType: placeholder.factType,
          requiredForExport: placeholder.requiredForExport,
          sharedResolutionKey: placeholder.sharedResolutionKey,
          neutralReplacementOptions: placeholder.neutralReplacementOptions,
        };
      });
    }

    // Backwards-compatible display only for old cached missing_info entries.
    return missingInfo.flatMap((entry) => {
      const match = sections.find((item) => item.key === entry.key || item.name === entry.label);
      return entry.missing.map((item, index) => ({
        placeholderId: `legacy.${entry.key}.${index}`,
        sectionKey: entry.key,
        sectionLabel: match?.name ?? entry.label,
        sectionId: match?.id ?? null,
        label: item,
        question: item,
        factType: "other",
        requiredForExport: false,
        neutralReplacementOptions: [],
      }));
    });
  }, [effectiveUnresolvedPlaceholders, missingInfo, sections]);

  const resolvePlaceholderValue = useCallback(
    (question: MissingInfoQuestion, value: string, clearResolvedMetadata = true) => {
      const trimmed = value.trim();
      if (!trimmed || question.placeholderId.startsWith("legacy.")) return;

      const selected = effectiveUnresolvedPlaceholders.find(
        (placeholder) => placeholder.id === question.placeholderId,
      );
      if (!selected) return;

      const targets = effectiveUnresolvedPlaceholders.filter(
        (placeholder) =>
          placeholder.id === selected.id ||
          Boolean(
            selected.sharedResolutionKey &&
            placeholder.sharedResolutionKey === selected.sharedResolutionKey,
          ),
      );
      const targetIds = new Set(
        targets.flatMap((placeholder) => {
          const section = sections.find((item) => item.key === placeholder.sectionKey);
          const token = `{{TED_PLACEHOLDER:${placeholder.id}:${placeholder.label}}}`;
          return section &&
            isWorkspaceSectionContentLoaded(section) &&
            section.content.includes(token)
            ? [placeholder.id]
            : [];
        }),
      );
      if (targetIds.size === 0) return;
      const savedAt = new Date().toISOString();

      setVisibleSections((previous) =>
        previous.map((item) => {
          let nextContent = item.content;
          let changed = false;
          for (const target of targets) {
            if (!targetIds.has(target.id)) continue;
            const token = `{{TED_PLACEHOLDER:${target.id}:${target.label}}}`;
            if (nextContent.includes(token)) {
              nextContent = nextContent.split(token).join(trimmed);
              changed = true;
            }
          }
          if (!changed) return item;
          const snapshot: SectionVersion = {
            content: item.content,
            saved_at: savedAt,
            label: `Before resolving: ${question.label}`,
            origin: "ted_edit",
          };
          return {
            ...item,
            content: nextContent,
            status: "edited",
            version_history: [...item.version_history, snapshot],
            updated_at: savedAt,
          };
        }),
      );

      if (clearResolvedMetadata) {
        setUnresolvedPlaceholders((previous) =>
          previous.filter((placeholder) => !targetIds.has(placeholder.id)),
        );
      }
      setSelectedPlaceholderId(null);
    },
    [effectiveUnresolvedPlaceholders, sections, setUnresolvedPlaceholders, setVisibleSections],
  );

  const answerMissingInfo = useCallback(
    async (question: MissingInfoQuestion, answer: string) => {
      const trimmed = answer.trim();
      if (!trimmed) return;
      setAnsweringMissingInfo(true);
      try {
        resolvePlaceholderValue(question, trimmed);
      } finally {
        setAnsweringMissingInfo(false);
      }
    },
    [resolvePlaceholderValue],
  );

  const applyNeutralReplacement = useCallback(
    async (question: MissingInfoQuestion, option: DocumentNeutralReplacementOption) => {
      setAnsweringMissingInfo(true);
      try {
        resolvePlaceholderValue(question, option.value, option.clearsExportWarning);
      } finally {
        setAnsweringMissingInfo(false);
      }
    },
    [resolvePlaceholderValue],
  );

  const dismissMissingInfo = useCallback(
    (question: MissingInfoQuestion) => {
      if (question.placeholderId.startsWith("legacy.")) {
        dismissEntry(question.sectionKey, question.question);
      }
      setSelectedPlaceholderId(null);
    },
    [dismissEntry],
  );

  return {
    loading,
    drafting,
    syncStatus,
    lastSyncedAt,
    retrySync,
    generationIssues: effectiveGenerationIssues,
    regeneratingSectionId,
    retryGenerationSection,
    missingInfoQuestions,
    answerMissingInfo,
    dismissMissingInfo,
    applyNeutralReplacement,
    answeringMissingInfo,
    unresolvedPlaceholders: effectiveUnresolvedPlaceholders,
    selectedPlaceholderId,
    selectMissingPlaceholder: setSelectedPlaceholderId,
    placeholderExportDecision: {
      status:
        effectiveUnresolvedPlaceholders.length === 0
          ? "clear"
          : effectiveUnresolvedPlaceholders.some((placeholder) => placeholder.requiredForExport)
            ? "acknowledgement_required"
            : "warn",
      total: effectiveUnresolvedPlaceholders.length,
      requiredForExport: effectiveUnresolvedPlaceholders.filter(
        (placeholder) => placeholder.requiredForExport,
      ).length,
    },
    documentId: guardedState?.documentId ?? null,
    title: guardedState?.title ?? "",
    situation: guardedState?.situation ?? "",
    status: guardedState?.status ?? "draft",
    sections,
    activeSection,
    activeSectionId,
    selectSection,
    loadFullPreview,
    approval,
    canExport: captured
      ? exportEligible &&
        currentRevision !== null &&
        approvedRevision === currentRevision &&
        effectiveGenerationIssues.length === 0
      : Boolean(guardedState?.documentId) &&
        syncStatus === "saved" &&
        currentRevision !== null &&
        approvedRevision === currentRevision &&
        approval.allRequiredApproved &&
        effectiveGenerationIssues.length === 0,
    section,
    mergePersistedLegacyApply,
    reorder,
    versionHistory,
    markExported,
    captured,
    currentRevision,
    approvedRevision,
    operationId,
    operationRevision,
    approving,
    approveDocument,
    requestCapturedExport,
    rememberCapturedExportDelivery,
    createUpdatedCapturedExport,
  };
}
