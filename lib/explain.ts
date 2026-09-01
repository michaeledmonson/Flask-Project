// "Why this rating" copy and the per-severity advice blocks (DESIGN.md §9.2).
// Pure string building over already-scored rows.

import { pathogenProse } from "./config.ts";
import { TIER_LABELS } from "./scoring.ts";
import type { ScoredOutbreak, Severity, Tier } from "./types.ts";

function shortDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** How an outbreak is sourced, in the words the rating explanation uses. */
function sourcing(outbreak: ScoredOutbreak): string {
  const official = outbreak.reports.find((r) => r.source_tier === 1);
  if (official) return `official ${official.source_name} notice`;

  const domains = new Set(outbreak.reports.map((r) => r.source_name));
  if (domains.size >= 2) return `reported by ${domains.size} outlets`;

  const single = outbreak.reports[0];
  if (!single) return "no sourcing on file";
  return single.source_tier === 2
    ? `reported by ${single.source_name}`
    : `single unverified report (${single.source_name})`;
}

/** "a" or "an", by the sound the next word starts with. */
function article(next: string): string {
  return /^[aeiou]/i.test(next) ? "an" : "a";
}

function clause(outbreak: ScoredOutbreak): string {
  const pathogen = pathogenProse(outbreak.pathogen);
  const nationwide = outbreak.states.length === 0;
  const scope = nationwide ? "a nationwide" : `${article(pathogen)}`;
  const brand = outbreak.brands[0] ? ` linked to ${outbreak.brands[0]}` : "";

  return `${scope} ${pathogen} outbreak${brand} (${sourcing(outbreak)}, updated ${shortDate(
    outbreak.last_reported_at,
  )})`;
}

function joinClauses(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]}, and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

/**
 * The rating in one sentence, naming the outbreaks that drive it. Shows at most three
 * outbreaks so the sentence stays readable.
 */
export function explainRating(
  tier: Tier,
  active: readonly ScoredOutbreak[],
  subject: string,
): string {
  if (active.length === 0) {
    return `No active outbreaks are on file for ${subject}, so it sits at ${TIER_LABELS[tier]}.`;
  }

  const shown = [...active].sort((a, b) => b.score - a.score).slice(0, 3);
  const rest = active.length - shown.length;
  const count = `${active.length} active outbreak${active.length === 1 ? "" : "s"}`;
  const tail = rest > 0 ? `, plus ${rest} more` : "";

  const capped =
    active.every((o) => o.confidence <= 0.4) && active.length > 0
      ? " The rating is held at Moderate because every report is single-sourced and unverified."
      : "";

  return `${count}: ${joinClauses(shown.map(clause))}${tail}.${capped}`;
}

/** Static advice, keyed to the most serious active outbreak (§9.2). */
export const ADVICE: Record<Severity, { heading: string; points: string[] }> = {
  1: {
    heading: "A recall is in effect, but no illnesses have been reported.",
    points: [
      "Check brand names and lot codes on anything you already have at home against the official notice.",
      "Recalled product should be thrown out or returned to the store for a refund — don't eat it, even if it looks and smells fine.",
      "Wash anything the recalled product touched with hot soapy water.",
    ],
  },
  2: {
    heading: "People have gotten sick from this product.",
    points: [
      "Check brand names and lot codes against the official notice and discard any match.",
      "Don't try to make the product safe by washing it; for produce and ready-to-eat items, throw it out.",
      "Clean the fridge shelves, containers, and surfaces the product touched.",
      "See a doctor if you have diarrhea lasting more than three days, a fever over 102°F, bloody stools, or signs of dehydration.",
    ],
  },
  3: {
    heading: "This outbreak has caused hospitalizations, deaths, or has spread across states.",
    points: [
      "Discard any matching product now — don't wait to confirm the lot code if you can't read it.",
      "Take extra care if you're pregnant, over 65, under 5, or immunocompromised — these infections are far more dangerous in those groups.",
      "Sanitize the fridge, containers, and any surface the product touched.",
      "Seek medical care promptly for fever, stiff neck, confusion, bloody diarrhea, or dehydration, and mention the outbreak.",
    ],
  },
};

export function adviceFor(active: readonly ScoredOutbreak[]) {
  if (active.length === 0) return null;
  const worst = Math.max(...active.map((o) => o.severity)) as Severity;
  return ADVICE[worst] ?? ADVICE[2];
}
