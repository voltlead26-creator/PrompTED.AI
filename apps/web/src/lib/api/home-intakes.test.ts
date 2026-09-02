import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PreparedUploadDispatch } from "@prompted/shared/api-client";
import { testOwnerDispatchLease } from "@/test/owner-dispatch-lease";

const ownerClientMocks = vi.hoisted(() => ({
  withOwnerSupabase: vi.fn(),
}));

vi.mock("@/lib/supabase/owner-client", () => ({
  withOwnerSupabase: ownerClientMocks.withOwnerSupabase,
}));

import {
  beginHomeUploadIntake,
  cancelHomeUploadIntake,
  commitHomeUploadIntake,
  confirmHomeUploadIntake,
} from "./home-intakes";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const INTAKE_ID = "22222222-2222-4222-8222-222222222222";
const UPLOAD_ID = "33333333-3333-8333-8333-333333333333";
const UPDATED_AT = "2026-09-02T01:02:03.000Z";
const prepared: Readonly<PreparedUploadDispatch> = Object.freeze({
  uploadId: UPLOAD_ID,
  situationText: "Improve my resume",
  fileName: "resume.pdf",
  mimeType: "application/pdf",
  persistedFileType: "application/pdf",
  fileSizeBytes: 1024,
  contentSha256: "a".repeat(64),
});

function baseSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    contract_version: "home-upload-intake.v1",
    intake_id: INTAKE_ID,
    owner_user_id: USER_ID,
    upload_id: UPLOAD_ID,
    state: "open",
    revision: 1,
    accepted_revision: 0,
    typed_situation: prepared.situationText,
    file_name: prepared.fileName,
    file_type: prepared.persistedFileType,
    file_size_bytes: prepared.fileSizeBytes,
    content_sha256: prepared.contentSha256,
    upload_state: "file_required",
    extracted_text: null,
    confirm_payload: null,
    confirmed_text: null,
    confirmed_text_sha256: null,
    outcome_id: null,
    retryable: true,
    safe_next_action: "Reselect the same file to continue this upload.",
    updated_at: UPDATED_AT,
    idempotent_replay: false,
    ...overrides,
  };
}

function installRpc(...results: Array<{ data: unknown; error: unknown }>) {
  const rpc = vi.fn();
  for (const result of results) rpc.mockResolvedValueOnce(result);
  ownerClientMocks.withOwnerSupabase.mockImplementation(
    async (...args: unknown[]) => {
      const operation = args.find(
        (candidate): candidate is (client: { rpc: typeof rpc }) => Promise<unknown> =>
          typeof candidate === "function",
      );
      if (!operation) throw new Error("OWNER_OPERATION_MISSING");
      return await operation({ rpc });
    },
  );
  return rpc;
}

describe("Home upload intake RPC adapter", () => {
  beforeEach(() => {
    ownerClientMocks.withOwnerSupabase.mockReset();
  });

  it("begins with exact prepared metadata and accepts only its exact receipt", async () => {
    const rpc = installRpc({ data: baseSnapshot(), error: null });

    const receipt = await beginHomeUploadIntake(
      { intakeId: INTAKE_ID, prepared },
      testOwnerDispatchLease(USER_ID),
    );

    expect(rpc).toHaveBeenCalledWith("begin_own_home_upload_intake_v1", {
      p_intake_id: INTAKE_ID,
      p_upload_id: UPLOAD_ID,
      p_typed_situation: "Improve my resume",
      p_file_name: "resume.pdf",
      p_file_type: "application/pdf",
      p_file_size_bytes: 1024,
      p_content_sha256: "a".repeat(64),
    });
    expect(receipt).toMatchObject({
      intakeId: INTAKE_ID,
      uploadId: UPLOAD_ID,
      state: "open",
      revision: 1,
      acceptedRevision: 0,
    });
  });

  it("replays an ambiguous malformed acknowledgement once with identical args", async () => {
    const rpc = installRpc(
      { data: { ...baseSnapshot(), upload_id: USER_ID }, error: null },
      { data: { ...baseSnapshot(), idempotent_replay: true }, error: null },
    );

    await expect(
      beginHomeUploadIntake(
        { intakeId: INTAKE_ID, prepared },
        testOwnerDispatchLease(USER_ID),
      ),
    ).resolves.toMatchObject({ idempotentReplay: true });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
  });

  it("does not replay a deterministic database conflict", async () => {
    const rpc = installRpc({
      data: null,
      error: { code: "40001", message: "HOME_UPLOAD_INTAKE_BEGIN_CONFLICT" },
    });

    await expect(
      beginHomeUploadIntake(
        { intakeId: INTAKE_ID, prepared },
        testOwnerDispatchLease(USER_ID),
      ),
    ).rejects.toMatchObject({
      code: "HOME_UPLOAD_INTAKE_BEGIN_CONFLICT",
      ambiguous: false,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("confirms and cancels only exact monotonic transitions", async () => {
    const extractedText = "Corrected resume text.";
    const confirmed = baseSnapshot({
      state: "confirmed",
      revision: 2,
      accepted_revision: 1,
      upload_state: "confirmed",
      retryable: false,
      extracted_text: null,
      confirm_payload: {
        summary: "A resume.",
        document_type: "resume",
        structure: [{ title: "Experience", items: [] }],
        filename: "resume.pdf",
        char_count: extractedText.length,
        truncated: false,
      },
      confirmed_text: extractedText,
      confirmed_text_sha256: "b".repeat(64),
      safe_next_action: "Continue with the text you confirmed.",
    });
    const cancelled = {
      ...confirmed,
      state: "cancelled",
      revision: 3,
      accepted_revision: 2,
      upload_state: "cancelled",
      confirm_payload: null,
      safe_next_action: "Start again or continue without the upload.",
    };
    const rpc = installRpc(
      { data: confirmed, error: null },
      { data: cancelled, error: null },
    );
    const lease = testOwnerDispatchLease(USER_ID);

    await expect(
      confirmHomeUploadIntake(
        {
          intakeId: INTAKE_ID,
          uploadId: UPLOAD_ID,
          expectedRevision: 1,
          confirmedText: extractedText,
        },
        lease,
      ),
    ).resolves.toMatchObject({ state: "confirmed", revision: 2 });
    await expect(
      cancelHomeUploadIntake(
        { intakeId: INTAKE_ID, uploadId: UPLOAD_ID, expectedRevision: 2 },
        lease,
      ),
    ).resolves.toMatchObject({ state: "cancelled", revision: 3 });
    expect(rpc).toHaveBeenNthCalledWith(1, "confirm_own_home_upload_intake_v1", {
      p_intake_id: INTAKE_ID,
      p_expected_revision: 1,
      p_confirmed_text: extractedText,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "cancel_own_home_upload_intake_v1", {
      p_intake_id: INTAKE_ID,
      p_expected_revision: 2,
    });
  });

  it("commits a maximum confirmed source without sending decorated server-owned fields", async () => {
    const confirmedText = "x".repeat(20_000);
    const decoratedUploadContext = [
      "Uploaded file: resume.pdf",
      "TED read: A resume for warehouse operations roles.",
      `Uploaded document text:\n${confirmedText}`,
    ].join("\n\n");
    const payload = {
      primary: { template_id: "resume", reason: "Resume" },
      alternatives: [],
      conversation: [{ role: "user" as const, text: "Improve my resume" }],
      situation: "Improve my resume",
      upload_id: UPLOAD_ID,
      upload_context: decoratedUploadContext,
    };
    const rpc = installRpc({
      data: {
        contract_version: "home-upload-intake-commit.v1",
        intake_id: INTAKE_ID,
        owner_user_id: USER_ID,
        upload_id: UPLOAD_ID,
        accepted_revision: 2,
        revision: 3,
        state: "consumed",
        outcome_id: INTAKE_ID,
        situation: "Improve my resume",
        template_id: "resume",
        template_name: "Resume",
        conversation_context: "",
        upload_context: confirmedText,
        committed_at: UPDATED_AT,
        idempotent_replay: false,
      },
      error: null,
    });

    const receipt = await commitHomeUploadIntake(
      {
        intakeId: INTAKE_ID,
        uploadId: UPLOAD_ID,
        expectedRevision: 2,
        confirmedText,
        situation: "Improve my resume",
        recommendationPayload: payload,
      },
      testOwnerDispatchLease(USER_ID),
    );

    expect(rpc).toHaveBeenCalledWith("commit_own_home_upload_intake_v1", {
      p_intake_id: INTAKE_ID,
      p_expected_revision: 2,
      p_situation_text: "Improve my resume",
      p_recommendation_payload: {
        primary: payload.primary,
        alternatives: payload.alternatives,
        conversation: payload.conversation,
      },
    });
    expect(receipt).toMatchObject({
      outcomeId: INTAKE_ID,
      revision: 3,
      uploadContext: confirmedText,
    });
  });

  it("marks a second malformed mutation acknowledgement as ambiguous", async () => {
    installRpc(
      { data: {}, error: null },
      { data: {}, error: null },
    );

    await expect(
      beginHomeUploadIntake(
        { intakeId: INTAKE_ID, prepared },
        testOwnerDispatchLease(USER_ID),
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "HOME_UPLOAD_INTAKE_RECEIPT_INVALID",
        ambiguous: true,
      }),
    );
  });
});
