import { createClient } from "@/lib/supabase/server";
import { adaptWorkspaceSnapshotV1, type WorkspaceInitialState } from "./workspace-initial-state";

const EMPTY_TRUTH: WorkspaceInitialState["truth"] = {
  authenticated: false,
  ownerUserId: null,
  persistence: "anonymous",
  documentId: null,
  currentRevision: null,
  approvedRevision: null,
  ledgerBindingStatus: null,
  ledgerVersion: null,
  operationId: null,
  operationRevision: null,
  operationStatus: null,
  operationMessage: null,
  safeNextAction: null,
  persistedAt: null,
};

function unavailable(authenticated: boolean, ownerUserId: string | null = null): WorkspaceInitialState {
  return {
    workspace: null,
    intake: null,
    truth: {
      ...EMPTY_TRUTH,
      authenticated,
      ownerUserId,
      persistence: "unavailable",
    },
  };
}

interface SnapshotRpcResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

/**
 * Loads all critical workspace truth from one versioned, owner-bound database
 * statement. Authentication remains a separate Supabase Auth operation; no
 * table read is allowed to escape the transactional snapshot RPC.
 */
export async function loadWorkspaceInitialState(outcomeId: string): Promise<WorkspaceInitialState> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();

  if (authError) return unavailable(false);
  if (!auth.user) return { workspace: null, intake: null, truth: EMPTY_TRUTH };

  try {
    const rpc = supabase.rpc as unknown as (
      name: "get_workspace_snapshot_v1",
      args: { p_outcome_id: string; p_active_section_id: string | null },
    ) => Promise<SnapshotRpcResult>;
    const { data, error } = await rpc("get_workspace_snapshot_v1", {
      p_outcome_id: outcomeId,
      p_active_section_id: null,
    });
    if (error || data === null) return unavailable(true, auth.user.id);
    return adaptWorkspaceSnapshotV1(data, auth.user.id);
  } catch {
    return unavailable(true, auth.user.id);
  }
}
