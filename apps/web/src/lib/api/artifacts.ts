import {
  TED_ARTIFACT_SCHEMA_VERSION,
  type PersistedTedArtifact,
  type PersistedTedArtifactBlock,
  type TedArtifact,
  type TedArtifactBlock,
  type TedArtifactSectionState,
  type TedSupportingReference,
} from "@prompted/shared";
import type { OwnerDispatchLease } from "@/lib/browser-principal-state";
import { withOwnerSupabase } from "@/lib/supabase/owner-client";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ARTIFACT_KINDS = new Set([
  "document", "action_plan", "checklist", "report", "recommendation",
  "research_brief", "job_match",
]);
const ARTIFACT_STATUSES = new Set([
  "draft", "ready", "needs_review", "approved", "archived",
]);
const BLOCK_KINDS = new Set([
  "section", "action", "recommendation", "finding", "reference",
]);
const APPROVAL_STATUSES = new Set(["draft", "approved", "locked"]);
const SECTION_STATES = new Set<TedArtifactSectionState>([
  "final", "needs_clarification", "interactive_placeholder",
  "neutral_fallback", "omitted_optional", "failed_validation",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function parseReference(
  value: unknown,
  expected: { artifactId: string; blockId: string; userId: string },
): TedSupportingReference | null {
  const reference = asRecord(value);
  if (
    !reference ||
    reference.artifact_id !== expected.artifactId ||
    reference.block_id !== expected.blockId ||
    reference.user_id !== expected.userId ||
    typeof reference.label !== "string" ||
    typeof reference.url !== "string" ||
    typeof reference.publisher !== "string" ||
    typeof reference.retrieved_at !== "string" ||
    typeof reference.supports !== "string" ||
    typeof reference.summary !== "string"
  ) return null;
  return {
    label: reference.label,
    url: reference.url,
    publisher: reference.publisher,
    retrieved_at: reference.retrieved_at,
    supports: reference.supports,
    summary: reference.summary,
  };
}

function parsePersistedBlock(
  value: unknown,
  expected: { artifactId: string; userId: string; references?: TedSupportingReference[] },
): PersistedTedArtifactBlock | null {
  const block = asRecord(value);
  const payload = block ? asRecord(block.payload) : null;
  if (
    !block || !isUuid(block.id) || block.artifact_id !== expected.artifactId ||
    block.user_id !== expected.userId || !BLOCK_KINDS.has(String(block.kind)) ||
    typeof block.stable_key !== "string" || !block.stable_key.trim() ||
    !isNullableString(block.parent_block_id) ||
    (block.parent_block_id !== null && !isUuid(block.parent_block_id)) ||
    typeof block.heading !== "string" || !Number.isInteger(block.order_index) ||
    !payload || !APPROVAL_STATUSES.has(String(block.approval_status)) ||
    !isNullableString(block.completed_at) || !isNullableString(block.due_date) ||
    !isPositiveInteger(block.revision) ||
    (block.ledger_binding_status !== "legacy_unversioned" &&
      block.ledger_binding_status !== "captured") ||
    !isNullableString(block.ledger_section_key) ||
    !isNullableString(block.ledger_version) ||
    (block.is_required !== null && typeof block.is_required !== "boolean") ||
    (block.section_state !== null &&
      !SECTION_STATES.has(block.section_state as TedArtifactSectionState)) ||
    (block.approved_revision !== null && !isPositiveInteger(block.approved_revision)) ||
    !isNullableString(block.source_block_id) ||
    (block.source_block_id !== null && !isUuid(block.source_block_id)) ||
    !isNullableString(block.source_section_key) ||
    !isNullableString(block.transformation_version) ||
    typeof block.created_at !== "string" || typeof block.updated_at !== "string"
  ) return null;

  if (
    block.ledger_binding_status === "legacy_unversioned" &&
    (block.ledger_section_key !== null || block.ledger_version !== null ||
      block.is_required !== null || block.section_state !== null ||
      block.source_block_id !== null || block.source_section_key !== null ||
      block.transformation_version !== null)
  ) return null;
  if (
    block.ledger_binding_status === "captured" &&
    (!block.ledger_section_key || !block.ledger_version ||
      typeof block.is_required !== "boolean" || block.section_state === null)
  ) return null;

  return {
    id: block.id,
    artifact_id: expected.artifactId,
    user_id: expected.userId,
    kind: block.kind as PersistedTedArtifactBlock["kind"],
    stable_key: block.stable_key,
    parent_block_id: block.parent_block_id,
    heading: block.heading,
    order_index: Number(block.order_index),
    payload,
    approval_status: block.approval_status as PersistedTedArtifactBlock["approval_status"],
    completed_at: block.completed_at,
    due_date: block.due_date,
    revision: Number(block.revision),
    references: expected.references ?? [],
    ledger_binding_status: block.ledger_binding_status,
    ledger_section_key: block.ledger_section_key,
    ledger_version: block.ledger_version,
    is_required: block.is_required,
    section_state: block.section_state as TedArtifactSectionState | null,
    approved_revision: block.approved_revision === null ? null : Number(block.approved_revision),
    source_block_id: block.source_block_id,
    source_section_key: block.source_section_key,
    transformation_version: block.transformation_version,
    created_at: block.created_at,
    updated_at: block.updated_at,
  };
}

export async function createOrReplayArtifact(
  artifact: TedArtifact,
  lease: OwnerDispatchLease,
): Promise<string> {
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase.rpc("save_ted_artifact", {
      p_artifact: {
        id: artifact.id,
        outcome_id: artifact.outcome_id,
        kind: artifact.kind,
        title: artifact.title,
        template_id: artifact.template_id,
        schema_version: artifact.schema_version,
        pipeline_version: artifact.pipeline_version,
        status: artifact.status,
        quality_status: artifact.quality_status,
        current_revision: artifact.current_revision,
        request_id: artifact.request_id,
      },
      p_blocks: artifact.blocks,
    }),
  );
  if (error) throw error;
  if (!isUuid(data)) throw new Error("ARTIFACT_CREATION_UNCONFIRMED");
  return data;
}

export async function fetchArtifactByOutcome(
  outcomeId: string,
  lease: OwnerDispatchLease,
): Promise<PersistedTedArtifact | null> {
  return withOwnerSupabase(lease, async (supabase) => {
    const { data: artifact, error } = await supabase
      .from("ted_artifacts")
      .select("*")
      .eq("outcome_id", outcomeId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!artifact) return null;
    const artifactRecord = asRecord(artifact);
    const artifactId = artifactRecord?.id;
    if (
      !artifactRecord || !isUuid(artifactId) ||
      artifactRecord.outcome_id !== outcomeId ||
      artifactRecord.user_id !== lease.expectedUserId ||
      !ARTIFACT_KINDS.has(String(artifactRecord.kind)) ||
      typeof artifactRecord.title !== "string" ||
      !isNullableString(artifactRecord.template_id) ||
      artifactRecord.schema_version !== TED_ARTIFACT_SCHEMA_VERSION ||
      typeof artifactRecord.pipeline_version !== "string" ||
      !ARTIFACT_STATUSES.has(String(artifactRecord.status)) ||
      !new Set(["pending", "passed", "failed"]).has(String(artifactRecord.quality_status)) ||
      !isPositiveInteger(artifactRecord.current_revision) ||
      typeof artifactRecord.request_id !== "string" ||
      (artifactRecord.ledger_binding_status !== "legacy_unversioned" &&
        artifactRecord.ledger_binding_status !== "captured") ||
      !isNullableString(artifactRecord.ledger_template_id) ||
      !isNullableString(artifactRecord.ledger_version) ||
      !isNullableString(artifactRecord.benchmark_version) ||
      !isNullableString(artifactRecord.generation_snapshot_id) ||
      (artifactRecord.generation_snapshot_id !== null &&
        !isUuid(artifactRecord.generation_snapshot_id)) ||
      (artifactRecord.approved_revision !== null &&
        !isPositiveInteger(artifactRecord.approved_revision)) ||
      typeof artifactRecord.created_at !== "string" ||
      typeof artifactRecord.updated_at !== "string"
    ) throw new Error("ARTIFACT_READ_INVALID");

    const [{ data: blocks, error: blocksError }, {
      data: references,
      error: referencesError,
    }] = await Promise.all([
      supabase.from("ted_artifact_blocks").select("*")
        .eq("artifact_id", artifactId)
        .order("order_index", { ascending: true }),
      supabase.from("ted_artifact_references").select("*")
        .eq("artifact_id", artifactId),
    ]);
    if (blocksError) throw blocksError;
    if (referencesError) throw referencesError;
    if (!Array.isArray(blocks) || !Array.isArray(references)) {
      throw new Error("ARTIFACT_CHILD_READ_INVALID");
    }

    const byBlock = new Map<string, TedSupportingReference[]>();
    for (const referenceValue of references) {
      const referenceRecord = asRecord(referenceValue);
      const blockId = referenceRecord?.block_id;
      if (!isUuid(blockId)) throw new Error("ARTIFACT_REFERENCE_INVALID");
      const parsed = parseReference(referenceValue, {
        artifactId,
        blockId,
        userId: lease.expectedUserId,
      });
      if (!parsed) throw new Error("ARTIFACT_REFERENCE_INVALID");
      byBlock.set(blockId, [...(byBlock.get(blockId) ?? []), parsed]);
    }

    const parsedBlocks = blocks.map((blockValue) => {
      const blockRecord = asRecord(blockValue);
      const parsed = parsePersistedBlock(blockValue, {
        artifactId,
        userId: lease.expectedUserId,
        references: isUuid(blockRecord?.id) ? byBlock.get(blockRecord.id) ?? [] : [],
      });
      if (!parsed) throw new Error("ARTIFACT_BLOCK_INVALID");
      return parsed;
    });
    if ([...byBlock.keys()].some((blockId) => !parsedBlocks.some((block) => block.id === blockId))) {
      throw new Error("ARTIFACT_REFERENCE_ORPHANED");
    }

    if (
      artifactRecord.ledger_binding_status === "legacy_unversioned" &&
      (artifactRecord.ledger_template_id !== null || artifactRecord.ledger_version !== null ||
        artifactRecord.benchmark_version !== null ||
        artifactRecord.generation_snapshot_id !== null)
    ) throw new Error("ARTIFACT_LEDGER_BINDING_INVALID");
    if (
      artifactRecord.ledger_binding_status === "captured" &&
      (!artifactRecord.ledger_template_id || !artifactRecord.ledger_version ||
        !artifactRecord.benchmark_version || !artifactRecord.generation_snapshot_id)
    ) throw new Error("ARTIFACT_LEDGER_BINDING_INVALID");

    return {
      id: artifactId,
      outcome_id: outcomeId,
      user_id: lease.expectedUserId,
      kind: artifactRecord.kind as PersistedTedArtifact["kind"],
      title: artifactRecord.title,
      template_id: artifactRecord.template_id,
      schema_version: TED_ARTIFACT_SCHEMA_VERSION,
      pipeline_version: artifactRecord.pipeline_version,
      status: artifactRecord.status as PersistedTedArtifact["status"],
      quality_status: artifactRecord.quality_status as PersistedTedArtifact["quality_status"],
      current_revision: Number(artifactRecord.current_revision),
      request_id: artifactRecord.request_id,
      ledger_binding_status: artifactRecord.ledger_binding_status,
      ledger_template_id: artifactRecord.ledger_template_id,
      ledger_version: artifactRecord.ledger_version,
      benchmark_version: artifactRecord.benchmark_version,
      generation_snapshot_id: artifactRecord.generation_snapshot_id,
      approved_revision: artifactRecord.approved_revision === null
        ? null
        : Number(artifactRecord.approved_revision),
      blocks: parsedBlocks,
      created_at: artifactRecord.created_at,
      updated_at: artifactRecord.updated_at,
    };
  });
}

export interface ArtifactBlockMutationReceipt {
  contractVersion: "ted-artifact-mutation.1";
  status: "committed";
  operationId: string;
  mutationKind: "block_payload";
  artifactId: string;
  acceptedArtifactRevision: number;
  artifactRevision: number;
  artifactStatus: "needs_review";
  artifactApprovedRevision: null;
  blockId: string;
  acceptedBlockRevision: number;
  blockRevision: number;
  ledgerBindingStatus: "legacy_unversioned" | "captured";
  sectionState: TedArtifactSectionState | null;
  approvalStatus: "draft";
  approvedRevision: null;
  idempotentReplay: boolean;
}

export async function saveArtifactBlockRevision(input: {
  artifactId: string;
  blockId: string;
  expectedArtifactRevision: number;
  expectedBlockRevision: number;
  payload: TedArtifactBlock["payload"];
  sectionState: TedArtifactSectionState | null;
}, lease: OwnerDispatchLease): Promise<ArtifactBlockMutationReceipt> {
  if (
    !isUuid(input.artifactId) || !isUuid(input.blockId) ||
    !isPositiveInteger(input.expectedArtifactRevision) ||
    !isPositiveInteger(input.expectedBlockRevision) || !asRecord(input.payload)
  ) throw new Error("ARTIFACT_BLOCK_MUTATION_INVALID");
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase.rpc("save_ted_artifact_block_revision", {
      p_block_id: input.blockId,
      p_expected_artifact_revision: input.expectedArtifactRevision,
      p_expected_block_revision: input.expectedBlockRevision,
      p_payload: input.payload,
      p_section_state: input.sectionState,
    }),
  );
  if (error) throw error;
  const receipt = asRecord(data);
  const binding = receipt?.ledger_binding_status;
  const sectionState = receipt?.section_state;
  if (
    !receipt || receipt.contract_version !== "ted-artifact-mutation.1" ||
    receipt.status !== "committed" || !isUuid(receipt.operation_id) ||
    receipt.mutation_kind !== "block_payload" ||
    receipt.artifact_id !== input.artifactId ||
    receipt.accepted_artifact_revision !== input.expectedArtifactRevision ||
    receipt.artifact_revision !== input.expectedArtifactRevision + 1 ||
    receipt.artifact_status !== "needs_review" ||
    receipt.artifact_approved_revision !== null ||
    receipt.block_id !== input.blockId ||
    receipt.accepted_block_revision !== input.expectedBlockRevision ||
    receipt.block_revision !== input.expectedBlockRevision + 1 ||
    (binding !== "legacy_unversioned" && binding !== "captured") ||
    sectionState !== input.sectionState ||
    receipt.approval_status !== "draft" || receipt.approved_revision !== null ||
    typeof receipt.idempotent_replay !== "boolean"
  ) throw new Error("ARTIFACT_BLOCK_MUTATION_INVALID");

  return {
    contractVersion: "ted-artifact-mutation.1",
    status: "committed",
    operationId: receipt.operation_id,
    mutationKind: "block_payload",
    artifactId: input.artifactId,
    acceptedArtifactRevision: input.expectedArtifactRevision,
    artifactRevision: input.expectedArtifactRevision + 1,
    artifactStatus: "needs_review",
    artifactApprovedRevision: null,
    blockId: input.blockId,
    acceptedBlockRevision: input.expectedBlockRevision,
    blockRevision: input.expectedBlockRevision + 1,
    ledgerBindingStatus: binding,
    sectionState: sectionState as TedArtifactSectionState | null,
    approvalStatus: "draft",
    approvedRevision: null,
    idempotentReplay: receipt.idempotent_replay,
  };
}

export async function setArtifactBlockCompleted(
  block: PersistedTedArtifactBlock,
  completed: boolean,
  lease: OwnerDispatchLease,
): Promise<PersistedTedArtifactBlock> {
  const { data, error } = await withOwnerSupabase(lease, async (supabase) =>
    await supabase.rpc("set_ted_block_completed", {
      p_block_id: block.id,
      p_completed: completed,
      p_expected_revision: block.revision,
    }),
  );
  if (error) throw error;
  const parsed = parsePersistedBlock(data, {
    artifactId: block.artifact_id,
    userId: lease.expectedUserId,
    references: block.references,
  });
  if (
    !parsed || parsed.id !== block.id || parsed.revision !== block.revision + 1 ||
    parsed.approval_status !== "draft" || parsed.approved_revision !== null ||
    (completed ? parsed.completed_at === null : parsed.completed_at !== null)
  ) throw new Error("ARTIFACT_COMPLETION_UNCONFIRMED");
  return parsed;
}
