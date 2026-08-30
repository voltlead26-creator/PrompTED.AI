"use client";

import styles from "./DraftingIndicator.module.css";

export interface DraftingIndicatorProps {
  active: boolean;
  label?: string;
}

/**
 * Shown while TED is generating (or regenerating) document sections.
 * Sections stream in below as they finish; this card gives the user a
 * clear "TED is working" signal so a quiet workspace never looks broken.
 */
export function DraftingIndicator({
  active,
  label = "TED is drafting your document",
}: DraftingIndicatorProps) {
  if (!active) return null;

  return (
    <section className={styles.card} role="status" aria-live="polite">
      <div className={styles.headRow}>
        <span className={styles.pen} aria-hidden="true">&#9998;</span>
        <p className={styles.label}>
          {label}
          <span className={styles.dots} aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </p>
      </div>
      <div className={styles.lines} aria-hidden="true">
        <span className={styles.line} style={{ width: "92%" }} />
        <span className={styles.line} style={{ width: "78%" }} />
        <span className={styles.line} style={{ width: "85%" }} />
      </div>
      <p className={styles.hint}>Sections appear below as TED finishes them — no need to refresh.</p>
    </section>
  );
}
