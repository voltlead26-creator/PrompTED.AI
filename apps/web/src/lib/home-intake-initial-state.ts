import {
  parseIngestUploadConfirmPayload,
  type IngestUploadConfirmPayload,
} from "@prompted/shared/ingest-upload";
import type { RecommendationPayload } from "@prompted/shared/browser";

export const HOME_UPLOAD_INTAKE_VERSION = "home-upload-intake.v1" as const;
export const HOME_UPLOAD_INTAKE_COMMIT_VERSION = "home-upload-intake-commit.v1" as const;

export type HomeUploadIntakeState = "open" | "confirmed" | "cancelled" | "consumed";
export type HomeUploadPresentationState =
  | "file_required"
  | "processing"
  | "awaiting_confirmation"
  | "confirmed"
  | "terminal_failure"
  | "cancelled"
  | "consumed";

export interface HomeUploadIntakeSnapshot {
  contractVersion: typeof HOME_UPLOAD_INTAKE_VERSION;
  intakeId: string;
  ownerUserId: string;
  uploadId: string;
  state: HomeUploadIntakeState;
  revision: number;
  acceptedRevision: number | null;
  typedSituation: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  contentSha256: string;
  uploadState: HomeUploadPresentationState;
  extractedText: string | null;
  confirmPayload: IngestUploadConfirmPayload | null;
  confirmedText: string | null;
  confirmedTextSha256: string | null;
  outcomeId: string | null;
  retryable: boolean;
  safeNextAction: string;
  updatedAt: string;
  idempotentReplay: boolean;
}

export type HomeIntakePersistence = "anonymous" | "not_found" | "persisted" | "unavailable";

export interface HomeIntakeInitialState {
  authenticated: boolean;
  ownerUserId: string | null;
  persistence: HomeIntakePersistence;
  intake: HomeUploadIntakeSnapshot | null;
}

export interface HomeUploadIntakeCommitReceipt {
  contractVersion: typeof HOME_UPLOAD_INTAKE_COMMIT_VERSION;
  intakeId: string;
  ownerUserId: string;
  uploadId: string;
  acceptedRevision: number;
  revision: number;
  state: "consumed";
  outcomeId: string;
  situation: string;
  templateId: string;
  templateName: string;
  conversationContext: string;
  uploadContext: string;
  committedAt: string;
  idempotentReplay: boolean;
}

export interface ExpectedHomeUploadCommit {
  ownerUserId: string;
  intakeId: string;
  uploadId: string;
  acceptedRevision: number;
  confirmedText: string;
  situation: string;
  recommendationPayload: RecommendationPayload;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const INTAKE_STATES = new Set<HomeUploadIntakeState>([
  "open",
  "confirmed",
  "cancelled",
  "consumed",
]);
const UPLOAD_STATES = new Set<HomeUploadPresentationState>([
  "file_required",
  "processing",
  "awaiting_confirmation",
  "confirmed",
  "terminal_failure",
  "cancelled",
  "consumed",
]);

function invalidSnapshot(): never {
  throw new Error("HOME_UPLOAD_INTAKE_SNAPSHOT_INVALID");
}

function invalidCommit(): never {
  throw new Error("HOME_UPLOAD_INTAKE_COMMIT_RECEIPT_INVALID");
}

function record(value: unknown, invalid: () => never): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function boundedString(
  value: unknown,
  maximum: number,
  invalid: () => never,
  allowBlank = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    (!allowBlank && (!value || value !== value.trim()))
  ) {
    invalid();
  }
  return value;
}

function uuid(value: unknown, invalid: () => never): string {
  const parsed = boundedString(value, 36, invalid);
  if (!UUID_PATTERN.test(parsed)) invalid();
  return parsed;
}

function positiveInteger(value: unknown, invalid: () => never): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) invalid();
  return Number(value);
}

function nonNegativeInteger(value: unknown, invalid: () => never): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid();
  return Number(value);
}

function timestamp(value: unknown, invalid: () => never): string {
  const parsed = boundedString(value, 100, invalid);
  if (!Number.isFinite(Date.parse(parsed))) invalid();
  return parsed;
}

function nullableBoundedString(
  value: unknown,
  maximum: number,
  invalid: () => never,
): string | null {
  return value === null ? null : boundedString(value, maximum, invalid);
}

/** Strictly projects the versioned database snapshot into browser-safe state. */
export function adaptHomeUploadIntakeSnapshot(
  value: unknown,
  expectedOwnerUserId?: string,
): HomeUploadIntakeSnapshot {
  const snapshot = record(value, invalidSnapshot);
  if (snapshot.contract_version !== HOME_UPLOAD_INTAKE_VERSION) invalidSnapshot();
  const intakeId = uuid(snapshot.intake_id, invalidSnapshot);
  const ownerUserId = uuid(snapshot.owner_user_id, invalidSnapshot);
  if (expectedOwnerUserId !== undefined && ownerUserId !== uuid(expectedOwnerUserId, invalidSnapshot)) {
    invalidSnapshot();
  }
  const uploadId = uuid(snapshot.upload_id, invalidSnapshot);
  if (!INTAKE_STATES.has(snapshot.state as HomeUploadIntakeState)) invalidSnapshot();
  const state = snapshot.state as HomeUploadIntakeState;
  const revision = positiveInteger(snapshot.revision, invalidSnapshot);
  const acceptedRevision = Object.prototype.hasOwnProperty.call(snapshot, "accepted_revision")
    ? nonNegativeInteger(snapshot.accepted_revision, invalidSnapshot)
    : null;
  const typedSituation = boundedString(snapshot.typed_situation, 30_000, invalidSnapshot, true);
  const fileName = boundedString(snapshot.file_name, 300, invalidSnapshot);
  const fileType = boundedString(snapshot.file_type, 200, invalidSnapshot);
  if (fileType !== fileType.toLowerCase()) invalidSnapshot();
  const fileSizeBytes = nonNegativeInteger(snapshot.file_size_bytes, invalidSnapshot);
  if (fileSizeBytes > 8 * 1024 * 1024) invalidSnapshot();
  const contentSha256 = boundedString(snapshot.content_sha256, 64, invalidSnapshot);
  if (!SHA256_PATTERN.test(contentSha256)) invalidSnapshot();
  if (!UPLOAD_STATES.has(snapshot.upload_state as HomeUploadPresentationState)) invalidSnapshot();
  const uploadState = snapshot.upload_state as HomeUploadPresentationState;
  const extractedText = nullableBoundedString(snapshot.extracted_text, 20_000, invalidSnapshot);
  const confirmedText = nullableBoundedString(snapshot.confirmed_text, 20_000, invalidSnapshot);
  const confirmedTextSha256 = snapshot.confirmed_text_sha256 === null
    ? null
    : boundedString(snapshot.confirmed_text_sha256, 64, invalidSnapshot);
  if (confirmedTextSha256 !== null && !SHA256_PATTERN.test(confirmedTextSha256)) invalidSnapshot();
  const outcomeId = snapshot.outcome_id === null ? null : uuid(snapshot.outcome_id, invalidSnapshot);
  if (typeof snapshot.retryable !== "boolean" || typeof snapshot.idempotent_replay !== "boolean") {
    invalidSnapshot();
  }
  const retryable = snapshot.retryable;
  const safeNextAction = boundedString(snapshot.safe_next_action, 1_000, invalidSnapshot);
  const updatedAt = timestamp(snapshot.updated_at, invalidSnapshot);

  const shouldHaveConfirmation = uploadState === "awaiting_confirmation" || uploadState === "confirmed";
  let confirmPayload: IngestUploadConfirmPayload | null = null;
  if (snapshot.confirm_payload !== null) {
    try {
      confirmPayload = parseIngestUploadConfirmPayload(
        snapshot.confirm_payload,
        fileName,
        extractedText,
      );
    } catch {
      invalidSnapshot();
    }
  }
  if (
    shouldHaveConfirmation !== (confirmPayload !== null) ||
    (uploadState === "awaiting_confirmation" && extractedText === null) ||
    (uploadState !== "awaiting_confirmation" && extractedText !== null) ||
    retryable !== (uploadState === "file_required" || uploadState === "processing")
  ) {
    invalidSnapshot();
  }

  const hasConfirmedText = confirmedText !== null && confirmedTextSha256 !== null;
  if (
    (confirmedText === null) !== (confirmedTextSha256 === null) ||
    (state === "open" && (hasConfirmedText || outcomeId !== null)) ||
    (state === "confirmed" && (!hasConfirmedText || outcomeId !== null)) ||
    (state === "cancelled" && outcomeId !== null) ||
    (state === "consumed" && (hasConfirmedText || outcomeId !== intakeId)) ||
    (uploadState === "awaiting_confirmation" && state !== "open") ||
    (uploadState === "confirmed" && state !== "confirmed") ||
    (uploadState === "cancelled" && state !== "cancelled") ||
    (uploadState === "consumed" && state !== "consumed") ||
    (state === "cancelled" && uploadState !== "cancelled") ||
    (state === "consumed" && uploadState !== "consumed")
  ) {
    invalidSnapshot();
  }

  return {
    contractVersion: HOME_UPLOAD_INTAKE_VERSION,
    intakeId,
    ownerUserId,
    uploadId,
    state,
    revision,
    acceptedRevision,
    typedSituation,
    fileName,
    fileType,
    fileSizeBytes,
    contentSha256,
    uploadState,
    extractedText,
    confirmPayload,
    confirmedText,
    confirmedTextSha256,
    outcomeId,
    retryable,
    safeNextAction,
    updatedAt,
    idempotentReplay: snapshot.idempotent_replay,
  };
}

/** Validates the immutable final-commit acknowledgement against the exact command. */
export function adaptHomeUploadIntakeCommitReceipt(
  value: unknown,
  expected: ExpectedHomeUploadCommit,
): HomeUploadIntakeCommitReceipt {
  const receipt = record(value, invalidCommit);
  const ownerUserId = uuid(receipt.owner_user_id, invalidCommit);
  const intakeId = uuid(receipt.intake_id, invalidCommit);
  const uploadId = uuid(receipt.upload_id, invalidCommit);
  const acceptedRevision = positiveInteger(receipt.accepted_revision, invalidCommit);
  const revision = positiveInteger(receipt.revision, invalidCommit);
  const outcomeId = uuid(receipt.outcome_id, invalidCommit);
  const situation = boundedString(receipt.situation, 30_000, invalidCommit);
  const templateId = boundedString(receipt.template_id, 160, invalidCommit);
  const templateName = boundedString(receipt.template_name, 600, invalidCommit);
  const conversationContext = boundedString(receipt.conversation_context, 30_000, invalidCommit, true);
  const uploadContext = boundedString(receipt.upload_context, 20_000, invalidCommit);
  const committedAt = timestamp(receipt.committed_at, invalidCommit);
  const primary = expected.recommendationPayload.primary;
  const expectedSituation = expected.situation.trim();
  const expectedConversationContext = expected.recommendationPayload.conversation_context?.trim() ?? "";
  const expectedUploadContext = boundedString(
    expected.confirmedText,
    20_000,
    invalidCommit,
  );

  if (
    receipt.contract_version !== HOME_UPLOAD_INTAKE_COMMIT_VERSION ||
    receipt.state !== "consumed" ||
    typeof receipt.idempotent_replay !== "boolean" ||
    ownerUserId !== uuid(expected.ownerUserId, invalidCommit) ||
    intakeId !== uuid(expected.intakeId, invalidCommit) ||
    uploadId !== uuid(expected.uploadId, invalidCommit) ||
    acceptedRevision !== expected.acceptedRevision ||
    revision !== acceptedRevision + 1 ||
    outcomeId !== intakeId ||
    situation !== expectedSituation ||
    templateId !== primary.template_id ||
    templateName !== primary.reason ||
    conversationContext !== expectedConversationContext ||
    uploadContext !== expectedUploadContext
  ) {
    invalidCommit();
  }

  return {
    contractVersion: HOME_UPLOAD_INTAKE_COMMIT_VERSION,
    intakeId,
    ownerUserId,
    uploadId,
    acceptedRevision,
    revision,
    state: "consumed",
    outcomeId,
    situation,
    templateId,
    templateName,
    conversationContext,
    uploadContext,
    committedAt,
    idempotentReplay: receipt.idempotent_replay,
  };
}
