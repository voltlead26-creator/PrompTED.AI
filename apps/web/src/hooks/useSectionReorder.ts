"use client";

import { useCallback, useMemo } from "react";
import { moveSectionUp, moveSectionDown, moveSectionTo } from "@prompted/shared/workspace-sections";
import type { Section } from "@prompted/shared/browser";

type SetSections = (next: Section[] | ((prev: Section[]) => Section[])) => void;

export interface UseSectionReorder {
  /** Keyboard/ARIA path: move one step toward the start. */
  moveUp: (id: string) => void;
  /** Keyboard/ARIA path: move one step toward the end. */
  moveDown: (id: string) => void;
  /** Drag path: drop `id` at absolute position `toIndex`. */
  dropAt: (id: string, toIndex: number) => void;
}

/**
 * useSectionReorder — drag-and-drop AND keyboard reordering (Delta 2).
 *
 * Both paths funnel through the same pure helpers, which reindex `order_index`
 * only (never content) and refuse to move locked sections. The keyboard path
 * (moveUp/moveDown) is the AA-required equivalent to drag — drag is never the
 * only way to reorder.
 */
export function useSectionReorder(setSections: SetSections): UseSectionReorder {
  const moveUp = useCallback(
    (id: string) => setSections((prev) => moveSectionUp(prev, id)),
    [setSections],
  );
  const moveDown = useCallback(
    (id: string) => setSections((prev) => moveSectionDown(prev, id)),
    [setSections],
  );
  const dropAt = useCallback(
    (id: string, toIndex: number) => setSections((prev) => moveSectionTo(prev, id, toIndex)),
    [setSections],
  );

  return useMemo(() => ({ moveUp, moveDown, dropAt }), [moveUp, moveDown, dropAt]);
}
