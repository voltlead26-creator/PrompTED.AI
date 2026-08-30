import { HomeScreen } from "./HomeScreen";

export default function HomePage() {
  // Fast-lane items load in Layer 7 (Library); empty for now (new-user view).
  return <HomeScreen fastLaneItems={[]} />;
}
