import { WorkspaceScreen } from "./WorkspaceScreen";
import { loadWorkspaceInitialState } from "@/lib/workspace-initial-state.server";

export default async function OutcomePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const initialState = await loadWorkspaceInitialState(id);
  return <WorkspaceScreen outcomeId={id} initialState={initialState} />;
}
