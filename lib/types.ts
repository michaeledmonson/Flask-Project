// Shared row & config shapes. Kept dependency-free so lib/scoring.ts stays pure.

export type Category =
  | "produce"
  | "dairy-eggs"
  | "meat-poultry"
  | "seafood"
  | "packaged"
  | "other";

export type Tier = "very-low" | "low" | "moderate" | "high" | "very-high";

export type Trend = "rising" | "falling" | "steady";

/** 1 official · 2 established outlet · 3 other */
export type SourceTier = 1 | 2 | 3;

/** 1 recall only · 2 illnesses · 3 hospitalizations/deaths or multi-state */
export type Severity = 1 | 2 | 3;

export interface Food {
  slug: string;
  name: string;
  category: Category;
  aliases: string[];
}

export interface Chain {
  slug: string;
  name: string;
  suppliers: string[];
  key_ingredients: string[];
}

export interface ReportRow {
  id: number;
  outbreak_id: number;
  url: string;
  source_name: string;
  source_tier: SourceTier;
  headline: string;
  published_at: string;
}

export interface OutbreakRow {
  id: number;
  food_slug: string;
  pathogen: string;
  title: string;
  summary: string;
  brands: string[];
  states: string[];
  severity: Severity;
  chains_mentioned: string[];
  first_reported_at: string;
  last_reported_at: string;
  created_at: string;
}

export interface OutbreakWithReports extends OutbreakRow {
  reports: ReportRow[];
}

/** A scored row as the UI consumes it. */
export interface ScoredOutbreak extends OutbreakWithReports {
  score: number;
  confidence: number;
  decay: number;
  daysSinceLastReport: number;
  active: boolean;
}

/** Row shape shared by the Groceries and Restaurants lists (DESIGN.md §8). */
export interface ListItem {
  slug: string;
  name: string;
  category: Category | null;
  tier: Tier;
  trend: Trend;
  activeOutbreakCount: number;
  latestHeadline: string | null;
  /** §6 relevance: an active outbreak is nationwide, or lists the chosen state. */
  relevantToState: boolean;
  /**
   * An active outbreak names the chosen state explicitly. Drives the "· reported in
   * NY" row marker — `relevantToState` includes nationwide events, which would put
   * the marker on nearly every row.
   */
  namedInState: boolean;
}
