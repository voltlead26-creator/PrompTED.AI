"use client";

import {
  generateDocumentStream,
  type GenerateDocumentInput,
  type ApiRequestContext,
  type DocumentDraftSectionEvent,
  type DocumentSectionEvent,
  type MissingInfoEvent,
  type UnresolvedPlaceholdersEvent,
} from "@prompted/shared/api-client";
import type { DocumentPlaceholderMetadata, Section } from "@prompted/shared/browser";
import { isVisiblyEmpty } from "@prompted/shared/visible-content";
import type { GenerationDefaults, GenerationTemplate } from "./document-generation-catalogue";
import type { PendingOutcome, StoredWorkspace, WorkspaceDocumentState } from "./workspace-store";
import { validateFinishedSection } from "./output-integrity";

const SEED_SCAFFOLD_MARKER = "TED will replace this scaffold";
const TEMPLATE_DRAFT_MARKER = "prompted:template-draft";

function isSeedScaffold(content: string): boolean {
  return content.includes(SEED_SCAFFOLD_MARKER);
}

function isTemplateDraft(content: string): boolean {
  return content.includes(TEMPLATE_DRAFT_MARKER);
}

function clearNonFinalGeneratedContent(content: string): string {
  return isSeedScaffold(content) || isTemplateDraft(content) ? "" : content;
}

function clearNonFinalSections(sections: StoredWorkspace["sections"]): StoredWorkspace["sections"] {
  return sections.map((section) => {
    const content = clearNonFinalGeneratedContent(section.content);
    return content === section.content ? section : { ...section, content };
  });
}

function hasNonFinalGeneratedContent(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.length > 0 && (isSeedScaffold(trimmed) || isTemplateDraft(trimmed));
}

function hasUserOrGeneratedContent(content: string): boolean {
  if (isVisiblyEmpty(content)) return false;
  const trimmed = content.trim();
  return !isSeedScaffold(trimmed) && !isTemplateDraft(trimmed);
}

function safePlaceholderId(value: string): string {
  const clean = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return clean || "section";
}

function safePlaceholderLabel(value: string): string {
  const clean = value.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
  return clean || "Section";
}

function sectionKeyForPlaceholder(section: Section, index: number): string {
  return (
    section.key ??
    (normaliseSectionName(section.name).replace(/\s+/g, "_") || `section_${index + 1}`)
  );
}

function workspaceFallbackPlaceholder(
  state: WorkspaceDocumentState,
  section: Section,
  sectionKey: string,
): DocumentPlaceholderMetadata {
  const label = `${safePlaceholderLabel(section.name)} needs your input`;
  return {
    id: `${safePlaceholderId(state.templateId ?? "document")}.${safePlaceholderId(sectionKey)}.section_content`,
    profileKey: state.templateId ?? "document",
    sectionKey,
    informationKey: "section_content",
    label,
    question: `TED could not safely produce final wording for "${safePlaceholderLabel(section.name)}" from the available facts. Add the confirmed information you want included in this section.`,
    factType: "section_content",
    requiredForExport: section.is_required !== false,
    neutralReplacementOptions: [],
  };
}

function placeholderToken(placeholder: DocumentPlaceholderMetadata): string {
  return `{{TED_PLACEHOLDER:${placeholder.id}:${placeholder.label}}}`;
}

function preferNonEmpty(primary: string | undefined | null, fallback: string): string {
  return primary?.trim() ? primary : fallback;
}

export function storedFromState(outcomeId: string, state: WorkspaceDocumentState): StoredWorkspace {
  const sections = clearNonFinalSections(state.sections);
  const hasContent = sections.some((section) => hasUserOrGeneratedContent(section.content));

  return {
    documentId: state.documentId,
    outcomeId,
    title: state.title,
    situation: state.situation,
    status: state.status,
    sections,
    generated: hasContent ? state.generated : false,
    templateId: state.templateId ?? undefined,
    conversationContext: state.conversationContext,
    uploadContext: state.uploadContext,
    unresolvedPlaceholders: state.unresolvedPlaceholders,
  };
}

export function stateFromStored(
  workspace: StoredWorkspace,
  fallback: {
    templateId: string | null;
    conversationContext: string;
    uploadContext: string;
  },
): WorkspaceDocumentState {
  const sections = clearNonFinalSections(workspace.sections);
  const hasContent = sections.some((section) => hasUserOrGeneratedContent(section.content));

  return {
    documentId: workspace.documentId,
    title: workspace.title,
    situation: workspace.situation,
    status: workspace.status,
    sections,
    generated: hasContent ? (workspace.generated ?? true) : false,
    templateId: workspace.templateId ?? fallback.templateId,
    conversationContext: preferNonEmpty(
      workspace.conversationContext,
      fallback.conversationContext,
    ),
    uploadContext: preferNonEmpty(workspace.uploadContext, fallback.uploadContext),
    unresolvedPlaceholders: workspace.unresolvedPlaceholders ?? [],
  };
}

export function pendingDefaults(pending: PendingOutcome | null): GenerationDefaults {
  const requestedName = pending?.templateName ?? "Untitled document";

  return {
    templateName: requestedName,
    templateId: pending?.templateId ?? null,
    conversationContext: pending?.conversationContext ?? "",
    uploadContext: pending?.uploadContext ?? "",
    uploadId: pending?.uploadId,
  };
}

export function sectionsNeedingInitialGeneration(
  state: WorkspaceDocumentState,
): WorkspaceDocumentState["sections"] {
  return state.sections.filter(
    (section) => section.is_required !== false && !hasUserOrGeneratedContent(section.content),
  );
}

export function shouldGenerateInitialDraft(
  state: WorkspaceDocumentState,
  pending: PendingOutcome | null,
): boolean {
  const hasContext =
    Boolean((pending?.conversationContext ?? state.conversationContext).trim()) ||
    Boolean((pending?.uploadContext ?? state.uploadContext).trim()) ||
    Boolean((pending?.situation ?? state.situation).trim());
  const missingRequiredSections = sectionsNeedingInitialGeneration(state);
  if (missingRequiredSections.length > 0) return hasContext;

  const hasContent = state.sections.some((section) => hasUserOrGeneratedContent(section.content));
  const hasOnlyNonFinalContent = state.sections.some((section) =>
    hasNonFinalGeneratedContent(section.content),
  );
  const generatedAlreadyCompleted = state.generated && !hasOnlyNonFinalContent;
  return hasContext && !hasContent && !generatedAlreadyCompleted;
}

export function applyRequiredSectionFallbacks(
  state: WorkspaceDocumentState,
): WorkspaceDocumentState {
  const existingPlaceholders = new Map(
    (state.unresolvedPlaceholders ?? []).map((placeholder) => [placeholder.id, placeholder]),
  );
  let changed = false;
  const now = new Date().toISOString();

  const sections = state.sections.map((section, index) => {
    if (hasUserOrGeneratedContent(section.content)) {
      return section;
    }

    const sectionKey = sectionKeyForPlaceholder(section, index);
    const placeholder = workspaceFallbackPlaceholder(state, section, sectionKey);
    existingPlaceholders.set(placeholder.id, placeholder);
    changed = true;

    return {
      ...section,
      key: section.key ?? sectionKey,
      content: placeholderToken(placeholder),
      status: "draft" as const,
      updated_at: now,
    };
  });

  if (!changed) return state;

  return {
    ...state,
    sections,
    generated: true,
    unresolvedPlaceholders: Array.from(existingPlaceholders.values()),
  };
}

function normaliseSectionName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

export function applyGeneratedSection(
  state: WorkspaceDocumentState,
  event: Pick<DocumentSectionEvent, "key" | "label" | "content"> & {
    type?: string;
  },
): WorkspaceDocumentState {
  const integrity = validateFinishedSection(event.content);
  if (!integrity.valid) return state;

  const eventLabel = normaliseSectionName(event.label);
  const eventKey = normaliseSectionName(event.key.replace(/_/g, " "));

  let matchingIndex = state.sections.findIndex(
    (section) => section.key && section.key === event.key,
  );

  if (matchingIndex === -1) {
    matchingIndex = state.sections.findIndex((section) => {
      const sectionName = normaliseSectionName(section.name);
      return sectionName === eventLabel || sectionName === eventKey;
    });
  }

  if (matchingIndex === -1) {
    matchingIndex = state.sections.findIndex((section) => {
      const sectionName = normaliseSectionName(section.name);
      return (
        sectionName.includes(eventLabel) ||
        eventLabel.includes(sectionName) ||
        sectionName.includes(eventKey) ||
        eventKey.includes(sectionName)
      );
    });
  }

  if (matchingIndex === -1) {
    matchingIndex = state.sections.findIndex(
      (section) => !hasUserOrGeneratedContent(section.content),
    );
  }

  if (matchingIndex === -1) return state;

  const eventDisplayLabel = event.label?.trim();
  const now = new Date().toISOString();
  return {
    ...state,
    sections: state.sections.map((section, index) =>
      index === matchingIndex
        ? {
            ...section,
            key: section.key ?? event.key,
            name: eventDisplayLabel || section.name,
            content: event.content.trim(),
            status: "draft",
            updated_at: now,
          }
        : section,
    ),
  };
}

function findSectionMeta(
  template: GenerationTemplate | undefined,
  sectionName: string,
): { hint?: string; vital?: string[]; improver?: string[] } {
  if (!template) return {};
  const wanted = normaliseSectionName(sectionName);

  const exact = template.sections.find(
    (candidate) => normaliseSectionName(candidate.name) === wanted,
  );
  if (exact) {
    return {
      hint: exact.description,
      vital: exact.vital,
      improver: exact.improver,
    };
  }

  const partial = template.sections.find((candidate) => {
    const name = normaliseSectionName(candidate.name);
    return name.includes(wanted) || wanted.includes(name);
  });
  return partial
    ? {
        hint: partial.description,
        vital: partial.vital,
        improver: partial.improver,
      }
    : {};
}

interface GenerationSection {
  key: string;
  label: string;
  required: boolean;
  hint?: string;
  vital?: string[];
  improver?: string[];
}

/**
 * Workspace documents deliberately use one production engine. The artifact
 * pipeline remains available for artifact-native outputs such as action plans,
 * checklists and reports, but it no longer bypasses the document pipeline's
 * section planning, factual grounding, targeted repair and missing-info rules.
 */
export async function streamInitialDraft(params: {
  outcomeId: string;
  state: WorkspaceDocumentState;
  pending: PendingOutcome | null;
  generationRequestId:
    | string
    | ((input: Omit<GenerateDocumentInput, "generation_request_id">) => Promise<string>);
  signal?: AbortSignal;
  requestContext: ApiRequestContext;
  onSection: (event: DocumentSectionEvent) => void;
  onDraftSection?: (event: DocumentDraftSectionEvent) => void;
  onMissingInfo?: (event: MissingInfoEvent) => void;
  onUnresolvedPlaceholders?: (event: UnresolvedPlaceholdersEvent) => void;
}): Promise<void> {
  const baseDefaults = pendingDefaults(params.pending);
  const { resolveGenerationTemplate } = await import("./document-generation-catalogue");
  const { defaults, template } = resolveGenerationTemplate(params.pending, baseDefaults);
  const uploadContext = preferNonEmpty(defaults.uploadContext, params.state.uploadContext);
  const conversationContext = preferNonEmpty(
    defaults.conversationContext,
    params.state.conversationContext,
  );
  const situation = preferNonEmpty(params.pending?.situation, params.state.situation);

  const missingRequiredSections = sectionsNeedingInitialGeneration(params.state);
  const hasPopulatedSibling = params.state.sections.some((section) =>
    hasUserOrGeneratedContent(section.content),
  );
  const sourceSections =
    missingRequiredSections.length > 0 && hasPopulatedSibling
      ? missingRequiredSections
      : params.state.sections;
  const recoveryContext =
    missingRequiredSections.length > 0 && hasPopulatedSibling
      ? [
          "Existing final wording — preserve its voice and do not rewrite it:",
          ...params.state.sections
            .filter((section) => hasUserOrGeneratedContent(section.content))
            .map((section) => `[${section.name}]\n${section.content.trim()}`),
        ]
          .join("\n\n")
          .slice(0, 12_000)
      : "";
  const generationConversationContext = recoveryContext
    ? [conversationContext.slice(0, 16_000), recoveryContext].filter(Boolean).join("\n\n")
    : conversationContext;

  const sections: GenerationSection[] = sourceSections.map((section, index) => {
    const canonicalKey =
      section.key ??
      (normaliseSectionName(section.name).replace(/\s+/g, "_") || `section_${index + 1}`);
    const meta = findSectionMeta(template, section.name);
    return {
      key: canonicalKey,
      label: section.name,
      required: section.is_required !== false,
      hint: meta.hint,
      vital: meta.vital,
      improver: meta.improver,
    };
  });

  const generationInput: Omit<GenerateDocumentInput, "generation_request_id"> = {
    template_id: defaults.templateId ?? defaults.templateName,
    situation,
    conversation_context: generationConversationContext,
    upload_context: uploadContext,
    upload_id: defaults.uploadId,
    sections,
    domain: template?.domain,
    structure_type: template?.structure_type,
    advice_boundary: template?.advice_boundary,
    design_bespoke: !template,
    document_name: defaults.templateName,
  };
  const generationRequestId = typeof params.generationRequestId === "function"
    ? await params.generationRequestId(generationInput)
    : params.generationRequestId;

  await generateDocumentStream(
    { ...generationInput, generation_request_id: generationRequestId },
    (event) => {
      if (validateFinishedSection(event.content).valid) {
        params.onSection(event);
      }
    },
    params.requestContext,
    undefined,
    params.onMissingInfo,
    params.onUnresolvedPlaceholders,
    (event) => {
      if (validateFinishedSection(event.content).valid) {
        params.onDraftSection?.(event);
      }
    },
  );
}
