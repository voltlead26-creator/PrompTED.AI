import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PersistedTedArtifact,
  PersistedTedArtifactBlock,
} from "@prompted/shared";
import { recordBrowserPrincipal } from "@/lib/browser-principal-state";

const mocks = vi.hoisted(() => ({
  auth: { user: { id: "c1000000-0000-4000-8000-000000000001" }, loading: false },
  fetchArtifactByOutcome: vi.fn(),
  saveArtifactBlockRevision: vi.fn(),
  setArtifactBlockCompleted: vi.fn(),
}));

vi.mock("@/components/providers", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/lib/api/artifacts", () => ({
  fetchArtifactByOutcome: mocks.fetchArtifactByOutcome,
  saveArtifactBlockRevision: mocks.saveArtifactBlockRevision,
  setArtifactBlockCompleted: mocks.setArtifactBlockCompleted,
}));

import { useArtifact } from "./useArtifact";

const USER_ID = "c1000000-0000-4000-8000-000000000001";
const OUTCOME_A = "c2000000-0000-4000-8000-000000000001";
const OUTCOME_B = "c2000000-0000-4000-8000-000000000002";
const ARTIFACT_A = "c3000000-0000-4000-8000-000000000001";
const ARTIFACT_B = "c3000000-0000-4000-8000-000000000002";
const BLOCK_A = "c4000000-0000-4000-8000-000000000001";
const BLOCK_B = "c4000000-0000-4000-8000-000000000002";

function persistedBlock(options: {
  artifactId?: string;
  blockId?: string;
  revision?: number;
  objective?: string;
  completed?: boolean;
} = {}): PersistedTedArtifactBlock {
  return {
    id: options.blockId ?? BLOCK_A,
    artifact_id: options.artifactId ?? ARTIFACT_A,
    user_id: USER_ID,
    kind: "action",
    stable_key: "first_action",
    parent_block_id: null,
    heading: "First action",
    order_index: 0,
    payload: {
      title: "Act",
      objective: options.objective ?? "Original objective",
    },
    approval_status: "draft",
    completed_at: options.completed ? "2026-09-01T01:00:00.000Z" : null,
    due_date: null,
    revision: options.revision ?? 1,
    references: [],
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
  };
}

function persistedArtifact(options: {
  outcomeId?: string;
  artifactId?: string;
  blockId?: string;
  artifactRevision?: number;
  blockRevision?: number;
  objective?: string;
  completed?: boolean;
} = {}): PersistedTedArtifact {
  const outcomeId = options.outcomeId ?? OUTCOME_A;
  const artifactId = options.artifactId ?? ARTIFACT_A;
  return {
    id: artifactId,
    outcome_id: outcomeId,
    user_id: USER_ID,
    kind: "action_plan",
    title: "Action plan",
    template_id: null,
    schema_version: 2,
    pipeline_version: "ted-v2",
    status: "needs_review",
    quality_status: "passed",
    current_revision: options.artifactRevision ?? 1,
    request_id: `request:${outcomeId}`,
    ledger_binding_status: "legacy_unversioned",
    ledger_template_id: null,
    ledger_version: null,
    benchmark_version: null,
    generation_snapshot_id: null,
    approved_revision: null,
    blocks: [persistedBlock({
      artifactId,
      blockId: options.blockId,
      revision: options.blockRevision,
      objective: options.objective,
      completed: options.completed,
    })],
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  };
}

function receipt() {
  return {
    contractVersion: "ted-artifact-mutation.1" as const,
    status: "committed" as const,
    operationId: "c5000000-0000-4000-8000-000000000001",
    mutationKind: "block_payload" as const,
    artifactId: ARTIFACT_A,
    acceptedArtifactRevision: 1,
    artifactRevision: 2,
    artifactStatus: "needs_review" as const,
    artifactApprovedRevision: null,
    blockId: BLOCK_A,
    acceptedBlockRevision: 1,
    blockRevision: 2,
    ledgerBindingStatus: "legacy_unversioned" as const,
    sectionState: null,
    approvalStatus: "draft" as const,
    approvedRevision: null,
    idempotentReplay: false,
  };
}

describe("useArtifact durable revision truth", () => {
  beforeEach(() => {
    recordBrowserPrincipal(USER_ID);
    mocks.auth = { user: { id: USER_ID }, loading: false };
    mocks.fetchArtifactByOutcome.mockReset();
    mocks.saveArtifactBlockRevision.mockReset();
    mocks.setArtifactBlockCompleted.mockReset();
  });

  afterEach(() => recordBrowserPrincipal(undefined));

  it("keeps old wording visible until the exact mutation receipt and reload succeed", async () => {
    const original = persistedArtifact();
    const revised = persistedArtifact({
      artifactRevision: 2,
      blockRevision: 2,
      objective: "Durably revised objective",
    });
    mocks.fetchArtifactByOutcome
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(revised);
    let resolveSave!: (value: ReturnType<typeof receipt>) => void;
    mocks.saveArtifactBlockRevision.mockReturnValue(new Promise((resolve) => {
      resolveSave = resolve;
    }));
    const { result } = renderHook(() => useArtifact(OUTCOME_A));
    await waitFor(() => expect(result.current.artifact?.id).toBe(ARTIFACT_A));

    let first!: Promise<void>;
    act(() => {
      first = result.current.updateBlockPayload(BLOCK_A, {
        title: "Act",
        objective: "Durably revised objective",
      });
    });
    expect(result.current.artifact?.blocks[0]?.payload).toMatchObject({
      objective: "Original objective",
    });
    expect(result.current.savingBlockId).toBe(BLOCK_A);
    await expect(result.current.updateBlockPayload(BLOCK_A, {
      title: "Act",
      objective: "Duplicate dispatch",
    })).rejects.toThrow("ARTIFACT_MUTATION_IN_PROGRESS");
    expect(mocks.saveArtifactBlockRevision).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSave(receipt());
      await first;
    });
    expect(result.current.artifact).toEqual(revised);
    expect(result.current.savingBlockId).toBeNull();
    expect(result.current.saveError).toBeNull();
  });

  it("reconciles a lost response but keeps the save status visibly unconfirmed", async () => {
    const original = persistedArtifact();
    const authoritative = persistedArtifact({
      artifactRevision: 2,
      blockRevision: 2,
      objective: "Server committed before response loss",
    });
    mocks.fetchArtifactByOutcome
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(authoritative);
    mocks.saveArtifactBlockRevision.mockRejectedValue(new Error("response lost"));
    const { result } = renderHook(() => useArtifact(OUTCOME_A));
    await waitFor(() => expect(result.current.artifact?.id).toBe(ARTIFACT_A));

    await act(async () => {
      await expect(result.current.updateBlockPayload(BLOCK_A, {
        title: "Act",
        objective: "Server committed before response loss",
      })).rejects.toThrow("response lost");
    });
    expect(result.current.artifact).toEqual(authoritative);
    expect(result.current.saveError).toMatch(/could not confirm/i);
  });

  it("does not show completion before commit and reloads the advanced parent revision", async () => {
    const original = persistedArtifact();
    const completed = persistedArtifact({
      artifactRevision: 2,
      blockRevision: 2,
      completed: true,
    });
    mocks.fetchArtifactByOutcome
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(completed);
    let resolveCompletion!: (value: PersistedTedArtifactBlock) => void;
    mocks.setArtifactBlockCompleted.mockReturnValue(new Promise((resolve) => {
      resolveCompletion = resolve;
    }));
    const originalBlock = original.blocks[0];
    const completedBlock = completed.blocks[0];
    if (!originalBlock || !completedBlock) throw new Error("test artifact block missing");
    const { result } = renderHook(() => useArtifact(OUTCOME_A));
    await waitFor(() => expect(result.current.artifact?.id).toBe(ARTIFACT_A));

    let operation!: Promise<void>;
    act(() => {
      operation = result.current.toggleBlock(originalBlock);
    });
    expect(result.current.artifact?.blocks[0]?.completed_at).toBeNull();
    await act(async () => {
      resolveCompletion(completedBlock);
      await operation;
    });
    expect(result.current.artifact?.current_revision).toBe(2);
    expect(result.current.artifact?.blocks[0]?.completed_at).not.toBeNull();
  });

  it("does not convert a signed read failure into an absent artifact", async () => {
    mocks.fetchArtifactByOutcome.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useArtifact(OUTCOME_A));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.artifact).toBeNull();
    expect(result.current.loadError).toMatch(/could not confirm/i);
  });

  it("never lets a delayed outcome-A load replace outcome B", async () => {
    let resolveA!: (value: PersistedTedArtifact) => void;
    mocks.fetchArtifactByOutcome.mockImplementation((outcomeId: string) => {
      if (outcomeId === OUTCOME_A) {
        return new Promise<PersistedTedArtifact>((resolve) => { resolveA = resolve; });
      }
      return Promise.resolve(persistedArtifact({
        outcomeId: OUTCOME_B,
        artifactId: ARTIFACT_B,
        blockId: BLOCK_B,
      }));
    });
    const { result, rerender } = renderHook(
      ({ outcomeId }) => useArtifact(outcomeId),
      { initialProps: { outcomeId: OUTCOME_A } },
    );

    rerender({ outcomeId: OUTCOME_B });
    await waitFor(() => expect(result.current.artifact?.id).toBe(ARTIFACT_B));
    await act(async () => {
      resolveA(persistedArtifact());
      await Promise.resolve();
    });
    expect(result.current.artifact?.id).toBe(ARTIFACT_B);
  });
});
