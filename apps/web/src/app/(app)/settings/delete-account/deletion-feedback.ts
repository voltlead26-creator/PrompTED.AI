interface DeletionProgressPayload {
  state?: unknown;
  account_deleted?: unknown;
  storage_objects_removed?: unknown;
  removal_extent_uncertain?: unknown;
}

interface AccountDeletionPayload {
  success?: unknown;
  code?: unknown;
  error?: unknown;
  deletion?: DeletionProgressPayload;
}

function payload(value: unknown): AccountDeletionPayload | null {
  return value !== null && typeof value === "object"
    ? value as AccountDeletionPayload
    : null;
}

export function isCompleteAccountDeletion(value: unknown): boolean {
  const result = payload(value);
  return result?.success === true &&
    result.deletion?.state === "complete" &&
    result.deletion.account_deleted === true;
}

export function accountDeletionFailureMessage(value: unknown): string {
  const result = payload(value);
  if (result?.deletion?.state === "partial") {
    if (result.code === "BUSINESS_TRANSFER_REQUIRED") {
      return "Your account was not fully deleted, and some stored data has already been removed. Transfer ownership or remove the other business members, then retry account deletion.";
    }
    return "Your account was not fully deleted. Some stored data has already been removed. Try again; if the problem continues, contact support.";
  }

  if (
    result?.deletion?.state === "indeterminate" ||
    result?.deletion?.account_deleted === null ||
    result?.deletion?.removal_extent_uncertain === true
  ) {
    return "We could not confirm that deletion finished. Some data may already have been removed. Sign in again if needed, then retry or contact support.";
  }

  if (result?.code === "BUSINESS_TRANSFER_REQUIRED") {
    return "Transfer ownership or remove the other business members before deleting your account. No deletion has started.";
  }

  if (
    result?.deletion?.state === "not_started" &&
    typeof result.error === "string"
  ) {
    return result.error;
  }

  return "We could not confirm that deletion finished. Some data may already have been removed. Sign in again if needed, then retry or contact support.";
}
