import { useId, useState } from "react";
import type { ReactNode } from "react";
import styles from "./Tooltip.module.css";

export interface TooltipProps {
  /** The element the tooltip describes. Must be focusable for keyboard users. */
  children: ReactNode;
  content: string;
  side?: "top" | "bottom";
}

/**
 * Tooltip — supplementary hint shown on hover AND focus (keyboard-accessible).
 * The trigger is linked to the tip via aria-describedby.
 */
export function Tooltip({ children, content, side = "top" }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <span
      className={styles.wrapper}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span aria-describedby={id}>{children}</span>
      <span
        id={id}
        role="tooltip"
        className={`${styles.tip} ${styles[side]} ${open ? styles.open : ""}`}
      >
        {content}
      </span>
    </span>
  );
}
