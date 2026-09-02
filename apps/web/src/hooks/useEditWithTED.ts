"use client";

import { useCallback, useRef, useState } from "react";
import {
  type EditAction,
  type EditResultEvent,
  editSectionStream,
} from "@prompted/shared/api-client";
import { ensureApiConfigured } from "@/lib/api";
import { useAuth } from "@/components/providers";
import {
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
  type OwnerDispatchLease,
} from "@/lib/browser-principal-state";
import {
  applyLegacySectionEdit,
  discardLegacySectionEdit,
  fetchLatestLegacySectionEdit,
  type LatestLegacySectionEdit,
  type LegacySectionApplyResult,
} from "@/lib/api/sections";

export interface EditRequest {
  action: EditAction;
  content: string;
  selection?: string;
  instruction?: string;
  domain?: string;
  persistence?: {
    /** Scopes the browser retry identity to the authenticated owner without
     * sending that identity as provider input. */
    userId: string;
    documentId: string;
    sectionId: string;
    expectedSectionRevision: number;
  };
}

export interface PersistedEditIdentity {
  operationId: string;
  acceptedSectionRevision: number;
  resultSha256: string;
  appliedCandidateContent: string;
  appliedCandidateSha256: string;
  requestFingerprint: string | null;
}

export interface EditRunResult {
  content: string;
  changes: string[];
  persisted: PersistedEditIdentity | null;
}

export interface UseEditWithTED {
  streaming: boolean;
  draft: string;
  changes: string[];
  error: string | null;
  run: (req: EditRequest, onDelta?: (cumulative: string) => void) => Promise<EditRunResult | null>;
  applyPersisted: (identity: PersistedEditIdentity) => Promise<LegacySectionApplyResult | null>;
  discardPersisted: (identity: PersistedEditIdentity) => Promise<boolean>;
  recover: (sectionId: string) => Promise<LatestLegacySectionEdit | null>;
  cancel: () => void;
}

interface StoredEditOperation {
  operationId: string;
  createdAt: string;
  userId: string;
  sectionId: string;
}

const EDIT_OPERATIONS_KEY = "prompted:legacy-section-edit-operations:v2";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_EDIT_OPERATIONS = 32;
const volatileOperations = new Map<string, StoredEditOperation>();

export function purgeEditOperationIdentitiesForUser(userId: string): boolean {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) return false;
  for (const [fingerprint, value] of volatileOperations) {
    if (value.userId === normalizedUserId) volatileOperations.delete(fingerprint);
  }
  if (typeof window === "undefined") return true;
  try {
    const raw = sessionStorage.getItem(EDIT_OPERATIONS_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as Record<string, StoredEditOperation>;
    const retained = Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => value?.userId !== normalizedUserId),
    );
    if (Object.keys(retained).length > 0) {
      sessionStorage.setItem(EDIT_OPERATIONS_KEY, JSON.stringify(retained));
    } else {
      sessionStorage.removeItem(EDIT_OPERATIONS_KEY);
    }
    const verifiedRaw = sessionStorage.getItem(EDIT_OPERATIONS_KEY);
    if (!verifiedRaw) return Object.keys(retained).length === 0;
    const verified = JSON.parse(verifiedRaw) as Record<string, StoredEditOperation>;
    return Object.values(verified).every((value) => value?.userId !== normalizedUserId);
  } catch {
    return false;
  }
}

class EditLifecycleError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "EditLifecycleError";
  }
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
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(canonicalise(value))),
      ),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function storedOperations(): Record<string, StoredEditOperation> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(sessionStorage.getItem(EDIT_OPERATIONS_KEY) ?? "{}") as Record<
      string,
      StoredEditOperation
    >;
    return Object.fromEntries(
      Object.entries(parsed).filter(([fingerprint, value]) => {
        const createdAt = Date.parse(value?.createdAt ?? "");
        return (
          SHA256_PATTERN.test(fingerprint) &&
          UUID_V4_PATTERN.test(value?.operationId ?? "") &&
          UUID_PATTERN.test(value?.userId ?? "") &&
          UUID_PATTERN.test(value?.sectionId ?? "") &&
          Number.isFinite(createdAt)
        );
      }),
    );
  } catch {
    return {};
  }
}

function persistOperations(operations: Record<string, StoredEditOperation>): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(EDIT_OPERATIONS_KEY, JSON.stringify(operations));
  } catch {
    // The in-memory mapping still preserves retry identity for this page.
  }
}

function pruneVolatileOperations(): void {
  for (const [fingerprint, value] of volatileOperations) {
    const createdAt = Date.parse(value.createdAt);
    if (
      !Number.isFinite(createdAt) ||
      !UUID_V4_PATTERN.test(value.operationId) ||
      !UUID_PATTERN.test(value.userId) ||
      !UUID_PATTERN.test(value.sectionId)
    ) {
      volatileOperations.delete(fingerprint);
    }
  }
}

async function resolveOperation(
  req: EditRequest,
  lease: OwnerDispatchLease,
): Promise<{
  operationId: string;
  fingerprint: string;
}> {
  lease.assertCurrent();
  pruneVolatileOperations();
  const fingerprint = await sha256({
    contract: "legacy-section-edit-client.1",
    action: req.action,
    content: req.content,
    selection: req.selection ?? null,
    instruction: req.instruction ?? null,
    domain: req.domain ?? null,
    persistence: req.persistence,
  });
  lease.assertCurrent();
  const stored = storedOperations();
  const existing = volatileOperations.get(fingerprint) ?? stored[fingerprint];
  if (
    existing &&
    existing.userId === req.persistence?.userId &&
    existing.sectionId === req.persistence?.sectionId
  ) {
    return { operationId: existing.operationId, fingerprint };
  }
  if (existing) {
    volatileOperations.delete(fingerprint);
    delete stored[fingerprint];
    persistOperations(stored);
  }
  volatileOperations.delete(fingerprint);

  const allOperations = new Map<string, StoredEditOperation>([
    ...Object.entries(stored),
    ...volatileOperations.entries(),
  ]);
  if (
    [...allOperations.entries()].some(
      ([existingFingerprint, value]) =>
        existingFingerprint !== fingerprint &&
        value.userId === req.persistence?.userId &&
        value.sectionId === req.persistence?.sectionId,
    )
  ) {
    throw new EditLifecycleError("LEGACY_SECTION_EDIT_RECONCILING");
  }
  if (allOperations.size >= MAX_EDIT_OPERATIONS) {
    throw new EditLifecycleError("LEGACY_SECTION_EDIT_IDENTITY_CAPACITY");
  }

  const next = {
    operationId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    userId: req.persistence!.userId,
    sectionId: req.persistence!.sectionId,
  };
  lease.assertCurrent();
  volatileOperations.set(fingerprint, next);
  persistOperations({ ...stored, [fingerprint]: next });
  return { operationId: next.operationId, fingerprint };
}

function forgetOperationById(operationId: string): void {
  const stored = storedOperations();
  for (const [fingerprint, value] of volatileOperations) {
    if (value.operationId === operationId) volatileOperations.delete(fingerprint);
  }
  for (const [fingerprint, value] of Object.entries(stored)) {
    if (value.operationId === operationId) delete stored[fingerprint];
  }
  persistOperations(stored);
}

function forgetOperation(identity: PersistedEditIdentity): void {
  const stored = storedOperations();
  if (identity.requestFingerprint) {
    volatileOperations.delete(identity.requestFingerprint);
    delete stored[identity.requestFingerprint];
  } else {
    forgetOperationById(identity.operationId);
    return;
  }
  persistOperations(stored);
}

function persistedIdentity(
  result: EditResultEvent | null,
  requestFingerprint: string | null,
): PersistedEditIdentity | null {
  return result &&
    UUID_V4_PATTERN.test(result.operation_id) &&
    Number.isInteger(result.accepted_section_revision) &&
    result.accepted_section_revision > 0 &&
    SHA256_PATTERN.test(result.result_sha256) &&
    result.applied_candidate_content.trim().length > 0 &&
    SHA256_PATTERN.test(result.applied_candidate_sha256)
    ? {
        operationId: result.operation_id,
        acceptedSectionRevision: result.accepted_section_revision,
        resultSha256: result.result_sha256,
        appliedCandidateContent: result.applied_candidate_content,
        appliedCandidateSha256: result.applied_candidate_sha256,
        requestFingerprint,
      }
    : null;
}

function errorCode(value: unknown): string {
  return value && typeof value === "object" && "code" in value
    ? String((value as { code?: unknown }).code ?? "")
    : value instanceof Error
      ? value.message
      : "";
}

function isTerminalOperationCode(code: string): boolean {
  return (
    code === "LEGACY_SECTION_EDIT_CANCELLED" ||
    code === "LEGACY_SECTION_EDIT_TERMINAL_FAILURE" ||
    code === "LEGACY_SECTION_EDIT_RECONCILIATION_REQUIRED" ||
    code === "LEGACY_SECTION_EDIT_ALREADY_FINAL" ||
    code === "LEGACY_SECTION_EDIT_STALE"
  );
}

function isTerminalRecoveryState(state: LatestLegacySectionEdit["state"]): boolean {
  return state !== "accepted" && state !== "provider_dispatched" && state !== "ready";
}

export function useEditWithTED(): UseEditWithTED {
  const { user } = useAuth();
  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [changes, setChanges] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    setError(
      "Cancellation requested. TED is reconciling the durable edit before another attempt can start.",
    );
  }, []);

  const run = useCallback(
    async (req: EditRequest, onDelta?: (cumulative: string) => void) => {
      if (!user?.id || (req.persistence && req.persistence.userId !== user.id)) {
        setError("Sign in again before asking TED to edit this section.");
        return null;
      }
      const controller = new AbortController();
      let requestContext: OwnerDispatchLease;
      try {
        requestContext = captureOwnerDispatch(user.id, controller.signal);
      } catch {
        setError("Sign in again before asking TED to edit this section.");
        return null;
      }
      ensureApiConfigured();
      setError(null);
      setDraft("");
      setChanges([]);
      setStreaming(true);

      controllerRef.current = controller;
      let accumulated = "";
      let finalChanges: string[] = [];
      let operation: { operationId: string; fingerprint: string } | null = null;

      try {
        operation = req.persistence ? await resolveOperation(req, requestContext) : null;
        requestContext.assertCurrent();
        const streamResult = await editSectionStream(
          {
            action: req.action,
            content: req.content,
            selection: req.selection,
            instruction: req.instruction,
            domain: req.domain,
            persistence:
              operation && req.persistence
                ? {
                    operation_id: operation.operationId,
                    document_id: req.persistence.documentId,
                    section_id: req.persistence.sectionId,
                    expected_section_revision: req.persistence.expectedSectionRevision,
                  }
                : undefined,
          },
          (text) => {
            if (!ownerDispatchIsCurrent(requestContext) || controllerRef.current !== controller)
              return;
            accumulated += text;
            setDraft(accumulated);
            onDelta?.(accumulated);
          },
          (list) => {
            if (!ownerDispatchIsCurrent(requestContext) || controllerRef.current !== controller)
              return;
            finalChanges = list;
            setChanges(list);
          },
          requestContext,
        );
        requestContext.assertCurrent();
        return {
          content: accumulated,
          changes: finalChanges,
          persisted: persistedIdentity(streamResult.result, operation?.fingerprint ?? null),
        };
      } catch (caught) {
        if (!ownerDispatchIsCurrent(requestContext)) return null;
        const code = errorCode(caught);
        if (operation && isTerminalOperationCode(code)) {
          forgetOperation({
            operationId: operation.operationId,
            acceptedSectionRevision: req.persistence?.expectedSectionRevision ?? 1,
            resultSha256: "",
            appliedCandidateContent: "",
            appliedCandidateSha256: "",
            requestFingerprint: operation.fingerprint,
          });
        }
        if (controller.signal.aborted) {
          setError(
            "Cancellation requested. TED is reconciling the durable edit before another attempt can start.",
          );
          return null;
        }
        setError(
          isTerminalOperationCode(code)
            ? "That edit attempt ended without changing your document. Start the edit again for a new attempt."
            : code === "LEGACY_SECTION_EDIT_IN_PROGRESS" ||
                code === "LEGACY_SECTION_EDIT_RECONCILING"
              ? "TED is reconciling that durable edit. Wait for its saved state before starting another attempt."
              : code === "LEGACY_SECTION_EDIT_IDENTITY_CAPACITY"
                ? "TED has too many unfinished saved edits in this tab. Reopen their sections so TED can reconcile them."
                : "TED couldn't finish that edit. If the response was interrupted, retrying will resume the same suggestion safely.",
        );
        return null;
      } finally {
        if (controllerRef.current === controller) {
          setStreaming(false);
          controllerRef.current = null;
        }
      }
    },
    [user?.id],
  );

  const applyPersisted = useCallback(
    async (identity: PersistedEditIdentity): Promise<LegacySectionApplyResult | null> => {
      if (!user?.id) return null;
      const requestContext = captureOwnerDispatch(user.id);
      setError(null);
      try {
        const result = await applyLegacySectionEdit(
          {
            operationId: identity.operationId,
            expectedSectionRevision: identity.acceptedSectionRevision,
            resultSha256: identity.resultSha256,
            content: identity.appliedCandidateContent,
          },
          requestContext,
        );
        requestContext.assertCurrent();
        forgetOperation(identity);
        return result;
      } catch (caught) {
        if (!ownerDispatchIsCurrent(requestContext)) return null;
        const code = caught instanceof Error ? caught.message : "";
        setError(
          code.includes("STALE")
            ? "This section changed in another save or tab. Your TED suggestion was not applied."
            : "TED couldn't confirm that the suggestion was applied. Try Apply again; an exact replay is safe.",
        );
        return null;
      }
    },
    [user?.id],
  );

  const discardPersisted = useCallback(
    async (identity: PersistedEditIdentity): Promise<boolean> => {
      if (!user?.id) return false;
      const requestContext = captureOwnerDispatch(user.id);
      setError(null);
      try {
        await discardLegacySectionEdit(
          {
            operationId: identity.operationId,
            resultSha256: identity.resultSha256,
          },
          requestContext,
        );
        requestContext.assertCurrent();
        forgetOperation(identity);
        return true;
      } catch {
        if (ownerDispatchIsCurrent(requestContext)) {
          setError("TED couldn't confirm that the suggestion was discarded. Try Discard again.");
        }
        return false;
      }
    },
    [user?.id],
  );

  const recover = useCallback(
    async (sectionId: string) => {
      if (!user?.id) return null;
      const requestContext = captureOwnerDispatch(user.id);
      try {
        const recovered = await fetchLatestLegacySectionEdit(sectionId, requestContext);
        requestContext.assertCurrent();
        if (recovered && isTerminalRecoveryState(recovered.state)) {
          forgetOperationById(recovered.operation_id);
        }
        return recovered;
      } catch {
        if (ownerDispatchIsCurrent(requestContext)) {
          setError(
            "TED couldn't check for an unfinished suggestion. Your document was not changed.",
          );
        }
        return null;
      }
    },
    [user?.id],
  );

  return {
    streaming,
    draft,
    changes,
    error,
    run,
    applyPersisted,
    discardPersisted,
    recover,
    cancel,
  };
}
