// Reads + scoring assembly. Pages and API routes both come through here so the query
// and scoring logic lives exactly once (DESIGN.md §8).
//
// Active outbreaks number in the dozens, so everything is loaded in two queries and
// scored in memory rather than pushed into SQL.

import { CHAINS, FOODS, foodMatchesQuery, foodOrProposed } from "./config.ts";
import { query } from "./db.ts";
import { aggregateRisk, scoreOutbreak, type WeightedOutbreak } from "./scoring.ts";
import type {
  Category,
  Chain,
  Food,
  ListItem,
  OutbreakRow,
  OutbreakWithReports,
  ReportRow,
  ScoredOutbreak,
  SourceTier,
  Tier,
  Trend,
} from "./types.ts";

/** §7 signal weights. */
export const WEIGHT_DIRECT = 1;
export const WEIGHT_SUPPLIER = 0.8;
export const WEIGHT_INGREDIENT = 0.3;

export type ChainSignal = "direct" | "supplier" | "ingredient";

export const SIGNAL_HEADINGS: Record<ChainSignal, string> = {
  direct: "Named in reporting",
  supplier: "Supplier recall",
  ingredient: "Ingredient risk",
};

const SIGNAL_WEIGHTS: Record<ChainSignal, number> = {
  direct: WEIGHT_DIRECT,
  supplier: WEIGHT_SUPPLIER,
  ingredient: WEIGHT_INGREDIENT,
};

export const SUPPLIER_CAVEAT =
  "Supplier relationships are compiled from public reporting and may be incomplete or outdated.";

/** Every outbreak with its reports attached, newest report first. */
export async function loadOutbreaks(): Promise<OutbreakWithReports[]> {
  const [outbreaks, reports] = await Promise.all([
    query<OutbreakRow>(
      `SELECT id, food_slug, pathogen, title, summary, brands, states, severity,
              chains_mentioned, first_reported_at, last_reported_at, created_at
         FROM outbreaks
        ORDER BY last_reported_at DESC`,
    ),
    query<ReportRow>(
      `SELECT id, outbreak_id, url, source_name, source_tier, headline, published_at
         FROM reports
        ORDER BY published_at DESC`,
    ),
  ]);

  const byOutbreak = new Map<number, ReportRow[]>();
  for (const r of reports) {
    const list = byOutbreak.get(r.outbreak_id);
    if (list) list.push(r);
    else byOutbreak.set(r.outbreak_id, [r]);
  }

  return outbreaks.map((o) => ({ ...o, reports: byOutbreak.get(o.id) ?? [] }));
}

function score(outbreak: OutbreakWithReports, asOf: Date): ScoredOutbreak {
  return { ...outbreak, ...scoreOutbreak(outbreak, asOf) };
}

/** §6: nationwide (`states` empty) or explicitly listing the user's state. */
export function relevantTo(outbreak: OutbreakRow, state: string): boolean {
  if (state === "ALL") return true;
  return outbreak.states.length === 0 || outbreak.states.includes(state);
}

/** Explicitly named — drives the "· reported in NY" row marker (§9). */
export function namedIn(outbreak: OutbreakRow, state: string): boolean {
  return state !== "ALL" && outbreak.states.includes(state);
}

function newestReport(outbreaks: readonly OutbreakWithReports[]): ReportRow | null {
  let best: ReportRow | null = null;
  for (const o of outbreaks) {
    for (const r of o.reports) {
      if (!best || new Date(r.published_at) > new Date(best.published_at)) best = r;
    }
  }
  return best;
}

/**
 * The headline for a list row. When something is happening in the chosen state, that
 * story wins over a more recent nationwide one — otherwise the row can pair a
 * "· in NY" marker with a headline about an outbreak three states away.
 */
function latestHeadlineOf(
  outbreaks: readonly OutbreakWithReports[],
  state: string,
): string | null {
  const named = outbreaks.filter((o) => namedIn(o, state));
  const best = newestReport(named.length > 0 ? named : outbreaks);
  return best?.headline ?? null;
}

interface Ranked {
  item: ListItem;
  r: number;
}

function rank(a: Ranked, b: Ranked): number {
  if (b.r !== a.r) return b.r - a.r;
  return a.item.name.localeCompare(b.item.name);
}

// ── Foods ────────────────────────────────────────────────────────────────────

export interface FoodListFilters {
  q?: string;
  state?: string;
  category?: string;
}

/**
 * All foods, risk-ranked. Includes foods with no active outbreaks (the UI collapses
 * them into "Everything else"); the state filter drops foods whose active outbreaks
 * are all irrelevant to the chosen state.
 */
export async function getFoodList(
  filters: FoodListFilters = {},
  asOf: Date = new Date(),
): Promise<ListItem[]> {
  const outbreaks = await loadOutbreaks();
  return buildFoodList(outbreaks, filters, asOf);
}

/**
 * Best (lowest-numbered) source tier backing a set of outbreaks — 1 official, 2
 * established outlet, 3 unverified. Null when nothing is active.
 */
function bestSourceTier(
  outbreaks: readonly { reports: readonly ReportRow[] }[],
): SourceTier | null {
  let best: SourceTier | null = null;
  for (const o of outbreaks) {
    for (const r of o.reports) {
      if (best === null || r.source_tier < best) best = r.source_tier;
    }
  }
  return best;
}

export function buildFoodList(
  outbreaks: readonly OutbreakWithReports[],
  filters: FoodListFilters = {},
  asOf: Date = new Date(),
): ListItem[] {
  const state = filters.state || "ALL";
  const q = filters.q ?? "";
  const category = filters.category && filters.category !== "all" ? filters.category : null;

  const bySlug = new Map<string, OutbreakWithReports[]>();
  for (const o of outbreaks) {
    const list = bySlug.get(o.food_slug);
    if (list) list.push(o);
    else bySlug.set(o.food_slug, [o]);
  }

  // Curated foods, plus any slug the extractor proposed that isn't curated yet.
  const slugs = new Set<string>(FOODS.map((f) => f.slug));
  for (const slug of bySlug.keys()) slugs.add(slug);

  const ranked: Ranked[] = [];

  for (const slug of slugs) {
    const food: Food = foodOrProposed(slug);
    if (!foodMatchesQuery(food, q)) continue;
    if (category && food.category !== category) continue;

    const all = bySlug.get(slug) ?? [];
    const active = all.filter((o) => score(o, asOf).active);

    if (state !== "ALL" && active.length > 0) {
      const anyRelevant = active.some((o) => relevantTo(o, state));
      if (!anyRelevant) continue;
    }

    const risk = aggregateRisk(
      active.map((outbreak) => ({ outbreak })),
      asOf,
    );

    ranked.push({
      r: risk.r,
      item: {
        slug,
        name: food.name,
        category: food.category,
        tier: risk.tier,
        trend: risk.trend,
        activeOutbreakCount: active.length,
        latestHeadline: latestHeadlineOf(active, state),
        relevantToState: active.some((o) => relevantTo(o, state)),
        namedInState: active.some((o) => namedIn(o, state)),
        sourceTier: bestSourceTier(active),
        topSignal: null,
      },
    });
  }

  return ranked.sort(rank).map((x) => x.item);
}

export interface FoodDetail {
  food: Food;
  tier: Tier;
  trend: Trend;
  r: number;
  active: ScoredOutbreak[];
  past: ScoredOutbreak[];
  lastUpdated: string | null;
}

export async function getFoodDetail(
  slug: string,
  asOf: Date = new Date(),
): Promise<FoodDetail | null> {
  const rows = await query<OutbreakRow>(
    `SELECT id, food_slug, pathogen, title, summary, brands, states, severity,
            chains_mentioned, first_reported_at, last_reported_at, created_at
       FROM outbreaks
      WHERE food_slug = $1
      ORDER BY last_reported_at DESC`,
    [slug],
  );

  // A slug with no outbreaks is still a valid page for any curated food.
  const curated = FOODS.find((f) => f.slug === slug);
  if (rows.length === 0 && !curated) return null;

  const reports = rows.length
    ? await query<ReportRow>(
        `SELECT id, outbreak_id, url, source_name, source_tier, headline, published_at
           FROM reports
          WHERE outbreak_id = ANY($1::int[])
          ORDER BY published_at DESC`,
        [rows.map((r) => r.id)],
      )
    : [];

  const byOutbreak = new Map<number, ReportRow[]>();
  for (const r of reports) {
    const list = byOutbreak.get(r.outbreak_id);
    if (list) list.push(r);
    else byOutbreak.set(r.outbreak_id, [r]);
  }

  const scored = rows.map((o) =>
    score({ ...o, reports: byOutbreak.get(o.id) ?? [] }, asOf),
  );
  const active = scored.filter((o) => o.active).sort((a, b) => b.score - a.score);
  const past = scored.filter((o) => !o.active);

  const risk = aggregateRisk(
    active.map((outbreak) => ({ outbreak })),
    asOf,
  );

  return {
    food: foodOrProposed(slug),
    tier: risk.tier,
    trend: risk.trend,
    r: risk.r,
    active,
    past,
    lastUpdated: active[0]?.last_reported_at ?? scored[0]?.last_reported_at ?? null,
  };
}

// ── Chains ───────────────────────────────────────────────────────────────────

function supplierMatch(brands: readonly string[], suppliers: readonly string[]): boolean {
  return brands.some((brand) => {
    const b = brand.toLowerCase().trim();
    if (!b) return false;
    return suppliers.some((supplier) => {
      const s = supplier.toLowerCase().trim();
      if (!s) return false;
      return b.includes(s) || s.includes(b);
    });
  });
}

export interface ChainEvidence {
  signal: ChainSignal;
  weight: number;
  outbreak: ScoredOutbreak;
}

/**
 * Which outbreaks bear on a chain, and how. An outbreak reaching a chain through more
 * than one signal is counted once, at its strongest weight — otherwise a named chain
 * whose ingredient also matches would be double-counted.
 */
export function chainEvidence(
  chain: Chain,
  outbreaks: readonly OutbreakWithReports[],
  asOf: Date = new Date(),
): ChainEvidence[] {
  const best = new Map<number, ChainEvidence>();

  const consider = (outbreak: OutbreakWithReports, signal: ChainSignal) => {
    const scored = score(outbreak, asOf);
    if (!scored.active) return;
    const weight = SIGNAL_WEIGHTS[signal];
    const existing = best.get(outbreak.id);
    if (!existing || weight > existing.weight) {
      best.set(outbreak.id, { signal, weight, outbreak: scored });
    }
  };

  for (const o of outbreaks) {
    if (o.chains_mentioned.includes(chain.slug)) consider(o, "direct");
    if (supplierMatch(o.brands, chain.suppliers)) consider(o, "supplier");
    if (chain.key_ingredients.includes(o.food_slug)) consider(o, "ingredient");
  }

  return [...best.values()].sort((a, b) => b.weight * b.outbreak.score - a.weight * a.outbreak.score);
}

function weighted(evidence: readonly ChainEvidence[]): WeightedOutbreak[] {
  return evidence.map((e) => ({ outbreak: e.outbreak, weight: e.weight }));
}

export async function getChainList(
  filters: { state?: string; q?: string } = {},
  asOf: Date = new Date(),
): Promise<ListItem[]> {
  const outbreaks = await loadOutbreaks();
  return buildChainList(outbreaks, filters, asOf);
}

export function buildChainList(
  outbreaks: readonly OutbreakWithReports[],
  filters: { state?: string; q?: string } = {},
  asOf: Date = new Date(),
): ListItem[] {
  const state = filters.state || "ALL";
  const needle = (filters.q ?? "").trim().toLowerCase();

  const ranked: Ranked[] = [];

  for (const chain of CHAINS) {
    if (needle && !chain.name.toLowerCase().includes(needle)) continue;

    const evidence = chainEvidence(chain, outbreaks, asOf);

    if (state !== "ALL" && evidence.length > 0) {
      const anyRelevant = evidence.some((e) => relevantTo(e.outbreak, state));
      if (!anyRelevant) continue;
    }

    const risk = aggregateRisk(weighted(evidence), asOf);

    ranked.push({
      r: risk.r,
      item: {
        slug: chain.slug,
        name: chain.name,
        category: null,
        tier: risk.tier,
        trend: risk.trend,
        activeOutbreakCount: evidence.length,
        latestHeadline: latestHeadlineOf(evidence.map((e) => e.outbreak), state),
        relevantToState: evidence.some((e) => relevantTo(e.outbreak, state)),
        namedInState: evidence.some((e) => namedIn(e.outbreak, state)),
        sourceTier: bestSourceTier(evidence.map((e) => e.outbreak)),
        topSignal: evidence[0]?.signal ?? null,
      },
    });
  }

  return ranked.sort(rank).map((x) => x.item);
}

export interface ChainDetail {
  chain: Chain;
  tier: Tier;
  trend: Trend;
  r: number;
  groups: { signal: ChainSignal; heading: string; evidence: ChainEvidence[] }[];
  evidenceCount: number;
  lastUpdated: string | null;
  caveat: string;
}

export async function getChainDetail(
  slug: string,
  asOf: Date = new Date(),
): Promise<ChainDetail | null> {
  const chain = CHAINS.find((c) => c.slug === slug);
  if (!chain) return null;

  const evidence = chainEvidence(chain, await loadOutbreaks(), asOf);
  const risk = aggregateRisk(weighted(evidence), asOf);

  const order: ChainSignal[] = ["direct", "supplier", "ingredient"];
  const groups = order
    .map((signal) => ({
      signal,
      heading: SIGNAL_HEADINGS[signal],
      evidence: evidence.filter((e) => e.signal === signal),
    }))
    .filter((g) => g.evidence.length > 0);

  const lastUpdated = evidence
    .map((e) => e.outbreak.last_reported_at)
    .sort()
    .at(-1) ?? null;

  return {
    chain,
    tier: risk.tier,
    trend: risk.trend,
    r: risk.r,
    groups,
    evidenceCount: evidence.length,
    lastUpdated,
    caveat: SUPPLIER_CAVEAT,
  };
}
