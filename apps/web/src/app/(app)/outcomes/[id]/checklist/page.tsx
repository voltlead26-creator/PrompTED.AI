import { InteractiveChecklistOutcome } from "./InteractiveChecklistOutcome";

export default async function ChecklistOutcomePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InteractiveChecklistOutcome outcomeId={id} />;
}
