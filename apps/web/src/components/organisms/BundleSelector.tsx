"use client";

import { useState } from "react";
import { Button } from "@/components/atoms/Button";
import { Icon } from "@/components/atoms/Icon";
import styles from "./BundleSelector.module.css";

export interface BundleItem {
  id: string;
  name: string;
  reason?: string;
}

interface BundleSelectorProps {
  title: string;
  items: BundleItem[];
  /** Proceed with the items the user kept (didn't skip). */
  onProceed: (selectedIds: string[]) => void;
  busy?: boolean;
}

/**
 * BundleSelector — when TED recommends a bundle, the user chooses which items
 * to generate. Each item defaults to "generate"; Skip removes it from the queue.
 */
export function BundleSelector({
  title,
  items,
  onProceed,
  busy = false,
}: BundleSelectorProps) {
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedIds = items.map((i) => i.id).filter((id) => !skipped.has(id));

  return (
    <section className={styles.card} aria-label={title}>
      <h2 className={styles.title}>{title}</h2>
      <ul className={styles.list}>
        {items.map((item) => {
          const isSkipped = skipped.has(item.id);
          return (
            <li
              key={item.id}
              className={`${styles.item} ${isSkipped ? styles.skipped : ""}`}
            >
              <div className={styles.itemInfo}>
                <span className={styles.itemName}>{item.name}</span>
                {item.reason && (
                  <span className={styles.itemReason}>{item.reason}</span>
                )}
              </div>
              <Button
                variant={isSkipped ? "ghost" : "text"}
                size="sm"
                onClick={() => toggle(item.id)}
                aria-pressed={isSkipped}
                leadingIcon={
                  <Icon name={isSkipped ? "plus" : "minus"} size={16} />
                }
              >
                {isSkipped ? "Add back" : "Skip"}
              </Button>
            </li>
          );
        })}
      </ul>
      <div className={styles.footer}>
        <p className={styles.count}>
          {selectedIds.length} of {items.length} selected
        </p>
        <Button
          variant="primary"
          size="lg"
          onClick={() => onProceed(selectedIds)}
          disabled={busy || selectedIds.length === 0}
        >
          Generate {selectedIds.length}{" "}
          {selectedIds.length === 1 ? "document" : "documents"}
        </Button>
      </div>
    </section>
  );
}
