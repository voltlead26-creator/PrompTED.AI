"use client";

import Link from "next/link";
import { Icon } from "@/components/atoms/Icon";
import styles from "./FastLane.module.css";

export interface FastLaneItem {
  id: string;
  title: string;
  /** e.g. "Edited 2 days ago" */
  meta: string;
}

interface FastLaneProps {
  /** Recent + saved outcomes. When empty, the strip renders nothing. */
  items: FastLaneItem[];
}

/**
 * FastLane — the "Jump back in" strip.
 * Hidden entirely for first-time users (no items). Visible once the user
 * has at least one outcome.
 */
export function FastLane({ items }: FastLaneProps) {
  if (items.length === 0) return null;

  return (
    <section className={styles.wrap} aria-label="Jump back in">
      <div className={styles.header}>
        <h2 className={styles.heading}>Jump back in</h2>
        <Link href="/library" className={styles.seeAll}>
          See all
        </Link>
      </div>
      <div className={styles.row}>
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/outcomes/${item.id}`}
            className={styles.card}
          >
            <Icon name="file-text" size={20} />
            <span className={styles.cardTitle}>{item.title}</span>
            <span className={styles.cardMeta}>{item.meta}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
