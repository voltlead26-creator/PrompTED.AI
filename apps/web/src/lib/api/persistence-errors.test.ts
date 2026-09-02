import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Section } from "@prompted/shared/browser";

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({
  createClient: createClientMock,
}));
vi.mock("@/lib/supabase/owner-client", () => ({
  withOwnerSupabase: vi.fn(async (_lease, operation) => operation(createClientMock())),
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
import { attachOutcomeUpload, fetchOutcome, updateOutcome, upsertOutcome } from "./outcomes";
import { commitGuestWorkspaceImport } from "./import-workspace";
import { testOwnerDispatchLease } from "@/test/owner-dispatch-lease";

type QueryResult = { data: unknown; error: unknown };

interface QueryBuilder {
  result: QueryResult;
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
  builder.result = result;
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
  createClientMock.mockReturnValue({
    from: vi.fn(() => builder),
    rpc: vi.fn().mockResolvedValue(builder.result),
  });
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
    [
      "fetchDocument",
      () => fetchDocument(section.document_id, testOwnerDispatchLease(section.user_id)),
    ],
    [
      "fetchDocumentByOutcomeId",
      () => fetchDocumentByOutcomeId(
        "outcome-1",
        section.user_id,
        testOwnerDispatchLease(section.user_id),
      ),
    ],
    [
      "upsertDocument",
      () =>
        upsertDocument(
          {
            id: section.document_id,
            user_id: section.user_id,
            title: "Resume",
            status: "draft",
          },
          testOwnerDispatchLease(section.user_id),
        ),
    ],
    [
      "updateDocumentStatus",
      () => updateDocumentStatus(
        section.document_id,
        "draft",
        testOwnerDispatchLease(section.user_id),
      ),
    ],
    [
      "updateDocumentTitle",
      () => updateDocumentTitle(
        section.document_id,
        "Resume",
        testOwnerDispatchLease(section.user_id),
      ),
    ],
    [
      "fetchSections",
      () => fetchSections(section.document_id, testOwnerDispatchLease(section.user_id)),
    ],
    [
      "updateSectionContent",
      () => updateSectionContent(
        section.id,
        "Next",
        "edited",
        testOwnerDispatchLease(section.user_id),
      ),
    ],
    [
      "updateSectionStatus",
      () => updateSectionStatus(
        section.id,
        "approved",
        testOwnerDispatchLease(section.user_id),
      ),
    ],
    [
      "upsertSections",
      () => upsertSections([section], testOwnerDispatchLease(section.user_id)),
    ],
    [
      "persistSectionOrder",
      () => persistSectionOrder(
        [{ id: section.id, order_index: 0 }],
        testOwnerDispatchLease(section.user_id),
      ),
    ],
    [
      "upsertOutcome",
      () =>
        upsertOutcome(
          {
            id: "outcome-1",
            user_id: section.user_id,
            situation_text: "Create a resume",
          },
          testOwnerDispatchLease(section.user_id),
        ),
    ],
    [
      "updateOutcome",
      () => updateOutcome(
        "outcome-1",
        { status: "in_progress" },
        testOwnerDispatchLease(section.user_id),
      ),
    ],
    [
      "fetchOutcome",
      () => fetchOutcome("outcome-1", testOwnerDispatchLease(section.user_id)),
    ],
  ])("throws the Supabase error from %s", async (_name, run) => {
    const error = { code: "42501", message: "captured row requires its RPC" };
    useBuilder(queryBuilder({ data: null, error }));

    await expect(run()).rejects.toBe(error);
  });

  it("preserves server-owned section history during generic current-state upserts", async () => {
    const builder = queryBuilder({ data: null, error: null });
    useBuilder(builder);

    await upsertSections([section], testOwnerDispatchLease(section.user_id));

    expect(builder.upsert).toHaveBeenCalledWith(
      [expect.not.objectContaining({ version_history: expect.anything() })],
      { onConflict: "id", defaultToNull: false },
    );
  });

  it("mutates outcomes only through owner-derived RPCs", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "outcome-1", error: null });
    createClientMock.mockReturnValue({ rpc });

    const lease = testOwnerDispatchLease(section.user_id);
    await upsertOutcome(
      {
        id: "outcome-1",
        user_id: section.user_id,
        situation_text: "Create a resume",
        recommendation_payload: null,
        status: "in_progress",
      },
      lease,
    );
    await updateOutcome("outcome-1", { is_saved: true }, lease);

    expect(rpc).toHaveBeenNthCalledWith(1, "upsert_own_outcome", {
      p_id: "outcome-1",
      p_situation_text: "Create a resume",
      p_recommendation_payload: null,
      p_status: "in_progress",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "update_own_outcome", {
      p_outcome_id: "outcome-1",
      p_patch: { is_saved: true },
    });
  });

  it("atomically binds upload-backed outcome creation and validates attachment truth", async () => {
    const uploadId = "44444444-4444-4444-8444-444444444444";
    const outcomeId = "55555555-5555-4555-8555-555555555555";
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: outcomeId, error: null })
      .mockResolvedValueOnce({
        data: {
          outcome_id: outcomeId,
          situation: "Prepare an exact proposal.",
          template_id: "business-proposal",
          template_name: "Business Proposal",
          conversation_context: "Confirmed conversation.",
          upload_context: "Authoritative retained source.",
          upload_id: uploadId,
          updated_at: "2026-09-01T00:01:00.000Z",
        },
        error: null,
      });
    createClientMock.mockReturnValue({ rpc });

    const lease = testOwnerDispatchLease(section.user_id);
    await upsertOutcome(
      {
        id: outcomeId,
        user_id: section.user_id,
        situation_text: "Prepare an exact proposal.",
        recommendation_payload: {
          primary: { template_id: "business-proposal", reason: "Business Proposal" },
          alternatives: [],
          situation: "Prepare an exact proposal.",
          upload_id: uploadId,
        },
        status: "in_progress",
      },
      lease,
    );
    await expect(attachOutcomeUpload(outcomeId, uploadId, lease)).resolves.toEqual({
      outcomeId,
      situation: "Prepare an exact proposal.",
      templateId: "business-proposal",
      templateName: "Business Proposal",
      conversationContext: "Confirmed conversation.",
      uploadContext: "Authoritative retained source.",
      uploadId,
      updatedAt: "2026-09-01T00:01:00.000Z",
    });

    expect(rpc).toHaveBeenNthCalledWith(1, "upsert_own_outcome_with_upload", {
      p_id: outcomeId,
      p_situation_text: "Prepare an exact proposal.",
      p_recommendation_payload: expect.objectContaining({ upload_id: uploadId }),
      p_status: "in_progress",
      p_upload_id: uploadId,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "attach_own_upload_to_outcome", {
      p_outcome_id: outcomeId,
      p_upload_id: uploadId,
    });
  });

  it("rejects a malformed upload-attachment envelope", async () => {
    createClientMock.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: { outcome_id: "wrong", upload_id: "wrong" },
        error: null,
      }),
    });
    await expect(
      attachOutcomeUpload(
        "outcome-1",
        "upload-1",
        testOwnerDispatchLease(section.user_id),
      ),
    ).rejects.toThrow(
      "OUTCOME_UPLOAD_BINDING_INVALID",
    );
  });

  it("throws a rejected atomic guest-workspace import instead of reporting migration success", async () => {
    const error = { code: "42501", message: "guest import rejected" };
    const rpc = vi.fn().mockResolvedValue({ data: null, error });
    createClientMock.mockReturnValue({ rpc });

    await expect(
      commitGuestWorkspaceImport(
        {
          idempotencyKey: "guest-workspace:outcome-1:document-1:v1",
          outcomeId: "11111111-1111-4111-8111-111111111111",
          documentId: "22222222-2222-4222-8222-222222222222",
          title: "Resume",
          situationText: "Create a resume",
          recommendationPayload: {},
          templateId: null,
          documentStatus: "draft",
          sections: [section],
        },
        testOwnerDispatchLease(section.user_id),
      ),
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

    const lease = testOwnerDispatchLease(section.user_id);
    await upsertDocument(
      {
        id: section.document_id,
        user_id: section.user_id,
        title: "Resume",
        status: "draft",
        template_id: "resume",
      },
      lease,
    );
    await upsertDocument(
      {
        id: section.document_id,
        user_id: section.user_id,
        title: "Resume",
        status: "draft",
        template_id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      },
      lease,
    );

    expect(builder.upsert.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ template_id: null }),
    );
    expect(builder.upsert.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ template_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    );
  });
});
