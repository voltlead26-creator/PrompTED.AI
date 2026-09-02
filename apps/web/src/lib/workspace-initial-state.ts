import type { DocumentPlaceholderMetadata, Section } from "@prompted/shared/browser";
import type { DurableGenerationOperationState } from "@prompted/shared/document-operation";

export const WORKSPACE_SNAPSHOT_VERSION = "workspace-snapshot.v1" as const;
export const WORKSPACE_SECTION_BODY_VERSION = "workspace-section-body.v1" as const;
export const MAX_WORKSPACE_SNAPSHOT_SECTIONS = 512;
export const MAX_WORKSPACE_SECTION_BODY_BYTES = 1_048_576;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DOCUMENT_STATUSES = new Set(["draft", "edited", "approved", "exported", "archived"]);
const SECTION_STATUSES = new Set(["draft", "edited", "approved", "locked"]);
const LEDGER_BINDING_STATUSES = new Set(["legacy_unversioned", "captured"]);
const SECTION_STATES = new Set([
  "final",
  "needs_clarification",
  "interactive_placeholder",
  "neutral_fallback",
  "omitted_optional",
  "failed_validation",
]);

export interface WorkspaceSectionMetadata {
  contentLoaded: boolean;
  contentSha256: string;
  contentLength: number;
  revision: number;
  approvedRevision: number | null;
  ledgerBindingStatus: "legacy_unversioned" | "captured";
  sectionKey: string | null;
  sectionState:
    | "final"
    | "needs_clarification"
    | "interactive_placeholder"
    | "neutral_fallback"
    | "omitted_optional"
    | "failed_validation"
    | null;
}

export interface WorkspaceSectionBodyV1 {
  contractVersion: typeof WORKSPACE_SECTION_BODY_VERSION;
  outcomeId: string;
  documentId: string;
  documentRevision: number;
  sectionId: string;
  sectionRevision: number;
  content: string;
  contentSha256: string;
  contentLength: number;
  status: Section["status"];
  approvedRevision: number | null;
  ledgerBindingStatus: "legacy_unversioned" | "captured";
  sectionKey: string | null;
  sectionState: WorkspaceSectionMetadata["sectionState"];
  updatedAt: string;
}

type SnapshotSection = Section & {
  content_loaded: boolean;
  content_sha256: string;
  content_length: number;
  revision: number;
  approved_revision: number | null;
  ledger_binding_status: "legacy_unversioned" | "captured";
  section_key: string | null;
  section_state: WorkspaceSectionMetadata["sectionState"];
};

function invalidSnapshot(): never {
  throw new Error("WORKSPACE_SNAPSHOT_INVALID");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidSnapshot();
  return value as Record<string, unknown>;
}

function string(value: unknown, allowBlank = false): string {
  if (typeof value !== "string" || (!allowBlank && !value.trim())) invalidSnapshot();
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : string(value);
}

function uuid(value: unknown): string {
  const result = string(value);
  if (!UUID_PATTERN.test(result)) invalidSnapshot();
  return result;
}

function positiveInteger(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) <= 0) invalidSnapshot();
  return Number(value);
}

function nonNegativeInteger(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 0) invalidSnapshot();
  return Number(value);
}

function nullablePositiveInteger(value: unknown): number | null {
  return value === null ? null : positiveInteger(value);
}

function isoTimestamp(value: unknown): string {
  const result = string(value);
  if (!Number.isFinite(Date.parse(result))) invalidSnapshot();
  return result;
}

function stringArray(value: unknown, maxItems = MAX_WORKSPACE_SNAPSHOT_SECTIONS): string[] {
  if (
    !Array.isArray(value) ||
    value.length > maxItems ||
    value.some(
      (item) =>
        typeof item !== "string" || !item.trim() || new TextEncoder().encode(item).length > 256,
    )
  ) {
    invalidSnapshot();
  }
  return [...value] as string[];
}

function placeholders(value: unknown): DocumentPlaceholderMetadata[] {
  if (
    !Array.isArray(value) ||
    value.length > 256 ||
    new TextEncoder().encode(JSON.stringify(value)).length > 262_144
  )
    invalidSnapshot();
  return value.map((raw) => {
    const item = record(raw);
    const options = item.neutralReplacementOptions;
    if (
      !Array.isArray(options) ||
      options.length > 16 ||
      typeof item.requiredForExport !== "boolean"
    )
      invalidSnapshot();
    const parsedOptions = options.map((rawOption) => {
      const option = record(rawOption);
      if (
        typeof option.clearsExportWarning !== "boolean" ||
        typeof option.regenerateSurroundingWording !== "boolean"
      )
        invalidSnapshot();
      return {
        id: string(option.id),
        label: string(option.label),
        value: string(option.value, true),
        suitability: string(option.suitability, true),
        clearsExportWarning: option.clearsExportWarning,
        regenerateSurroundingWording: option.regenerateSurroundingWording,
      };
    });
    return {
      id: string(item.id),
      profileKey: string(item.profileKey),
      sectionKey: string(item.sectionKey),
      informationKey: string(item.informationKey),
      label: string(item.label),
      question: string(item.question),
      factType: string(item.factType),
      ...(item.automaticFallback === undefined
        ? {}
        : { automaticFallback: string(item.automaticFallback, true) }),
      requiredForExport: item.requiredForExport,
      ...(item.sharedResolutionKey === undefined
        ? {}
        : { sharedResolutionKey: string(item.sharedResolutionKey) }),
      neutralReplacementOptions: parsedOptions,
    };
  });
}

/** Legacy sections have no marker and remain fully loaded. Snapshot sections
 * must carry the complete marker set or are treated as unavailable. */
export function workspaceSectionMetadata(section: Section): WorkspaceSectionMetadata | null {
  const candidate = section as Partial<SnapshotSection>;
  if (typeof candidate.content_loaded !== "boolean") return null;
  if (
    typeof candidate.content_sha256 !== "string" ||
    !SHA256_PATTERN.test(candidate.content_sha256) ||
    !Number.isInteger(candidate.content_length) ||
    Number(candidate.content_length) < 0 ||
    !Number.isInteger(candidate.revision) ||
    Number(candidate.revision) <= 0 ||
    !LEDGER_BINDING_STATUSES.has(String(candidate.ledger_binding_status)) ||
    !(
      candidate.approved_revision === null ||
      (Number.isInteger(candidate.approved_revision) && Number(candidate.approved_revision) > 0)
    ) ||
    !(
      candidate.section_key === null ||
      (typeof candidate.section_key === "string" && candidate.section_key.trim().length > 0)
    ) ||
    !(candidate.section_state === null || SECTION_STATES.has(String(candidate.section_state)))
  ) {
    return null;
  }
  return {
    contentLoaded: candidate.content_loaded,
    contentSha256: candidate.content_sha256,
    contentLength: Number(candidate.content_length),
    revision: Number(candidate.revision),
    approvedRevision: candidate.approved_revision ?? null,
    ledgerBindingStatus:
      candidate.ledger_binding_status as WorkspaceSectionMetadata["ledgerBindingStatus"],
    sectionKey: candidate.section_key ?? null,
    sectionState: candidate.section_state ?? null,
  };
}

export function isWorkspaceSectionContentLoaded(section: Section): boolean {
  const marker = (section as Section & { content_loaded?: unknown }).content_loaded;
  if (typeof marker !== "boolean") return true;
  return workspaceSectionMetadata(section)?.contentLoaded === true;
}

export function materialiseWorkspaceSectionBody(
  section: Section,
  body: WorkspaceSectionBodyV1,
): Section {
  const metadata = workspaceSectionMetadata(section);
  if (
    !metadata ||
    metadata.contentLoaded ||
    section.id !== body.sectionId ||
    section.document_id !== body.documentId ||
    metadata.revision !== body.sectionRevision ||
    metadata.contentSha256 !== body.contentSha256 ||
    metadata.contentLength !== body.contentLength
  ) {
    throw new Error("WORKSPACE_SECTION_BODY_INVALID");
  }
  return {
    ...section,
    content: body.content,
    status: body.status,
    updated_at: body.updatedAt,
    content_loaded: true,
    content_sha256: body.contentSha256,
    content_length: body.contentLength,
    revision: body.sectionRevision,
    approved_revision: body.approvedRevision,
    ledger_binding_status: body.ledgerBindingStatus,
    section_key: body.sectionKey,
    section_state: body.sectionState,
  } as SnapshotSection;
}

export type InitialPersistenceState = "anonymous" | "not_found" | "persisted" | "unavailable";

export interface InitialWorkspaceDocument {
  documentId: string;
  title: string;
  situation: string;
  status: string;
  sections: Section[];
  generated: boolean;
  templateId: string | null;
  conversationContext: string;
  uploadContext: string;
  unresolvedPlaceholders: DocumentPlaceholderMetadata[];
}

export interface InitialWorkspaceIntake {
  outcomeId: string;
  situation: string;
  templateName: string;
  templateId: string | null;
  conversationContext: string;
  uploadContext: string;
  /** Additive for rolling compatibility with snapshots created before provenance hydration. */
  uploadId?: string;
}

/**
 * Small, serialisable workflow snapshot streamed with the outcome route.
 * Optional panels and historical revisions are deliberately excluded.
 */
export interface WorkspaceInitialState {
  workspace: InitialWorkspaceDocument | null;
  intake: InitialWorkspaceIntake | null;
  truth: {
    authenticated: boolean;
    ownerUserId: string | null;
    persistence: InitialPersistenceState;
    documentId: string | null;
    currentRevision: number | null;
    approvedRevision: number | null;
    ledgerBindingStatus: "legacy_unversioned" | "captured" | null;
    ledgerVersion: string | null;
    operationId: string | null;
    operationRevision: number | null;
    operationStatus: DurableGenerationOperationState | null;
    operationMessage: string | null;
    safeNextAction: string | null;
    persistedAt: string | null;
    snapshotVersion?: typeof WORKSPACE_SNAPSHOT_VERSION;
    activeSectionId?: string | null;
    approvalId?: string | null;
    approvalRevision?: number | null;
    approvalValidated?: boolean;
    operationRetryable?: boolean;
    safeSectionKeys?: string[];
    blockedSectionKeys?: string[];
    operationDocumentRevision?: number | null;
    exportEligible?: boolean;
    exportBlockingReasons?: string[];
  };
}

/** Adapts the versioned database result into the existing public route shape.
 * Only the selected section has content; every omitted body remains explicit. */
export function adaptWorkspaceSnapshotV1(
  value: unknown,
  expectedOwnerUserId?: string,
): WorkspaceInitialState {
  const snapshot = record(value);
  if (snapshot.contract_version !== WORKSPACE_SNAPSHOT_VERSION) invalidSnapshot();
  const ownerUserId = uuid(snapshot.owner_user_id);
  if (expectedOwnerUserId !== undefined && ownerUserId !== uuid(expectedOwnerUserId)) {
    invalidSnapshot();
  }

  const outcome = record(snapshot.outcome);
  const outcomeId = uuid(outcome.id);
  const situation = string(outcome.situation, true);
  const conversationContext = string(outcome.conversation_context, true);
  const uploadContext = string(outcome.upload_context, true);
  const uploadId =
    outcome.upload_id === null || outcome.upload_id === undefined
      ? undefined
      : uuid(outcome.upload_id);
  const outcomeTemplateId = outcome.template_id === null ? null : string(outcome.template_id);
  const templateName = string(
    outcome.template_name ?? outcomeTemplateId ?? "Untitled document",
  );
  if (
    new TextEncoder().encode(situation).length > 262_144 ||
    new TextEncoder().encode(conversationContext).length > 262_144 ||
    new TextEncoder().encode(uploadContext).length > 262_144
  )
    invalidSnapshot();

  const intake: InitialWorkspaceIntake = {
    outcomeId,
    situation,
    templateName,
    templateId: outcomeTemplateId,
    conversationContext,
    uploadContext,
    ...(uploadId ? { uploadId } : {}),
  };

  if (snapshot.document === null) {
    const missingEligibility = record(snapshot.export_eligibility);
    if (
      snapshot.active_section_id !== null ||
      !Array.isArray(snapshot.sections) ||
      snapshot.sections.length !== 0 ||
      snapshot.operation !== null ||
      snapshot.approval !== null ||
      missingEligibility.eligible !== false ||
      JSON.stringify(missingEligibility.blocking_reasons) !== '["document_not_found"]'
    ) {
      invalidSnapshot();
    }
    return {
      workspace: null,
      intake,
      truth: {
        authenticated: true,
        ownerUserId,
        persistence: "not_found",
        documentId: null,
        currentRevision: null,
        approvedRevision: null,
        ledgerBindingStatus: null,
        ledgerVersion: null,
        operationId: null,
        operationRevision: null,
        operationStatus: null,
        operationMessage: null,
        safeNextAction: null,
        persistedAt: null,
        snapshotVersion: WORKSPACE_SNAPSHOT_VERSION,
        activeSectionId: null,
        approvalId: null,
        approvalRevision: null,
        approvalValidated: false,
        exportEligible: false,
        exportBlockingReasons: ["document_not_found"],
      },
    };
  }

  const document = record(snapshot.document);
  const documentId = uuid(document.id);
  const currentRevision = positiveInteger(document.current_revision);
  const approvedRevision = nullablePositiveInteger(document.approved_revision);
  if (approvedRevision !== null && approvedRevision > currentRevision) invalidSnapshot();
  const ledgerBindingStatus = string(document.ledger_binding_status);
  if (!LEDGER_BINDING_STATUSES.has(ledgerBindingStatus)) invalidSnapshot();
  const status = string(document.status);
  if (!DOCUMENT_STATUSES.has(status)) invalidSnapshot();
  const ledgerVersion = nullableString(document.ledger_version);
  const templateId = nullableString(document.template_id);
  const title = string(document.title);
  if (new TextEncoder().encode(title).length > 500) invalidSnapshot();
  const unresolvedPlaceholders = placeholders(document.unresolved_placeholders);
  const persistedAt = isoTimestamp(document.updated_at);
  if (typeof document.has_generated_content !== "boolean") invalidSnapshot();

  if (
    !Array.isArray(snapshot.sections) ||
    snapshot.sections.length > MAX_WORKSPACE_SNAPSHOT_SECTIONS
  ) {
    invalidSnapshot();
  }
  const rawSections = snapshot.sections;
  const sectionIds = new Set<string>();
  let loadedCount = 0;
  const sections = rawSections.map((raw, index) => {
    const source = record(raw);
    const id = uuid(source.id);
    if (sectionIds.has(id) || uuid(source.document_id) !== documentId) invalidSnapshot();
    sectionIds.add(id);
    const userId = uuid(source.user_id);
    if (userId !== ownerUserId) invalidSnapshot();
    const contentLoaded = source.content_loaded;
    if (typeof contentLoaded !== "boolean") invalidSnapshot();
    const contentSha256 = string(source.content_sha256);
    if (!SHA256_PATTERN.test(contentSha256)) invalidSnapshot();
    const contentLength = nonNegativeInteger(source.content_length);
    const content = source.content;
    if (contentLoaded) {
      if (
        typeof content !== "string" ||
        new TextEncoder().encode(content).length !== contentLength ||
        contentLength > MAX_WORKSPACE_SECTION_BODY_BYTES
      )
        invalidSnapshot();
      loadedCount += 1;
    } else if (content !== null) {
      invalidSnapshot();
    }
    const sectionStatus = string(source.status);
    if (!SECTION_STATUSES.has(sectionStatus)) invalidSnapshot();
    const sectionLedgerBindingStatus = string(source.ledger_binding_status);
    if (!LEDGER_BINDING_STATUSES.has(sectionLedgerBindingStatus)) invalidSnapshot();
    const sectionState = source.section_state === null ? null : string(source.section_state);
    if (sectionState !== null && !SECTION_STATES.has(sectionState)) invalidSnapshot();
    const sectionKey = source.section_key === null ? null : string(source.section_key);
    if (
      sectionLedgerBindingStatus !== ledgerBindingStatus ||
      (ledgerBindingStatus === "captured" && (sectionKey === null || sectionState === null)) ||
      (ledgerBindingStatus === "legacy_unversioned" &&
        (sectionKey !== null || sectionState !== null))
    )
      invalidSnapshot();
    const key = source.key === null || source.key === undefined ? undefined : string(source.key);
    if (
      (sectionKey !== null && new TextEncoder().encode(sectionKey).length > 256) ||
      (key !== undefined && new TextEncoder().encode(key).length > 256)
    )
      invalidSnapshot();
    const orderIndex = nonNegativeInteger(source.order_index);
    if (index > 0) {
      const prior = record(rawSections[index - 1]);
      const priorOrder = nonNegativeInteger(prior.order_index);
      if (
        orderIndex < priorOrder ||
        (orderIndex === priorOrder && id.localeCompare(uuid(prior.id)) < 0)
      ) {
        invalidSnapshot();
      }
    }
    const revision = positiveInteger(source.revision);
    const sectionApprovedRevision = nullablePositiveInteger(source.approved_revision);
    if (sectionApprovedRevision !== null && sectionApprovedRevision > revision) invalidSnapshot();
    return {
      id,
      document_id: documentId,
      user_id: userId,
      ...(key ? { key } : {}),
      name: (() => {
        const name = string(source.name);
        if (new TextEncoder().encode(name).length > 1_024) invalidSnapshot();
        return name;
      })(),
      order_index: orderIndex,
      content: contentLoaded ? (content as string) : "",
      content_loaded: contentLoaded,
      content_sha256: contentSha256,
      content_length: contentLength,
      status: sectionStatus,
      version_history: [],
      is_required:
        source.is_required === true
          ? true
          : source.is_required === false
            ? false
            : invalidSnapshot(),
      created_at: isoTimestamp(source.created_at),
      updated_at: isoTimestamp(source.updated_at),
      revision,
      approved_revision: sectionApprovedRevision,
      ledger_binding_status: sectionLedgerBindingStatus,
      section_key: sectionKey,
      section_state: sectionState,
    } as SnapshotSection;
  });

  const activeSectionId =
    snapshot.active_section_id === null ? null : uuid(snapshot.active_section_id);
  if (
    (sections.length === 0 && (activeSectionId !== null || loadedCount !== 0)) ||
    (sections.length > 0 &&
      (activeSectionId === null ||
        loadedCount !== 1 ||
        !sections.some(
          (section) => section.id === activeSectionId && isWorkspaceSectionContentLoaded(section),
        )))
  )
    invalidSnapshot();

  const operation = snapshot.operation === null ? null : record(snapshot.operation);
  const operationId = operation ? uuid(operation.operation_id) : null;
  const operationRevision = operation ? positiveInteger(operation.operation_revision) : null;
  const operationStatus = operation ? string(operation.status) : null;
  const operationStates = new Set<DurableGenerationOperationState>([
    "accepted",
    "awaiting_clarification",
    "awaiting_capacity",
    "generating",
    "validating",
    "persisting",
    "ready_for_review",
    "retryable_failure",
    "terminal_failure",
    "cancelled",
  ]);
  if (
    operationStatus !== null &&
    !operationStates.has(operationStatus as DurableGenerationOperationState)
  ) {
    invalidSnapshot();
  }
  const operationMessage = operation
    ? operation.message === null
      ? null
      : string(operation.message, true)
    : null;
  const safeNextAction = operation
    ? operation.safe_next_action === null
      ? null
      : string(operation.safe_next_action, true)
    : null;
  if (operation && typeof operation.retryable !== "boolean") invalidSnapshot();
  const operationRetryable = operation ? operation.retryable === true : false;
  const safeSectionKeys = operation ? stringArray(operation.safe_section_keys) : [];
  const blockedSectionKeys = operation ? stringArray(operation.blocked_section_keys) : [];
  const operationDocumentRevision = operation
    ? nullablePositiveInteger(operation.latest_document_revision)
    : null;
  if (operation) isoTimestamp(operation.updated_at);

  const approval = snapshot.approval === null ? null : record(snapshot.approval);
  const approvalId = approval ? uuid(approval.approval_id) : null;
  const approvalRevision = approval ? positiveInteger(approval.document_revision) : null;
  const approvalValidated = approval ? approval.validation_passed === true : false;
  if (approval && typeof approval.validation_passed !== "boolean") invalidSnapshot();
  if (approval) isoTimestamp(approval.approved_at);

  const eligibility = record(snapshot.export_eligibility);
  if (typeof eligibility.eligible !== "boolean") invalidSnapshot();
  const exportBlockingReasons = stringArray(eligibility.blocking_reasons, 32);
  if (
    (eligibility.eligible && exportBlockingReasons.length > 0) ||
    (!eligibility.eligible && exportBlockingReasons.length === 0) ||
    (operationDocumentRevision !== null && operationDocumentRevision > currentRevision)
  )
    invalidSnapshot();
  if (ledgerBindingStatus === "legacy_unversioned") {
    if (operation !== null || approval !== null) invalidSnapshot();
  } else {
    if (approvalRevision !== null && approvalRevision !== currentRevision) invalidSnapshot();
    if (
      eligibility.eligible &&
      (operationStatus !== "ready_for_review" ||
        operationDocumentRevision !== currentRevision ||
        approvedRevision !== currentRevision ||
        approvalRevision !== currentRevision ||
        !approvalValidated)
    )
      invalidSnapshot();
  }

  return {
    workspace: {
      documentId,
      title,
      situation,
      status,
      sections,
      generated: document.has_generated_content,
      templateId,
      conversationContext,
      uploadContext,
      unresolvedPlaceholders,
    },
    intake,
    truth: {
      authenticated: true,
      ownerUserId,
      persistence: "persisted",
      documentId,
      currentRevision,
      approvedRevision,
      ledgerBindingStatus: ledgerBindingStatus as "legacy_unversioned" | "captured",
      ledgerVersion,
      operationId,
      operationRevision,
      operationStatus: operationStatus as DurableGenerationOperationState | null,
      operationMessage,
      safeNextAction,
      persistedAt,
      snapshotVersion: WORKSPACE_SNAPSHOT_VERSION,
      activeSectionId,
      approvalId,
      approvalRevision,
      approvalValidated,
      operationRetryable,
      safeSectionKeys,
      blockedSectionKeys,
      operationDocumentRevision,
      exportEligible: eligibility.eligible,
      exportBlockingReasons,
    },
  };
}
