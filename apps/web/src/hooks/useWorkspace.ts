"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DocumentNeutralReplacementOption,
  DocumentPlaceholderMetadata,
  Section,
  SectionVersion,
} from "@prompted/shared/browser";
import {
  sortByOrder,
  summariseApproval,
  type ApprovalSummary,
} from "@prompted/shared/workspace-sections";
import {
  AUTH_SECTION_ID,
  useDocument,
  type GenerationIssue,
  type WorkspaceSyncStatus,
} from "./useDocument";
import { useSection } from "./useSection";
import { useSectionReorder } from "./useSectionReorder";
import { useVersionHistory } from "./useVersionHistory";
import { useAuth } from "@/components/providers";
import { applyRequiredSectionFallbacks } from "@/lib/document-generation";
import type { WorkspaceInitialState } from "@/lib/workspace-initial-state";
import type { CapturedExportRequestResult } from "@/lib/api/captured-document-operations";

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
  approval: ApprovalSummary;
  canExport: boolean;
  section: ReturnType<typeof useSection>;
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
  ) => Promise<CapturedExportRequestResult | null>;
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
  } = useDocument(outcomeId, initialState);
  const [answeringMissingInfo, setAnsweringMissingInfo] = useState(false);
  const [selectedPlaceholderId, setSelectedPlaceholderId] = useState<string | null>(null);
  const section = useSection(setSections);
  const reorder = useSectionReorder(setSections);
  const versionHistory = useVersionHistory(setSections);
  const [activeId, setActiveId] = useState<string | null>(null);

  const guardedState = useMemo(
    () => (state ? applyRequiredSectionFallbacks(state) : null),
    [state],
  );

  const effectiveUnresolvedPlaceholders =
    guardedState?.unresolvedPlaceholders ?? unresolvedPlaceholders;

  useEffect(() => {
    if (!state || !guardedState || guardedState === state) return;
    setSections(guardedState.sections);
    setUnresolvedPlaceholders(guardedState.unresolvedPlaceholders ?? []);
  }, [guardedState, setSections, setUnresolvedPlaceholders, state]);

  const sections = useMemo(
    () => (guardedState ? sortByOrder(guardedState.sections) : []),
    [guardedState],
  );

  const activeSectionId = useMemo(() => {
    if (activeId && sections.some((item) => item.id === activeId)) return activeId;
    return sections[0]?.id ?? null;
  }, [activeId, sections]);

  const activeSection = useMemo(
    () => sections.find((item) => item.id === activeSectionId) ?? null,
    [sections, activeSectionId],
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
      const targetIds = new Set(targets.map((placeholder) => placeholder.id));
      const savedAt = new Date().toISOString();

      setSections((previous) =>
        previous.map((item) => {
          let nextContent = item.content;
          let changed = false;
          for (const target of targets) {
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
    [effectiveUnresolvedPlaceholders, setSections, setUnresolvedPlaceholders],
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
    selectSection: setActiveId,
    approval,
    canExport: captured
      ? currentRevision !== null &&
        approvedRevision === currentRevision &&
        effectiveGenerationIssues.length === 0
      : approval.allRequiredApproved && effectiveGenerationIssues.length === 0,
    section,
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
  };
}
