"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PersistedTedArtifact,
  PersistedTedArtifactBlock,
  TedArtifactBlock,
} from "@prompted/shared/artifacts";
import {
  fetchArtifactByOutcome,
  saveArtifactBlockRevision,
  setArtifactBlockCompleted,
} from "@/lib/api/artifacts";
import { useAuth } from "@/components/providers";
import {
  captureOwnerDispatch,
  ownerDispatchIsCurrent,
  type OwnerDispatchLease,
} from "@/lib/browser-principal-state";

export function useArtifact(outcomeId: string) {
  const { user, loading: authLoading } = useAuth();
  const [artifact, setArtifact] = useState<PersistedTedArtifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingBlockId, setSavingBlockId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const loadEpochRef = useRef(0);
  const activeMutationRef = useRef<{
    key: string;
    lease: OwnerDispatchLease;
  } | null>(null);

  const load = useCallback(async (
    existingLease?: OwnerDispatchLease,
  ): Promise<PersistedTedArtifact | null> => {
    const loadEpoch = ++loadEpochRef.current;
    if (authLoading) return null;
    if (!user?.id) {
      setArtifact(null);
      setLoading(false);
      setLoadError(null);
      return null;
    }
    const requestContext = existingLease ?? captureOwnerDispatch(user.id);
    setLoading(true);
    try {
      const next = await fetchArtifactByOutcome(outcomeId, requestContext);
      requestContext.assertCurrent();
      if (loadEpoch !== loadEpochRef.current) return next;
      setArtifact(next);
      setLoadError(null);
      return next;
    } catch (error) {
      if (
        loadEpoch === loadEpochRef.current &&
        ownerDispatchIsCurrent(requestContext)
      ) {
        setLoadError("TED could not confirm this plan's saved revision. Retry before editing it.");
      }
      throw error;
    } finally {
      if (
        loadEpoch === loadEpochRef.current &&
        ownerDispatchIsCurrent(requestContext)
      ) setLoading(false);
    }
  }, [authLoading, outcomeId, user?.id]);

  useEffect(() => {
    activeMutationRef.current = null;
    setSavingBlockId(null);
    setSaveError(null);
    void load().catch(() => undefined);
  }, [load]);

  function beginMutation(
    blockId: string,
    kind: "payload" | "completion",
  ): { key: string; lease: OwnerDispatchLease } {
    if (!user?.id) throw new Error("ARTIFACT_AUTHENTICATION_REQUIRED");
    if (activeMutationRef.current) {
      throw new Error("ARTIFACT_MUTATION_IN_PROGRESS");
    }
    const lease = captureOwnerDispatch(user.id);
    const operation = {
      key: `${kind}:${outcomeId}:${blockId}:${lease.principalEpoch}`,
      lease,
    };
    activeMutationRef.current = operation;
    setSavingBlockId(blockId);
    setSaveError(null);
    return operation;
  }

  function finishMutation(operation: { key: string; lease: OwnerDispatchLease }) {
    if (activeMutationRef.current?.key !== operation.key) return;
    activeMutationRef.current = null;
    if (ownerDispatchIsCurrent(operation.lease)) setSavingBlockId(null);
  }

  async function toggleBlock(block: PersistedTedArtifactBlock) {
    if (!artifact || block.artifact_id !== artifact.id) {
      throw new Error("ARTIFACT_BLOCK_UNAVAILABLE");
    }
    const operation = beginMutation(block.id, "completion");
    const requestContext = operation.lease;
    const completed = !block.completed_at;
    try {
      await setArtifactBlockCompleted(block, completed, requestContext);
      requestContext.assertCurrent();
      const persisted = await load(requestContext);
      const persistedBlock = persisted?.blocks.find((item) => item.id === block.id);
      if (
        !persisted || !persistedBlock ||
        persisted.current_revision !== artifact.current_revision + 1 ||
        persistedBlock.revision !== block.revision + 1 ||
        Boolean(persistedBlock.completed_at) !== completed
      ) throw new Error("ARTIFACT_COMPLETION_RECONCILIATION_FAILED");
      setSaveError(null);
    } catch (error) {
      if (ownerDispatchIsCurrent(requestContext)) {
        try { await load(requestContext); } catch { /* keep uncertainty visible */ }
        setSaveError("TED could not confirm that progress change. The latest saved plan is shown; retry if needed.");
      }
      throw error;
    } finally {
      finishMutation(operation);
    }
  }

  async function updateBlockPayload(
    blockId: string,
    payload: TedArtifactBlock["payload"],
  ): Promise<void> {
    if (!artifact) throw new Error("ARTIFACT_UNAVAILABLE");
    const block = artifact.blocks.find((item) => item.id === blockId);
    if (!block) throw new Error("ARTIFACT_BLOCK_UNAVAILABLE");
    const operation = beginMutation(blockId, "payload");
    const requestContext = operation.lease;
    try {
      const receipt = await saveArtifactBlockRevision({
        artifactId: artifact.id,
        blockId,
        expectedArtifactRevision: artifact.current_revision,
        expectedBlockRevision: block.revision,
        payload,
        sectionState: block.ledger_binding_status === "captured"
          ? block.section_state
          : null,
      }, requestContext);
      requestContext.assertCurrent();
      const persisted = await load(requestContext);
      const persistedBlock = persisted?.blocks.find((item) => item.id === blockId);
      if (
        !persisted || !persistedBlock ||
        persisted.current_revision !== receipt.artifactRevision ||
        persistedBlock.revision !== receipt.blockRevision
      ) throw new Error("ARTIFACT_BLOCK_MUTATION_SUPERSEDED");
      setSaveError(null);
    } catch (error) {
      if (ownerDispatchIsCurrent(requestContext)) {
        try { await load(requestContext); } catch { /* keep uncertainty visible */ }
        setSaveError("TED could not confirm that wording change. Review the latest saved step and try again.");
      }
      throw error;
    } finally {
      finishMutation(operation);
    }
  }

  return {
    artifact,
    loading,
    savingBlockId,
    loadError,
    saveError,
    reload: load,
    toggleBlock,
    updateBlockPayload,
  };
}
