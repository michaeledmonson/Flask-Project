import Link from "next/link";
import { notFound } from "next/navigation";

import OutbreakCard, { formatDate } from "@/components/OutbreakCard";
import TierBadge from "@/components/TierBadge";
import { explainRating } from "@/lib/explain";
import { getChainDetail } from "@/lib/queries";
import { TREND_ARROWS } from "@/lib/scoring";

export const dynamic = "force-dynamic";

const GROUP_BLURBS = {
  direct: "Reporting on these outbreaks names this chain directly.",
  supplier:
    "A company implicated in these outbreaks is listed as a supplier to this chain.",
  ingredient:
    "These outbreaks affect ingredients this chain is known to use, though nothing ties them to the chain specifically.",
} as const;

export default async function ChainPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const detail = await getChainDetail(slug);
  if (!detail) notFound();

  const { chain, tier, trend, groups, lastUpdated, caveat } = detail;
  const active = groups.flatMap((g) => g.evidence.map((e) => e.outbreak));

  return (
    <div className="px-4 pt-4">
      <Link href="/" className="text-sm text-stone-500 hover:underline">
        ← All restaurants
      </Link>

      <header className="mt-3">
        <h1 className="text-2xl font-bold tracking-tight">{chain.name}</h1>

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
          {explainRating(tier, active, chain.name)}
        </p>
      </section>

      {groups.map((group) => (
        <section key={group.signal} className="mt-6">
          <h2 className="text-sm font-semibold">{group.heading}</h2>
          <p className="mt-0.5 text-xs text-stone-500">{GROUP_BLURBS[group.signal]}</p>
          <div className="mt-2 space-y-3">
            {group.evidence.map((e) => (
              <OutbreakCard key={e.outbreak.id} outbreak={e.outbreak} />
            ))}
          </div>
        </section>
      ))}

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          Suppliers on file
        </h2>
        <p className="mt-1 text-sm text-stone-700">
          {chain.suppliers.length > 0 ? chain.suppliers.join(", ") : "None on file."}
        </p>
        <p className="mt-2 rounded-md bg-stone-100 p-2 text-xs italic leading-relaxed text-stone-600">
          {caveat}
        </p>
      </section>
    </div>
  );
}
