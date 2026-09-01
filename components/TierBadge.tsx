import { TIER_LABELS } from "@/lib/scoring";
import type { Tier } from "@/lib/types";

// The tier word is always inside the pill — colour is never the only signal
// (DESIGN.md §9, colourblind accessibility).
const STYLES: Record<Tier, string> = {
  "very-high": "bg-red-700 text-white",
  high: "bg-orange-600 text-white",
  moderate: "bg-amber-500 text-stone-900",
  low: "bg-lime-600 text-white",
  "very-low": "bg-green-700 text-white",
};

const SIZES = {
  sm: "px-2 py-0.5 text-[11px]",
  lg: "px-3 py-1 text-sm",
} as const;

export default function TierBadge({
  tier,
  size = "sm",
}: {
  tier: Tier;
  size?: keyof typeof SIZES;
}) {
  return (
    <span
      className={`inline-block shrink-0 whitespace-nowrap rounded-full font-semibold ${STYLES[tier]} ${SIZES[size]}`}
    >
      {TIER_LABELS[tier]}
    </span>
  );
}
