"use client";

import { useId } from "react";
import styles from "./TCheck.module.css";

interface TCheckProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  statusText?: string;
  description?: string;
  name?: string;
  compact?: boolean;
}

export function TCheck({
  label,
  checked,
  onChange,
  disabled = false,
  statusText,
  description,
  name,
  compact = false,
}: TCheckProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionIds = [
    statusText ? `${id}-status` : null,
    description ? `${id}-description` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <label
      className={`${styles.row}${compact ? ` ${styles.compact}` : ""}${disabled ? ` ${styles.disabled}` : ""}`}
    >
      <input
        className={styles.native}
        type="checkbox"
        name={name}
        checked={checked}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={descriptionIds || undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles.indicator} aria-hidden="true">
        <svg className={styles.glyph} viewBox="0 0 20 20" focusable="false">
          <path d="M3.8 10.2 8 14.1 16.2 5.8M10.5 5.8h6" />
        </svg>
      </span>
      <span className={styles.copy}>
        <span className={styles.labelLine}>
          <span id={labelId} className={styles.label}>
            {label}
          </span>
          {statusText ? (
            <span id={`${id}-status`} className={styles.status}>
              {statusText}
            </span>
          ) : null}
        </span>
        {description ? (
          <span id={`${id}-description`} className={compact ? "sr-only" : styles.description}>
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}
