import styles from "./ProgressBar.module.css";

export interface ProgressBarProps {
  value: number;
  max?: number;
  /** Accessible label, e.g. "3 of 6 sections approved". */
  label: string;
  /** Show the label text above the bar (otherwise sr-only). */
  showLabel?: boolean;
}

/**
 * ProgressBar — bundle / approval progress. Uses a native progress semantics
 * (role=progressbar with aria-valuenow/min/max) and a always-present label.
 */
export function ProgressBar({
  value,
  max = 100,
  label,
  showLabel = true,
}: ProgressBarProps) {
  const clamped = Math.min(Math.max(value, 0), max);
  const pct = max > 0 ? Math.round((clamped / max) * 100) : 0;

  return (
    <div className={styles.wrapper}>
      {showLabel ? (
        <span className={styles.label}>{label}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
      <div
        className={styles.track}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
      >
        <div className={styles.fill} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
