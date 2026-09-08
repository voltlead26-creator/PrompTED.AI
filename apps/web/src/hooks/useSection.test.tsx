import { StrictMode, useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Section } from "@prompted/shared/browser";
import { useSection } from "./useSection";

const initial: Section = {
  id: "section-one",
  document_id: "document-one",
  user_id: "owner-one",
  name: "Experience",
  content: "Original wording.",
  status: "draft",
  order_index: 0,
  is_required: true,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
  version_history: [
    {
      content: "Historical wording.",
      saved_at: "2026-08-01T00:00:00.000Z",
      label: "Preserved history",
    },
  ],
};

function useSectionFixture(section = initial) {
  const [sections, setSections] = useState([section]);
  return { sections, ...useSection(setSections) };
}

describe("immediate section edits and grouped history", () => {
  it("keeps a typing burst's original snapshot without recording every transaction", () => {
    const { result } = renderHook(() => useSectionFixture(), { wrapper: StrictMode });
    act(() => {
      result.current.editContent(initial.id, "First typed word.");
      result.current.editContent(initial.id, "Second typed word.", { recordHistory: false });
      result.current.editContent(initial.id, "Complete typed wording.", { recordHistory: false });
    });
    expect(result.current.sections[0]?.content).toBe("Complete typed wording.");
    expect(result.current.sections[0]?.version_history).toEqual([
      initial.version_history[0],
      expect.objectContaining({
        content: initial.content,
        label: "Before your edit",
        origin: "user_edit",
      }),
    ]);
    act(() => result.current.editContent(initial.id, "A separate deliberate change."));
    expect(result.current.sections[0]?.version_history).toHaveLength(3);
    expect(result.current.sections[0]?.version_history[2]?.content).toBe("Complete typed wording.");
  });

  it("leaves locked wording and its history untouched", () => {
    const locked = { ...initial, status: "locked" as const };
    const { result } = renderHook(() => useSectionFixture(locked));
    act(() => result.current.editContent(initial.id, "A blocked edit."));
    expect(result.current.sections[0]).toBe(locked);
  });

  it("does not create history for an unchanged or foreign section", () => {
    const { result } = renderHook(() => useSectionFixture());
    act(() => {
      result.current.editContent(initial.id, initial.content);
      result.current.editContent("another-section", "Unrelated wording.");
    });
    expect(result.current.sections[0]).toBe(initial);
  });
});
