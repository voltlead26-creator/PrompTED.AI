"use client";

import { useCallback, useEffect, useState } from "react";
import type { TedArtifact, TedArtifactBlock } from "@prompted/shared/artifacts";
import {
  fetchArtifactByOutcome,
  saveArtifact,
  setArtifactBlockCompleted,
} from "@/lib/api/artifacts";

export function useArtifact(outcomeId: string) {
  const [artifact, setArtifact] = useState<TedArtifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingBlockId, setSavingBlockId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setArtifact(await fetchArtifactByOutcome(outcomeId));
    setLoading(false);
  }, [outcomeId]);

  useEffect(() => { void load(); }, [load]);

  async function toggleBlock(block: TedArtifactBlock) {
    const completed = !block.completed_at;
    setArtifact((current) => current ? {
      ...current,
      blocks: current.blocks.map((item) => item.id === block.id
        ? { ...item, completed_at: completed ? new Date().toISOString() : null, revision: item.revision + 1 }
        : item),
    } : current);
    try {
      await setArtifactBlockCompleted(block, completed);
    } catch (error) {
      await load();
      throw error;
    }
  }

  async function updateBlockPayload(
    blockId: string,
    payload: TedArtifactBlock["payload"],
  ): Promise<void> {
    if (!artifact || savingBlockId) return;
    const savedAt = new Date().toISOString();
    const next: TedArtifact = {
      ...artifact,
      current_revision: artifact.current_revision + 1,
      blocks: artifact.blocks.map((block) => block.id === blockId
        ? { ...block, payload, revision: block.revision + 1, updated_at: savedAt }
        : block),
    };
    setArtifact(next);
    setSavingBlockId(blockId);
    try {
      await saveArtifact(next);
    } catch (error) {
      await load();
      throw error;
    } finally {
      setSavingBlockId(null);
    }
  }

  return {
    artifact,
    loading,
    savingBlockId,
    reload: load,
    toggleBlock,
    updateBlockPayload,
  };
}
