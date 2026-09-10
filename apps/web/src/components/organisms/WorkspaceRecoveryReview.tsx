"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { renderSectionHtml } from "@prompted/shared/export";
import { sanitiseSectionContent } from "@/lib/sanitise";
import type { WorkspaceRecoveryReview as Recovery } from "@/lib/workspace-recovery";
import styles from "./TedChangeReview.module.css";

interface Props {
  review: Recovery;
  onRestore: () => Promise<boolean>;
  onKeepSaved: () => boolean;
  onCancel: () => void;
}

/** Review a user's retained wording without treating it as a saved or approved revision. */
export function WorkspaceRecoveryReview({ review, onRestore, onKeepSaved, onCancel }: Props) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const reopenRef = useRef<HTMLButtonElement>(null);
  const actionRef = useRef(false);
  const mountedRef = useRef(false);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    mountedRef.current = true;
    if (open && dialog) {
      dialog.showModal();
      headingRef.current?.focus({ preventScroll: true });
    } else reopenRef.current?.focus({ preventScroll: true });
    return () => { mountedRef.current = false; dialog?.close(); };
  }, [open]);

  function later() {
    onCancel();
    setOpen(false);
  }

  async function restore() {
    if (actionRef.current) return;
    actionRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      if (!await onRestore() && mountedRef.current) {
        setNotice("The saved version could not be confirmed. Your browser copy is still here. Reopen the document or try restoring again.");
      }
    } catch {
      if (mountedRef.current) setNotice("The saved version could not be confirmed. Your browser copy is still here. Try again.");
    } finally {
      actionRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  return <>
    <button ref={reopenRef} type="button" onClick={() => setOpen(true)}>Review browser copy</button>
    {open && <dialog ref={dialogRef} className={styles.review} aria-labelledby={id}
      aria-modal="true" aria-busy={busy}
      onKeyDown={(event) => {
        if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return;
        const stops = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'));
        const first = stops[0]; const last = stops[stops.length - 1];
        if (first && last && (!stops.includes(document.activeElement as HTMLElement) ||
          document.activeElement === (event.shiftKey ? first : last))) {
          event.preventDefault(); (event.shiftKey ? last : first).focus();
        }
      }}
      onCancel={(event) => { event.preventDefault(); later(); }}>
      <header>
        <p className={styles.eyebrow}>Your browser copy</p>
        <h3 id={id} ref={headingRef} tabIndex={-1}>Review wording kept in this browser</h3>
        <p>{review.status === "unavailable"
          ? "This browser copy could not be read safely. It has been kept. Reopen the document to try again, or discard this copy and keep the saved version."
          : review.status === "ready"
          ? "This wording differs from the saved document. Restore it to the editor to save it, or keep the saved version and discard this browser copy."
          : "The saved document has changed, or this copy cannot be restored safely. You can read and copy your wording below. Keeping the saved version discards this browser copy."}</p>
        {notice && <p role="alert">{notice}</p>}
      </header>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The bounded review region must support keyboard scrolling. */}
      <div className={styles.columns} role="region" aria-label="Wording kept in this browser" tabIndex={0}>
        {review.sections.map(section => <section className={styles.column} key={section.sectionId}>
          <strong>{section.name}</strong>
          {review.status === "ready"
            ? <div className={styles.text} dangerouslySetInnerHTML={{ __html: sanitiseSectionContent(renderSectionHtml(section.content)) }} />
            : <div className={styles.text}>{section.content}</div>}
        </section>)}
      </div>
      <footer className={styles.actions}>
        <button type="button" className={styles.reject} onClick={later}>Review later</button>
        <button type="button" className={styles.reject} disabled={busy} onClick={() => {
          if (!onKeepSaved()) setNotice("The browser copy could not be discarded. It is still available; try again.");
        }}>Keep saved version</button>
        {review.status === "ready" && <button type="button" className={styles.accept} disabled={busy}
          onClick={() => void restore()}>{busy ? "Checking saved version…" : "Restore to editor"}</button>}
      </footer>
    </dialog>}
  </>;
}
