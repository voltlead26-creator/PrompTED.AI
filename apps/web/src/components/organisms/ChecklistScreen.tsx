"use client";

import { Icon } from "@/components/atoms/Icon";
import { ProgressBar } from "@/components/atoms/ProgressBar";
import { Spinner } from "@/components/atoms/Spinner";
import { useChecklist } from "@/hooks/useChecklist";
import type { ChecklistItem } from "@prompted/shared";
import styles from "./ChecklistScreen.module.css";

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + "T00:00:00");
  return Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

interface ChecklistItemRowProps {
  item: ChecklistItem;
  onToggle: () => void;
  disabled: boolean;
}

function ChecklistItemRow({ item, onToggle, disabled }: ChecklistItemRowProps) {
  const days = item.due_date ? daysUntil(item.due_date) : null;

  return (
    <li className={styles.item} data-done={item.done || undefined}>
      <button
        type="button"
        role="checkbox"
        aria-checked={item.done}
        className={styles.checkbox}
        onClick={onToggle}
        disabled={disabled}
        aria-label={item.done ? `Mark "${item.text}" as not done` : `Mark "${item.text}" as done`}
      >
        {item.done ? (
          <Icon name="check" size={14} aria-hidden="true" />
        ) : null}
      </button>

      <div className={styles.itemContent}>
        <span className={styles.itemText}>{item.text}</span>
        <div className={styles.itemMeta}>
          {item.due_date && days !== null && (
            <span
              className={styles.dueChip}
              data-overdue={days < 0 || undefined}
              data-urgent={days >= 0 && days <= 3 || undefined}
            >
              {days < 0
                ? `${Math.abs(days)}d overdue`
                : days === 0
                ? "Due today"
                : days === 1
                ? "Due tomorrow"
                : `${days}d`}
            </span>
          )}
        </div>
        {item.reason && (
          <p className={styles.itemReason}>{item.reason}</p>
        )}
      </div>
    </li>
  );
}

interface ChecklistScreenProps {
  outcomeId: string;
}

export function ChecklistScreen({ outcomeId }: ChecklistScreenProps) {
  const {
    items,
    loading,
    error,
    saveError,
    retry,
    toggleDone,
    isSavingItem,
    savingItemIds,
    done,
    total,
    progress,
  } =
    useChecklist(outcomeId);

  if (loading) {
    return (
      <div className={styles.loading}>
        <Spinner label="Loading checklist…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.empty} role="alert">
        <p>{error}</p>
        <button type="button" onClick={() => void retry()}>Try again</button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={styles.empty}>
        <p>No checklist items for this outcome.</p>
      </div>
    );
  }

  return (
    <section className={styles.screen} aria-label="Action checklist">
      <div className={styles.header}>
        <h2 className={styles.heading}>Action checklist</h2>
        <span className={styles.count} aria-label={`${done} of ${total} completed`}>
          {done} / {total}
        </span>
      </div>

      <ProgressBar
        value={progress}
        label={`${Math.round(progress * 100)}% complete`}
      />

      {saveError ? <p role="status" aria-live="polite">{saveError}</p> : null}
      {savingItemIds.length > 0 ? (
        <span className={styles.count} role="status" aria-live="polite">Saving change…</span>
      ) : null}

      <ul className={styles.list} aria-label="Checklist items">
        {items.map((item) => (
          <ChecklistItemRow
            key={item.id}
            item={item}
            onToggle={() => void toggleDone(item.id)}
            disabled={isSavingItem(item.id)}
          />
        ))}
      </ul>
    </section>
  );
}
