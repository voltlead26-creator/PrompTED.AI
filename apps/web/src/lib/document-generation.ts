"use client";

import {
  ApiError,
  generateDocumentStream,
  type GenerateDocumentInput,
  type ApiRequestContext,
  type DocumentDraftSectionEvent,
  type DocumentDesignEvent,
  type DocumentSectionEvent,
  type MissingInfoEvent,
  type UnresolvedPlaceholdersEvent,
} from "@prompted/shared/api-client";
import type { DocumentPlaceholderMetadata, Section } from "@prompted/shared/browser";
import { isVisiblyEmpty } from "@prompted/shared/visible-content";
import type { GenerationDefaults, GenerationTemplate } from "./document-generation-catalogue";
import type { PendingOutcome, StoredWorkspace, WorkspaceDocumentState } from "./workspace-store";
import { validateFinishedSection } from "./output-integrity";
import { withOwnerDispatchSignal } from "./browser-principal-state";

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

export interface BoundDocumentSectionEvent extends DocumentSectionEvent {
  /** Assigned from the accepted workspace, never from provider output. */
  targetSectionId: string;
}

export interface DocumentGenerationResult {
  documentId: string;
  requestId: string;
  scope: Array<{ key: string; sectionId: string }>;
  sections: BoundDocumentSectionEvent[];
  missingInfo: MissingInfoEvent["sections"];
  unresolvedPlaceholders: DocumentPlaceholderMetadata[];
}

function invalidGenerationScope(): never {
  throw new ApiError(409, "DOCUMENT_GENERATION_SCOPE_INVALID", {});
}

function namedGenerationKey(section: Section): string {
  const name = normaliseSectionName(section.name);
  return name.trim() ? name.replace(/\s+/g, "_") : "";
}

export function applyGeneratedSection(
  state: WorkspaceDocumentState,
  event: Pick<DocumentSectionEvent, "key" | "label" | "content"> & {
    type?: string;
    targetSectionId?: string;
  },
): WorkspaceDocumentState {
  const integrity = validateFinishedSection(event.content);
  if (!integrity.valid) return state;

  if (event.type !== undefined && event.type !== "section") invalidGenerationScope();
  const bound = "targetSectionId" in event;
  if (bound && (typeof event.targetSectionId !== "string" || !event.targetSectionId.trim())) {
    invalidGenerationScope();
  }
  const matches = state.sections.flatMap((section, index) => {
    const matchesIdentity = bound
      ? section.id === event.targetSectionId
      : section.key !== undefined && section.key !== null
        ? section.key === event.key
        : Boolean(namedGenerationKey(section)) && namedGenerationKey(section) === event.key;
    return matchesIdentity ? [index] : [];
  });
  if (matches.length !== 1) invalidGenerationScope();
  const matchingIndex = matches[0];
  const now = new Date().toISOString();
  return {
    ...state,
    sections: state.sections.map((section, index) =>
      index === matchingIndex
        ? {
            ...section,
            key: section.key ?? event.key,
            content: event.content.trim(),
            status: "draft",
            updated_at: now,
          }
        : section,
    ),
  };
}

/** Builds one candidate without mutating state or a persistence destination. */
export function applyGeneratedResult(
  state: WorkspaceDocumentState,
  result: DocumentGenerationResult,
): WorkspaceDocumentState {
  if (
    state.documentId !== result.documentId ||
    result.scope.length === 0 ||
    new Set(state.sections.map((section) => section.id)).size !== state.sections.length ||
    result.scope.length !== result.sections.length ||
    new Set(result.scope.map((binding) => binding.sectionId)).size !== result.scope.length ||
    new Set(result.scope.map((binding) => binding.key)).size !== result.scope.length
  ) {
    invalidGenerationScope();
  }
  const ids = new Set(result.scope.map((binding) => binding.sectionId));
  const keys = new Set(result.scope.map((binding) => binding.key));
  for (const binding of result.scope) {
    const section = state.sections.find((item) => item.id === binding.sectionId);
    if (!section || (section.key != null && section.key !== binding.key)) invalidGenerationScope();
  }
  if (
    state.sections.some((section) => !ids.has(section.id) && section.key && keys.has(section.key))
  ) {
    invalidGenerationScope();
  }
  let candidate = state;
  for (const [index, event] of result.sections.entries()) {
    const binding = result.scope[index];
    if (!binding || binding.key !== event.key || binding.sectionId !== event.targetSectionId) {
      invalidGenerationScope();
    }
    const integrity = validateFinishedSection(event.content);
    if (!integrity.valid || isVisiblyEmpty(event.content)) {
      throw new ApiError(502, "DOCUMENT_FINAL_WORDING_INVALID", {
        section_key: event.key,
        reason: integrity.code ?? "blank",
      });
    }
    candidate = applyGeneratedSection(candidate, event);
  }
  const previous = state.unresolvedPlaceholders ?? [];
  const retained = previous.filter((placeholder) => !keys.has(placeholder.sectionKey));
  const removed = previous.filter((placeholder) => keys.has(placeholder.sectionKey));
  const incoming = result.unresolvedPlaceholders;
  for (const placeholder of incoming) {
    const accepted = previous.find((item) => item.id === placeholder.id);
    if (
      accepted &&
      ((accepted.requiredForExport && !placeholder.requiredForExport) ||
        placeholder.neutralReplacementOptions.some(
          (option) =>
            !accepted.neutralReplacementOptions.some(
              (prior) =>
                prior.id === option.id &&
                prior.label === option.label &&
                prior.value === option.value &&
                prior.suitability === option.suitability &&
                prior.clearsExportWarning === option.clearsExportWarning &&
                prior.regenerateSurroundingWording === option.regenerateSurroundingWording,
            ),
        ))
    ) {
      invalidGenerationScope();
    }
  }
  if (
    incoming.some((placeholder) => !keys.has(placeholder.sectionKey)) ||
    new Set([...retained, ...incoming].map((placeholder) => placeholder.id)).size !==
      retained.length + incoming.length ||
    removed.some((placeholder) =>
      state.sections.some(
        (section) =>
          !ids.has(section.id) && section.content.includes(`TED_PLACEHOLDER:${placeholder.id}:`),
      ),
    )
  ) {
    invalidGenerationScope();
  }
  for (const event of result.sections) {
    let undeclared = event.content;
    for (const placeholder of incoming.filter((item) => item.sectionKey === event.key)) {
      const token = placeholderToken(placeholder);
      if (!undeclared.includes(token)) invalidGenerationScope();
      undeclared = undeclared.split(token).join("");
    }
    if (undeclared.includes("TED_PLACEHOLDER:")) invalidGenerationScope();
  }
  mergeGenerationMissingInfo([], result);
  return {
    ...candidate,
    generated: true,
    status: "draft",
    unresolvedPlaceholders: [...retained, ...incoming],
  };
}

export function mergeGenerationMissingInfo(
  current: MissingInfoEvent["sections"],
  result: DocumentGenerationResult,
): MissingInfoEvent["sections"] {
  const keys = new Set(result.scope.map((binding) => binding.key));
  if (result.missingInfo.some((entry) => !keys.has(entry.key))) invalidGenerationScope();
  return [...current.filter((entry) => !keys.has(entry.key)), ...result.missingInfo];
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
export async function streamInitialDraft(
  params: {
    outcomeId: string;
    state: WorkspaceDocumentState;
    pending: PendingOutcome | null;
    /** Exact existing IDs for a scoped repair; the full workspace remains available for validation. */
    sectionIds?: string[];
    generationRequestId:
      | string
      | ((input: Omit<GenerateDocumentInput, "generation_request_id">) => Promise<string>);
    signal?: AbortSignal;
    requestContext: ApiRequestContext;
    onDraftSection?: (event: DocumentDraftSectionEvent) => void | Promise<void>;
  } & (
    | {
        onComplete: (result: DocumentGenerationResult) => void | Promise<void>;
        onSection?: never;
        onMissingInfo?: never;
        onUnresolvedPlaceholders?: never;
      }
    | {
        onComplete?: never;
        onSection: (event: BoundDocumentSectionEvent) => void | Promise<void>;
        onMissingInfo?: (event: MissingInfoEvent) => void | Promise<void>;
        onUnresolvedPlaceholders?: (event: UnresolvedPlaceholdersEvent) => void | Promise<void>;
      }
  ),
): Promise<void> {
  const requestContext = withOwnerDispatchSignal(
    params.requestContext,
    params.signal ?? params.requestContext.signal,
  );
  requestContext.assertCurrent();
  if (
    (params.onComplete &&
      (params.onSection || params.onMissingInfo || params.onUnresolvedPlaceholders)) ||
    (!params.onComplete && !params.onSection)
  )
    invalidGenerationScope();
  const acceptedPending = params.pending ?? {
    situation: params.state.situation,
    templateName: params.state.title,
    templateId: params.state.templateId ?? undefined,
    conversationContext: params.state.conversationContext,
    uploadContext: params.state.uploadContext,
  };
  const baseDefaults = pendingDefaults(acceptedPending);
  const { resolveGenerationTemplate } = await import("./document-generation-catalogue");
  const { defaults, template } = resolveGenerationTemplate(acceptedPending, baseDefaults);
  const uploadContext = preferNonEmpty(defaults.uploadContext, params.state.uploadContext);
  const conversationContext = preferNonEmpty(
    defaults.conversationContext,
    params.state.conversationContext,
  );
  const situation = preferNonEmpty(params.pending?.situation, params.state.situation);

  const missingRequiredSections = sectionsNeedingInitialGeneration(params.state);
  const requestedSectionIds = params.sectionIds;
  if (
    requestedSectionIds &&
    (requestedSectionIds.length === 0 ||
      new Set(requestedSectionIds).size !== requestedSectionIds.length ||
      requestedSectionIds.some((id) => !params.state.sections.some((section) => section.id === id)))
  ) {
    invalidGenerationScope();
  }
  const hasPopulatedSibling = params.state.sections.some((section) =>
    hasUserOrGeneratedContent(section.content),
  );
  const sourceSections = requestedSectionIds
    ? params.state.sections.filter((section) => requestedSectionIds.includes(section.id))
    : missingRequiredSections.length > 0 && hasPopulatedSibling
      ? missingRequiredSections
      : params.state.sections;
  const recoveryContext =
    !params.sectionIds && missingRequiredSections.length > 0 && hasPopulatedSibling
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
  if (
    !params.state.documentId.trim() ||
    params.state.sections.some(
      (section) => !section.id.trim() || section.document_id !== params.state.documentId,
    ) ||
    new Set(params.state.sections.map((section) => section.id)).size !==
      params.state.sections.length ||
    sections.length < 1 ||
    sections.length > 20 ||
    new Set(sections.map((section) => section.key)).size !== sections.length ||
    sections.some(
      (section) =>
        !section.key.trim() ||
        section.key !== section.key.trim() ||
        section.key.length > 80 ||
        !section.label.trim() ||
        section.label.length > 120,
    )
  ) {
    invalidGenerationScope();
  }
  const scope = sections.map((section, index) => {
    const source = sourceSections[index];
    if (!source) invalidGenerationScope();
    return { key: section.key, sectionId: source.id };
  });
  const bindings = new Map(scope.map((binding) => [binding.key, binding.sectionId]));
  for (const binding of scope) {
    if (
      params.state.sections.some(
        (section) =>
          section.id !== binding.sectionId &&
          (section.key ?? namedGenerationKey(section)) === binding.key,
      )
    )
      invalidGenerationScope();
  }

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
  const generationRequestId =
    typeof params.generationRequestId === "function"
      ? await params.generationRequestId(generationInput)
      : params.generationRequestId;

  // The shared parser accepts the transport contract. This compatibility
  // boundary also checks every final body before a consumer can mutate state.
  const acceptedEvents: Array<
    DocumentSectionEvent | MissingInfoEvent | UnresolvedPlaceholdersEvent
  > = [];
  let design: DocumentDesignEvent | undefined;
  await generateDocumentStream(
    { ...generationInput, generation_request_id: generationRequestId },
    (event) => {
      acceptedEvents.push(event);
    },
    requestContext,
    (event) => {
      design = event;
    },
    (event) => {
      acceptedEvents.push(event);
    },
    (event) => {
      acceptedEvents.push(event);
    },
    async (event) => {
      if (validateFinishedSection(event.content).valid) {
        await params.onDraftSection?.(event);
      }
    },
  );
  requestContext.assertCurrent();
  if (
    design &&
    (design.sections.length !== sections.length ||
      design.sections.some(
        (section, index) =>
          section.key !== sections[index]?.key ||
          section.label !== sections[index]?.label ||
          section.required !== sections[index]?.required,
      ))
  ) {
    throw new ApiError(409, "DOCUMENT_DESIGN_MAPPING_REQUIRED", {});
  }
  const boundEvents: Array<
    BoundDocumentSectionEvent | MissingInfoEvent | UnresolvedPlaceholdersEvent
  > = [];
  for (const event of acceptedEvents) {
    if (event.type !== "section") {
      boundEvents.push(event);
      continue;
    }
    const targetSectionId = bindings.get(event.key);
    if (!targetSectionId) invalidGenerationScope();
    const integrity = validateFinishedSection(event.content);
    if (!integrity.valid || isVisiblyEmpty(event.content)) {
      throw new ApiError(502, "DOCUMENT_FINAL_WORDING_INVALID", {
        section_key: event.key,
        reason: integrity.code ?? "blank",
      });
    }
    boundEvents.push({
      type: "section",
      key: event.key,
      label: event.label,
      content: event.content,
      targetSectionId,
    });
  }
  const finalSections = boundEvents.filter(
    (event): event is BoundDocumentSectionEvent => event.type === "section",
  );
  if (
    finalSections.length !== scope.length ||
    finalSections.some(
      (event, index) =>
        event.key !== scope[index]?.key || event.targetSectionId !== scope[index]?.sectionId,
    )
  ) {
    invalidGenerationScope();
  }
  const result: DocumentGenerationResult = {
    documentId: params.state.documentId,
    requestId: generationRequestId,
    scope,
    sections: finalSections,
    missingInfo:
      boundEvents.find((event): event is MissingInfoEvent => event.type === "missing_info")
        ?.sections ?? [],
    unresolvedPlaceholders:
      boundEvents.find(
        (event): event is UnresolvedPlaceholdersEvent => event.type === "unresolved_placeholders",
      )?.placeholders ?? [],
  };
  applyGeneratedResult(params.state, result);
  if (params.onComplete) {
    requestContext.assertCurrent();
    await params.onComplete(result);
    requestContext.assertCurrent();
    return;
  }
  for (const event of boundEvents) {
    requestContext.assertCurrent();
    switch (event.type) {
      case "section":
        await params.onSection(event);
        break;
      case "missing_info":
        await params.onMissingInfo?.(event);
        break;
      case "unresolved_placeholders":
        await params.onUnresolvedPlaceholders?.(event);
        break;
    }
    requestContext.assertCurrent();
  }
}
