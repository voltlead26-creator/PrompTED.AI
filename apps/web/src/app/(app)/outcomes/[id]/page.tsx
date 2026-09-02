import { WorkspaceScreen } from "./WorkspaceScreen";
import { loadWorkspaceInitialState } from "@/lib/workspace-initial-state.server";

export default async function OutcomePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const initialState = await loadWorkspaceInitialState(id);
  const workspaceIdentity = [
    initialState.truth.ownerUserId ?? "anonymous",
    id,
    initialState.truth.documentId ?? initialState.workspace?.documentId ?? "new",
  ].join(":");
  return (
    <WorkspaceScreen
      key={workspaceIdentity}
      outcomeId={id}
      initialState={initialState}
    />
  );
}
