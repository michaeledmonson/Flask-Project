import Link from "next/link";
import { notFound } from "next/navigation";

import OutbreakCard, { formatDate } from "@/components/OutbreakCard";
import TierBadge from "@/components/TierBadge";
import { CATEGORY_LABELS } from "@/lib/config";
import { adviceFor, explainRating } from "@/lib/explain";
import { getFoodDetail } from "@/lib/queries";
import { TREND_ARROWS } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export default async function FoodPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const detail = await getFoodDetail(slug);
  if (!detail) notFound();

  const { food, tier, trend, active, past, lastUpdated } = detail;
  const advice = adviceFor(active);

  return (
    <div className="px-4 pt-4">
      <Link href="/" className="text-sm text-stone-500 hover:underline">
        ← All foods
      </Link>

      <header className="mt-3">
        <h1 className="text-2xl font-bold tracking-tight">{food.name}</h1>
        <p className="mt-0.5 text-xs text-stone-500">
          {CATEGORY_LABELS[food.category]}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <TierBadge tier={tier} size="lg" />
          <span className="text-sm text-stone-500">
            {TREND_ARROWS[trend]} {trend}
          </span>
          {lastUpdated && (
            <span className="text-xs text-stone-400">
              · last updated {formatDate(lastUpdated)}
            </span>
          )}
        </div>
      </header>

      <section className="mt-4 rounded-lg border border-stone-200 bg-white p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          Why this rating
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed">
          {explainRating(tier, active, food.name.toLowerCase())}
        </p>
      </section>

      {active.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold">
            Active outbreak{active.length === 1 ? "" : "s"}
          </h2>
          <div className="mt-2 space-y-3">
            {active.map((outbreak) => (
              <OutbreakCard key={outbreak.id} outbreak={outbreak} />
            ))}
          </div>
        </section>
      )}

      {advice && (
        <section className="mt-6 rounded-lg border border-stone-300 bg-stone-100 p-3">
          <h2 className="text-sm font-semibold">What you can do</h2>
          <p className="mt-1 text-sm text-stone-700">{advice.heading}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-stone-700">
            {advice.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </section>
      )}

      {past.length > 0 && (
        <details className="mt-6 rounded-lg border border-stone-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-medium text-stone-700">
            Past events{" "}
            <span className="font-normal text-stone-400">({past.length})</span>
          </summary>
          <p className="mt-2 text-xs text-stone-500">
            Older outbreaks that have been quiet long enough to no longer affect the
            rating.
          </p>
          <div className="mt-3 space-y-3">
            {past.map((outbreak) => (
              <OutbreakCard key={outbreak.id} outbreak={outbreak} muted />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
