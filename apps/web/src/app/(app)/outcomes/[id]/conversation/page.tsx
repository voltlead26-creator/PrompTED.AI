import { ConversationView } from "@/components/organisms/ConversationView";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ConversationView outcomeId={id} />;
}
