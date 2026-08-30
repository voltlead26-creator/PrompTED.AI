"use client";

import { useCallback, useMemo } from "react";
import type { Section, SectionVersion } from "@prompted/shared";

type SetSections = (
  next: Section[] | ((prev: Section[]) => Section[]),
) => void;

export interface UseVersionHistory {
  /** Versions for a section, newest first. */
  versionsFor: (section: Section | null) => SectionVersion[];
  /**
   * Restore a prior version. The current content is snapshotted into history
   * first (never destructive), then replaced. Status drops to "edited".
   */
  restore: (sectionId: string, version: SectionVersion) => void;
}

/**
 * useVersionHistory — list + restore prior section versions.
 *
 * History is append-only and never cleared on approve (Build Plan Layer 9).
 * Restoring is itself a version-producing edit so it can be undone in turn.
 */
export function useVersionHistory(setSections: SetSections): UseVersionHistory {
  const versionsFor = useCallback((section: Section | null) => {
    if (!section) return [];
    return [...section.version_history].sort((a, b) =>
      b.saved_at.localeCompare(a.saved_at),
    );
  }, []);

  const restore = useCallback(
    (sectionId: string, version: SectionVersion) => {
      setSections((prev) =>
        prev.map((section) => {
          if (section.id !== sectionId) return section;
          const snapshot: SectionVersion = {
            content: section.content,
            saved_at: new Date().toISOString(),
            label: "Before restoring an earlier version",
            origin: "restore",
          };
          return {
            ...section,
            content: version.content,
            status: "edited",
            version_history: [...section.version_history, snapshot],
            updated_at: new Date().toISOString(),
          };
        }),
      );
    },
    [setSections],
  );

  return useMemo(() => ({ versionsFor, restore }), [versionsFor, restore]);
}
