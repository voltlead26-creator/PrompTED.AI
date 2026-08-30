import type { ReactNode } from "react";
import { Icon } from "./Icon";
import styles from "./Badge.module.css";

export type BadgeStatus =
  | "draft"
  | "edited"
  | "approved"
  | "locked"
  | "done"
  | "in_progress";

const STATUS_META: Record<
  BadgeStatus,
  { label: string; icon: string; className: string }
> = {
  draft: { label: "Draft", icon: "pencil", className: "draft" },
  edited: { label: "Edited", icon: "edit", className: "edited" },
  approved: { label: "Approved", icon: "check", className: "approved" },
  locked: { label: "Locked", icon: "lock", className: "locked" },
  done: { label: "Done", icon: "circle-check", className: "approved" },
  in_progress: { label: "In progress", icon: "progress", className: "edited" },
};

export interface BadgeProps {
  status: BadgeStatus;
  /** Override the default label text for the status. */
  children?: ReactNode;
}

/**
 * Badge — status chip. Never colour alone: always colour + icon + text,
 * so the status is distinguishable without colour perception.
 */
export function Badge({ status, children }: BadgeProps) {
  const meta = STATUS_META[status];
  return (
    <span className={`${styles.badge} ${styles[meta.className]}`}>
      <Icon name={meta.icon} size={14} />
      <span>{children ?? meta.label}</span>
    </span>
  );
}
