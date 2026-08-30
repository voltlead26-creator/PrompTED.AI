"use client";

import styles from "./TedChangeReview.module.css";

export interface TedChangeReviewProps {
  suggested: string;
  /** Plain-language list of what TED changed. The original wording is shown
   * in place in the live content above/behind this card (scrolled into view
   * by the caller) rather than duplicated here. */
  changes: string[];
  explanation: string;
  onApply: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}

export function TedChangeReview({
  suggested,
  changes,
  explanation,
  onApply,
  onRetry,
  onDiscard,
}: TedChangeReviewProps) {
  return (
    <section className={styles.review} aria-labelledby="ted-change-review-title">
      <header>
        <p className={styles.eyebrow}>Suggested change</p>
        <h3 id="ted-change-review-title">Check the change before applying it</h3>
        <p>{explanation}</p>
      </header>

      <div className={styles.columns}>
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
        <button type="button" className={styles.reject} onClick={onDiscard}>
          Discard
        </button>
        <button type="button" className={styles.reject} onClick={onRetry}>
          Try again
        </button>
        <button type="button" className={styles.accept} onClick={onApply}>
          Apply
        </button>
      </footer>
    </section>
  );
}
