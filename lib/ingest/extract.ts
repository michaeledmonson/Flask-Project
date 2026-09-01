// Step 4 of the pipeline (DESIGN.md §5): Claude Haiku turns feed items into
// structured outbreak records. A tool schema is used so output is strictly typed —
// no JSON parsing out of prose.

import Anthropic from "@anthropic-ai/sdk";

import { CHAINS, FOODS } from "../config.ts";
import type { Severity } from "../types.ts";
import type { FeedItem } from "./feeds.ts";

export const MODEL = "claude-haiku-4-5";
export const BATCH_SIZE = 10;

const PATHOGENS = [
  "salmonella",
  "e-coli",
  "listeria",
  "cyclospora",
  "hepatitis-a",
  "norovirus",
  "other",
] as const;

export interface Extraction {
  relevant: boolean;
  pathogen: string;
  food_slug: string;
  brands: string[];
  states: string[];
  severity: Severity;
  chains_mentioned: string[];
  title: string;
  summary: string;
}

export interface ExtractionResult {
  item: FeedItem;
  extraction: Extraction;
}

const EXTRACTION_SCHEMA = {
  type: "object" as const,
  properties: {
    index: {
      type: "integer",
      description: "The index of the article this record describes.",
    },
    relevant: {
      type: "boolean",
      description:
        "True only if this is a US foodborne illness outbreak, recall, or contamination event affecting food. False for anything else, including non-food recalls, non-US events, opinion pieces, and general food-safety explainers.",
    },
    pathogen: {
      type: "string",
      enum: [...PATHOGENS],
      description: "The pathogen or contaminant involved; 'other' if unclear or non-biological.",
    },
    food_slug: {
      type: "string",
      description:
        "The canonical food slug from the provided list. If the food is genuinely absent from the list, propose a new lowercase kebab-case slug for it.",
    },
    brands: {
      type: "array",
      items: { type: "string" },
      description: "Brand or company names implicated, exactly as written in the article. Empty if none named.",
    },
    states: {
      type: "array",
      items: { type: "string" },
      description:
        "Two-letter US state codes affected. Empty array if the event is nationwide or no states are stated.",
    },
    severity: {
      type: "integer",
      enum: [1, 2, 3],
      description:
        "1 = recall only, no illnesses. 2 = illnesses reported. 3 = hospitalizations, deaths, or a multi-state outbreak.",
    },
    chains_mentioned: {
      type: "array",
      items: { type: "string" },
      description:
        "Slugs from the provided restaurant chain list that the article explicitly names. Empty unless a chain is named.",
    },
    title: {
      type: "string",
      description:
        "Short human title, e.g. 'Salmonella — Country Eggs brand eggs'. No more than 80 characters.",
    },
    summary: {
      type: "string",
      description:
        "One or two plain-language sentences on what happened and what is affected. No jargon, no advice.",
    },
  },
  required: [
    "index",
    "relevant",
    "pathogen",
    "food_slug",
    "brands",
    "states",
    "severity",
    "chains_mentioned",
    "title",
    "summary",
  ],
};

const TOOL = {
  name: "record_extractions",
  description:
    "Record one structured extraction for every article provided, in order, using the article's index.",
  input_schema: {
    type: "object" as const,
    properties: {
      results: { type: "array", items: EXTRACTION_SCHEMA },
    },
    required: ["results"],
  },
};

function systemPrompt(): string {
  const foods = FOODS.map((f) => `${f.slug} (${f.name})`).join(", ");
  const chains = CHAINS.map((c) => `${c.slug} (${c.name})`).join(", ");

  return [
    "You extract structured records about US foodborne illness events from news headlines and recall notices.",
    "",
    "Canonical food slugs — prefer these:",
    foods,
    "",
    "Restaurant chain slugs — only use these when the article explicitly names the chain:",
    chains,
    "",
    "Rules:",
    "- Judge only from the text given. Never infer facts that are not stated.",
    "- Mark relevant=false for anything that is not a US food contamination, recall, or foodborne illness event. Still return every other field with placeholder values so the record is well-formed.",
    "- Severity 3 requires hospitalizations, deaths, or an outbreak spanning more than one state. Do not assume severity from alarming language alone.",
    "- Choose the single food most central to the event. If a recall covers many products, pick the primary one.",
    "- Summaries are neutral and plain. No advice, no speculation, no urgency language.",
    "- Return exactly one record per article, using the article's index.",
  ].join("\n");
}

function renderBatch(items: readonly FeedItem[]): string {
  return items
    .map((item, i) =>
      [
        `<article index="${i}">`,
        `source: ${item.sourceName}`,
        `date: ${item.publishedAt.toISOString().slice(0, 10)}`,
        `headline: ${item.headline}`,
        item.snippet ? `snippet: ${item.snippet}` : "",
        "</article>",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Coerce the model's record into the shape the database expects. */
function normalize(raw: Record<string, unknown>): Extraction | null {
  const foodSlug = slugify(String(raw.food_slug ?? ""));
  const title = String(raw.title ?? "").trim();
  const summary = String(raw.summary ?? "").trim();
  if (!foodSlug || !title || !summary) return null;

  const pathogen = String(raw.pathogen ?? "other");
  const severity = Number(raw.severity);

  return {
    relevant: raw.relevant === true,
    pathogen: (PATHOGENS as readonly string[]).includes(pathogen) ? pathogen : "other",
    food_slug: foodSlug,
    brands: Array.isArray(raw.brands)
      ? raw.brands.map(String).map((b) => b.trim()).filter(Boolean).slice(0, 10)
      : [],
    states: Array.isArray(raw.states)
      ? raw.states
          .map((s) => String(s).trim().toUpperCase())
          .filter((s) => /^[A-Z]{2}$/.test(s))
          .slice(0, 60)
      : [],
    severity: ([1, 2, 3].includes(severity) ? severity : 1) as Severity,
    chains_mentioned: Array.isArray(raw.chains_mentioned)
      ? raw.chains_mentioned
          .map((c) => slugify(String(c)))
          .filter((c) => CHAINS.some((chain) => chain.slug === c))
      : [],
    title: title.slice(0, 200),
    summary: summary.slice(0, 600),
  };
}

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    client = new Anthropic({ apiKey });
  }
  return client;
}

async function extractBatch(items: FeedItem[]): Promise<ExtractionResult[]> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt(),
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [
      {
        role: "user",
        content: `Extract one record for each of the following ${items.length} article(s).\n\n${renderBatch(items)}`,
      },
    ],
  });

  const call = response.content.find((block) => block.type === "tool_use");
  if (!call || call.type !== "tool_use") return [];

  const results = (call.input as { results?: Record<string, unknown>[] })?.results ?? [];
  const out: ExtractionResult[] = [];

  for (const raw of results) {
    const index = Number(raw.index);
    const item = items[index];
    if (!item) continue;

    const extraction = normalize(raw);
    if (!extraction || !extraction.relevant) continue;

    out.push({ item, extraction });
  }

  return out;
}

export interface ExtractSummary {
  results: ExtractionResult[];
  errors: string[];
  /** Items dropped because the model judged them irrelevant or malformed. */
  discarded: number;
}

/**
 * Extract every item, in batches. A failed batch is logged and skipped — those URLs
 * stay un-ingested and are naturally retried on the next run.
 */
export async function extractAll(items: FeedItem[]): Promise<ExtractSummary> {
  const results: ExtractionResult[] = [];
  const errors: string[] = [];
  let processed = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    try {
      const extracted = await extractBatch(batch);
      results.push(...extracted);
      processed += batch.length;
    } catch (err) {
      errors.push(
        `batch ${i / BATCH_SIZE}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { results, errors, discarded: processed - results.length };
}
