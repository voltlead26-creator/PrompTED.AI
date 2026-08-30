import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Section } from "@prompted/shared";

const mockSetSections = vi.fn();
const mockSetUnresolvedPlaceholders = vi.fn();

vi.mock("@/components/providers", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("./useDocument", () => ({
  AUTH_SECTION_ID: "__auth__",
  useDocument: () => ({
    state: {
      documentId: "doc-1",
      title: "Complaint Letter",
      situation: "I need a complaint letter about a billing issue.",
      status: "draft",
      generated: false,
      templateId: "complaint_letter",
      conversationContext: "",
      uploadContext: "",
      unresolvedPlaceholders: [],
      sections: [{
        id: "section-1",
        document_id: "doc-1",
        user_id: "user-1",
        key: "issue",
        name: "The Issue",
        order_index: 0,
        content: '<p><br class="ProseMirror-trailingBreak"></p>',
        status: "draft",
        version_history: [],
        is_required: true,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      } satisfies Section],
    },
    loading: false,
    drafting: false,
    syncStatus: "saved",
    lastSyncedAt: null,
    retrySync: vi.fn(),
    generationIssues: [],
    regeneratingSectionId: null,
    retryGenerationSection: vi.fn(),
    setSections: mockSetSections,
    setStatus: vi.fn(),
    missingInfo: [],
    dismissMissingInfo: vi.fn(),
    unresolvedPlaceholders: [],
    setUnresolvedPlaceholders: mockSetUnresolvedPlaceholders,
  }),
}));

import { useWorkspace } from "./useWorkspace";

describe("useWorkspace", () => {
  it("does not expose blank required sections to the visible workspace", async () => {
    const { result } = renderHook(() => useWorkspace("outcome-1"));

    expect(result.current.sections[0]?.content).toBe(
      "{{TED_PLACEHOLDER:complaint_letter.issue.section_content:The Issue needs your input}}",
    );
    expect(result.current.missingInfoQuestions).toEqual([
      expect.objectContaining({
        placeholderId: "complaint_letter.issue.section_content",
        sectionKey: "issue",
        sectionId: "section-1",
        requiredForExport: true,
      }),
    ]);
    expect(result.current.placeholderExportDecision).toEqual({
      status: "acknowledgement_required",
      total: 1,
      requiredForExport: 1,
    });

    await waitFor(() => {
      expect(mockSetSections).toHaveBeenCalledWith([
        expect.objectContaining({
          content:
            "{{TED_PLACEHOLDER:complaint_letter.issue.section_content:The Issue needs your input}}",
        }),
      ]);
    });
    expect(mockSetUnresolvedPlaceholders).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "complaint_letter.issue.section_content",
        requiredForExport: true,
      }),
    ]);
  });
});
