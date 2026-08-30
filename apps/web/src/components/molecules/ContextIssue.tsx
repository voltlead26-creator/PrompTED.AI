"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/atoms/Icon";
import styles from "./ContextIssue.module.css";

export interface ContextIssueProps {
  label?: string;
  title: string;
  message: string;
  actionLabel?: string;
  href?: string;
  onAction?: () => void;
  busy?: boolean;
}

export function ContextIssue({
  label = "Needs attention",
  title,
  message,
  actionLabel,
  href,
  onAction,
  busy = false,
}: ContextIssueProps) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOnOutsideClick);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeOnOutsideClick);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={`${label}: ${title}`}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="alert-circle" size={17} />
        <span>{label}</span>
      </button>

      {open && (
        <div id={popoverId} className={styles.popover} role="status">
          <strong>{title}</strong>
          <p>{message}</p>
          {actionLabel && href && (
            <Link className={styles.action} href={href} onClick={() => setOpen(false)}>
              {actionLabel}
            </Link>
          )}
          {actionLabel && onAction && (
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                onAction();
                setOpen(false);
              }}
              disabled={busy}
            >
              {busy ? "Working…" : actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
