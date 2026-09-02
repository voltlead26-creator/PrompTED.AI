import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PersistedTedArtifact,
  PersistedTedArtifactBlock,
} from "@prompted/shared";
import { testOwnerDispatchLease } from "@/test/owner-dispatch-lease";

const withOwnerSupabaseMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/owner-client", () => ({
  withOwnerSupabase: withOwnerSupabaseMock,
}));

import {
  createOrReplayArtifact,
  fetchArtifactByOutcome,
  saveArtifactBlockRevision,
  setArtifactBlockCompleted,
} from "./artifacts";

const USER_ID = "a1000000-0000-4000-8000-000000000001";
const OUTCOME_ID = "a2000000-0000-4000-8000-000000000001";
const ARTIFACT_ID = "a3000000-0000-4000-8000-000000000001";
const BLOCK_ID = "a4000000-0000-4000-8000-000000000001";
const OPERATION_ID = "a5000000-0000-4000-8000-000000000001";

const lease = testOwnerDispatchLease(USER_ID);

const block = {
  id: BLOCK_ID,
  artifact_id: ARTIFACT_ID,
  user_id: USER_ID,
  kind: "action",
  stable_key: "first_action",
  parent_block_id: null,
  heading: "First action",
  order_index: 0,
  payload: { title: "Act", objective: "Do the useful thing" },
  approval_status: "draft",
  completed_at: null,
  due_date: null,
  revision: 2,
  ledger_binding_status: "legacy_unversioned",
  ledger_section_key: null,
  ledger_version: null,
  is_required: null,
  section_state: null,
  approved_revision: null,
  source_block_id: null,
  source_section_key: null,
  transformation_version: null,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
  references: [],
} satisfies PersistedTedArtifactBlock;

const artifact = {
  id: ARTIFACT_ID,
  outcome_id: OUTCOME_ID,
  user_id: USER_ID,
  kind: "action_plan",
  title: "Action plan",
  template_id: null,
  schema_version: 2,
  pipeline_version: "ted-v2",
  status: "needs_review",
  quality_status: "passed",
  current_revision: 3,
  request_id: "artifact-request",
  ledger_binding_status: "legacy_unversioned",
  ledger_template_id: null,
  ledger_version: null,
  benchmark_version: null,
  generation_snapshot_id: null,
  approved_revision: null,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
  blocks: [],
} satisfies PersistedTedArtifact;

function installClient(client: unknown) {
  withOwnerSupabaseMock.mockImplementation(async (...args: unknown[]) => {
    const operation = args[1];
    return (operation as (value: unknown) => unknown)(client);
  });
}

describe("artifact persistence commands", () => {
  beforeEach(() => {
    withOwnerSupabaseMock.mockReset();
  });

  it("keeps creation replay separate and rejects a malformed persistence identity", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "not-a-uuid", error: null });
    installClient({ rpc });

    await expect(createOrReplayArtifact({ ...artifact, blocks: [block] }, lease))
      .rejects.toThrow("ARTIFACT_CREATION_UNCONFIRMED");
    expect(rpc).toHaveBeenCalledWith("save_ted_artifact", expect.any(Object));
  });

  it("uses the block revision command and validates its durable receipt", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        contract_version: "ted-artifact-mutation.1",
        status: "committed",
        operation_id: OPERATION_ID,
        mutation_kind: "block_payload",
        artifact_id: ARTIFACT_ID,
        accepted_artifact_revision: 3,
        artifact_revision: 4,
        artifact_status: "needs_review",
        artifact_approved_revision: null,
        block_id: BLOCK_ID,
        accepted_block_revision: 2,
        block_revision: 3,
        ledger_binding_status: "legacy_unversioned",
        section_state: null,
        approval_status: "draft",
        approved_revision: null,
        idempotent_replay: false,
      },
      error: null,
    });
    installClient({ rpc });

    const receipt = await saveArtifactBlockRevision({
      artifactId: ARTIFACT_ID,
      blockId: BLOCK_ID,
      expectedArtifactRevision: 3,
      expectedBlockRevision: 2,
      payload: { title: "Act", objective: "Do the revised thing" },
      sectionState: null,
    }, lease);

    expect(rpc).toHaveBeenCalledWith("save_ted_artifact_block_revision", {
      p_block_id: BLOCK_ID,
      p_expected_artifact_revision: 3,
      p_expected_block_revision: 2,
      p_payload: { title: "Act", objective: "Do the revised thing" },
      p_section_state: null,
    });
    expect(receipt).toMatchObject({
      artifactId: ARTIFACT_ID,
      artifactRevision: 4,
      blockId: BLOCK_ID,
      blockRevision: 3,
      idempotentReplay: false,
    });
  });

  it("rejects a success-looking block result whose revisions did not advance", async () => {
    installClient({
      rpc: vi.fn().mockResolvedValue({
        data: {
          contract_version: "ted-artifact-mutation.1",
          status: "committed",
          operation_id: OPERATION_ID,
          mutation_kind: "block_payload",
          artifact_id: ARTIFACT_ID,
          accepted_artifact_revision: 3,
          artifact_revision: 3,
          artifact_status: "needs_review",
          artifact_approved_revision: null,
          block_id: BLOCK_ID,
          accepted_block_revision: 2,
          block_revision: 2,
          ledger_binding_status: "legacy_unversioned",
          section_state: null,
          approval_status: "draft",
          approved_revision: null,
          idempotent_replay: false,
        },
        error: null,
      }),
    });

    await expect(saveArtifactBlockRevision({
      artifactId: ARTIFACT_ID,
      blockId: BLOCK_ID,
      expectedArtifactRevision: 3,
      expectedBlockRevision: 2,
      payload: { title: "Act", objective: "Do the revised thing" },
      sectionState: null,
    }, lease)).rejects.toThrow("ARTIFACT_BLOCK_MUTATION_INVALID");
  });

  it("does not convert artifact or child read failures into missing or partial truth", async () => {
    const artifactQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: new Error("offline") }),
    };
    installClient({ from: vi.fn().mockReturnValue(artifactQuery) });
    await expect(fetchArtifactByOutcome(OUTCOME_ID, lease)).rejects.toThrow("offline");

    const blockQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: new Error("block read failed") }),
    };
    const referenceQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const from = vi.fn()
      .mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: artifact, error: null }),
              }),
            }),
          }),
        }),
      })
      .mockReturnValueOnce(blockQuery)
      .mockReturnValueOnce(referenceQuery);
    installClient({ from });

    await expect(fetchArtifactByOutcome(OUTCOME_ID, lease))
      .rejects.toThrow("block read failed");
  });

  it("validates the authoritative completion row instead of ignoring it", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ...block, revision: 3, completed_at: "2026-09-01T01:00:00.000Z" },
      error: null,
    });
    installClient({ rpc });

    const completed = await setArtifactBlockCompleted(block, true, lease);
    expect(completed.revision).toBe(3);
    expect(completed.completed_at).toBe("2026-09-01T01:00:00.000Z");
    expect(rpc).toHaveBeenCalledWith("set_ted_block_completed", {
      p_block_id: BLOCK_ID,
      p_completed: true,
      p_expected_revision: 2,
    });
  });
});
