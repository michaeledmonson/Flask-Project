import Link from "next/link";

import TierBadge from "@/components/TierBadge";
import type { Tier } from "@/lib/types";

export const metadata = { title: "How this works — Is My Food Safe?" };

const TIERS: { tier: Tier; meaning: string }[] = [
  { tier: "very-high", meaning: "A serious, well-documented outbreak is happening right now." },
  { tier: "high", meaning: "An active outbreak with confirmed illnesses or an official recall." },
  { tier: "moderate", meaning: "Something is going on — a recall, or credible reports worth knowing about." },
  { tier: "low", meaning: "An older or lightly-sourced event that hasn't fully faded yet." },
  { tier: "very-low", meaning: "Nothing active on file. This is where most foods sit most of the time." },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-1.5 space-y-2 text-sm leading-relaxed text-stone-700">
        {children}
      </div>
    </section>
  );
}

export default function AboutPage() {
  return (
    <div className="px-4 pt-4">
      <Link href="/" className="text-sm text-stone-500 hover:underline">
        ← Back
      </Link>

      <h1 className="mt-3 text-2xl font-bold tracking-tight">How this works</h1>
      <p className="mt-2 text-sm leading-relaxed text-stone-700">
        This site tries to answer one question: is the food in your kitchen — or on the
        menu tonight — caught up in a foodborne illness outbreak right now? It gathers
        what US regulators and news outlets are reporting, and turns it into a single
        risk rating per item.
      </p>

      <Section title="Where the information comes from">
        <p>
          Once a day the site reads federal recall and outbreak feeds from the FDA and
          CDC, then a set of food-safety and general news feeds. Each item it finds is
          filed against a food and an outbreak.
        </p>
        <p>Every source is labelled by how much weight it carries:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Official</strong> — a recall notice or investigation update from a
            government agency.
          </li>
          <li>
            <strong>News</strong> — an established outlet with a track record on food
            safety.
          </li>
          <li>
            <strong>Unverified</strong> — everything else. Visible, but never enough on
            its own to raise an item above Moderate.
          </li>
        </ul>
        <p>
          Every rating links to the reports behind it. If a rating looks surprising, open
          the sources and judge for yourself.
        </p>
      </Section>

      <Section title="How a rating is calculated">
        <p>Three things decide an outbreak&apos;s weight:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Severity</strong> — a recall with no illnesses counts for less than
            one with hospitalizations or deaths, or one spread across several states.
          </li>
          <li>
            <strong>Sourcing</strong> — an official notice counts fully; two independent
            outlets nearly as much; a single unverified article, much less.
          </li>
          <li>
            <strong>Recency</strong> — an outbreak&apos;s weight halves every 30 days it
            goes unreported. Fresh reporting resets that clock. After about four quiet
            months it stops counting altogether and moves to &ldquo;Past events&rdquo;.
          </li>
        </ul>
        <p>
          When a food has several outbreaks at once, they compound: two moderate problems
          add up to more concern than either alone. The arrow beside a rating compares it
          against the same food a week ago.
        </p>
      </Section>

      <Section title="The scale">
        <ul className="space-y-2">
          {TIERS.map(({ tier, meaning }) => (
            <li key={tier} className="flex items-start gap-2.5">
              <TierBadge tier={tier} />
              <span className="text-sm">{meaning}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Restaurants">
        <p>
          Chains are rated from three kinds of evidence: reporting that names the chain
          directly, recalls involving a company listed as one of its suppliers, and
          outbreaks affecting ingredients it is known to use. The first counts fully, the
          others progressively less.
        </p>
        <p className="italic text-stone-600">
          Supplier relationships are compiled from public reporting and may be incomplete
          or outdated.
        </p>
      </Section>

      <Section title="Your state">
        <p>
          Pick your state once and it is remembered on this device — there are no
          accounts and nothing is sent anywhere. Outbreaks are tracked at the state
          level; nationwide events apply everywhere. Your state changes what is shown to
          you, never the underlying rating.
        </p>
      </Section>

      <Section title="What this is not">
        <p>
          Coverage depends entirely on what has been publicly reported. A Very Low rating
          means nothing has been reported — not that a food is guaranteed safe. Ratings
          are a reading of the news, not a lab result.
        </p>
        <p className="font-medium text-stone-900">
          Informational only — not medical or food-safety advice. Always verify against
          the linked official notices.
        </p>
      </Section>
    </div>
  );
}
