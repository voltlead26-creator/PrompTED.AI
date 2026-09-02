import type {
  Document,
  DocumentPlaceholderMetadata,
  DocumentStatus,
  SectionStatus,
} from "@prompted/shared/browser";
import { OwnerDispatchError } from "@/lib/browser-principal-state";
import type { OwnerDispatchLease } from "@/lib/browser-principal-state";
import { withOwnerSupabase } from "@/lib/supabase/owner-client";
import { sha256Text } from "./sections";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const DOCUMENT_STATUSES = new Set<DocumentStatus>([
  "draft",
  "edited",
  "approved",
  "exported",
  "archived",
]);
const SECTION_STATUSES = new Set<SectionStatus>(["draft", "edited", "approved", "locked"]);

function resolveTemplateUuid(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    candidate,
  )
    ? candidate.toLowerCase()
    : null;
}

export async function fetchDocument(
  id: string,
  lease: OwnerDispatchLease,
): Promise<Document | null> {
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase.from("documents").select("*").eq("id", id).maybeSingle(),
  );
  if (error) throw error;
  if (!data) return null;
  return data as Document;
}

export async function fetchDocumentByOutcomeId(
  outcomeId: string,
  userId: string,
  lease: OwnerDispatchLease,
): Promise<Document | null> {
  if (userId.trim().toLowerCase() !== lease.expectedUserId) {
    throw new Error("DOCUMENT_OWNER_CONTEXT_MISMATCH");
  }
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase
      .from("documents")
      .select("*")
      .eq("outcome_id", outcomeId)
      .eq("user_id", userId)
      .maybeSingle(),
  );
  if (error) throw error;
  if (!data) return null;
  return data as Document;
}

export async function upsertDocument(doc: {
  id: string;
  user_id: string;
  outcome_id?: string | null;
  title: string;
  status: DocumentStatus;
  template_id?: string | null;
  unresolved_placeholders?: DocumentPlaceholderMetadata[];
}, lease: OwnerDispatchLease): Promise<void> {
  if (doc.user_id.trim().toLowerCase() !== lease.expectedUserId) {
    throw new Error("DOCUMENT_OWNER_CONTEXT_MISMATCH");
  }
  const { error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase.from("documents").upsert(
      {
        id: doc.id,
        user_id: doc.user_id,
        outcome_id: doc.outcome_id ?? null,
        template_id: resolveTemplateUuid(doc.template_id),
        title: doc.title,
        status: doc.status,
        format: "word",
        is_template: false,
        unresolved_placeholders: doc.unresolved_placeholders ?? [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    ),
  );
  if (error) throw error;
}

export async function updateDocumentStatus(
  id: string,
  status: DocumentStatus,
  lease: OwnerDispatchLease,
): Promise<void> {
  const { error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase
      .from("documents")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id),
  );
  if (error) throw error;
}

export async function updateDocumentTitle(
  id: string,
  title: string,
  lease: OwnerDispatchLease,
): Promise<void> {
  const { error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase
      .from("documents")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", id),
  );
  if (error) throw error;
}

export interface LegacyWorkspaceDocumentState {
  title: string;
  status: DocumentStatus;
  template_id: string | null;
  unresolved_placeholders: DocumentPlaceholderMetadata[];
}

export interface LegacyWorkspaceSectionExpected {
  revision: number;
  content_sha256: string;
  name: string;
  order_index: number;
  status: SectionStatus;
  is_required: boolean;
}

export interface LegacyWorkspaceSectionDesired {
  name: string;
  order_index: number;
  status: SectionStatus;
  is_required: boolean;
}

export interface LegacyWorkspaceSectionPatch {
  id: string;
  expected: LegacyWorkspaceSectionExpected | null;
  desired: LegacyWorkspaceSectionDesired;
  /** Omission preserves an existing authoritative body. New sections require it. */
  content?: string;
}

export interface SaveLegacyWorkspaceV1Input {
  idempotencyKey: string;
  outcomeId: string;
  documentId: string;
  expectedDocumentRevision: number;
  expectedDocument: LegacyWorkspaceDocumentState | null;
  document: LegacyWorkspaceDocumentState;
  sections: LegacyWorkspaceSectionPatch[];
}

export interface LegacyWorkspaceSaveSectionReceipt {
  sectionId: string;
  status: SectionStatus;
  revision: number;
  approvedRevision: number | null;
  contentSha256: string;
  updatedAt: string;
}

export interface LegacyWorkspaceSaveReceiptV1 {
  contractVersion: "legacy-workspace-save.v1";
  state: "created" | "saved" | "unchanged";
  outcomeId: string;
  documentId: string;
  idempotencyKey: string;
  acceptedDocumentRevision: number;
  documentRevision: number;
  documentStatus: DocumentStatus;
  documentApprovedRevision: number | null;
  documentUpdatedAt: string;
  sections: LegacyWorkspaceSaveSectionReceipt[];
  committedAt: string;
  idempotentReplay: boolean;
}

/**
 * `ambiguous` means PostgreSQL may have committed before the browser lost the
 * acknowledgement. Callers must replay the exact command and must never fall
 * back to the former split-write path.
 */
export class LegacyWorkspaceSaveError extends Error {
  constructor(
    public readonly code: string,
    public readonly ambiguous: boolean,
  ) {
    super(code);
    this.name = "LegacyWorkspaceSaveError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasRequiredKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isNullableRevision(value: unknown, maximum: number): value is number | null {
  return value === null || (isPositiveInteger(value) && value <= maximum);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function validDocumentState(value: LegacyWorkspaceDocumentState): boolean {
  return (
    typeof value.title === "string" &&
    value.title.trim().length > 0 &&
    DOCUMENT_STATUSES.has(value.status) &&
    (value.template_id === null ||
      (UUID_PATTERN.test(value.template_id) && value.template_id === value.template_id.toLowerCase())) &&
    Array.isArray(value.unresolved_placeholders)
  );
}

function assertLegacyWorkspaceInput(input: SaveLegacyWorkspaceV1Input): void {
  const expectedCreation = input.expectedDocumentRevision === 0;
  if (
    !IDEMPOTENCY_PATTERN.test(input.idempotencyKey) ||
    !UUID_PATTERN.test(input.outcomeId) ||
    input.outcomeId !== input.outcomeId.toLowerCase() ||
    !UUID_PATTERN.test(input.documentId) ||
    input.documentId !== input.documentId.toLowerCase() ||
    !isNonNegativeInteger(input.expectedDocumentRevision) ||
    (expectedCreation ? input.expectedDocument !== null : input.expectedDocument === null) ||
    (input.expectedDocument !== null && !validDocumentState(input.expectedDocument)) ||
    !validDocumentState(input.document) ||
    !Array.isArray(input.sections) ||
    input.sections.length < 1 ||
    input.sections.length > 512
  ) {
    throw new LegacyWorkspaceSaveError("LEGACY_WORKSPACE_COMMAND_INVALID", false);
  }

  const ids = new Set<string>();
  for (const [index, section] of input.sections.entries()) {
    const expected = section.expected;
    if (
      !UUID_PATTERN.test(section.id) ||
      section.id !== section.id.toLowerCase() ||
      ids.has(section.id) ||
      typeof section.desired.name !== "string" ||
      !section.desired.name.trim() ||
      section.desired.order_index !== index ||
      !SECTION_STATUSES.has(section.desired.status) ||
      typeof section.desired.is_required !== "boolean" ||
      (section.content !== undefined && typeof section.content !== "string") ||
      (expected === null && section.content === undefined) ||
      (expectedCreation && expected !== null) ||
      (expected !== null &&
        (!isPositiveInteger(expected.revision) ||
          !SHA256_PATTERN.test(expected.content_sha256) ||
          typeof expected.name !== "string" ||
          !expected.name.trim() ||
          !isNonNegativeInteger(expected.order_index) ||
          !SECTION_STATUSES.has(expected.status) ||
          typeof expected.is_required !== "boolean"))
    ) {
      throw new LegacyWorkspaceSaveError("LEGACY_WORKSPACE_COMMAND_INVALID", false);
    }
    ids.add(section.id);
  }
}

function invalidReceipt(): never {
  // PostgreSQL may have committed before a malformed acknowledgement reached
  // the browser. Retain and replay the exact command instead of rotating it.
  throw new LegacyWorkspaceSaveError("LEGACY_WORKSPACE_RECEIPT_INVALID", true);
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalJson(item)]),
    );
  }
  return value;
}

export function canonicalJsonFingerprint(value: unknown): string {
  return JSON.stringify(canonicalJson(value));
}

function jsonEquivalent(left: unknown, right: unknown): boolean {
  return canonicalJsonFingerprint(left) === canonicalJsonFingerprint(right);
}

interface ExpectedLegacySectionTransition {
  id: string;
  revision: number;
  contentSha256: string;
  status: SectionStatus;
  approvedRevision: number | null | undefined;
  changed: boolean;
}

interface ExpectedLegacyWorkspaceTransition {
  state: "created" | "saved" | "unchanged";
  documentRevision: number;
  documentStatus: DocumentStatus;
  documentApprovedRevision: number | null | undefined;
  sections: ExpectedLegacySectionTransition[];
}

async function expectedLegacyWorkspaceTransition(
  input: SaveLegacyWorkspaceV1Input,
): Promise<ExpectedLegacyWorkspaceTransition> {
  const creation = input.expectedDocumentRevision === 0;
  let changedExistingSections = 0;
  let newSections = 0;
  const sections: ExpectedLegacySectionTransition[] = [];

  for (const patch of input.sections) {
    const contentSha256 =
      patch.content === undefined
        ? patch.expected?.content_sha256 ?? ""
        : await sha256Text(patch.content);
    if (patch.expected === null) {
      newSections += 1;
      sections.push({
        id: patch.id,
        revision: 1,
        contentSha256,
        status: patch.desired.status,
        approvedRevision: patch.desired.status === "approved" ? 1 : null,
        changed: true,
      });
      continue;
    }

    const contentChanged = contentSha256 !== patch.expected.content_sha256;
    const structureChanged =
      patch.desired.name !== patch.expected.name ||
      patch.desired.order_index !== patch.expected.order_index ||
      patch.desired.is_required !== patch.expected.is_required;
    const statusChanged = patch.desired.status !== patch.expected.status;
    const changed = contentChanged || structureChanged || statusChanged;
    if (changed) changedExistingSections += 1;
    const revision = patch.expected.revision + Number(changed);
    const invalidatesApproval = contentChanged || structureChanged;
    const status =
      invalidatesApproval && patch.desired.status === "approved"
        ? "edited"
        : patch.desired.status;
    let approvedRevision: number | null | undefined;
    if (invalidatesApproval) approvedRevision = null;
    else if (statusChanged && patch.desired.status === "approved") approvedRevision = revision;
    else if (statusChanged && patch.expected.status === "approved") approvedRevision = null;
    else approvedRevision = undefined;
    sections.push({
      id: patch.id,
      revision,
      contentSha256,
      status,
      approvedRevision,
      changed,
    });
  }

  if (creation) {
    return {
      state: "created",
      documentRevision: 1,
      documentStatus: input.document.status,
      documentApprovedRevision:
        input.document.status === "approved" || input.document.status === "exported" ? 1 : null,
      sections,
    };
  }

  const expectedDocument = input.expectedDocument;
  if (!expectedDocument) {
    throw new LegacyWorkspaceSaveError("LEGACY_WORKSPACE_COMMAND_INVALID", false);
  }
  const documentMetadataChanged =
    input.document.title !== expectedDocument.title ||
    input.document.template_id !== expectedDocument.template_id ||
    !jsonEquivalent(
      input.document.unresolved_placeholders,
      expectedDocument.unresolved_placeholders,
    );
  const structuralChange =
    changedExistingSections > 0 || newSections > 0 || documentMetadataChanged;
  const documentRevision =
    input.expectedDocumentRevision +
    changedExistingSections +
    Number(documentMetadataChanged || newSections > 0);
  const documentStatus =
    structuralChange &&
    (input.document.status === "approved" || input.document.status === "exported")
      ? "edited"
      : input.document.status;
  let documentApprovedRevision: number | null | undefined;
  if (structuralChange) documentApprovedRevision = null;
  else if (
    input.document.status !== expectedDocument.status &&
    input.document.status === "approved"
  ) documentApprovedRevision = documentRevision;
  else if (
    input.document.status !== expectedDocument.status &&
    input.document.status === "exported"
  ) documentApprovedRevision = documentRevision;
  else if (input.document.status !== expectedDocument.status) {
    documentApprovedRevision = null;
  }
  else documentApprovedRevision = undefined;

  return {
    state:
      structuralChange || input.document.status !== expectedDocument.status
        ? "saved"
        : "unchanged",
    documentRevision,
    documentStatus,
    documentApprovedRevision,
    sections,
  };
}

async function parseLegacyWorkspaceReceipt(
  value: unknown,
  input: SaveLegacyWorkspaceV1Input,
): Promise<LegacyWorkspaceSaveReceiptV1> {
  if (!isRecord(value) || !hasRequiredKeys(value, [
    "contract_version",
    "state",
    "outcome_id",
    "document_id",
    "idempotency_key",
    "accepted_document_revision",
    "document_revision",
    "document_status",
    "document_approved_revision",
    "document_updated_at",
    "sections",
    "committed_at",
    "idempotent_replay",
  ])) invalidReceipt();

  const expectedTransition = await expectedLegacyWorkspaceTransition(input);
  const state = value.state;
  const documentRevision = value.document_revision;
  const documentStatus = value.document_status;
  if (
    value.contract_version !== "legacy-workspace-save.v1" ||
    (state !== "created" && state !== "saved" && state !== "unchanged") ||
    value.outcome_id !== input.outcomeId ||
    value.document_id !== input.documentId ||
    value.idempotency_key !== input.idempotencyKey ||
    value.accepted_document_revision !== input.expectedDocumentRevision ||
    !isPositiveInteger(documentRevision) ||
    documentRevision !== expectedTransition.documentRevision ||
    documentStatus !== expectedTransition.documentStatus ||
    !DOCUMENT_STATUSES.has(documentStatus as DocumentStatus) ||
    !isNullableRevision(value.document_approved_revision, documentRevision) ||
    (expectedTransition.documentApprovedRevision !== undefined &&
      value.document_approved_revision !== expectedTransition.documentApprovedRevision) ||
    !isIsoTimestamp(value.document_updated_at) ||
    !isIsoTimestamp(value.committed_at) ||
    typeof value.idempotent_replay !== "boolean" ||
    !Array.isArray(value.sections) ||
    value.sections.length !== input.sections.length ||
    state !== expectedTransition.state
  ) invalidReceipt();

  const expectedIds = new Set(input.sections.map((section) => section.id));
  const expectedSections = new Map(
    expectedTransition.sections.map((section) => [section.id, section]),
  );
  const receiptIds = new Set<string>();
  const sections = value.sections.map((raw, index): LegacyWorkspaceSaveSectionReceipt => {
    if (!isRecord(raw) || !hasRequiredKeys(raw, [
      "section_id",
      "status",
      "revision",
      "approved_revision",
      "content_sha256",
      "updated_at",
    ])) invalidReceipt();
    const sectionId = raw.section_id;
    const revision = raw.revision;
    const expectedSection = typeof sectionId === "string" ? expectedSections.get(sectionId) : null;
    if (
      typeof sectionId !== "string" ||
      !UUID_PATTERN.test(sectionId) ||
      !expectedIds.has(sectionId) ||
      sectionId !== input.sections[index]?.id ||
      receiptIds.has(sectionId) ||
      !expectedSection ||
      raw.status !== expectedSection.status ||
      !SECTION_STATUSES.has(raw.status as SectionStatus) ||
      revision !== expectedSection.revision ||
      !isNullableRevision(raw.approved_revision, revision) ||
      (expectedSection.approvedRevision !== undefined &&
        raw.approved_revision !== expectedSection.approvedRevision) ||
      typeof raw.content_sha256 !== "string" ||
      raw.content_sha256 !== expectedSection.contentSha256 ||
      !isIsoTimestamp(raw.updated_at)
    ) invalidReceipt();
    receiptIds.add(sectionId);
    return {
      sectionId,
      status: raw.status as SectionStatus,
      revision,
      approvedRevision: raw.approved_revision as number | null,
      contentSha256: raw.content_sha256,
      updatedAt: raw.updated_at,
    };
  });
  if (receiptIds.size !== expectedIds.size) invalidReceipt();

  return {
    contractVersion: "legacy-workspace-save.v1",
    state,
    outcomeId: input.outcomeId,
    documentId: input.documentId,
    idempotencyKey: input.idempotencyKey,
    acceptedDocumentRevision: input.expectedDocumentRevision,
    documentRevision,
    documentStatus: documentStatus as DocumentStatus,
    documentApprovedRevision: value.document_approved_revision as number | null,
    documentUpdatedAt: value.document_updated_at,
    sections,
    committedAt: value.committed_at,
    idempotentReplay: value.idempotent_replay,
  };
}

function databaseErrorCode(error: { message?: string; code?: string } | null): string {
  return (
    error?.message?.match(/\b(LEGACY_WORKSPACE_[A-Z0-9_]+|CAPTURED_DOCUMENT_OPERATION_REQUIRED)\b/)?.[1] ??
    (error?.code ? `DATABASE_${error.code}` : "LEGACY_WORKSPACE_ACKNOWLEDGEMENT_UNKNOWN")
  );
}

/** Persists one complete legacy document aggregate in one PostgreSQL transaction. */
export async function saveLegacyWorkspaceV1(
  input: SaveLegacyWorkspaceV1Input,
  lease: OwnerDispatchLease,
): Promise<LegacyWorkspaceSaveReceiptV1> {
  assertLegacyWorkspaceInput(input);
  try {
    const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
      await supabase.rpc("save_own_legacy_workspace_v1", {
        p_idempotency_key: input.idempotencyKey,
        p_outcome_id: input.outcomeId,
        p_document_id: input.documentId,
        p_expected_document_revision: input.expectedDocumentRevision,
        p_expected_document: input.expectedDocument,
        p_document: input.document,
        p_sections: input.sections,
      }),
    );
    if (error) {
      const code = databaseErrorCode(error);
      const deterministic =
        code.startsWith("LEGACY_WORKSPACE_") ||
        code === "CAPTURED_DOCUMENT_OPERATION_REQUIRED" ||
        code === "DATABASE_PGRST202" ||
        /^DATABASE_(22023|23503|23505|28000|40001|42501|55000)$/.test(code);
      throw new LegacyWorkspaceSaveError(code, !deterministic);
    }
    return await parseLegacyWorkspaceReceipt(data, input);
  } catch (error) {
    if (error instanceof LegacyWorkspaceSaveError) throw error;
    if (error instanceof OwnerDispatchError) throw error;
    throw new LegacyWorkspaceSaveError("LEGACY_WORKSPACE_ACKNOWLEDGEMENT_UNKNOWN", true);
  }
}
