import { beforeEach, describe, expect, it, vi } from "vitest";
import { testOwnerDispatchLease } from "@/test/owner-dispatch-lease";

const withOwnerSupabaseMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/owner-client", () => ({
  withOwnerSupabase: withOwnerSupabaseMock,
}));

import {
  LegacyWorkspaceSaveError,
  saveLegacyWorkspaceV1,
  type SaveLegacyWorkspaceV1Input,
} from "./documents";

const USER_ID = "f1000000-0000-4000-8000-000000000001";
const OUTCOME_ID = "f2000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "f3000000-0000-4000-8000-000000000001";
const SECTION_ID = "f4000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = `legacy-workspace:${"a".repeat(64)}`;
const UPDATED_AT = "2026-09-02T01:02:03.000Z";
const REVISED_CONTENT_SHA256 = "538b240f7e75ef9235f5e6cd3dac4dfc1ce90d1014f331d3c71ae96fac0a1b01";

function input(): SaveLegacyWorkspaceV1Input {
  return {
    idempotencyKey: IDEMPOTENCY_KEY,
    outcomeId: OUTCOME_ID,
    documentId: DOCUMENT_ID,
    expectedDocumentRevision: 4,
    expectedDocument: {
      title: "Proposal",
      status: "draft",
      template_id: null,
      unresolved_placeholders: [],
    },
    document: {
      title: "Revised proposal",
      status: "edited",
      template_id: null,
      unresolved_placeholders: [],
    },
    sections: [
      {
        id: SECTION_ID,
        expected: {
          revision: 2,
          content_sha256: "b".repeat(64),
          name: "Summary",
          order_index: 0,
          status: "draft",
          is_required: true,
        },
        desired: {
          name: "Summary",
          order_index: 0,
          status: "edited",
          is_required: true,
        },
        content: "Accurate revised wording.",
      },
    ],
  };
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    contract_version: "legacy-workspace-save.v1",
    state: "saved",
    outcome_id: OUTCOME_ID,
    document_id: DOCUMENT_ID,
    idempotency_key: IDEMPOTENCY_KEY,
    accepted_document_revision: 4,
    document_revision: 6,
    document_status: "edited",
    document_approved_revision: null,
    document_updated_at: UPDATED_AT,
    sections: [
      {
        section_id: SECTION_ID,
        status: "edited",
        revision: 3,
        approved_revision: null,
        content_sha256: REVISED_CONTENT_SHA256,
        updated_at: UPDATED_AT,
      },
    ],
    committed_at: UPDATED_AT,
    idempotent_replay: false,
    ...overrides,
  };
}

describe("atomic legacy workspace persistence", () => {
  beforeEach(() => {
    withOwnerSupabaseMock.mockReset();
  });

  it("sends exactly one owner-scoped aggregate command and validates its receipt", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: receipt(), error: null });
    withOwnerSupabaseMock.mockImplementation(async (_lease, operation) => operation({ rpc }));

    await expect(
      saveLegacyWorkspaceV1(input(), testOwnerDispatchLease(USER_ID)),
    ).resolves.toEqual({
      contractVersion: "legacy-workspace-save.v1",
      state: "saved",
      outcomeId: OUTCOME_ID,
      documentId: DOCUMENT_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      acceptedDocumentRevision: 4,
      documentRevision: 6,
      documentStatus: "edited",
      documentApprovedRevision: null,
      documentUpdatedAt: UPDATED_AT,
      sections: [
        {
          sectionId: SECTION_ID,
          status: "edited",
          revision: 3,
          approvedRevision: null,
          contentSha256: REVISED_CONTENT_SHA256,
          updatedAt: UPDATED_AT,
        },
      ],
      committedAt: UPDATED_AT,
      idempotentReplay: false,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("save_own_legacy_workspace_v1", {
      p_idempotency_key: IDEMPOTENCY_KEY,
      p_outcome_id: OUTCOME_ID,
      p_document_id: DOCUMENT_ID,
      p_expected_document_revision: 4,
      p_expected_document: input().expectedDocument,
      p_document: input().document,
      p_sections: input().sections,
    });
  });

  it("accepts unchanged historical approval state that predates approval-revision backfill", async () => {
    const command = input();
    command.expectedDocument = {
      title: "Proposal",
      status: "approved",
      template_id: null,
      unresolved_placeholders: [],
    };
    command.document = { ...command.expectedDocument };
    command.sections = [
      {
        id: SECTION_ID,
        expected: {
          revision: 2,
          content_sha256: "b".repeat(64),
          name: "Summary",
          order_index: 0,
          status: "approved",
          is_required: true,
        },
        desired: {
          name: "Summary",
          order_index: 0,
          status: "approved",
          is_required: true,
        },
      },
    ];
    const rpc = vi.fn().mockResolvedValue({
      data: receipt({
        state: "unchanged",
        document_revision: 4,
        document_status: "approved",
        document_approved_revision: null,
        sections: [
          {
            section_id: SECTION_ID,
            status: "approved",
            revision: 2,
            approved_revision: null,
            content_sha256: "b".repeat(64),
            updated_at: UPDATED_AT,
          },
        ],
      }),
      error: null,
    });
    withOwnerSupabaseMock.mockImplementation(async (_lease, operation) => operation({ rpc }));

    await expect(
      saveLegacyWorkspaceV1(command, testOwnerDispatchLease(USER_ID)),
    ).resolves.toEqual(
      expect.objectContaining({
        state: "unchanged",
        documentRevision: 4,
        documentApprovedRevision: null,
        sections: [expect.objectContaining({ approvedRevision: null })],
      }),
    );
  });

  it("accepts an unchanged draft whose historical approval revision is preserved", async () => {
    const command = input();
    command.document = { ...command.expectedDocument! };
    command.sections = [
      {
        id: SECTION_ID,
        expected: {
          revision: 2,
          content_sha256: "b".repeat(64),
          name: "Summary",
          order_index: 0,
          status: "draft",
          is_required: true,
        },
        desired: {
          name: "Summary",
          order_index: 0,
          status: "draft",
          is_required: true,
        },
      },
    ];
    const rpc = vi.fn().mockResolvedValue({
      data: receipt({
        state: "unchanged",
        document_revision: 4,
        document_status: "draft",
        document_approved_revision: 3,
        sections: [
          {
            section_id: SECTION_ID,
            status: "draft",
            revision: 2,
            approved_revision: 1,
            content_sha256: "b".repeat(64),
            updated_at: UPDATED_AT,
          },
        ],
      }),
      error: null,
    });
    withOwnerSupabaseMock.mockImplementation(async (_lease, operation) => operation({ rpc }));

    await expect(
      saveLegacyWorkspaceV1(command, testOwnerDispatchLease(USER_ID)),
    ).resolves.toEqual(
      expect.objectContaining({
        state: "unchanged",
        documentApprovedRevision: 3,
        sections: [expect.objectContaining({ approvedRevision: 1 })],
      }),
    );
  });

  it("accepts a non-approved section status change that preserves historical approval", async () => {
    const command = input();
    command.document = { ...command.expectedDocument! };
    command.sections = [
      {
        id: SECTION_ID,
        expected: {
          revision: 2,
          content_sha256: "b".repeat(64),
          name: "Summary",
          order_index: 0,
          status: "draft",
          is_required: true,
        },
        desired: {
          name: "Summary",
          order_index: 0,
          status: "edited",
          is_required: true,
        },
      },
    ];
    const rpc = vi.fn().mockResolvedValue({
      data: receipt({
        state: "saved",
        document_revision: 5,
        document_status: "draft",
        document_approved_revision: null,
        sections: [
          {
            section_id: SECTION_ID,
            status: "edited",
            revision: 3,
            approved_revision: 1,
            content_sha256: "b".repeat(64),
            updated_at: UPDATED_AT,
          },
        ],
      }),
      error: null,
    });
    withOwnerSupabaseMock.mockImplementation(async (_lease, operation) => operation({ rpc }));

    await expect(
      saveLegacyWorkspaceV1(command, testOwnerDispatchLease(USER_ID)),
    ).resolves.toEqual(
      expect.objectContaining({
        documentRevision: 5,
        sections: [expect.objectContaining({ approvedRevision: 1 })],
      }),
    );
  });

  it("requires an export transition to preserve approval for the exact revision", async () => {
    const command = input();
    command.expectedDocument = {
      title: "Proposal",
      status: "approved",
      template_id: null,
      unresolved_placeholders: [],
    };
    command.document = { ...command.expectedDocument, status: "exported" };
    command.sections = [
      {
        id: SECTION_ID,
        expected: {
          revision: 2,
          content_sha256: "b".repeat(64),
          name: "Summary",
          order_index: 0,
          status: "approved",
          is_required: true,
        },
        desired: {
          name: "Summary",
          order_index: 0,
          status: "approved",
          is_required: true,
        },
      },
    ];
    const validReceipt = receipt({
      state: "saved",
      document_revision: 4,
      document_status: "exported",
      document_approved_revision: 4,
      sections: [
        {
          section_id: SECTION_ID,
          status: "approved",
          revision: 2,
          approved_revision: 2,
          content_sha256: "b".repeat(64),
          updated_at: UPDATED_AT,
        },
      ],
    });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: validReceipt, error: null })
      .mockResolvedValueOnce({
        data: { ...validReceipt, document_approved_revision: 3 },
        error: null,
      });
    withOwnerSupabaseMock.mockImplementation(async (_lease, operation) => operation({ rpc }));

    await expect(
      saveLegacyWorkspaceV1(command, testOwnerDispatchLease(USER_ID)),
    ).resolves.toEqual(expect.objectContaining({ documentApprovedRevision: 4 }));
    await expect(
      saveLegacyWorkspaceV1(command, testOwnerDispatchLease(USER_ID)),
    ).rejects.toMatchObject({ code: "LEGACY_WORKSPACE_RECEIPT_INVALID", ambiguous: true });
  });

  it.each([
    ["wrong document", { document_id: "f3000000-0000-4000-8000-000000000099" }],
    ["wrong accepted revision", { accepted_document_revision: 3 }],
    ["impossible revision", { document_revision: 5 }],
    ["duplicate section", { sections: [receipt().sections[0], receipt().sections[0]] }],
    ["invalid digest", { sections: [{ ...receipt().sections[0], content_sha256: "bad" }] }],
    ["invalid time", { committed_at: "never" }],
  ])("rejects a malformed %s receipt", async (_label, replacement) => {
    const rpc = vi.fn().mockResolvedValue({ data: receipt(replacement), error: null });
    withOwnerSupabaseMock.mockImplementation(async (_lease, operation) => operation({ rpc }));

    const error = await saveLegacyWorkspaceV1(
      input(),
      testOwnerDispatchLease(USER_ID),
    ).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(LegacyWorkspaceSaveError);
    expect(error).toMatchObject({
      code: "LEGACY_WORKSPACE_RECEIPT_INVALID",
      ambiguous: true,
    });
  });

  it("classifies a database rejection as deterministic", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "40001", message: "LEGACY_WORKSPACE_DOCUMENT_CONFLICT" },
    });
    withOwnerSupabaseMock.mockImplementation(async (_lease, operation) => operation({ rpc }));

    const error = await saveLegacyWorkspaceV1(
      input(),
      testOwnerDispatchLease(USER_ID),
    ).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(LegacyWorkspaceSaveError);
    expect(error).toMatchObject({
      code: "LEGACY_WORKSPACE_DOCUMENT_CONFLICT",
      ambiguous: false,
    });
  });

  it("classifies transport acknowledgement loss as ambiguous for exact replay", async () => {
    withOwnerSupabaseMock.mockRejectedValue(new TypeError("fetch failed"));

    const error = await saveLegacyWorkspaceV1(
      input(),
      testOwnerDispatchLease(USER_ID),
    ).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(LegacyWorkspaceSaveError);
    expect(error).toMatchObject({
      code: "LEGACY_WORKSPACE_ACKNOWLEDGEMENT_UNKNOWN",
      ambiguous: true,
    });
  });

  it.each([
    ["PGRST000", true],
    ["PGRST202", false],
  ] as const)("classifies %s according to whether the RPC could have run", async (code, ambiguous) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code, message: code } });
    withOwnerSupabaseMock.mockImplementation(async (_lease, operation) => operation({ rpc }));

    const error = await saveLegacyWorkspaceV1(
      input(),
      testOwnerDispatchLease(USER_ID),
    ).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(LegacyWorkspaceSaveError);
    expect(error).toMatchObject({ code: `DATABASE_${code}`, ambiguous });
  });
});
