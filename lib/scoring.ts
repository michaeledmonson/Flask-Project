// Risk scoring — DESIGN.md §6 and §7.
//
// Every function here is pure: given the same rows and the same `asOf` instant it
// returns the same answer. Nothing is cached or persisted; the whole model is
// recomputed at read time. This is the only unit-tested module in the project.

import type { Severity, Tier, Trend } from "./types.ts";

export const HALF_LIFE_DAYS = 30;
/** Below this decay factor an outbreak is dormant (~4+ months quiet). */
export const INACTIVE_DECAY = 0.05;
export const TREND_LOOKBACK_DAYS = 7;
/** Relative growth in R that counts as a trend when the tier itself didn't move. */
export const TREND_RELATIVE_DELTA = 0.25;
/** An outbreak sourced only this weakly can never push an item past Moderate. */
export const LOW_CONFIDENCE = 0.4;

const MS_PER_DAY = 86_400_000;

/** Minimal report shape scoring needs — real `ReportRow`s satisfy it. */
export interface ScorableReport {
  url: string;
  source_tier: number;
  published_at: string | Date;
}

/** Minimal outbreak shape scoring needs — real `OutbreakRow`s satisfy it. */
export interface ScorableOutbreak {
  severity: number;
  last_reported_at: string | Date;
  reports: ScorableReport[];
}

export interface OutbreakScore {
  /** S = (severity / 3) × C × D, in (0, 1]. */
  score: number;
  /** C — how well-sourced the outbreak is. */
  confidence: number;
  /** D — recency decay. */
  decay: number;
  daysSinceLastReport: number;
  /** False once D < 0.05: excluded from scoring and from "active" lists. */
  active: boolean;
}

function toTime(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * Registrable domain, near enough: the last two labels of the host. Used to tell
 * "two independent outlets" from "the same outlet twice".
 */
export function domainOf(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const labels = host.split(".");
    return labels.length > 2 ? labels.slice(-2).join(".") : host;
  } catch {
    return url.toLowerCase();
  }
}

/**
 * C — confidence, from how the outbreak is sourced:
 *   1.0  any tier-1 report (official recall/alert)
 *   0.85 ≥2 independent tier-2/3 sources (distinct domains)
 *   0.7  single tier-2 report
 *   0.4  single tier-3 report
 */
export function confidenceOf(reports: readonly ScorableReport[]): number {
  if (reports.length === 0) return 0;
  if (reports.some((r) => r.source_tier === 1)) return 1;

  const domains = new Set(reports.map((r) => domainOf(r.url)));
  if (domains.size >= 2) return 0.85;

  return reports.some((r) => r.source_tier === 2) ? 0.7 : LOW_CONFIDENCE;
}

/** D — 30-day half-life on time since the outbreak was last reported on. */
export function decayOf(lastReportedAt: string | Date, asOf: Date): number {
  const days = Math.max(0, (asOf.getTime() - toTime(lastReportedAt)) / MS_PER_DAY);
  return Math.pow(0.5, days / HALF_LIFE_DAYS);
}

/** S for a single outbreak, plus the pieces the UI shows when explaining a rating. */
export function scoreOutbreak(
  outbreak: ScorableOutbreak,
  asOf: Date = new Date(),
): OutbreakScore {
  const confidence = confidenceOf(outbreak.reports);
  const decay = decayOf(outbreak.last_reported_at, asOf);
  const days = Math.max(
    0,
    (asOf.getTime() - toTime(outbreak.last_reported_at)) / MS_PER_DAY,
  );
  const severity = Math.min(3, Math.max(1, outbreak.severity));

  return {
    score: (severity / 3) * confidence * decay,
    confidence,
    decay,
    daysSinceLastReport: days,
    active: decay >= INACTIVE_DECAY,
  };
}

/**
 * Probabilistic OR: R = 1 − Π(1 − Sᵢ). Concurrent outbreaks compound rather than
 * the worst one simply winning.
 */
export function combineScores(scores: readonly number[]): number {
  let inverse = 1;
  for (const s of scores) {
    inverse *= 1 - Math.min(1, Math.max(0, s));
  }
  return 1 - inverse;
}

const TIER_ORDER: Tier[] = ["very-low", "low", "moderate", "high", "very-high"];

export function tierRank(tier: Tier): number {
  return TIER_ORDER.indexOf(tier);
}

/** Raw R → tier, before the trust cap. */
export function rawTier(r: number): Tier {
  if (r >= 0.6) return "very-high";
  if (r >= 0.4) return "high";
  if (r >= 0.2) return "moderate";
  if (r >= 0.07) return "low";
  return "very-low";
}

/**
 * Tier for a combined R, applying the trust cap: if every contributing outbreak is
 * single-low-tier-sourced (C ≤ 0.4), the item is capped at Moderate however high R
 * climbs.
 */
export function tierFor(r: number, confidences: readonly number[]): Tier {
  const tier = rawTier(r);
  const cappable =
    confidences.length > 0 && confidences.every((c) => c <= LOW_CONFIDENCE);
  if (cappable && tierRank(tier) > tierRank("moderate")) return "moderate";
  return tier;
}

/** One outbreak's contribution to an aggregate, with §7's chain weighting. */
export interface WeightedOutbreak {
  outbreak: ScorableOutbreak;
  /** 1 direct · 0.8 supplier match · 0.5 ingredient exposure. */
  weight?: number;
}

export interface AggregateRisk {
  /** R — combined risk, in [0, 1]. */
  r: number;
  tier: Tier;
  trend: Trend;
  /** Scores of the active contributors, in the order given. */
  contributions: OutbreakScore[];
  activeCount: number;
}

function riskAt(entries: readonly WeightedOutbreak[], asOf: Date) {
  const scores: number[] = [];
  const confidences: number[] = [];
  const contributions: OutbreakScore[] = [];

  for (const { outbreak, weight = 1 } of entries) {
    const scored = scoreOutbreak(outbreak, asOf);
    if (!scored.active) continue;
    contributions.push(scored);
    scores.push(scored.score * weight);
    confidences.push(scored.confidence);
  }

  const r = combineScores(scores);
  return { r, tier: tierFor(r, confidences), contributions };
}

/**
 * Rewinds an outbreak by `days`: reports published inside the window are dropped and
 * `last_reported_at` falls back to the newest surviving report. Returns null when
 * nothing survives — the outbreak hadn't been reported yet.
 */
function rewind(
  outbreak: ScorableOutbreak,
  asOf: Date,
  days: number,
): ScorableOutbreak | null {
  const cutoff = asOf.getTime() - days * MS_PER_DAY;
  const reports = outbreak.reports.filter((r) => toTime(r.published_at) <= cutoff);
  if (reports.length === 0) return null;

  const lastReported = Math.max(...reports.map((r) => toTime(r.published_at)));
  return {
    severity: outbreak.severity,
    last_reported_at: new Date(lastReported),
    reports,
  };
}

/**
 * Trend: R recomputed as of 7 days ago over the same rows, ignoring reports newer
 * than the cutoff. Rising if the tier moved up or R grew by more than 25% relative.
 *
 * Note this compares the item as it *was* — severity is carried back unchanged
 * because the schema keeps no severity history (DESIGN.md §11: no history tables).
 */
export function trendBetween(current: number, previous: number, currentTier: Tier, previousTier: Tier): Trend {
  const tierDelta = tierRank(currentTier) - tierRank(previousTier);
  if (tierDelta > 0) return "rising";
  if (tierDelta < 0) return "falling";

  if (previous <= 0) return current > 0 ? "rising" : "steady";
  const relative = (current - previous) / previous;
  if (relative > TREND_RELATIVE_DELTA) return "rising";
  if (relative < -TREND_RELATIVE_DELTA) return "falling";
  return "steady";
}

/**
 * The whole §6 model for one item (a food, or a chain once its outbreaks carry §7
 * weights): combined risk, tier with trust cap applied, and trend.
 */
export function aggregateRisk(
  entries: readonly WeightedOutbreak[],
  asOf: Date = new Date(),
): AggregateRisk {
  const now = riskAt(entries, asOf);

  const rewound: WeightedOutbreak[] = [];
  for (const entry of entries) {
    const past = rewind(entry.outbreak, asOf, TREND_LOOKBACK_DAYS);
    if (past) rewound.push({ outbreak: past, weight: entry.weight });
  }
  const then = riskAt(rewound, new Date(asOf.getTime() - TREND_LOOKBACK_DAYS * MS_PER_DAY));

  return {
    r: now.r,
    tier: now.tier,
    trend: trendBetween(now.r, then.r, now.tier, then.tier),
    contributions: now.contributions,
    activeCount: now.contributions.length,
  };
}

export const TIER_LABELS: Record<Tier, string> = {
  "very-low": "Very Low",
  low: "Low",
  moderate: "Moderate",
  high: "High",
  "very-high": "Very High",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  1: "Recall only — no illnesses reported",
  2: "Illnesses reported",
  3: "Hospitalizations, deaths, or a multi-state outbreak",
};

export const TREND_ARROWS: Record<Trend, string> = {
  rising: "↑",
  falling: "↓",
  steady: "→",
};
