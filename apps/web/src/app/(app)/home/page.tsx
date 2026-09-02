import { HomeScreen } from "./HomeScreen";
import { loadHomeIntakeInitialState } from "@/lib/home-intake-initial-state.server";

export default async function HomePage() {
  const initialState = await loadHomeIntakeInitialState();
  // Fast-lane items load in Layer 7 (Library); empty for now (new-user view).
  return <HomeScreen fastLaneItems={[]} initialState={initialState} />;
}
