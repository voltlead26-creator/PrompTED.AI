"use client";

import { useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import styles from "./TedChangeReview.module.css";

export interface TedChangeReviewProps {
  suggested: string;
  /** Plain-language list of changes. The original stays unchanged in the workspace. */
  changes: string[];
  explanation: string;
  onApply: () => void | Promise<void>;
  onRetry: () => void | Promise<void>;
  onDiscard: () => void | Promise<void>;
  busy?: boolean;
  notice?: string | null;
  /** A stable caller control, since the tEdit composer closes on completion. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function TedChangeReview({
  suggested,
  changes,
  explanation,
  onApply,
  onRetry,
  onDiscard,
  busy = false,
  notice,
  returnFocusRef,
}: TedChangeReviewProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const actionRef = useRef<symbol | null>(null);
  const mountedRef = useRef(false);
  const [activeAction, setActiveAction] = useState<"apply" | "retry" | "discard" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const unavailable = busy || activeAction !== null;

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const returnTarget = returnFocusRef?.current ?? previousFocus;
    function keepTabInReview(event: KeyboardEvent) {
      if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey || !dialog.open) return;
      // Only this component's scroll region and enabled action buttons are
      // tab stops. Keep native navigation between them; wrap at either edge.
      const stops = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'));
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) {
        event.preventDefault();
        headingRef.current?.focus();
        return;
      }
      const current = document.activeElement;
      const atStart = current === first;
      const atEnd = current === last;
      const outsideStops = !stops.some((stop) => stop === current);
      if (outsideStops || (event.shiftKey ? atStart : atEnd)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }
    mountedRef.current = true;
    dialog.showModal();
    dialog.addEventListener("keydown", keepTabInReview);
    headingRef.current?.focus({ preventScroll: true });
    return () => {
      mountedRef.current = false;
      actionRef.current = null;
      dialog.removeEventListener("keydown", keepTabInReview);
      dialog.close();
      if (returnTarget?.isConnected && !returnTarget.matches(":disabled") && !returnTarget.closest("[inert]")) {
        returnTarget.focus({ preventScroll: true });
      }
    };
  }, [returnFocusRef]);

  async function runAction(action: "apply" | "retry" | "discard") {
    if (busy || actionRef.current) return;
    const token = Symbol(action);
    actionRef.current = token;
    setActiveAction(action);
    setActionError(null);
    try {
      await ({ apply: onApply, retry: onRetry, discard: onDiscard })[action]();
    } catch {
      if (mountedRef.current && actionRef.current === token) {
        setActionError("TED could not confirm that action. Your suggestion is still available; try again.");
      }
    } finally {
      if (mountedRef.current && actionRef.current === token) {
        actionRef.current = null;
        setActiveAction(null);
        if (action === "retry") headingRef.current?.focus({ preventScroll: true });
      }
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.review}
      aria-labelledby={titleId}
      aria-modal="true"
      aria-busy={unavailable}
      onCancel={(event) => {
        // The caller must confirm durable discard before removing this dialog.
        event.preventDefault();
        void runAction("discard");
      }}
    >
      <header>
        <p className={styles.eyebrow}>Suggested change</p>
        <h3 ref={headingRef} id={titleId} tabIndex={-1}>Check the change before applying it</h3>
        <p>{explanation}</p>
        {(notice || actionError) && <p role="alert">{notice || actionError}</p>}
      </header>

      {/* The rule documents this per-element exception for keyboard-scrollable containers. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- This labelled overflow region needs keyboard scrolling in browsers without automatic scroll-container focus. */}
      <div className={styles.columns} role="region" aria-label="TED suggested changes" tabIndex={0}>
        <div className={styles.column}>
          <strong>What changed</strong>
          {changes.length > 0 ? (
            <ul className={styles.changesList}>
              {changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          ) : (
            <p className={styles.noChanges}>Review the suggested wording before applying it.</p>
          )}
        </div>
        <div className={styles.column}>
          <strong>Suggested wording</strong>
          <div className={styles.text}>{suggested}</div>
        </div>
      </div>

      <footer className={styles.actions}>
        <button type="button" className={styles.reject} onClick={() => void runAction("discard")} disabled={unavailable}>
          {activeAction === "discard" ? "Discarding…" : "Discard"}
        </button>
        <button type="button" className={styles.reject} onClick={() => void runAction("retry")} disabled={unavailable}>
          {activeAction === "retry" ? "Trying again…" : "Try again"}
        </button>
        <button type="button" className={styles.accept} onClick={() => void runAction("apply")} disabled={unavailable}>
          {activeAction === "apply" || (busy && activeAction === null) ? "Applying…" : "Apply"}
        </button>
      </footer>
    </dialog>
  );
}
