// Curated config (DESIGN.md §4): foods, chains and feeds live in versioned JSON, not
// in the database, so tuning them is a git commit rather than an admin UI.

import foodsJson from "../data/foods.json" with { type: "json" };
import chainsJson from "../data/chains.json" with { type: "json" };
import sourcesJson from "../data/sources.json" with { type: "json" };

import type { Category, Chain, Food, SourceTier } from "./types.ts";

export const FOODS = foodsJson as Food[];
export const CHAINS = chainsJson as Chain[];

export interface FeedSource {
  id: string;
  name: string;
  kind: "rss" | "fda-enforcement";
  tier: SourceTier;
  url: string;
  domains?: string[];
}

export interface Sources {
  federal: FeedSource[];
  curated: FeedSource[];
  googleNewsQueries: string[];
  trustedDomains: string[];
}

export const SOURCES = sourcesJson as unknown as Sources;

const FOODS_BY_SLUG = new Map(FOODS.map((f) => [f.slug, f]));
const CHAINS_BY_SLUG = new Map(CHAINS.map((c) => [c.slug, c]));

export function findFood(slug: string): Food | undefined {
  return FOODS_BY_SLUG.get(slug);
}

export function findChain(slug: string): Chain | undefined {
  return CHAINS_BY_SLUG.get(slug);
}

/**
 * A food for a slug the extractor proposed but that isn't curated yet: it still works
 * everywhere, it just sits in the `other` category until someone promotes it.
 */
export function foodOrProposed(slug: string): Food {
  return (
    FOODS_BY_SLUG.get(slug) ?? {
      slug,
      name: titleCase(slug),
      category: "other" as Category,
      aliases: [],
    }
  );
}

export function titleCase(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Search over name + aliases (DESIGN.md §4). */
export function foodMatchesQuery(food: Food, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  if (food.name.toLowerCase().includes(needle)) return true;
  if (food.slug.includes(needle.replace(/\s+/g, "-"))) return true;
  return food.aliases.some((a) => a.toLowerCase().includes(needle));
}

export const CATEGORY_LABELS: Record<Category, string> = {
  produce: "Produce",
  "dairy-eggs": "Dairy & Eggs",
  "meat-poultry": "Meat & Poultry",
  seafood: "Seafood",
  packaged: "Packaged",
  other: "Other",
};

/** Filter chips on the Groceries tab, in display order. */
export const FILTER_CATEGORIES: Category[] = [
  "produce",
  "dairy-eggs",
  "meat-poultry",
  "seafood",
  "packaged",
];

export const US_STATES: { code: string; name: string }[] = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" }, { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" },
  { code: "FL", name: "Florida" }, { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" }, { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" }, { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" }, { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" }, { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" }, { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" }, { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" }, { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" }, { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" }, { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" }, { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" }, { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" }, { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
];

export const DEFAULT_STATE = "NY";

export const PATHOGEN_LABELS: Record<string, string> = {
  salmonella: "Salmonella",
  "e-coli": "E. coli",
  listeria: "Listeria",
  cyclospora: "Cyclospora",
  "hepatitis-a": "Hepatitis A",
  norovirus: "Norovirus",
  other: "Other pathogen",
};

export function pathogenLabel(slug: string): string {
  return PATHOGEN_LABELS[slug] ?? titleCase(slug);
}

/**
 * Pathogen name as it reads mid-sentence: lowercase, except where the name is
 * conventionally capitalised ("an E. coli outbreak", "a hepatitis A outbreak").
 */
const PATHOGEN_PROSE: Record<string, string> = {
  salmonella: "salmonella",
  "e-coli": "E. coli",
  listeria: "listeria",
  cyclospora: "cyclospora",
  "hepatitis-a": "hepatitis A",
  norovirus: "norovirus",
  other: "foodborne illness",
};

export function pathogenProse(slug: string): string {
  return PATHOGEN_PROSE[slug] ?? slug.replace(/-/g, " ");
}
