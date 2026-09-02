import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_SNAPSHOT_VERSION } from "./workspace-initial-state";

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));

import { loadWorkspaceInitialState } from "./workspace-initial-state.server";

const OUTCOME_ID = "94100000-0000-4000-8000-000000000001";
const USER_ID = "94100000-0000-4000-8000-000000000002";
const DOCUMENT_ID = "94100000-0000-4000-8000-000000000003";
const SECTION_ID = "94100000-0000-4000-8000-000000000004";
const UPLOAD_ID = "94100000-0000-4000-8000-000000000005";

function validSnapshot() {
  return {
    contract_version: WORKSPACE_SNAPSHOT_VERSION,
    owner_user_id: USER_ID,
    outcome: {
      id: OUTCOME_ID,
      situation: "Prepare a document.",
      template_id: "resume",
      template_name: "Resume",
      conversation_context: "",
      upload_context: "",
      upload_id: UPLOAD_ID,
    },
    document: {
      id: DOCUMENT_ID,
      title: "Document",
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
    export_eligibility: { eligible: false, blocking_reasons: ["not_approved"] },
    active_section_id: SECTION_ID,
    sections: [
      {
        id: SECTION_ID,
        document_id: DOCUMENT_ID,
        user_id: USER_ID,
        key: "summary",
        section_key: null,
        name: "Summary",
        order_index: 0,
        content: "Authoritative body",
        content_loaded: true,
        content_sha256: "a".repeat(64),
        content_length: new TextEncoder().encode("Authoritative body").length,
        status: "draft",
        is_required: true,
        created_at: "2026-09-01T00:00:00.000Z",
        updated_at: "2026-09-01T00:00:00.000Z",
        revision: 1,
        approved_revision: null,
        ledger_binding_status: "legacy_unversioned",
        section_state: null,
      },
    ],
  };
}

describe("loadWorkspaceInitialState", () => {
  beforeEach(() => createClientMock.mockReset());

  it("loads all critical truth through exactly one transactional snapshot RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: validSnapshot(), error: null });
    const from = vi.fn();
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
      },
      rpc,
      from,
    });

    const initial = await loadWorkspaceInitialState(OUTCOME_ID);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_workspace_snapshot_v1", {
      p_outcome_id: OUTCOME_ID,
      p_active_section_id: null,
    });
    expect(from).not.toHaveBeenCalled();
    expect(initial.truth.persistence).toBe("persisted");
    expect(initial.truth.ownerUserId).toBe(USER_ID);
    expect(initial.intake?.templateId).toBe("resume");
    expect(initial.intake?.uploadId).toBe(UPLOAD_ID);
    expect(initial.workspace?.sections[0]?.content).toBe("Authoritative body");
  });

  it.each([
    ["RPC error", { data: null, error: { code: "XX000" } }],
    ["wrong version", { data: { ...validSnapshot(), contract_version: "wrong" }, error: null }],
    ["partial body", { data: { ...validSnapshot(), sections: [{}] }, error: null }],
  ])("fails closed to unavailable on %s", async (_label, result) => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
      },
      rpc: vi.fn().mockResolvedValue(result),
    });

    await expect(loadWorkspaceInitialState(OUTCOME_ID)).resolves.toMatchObject({
      workspace: null,
      intake: null,
      truth: { authenticated: true, ownerUserId: USER_ID, persistence: "unavailable" },
    });
  });
});
