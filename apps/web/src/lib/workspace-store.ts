"use client";

import type {
  ConversationMessage,
  DocumentPlaceholderMetadata,
  Section,
} from "@prompted/shared/browser";
import type { RecommendationItem } from "@prompted/shared/orchestration";

export interface StoredWorkspace {
  documentId: string;
  outcomeId: string;
  title: string;
  situation: string;
  status: string;
  sections: Section[];
  generated?: boolean;
  templateId?: string;
  conversationContext?: string;
  uploadContext?: string;
  uploadId?: string;
  unresolvedPlaceholders?: DocumentPlaceholderMetadata[];
}

export interface PendingOutcome {
  situation: string;
  templateName: string;
  templateId?: string;
  conversationContext?: string;
  uploadContext?: string;
  uploadId?: string;
  conversation?: ConversationMessage[];
  /** Formats offered alongside the selected recommendation, available after opening it. */
  alternateFormats?: RecommendationItem[];
}

export interface WorkspaceDocumentState {
  documentId: string;
  title: string;
  situation: string;
  status: string;
  sections: Section[];
  generated: boolean;
  templateId: string | null;
  conversationContext: string;
  uploadContext: string;
  unresolvedPlaceholders?: DocumentPlaceholderMetadata[];
}

export type WorkspaceCacheScope =
  { kind: "guest"; guestId: string } | { kind: "user"; userId: string };

type OwnerBoundCacheKind =
  "workspace" | "pending" | "generation-identities" | "captured-export-intents";

interface OwnerBoundCache<T> {
  version: 3;
  owner: string;
  outcomeId: string;
  value: T;
}

export interface GuestWorkspaceMigrationCandidate {
  workspace: StoredWorkspace;
  pending: PendingOutcome | null;
  imported: boolean;
}

interface GuestWorkspaceMigrationClaim {
  version: 2;
  ownerUserId: string;
  outcomeId: string;
  state: "claimed" | "imported";
  workspace: StoredWorkspace;
  pending: PendingOutcome | null;
}

const CACHE_PREFIX = "prompted:cache:v3";
const GUEST_SCOPE_KEY = `${CACHE_PREFIX}:guest-scope`;
const GUEST_MIGRATION_CLAIM_PREFIX = `${CACHE_PREFIX}:guest-migration-claim`;
let volatileGuestScopeId: string | null = null;

function randomScopeId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  // This value is only a device-cache namespace, not an authentication token.
  // The fallback keeps server/test environments usable when Web Crypto is
  // unavailable; browser production paths use cryptographic randomness above.
  return `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function userWorkspaceCacheScope(userId: string): WorkspaceCacheScope {
  const normalized = userId.trim();
  if (!normalized) throw new Error("WORKSPACE_CACHE_OWNER_INVALID");
  return { kind: "user", userId: normalized };
}

export function currentWorkspaceCacheScope(userId?: string | null): WorkspaceCacheScope {
  if (userId?.trim()) return userWorkspaceCacheScope(userId);
  if (typeof window === "undefined") {
    volatileGuestScopeId ??= randomScopeId();
    return { kind: "guest", guestId: volatileGuestScopeId };
  }
  try {
    const stored = sessionStorage.getItem(GUEST_SCOPE_KEY)?.trim();
    const guestId = stored || volatileGuestScopeId || randomScopeId();
    volatileGuestScopeId = guestId;
    if (!stored) sessionStorage.setItem(GUEST_SCOPE_KEY, guestId);
    return { kind: "guest", guestId };
  } catch {
    volatileGuestScopeId ??= randomScopeId();
    return { kind: "guest", guestId: volatileGuestScopeId };
  }
}

function ownerToken(scope: WorkspaceCacheScope): string {
  return scope.kind === "user" ? `user:${scope.userId}` : `guest:${scope.guestId}`;
}

function cacheKey(
  scope: WorkspaceCacheScope,
  kind: OwnerBoundCacheKind,
  outcomeId: string,
): string {
  return `${CACHE_PREFIX}:${encodeURIComponent(ownerToken(scope))}:${kind}:${encodeURIComponent(outcomeId)}`;
}

function guestClaimKey(scope: WorkspaceCacheScope, outcomeId: string): string {
  if (scope.kind !== "guest") throw new Error("GUEST_WORKSPACE_SCOPE_REQUIRED");
  return `${GUEST_MIGRATION_CLAIM_PREFIX}:${encodeURIComponent(scope.guestId)}:${encodeURIComponent(outcomeId)}`;
}

interface StoredGenerationIdentity {
  version: 3;
  inputSha256: string;
  requestId: string;
  createdAt: string;
}

type StoredGenerationIdentities = Record<string, StoredGenerationIdentity>;

interface StoredCapturedExportIntent {
  version: 1;
  sequence: number;
  updatedAt: string;
}

type StoredCapturedExportIntents = Record<string, StoredCapturedExportIntent>;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_GENERATION_IDENTITIES = 32;
const volatileGenerationIdentities = new Map<string, StoredGenerationIdentity>();
const MAX_CAPTURED_EXPORT_INTENTS = 16;
const CAPTURED_EXPORT_INTENT_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,300}$/;
const volatileCapturedExportIntents = new Map<string, StoredCapturedExportIntent>();

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readOwnerBound<T>(
  scope: WorkspaceCacheScope,
  outcomeId: string,
  kind: OwnerBoundCacheKind,
): T | null {
  if (typeof window === "undefined") return null;
  const parsed = safeParse<OwnerBoundCache<T>>(
    sessionStorage.getItem(cacheKey(scope, kind, outcomeId)),
  );
  if (
    !parsed ||
    parsed.version !== 3 ||
    parsed.owner !== ownerToken(scope) ||
    parsed.outcomeId !== outcomeId
  ) {
    return null;
  }
  return parsed.value;
}

function writeOwnerBound<T>(
  scope: WorkspaceCacheScope,
  outcomeId: string,
  kind: OwnerBoundCacheKind,
  value: T,
): void {
  sessionStorage.setItem(
    cacheKey(scope, kind, outcomeId),
    JSON.stringify({ version: 3, owner: ownerToken(scope), outcomeId, value }),
  );
}

function guestCacheIsClaimed(scope: WorkspaceCacheScope, outcomeId: string): boolean {
  return scope.kind === "guest" && Boolean(sessionStorage.getItem(guestClaimKey(scope, outcomeId)));
}

function validWorkspaceForScope(
  scope: WorkspaceCacheScope,
  outcomeId: string,
  value: unknown,
): value is StoredWorkspace {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const workspace = value as Partial<StoredWorkspace>;
  if (
    workspace.outcomeId !== outcomeId ||
    typeof workspace.documentId !== "string" ||
    !workspace.documentId.trim() ||
    typeof workspace.title !== "string" ||
    typeof workspace.situation !== "string" ||
    typeof workspace.status !== "string" ||
    !Array.isArray(workspace.sections)
  ) {
    return false;
  }
  return workspace.sections.every((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const section = raw as Partial<Section>;
    if (section.document_id !== workspace.documentId || typeof section.user_id !== "string") {
      return false;
    }
    return scope.kind === "user"
      ? section.user_id === scope.userId
      : ["", "anonymous", "guest"].includes(section.user_id);
  });
}

function validPendingOutcome(value: unknown): value is PendingOutcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pending = value as Partial<PendingOutcome>;
  return typeof pending.situation === "string" && typeof pending.templateName === "string";
}

function hasUnavailableSectionBody(value: StoredWorkspace): boolean {
  return (
    Array.isArray(value.sections) &&
    value.sections.some(
      (section) => (section as Section & { content_loaded?: unknown }).content_loaded === false,
    )
  );
}

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalise(item)]),
    );
  }
  return value;
}

async function sha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(canonicalise(value))),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validGenerationIdentity(value: unknown): value is StoredGenerationIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<StoredGenerationIdentity>;
  return (
    candidate.version === 3 &&
    typeof candidate.inputSha256 === "string" &&
    SHA256_PATTERN.test(candidate.inputSha256) &&
    typeof candidate.requestId === "string" &&
    REQUEST_ID_PATTERN.test(candidate.requestId) &&
    typeof candidate.createdAt === "string" &&
    Number.isFinite(Date.parse(candidate.createdAt))
  );
}

function storedGenerationIdentities(
  scope: WorkspaceCacheScope,
  outcomeId: string,
): StoredGenerationIdentities {
  if (typeof window === "undefined") return {};
  try {
    const parsed = readOwnerBound<Record<string, unknown>>(
      scope,
      outcomeId,
      "generation-identities",
    );
    if (!parsed) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => validGenerationIdentity(value))
        .slice(-MAX_GENERATION_IDENTITIES),
    ) as StoredGenerationIdentities;
  } catch {
    return {};
  }
}

/**
 * Derives one generation identity for one exact canonical request. The
 * identity is stable across tabs, browsers, devices and denied/evicted web
 * storage because storage is only a privacy-safe cache, never its authority.
 * A changed request body (including an explicit persisted generation
 * revision when the product adds intentional same-input regeneration)
 * deterministically rotates the identity.
 */
export async function resolveGenerationRequestIdentity(
  scope: WorkspaceCacheScope,
  outcomeId: string,
  operationKey: string,
  input: unknown,
): Promise<string> {
  const inputSha256 = await sha256(input);
  const requestId = `gen-${await sha256({
    contract: "generation-request-identity.3",
    owner: ownerToken(scope),
    outcomeId,
    operationKey,
    inputSha256,
  })}`;
  const volatileKey = `${ownerToken(scope)}\u0000${outcomeId}\u0000${operationKey}`;
  const stored = storedGenerationIdentities(scope, outcomeId);
  const existing = stored[operationKey] ?? volatileGenerationIdentities.get(volatileKey);
  if (
    stored[operationKey] &&
    existing?.inputSha256 === inputSha256 &&
    existing.requestId === requestId
  )
    return requestId;

  const next: StoredGenerationIdentity = {
    version: 3,
    inputSha256,
    requestId,
    createdAt: new Date().toISOString(),
  };
  volatileGenerationIdentities.set(volatileKey, next);

  if (typeof window !== "undefined") {
    try {
      const entries = Object.entries({ ...stored, [operationKey]: next })
        .sort(([, left], [, right]) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
        .slice(-MAX_GENERATION_IDENTITIES);
      writeOwnerBound(scope, outcomeId, "generation-identities", Object.fromEntries(entries));
    } catch {
      // The in-memory fallback still prevents duplicate work during this page
      // lifetime. A storage failure never exposes request content.
    }
  }

  return requestId;
}

function validCapturedExportIntent(value: unknown): value is StoredCapturedExportIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<StoredCapturedExportIntent>;
  return (
    candidate.version === 1 &&
    Number.isSafeInteger(candidate.sequence) &&
    (candidate.sequence ?? -1) >= 0 &&
    typeof candidate.updatedAt === "string" &&
    Number.isFinite(Date.parse(candidate.updatedAt))
  );
}

function storedCapturedExportIntents(
  scope: WorkspaceCacheScope,
  outcomeId: string,
): StoredCapturedExportIntents {
  if (typeof window === "undefined") return {};
  try {
    const parsed = readOwnerBound<Record<string, unknown>>(
      scope,
      outcomeId,
      "captured-export-intents",
    );
    if (!parsed) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(
          ([key, value]) =>
            CAPTURED_EXPORT_INTENT_KEY_PATTERN.test(key) && validCapturedExportIntent(value),
        )
        .slice(-MAX_CAPTURED_EXPORT_INTENTS),
    ) as StoredCapturedExportIntents;
  } catch {
    return {};
  }
}

/**
 * Returns the durable browser-side sequence for one explicit captured-export
 * intent. Sequence zero is deterministic after storage loss, so an uncertain
 * request safely replays the first server receipt instead of duplicating it.
 * The sequence advances only when the user explicitly asks for a new export
 * from the same immutable approved revision. Browser delivery never proves an
 * operating-system download and therefore never rotates this identity.
 */
export function resolveCapturedExportIntentSequence(
  scope: WorkspaceCacheScope,
  outcomeId: string,
  intentKey: string,
): number {
  if (!CAPTURED_EXPORT_INTENT_KEY_PATTERN.test(intentKey)) {
    throw new Error("CAPTURED_EXPORT_INTENT_INVALID");
  }
  const volatileKey = `${ownerToken(scope)}\u0000${outcomeId}\u0000${intentKey}`;
  const stored = storedCapturedExportIntents(scope, outcomeId)[intentKey];
  const current = stored ?? volatileCapturedExportIntents.get(volatileKey);
  if (current && validCapturedExportIntent(current)) return current.sequence;
  const initial: StoredCapturedExportIntent = {
    version: 1,
    sequence: 0,
    updatedAt: new Date().toISOString(),
  };
  volatileCapturedExportIntents.set(volatileKey, initial);
  return initial.sequence;
}

/** Advances only the currently active intent for an explicit new export. */
export function advanceCapturedExportIntentSequenceForNewExport(
  scope: WorkspaceCacheScope,
  outcomeId: string,
  intentKey: string,
  expectedSequence: number,
): boolean {
  if (!Number.isSafeInteger(expectedSequence) || expectedSequence < 0) return false;
  const current = resolveCapturedExportIntentSequence(scope, outcomeId, intentKey);
  if (current !== expectedSequence || current === Number.MAX_SAFE_INTEGER) return false;
  const next: StoredCapturedExportIntent = {
    version: 1,
    sequence: current + 1,
    updatedAt: new Date().toISOString(),
  };
  const volatileKey = `${ownerToken(scope)}\u0000${outcomeId}\u0000${intentKey}`;
  volatileCapturedExportIntents.set(volatileKey, next);
  if (typeof window !== "undefined") {
    try {
      const stored = storedCapturedExportIntents(scope, outcomeId);
      const entries = Object.entries({ ...stored, [intentKey]: next })
        .sort(([, left], [, right]) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt))
        .slice(-MAX_CAPTURED_EXPORT_INTENTS);
      writeOwnerBound(scope, outcomeId, "captured-export-intents", Object.fromEntries(entries));
    } catch {
      // The scoped in-memory sequence still protects this page lifetime.
    }
  }
  return true;
}

/** Stable row identity for material persisted after one replayable generation. */
export async function deterministicGenerationEntityId(
  requestId: string,
  entityKey: string,
): Promise<string> {
  if (!REQUEST_ID_PATTERN.test(requestId) || !entityKey.trim()) {
    throw new Error("GENERATION_ENTITY_IDENTITY_INVALID");
  }
  const digest = await sha256({ requestId, entityKey });
  const variant = ((Number.parseInt(digest[16]!, 16) & 0x3) | 0x8).toString(16);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

export function loadWorkspace(
  scope: WorkspaceCacheScope,
  outcomeId: string,
): StoredWorkspace | null {
  if (typeof window === "undefined") return null;
  try {
    if (guestCacheIsClaimed(scope, outcomeId)) return null;
    const workspace = readOwnerBound<unknown>(scope, outcomeId, "workspace");
    return validWorkspaceForScope(scope, outcomeId, workspace) &&
      !hasUnavailableSectionBody(workspace)
      ? workspace
      : null;
  } catch {
    return null;
  }
}

export function saveWorkspace(scope: WorkspaceCacheScope, workspace: StoredWorkspace): void {
  if (typeof window === "undefined") return;
  if (
    !validWorkspaceForScope(scope, workspace.outcomeId, workspace) ||
    hasUnavailableSectionBody(workspace)
  )
    return;
  try {
    writeOwnerBound(scope, workspace.outcomeId, "workspace", workspace);
  } catch {
    // Storage may be full or unavailable.
  }
}

export function loadPendingOutcome(
  scope: WorkspaceCacheScope,
  outcomeId: string,
): PendingOutcome | null {
  if (typeof window === "undefined") return null;
  try {
    if (guestCacheIsClaimed(scope, outcomeId)) return null;
    const pending = readOwnerBound<unknown>(scope, outcomeId, "pending");
    return validPendingOutcome(pending) ? pending : null;
  } catch {
    return null;
  }
}

export function savePendingOutcome(
  scope: WorkspaceCacheScope,
  outcomeId: string,
  pending: PendingOutcome,
): void {
  if (typeof window === "undefined") return;
  if (!validPendingOutcome(pending)) return;
  try {
    writeOwnerBound(scope, outcomeId, "pending", pending);
  } catch {
    // Best-effort persistence.
  }
}

function guestWorkspaceOutcomeIds(scope: WorkspaceCacheScope): string[] {
  if (typeof window === "undefined" || scope.kind !== "guest") return [];
  try {
    const prefix = `${CACHE_PREFIX}:${encodeURIComponent(ownerToken(scope))}:workspace:`;
    const outcomeIds = new Set<string>();
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      try {
        outcomeIds.add(decodeURIComponent(key.slice(prefix.length)));
      } catch {
        // Malformed cache keys are quarantined with other unreadable entries.
      }
    }
    return [...outcomeIds].sort();
  } catch {
    return [];
  }
}

function validGuestMigrationClaim(
  scope: WorkspaceCacheScope,
  outcomeId: string,
  value: unknown,
): value is GuestWorkspaceMigrationClaim {
  if (scope.kind !== "guest" || !value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const claim = value as Partial<GuestWorkspaceMigrationClaim>;
  return (
    claim.version === 2 &&
    typeof claim.ownerUserId === "string" &&
    claim.ownerUserId.trim().length > 0 &&
    claim.outcomeId === outcomeId &&
    (claim.state === "claimed" || claim.state === "imported") &&
    validWorkspaceForScope(scope, outcomeId, claim.workspace) &&
    !hasUnavailableSectionBody(claim.workspace) &&
    (claim.pending === null || validPendingOutcome(claim.pending))
  );
}

function readGuestMigrationClaim(
  scope: WorkspaceCacheScope,
  outcomeId: string,
): GuestWorkspaceMigrationClaim | null {
  if (scope.kind !== "guest") return null;
  try {
    const parsed = safeParse<unknown>(sessionStorage.getItem(guestClaimKey(scope, outcomeId)));
    return validGuestMigrationClaim(scope, outcomeId, parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function guestClaimOutcomeIds(scope: WorkspaceCacheScope, userId: string): string[] {
  if (typeof window === "undefined" || scope.kind !== "guest") return [];
  const prefix = `${GUEST_MIGRATION_CLAIM_PREFIX}:${encodeURIComponent(scope.guestId)}:`;
  const outcomeIds = new Set<string>();
  try {
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      try {
        const outcomeId = decodeURIComponent(key.slice(prefix.length));
        if (readGuestMigrationClaim(scope, outcomeId)?.ownerUserId === userId) {
          outcomeIds.add(outcomeId);
        }
      } catch {
        // Malformed claim keys remain quarantined.
      }
    }
  } catch {
    return [];
  }
  return [...outcomeIds];
}

function guestClaimOwner(scope: WorkspaceCacheScope, outcomeId: string): string | null {
  if (typeof window === "undefined" || scope.kind !== "guest") return null;
  try {
    const raw = sessionStorage.getItem(guestClaimKey(scope, outcomeId));
    if (!raw) return null;
    return readGuestMigrationClaim(scope, outcomeId)?.ownerUserId ?? raw;
  } catch {
    return null;
  }
}

export function hasGuestWorkspaceForMigration(userId: string): boolean {
  try {
    const scope = currentWorkspaceCacheScope();
    return guestClaimOutcomeIds(scope, userId).length > 0;
  } catch {
    return false;
  }
}

function unclaimedGuestWorkspaceOutcomeIds(scope: WorkspaceCacheScope): string[] {
  if (scope.kind !== "guest") return [];
  return guestWorkspaceOutcomeIds(scope).filter((outcomeId) => {
    if (guestClaimOwner(scope, outcomeId)) return false;
    const workspace = readOwnerBound<unknown>(scope, outcomeId, "workspace");
    return (
      validWorkspaceForScope(scope, outcomeId, workspace) && !hasUnavailableSectionBody(workspace)
    );
  });
}

export function hasUnclaimedGuestWorkspaceForReview(): boolean {
  try {
    return unclaimedGuestWorkspaceOutcomeIds(currentWorkspaceCacheScope()).length > 0;
  } catch {
    return false;
  }
}

export function claimGuestWorkspaceForMigration(
  userId: string,
  outcomeId: string,
): GuestWorkspaceMigrationCandidate | null {
  if (typeof window === "undefined" || !userId.trim()) return null;
  try {
    const scope = currentWorkspaceCacheScope();
    if (scope.kind !== "guest") return null;
    const claimKey = guestClaimKey(scope, outcomeId);
    const existingClaim = readGuestMigrationClaim(scope, outcomeId);
    if (existingClaim) {
      if (existingClaim.ownerUserId !== userId) return null;
      return {
        workspace: existingClaim.workspace,
        pending: existingClaim.pending,
        imported: existingClaim.state === "imported",
      };
    }
    const legacyClaimOwner = guestClaimOwner(scope, outcomeId);
    if (legacyClaimOwner && legacyClaimOwner !== userId) return null;
    const workspace = readOwnerBound<unknown>(scope, outcomeId, "workspace");
    if (
      !validWorkspaceForScope(scope, outcomeId, workspace) ||
      hasUnavailableSectionBody(workspace)
    ) {
      return null;
    }
    const rawPending = readOwnerBound<unknown>(scope, outcomeId, "pending");
    const pending = validPendingOutcome(rawPending) ? rawPending : null;
    const claim: GuestWorkspaceMigrationClaim = {
      version: 2,
      ownerUserId: userId,
      outcomeId,
      state: "claimed",
      workspace,
      pending,
    };
    sessionStorage.setItem(claimKey, JSON.stringify(claim));
    const persisted = readGuestMigrationClaim(scope, outcomeId);
    return persisted?.ownerUserId === userId
      ? { workspace: persisted.workspace, pending: persisted.pending, imported: false }
      : null;
  } catch {
    return null;
  }
}

export function listGuestWorkspaceOutcomeIdsForMigration(userId: string): string[] {
  try {
    const scope = currentWorkspaceCacheScope();
    // Automatic and retry paths may resume only an immutable claim already
    // bound to this exact account. Ownerless browser work requires consent.
    return guestClaimOutcomeIds(scope, userId).sort();
  } catch {
    return [];
  }
}

export function claimUnclaimedGuestWorkspacesForMigration(userId: string): number {
  if (!userId.trim()) return 0;
  try {
    const scope = currentWorkspaceCacheScope();
    let claimed = 0;
    for (const outcomeId of unclaimedGuestWorkspaceOutcomeIds(scope)) {
      if (claimGuestWorkspaceForMigration(userId, outcomeId)) claimed += 1;
    }
    return claimed;
  } catch {
    return 0;
  }
}

export function discardUnclaimedGuestWorkspaces(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const scope = currentWorkspaceCacheScope();
    if (scope.kind !== "guest") return true;
    for (const outcomeId of unclaimedGuestWorkspaceOutcomeIds(scope)) {
      if (guestClaimOwner(scope, outcomeId)) continue;
      for (const kind of [
        "pending",
        "generation-identities",
        "captured-export-intents",
        "workspace",
      ] as const) {
        const storedKey = cacheKey(scope, kind, outcomeId);
        sessionStorage.removeItem(storedKey);
        if (sessionStorage.getItem(storedKey) !== null) return false;
      }
    }
    return unclaimedGuestWorkspaceOutcomeIds(scope).length === 0;
  } catch {
    return false;
  }
}

export function markGuestWorkspaceMigrationImported(userId: string, outcomeId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const scope = currentWorkspaceCacheScope();
    if (scope.kind !== "guest") return false;
    const claim = readGuestMigrationClaim(scope, outcomeId);
    if (!claim || claim.ownerUserId !== userId) return false;
    if (claim.state === "imported") return true;
    sessionStorage.setItem(
      guestClaimKey(scope, outcomeId),
      JSON.stringify({
        ...claim,
        state: "imported" satisfies GuestWorkspaceMigrationClaim["state"],
      }),
    );
    return readGuestMigrationClaim(scope, outcomeId)?.state === "imported";
  } catch {
    return false;
  }
}

export function completeGuestWorkspaceMigration(userId: string, outcomeId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const scope = currentWorkspaceCacheScope();
    if (scope.kind !== "guest" || guestClaimOwner(scope, outcomeId) !== userId) return false;
    // The immutable claim bundle remains until every mutable source key has
    // been cleared, so a retry can never reconstruct a different RPC body.
    for (const kind of [
      "pending",
      "generation-identities",
      "captured-export-intents",
      "workspace",
    ] as const) {
      const storedKey = cacheKey(scope, kind, outcomeId);
      sessionStorage.removeItem(storedKey);
      if (sessionStorage.getItem(storedKey) !== null) return false;
    }
    const claimKey = guestClaimKey(scope, outcomeId);
    sessionStorage.removeItem(claimKey);
    return sessionStorage.getItem(claimKey) === null;
  } catch {
    return false;
  }
}

/** Removes only browser data owned or migration-claimed by one deleted user. */
export function purgeWorkspaceCachesForUser(userId: string): boolean {
  if (typeof window === "undefined" || !userId.trim()) return true;
  const normalizedUserId = userId.trim();
  const userPrefix = `${CACHE_PREFIX}:${encodeURIComponent(`user:${normalizedUserId}`)}:`;
  try {
    const keysToRemove: string[] = [];
    const claimedGuestEntries: Array<{ scope: WorkspaceCacheScope; outcomeId: string }> = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const storedKey = sessionStorage.key(index);
      if (!storedKey) continue;
      if (storedKey.startsWith(userPrefix)) keysToRemove.push(storedKey);
      if (storedKey.startsWith(`${GUEST_MIGRATION_CLAIM_PREFIX}:`)) {
        const suffix = storedKey.slice(GUEST_MIGRATION_CLAIM_PREFIX.length + 1);
        const [encodedGuestId, encodedOutcomeId, ...extra] = suffix.split(":");
        if (!encodedGuestId || !encodedOutcomeId || extra.length > 0) {
          continue;
        }
        try {
          const scope: WorkspaceCacheScope = {
            kind: "guest",
            guestId: decodeURIComponent(encodedGuestId),
          };
          const outcomeId = decodeURIComponent(encodedOutcomeId);
          if (guestClaimOwner(scope, outcomeId) === normalizedUserId) {
            claimedGuestEntries.push({ scope, outcomeId });
          }
        } catch {
          // An unreadable foreign claim has no provable owner; leave it
          // quarantined rather than deleting it during another user's purge.
        }
      }
    }
    for (const storedKey of keysToRemove) sessionStorage.removeItem(storedKey);
    for (const { scope, outcomeId } of claimedGuestEntries) {
      sessionStorage.removeItem(cacheKey(scope, "workspace", outcomeId));
      sessionStorage.removeItem(cacheKey(scope, "pending", outcomeId));
      sessionStorage.removeItem(cacheKey(scope, "generation-identities", outcomeId));
      sessionStorage.removeItem(cacheKey(scope, "captured-export-intents", outcomeId));
      sessionStorage.removeItem(guestClaimKey(scope, outcomeId));
    }
    const volatilePrefix = `user:${normalizedUserId}\u0000`;
    for (const key of volatileGenerationIdentities.keys()) {
      if (key.startsWith(volatilePrefix)) volatileGenerationIdentities.delete(key);
    }
    for (const key of volatileCapturedExportIntents.keys()) {
      if (key.startsWith(volatilePrefix)) volatileCapturedExportIntents.delete(key);
    }
    return true;
  } catch {
    return false;
  }
}
