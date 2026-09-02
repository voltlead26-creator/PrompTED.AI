import { HomeScreen } from "../home/HomeScreen";
import { loadHomeIntakeInitialState } from "@/lib/home-intake-initial-state.server";

export default async function CreatePage() {
  const initialState = await loadHomeIntakeInitialState();
  return <HomeScreen initialState={initialState} />;
}
