import { enumerateStoragePrefix, type StorageList } from "./assets.ts";

export type StorageBucket =
  | "assets"
  | "original-documents"
  | "captured-exports";

export interface QueryResult<T> {
  data: T | null;
  error: unknown | null;
}

export interface DeletionAuditRecord {
  id: string;
  user_id: string;
  event_type: "account_deletion_requested";
  metadata: { requested_at: string };
}

export interface AccountDeletionGateway {
  loadOwnedBusinesses(
    userId: string,
  ): Promise<QueryResult<Array<{ id: unknown }>>>;
  loadOtherMemberships(
    businessIds: string[],
    userId: string,
  ): Promise<QueryResult<Array<{ business_id: unknown; user_id: unknown }>>>;
  beginDeletionFence(userId: string): Promise<
    QueryResult<{
      outcome: "ready" | "blocked";
      active_uploads?: number;
      active_storage_dispatches?: number;
      active_external_egress?: number;
      retry_after_seconds?: number;
    }>
  >;
  listStorage: (
    bucket: StorageBucket,
    ...args: Parameters<StorageList>
  ) => ReturnType<StorageList>;
  removeStorage(
    bucket: StorageBucket,
    paths: string[],
  ): Promise<{ error: unknown | null }>;
  insertDeletionAuditIdempotently(
    record: DeletionAuditRecord,
  ): Promise<{ error: unknown | null }>;
  deleteAuthUser(userId: string): Promise<{ error: unknown | null }>;
}

export type AccountDeletionState =
  | "not_started"
  | "partial"
  | "indeterminate"
  | "complete";

export interface AccountDeletionProgress {
  state: AccountDeletionState;
  account_deleted: boolean | null;
  storage_objects_removed: number;
  removal_extent_uncertain: boolean;
}

export type AccountDeletionFailureCode =
  | "BUSINESS_TRANSFER_REQUIRED"
  | "DELETION_PREFLIGHT_FAILED"
  | "ACTIVE_STORAGE_OPERATION"
  | "STORAGE_DELETION_FAILED"
  | "AUDIT_RECORD_FAILED"
  | "AUTH_DELETION_FAILED";

export interface AccountDeletionFailure {
  ok: false;
  status: 409 | 500;
  code: AccountDeletionFailureCode;
  error: string;
  retryable: boolean;
  deletion: AccountDeletionProgress;
}

export interface AccountDeletionSuccess {
  ok: true;
  status: 200;
  success: true;
  deletion: AccountDeletionProgress;
}

export type AccountDeletionResult =
  | AccountDeletionFailure
  | AccountDeletionSuccess;

interface StorageTarget {
  bucket: StorageBucket;
  rootPrefix: string;
  paths: string[];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REMOVE_BATCH_SIZE = 100;
const MAX_STORAGE_DRAIN_ROUNDS = 4;

function progress(
  state: AccountDeletionState,
  storageObjectsRemoved: number,
  options: { accountDeleted?: boolean | null; uncertain?: boolean } = {},
): AccountDeletionProgress {
  return {
    state,
    account_deleted: options.accountDeleted ?? false,
    storage_objects_removed: storageObjectsRemoved,
    removal_extent_uncertain: options.uncertain ?? false,
  };
}

function failure(
  code: AccountDeletionFailureCode,
  error: string,
  deletion: AccountDeletionProgress,
  options: { status?: 409 | 500; retryable?: boolean } = {},
): AccountDeletionFailure {
  return {
    ok: false,
    status: options.status ?? 500,
    code,
    error,
    retryable: options.retryable ?? true,
    deletion,
  };
}

function failureState(
  storageObjectsRemoved: number,
  uncertain = false,
): AccountDeletionProgress {
  if (storageObjectsRemoved > 0) {
    return progress("partial", storageObjectsRemoved, { uncertain });
  }
  if (uncertain) {
    return progress("indeterminate", 0, {
      accountDeleted: null,
      uncertain: true,
    });
  }
  return progress("not_started", 0);
}

function formatUuid(bytes: Uint8Array): string {
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)
  }-${hex.slice(20, 32)}`;
}

/** One deterministic audit row per account makes a failed deletion safe to retry. */
export async function accountDeletionAuditId(userId: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`prompted-account-delete:${userId}`),
    ),
  ).slice(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  return formatUuid(digest);
}

function enumerateTarget(
  gateway: AccountDeletionGateway,
  bucket: StorageBucket,
  rootPrefix: string,
): Promise<string[]> {
  return enumerateStoragePrefix({
    rootPrefix,
    list: (prefix, options) => gateway.listStorage(bucket, prefix, options),
  });
}

async function preflightTargets(
  gateway: AccountDeletionGateway,
  businessIds: string[],
  userId: string,
): Promise<StorageTarget[]> {
  const targets: StorageTarget[] = [
    ...businessIds.map((id) => ({
      bucket: "assets" as const,
      rootPrefix: `brand-kits/${id}`,
      paths: [] as string[],
    })),
    { bucket: "original-documents", rootPrefix: userId, paths: [] },
    { bucket: "captured-exports", rootPrefix: userId, paths: [] },
  ];

  for (const target of targets) {
    target.paths = await enumerateTarget(
      gateway,
      target.bucket,
      target.rootPrefix,
    );
  }
  return targets;
}

/**
 * Removes the preflight snapshot and re-lists every prefix before allowing the
 * auth cascade. A bounded retry catches ordinary concurrent replacement while
 * keeping continuously changing prefixes in a safe retryable state.
 */
async function drainStorageTargets(
  gateway: AccountDeletionGateway,
  targets: StorageTarget[],
): Promise<{ removed: number; failure: AccountDeletionFailure | null }> {
  let removed = 0;

  for (let round = 0; round < MAX_STORAGE_DRAIN_ROUNDS; round += 1) {
    for (const target of targets) {
      for (
        let offset = 0;
        offset < target.paths.length;
        offset += REMOVE_BATCH_SIZE
      ) {
        const batch = target.paths.slice(offset, offset + REMOVE_BATCH_SIZE);
        let result: { error: unknown | null };
        try {
          result = await gateway.removeStorage(target.bucket, batch);
        } catch {
          return {
            removed,
            failure: failure(
              "STORAGE_DELETION_FAILED",
              "Stored files could not be removed safely. Retry account deletion.",
              failureState(removed, true),
            ),
          };
        }
        if (result.error) {
          return {
            removed,
            failure: failure(
              "STORAGE_DELETION_FAILED",
              "Stored files could not be removed safely. Retry account deletion.",
              failureState(removed, true),
            ),
          };
        }
        removed += batch.length;
      }
    }

    let remaining = 0;
    try {
      for (const target of targets) {
        target.paths = await enumerateTarget(
          gateway,
          target.bucket,
          target.rootPrefix,
        );
        remaining += target.paths.length;
      }
    } catch {
      return {
        removed,
        failure: failure(
          "STORAGE_DELETION_FAILED",
          "Stored-file deletion could not be verified. Retry account deletion.",
          failureState(removed),
        ),
      };
    }

    if (remaining === 0) return { removed, failure: null };
  }

  return {
    removed,
    failure: failure(
      "STORAGE_DELETION_FAILED",
      "Stored files changed during deletion. Retry account deletion when uploads have stopped.",
      failureState(removed),
    ),
  };
}

type DeletionScopeResult =
  | { businessIds: string[]; failure: null }
  | { businessIds: null; failure: AccountDeletionFailure };

async function loadDeletionScope(
  userId: string,
  gateway: AccountDeletionGateway,
  storageObjectsRemoved: number,
): Promise<DeletionScopeResult> {
  let ownedBusinesses: QueryResult<Array<{ id: unknown }>>;
  try {
    ownedBusinesses = await gateway.loadOwnedBusinesses(userId);
  } catch {
    return {
      businessIds: null,
      failure: failure(
        "DELETION_PREFLIGHT_FAILED",
        "Owned business data could not be verified for deletion.",
        failureState(storageObjectsRemoved),
      ),
    };
  }
  if (
    ownedBusinesses.error ||
    (ownedBusinesses.data !== null && !Array.isArray(ownedBusinesses.data))
  ) {
    return {
      businessIds: null,
      failure: failure(
        "DELETION_PREFLIGHT_FAILED",
        "Owned business data could not be verified for deletion.",
        failureState(storageObjectsRemoved),
      ),
    };
  }

  const businessIds: string[] = [];
  for (const business of ownedBusinesses.data ?? []) {
    if (
      !business || typeof business.id !== "string" ||
      !UUID_PATTERN.test(business.id)
    ) {
      return {
        businessIds: null,
        failure: failure(
          "DELETION_PREFLIGHT_FAILED",
          "Owned business data could not be verified for deletion.",
          failureState(storageObjectsRemoved),
        ),
      };
    }
    if (!businessIds.includes(business.id)) businessIds.push(business.id);
  }
  businessIds.sort();

  if (businessIds.length > 0) {
    let memberships: QueryResult<
      Array<{ business_id: unknown; user_id: unknown }>
    >;
    try {
      memberships = await gateway.loadOtherMemberships(businessIds, userId);
    } catch {
      return {
        businessIds: null,
        failure: failure(
          "DELETION_PREFLIGHT_FAILED",
          "Business membership data could not be verified for deletion.",
          failureState(storageObjectsRemoved),
        ),
      };
    }
    if (
      memberships.error ||
      (memberships.data !== null && !Array.isArray(memberships.data))
    ) {
      return {
        businessIds: null,
        failure: failure(
          "DELETION_PREFLIGHT_FAILED",
          "Business membership data could not be verified for deletion.",
          failureState(storageObjectsRemoved),
        ),
      };
    }
    if ((memberships.data ?? []).length > 0) {
      return {
        businessIds: null,
        failure: failure(
          "BUSINESS_TRANSFER_REQUIRED",
          "Transfer ownership or remove the other business members before deleting your account.",
          failureState(storageObjectsRemoved),
          { status: 409, retryable: false },
        ),
      };
    }
  }

  return { businessIds, failure: null };
}

function sameBusinessScope(expected: string[], observed: string[]): boolean {
  return expected.length === observed.length &&
    expected.every((id, index) => id === observed[index]);
}

function changedScopeFailure(
  storageObjectsRemoved: number,
): AccountDeletionFailure {
  return failure(
    "DELETION_PREFLIGHT_FAILED",
    "Owned business data changed during deletion. Retry after business changes have finished.",
    failureState(storageObjectsRemoved),
  );
}

/**
 * Deletes one authenticated user's account data. All ownership and membership
 * checks plus complete Storage enumeration occur before the first mutation.
 */
export async function deleteAccountData(
  userId: string,
  gateway: AccountDeletionGateway,
): Promise<AccountDeletionResult> {
  if (!UUID_PATTERN.test(userId)) {
    return failure(
      "DELETION_PREFLIGHT_FAILED",
      "Account identity could not be verified for deletion.",
      progress("not_started", 0),
    );
  }

  const initialScope = await loadDeletionScope(userId, gateway, 0);
  if (initialScope.failure) return initialScope.failure;
  const businessIds = initialScope.businessIds;

  const preMutationScope = await loadDeletionScope(userId, gateway, 0);
  if (preMutationScope.failure) return preMutationScope.failure;
  if (!sameBusinessScope(businessIds, preMutationScope.businessIds)) {
    return changedScopeFailure(0);
  }

  let fence: Awaited<ReturnType<AccountDeletionGateway["beginDeletionFence"]>>;
  try {
    fence = await gateway.beginDeletionFence(userId);
  } catch {
    return failure(
      "DELETION_PREFLIGHT_FAILED",
      "Account deletion could not establish its safety fence.",
      progress("not_started", 0),
    );
  }
  if (fence.error || !fence.data) {
    return failure(
      "DELETION_PREFLIGHT_FAILED",
      "Account deletion could not establish its safety fence.",
      progress("not_started", 0),
    );
  }
  if (fence.data.outcome === "blocked") {
    return failure(
      "ACTIVE_STORAGE_OPERATION",
      "An admitted file operation is still finishing. Retry this exact deletion shortly.",
      progress("not_started", 0),
      { status: 409, retryable: true },
    );
  }

  let targets: StorageTarget[];
  try {
    targets = await preflightTargets(gateway, businessIds, userId);
  } catch {
    return failure(
      "DELETION_PREFLIGHT_FAILED",
      "Stored files could not be verified for deletion.",
      progress("not_started", 0),
    );
  }

  const storage = await drainStorageTargets(gateway, targets);
  if (storage.failure) return storage.failure;

  const preAuthScope = await loadDeletionScope(
    userId,
    gateway,
    storage.removed,
  );
  if (preAuthScope.failure) return preAuthScope.failure;
  if (!sameBusinessScope(businessIds, preAuthScope.businessIds)) {
    return changedScopeFailure(storage.removed);
  }

  const auditId = await accountDeletionAuditId(userId);
  let auditResult: { error: unknown | null };
  try {
    auditResult = await gateway.insertDeletionAuditIdempotently({
      id: auditId,
      user_id: userId,
      // This durable record is written before the auth boundary, so it must
      // describe the request rather than falsely claiming deletion completed.
      event_type: "account_deletion_requested",
      metadata: { requested_at: new Date().toISOString() },
    });
  } catch {
    return failure(
      "AUDIT_RECORD_FAILED",
      "Account deletion could not be recorded safely. Retry account deletion.",
      failureState(storage.removed),
    );
  }
  if (auditResult.error) {
    return failure(
      "AUDIT_RECORD_FAILED",
      "Account deletion could not be recorded safely. Retry account deletion.",
      failureState(storage.removed),
    );
  }

  let deleteResult: { error: unknown | null };
  try {
    deleteResult = await gateway.deleteAuthUser(userId);
  } catch {
    return failure(
      "AUTH_DELETION_FAILED",
      "Account deletion could not be confirmed. Retry or contact support.",
      progress(
        storage.removed > 0 ? "partial" : "indeterminate",
        storage.removed,
        { accountDeleted: null, uncertain: true },
      ),
    );
  }
  if (deleteResult.error) {
    return failure(
      "AUTH_DELETION_FAILED",
      "The account could not be deleted. Retry or contact support.",
      failureState(storage.removed),
    );
  }

  return {
    ok: true,
    status: 200,
    success: true,
    deletion: progress("complete", storage.removed, { accountDeleted: true }),
  };
}
