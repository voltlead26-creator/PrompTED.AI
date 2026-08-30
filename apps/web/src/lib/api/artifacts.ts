import type { TedArtifact, TedArtifactBlock, TedSupportingReference } from "@prompted/shared";
import { createClient } from "@/lib/supabase/client";

export async function saveArtifact(artifact: TedArtifact): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("save_ted_artifact", {
    p_artifact: {
      id: artifact.id,
      outcome_id: artifact.outcome_id,
      kind: artifact.kind,
      title: artifact.title,
      template_id: artifact.template_id,
      schema_version: artifact.schema_version,
      pipeline_version: artifact.pipeline_version,
      status: artifact.status,
      quality_status: artifact.quality_status,
      current_revision: artifact.current_revision,
      request_id: artifact.request_id,
    },
    p_blocks: artifact.blocks,
  });
  if (error) throw error;
  return String(data);
}

export async function fetchArtifactByOutcome(outcomeId: string): Promise<TedArtifact | null> {
  const supabase = createClient();
  const { data: artifact, error } = await supabase
    .from("ted_artifacts")
    .select("*")
    .eq("outcome_id", outcomeId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !artifact) return null;
  const [{ data: blocks }, { data: references }] = await Promise.all([
    supabase.from("ted_artifact_blocks").select("*").eq("artifact_id", artifact.id).order("order_index", { ascending: true }),
    supabase.from("ted_artifact_references").select("*").eq("artifact_id", artifact.id),
  ]);
  const byBlock = new Map<string, TedSupportingReference[]>();
  for (const reference of references ?? []) {
    const list = byBlock.get(reference.block_id) ?? [];
    list.push(reference as TedSupportingReference);
    byBlock.set(reference.block_id, list);
  }
  return {
    ...artifact,
    blocks: (blocks ?? []).map((block) => ({ ...block, references: byBlock.get(block.id) ?? [] })) as TedArtifactBlock[],
  } as TedArtifact;
}

export async function setArtifactBlockCompleted(block: TedArtifactBlock, completed: boolean): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("set_ted_block_completed", {
    p_block_id: block.id,
    p_completed: completed,
    p_expected_revision: block.revision,
  });
  if (error) throw error;
}
