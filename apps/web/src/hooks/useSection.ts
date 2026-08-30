"use client";

import { useCallback, useMemo } from "react";
import {
  applyContentEdit,
  approveSection,
  unapproveSection,
  toggleLock as toggleLockHelper,
} from "@prompted/shared/workspace-sections";
import type { Section, SectionVersion } from "@prompted/shared/browser";

type SetSections = (next: Section[] | ((prev: Section[]) => Section[])) => void;

export interface UseSection {
  editContent: (id: string, content: string) => void;
  approve: (id: string) => void;
  unapprove: (id: string) => void;
  toggleLock: (id: string) => void;
}

/**
 * useSection — content + status mutations, applied optimistically through the
 * pure helpers in @prompted/shared. Every user edit snapshots the prior text
 * with a visible provenance label so history is understandable, not opaque.
 */
export function useSection(setSections: SetSections): UseSection {
  const mutate = useCallback(
    (id: string, fn: (section: Section) => Section) => {
      setSections((previous) =>
        previous.map((section) => (section.id === id ? fn(section) : section)),
      );
    },
    [setSections],
  );

  const editContent = useCallback(
    (id: string, content: string) => {
      setSections((previous) =>
        previous.map((section) => {
          if (section.id !== id || section.content === content) return section;
          const snapshot: SectionVersion = {
            content: section.content,
            saved_at: new Date().toISOString(),
            label: "Before your edit",
            origin: "user_edit",
          };
          return {
            ...applyContentEdit(section, content),
            version_history: [...section.version_history, snapshot],
          };
        }),
      );
    },
    [setSections],
  );

  const approve = useCallback((id: string) => mutate(id, approveSection), [mutate]);
  const unapprove = useCallback((id: string) => mutate(id, unapproveSection), [mutate]);
  const toggleLock = useCallback((id: string) => mutate(id, toggleLockHelper), [mutate]);

  return useMemo(
    () => ({ editContent, approve, unapprove, toggleLock }),
    [editContent, approve, unapprove, toggleLock],
  );
}
