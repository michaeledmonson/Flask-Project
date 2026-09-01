import HomeView from "@/components/HomeView";
import { DEFAULT_STATE } from "@/lib/config";
import { buildChainList, buildFoodList, loadOutbreaks } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Rendered for the default state so the list is on screen immediately; the client
  // re-fetches only if this device has a different state stored.
  const outbreaks = await loadOutbreaks();

  return (
    <HomeView
      initialFoods={buildFoodList(outbreaks, { state: DEFAULT_STATE })}
      initialChains={buildChainList(outbreaks, { state: DEFAULT_STATE })}
    />
  );
}
