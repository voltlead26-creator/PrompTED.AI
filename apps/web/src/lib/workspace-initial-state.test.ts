import { describe, expect, it } from "vitest";
import {
  adaptWorkspaceSnapshotV1,
  MAX_WORKSPACE_SNAPSHOT_SECTIONS,
  WORKSPACE_SNAPSHOT_VERSION,
  workspaceSectionMetadata,
} from "./workspace-initial-state";

const USER_ID = "94000000-0000-4000-8000-000000000001";
const OUTCOME_ID = "94000000-0000-4000-8000-000000000002";
const DOCUMENT_ID = "94000000-0000-4000-8000-000000000003";
const UPLOAD_ID = "94000000-0000-4000-8000-000000000004";

function section(index: number, loaded = index === 0) {
  const id = `94000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`;
  return {
    id,
    document_id: DOCUMENT_ID,
    user_id: USER_ID,
    key: `section_${index}`,
    section_key: null,
    name: `Section ${index}`,
    order_index: index,
    content: loaded ? `Authoritative body ${index}` : null,
    content_loaded: loaded,
    content_sha256: String(index % 10).repeat(64),
    content_length: loaded
      ? new TextEncoder().encode(`Authoritative body ${index}`).length
      : 50_000,
    status: "draft",
    is_required: true,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    revision: 1,
    approved_revision: null,
    ledger_binding_status: "legacy_unversioned",
    section_state: null,
  };
}

function snapshot(sectionCount = 2) {
  return {
    contract_version: WORKSPACE_SNAPSHOT_VERSION,
    owner_user_id: USER_ID,
    outcome: {
      id: OUTCOME_ID,
      situation: "Prepare a reliable document.",
      template_id: "complaint-letter",
      template_name: "Complaint Letter",
      conversation_context: "Confirmed conversation context.",
      upload_context: "",
      upload_id: UPLOAD_ID,
    },
    document: {
      id: DOCUMENT_ID,
      title: "Reliable document",
      status: "draft",
      template_id: null,
      unresolved_placeholders: [],
      ledger_binding_status: "legacy_unversioned",
      ledger_version: null,
      current_revision: 1,
      approved_revision: null,
      updated_at: "2026-09-01T00:00:00.000Z",
      has_generated_content: true,
    },
    operation: null,
    approval: null,
    export_eligibility: {
      eligible: false,
      blocking_reasons: ["required_sections_not_approved"],
    },
    active_section_id: sectionCount > 0 ? section(0).id : null,
    sections: Array.from({ length: sectionCount }, (_, index) => section(index)),
  };
}

describe("workspace snapshot v1 adapter", () => {
  it("preserves WorkspaceInitialState while marking every omitted body as unavailable, not blank", () => {
    const initial = adaptWorkspaceSnapshotV1(snapshot());

    expect(initial.truth).toMatchObject({
      persistence: "persisted",
      ownerUserId: USER_ID,
      snapshotVersion: WORKSPACE_SNAPSHOT_VERSION,
      documentId: DOCUMENT_ID,
      exportEligible: false,
      exportBlockingReasons: ["required_sections_not_approved"],
    });
    expect(initial.intake).toEqual({
      outcomeId: OUTCOME_ID,
      situation: "Prepare a reliable document.",
      templateName: "Complaint Letter",
      templateId: "complaint-letter",
      conversationContext: "Confirmed conversation context.",
      uploadContext: "",
      uploadId: UPLOAD_ID,
    });
    expect(initial.workspace?.sections).toHaveLength(2);
    expect(initial.workspace?.sections[0]?.content).toBe("Authoritative body 0");
    expect(workspaceSectionMetadata(initial.workspace!.sections[0]!)).toMatchObject({
      contentLoaded: true,
      revision: 1,
    });
    expect(initial.workspace?.sections[1]?.content).toBe("");
    expect(workspaceSectionMetadata(initial.workspace!.sections[1]!)).toEqual(
      expect.objectContaining({
        contentLoaded: false,
        contentSha256: "1".repeat(64),
        contentLength: 50_000,
      }),
    );
  });

  it("fails closed on a wrong version, partial section identity, or body leakage", () => {
    expect(() =>
      adaptWorkspaceSnapshotV1({ ...snapshot(), contract_version: "workspace-snapshot.v2" }),
    ).toThrow("WORKSPACE_SNAPSHOT_INVALID");

    const partial = snapshot();
    delete (partial.sections[1] as Partial<ReturnType<typeof section>>).content_sha256;
    expect(() => adaptWorkspaceSnapshotV1(partial)).toThrow("WORKSPACE_SNAPSHOT_INVALID");

    const leaked = snapshot();
    leaked.sections[1]!.content = "A body that was not selected";
    expect(() => adaptWorkspaceSnapshotV1(leaked)).toThrow("WORKSPACE_SNAPSHOT_INVALID");

    expect(() => adaptWorkspaceSnapshotV1(snapshot(), "94000000-0000-4000-8000-000000000099"))
      .toThrow("WORKSPACE_SNAPSHOT_INVALID");
  });

  it("keeps old snapshots compatible but rejects malformed present upload provenance", () => {
    const legacy = snapshot();
    delete (legacy.outcome as Partial<typeof legacy.outcome>).upload_id;
    expect(adaptWorkspaceSnapshotV1(legacy).intake).not.toHaveProperty("uploadId");

    const explicitNull = snapshot();
    (explicitNull.outcome as Record<string, unknown>).upload_id = null;
    expect(adaptWorkspaceSnapshotV1(explicitNull).intake).not.toHaveProperty("uploadId");

    const malformed = snapshot();
    (malformed.outcome as Record<string, unknown>).upload_id = "not-an-upload-id";
    expect(() => adaptWorkspaceSnapshotV1(malformed)).toThrow("WORKSPACE_SNAPSHOT_INVALID");
  });

  it("keeps a large document bounded to one body and rejects unbounded section counts", () => {
    const large = adaptWorkspaceSnapshotV1(snapshot(256));
    const serialised = JSON.stringify(large);

    expect(serialised).toContain("Authoritative body 0");
    expect(serialised).not.toContain("Authoritative body 1");
    expect(serialised.length).toBeLessThan(300_000);
    expect(() => adaptWorkspaceSnapshotV1(snapshot(MAX_WORKSPACE_SNAPSHOT_SECTIONS + 1))).toThrow(
      "WORKSPACE_SNAPSHOT_INVALID",
    );
  });

  it("accepts captured operation, approval, and export truth only when they bind to one revision", () => {
    const base = snapshot(1);
    const captured = {
      ...base,
      document: {
        ...base.document,
        status: "approved",
        ledger_binding_status: "captured",
        ledger_version: "ledger.1",
        current_revision: 4,
        approved_revision: 4,
      },
      sections: [
        {
          ...base.sections[0]!,
          status: "approved",
          revision: 4,
          approved_revision: 4,
          ledger_binding_status: "captured",
          section_key: "section_0",
          section_state: "final",
        },
      ],
      operation: {
        operation_id: "94000000-0000-4000-8000-000000000090",
        operation_revision: 8,
        status: "ready_for_review",
        message: null,
        safe_next_action: "Review and export the approved revision.",
        retryable: false,
        safe_section_keys: ["section_0"],
        blocked_section_keys: [],
        latest_document_revision: 4,
        updated_at: "2026-09-01T00:00:00.000Z",
      },
      approval: {
        approval_id: "94000000-0000-4000-8000-000000000091",
        document_revision: 4,
        validation_passed: true,
        approved_at: "2026-09-01T00:00:00.000Z",
      },
      export_eligibility: { eligible: true, blocking_reasons: [] },
    };

    const initial = adaptWorkspaceSnapshotV1(captured);

    expect(initial.truth).toMatchObject({
      currentRevision: 4,
      approvedRevision: 4,
      operationStatus: "ready_for_review",
      operationDocumentRevision: 4,
      approvalRevision: 4,
      approvalValidated: true,
      exportEligible: true,
    });

    expect(() =>
      adaptWorkspaceSnapshotV1({
        ...captured,
        operation: { ...captured.operation, status: "generating" },
      }),
    ).toThrow("WORKSPACE_SNAPSHOT_INVALID");
  });
});
