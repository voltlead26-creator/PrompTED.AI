"use client";

import { useState } from "react";
import type { MissingInfoQuestion } from "@/hooks/useWorkspace";
import styles from "./MissingInfoPanel.module.css";

interface MissingInfoPanelProps {
  questions: MissingInfoQuestion[];
  busy: boolean;
  onAnswer: (question: MissingInfoQuestion, answer: string) => void;
  onDismiss: (question: MissingInfoQuestion) => void;
}

/**
 * TED's follow-up questions: the vital facts the last generation could not
 * find in the user's material. Answering weaves the fact into the section;
 * dismissing acknowledges the gap and leaves the wording as-is.
 */
export function MissingInfoPanel({ questions, busy, onAnswer, onDismiss }: MissingInfoPanelProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (questions.length === 0) return null;

  const draftKey = (q: MissingInfoQuestion) => `${q.sectionKey}::${q.question}`;

  return (
    <aside className={styles.panel} aria-label="TED needs a few details">
      <h2 className={styles.heading}>
        TED needs {questions.length === 1 ? "one detail" : "a few details"} to finish this properly
      </h2>
      <p className={styles.sub}>
        The document is written around these for now. Answer what you can — each answer updates its section.
      </p>
      <ul className={styles.list}>
        {questions.map((q) => {
          const key = draftKey(q);
          const value = drafts[key] ?? "";
          return (
            <li key={key} className={styles.item}>
              <div className={styles.meta}>
                <span className={styles.sectionName}>{q.sectionLabel}</span>
                <button
                  type="button"
                  className={styles.dismiss}
                  onClick={() => onDismiss(q)}
                  disabled={busy}
                >
                  Skip
                </button>
              </div>
              <p className={styles.question}>{q.question}</p>
              <div className={styles.answerRow}>
                <input
                  className={styles.input}
                  type="text"
                  value={value}
                  placeholder="Type the detail here"
                  onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && value.trim() && !busy) onAnswer(q, value);
                  }}
                  disabled={busy}
                />
                <button
                  type="button"
                  className={styles.submit}
                  onClick={() => onAnswer(q, value)}
                  disabled={busy || !value.trim()}
                >
                  Add it
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
