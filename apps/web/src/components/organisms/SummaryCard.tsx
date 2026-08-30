"use client";

import { useState } from "react";
import { Button } from "@/components/atoms/Button";
import { Textarea } from "@/components/atoms/Input";
import { Icon } from "@/components/atoms/Icon";
import styles from "./SummaryCard.module.css";

interface SummaryCardProps {
  /** TED's 1–2 sentence understanding of the situation. */
  understood: string;
  /** Persist an edited understanding (Adjust / Add detail). */
  onUpdate?: (next: string) => void;
}

/**
 * SummaryCard — "What TED understood".
 * Shows TED's interpretation before any draft content. The user can adjust
 * the understanding inline or add more detail; both reuse the same editor.
 */
export function SummaryCard({ understood, onUpdate }: SummaryCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(understood);

  function save() {
    onUpdate?.(draft.trim());
    setEditing(false);
  }

  return (
    <section className={styles.card} aria-label="What TED understood">
      <div className={styles.header}>
        <Icon name="bulb" size={18} />
        <h2 className={styles.title}>What TED understood</h2>
      </div>

      {editing ? (
        <div className={styles.editor}>
          <Textarea
            label="Adjust what TED understood"
            multiline
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
          />
          <div className={styles.editorActions}>
            <Button variant="text" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={save}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className={styles.understood}>{understood}</p>
          {onUpdate && (
            <div className={styles.actions}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft(understood);
                  setEditing(true);
                }}
                leadingIcon={<Icon name="edit" size={16} />}
              >
                Adjust
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
