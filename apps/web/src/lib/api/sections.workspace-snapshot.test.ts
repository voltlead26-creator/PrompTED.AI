import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({ createClient: createClientMock }));
vi.mock("@/lib/supabase/owner-client", () => ({
  withOwnerSupabase: vi.fn(async (_lease, operation) => operation(createClientMock())),
}));

import { fetchWorkspaceSectionBody } from "./sections";
import { testOwnerDispatchLease } from "@/test/owner-dispatch-lease";

const OUTCOME_ID = "94200000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "94200000-0000-4000-8000-000000000002";
const SECTION_ID = "94200000-0000-4000-8000-000000000003";

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("fetchWorkspaceSectionBody", () => {
  beforeEach(() => createClientMock.mockReset());

  it("uses one owner RPC and accepts only the exact requested revision and digest", async () => {
    const content = "Authoritative section body.";
    const rpc = vi.fn().mockResolvedValue({
      data: {
        contract_version: "workspace-section-body.v1",
        outcome_id: OUTCOME_ID,
        document_id: DOCUMENT_ID,
        document_revision: 7,
        section_id: SECTION_ID,
        section_revision: 3,
        content,
        content_sha256: await sha256(content),
        content_length: new TextEncoder().encode(content).length,
        status: "edited",
        approved_revision: null,
        ledger_binding_status: "legacy_unversioned",
        section_key: null,
        section_state: null,
        updated_at: "2026-09-01T00:00:00.000Z",
      },
      error: null,
    });
    createClientMock.mockReturnValue({ rpc });

    await expect(
      fetchWorkspaceSectionBody(
        {
          outcomeId: OUTCOME_ID,
          sectionId: SECTION_ID,
          expectedDocumentRevision: 7,
          expectedSectionRevision: 3,
        },
        testOwnerDispatchLease(),
      ),
    ).resolves.toMatchObject({ content, sectionRevision: 3, documentRevision: 7 });
    expect(rpc).toHaveBeenCalledWith("get_workspace_section_body_v1", {
      p_outcome_id: OUTCOME_ID,
      p_section_id: SECTION_ID,
      p_expected_document_revision: 7,
      p_expected_section_revision: 3,
    });
  });

  it.each([
    ["wrong contract", { contract_version: "workspace-section-body.v2" }],
    ["stale document", { document_revision: 8 }],
    ["stale revision", { section_revision: 4 }],
    ["wrong section", { section_id: "94200000-0000-4000-8000-000000000099" }],
    ["body mismatch", { content_sha256: "f".repeat(64) }],
  ])("rejects %s without exposing it as authoritative content", async (_label, override) => {
    const content = "Current body";
    createClientMock.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: {
          contract_version: "workspace-section-body.v1",
          outcome_id: OUTCOME_ID,
          document_id: DOCUMENT_ID,
          document_revision: 7,
          section_id: SECTION_ID,
          section_revision: 3,
          content,
          content_sha256: await sha256(content),
          content_length: new TextEncoder().encode(content).length,
          status: "edited",
          approved_revision: null,
          ledger_binding_status: "legacy_unversioned",
          section_key: null,
          section_state: null,
          updated_at: "2026-09-01T00:00:00.000Z",
          ...override,
        },
        error: null,
      }),
    });

    await expect(
      fetchWorkspaceSectionBody(
        {
          outcomeId: OUTCOME_ID,
          sectionId: SECTION_ID,
          expectedDocumentRevision: 7,
          expectedSectionRevision: 3,
        },
        testOwnerDispatchLease(),
      ),
    ).rejects.toThrow("WORKSPACE_SECTION_BODY_INVALID");
  });
});
