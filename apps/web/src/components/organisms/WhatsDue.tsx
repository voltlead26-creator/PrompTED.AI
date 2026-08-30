"use client";

import Link from "next/link";
import { Icon } from "@/components/atoms/Icon";
import type { ChecklistItem } from "@prompted/shared";
import styles from "./WhatsDue.module.css";

interface WhatsDueProps {
  items: ChecklistItem[];
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + "T00:00:00");
  return Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function urgencyClass(days: number): string {
  if (days <= 0) return styles.overdue ?? "";
  if (days <= 3) return styles.urgent ?? "";
  return styles.upcoming ?? "";
}

function dueLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days}d`;
}

/**
 * WhatsDue — panel showing checklist items due within 14 days.
 * Only renders when there are items to show.
 */
export function WhatsDue({ items }: WhatsDueProps) {
  if (items.length === 0) return null;

  return (
    <section className={styles.panel} aria-label="What's due">
      <h2 className={styles.heading}>
        <Icon name="clock" size={16} aria-hidden="true" />
        What&apos;s due
      </h2>
      <ul className={styles.list}>
        {items.map((item) => {
          const days = item.due_date ? daysUntil(item.due_date) : 0;
          return (
            <li key={item.id} className={styles.item}>
              <Link
                href={`/outcomes/${item.outcome_id}?checklist=true`}
                className={styles.itemLink}
              >
                <span className={styles.itemText}>{item.text}</span>
                {item.due_date && (
                  <span
                    className={`${styles.dueChip} ${urgencyClass(days)}`}
                    aria-label={`Due ${dueLabel(days)}`}
                  >
                    {dueLabel(days)}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
