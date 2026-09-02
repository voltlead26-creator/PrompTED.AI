import type { Section, SectionStatus, SectionVersion } from "@prompted/shared/browser";
import type { OwnerDispatchLease } from "@/lib/browser-principal-state";
import { withOwnerSupabase } from "@/lib/supabase/owner-client";
import {
  MAX_WORKSPACE_SECTION_BODY_BYTES,
  WORKSPACE_SECTION_BODY_VERSION,
  type WorkspaceSectionBodyV1,
} from "@/lib/workspace-initial-state";

export interface PersistedSection extends Section {
  revision?: number;
  approved_revision?: number | null;
  ledger_binding_status?: "legacy_unversioned" | "captured";
  section_key?: string | null;
}

export interface LegacySectionEditSuggestion {
  state: "ready";
  operation_id: string;
  document_id: string;
  section_id: string;
  accepted_section_revision: number;
  current_section_revision: number;
  result_sha256: string;
  suggested_content: string;
  applied_candidate_content: string;
  applied_candidate_sha256: string;
  changes: string[];
  action: "improve" | "shorten" | "expand" | "change_tone" | "add_detail";
  scope: "section" | "selection";
  stale: boolean;
  recoverable: boolean;
}

export interface LegacySectionEditTerminalState {
  state:
    | "accepted"
    | "provider_dispatched"
    | "stale"
    | "applied"
    | "applied_then_superseded"
    | "discarded"
    | "cancelled"
    | "terminal_failure"
    | "reconciliation_required";
  operation_id: string;
  terminal_code?: string | null;
  code?: "APPLIED" | "APPLIED_THEN_SUPERSEDED" | "LEGACY_SECTION_EDIT_STALE" | null;
  current_section_revision?: number;
  current_content_sha256?: string;
  applied_section_revision?: number | null;
  recoverable: false;
}

export type LatestLegacySectionEdit = LegacySectionEditSuggestion | LegacySectionEditTerminalState;

export class LegacySectionEditMutationError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(code);
    this.name = "LegacySectionEditMutationError";
  }
}

function publicRpcCode(error: { message?: string; code?: string } | null): string {
  return (
    error?.message?.match(/\b([A-Z][A-Z0-9_]{3,})\b/)?.[1] ??
    (error?.code ? `DATABASE_${error.code}` : "LEGACY_SECTION_EDIT_FAILED")
  );
}

async function sectionEditRpc<T>(
  name: string,
  args: Record<string, unknown>,
  lease: OwnerDispatchLease,
): Promise<T> {
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase.rpc(name, args),
  );
  if (error || data === null || data === undefined) {
    const code = publicRpcCode(error);
    throw new LegacySectionEditMutationError(
      code,
      code.includes("STALE") || code.includes("TIMEOUT") || code.includes("UNAVAILABLE"),
    );
  }
  return data as T;
}

export async function fetchSections(
  documentId: string,
  lease: OwnerDispatchLease,
): Promise<Section[]> {
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase
      .from("sections")
      .select("*")
      .eq("document_id", documentId)
      .order("order_index", { ascending: true }),
  );
  if (error) throw error;
  if (!data) return [];
  return data as Section[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SECTION_STATUSES = new Set<SectionStatus>(["draft", "edited", "approved", "locked"]);
const SECTION_STATES = new Set([
  "final",
  "needs_clarification",
  "interactive_placeholder",
  "neutral_fallback",
  "omitted_optional",
  "failed_validation",
]);

function invalidWorkspaceSectionBody(): never {
  throw new Error("WORKSPACE_SECTION_BODY_INVALID");
}

/** Loads exactly one owner-bound body after deliberate activation. The exact
 * document and section revisions, byte length, and digest must still match the
 * initial snapshot before the body can become authoritative client state. */
export async function fetchWorkspaceSectionBody(input: {
  outcomeId: string;
  sectionId: string;
  expectedDocumentRevision: number;
  expectedSectionRevision: number;
}, lease: OwnerDispatchLease): Promise<WorkspaceSectionBodyV1> {
  if (
    !UUID_PATTERN.test(input.outcomeId) ||
    !UUID_PATTERN.test(input.sectionId) ||
    !Number.isInteger(input.expectedDocumentRevision) ||
    input.expectedDocumentRevision <= 0 ||
    !Number.isInteger(input.expectedSectionRevision) ||
    input.expectedSectionRevision <= 0
  )
    invalidWorkspaceSectionBody();

  const { data, error } = await withOwnerSupabase(lease, async (supabase) => {
    const rpc = supabase.rpc as unknown as (
      name: "get_workspace_section_body_v1",
      args: {
        p_outcome_id: string;
        p_section_id: string;
        p_expected_document_revision: number;
        p_expected_section_revision: number;
      },
    ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
    return await rpc("get_workspace_section_body_v1", {
      p_outcome_id: input.outcomeId,
      p_section_id: input.sectionId,
      p_expected_document_revision: input.expectedDocumentRevision,
      p_expected_section_revision: input.expectedSectionRevision,
    });
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("WORKSPACE_SECTION_BODY_UNAVAILABLE");
  }

  const body = data as Record<string, unknown>;
  const content = body.content;
  const contentLength = body.content_length;
  const contentSha256 = body.content_sha256;
  const status = body.status;
  const approvedRevision = body.approved_revision;
  const ledgerBindingStatus = body.ledger_binding_status;
  const sectionKey = body.section_key;
  const sectionState = body.section_state;
  const updatedAt = body.updated_at;
  if (
    body.contract_version !== WORKSPACE_SECTION_BODY_VERSION ||
    body.outcome_id !== input.outcomeId ||
    typeof body.document_id !== "string" ||
    !UUID_PATTERN.test(body.document_id) ||
    body.document_revision !== input.expectedDocumentRevision ||
    body.section_id !== input.sectionId ||
    body.section_revision !== input.expectedSectionRevision ||
    typeof content !== "string" ||
    !Number.isInteger(contentLength) ||
    Number(contentLength) < 0 ||
    Number(contentLength) > MAX_WORKSPACE_SECTION_BODY_BYTES ||
    new TextEncoder().encode(content).length !== contentLength ||
    typeof contentSha256 !== "string" ||
    !SHA256_PATTERN.test(contentSha256) ||
    typeof status !== "string" ||
    !SECTION_STATUSES.has(status as SectionStatus) ||
    !(
      approvedRevision === null ||
      (Number.isInteger(approvedRevision) &&
        Number(approvedRevision) > 0 &&
        Number(approvedRevision) <= input.expectedSectionRevision)
    ) ||
    !(ledgerBindingStatus === "legacy_unversioned" || ledgerBindingStatus === "captured") ||
    !(sectionKey === null || (typeof sectionKey === "string" && sectionKey.trim().length > 0)) ||
    !(
      sectionState === null ||
      (typeof sectionState === "string" && SECTION_STATES.has(sectionState))
    ) ||
    typeof updatedAt !== "string" ||
    !Number.isFinite(Date.parse(updatedAt)) ||
    (await sha256Text(content)) !== contentSha256
  )
    invalidWorkspaceSectionBody();

  lease.assertCurrent();
  return {
    contractVersion: WORKSPACE_SECTION_BODY_VERSION,
    outcomeId: input.outcomeId,
    documentId: body.document_id,
    documentRevision: input.expectedDocumentRevision,
    sectionId: input.sectionId,
    sectionRevision: input.expectedSectionRevision,
    content,
    contentSha256,
    contentLength: Number(contentLength),
    status: status as SectionStatus,
    approvedRevision: approvedRevision as number | null,
    ledgerBindingStatus,
    sectionKey: sectionKey as string | null,
    sectionState: sectionState as WorkspaceSectionBodyV1["sectionState"],
    updatedAt,
  };
}

/** Loads historical bodies only when the user opens History. */
export async function fetchSectionVersionHistory(
  sectionId: string,
  lease: OwnerDispatchLease,
): Promise<SectionVersion[]> {
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase
      .from("sections")
      .select("version_history")
      .eq("id", sectionId)
      .maybeSingle(),
  );
  if (error) throw error;
  return Array.isArray(data?.version_history) ? (data.version_history as SectionVersion[]) : [];
}

export async function updateSectionContent(
  id: string,
  content: string,
  status: SectionStatus,
  lease: OwnerDispatchLease,
): Promise<void> {
  const { error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase
      .from("sections")
      .update({ content, status, updated_at: new Date().toISOString() })
      .eq("id", id),
  );
  if (error) throw error;
}

export async function updateSectionStatus(
  id: string,
  status: SectionStatus,
  lease: OwnerDispatchLease,
): Promise<void> {
  const { error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase
      .from("sections")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id),
  );
  if (error) throw error;
}

/**
 * Upsert all sections for a document in one round-trip. Used by the autosave
 * path — creates rows on first save and updates them on subsequent saves.
 */
export async function upsertSections(
  sections: Section[],
  lease: OwnerDispatchLease,
): Promise<PersistedSection[]> {
  if (sections.length === 0) return [];
  if (sections.some((section) =>
    section.user_id.trim().toLowerCase() !== lease.expectedUserId
  )) {
    throw new Error("SECTION_OWNER_CONTEXT_MISMATCH");
  }
  const rows = sections.map((s) => ({
    id: s.id,
    document_id: s.document_id,
    user_id: s.user_id,
    name: s.name,
    order_index: s.order_index,
    content: s.content,
    status: s.status,
    is_required: s.is_required,
    updated_at: new Date().toISOString(),
  }));
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase
      .from("sections")
      .upsert(rows, { onConflict: "id", defaultToNull: false })
      .select("*"),
  );
  if (error) throw error;
  return (data ?? []) as PersistedSection[];
}

export async function sha256Text(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export interface LegacySectionMutationTruth {
  section_id: string;
  document_id: string;
  section_content: string;
  section_content_sha256: string;
  section_status: SectionStatus;
  section_revision: number;
  section_approved_revision: number | null;
  section_updated_at: string;
  document_status: "draft" | "edited" | "approved" | "exported" | "archived";
  document_revision: number;
  document_approved_revision: number | null;
  document_updated_at: string;
  idempotent_replay: boolean;
}

export interface LegacySectionSaveResult extends LegacySectionMutationTruth {
  state: "saved";
}

export async function saveLegacySection(input: {
  sectionId: string;
  expectedSectionRevision: number;
  expectedContent: string;
  content: string;
  status: SectionStatus;
}, lease: OwnerDispatchLease): Promise<LegacySectionSaveResult> {
  const expectedContentSha256 = await sha256Text(input.expectedContent);
  lease.assertCurrent();
  return await sectionEditRpc("save_legacy_section", {
    p_section_id: input.sectionId,
    p_expected_section_revision: input.expectedSectionRevision,
    p_expected_content_sha256: expectedContentSha256,
    p_content: input.content,
    p_status: input.status,
  }, lease);
}

export interface LegacySectionApplyResult extends LegacySectionMutationTruth {
  state: "applied" | "applied_then_superseded";
  code: "APPLIED" | "APPLIED_THEN_SUPERSEDED";
  operation_id: string;
  applied_section_revision: number;
}

export function applyLegacySectionEdit(input: {
  operationId: string;
  expectedSectionRevision: number;
  resultSha256: string;
  content: string;
}, lease: OwnerDispatchLease): Promise<LegacySectionApplyResult> {
  return sectionEditRpc("apply_legacy_section_edit", {
    p_operation_id: input.operationId,
    p_expected_section_revision: input.expectedSectionRevision,
    p_result_sha256: input.resultSha256,
    p_content: input.content,
  }, lease);
}

export interface LegacySectionDiscardResult {
  operation_id: string;
  state: "discarded";
  idempotent_replay: boolean;
}

export function discardLegacySectionEdit(input: {
  operationId: string;
  resultSha256: string;
}, lease: OwnerDispatchLease): Promise<LegacySectionDiscardResult> {
  return sectionEditRpc("discard_legacy_section_edit", {
    p_operation_id: input.operationId,
    p_result_sha256: input.resultSha256,
  }, lease);
}

export async function fetchLatestLegacySectionEdit(
  sectionId: string,
  lease: OwnerDispatchLease,
): Promise<LatestLegacySectionEdit | null> {
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase.rpc("get_latest_legacy_section_edit", {
      p_section_id: sectionId,
    }),
  );
  if (error) {
    throw new LegacySectionEditMutationError(publicRpcCode(error), false);
  }
  return data ? (data as LatestLegacySectionEdit) : null;
}

/**
 * Persist a new section order in one round-trip. Only `order_index` is
 * touched. Supabase upsert reindexes every affected row at once rather than
 * rewriting content row-by-row.
 */
export async function persistSectionOrder(
  sections: Pick<Section, "id" | "order_index">[],
  lease: OwnerDispatchLease,
): Promise<void> {
  const updates = sections.map((s) => ({
    id: s.id,
    order_index: s.order_index,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase
      .from("sections")
      .upsert(updates, { onConflict: "id", defaultToNull: false }),
  );
  if (error) throw error;
}
