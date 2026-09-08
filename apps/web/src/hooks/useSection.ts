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

export interface ContentEditOptions {
  /** Continue an already snapshotted local typing burst. Other edits record history. */
  recordHistory?: boolean;
}

export interface UseSection {
  editContent: (id: string, content: string, options?: ContentEditOptions) => void;
  approve: (id: string) => void;
  unapprove: (id: string) => void;
  toggleLock: (id: string) => void;
}

/**
 * useSection — content + status mutations, applied optimistically through the
 * pure helpers in @prompted/shared. Edits snapshot the prior text with a visible
 * provenance label; continued typing can reuse its burst's initial snapshot.
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
    (id: string, content: string, options?: ContentEditOptions) => {
      const savedAt = new Date().toISOString();
      setSections((previous) =>
        previous.map((section) => {
          if (section.id !== id) return section;
          const edited = applyContentEdit(section, content);
          if (edited === section || options?.recordHistory === false) return edited;
          const snapshot: SectionVersion = {
            content: section.content,
            saved_at: savedAt,
            label: "Before your edit",
            origin: "user_edit",
          };
          return {
            ...edited,
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
