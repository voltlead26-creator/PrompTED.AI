import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Section } from "@prompted/shared/browser";

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));

import {
  fetchDocument,
  fetchDocumentByOutcomeId,
  updateDocumentStatus,
  updateDocumentTitle,
  upsertDocument,
} from "./documents";
import {
  fetchSections,
  persistSectionOrder,
  updateSectionContent,
  updateSectionStatus,
  upsertSections,
} from "./sections";
import { fetchOutcome, updateOutcome, upsertOutcome } from "./outcomes";
import { commitGuestWorkspaceImport } from "./import-workspace";

type QueryResult = { data: unknown; error: unknown };

interface QueryBuilder {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  then: ReturnType<typeof vi.fn>;
}

function queryBuilder(result: QueryResult): QueryBuilder {
  const builder = {} as QueryBuilder;
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.upsert = vi.fn(() => builder);
  builder.update = vi.fn(() => builder);
  builder.then = vi.fn((resolve, reject) => Promise.resolve(result).then(resolve, reject));
  return builder;
}

function useBuilder(builder: QueryBuilder): void {
  createClientMock.mockReturnValue({ from: vi.fn(() => builder) });
}

const section: Section = {
  id: "11111111-1111-4111-8111-111111111111",
  document_id: "22222222-2222-4222-8222-222222222222",
  user_id: "33333333-3333-4333-8333-333333333333",
  name: "Summary",
  order_index: 0,
  content: "Current wording",
  status: "edited",
  version_history: [
    {
      content: "Earlier wording",
      saved_at: "2026-08-01T00:00:00.000Z",
      origin: "user_edit",
    },
  ],
  is_required: true,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-31T00:00:00.000Z",
};

describe("Supabase persistence API errors", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it.each([
    ["fetchDocument", () => fetchDocument(section.document_id)],
    ["fetchDocumentByOutcomeId", () => fetchDocumentByOutcomeId("outcome-1", section.user_id)],
    [
      "upsertDocument",
      () =>
        upsertDocument({
          id: section.document_id,
          user_id: section.user_id,
          title: "Resume",
          status: "draft",
        }),
    ],
    ["updateDocumentStatus", () => updateDocumentStatus(section.document_id, "draft")],
    ["updateDocumentTitle", () => updateDocumentTitle(section.document_id, "Resume")],
    ["fetchSections", () => fetchSections(section.document_id)],
    ["updateSectionContent", () => updateSectionContent(section.id, "Next", "edited")],
    ["updateSectionStatus", () => updateSectionStatus(section.id, "approved")],
    ["upsertSections", () => upsertSections([section])],
    ["persistSectionOrder", () => persistSectionOrder([{ id: section.id, order_index: 0 }])],
    [
      "upsertOutcome",
      () =>
        upsertOutcome({
          id: "outcome-1",
          user_id: section.user_id,
          situation_text: "Create a resume",
        }),
    ],
    ["updateOutcome", () => updateOutcome("outcome-1", { status: "in_progress" })],
    ["fetchOutcome", () => fetchOutcome("outcome-1")],
  ])("throws the Supabase error from %s", async (_name, run) => {
    const error = { code: "42501", message: "captured row requires its RPC" };
    useBuilder(queryBuilder({ data: null, error }));

    await expect(run()).rejects.toBe(error);
  });

  it("preserves server-owned section history during generic current-state upserts", async () => {
    const builder = queryBuilder({ data: null, error: null });
    useBuilder(builder);

    await upsertSections([section]);

    expect(builder.upsert).toHaveBeenCalledWith(
      [
        expect.not.objectContaining({ version_history: expect.anything() }),
      ],
      { onConflict: "id", defaultToNull: false },
    );
  });

  it("throws a rejected atomic guest-workspace import instead of reporting migration success", async () => {
    const error = { code: "42501", message: "guest import rejected" };
    const rpc = vi.fn().mockResolvedValue({ data: null, error });
    createClientMock.mockReturnValue({ rpc });

    await expect(
      commitGuestWorkspaceImport({
        idempotencyKey: "guest-workspace:outcome-1:document-1:v1",
        outcomeId: "11111111-1111-4111-8111-111111111111",
        documentId: "22222222-2222-4222-8222-222222222222",
        title: "Resume",
        situationText: "Create a resume",
        recommendationPayload: {},
        templateId: null,
        documentStatus: "draft",
        sections: [section],
      }),
    ).rejects.toBe(error);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "commit_guest_workspace_import",
      expect.objectContaining({
        p_idempotency_key: "guest-workspace:outcome-1:document-1:v1",
        p_outcome_id: "11111111-1111-4111-8111-111111111111",
        p_document_id: "22222222-2222-4222-8222-222222222222",
      }),
    );
  });

  it("accepts only an already-canonical UUID as a document template identity", async () => {
    const builder = queryBuilder({ data: null, error: null });
    useBuilder(builder);

    await upsertDocument({
      id: section.document_id,
      user_id: section.user_id,
      title: "Resume",
      status: "draft",
      template_id: "resume",
    });
    await upsertDocument({
      id: section.document_id,
      user_id: section.user_id,
      title: "Resume",
      status: "draft",
      template_id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    });

    expect(builder.upsert.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ template_id: null }),
    );
    expect(builder.upsert.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ template_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    );
  });
});
