import type { ReactNode } from "react";
import styles from "./Chip.module.css";

export interface ChipProps {
  children: ReactNode;
  /** When provided, the chip becomes a button. */
  onClick?: () => void;
  selected?: boolean;
  leadingIcon?: ReactNode;
  /** Accessible label if the visible text isn't descriptive enough. */
  ariaLabel?: string;
}

/**
 * Chip — example prompts, domain tags, filters.
 * Interactive when `onClick` is given (rendered as a real <button>),
 * otherwise a static label.
 */
export function Chip({
  children,
  onClick,
  selected = false,
  leadingIcon,
  ariaLabel,
}: ChipProps) {
  const classes = [styles.chip, selected ? styles.selected : ""]
    .filter(Boolean)
    .join(" ");

  if (onClick) {
    return (
      <button
        type="button"
        className={classes}
        onClick={onClick}
        aria-pressed={selected}
        aria-label={ariaLabel}
      >
        {leadingIcon}
        {children}
      </button>
    );
  }

  return (
    <span className={classes} aria-label={ariaLabel}>
      {leadingIcon}
      {children}
    </span>
  );
}
