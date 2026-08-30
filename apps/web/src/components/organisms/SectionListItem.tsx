"use client";

import type { DragEvent } from "react";
import type { Section } from "@prompted/shared";
import { Badge, type BadgeStatus } from "@/components/atoms/Badge";
import { Button } from "@/components/atoms/Button";
import { Icon } from "@/components/atoms/Icon";
import styles from "./SectionListItem.module.css";

interface SectionListItemProps {
  section: Section;
  index: number;
  total: number;
  active: boolean;
  onSelect: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onApprove: (id: string) => void;
  onUnapprove: (id: string) => void;
  /** Drag-and-drop: this item was dropped at its index. */
  onDropAt: (id: string, toIndex: number) => void;
}

/**
 * SectionListItem — a single section in the left pane.
 *
 * Shows the name + status badge and the row's actions: approve/un-approve and
 * reorder. Reordering offers BOTH drag-and-drop and keyboard Move up/down
 * buttons — the keyboard path is the AA-required equivalent to drag. Locked
 * sections disable reordering and approval until unlocked.
 */
export function SectionListItem({
  section,
  index,
  total,
  active,
  onSelect,
  onMoveUp,
  onMoveDown,
  onApprove,
  onUnapprove,
  onDropAt,
}: SectionListItemProps) {
  const locked = section.status === "locked";
  const approved = section.status === "approved";

  function handleDragStart(e: DragEvent<HTMLLIElement>) {
    if (locked) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData("text/plain", section.id);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: DragEvent<HTMLLIElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(e: DragEvent<HTMLLIElement>) {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData("text/plain");
    if (draggedId && draggedId !== section.id) onDropAt(draggedId, index);
  }

  return (
    <li
      className={`${styles.item} ${active ? styles.active : ""}`}
      draggable={!locked}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      aria-current={active ? "true" : undefined}
    >
      <button
        type="button"
        className={styles.select}
        onClick={() => onSelect(section.id)}
        aria-label={`Edit section: ${section.name}`}
      >
        <span className={styles.name}>{section.name}</span>
        <span className={styles.meta}>
          <Badge status={section.status as BadgeStatus} />
          {section.is_required ? null : (
            <span className={styles.optional}>Optional</span>
          )}
        </span>
      </button>

      <div className={styles.actions}>
        <div className={styles.reorder}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => onMoveUp(section.id)}
            disabled={index === 0 || locked}
            aria-label={`Move ${section.name} up`}
          >
            <Icon name="chevron-up" size={18} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => onMoveDown(section.id)}
            disabled={index === total - 1 || locked}
            aria-label={`Move ${section.name} down`}
          >
            <Icon name="chevron-down" size={18} />
          </button>
        </div>

        {approved ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onUnapprove(section.id)}
            leadingIcon={<Icon name="rotate" size={16} />}
          >
            Un-approve
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onApprove(section.id)}
            disabled={locked}
            leadingIcon={<Icon name="check" size={16} />}
          >
            Approve
          </Button>
        )}
      </div>
    </li>
  );
}
