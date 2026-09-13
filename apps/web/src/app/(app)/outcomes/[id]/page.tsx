import { WorkspaceScreen } from "./WorkspaceScreen";
import { loadWorkspaceInitialState } from "@/lib/workspace-initial-state.server";
import { redirect } from "next/navigation";
import { resolveManualPlanRoute } from "../manual-plan-route.server";

export default async function OutcomePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const route = await resolveManualPlanRoute(id);
  if (route.kind === "manual") redirect(`/plans?create=manual&plan=${encodeURIComponent(route.planId)}`);
  if (route.kind === "unavailable") return <section role="alert"><p>Couldn’t open this outcome. Retry to load its saved version.</p><a href={`/outcomes/${encodeURIComponent(id)}`}>Retry opening outcome</a></section>;
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
