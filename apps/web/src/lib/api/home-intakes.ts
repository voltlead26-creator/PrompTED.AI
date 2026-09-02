import type { PreparedUploadDispatch } from "@prompted/shared/api-client";
import type { RecommendationPayload } from "@prompted/shared/browser";
import {
  OwnerDispatchError,
  type OwnerDispatchLease,
} from "@/lib/browser-principal-state";
import {
  adaptHomeUploadIntakeCommitReceipt,
  adaptHomeUploadIntakeSnapshot,
  type HomeUploadIntakeCommitReceipt,
  type HomeUploadIntakeSnapshot,
} from "@/lib/home-intake-initial-state";
import { withOwnerSupabase } from "@/lib/supabase/owner-client";

export class HomeUploadIntakeError extends Error {
  constructor(
    public readonly code: string,
    public readonly ambiguous: boolean,
  ) {
    super(code);
    this.name = "HomeUploadIntakeError";
  }

  get retryable(): boolean {
    return this.ambiguous;
  }
}

interface RpcResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

function databaseError(error: RpcResult["error"]): HomeUploadIntakeError {
  const code =
    error?.message?.match(/\b(HOME_UPLOAD_INTAKE_[A-Z0-9_]+|ACCOUNT_DELETION_FENCED|UNAUTHENTICATED)\b/)?.[1] ??
    (error?.code ? `DATABASE_${error.code}` : "HOME_UPLOAD_INTAKE_ACKNOWLEDGEMENT_UNKNOWN");
  const deterministic =
    code.startsWith("HOME_UPLOAD_INTAKE_") ||
    code === "ACCOUNT_DELETION_FENCED" ||
    code === "UNAUTHENTICATED" ||
    code === "DATABASE_PGRST202" ||
    /^DATABASE_(22023|23503|23505|28000|40001|42501|55000)$/.test(code);
  return new HomeUploadIntakeError(code, !deterministic);
}

async function callRpc(
  name: string,
  args: Record<string, unknown>,
  lease: OwnerDispatchLease,
): Promise<RpcResult> {
  return await withOwnerSupabase(lease, async (supabase) => await supabase.rpc(name, args));
}

async function exactMutation<T>(
  name: string,
  args: Record<string, unknown>,
  lease: OwnerDispatchLease,
  parse: (value: unknown) => T,
  maximumAttempts = 2,
): Promise<T> {
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    let result: RpcResult;
    try {
      result = await callRpc(name, args, lease);
    } catch (error) {
      if (error instanceof OwnerDispatchError) throw error;
      if (attempt + 1 < maximumAttempts) continue;
      throw new HomeUploadIntakeError("HOME_UPLOAD_INTAKE_ACKNOWLEDGEMENT_UNKNOWN", true);
    }
    if (result.error) {
      const mapped = databaseError(result.error);
      if (mapped.ambiguous && attempt + 1 < maximumAttempts) continue;
      throw mapped;
    }
    try {
      return parse(result.data);
    } catch {
      if (attempt + 1 < maximumAttempts) continue;
      throw new HomeUploadIntakeError("HOME_UPLOAD_INTAKE_RECEIPT_INVALID", true);
    }
  }
  throw new HomeUploadIntakeError("HOME_UPLOAD_INTAKE_ACKNOWLEDGEMENT_UNKNOWN", true);
}

function exactSnapshot(
  value: unknown,
  expected: {
    ownerUserId: string;
    intakeId: string;
    uploadId: string;
    acceptedRevision: number;
    revision: number;
    state: HomeUploadIntakeSnapshot["state"];
  },
): HomeUploadIntakeSnapshot {
  const receipt = adaptHomeUploadIntakeSnapshot(value, expected.ownerUserId);
  if (
    receipt.intakeId !== expected.intakeId ||
    receipt.uploadId !== expected.uploadId ||
    receipt.acceptedRevision !== expected.acceptedRevision ||
    receipt.revision !== expected.revision ||
    receipt.state !== expected.state
  ) {
    throw new Error("HOME_UPLOAD_INTAKE_RECEIPT_INVALID");
  }
  return receipt;
}

export interface BeginHomeUploadIntakeInput {
  intakeId: string;
  prepared: Readonly<PreparedUploadDispatch>;
}

export async function beginHomeUploadIntake(
  input: BeginHomeUploadIntakeInput,
  lease: OwnerDispatchLease,
): Promise<HomeUploadIntakeSnapshot> {
  const args = {
    p_intake_id: input.intakeId,
    p_upload_id: input.prepared.uploadId,
    p_typed_situation: input.prepared.situationText,
    p_file_name: input.prepared.fileName,
    p_file_type: input.prepared.persistedFileType,
    p_file_size_bytes: input.prepared.fileSizeBytes,
    p_content_sha256: input.prepared.contentSha256,
  };
  return await exactMutation(
    "begin_own_home_upload_intake_v1",
    args,
    lease,
    (value) => {
      const receipt = exactSnapshot(value, {
        ownerUserId: lease.expectedUserId,
        intakeId: input.intakeId,
        uploadId: input.prepared.uploadId,
        acceptedRevision: 0,
        revision: 1,
        state: "open",
      });
      if (
        receipt.typedSituation !== input.prepared.situationText ||
        receipt.fileName !== input.prepared.fileName ||
        receipt.fileType !== input.prepared.persistedFileType ||
        receipt.fileSizeBytes !== input.prepared.fileSizeBytes ||
        receipt.contentSha256 !== input.prepared.contentSha256
      ) {
        throw new Error("HOME_UPLOAD_INTAKE_RECEIPT_INVALID");
      }
      return receipt;
    },
  );
}

export async function getHomeUploadIntake(
  intakeId: string | null,
  lease: OwnerDispatchLease,
): Promise<HomeUploadIntakeSnapshot | null> {
  try {
    const result = await callRpc(
      "get_own_home_upload_intake_v1",
      { p_intake_id: intakeId },
      lease,
    );
    if (result.error) throw databaseError(result.error);
    if (result.data === null) return null;
    const snapshot = adaptHomeUploadIntakeSnapshot(result.data, lease.expectedUserId);
    if (intakeId !== null && snapshot.intakeId !== intakeId) {
      throw new HomeUploadIntakeError("HOME_UPLOAD_INTAKE_RECEIPT_INVALID", true);
    }
    return snapshot;
  } catch (error) {
    if (error instanceof OwnerDispatchError || error instanceof HomeUploadIntakeError) throw error;
    throw new HomeUploadIntakeError("HOME_UPLOAD_INTAKE_READ_UNAVAILABLE", true);
  }
}

export async function confirmHomeUploadIntake(
  input: {
    intakeId: string;
    uploadId: string;
    expectedRevision: number;
    confirmedText: string;
  },
  lease: OwnerDispatchLease,
): Promise<HomeUploadIntakeSnapshot> {
  const confirmedText = input.confirmedText.trim();
  return await exactMutation(
    "confirm_own_home_upload_intake_v1",
    {
      p_intake_id: input.intakeId,
      p_expected_revision: input.expectedRevision,
      p_confirmed_text: confirmedText,
    },
    lease,
    (value) => {
      const receipt = exactSnapshot(value, {
        ownerUserId: lease.expectedUserId,
        intakeId: input.intakeId,
        uploadId: input.uploadId,
        acceptedRevision: input.expectedRevision,
        revision: input.expectedRevision + 1,
        state: "confirmed",
      });
      if (receipt.uploadState !== "confirmed" || receipt.confirmedText !== confirmedText) {
        throw new Error("HOME_UPLOAD_INTAKE_RECEIPT_INVALID");
      }
      return receipt;
    },
  );
}

export async function cancelHomeUploadIntake(
  input: { intakeId: string; uploadId: string; expectedRevision: number },
  lease: OwnerDispatchLease,
): Promise<HomeUploadIntakeSnapshot> {
  return await exactMutation(
    "cancel_own_home_upload_intake_v1",
    {
      p_intake_id: input.intakeId,
      p_expected_revision: input.expectedRevision,
    },
    lease,
    (value) => exactSnapshot(value, {
      ownerUserId: lease.expectedUserId,
      intakeId: input.intakeId,
      uploadId: input.uploadId,
      acceptedRevision: input.expectedRevision,
      revision: input.expectedRevision + 1,
      state: "cancelled",
    }),
  );
}

export interface CommitHomeUploadIntakeInput {
  intakeId: string;
  uploadId: string;
  expectedRevision: number;
  confirmedText: string;
  situation: string;
  recommendationPayload: RecommendationPayload;
}

function prepareHomeUploadIntakeCommit(
  input: CommitHomeUploadIntakeInput,
  lease: OwnerDispatchLease,
) {
  const confirmedText = input.confirmedText.trim();
  if (!confirmedText || confirmedText.length > 20_000) {
    throw new HomeUploadIntakeError("HOME_UPLOAD_INTAKE_COMMIT_INVALID", false);
  }
  const recommendationPayload: RecommendationPayload = {
    primary: input.recommendationPayload.primary,
    alternatives: input.recommendationPayload.alternatives,
    conversation: input.recommendationPayload.conversation ?? [],
  };
  if (input.recommendationPayload.bundle_id) {
    recommendationPayload.bundle_id = input.recommendationPayload.bundle_id;
  }
  const conversationContext = input.recommendationPayload.conversation_context?.trim();
  if (conversationContext) recommendationPayload.conversation_context = conversationContext;
  const args = {
    p_intake_id: input.intakeId,
    p_expected_revision: input.expectedRevision,
    p_situation_text: input.situation,
    p_recommendation_payload: recommendationPayload,
  };
  return {
    args,
    parse: (value: unknown) => adaptHomeUploadIntakeCommitReceipt(value, {
      ownerUserId: lease.expectedUserId,
      intakeId: input.intakeId,
      uploadId: input.uploadId,
      acceptedRevision: input.expectedRevision,
      confirmedText,
      situation: input.situation,
      recommendationPayload,
    }),
  };
}

export async function commitHomeUploadIntake(
  input: CommitHomeUploadIntakeInput,
  lease: OwnerDispatchLease,
): Promise<HomeUploadIntakeCommitReceipt> {
  const prepared = prepareHomeUploadIntakeCommit(input, lease);
  return await exactMutation(
    "commit_own_home_upload_intake_v1",
    prepared.args,
    lease,
    prepared.parse,
  );
}

/**
 * Adjudicate an unknown final acknowledgement by replaying the exact command.
 * PostgreSQL compares its durable command digest; a generic intake read is not
 * authority that this particular wording and recommendation were committed.
 */
export async function reconcileHomeUploadIntakeCommit(
  input: CommitHomeUploadIntakeInput,
  lease: OwnerDispatchLease,
): Promise<HomeUploadIntakeCommitReceipt> {
  const prepared = prepareHomeUploadIntakeCommit(input, lease);
  return await exactMutation(
    "commit_own_home_upload_intake_v1",
    prepared.args,
    lease,
    prepared.parse,
    1,
  );
}
