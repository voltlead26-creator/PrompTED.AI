"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  cancelCapturedDocumentOperation,
  getCapturedDocumentOperation,
  resumeCapturedDocumentOperation,
  startCapturedDocumentOperation,
  type CapturedDocumentOperationStatus,
} from "@prompted/shared/api-client";
import { CAPTURED_DOCUMENT_LEDGER } from "@prompted/shared/document-ledger";
import type { FirstCapturedTemplateId } from "@prompted/shared/document-operation";
import { ensureApiConfigured } from "@/lib/api";
import {
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
} from "@/lib/browser-principal-state";
import styles from "./CapturedAdmission.module.css";

const PAGE_SIZE = 3;
const RECONNECT_POLL_MS = 2_000;
const RECONNECT_MAX_BACKOFF_MS = 30_000;
const RESUMABLE_OPERATION_STATUSES = [
  "accepted",
  "generating",
  "validating",
  "persisting",
  "awaiting_capacity",
  "retryable_failure",
] as const;
const IMMEDIATELY_RESUMABLE_OPERATION_STATUSES = ["accepted", "retryable_failure"] as const;

function operationCanResume(operation: CapturedDocumentOperationStatus): boolean {
  if (
    IMMEDIATELY_RESUMABLE_OPERATION_STATUSES.includes(
      operation.status as (typeof IMMEDIATELY_RESUMABLE_OPERATION_STATUSES)[number],
    )
  ) {
    return true;
  }
  return (
    RESUMABLE_OPERATION_STATUSES.includes(
      operation.status as (typeof RESUMABLE_OPERATION_STATUSES)[number],
    ) && operation.resume_available === true
  );
}

interface StoredAdmission {
  ownerUserId: string;
  outcomeId: string;
  documentId: string;
  generationRequestId: string;
  inputRevision: number;
  inputValues: Record<string, string>;
  operationId?: string;
}

interface CapturedAdmissionProps {
  ownerUserId: string;
  outcomeId: string;
  templateId: FirstCapturedTemplateId;
  title: string;
  initialOperation?: CapturedDocumentOperationStatus | null;
  onLegacyFallback: () => void;
  onOpenPersistedWorkspace?: () => void;
}

interface StoredAdmissionEnvelope {
  version: 2;
  ownerUserId: string;
  outcomeId: string;
  value: StoredAdmission;
}

function storageKey(ownerUserId: string, outcomeId: string): string {
  return `prompted:captured-admission:v2:${encodeURIComponent(ownerUserId)}:${encodeURIComponent(outcomeId)}`;
}

function freshAdmission(ownerUserId: string, outcomeId: string): StoredAdmission {
  return {
    ownerUserId,
    outcomeId,
    documentId: crypto.randomUUID(),
    generationRequestId: crypto.randomUUID(),
    inputRevision: 1,
    inputValues: {},
  };
}

function readAdmission(
  ownerUserId: string,
  outcomeId: string,
  initialOperation: CapturedDocumentOperationStatus | null,
): StoredAdmission {
  try {
    const parsed = JSON.parse(
      sessionStorage.getItem(storageKey(ownerUserId, outcomeId)) ?? "null",
    ) as Partial<StoredAdmissionEnvelope> | null;
    const value = parsed?.value as Partial<StoredAdmission> | undefined;
    if (
      parsed?.version === 2 &&
      parsed.ownerUserId === ownerUserId &&
      parsed.outcomeId === outcomeId &&
      value?.ownerUserId === ownerUserId &&
      value.outcomeId === outcomeId &&
      typeof value.documentId === "string" &&
      value.documentId.length > 0 &&
      typeof value.generationRequestId === "string" &&
      value.generationRequestId.length > 0 &&
      value.inputValues &&
      typeof value.inputValues === "object" &&
      !Array.isArray(value.inputValues) &&
      (!initialOperation ||
        (value.operationId === initialOperation.operation_id &&
          value.documentId === initialOperation.document_id))
    ) {
      return {
        ownerUserId,
        outcomeId,
        documentId: value.documentId,
        generationRequestId: value.generationRequestId,
        inputRevision:
          Number.isSafeInteger(value.inputRevision) && Number(value.inputRevision) > 0
            ? Number(value.inputRevision)
            : 1,
        inputValues: Object.fromEntries(
          Object.entries(value.inputValues)
            .filter(
              (entry): entry is [string, string] =>
                typeof entry[0] === "string" &&
                entry[0].length <= 256 &&
                typeof entry[1] === "string" &&
                entry[1].length <= 12_000,
            )
            .slice(0, 128),
        ),
        operationId: typeof value.operationId === "string" ? value.operationId : undefined,
      };
    }
  } catch {
    // A corrupt device-only draft is ignored; durable operation truth remains
    // in Supabase once admission has succeeded.
  }
  return freshAdmission(ownerUserId, outcomeId);
}

function statusLabel(status: string): string {
  switch (status) {
    case "accepted":
      return "Request accepted";
    case "awaiting_capacity":
      return "Waiting for generation capacity";
    case "generating":
      return "TED is drafting from your confirmed facts";
    case "validating":
      return "Checking wording and source grounding";
    case "persisting":
      return "Saving the validated revision";
    case "ready_for_review":
      return "Ready for review";
    case "awaiting_clarification":
      return "More confirmed information is required";
    case "retryable_failure":
      return "The operation can be resumed safely";
    case "cancelled":
      return "The operation was cancelled";
    case "terminal_failure":
      return "The operation could not be completed";
    default:
      return "Checking durable operation state";
  }
}

function operationIdFromError(error: ApiError): string | null {
  if (!error.payload || typeof error.payload !== "object") return null;
  const value = (error.payload as Record<string, unknown>).operation_id;
  return typeof value === "string" ? value : null;
}

export function CapturedAdmission({
  ownerUserId,
  outcomeId,
  templateId,
  title,
  initialOperation = null,
  onLegacyFallback,
  onOpenPersistedWorkspace,
}: CapturedAdmissionProps) {
  const template = CAPTURED_DOCUMENT_LEDGER.templates[templateId];
  if (!template) {
    throw new Error("Captured template contract is unavailable.");
  }
  const inputs = useMemo(
    () => [...template.requiredInputs, ...template.optionalInputs],
    [template],
  );
  const [storedAdmission, setAdmission] = useState<StoredAdmission>(() =>
    readAdmission(ownerUserId, outcomeId, initialOperation),
  );
  const fallbackAdmission = useMemo(
    () => freshAdmission(ownerUserId, outcomeId),
    [outcomeId, ownerUserId],
  );
  const admission =
    storedAdmission.ownerUserId === ownerUserId && storedAdmission.outcomeId === outcomeId
      ? storedAdmission
      : fallbackAdmission;
  const componentIdentity = [
    ownerUserId,
    outcomeId,
    templateId,
    title,
    initialOperation?.operation_id ?? "new",
    initialOperation?.document_id ?? "new",
    initialOperation?.operation_revision ?? 0,
  ].join("\u0000");
  const componentIdentityRef = useRef(componentIdentity);
  const latestIdentityRef = useRef(componentIdentity);
  latestIdentityRef.current = componentIdentity;
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [storedOperation, setOperation] = useState<CapturedDocumentOperationStatus | null>(
    initialOperation,
  );
  const operation =
    componentIdentityRef.current === componentIdentity ? storedOperation : initialOperation;
  const [error, setError] = useState<string | null>(null);
  const operationRef = useRef<CapturedDocumentOperationStatus | null>(initialOperation);
  const operationEpochRef = useRef(0);
  const activeOperationIdRef = useRef<string | null>(
    initialOperation?.operation_id ?? admission.operationId ?? null,
  );
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // React may exercise an effect setup/cleanup cycle in development. Restore
    // the current identity on setup, then invalidate it before any unmounted
    // async continuation can write storage, state, or reload another owner.
    latestIdentityRef.current = componentIdentityRef.current;
    return () => {
      latestIdentityRef.current = "__unmounted__";
      operationEpochRef.current += 1;
      activeOperationIdRef.current = null;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (componentIdentityRef.current === componentIdentity) return;
    controllerRef.current?.abort();
    componentIdentityRef.current = componentIdentity;
    const nextAdmission = readAdmission(ownerUserId, outcomeId, initialOperation);
    setAdmission(nextAdmission);
    setPage(0);
    setBusy(false);
    setCancelling(false);
    setReconnecting(false);
    setError(null);
    setOperation(initialOperation);
    operationRef.current = initialOperation;
    operationEpochRef.current += 1;
    activeOperationIdRef.current = initialOperation?.operation_id ?? nextAdmission.operationId ?? null;
  }, [componentIdentity, initialOperation, outcomeId, ownerUserId]);

  const persist = useCallback(
    (next: StoredAdmission) => {
      if (latestIdentityRef.current !== componentIdentity) return;
      if (next.ownerUserId !== ownerUserId || next.outcomeId !== outcomeId) return;
      setAdmission(next);
      const envelope: StoredAdmissionEnvelope = {
        version: 2,
        ownerUserId,
        outcomeId,
        value: next,
      };
      try {
        sessionStorage.setItem(storageKey(ownerUserId, outcomeId), JSON.stringify(envelope));
      } catch {
        // Controlled input state remains usable in memory when browser storage
        // is unavailable; durable truth begins only after server admission.
      }
    },
    [componentIdentity, outcomeId, ownerUserId],
  );

  const showReadyWorkspace = useCallback(() => {
    if (latestIdentityRef.current !== componentIdentity) return;
    try {
      sessionStorage.removeItem(storageKey(ownerUserId, outcomeId));
    } finally {
      window.location.reload();
    }
  }, [componentIdentity, outcomeId, ownerUserId]);

  const applyOperation = useCallback(
    (next: CapturedDocumentOperationStatus) => {
      if (latestIdentityRef.current !== componentIdentity) return operationRef.current;
      const current = operationRef.current;
      if (
        current?.operation_id === next.operation_id &&
        next.operation_revision < current.operation_revision
      ) {
        return current;
      }
      if (activeOperationIdRef.current !== next.operation_id) {
        operationEpochRef.current += 1;
        activeOperationIdRef.current = next.operation_id;
      }
      operationRef.current = next;
      setOperation(next);
      // Admission data in sessionStorage is only authoritative for the exact
      // document identity it created. A new tab may have durable operation
      // truth but no device-local request snapshot; never bind that operation
      // to the random IDs produced by freshAdmission().
      if (
        next.operation_id &&
        next.document_id === admission.documentId &&
        admission.operationId !== next.operation_id
      ) {
        persist({ ...admission, operationId: next.operation_id });
      }
      if (next.status === "ready_for_review") showReadyWorkspace();
      return next;
    },
    [admission, componentIdentity, persist, showReadyWorkspace],
  );

  const durableOperationId = operation?.operation_id ?? admission.operationId;

  const fetchOperation = useCallback(async (operationId: string, signal?: AbortSignal) => {
    const requestContext = captureOwnerDispatch(ownerUserId, signal);
    ensureApiConfigured();
    return await getCapturedDocumentOperation(operationId, requestContext);
  }, [ownerUserId]);

  const applyReconnect = useCallback(
    (next: CapturedDocumentOperationStatus, expectedOperationId: string, expectedEpoch: number) => {
      if (
        operationEpochRef.current !== expectedEpoch ||
        activeOperationIdRef.current !== expectedOperationId ||
        next.operation_id !== expectedOperationId
      ) {
        return operationRef.current;
      }
      return applyOperation(next);
    },
    [applyOperation],
  );

  const reconnect = useCallback(
    async (signal?: AbortSignal) => {
      if (!durableOperationId) return null;
      const expectedEpoch = operationEpochRef.current;
      const next = await fetchOperation(durableOperationId, signal);
      return applyReconnect(next, durableOperationId, expectedEpoch);
    },
    [applyReconnect, durableOperationId, fetchOperation],
  );

  useEffect(() => {
    if (!durableOperationId) return;
    ensureApiConfigured();
    const controller = new AbortController();
    let stopped = false;
    let timer: number | undefined;
    let consecutiveFailures = 0;

    const schedule = (delay: number) => {
      timer = window.setTimeout(() => {
        if (!stopped) void poll();
      }, delay);
    };

    const poll = async () => {
      try {
        const next = await reconnect(controller.signal);
        if (stopped) return;
        consecutiveFailures = 0;
        setError(null);
        if (
          next &&
          ![
            "ready_for_review",
            "retryable_failure",
            "terminal_failure",
            "cancelled",
            "awaiting_clarification",
          ].includes(next.status)
        ) {
          schedule(RECONNECT_POLL_MS);
        }
      } catch (nextError) {
        const aborted = nextError instanceof DOMException && nextError.name === "AbortError";
        if (!stopped && !aborted) {
          consecutiveFailures += 1;
          setError("TED could not reconnect yet. Your accepted operation is still recorded.");
          schedule(
            Math.min(RECONNECT_POLL_MS * 2 ** (consecutiveFailures - 1), RECONNECT_MAX_BACKOFF_MS),
          );
        }
      }
    };

    void poll();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller.abort();
    };
  }, [durableOperationId, reconnect]);

  const reconnectNow = useCallback(async () => {
    const expectedComponentIdentity = componentIdentity;
    setReconnecting(true);
    setError(null);
    try {
      await reconnect();
    } catch {
      if (latestIdentityRef.current === expectedComponentIdentity) {
        setError("TED could not reconnect yet. Your accepted operation is still recorded.");
      }
    } finally {
      if (latestIdentityRef.current === expectedComponentIdentity) setReconnecting(false);
    }
  }, [componentIdentity, reconnect]);

  const firstMissingRequired = template.requiredInputs.findIndex(
    (input) => !admission.inputValues[input.key]?.trim(),
  );
  const pageCount = Math.max(1, Math.ceil(inputs.length / PAGE_SIZE));
  const pageInputs = inputs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const run = useCallback(async () => {
    const expectedComponentIdentity = componentIdentity;
    const replacingClarification = operation?.status === "awaiting_clarification";
    const resuming = Boolean(operation && operationCanResume(operation));
    if (!resuming) {
      const missingIndex = template.requiredInputs.findIndex(
        (input) => !admission.inputValues[input.key]?.trim(),
      );
      if (missingIndex >= 0) {
        setPage(Math.floor(missingIndex / PAGE_SIZE));
        setError("Add each required fact before TED starts. Nothing has been generated yet.");
        return;
      }
    }

    const controller = new AbortController();
    const requestContext = captureOwnerDispatch(ownerUserId, controller.signal);
    ensureApiConfigured();
    setBusy(true);
    setError(null);
    controllerRef.current = controller;
    let requestAdmission = admission;
    try {
      if (replacingClarification && operation) {
        const cancelled = await cancelCapturedDocumentOperation(
          {
            operation_id: operation.operation_id,
            expected_operation_revision: operation.operation_revision,
            cancellation_code: "owner_cancelled",
          },
          requestContext,
        );
        requestContext.assertCurrent();
        if (latestIdentityRef.current !== expectedComponentIdentity) return;
        if (cancelled.status !== "cancelled") {
          applyOperation({
            ...operation,
            ...cancelled,
            message:
              "Cancellation is recorded. TED will not start replacement work until this operation is durably cancelled.",
          });
          setError(
            "TED is still reconciling the earlier operation. Check its status before revising the confirmed facts.",
          );
          return;
        }

        // Accepted inputs are immutable.  Clarification therefore preserves
        // the prior operation as cancelled and starts a successor with fresh
        // document/idempotency identities and the user's confirmed fields.
        requestAdmission = {
          ...freshAdmission(ownerUserId, outcomeId),
          inputValues: admission.inputValues,
        };
        persist(requestAdmission);
        operationEpochRef.current += 1;
        activeOperationIdRef.current = null;
        operationRef.current = null;
        setOperation(null);
      }

      const next =
        resuming && operation
          ? await resumeCapturedDocumentOperation(
              {
                action: "resume",
                operation_id: operation.operation_id,
              },
              requestContext,
            )
          : await startCapturedDocumentOperation(
              {
                outcome_id: outcomeId,
                document_id: requestAdmission.documentId,
                title,
                template_id: templateId,
                generation_request_id: requestAdmission.generationRequestId,
                input_revision: requestAdmission.inputRevision,
                input_values: requestAdmission.inputValues,
                locale: "en-AU",
                jurisdiction: "AU",
              },
              requestContext,
            );
      requestContext.assertCurrent();
      if (latestIdentityRef.current !== expectedComponentIdentity) return;
      if (!resuming && next.operation_id && next.document_id === requestAdmission.documentId) {
        persist({ ...requestAdmission, operationId: next.operation_id });
      }
      applyOperation(next);
      if (next.status === "awaiting_clarification") {
        setError(
          "The server still found a blocking fact. Review the highlighted questions before resuming.",
        );
      }
    } catch (nextError) {
      if (!ownerDispatchIsCurrent(requestContext)) return;
      if (latestIdentityRef.current !== expectedComponentIdentity) return;
      if (
        (!operation || replacingClarification) &&
        nextError instanceof ApiError &&
        ["CAPTURED_ACTIVATION_DISABLED", "CAPTURED_ROLLOUT_NOT_ASSIGNED"].includes(nextError.code)
      ) {
        try {
          sessionStorage.removeItem(storageKey(ownerUserId, outcomeId));
        } catch {
          // The owner-scoped cache is optional and never activation authority.
        }
        onLegacyFallback();
        return;
      }
      if (nextError instanceof ApiError) {
        const operationId = operationIdFromError(nextError);
        if (operationId && (!operation || replacingClarification)) {
          persist({ ...requestAdmission, operationId });
        }
      }
      if (nextError instanceof DOMException && nextError.name === "AbortError") {
        setError(
          "This device stopped waiting. If the operation was accepted, TED will reconnect and show its durable state.",
        );
      } else {
        setError(
          "TED could not finish this operation. The same request can be resumed without creating a duplicate document.",
        );
      }
    } finally {
      if (
        ownerDispatchIsCurrent(requestContext) &&
        latestIdentityRef.current === expectedComponentIdentity
      ) {
        controllerRef.current = null;
        setBusy(false);
      }
    }
  }, [
    admission,
    applyOperation,
    componentIdentity,
    onLegacyFallback,
    operation,
    ownerUserId,
    outcomeId,
    persist,
    template,
    templateId,
    title,
  ]);

  const cancelDurableOperation = useCallback(async () => {
    if (!operation) return;
    const expectedComponentIdentity = componentIdentity;
    const requestContext = captureOwnerDispatch(ownerUserId);
    ensureApiConfigured();
    setCancelling(true);
    setError(null);
    try {
      const cancelled = await cancelCapturedDocumentOperation(
        {
          operation_id: operation.operation_id,
          expected_operation_revision: operation.operation_revision,
          cancellation_code: "owner_cancelled",
        },
        requestContext,
      );
      requestContext.assertCurrent();
      if (latestIdentityRef.current !== expectedComponentIdentity) return;
      applyOperation({
        ...operation,
        ...cancelled,
        message:
          cancelled.status === "cancelled"
            ? "Cancellation is complete. Any provider work already performed remains recorded, and unused document allowance is released."
            : "Cancellation is recorded and pending. TED is reconciling any in-flight provider attempt before final cancellation; a late result will not replace your document.",
      });
    } catch (nextError) {
      if (!ownerDispatchIsCurrent(requestContext)) return;
      if (latestIdentityRef.current !== expectedComponentIdentity) return;
      if (nextError instanceof ApiError && nextError.status === 409) {
        try {
          await reconnect();
        } catch {
          // Keep the last durable state visible when the status refresh also fails.
        }
        setError(
          "The operation changed before cancellation was recorded. Its latest durable state is shown; try again only if it is still active.",
        );
      } else {
        setError(
          "TED could not record cancellation yet. The operation remains active until its durable status says cancelled.",
        );
      }
    } finally {
      if (
        ownerDispatchIsCurrent(requestContext) &&
        latestIdentityRef.current === expectedComponentIdentity
      ) {
        setCancelling(false);
      }
    }
  }, [applyOperation, componentIdentity, operation, ownerUserId, reconnect]);

  const beginNewOperation = () => {
    const next = {
      ...freshAdmission(ownerUserId, outcomeId),
      inputValues: admission.inputValues,
    };
    persist(next);
    operationEpochRef.current += 1;
    activeOperationIdRef.current = null;
    operationRef.current = null;
    setOperation(null);
    setError(null);
  };

  if (operation && operation.status !== "awaiting_clarification") {
    const terminal = ["cancelled", "terminal_failure"].includes(operation.status);
    const cancellationPending = operation.cancellation_requested === true && !terminal;
    const resumable = operationCanResume(operation);
    const cancellable = [
      "accepted",
      "awaiting_capacity",
      "generating",
      "validating",
      "persisting",
      "retryable_failure",
      "awaiting_clarification",
    ].includes(operation.status);
    return (
      <main className={styles.shell} aria-labelledby="captured-operation-title">
        <section className={styles.card}>
          <p className={styles.eyebrow}>Durable document operation</p>
          <h1 id="captured-operation-title">{statusLabel(operation.status)}</h1>
          <p className={styles.explanation} role="status">
            {operation.message ??
              "The operation is recorded in Supabase. Reloading this page will reconnect to the same document and revision."}
          </p>
          {operation.safe_next_action ? (
            <p className={styles.note}>
              <strong>Safe next action:</strong> {operation.safe_next_action}
            </p>
          ) : null}
          {operation.status === "awaiting_capacity" ? (
            <p className={styles.note} role="status">
              {operation.resume_available
                ? "The retry window is open. Resume this same operation to ask TED to check capacity again; availability is confirmed only after admission succeeds."
                : operation.retry_after_seconds && operation.retry_after_seconds > 0
                  ? `TED will check for safe capacity again in about ${operation.retry_after_seconds} seconds.`
                  : "TED is waiting for the recorded capacity retry time. This document operation remains safely saved."}
            </p>
          ) : null}
          {operation.lease_expires_at && !resumable && !terminal ? (
            <p className={styles.note}>
              TED will keep reconnecting. If its worker stops, this exact operation becomes safely
              resumable after the active lease ends.
            </p>
          ) : null}
          <dl className={styles.truth}>
            <div>
              <dt>Operation</dt>
              <dd>{operation.operation_id}</dd>
            </div>
            <div>
              <dt>Revision</dt>
              <dd>{operation.operation_revision}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{operation.status.replaceAll("_", " ")}</dd>
            </div>
          </dl>
          {operation.questions?.length ? (
            <ul className={styles.questions}>
              {operation.questions.map((question) => (
                <li key={question.input_key}>{question.question}</li>
              ))}
            </ul>
          ) : null}
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            {resumable && (
              <button
                type="button"
                className={styles.primary}
                onClick={() => void run()}
                disabled={busy}
              >
                {busy ? "Resuming…" : "Resume this operation"}
              </button>
            )}
            {cancellable && !cancellationPending && (
              <button
                type="button"
                className={styles.secondary}
                onClick={() => void cancelDurableOperation()}
                disabled={busy || cancelling}
              >
                {cancelling ? "Recording cancellation…" : "Cancel this operation"}
              </button>
            )}
            <button
              type="button"
              className={styles.secondary}
              onClick={() => void reconnectNow()}
              disabled={busy || cancelling || reconnecting}
            >
              {reconnecting ? "Checking durable status…" : "Check latest status"}
            </button>
            {terminal && (!initialOperation || operation.status === "cancelled") && (
              <button type="button" className={styles.primary} onClick={beginNewOperation}>
                Start a new operation
              </button>
            )}
            {terminal && initialOperation && onOpenPersistedWorkspace && (
              <button type="button" className={styles.primary} onClick={onOpenPersistedWorkspace}>
                Open saved document
              </button>
            )}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.shell} aria-labelledby="captured-intake-title">
      <form
        className={styles.card}
        onSubmit={(event) => {
          event.preventDefault();
          if (page < pageCount - 1) setPage((current) => current + 1);
          else void run();
        }}
      >
        <p className={styles.eyebrow}>
          Confirmed facts · {page + 1} of {pageCount}
        </p>
        <h1 id="captured-intake-title">What TED needs for {template.displayName}</h1>
        <p className={styles.explanation}>
          These facts are bound to one immutable source snapshot before generation. TED will not
          invent a missing required detail.
        </p>

        <div className={styles.fields}>
          {pageInputs.map((input) => {
            const value = admission.inputValues[input.key] ?? "";
            const required = input.required;
            const textarea = input.inputType === "longText" || input.inputType === "address";
            return (
              <label key={input.key} className={styles.field}>
                <span>
                  {input.label}
                  {required ? " *" : " (optional)"}
                </span>
                {textarea ? (
                  <textarea
                    value={value}
                    required={required}
                    rows={4}
                    maxLength={12_000}
                    onChange={(event) =>
                      persist({
                        ...admission,
                        inputValues: {
                          ...admission.inputValues,
                          [input.key]: event.target.value,
                        },
                      })
                    }
                  />
                ) : (
                  <input
                    type={input.inputType === "date" ? "date" : "text"}
                    value={value}
                    required={required}
                    maxLength={2_000}
                    onChange={(event) =>
                      persist({
                        ...admission,
                        inputValues: {
                          ...admission.inputValues,
                          [input.key]: event.target.value,
                        },
                      })
                    }
                  />
                )}
                <small>{input.clarification.whyNeeded}</small>
              </label>
            );
          })}
        </div>

        {operation?.questions?.length ? (
          <ul className={styles.questions}>
            {operation.questions.map((question) => (
              <li key={question.input_key}>{question.question}</li>
            ))}
          </ul>
        ) : null}
        {error && <p className={styles.error}>{error}</p>}
        {firstMissingRequired >= 0 && page === pageCount - 1 ? (
          <p className={styles.note}>Required answers are still missing on an earlier step.</p>
        ) : null}

        <div className={styles.actions}>
          {page > 0 && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => setPage((current) => current - 1)}
            >
              Back
            </button>
          )}
          <button type="submit" className={styles.primary} disabled={busy}>
            {busy
              ? "Recording and generating…"
              : page < pageCount - 1
                ? "Continue"
                : "Generate from confirmed facts"}
          </button>
          {busy && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => controllerRef.current?.abort()}
            >
              Stop waiting on this device
            </button>
          )}
          {operation?.status === "awaiting_clarification" && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => void cancelDurableOperation()}
              disabled={busy || cancelling}
            >
              {cancelling ? "Recording cancellation…" : "Cancel this operation"}
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
