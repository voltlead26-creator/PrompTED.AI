import { describe, expect, it } from "vitest";
import {
  HOME_UPLOAD_INTAKE_VERSION,
  adaptHomeUploadIntakeSnapshot,
} from "./home-intake-initial-state";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const INTAKE_ID = "22222222-2222-4222-8222-222222222222";
const UPLOAD_ID = "33333333-3333-8333-8333-333333333333";

function validAwaitingSnapshot() {
  const extractedText = "Warehouse supervisor with eight years of experience.";
  return {
    contract_version: HOME_UPLOAD_INTAKE_VERSION,
    intake_id: INTAKE_ID,
    owner_user_id: USER_ID,
    upload_id: UPLOAD_ID,
    state: "open",
    revision: 1,
    typed_situation: "Improve my resume",
    file_name: "resume.pdf",
    file_type: "application/pdf",
    file_size_bytes: 2048,
    content_sha256: "a".repeat(64),
    upload_state: "awaiting_confirmation",
    extracted_text: extractedText,
    confirm_payload: {
      summary: "A resume for warehouse roles.",
      document_type: "resume",
      structure: [{ title: "Experience", items: ["Warehouse supervisor"] }],
      filename: "resume.pdf",
      char_count: extractedText.length,
      truncated: false,
    },
    confirmed_text: null,
    confirmed_text_sha256: null,
    outcome_id: null,
    retryable: false,
    safe_next_action: "Review and confirm what TED read.",
    updated_at: "2026-09-02T01:02:03.000Z",
    idempotent_replay: false,
  };
}

describe("adaptHomeUploadIntakeSnapshot", () => {
  it("projects a complete owner-bound awaiting-confirmation snapshot", () => {
    expect(adaptHomeUploadIntakeSnapshot(validAwaitingSnapshot(), USER_ID)).toEqual({
      contractVersion: HOME_UPLOAD_INTAKE_VERSION,
      intakeId: INTAKE_ID,
      ownerUserId: USER_ID,
      uploadId: UPLOAD_ID,
      state: "open",
      revision: 1,
      acceptedRevision: null,
      typedSituation: "Improve my resume",
      fileName: "resume.pdf",
      fileType: "application/pdf",
      fileSizeBytes: 2048,
      contentSha256: "a".repeat(64),
      uploadState: "awaiting_confirmation",
      extractedText: "Warehouse supervisor with eight years of experience.",
      confirmPayload: {
        summary: "A resume for warehouse roles.",
        document_type: "resume",
        structure: [{ title: "Experience", items: ["Warehouse supervisor"] }],
        filename: "resume.pdf",
        char_count: 52,
        truncated: false,
      },
      confirmedText: null,
      confirmedTextSha256: null,
      outcomeId: null,
      retryable: false,
      safeNextAction: "Review and confirm what TED read.",
      updatedAt: "2026-09-02T01:02:03.000Z",
      idempotentReplay: false,
    });
  });

  it.each([
    ["wrong owner", { owner_user_id: "44444444-4444-4444-8444-444444444444" }],
    ["wrong contract", { contract_version: "home-upload-intake.v0" }],
    ["malformed digest", { content_sha256: "bad" }],
    ["non-monotonic revision", { revision: 0 }],
    ["invalid timestamp", { updated_at: "not-a-date" }],
    ["missing confirmation body", { extracted_text: null }],
    ["mismatched confirmation count", {
      confirm_payload: {
        ...validAwaitingSnapshot().confirm_payload,
        char_count: 1,
      },
    }],
    ["contradictory confirmed state", {
      state: "confirmed",
      revision: 2,
      upload_state: "confirmed",
      extracted_text: null,
      confirmed_text: null,
      confirmed_text_sha256: null,
    }],
    ["unexpected retryability", { retryable: true }],
  ])("rejects a %s snapshot", (_label, replacement) => {
    expect(() =>
      adaptHomeUploadIntakeSnapshot(
        { ...validAwaitingSnapshot(), ...replacement },
        USER_ID,
      ),
    ).toThrow("HOME_UPLOAD_INTAKE_SNAPSHOT_INVALID");
  });

  it("accepts a confirmed recovery checkpoint without exposing raw extraction", () => {
    const snapshot = validAwaitingSnapshot();
    const parsed = adaptHomeUploadIntakeSnapshot(
      {
        ...snapshot,
        state: "confirmed",
        revision: 2,
        upload_state: "confirmed",
        extracted_text: null,
        confirmed_text: "Corrected warehouse experience.",
        confirmed_text_sha256: "b".repeat(64),
      },
      USER_ID,
    );

    expect(parsed.state).toBe("confirmed");
    expect(parsed.extractedText).toBeNull();
    expect(parsed.confirmedText).toBe("Corrected warehouse experience.");
  });

  it("accepts only a redacted consumed presentation receipt", () => {
    const consumed = {
      ...validAwaitingSnapshot(),
      state: "consumed",
      revision: 3,
      upload_state: "consumed",
      extracted_text: null,
      confirm_payload: null,
      confirmed_text: null,
      confirmed_text_sha256: null,
      outcome_id: INTAKE_ID,
    };

    expect(adaptHomeUploadIntakeSnapshot(consumed, USER_ID)).toMatchObject({
      state: "consumed",
      outcomeId: INTAKE_ID,
      confirmedText: null,
      confirmedTextSha256: null,
    });
    expect(() => adaptHomeUploadIntakeSnapshot({
      ...consumed,
      confirmed_text: "Sensitive confirmed source.",
      confirmed_text_sha256: "b".repeat(64),
    }, USER_ID)).toThrow("HOME_UPLOAD_INTAKE_SNAPSHOT_INVALID");
  });
});
