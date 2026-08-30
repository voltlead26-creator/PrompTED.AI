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
import styles from "./CapturedAdmission.module.css";

const PAGE_SIZE = 3;

interface StoredAdmission {
  documentId: string;
  generationRequestId: string;
  inputRevision: number;
  inputValues: Record<string, string>;
  operationId?: string;
}

interface CapturedAdmissionProps {
  outcomeId: string;
  templateId: FirstCapturedTemplateId;
  title: string;
  onLegacyFallback: () => void;
}

function storageKey(outcomeId: string): string {
  return `prompted:captured-admission:${outcomeId}`;
}

function freshAdmission(): StoredAdmission {
  return {
    documentId: crypto.randomUUID(),
    generationRequestId: crypto.randomUUID(),
    inputRevision: 1,
    inputValues: {},
  };
}

function readAdmission(outcomeId: string): StoredAdmission {
  try {
    const parsed = JSON.parse(
      sessionStorage.getItem(storageKey(outcomeId)) ?? "null",
    ) as Partial<StoredAdmission> | null;
    if (
      parsed &&
      typeof parsed.documentId === "string" &&
      typeof parsed.generationRequestId === "string" &&
      parsed.inputValues &&
      typeof parsed.inputValues === "object"
    ) {
      return {
        documentId: parsed.documentId,
        generationRequestId: parsed.generationRequestId,
        inputRevision: Number(parsed.inputRevision) || 1,
        inputValues: Object.fromEntries(
          Object.entries(parsed.inputValues).filter((entry): entry is [string, string] =>
            typeof entry[1] === "string"
          ),
        ),
        operationId:
          typeof parsed.operationId === "string" ? parsed.operationId : undefined,
      };
    }
  } catch {
    // A corrupt device-only draft is ignored; durable operation truth remains
    // in Supabase once admission has succeeded.
  }
  return freshAdmission();
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
  outcomeId,
  templateId,
  title,
  onLegacyFallback,
}: CapturedAdmissionProps) {
  const template = CAPTURED_DOCUMENT_LEDGER.templates[templateId];
  if (!template) {
    throw new Error("Captured template contract is unavailable.");
  }
  const inputs = useMemo(
    () => [...template.requiredInputs, ...template.optionalInputs],
    [template],
  );
  const [admission, setAdmission] = useState<StoredAdmission>(() =>
    readAdmission(outcomeId)
  );
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [operation, setOperation] =
    useState<CapturedDocumentOperationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const persist = useCallback(
    (next: StoredAdmission) => {
      setAdmission(next);
      sessionStorage.setItem(storageKey(outcomeId), JSON.stringify(next));
    },
    [outcomeId],
  );

  const showReadyWorkspace = useCallback(() => {
    sessionStorage.removeItem(storageKey(outcomeId));
    window.location.reload();
  }, [outcomeId]);

  const applyOperation = useCallback(
    (next: CapturedDocumentOperationStatus) => {
      setOperation(next);
      if (next.operation_id && admission.operationId !== next.operation_id) {
        persist({ ...admission, operationId: next.operation_id });
      }
      if (next.status === "ready_for_review") showReadyWorkspace();
    },
    [admission, persist, showReadyWorkspace],
  );

  useEffect(() => {
    if (!admission.operationId) return;
    ensureApiConfigured();
    const controller = new AbortController();
    let stopped = false;

    const reconnect = async () => {
      try {
        const next = await getCapturedDocumentOperation(
          admission.operationId!,
          controller.signal,
        );
        if (stopped) return;
        applyOperation(next);
        if (
          ![
            "ready_for_review",
            "retryable_failure",
            "terminal_failure",
            "cancelled",
            "awaiting_clarification",
          ].includes(next.status)
        ) {
          window.setTimeout(() => {
            if (!stopped) void reconnect();
          }, 2_000);
        }
      } catch (nextError) {
        if (!stopped && !(nextError instanceof DOMException)) {
          setError("TED could not reconnect yet. Your accepted operation is still recorded.");
        }
      }
    };

    void reconnect();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [admission.operationId, applyOperation]);

  const firstMissingRequired = template.requiredInputs.findIndex(
    (input) => !admission.inputValues[input.key]?.trim(),
  );
  const pageCount = Math.max(1, Math.ceil(inputs.length / PAGE_SIZE));
  const pageInputs = inputs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const run = useCallback(async () => {
    const missingIndex = template.requiredInputs.findIndex(
      (input) => !admission.inputValues[input.key]?.trim(),
    );
    if (missingIndex >= 0) {
      setPage(Math.floor(missingIndex / PAGE_SIZE));
      setError("Add each required fact before TED starts. Nothing has been generated yet.");
      return;
    }

    ensureApiConfigured();
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const request = {
        outcome_id: outcomeId,
        document_id: admission.documentId,
        title,
        template_id: templateId,
        generation_request_id: admission.generationRequestId,
        input_revision: admission.inputRevision,
        input_values: admission.inputValues,
        locale: "en-AU",
        jurisdiction: "AU",
      };
      const next = operation?.status === "retryable_failure"
        ? await resumeCapturedDocumentOperation(
          {
            ...request,
            action: "resume",
            operation_id: operation.operation_id,
          },
          controller.signal,
        )
        : await startCapturedDocumentOperation(request, controller.signal);
      applyOperation(next);
      if (next.status === "awaiting_clarification") {
        setError(
          "The server still found a blocking fact. Review the highlighted questions before resuming.",
        );
      }
    } catch (nextError) {
      if (nextError instanceof ApiError && nextError.code === "CAPTURED_ACTIVATION_DISABLED") {
        sessionStorage.removeItem(storageKey(outcomeId));
        onLegacyFallback();
        return;
      }
      if (nextError instanceof ApiError) {
        const operationId = operationIdFromError(nextError);
        if (operationId) persist({ ...admission, operationId });
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
      controllerRef.current = null;
      setBusy(false);
    }
  }, [admission, applyOperation, onLegacyFallback, operation, outcomeId, persist, template, templateId, title]);

  const cancelDurableOperation = useCallback(async () => {
    if (!operation) return;
    ensureApiConfigured();
    setCancelling(true);
    setError(null);
    try {
      const cancelled = await cancelCapturedDocumentOperation({
        operation_id: operation.operation_id,
        expected_operation_revision: operation.operation_revision,
        cancellation_code: "owner_cancelled",
      });
      applyOperation({
        ...operation,
        ...cancelled,
        message: "Cancellation is recorded. No completed-document allowance was consumed.",
      });
    } catch (nextError) {
      if (nextError instanceof ApiError && nextError.status === 409) {
        try {
          const latest = await getCapturedDocumentOperation(operation.operation_id);
          applyOperation(latest);
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
      setCancelling(false);
    }
  }, [applyOperation, operation]);

  const beginNewOperation = () => {
    const next = { ...freshAdmission(), inputValues: admission.inputValues };
    persist(next);
    setOperation(null);
    setError(null);
  };

  if (operation && operation.status !== "awaiting_clarification") {
    const terminal = ["cancelled", "terminal_failure"].includes(operation.status);
    const cancellable = [
      "accepted",
      "awaiting_capacity",
      "generating",
      "validating",
      "persisting",
      "retryable_failure",
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
          <dl className={styles.truth}>
            <div><dt>Operation</dt><dd>{operation.operation_id}</dd></div>
            <div><dt>Revision</dt><dd>{operation.operation_revision}</dd></div>
            <div><dt>Status</dt><dd>{operation.status.replaceAll("_", " ")}</dd></div>
          </dl>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            {operation.status === "retryable_failure" && (
              <button type="button" className={styles.primary} onClick={() => void run()} disabled={busy}>
                {busy ? "Resuming…" : "Resume this operation"}
              </button>
            )}
            {cancellable && (
              <button
                type="button"
                className={styles.secondary}
                onClick={() => void cancelDurableOperation()}
                disabled={busy || cancelling}
              >
                {cancelling ? "Recording cancellation…" : "Cancel this operation"}
              </button>
            )}
            {terminal && (
              <button type="button" className={styles.primary} onClick={beginNewOperation}>
                Start a new operation
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
        <p className={styles.eyebrow}>Confirmed facts · {page + 1} of {pageCount}</p>
        <h1 id="captured-intake-title">What TED needs for {template.displayName}</h1>
        <p className={styles.explanation}>
          These facts are bound to one immutable source snapshot before generation. TED will not invent a missing required detail.
        </p>

        <div className={styles.fields}>
          {pageInputs.map((input) => {
            const value = admission.inputValues[input.key] ?? "";
            const required = input.required;
            const textarea = input.inputType === "longText" || input.inputType === "address";
            return (
              <label key={input.key} className={styles.field}>
                <span>{input.label}{required ? " *" : " (optional)"}</span>
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
            <button type="button" className={styles.secondary} onClick={() => setPage((current) => current - 1)}>
              Back
            </button>
          )}
          <button type="submit" className={styles.primary} disabled={busy}>
            {busy ? "Recording and generating…" : page < pageCount - 1 ? "Continue" : "Generate from confirmed facts"}
          </button>
          {busy && (
            <button type="button" className={styles.secondary} onClick={() => controllerRef.current?.abort()}>
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
