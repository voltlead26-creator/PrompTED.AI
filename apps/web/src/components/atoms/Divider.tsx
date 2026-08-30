import styles from "./Divider.module.css";

export interface DividerProps {
  /** Optional centred label, e.g. "Examples" or "Jump back in". */
  label?: string;
  orientation?: "horizontal" | "vertical";
}

/**
 * Divider — section separator. With a label it renders as a labelled rule;
 * without, a plain decorative separator.
 */
export function Divider({ label, orientation = "horizontal" }: DividerProps) {
  if (orientation === "vertical") {
    return <span className={styles.vertical} aria-hidden="true" />;
  }
  if (label) {
    return (
      <div className={styles.labelled} role="separator" aria-label={label}>
        <span className={styles.line} aria-hidden="true" />
        <span className={styles.text}>{label}</span>
        <span className={styles.line} aria-hidden="true" />
      </div>
    );
  }
  return <hr className={styles.rule} />;
}
