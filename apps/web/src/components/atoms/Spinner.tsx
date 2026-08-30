import styles from "./Spinner.module.css";

export interface SpinnerProps {
  /** Accessible label — ALWAYS required. A spinner must never be silent. */
  label: string;
  size?: "sm" | "md" | "lg";
  /** When true, the label is shown visually beside the spinner, not just to AT. */
  showLabel?: boolean;
}

/**
 * Spinner — loading indicator. Per the design system, a spinner is NEVER the
 * only feedback: it always carries a text label (visually or for screen readers).
 */
export function Spinner({ label, size = "md", showLabel = false }: SpinnerProps) {
  return (
    <span className={styles.wrapper} role="status">
      <span className={`${styles.spinner} ${styles[size]}`} aria-hidden="true" />
      {showLabel ? (
        <span className={styles.label}>{label}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </span>
  );
}
