import { InteractiveChecklistOutcome } from "./InteractiveChecklistOutcome";
import { redirect } from "next/navigation";
import { resolveManualPlanRoute } from "../../manual-plan-route.server";

export default async function ChecklistOutcomePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const route = await resolveManualPlanRoute(id);
  if (route.kind === "manual") redirect(`/plans?create=manual&plan=${encodeURIComponent(route.planId)}`);
  if (route.kind === "unavailable") return <section role="alert"><p>Couldn’t open this plan. Retry to load its saved version.</p><a href={`/outcomes/${encodeURIComponent(id)}/checklist`}>Retry opening plan</a></section>;
  return <InteractiveChecklistOutcome outcomeId={id} />;
}
