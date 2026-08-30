"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/atoms/Icon";
import type { MissingInfoQuestion } from "@/hooks/useWorkspace";
import styles from "./MissingInfoIssue.module.css";

interface MissingInfoIssueProps {
  question: MissingInfoQuestion;
  busy: boolean;
  onAnswer: (question: MissingInfoQuestion, answer: string) => void;
  onDismiss: (question: MissingInfoQuestion) => void;
  onNeutralReplacement?: (
    question: MissingInfoQuestion,
    option: MissingInfoQuestion["neutralReplacementOptions"][number],
  ) => void;
  autoOpen?: boolean;
}

export function MissingInfoIssue({
  question,
  busy,
  onAnswer,
  onDismiss,
  onNeutralReplacement,
  autoOpen = false,
}: MissingInfoIssueProps) {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen, question.placeholderId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={`${question.sectionLabel} needs one detail`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="help-circle" size={17} />
        <span>One detail needed</span>
      </button>

      {open && (
        <form
          id={id}
          className={styles.popover}
          onSubmit={(event) => {
            event.preventDefault();
            if (!answer.trim() || busy) return;
            onAnswer(question, answer.trim());
            setAnswer("");
            setOpen(false);
          }}
        >
          <strong>{question.sectionLabel}</strong>
          <label htmlFor={`${id}-answer`}>{question.question}</label>
          <textarea
            id={`${id}-answer`}
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            rows={3}
          />
          {question.neutralReplacementOptions.length > 0 && onNeutralReplacement && (
            <div className={styles.actions}>
              {question.neutralReplacementOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={styles.dismiss}
                  disabled={busy}
                  onClick={() => {
                    onNeutralReplacement(question, option);
                    setOpen(false);
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.dismiss}
              onClick={() => {
                onDismiss(question);
                setOpen(false);
              }}
            >
              Not needed
            </button>
            <button type="submit" className={styles.submit} disabled={!answer.trim() || busy}>
              {busy ? "Adding…" : "Add detail"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
