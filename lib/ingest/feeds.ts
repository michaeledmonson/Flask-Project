// Step 1–2 of the pipeline (DESIGN.md §5): pull the federal feeds and the news feeds
// into one flat list of candidate items.
//
// Only RSS titles and snippets are read — no article HTML is fetched (§11).
// Every fetch is independently guarded so one dead feed cannot kill the run.

import { XMLParser } from "fast-xml-parser";

import { SOURCES, type FeedSource } from "../config.ts";
import type { SourceTier } from "../types.ts";

export interface FeedItem {
  url: string;
  headline: string;
  snippet: string;
  sourceName: string;
  sourceTier: SourceTier;
  publishedAt: Date;
}

export interface FetchResult {
  items: FeedItem[];
  errors: string[];
}

const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT = "foodborne-illness-tracker/1.0 (+https://github.com/)";

async function get(url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "*/*" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "object" && "#text" in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>)["#text"] ?? "");
  }
  return "";
}

/** RSS descriptions carry escaped HTML; the extractor only needs the words. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

/** Google News titles read "Headline - Publisher"; the publisher is shown separately. */
function dropPublisherSuffix(title: string, publisher: string): string {
  if (!publisher) return title;
  const suffix = ` - ${publisher}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length) : title;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isTrusted(url: string): boolean {
  const host = domainOf(url);
  if (!host) return false;
  return SOURCES.trustedDomains.some(
    (d) => host === d || host.endsWith(`.${d}`),
  );
}

function parseDate(value: unknown): Date | null {
  const raw = text(value).trim();
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Parses both RSS 2.0 (`channel/item`) and Atom (`feed/entry`). */
export function parseFeed(xml: string, source: FeedSource): FeedItem[] {
  let doc: Record<string, any>;
  try {
    doc = parser.parse(xml) as Record<string, any>;
  } catch (err) {
    // Surfaces as this feed's entry in the run's error list; other feeds continue.
    throw new Error(
      `malformed feed XML (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  const items: FeedItem[] = [];

  const rssItems = asArray(doc?.rss?.channel?.item);
  const atomEntries = asArray(doc?.feed?.entry);

  for (const item of rssItems) {
    const url = text(item.link) || text(item.guid);
    if (!url) continue;

    const published =
      parseDate(item.pubDate) ?? parseDate(item["dc:date"]) ?? new Date();

    // Google News wraps the publisher in a <source url="…"> element; that resolved
    // domain is what decides whether the item earns tier 2 (§5 step 2).
    const publisherUrl = text(item.source?.["@_url"]);
    const publisherName = text(item.source) || source.name;
    const resolved = publisherUrl || url;

    items.push({
      url,
      headline: stripHtml(dropPublisherSuffix(text(item.title), publisherName)),
      snippet: stripHtml(text(item.description) || text(item["content:encoded"])),
      sourceName: source.kind === "rss" && publisherUrl ? publisherName : source.name,
      sourceTier:
        source.tier === 3 && isTrusted(resolved) ? 2 : source.tier,
      publishedAt: published,
    });
  }

  for (const entry of atomEntries) {
    const link = asArray(entry.link).find((l: any) => !l?.["@_rel"] || l["@_rel"] === "alternate");
    const url = text(link?.["@_href"]) || text(entry.id);
    if (!url) continue;

    items.push({
      url,
      headline: stripHtml(text(entry.title)),
      snippet: stripHtml(text(entry.summary) || text(entry.content)),
      sourceName: source.name,
      sourceTier: source.tier,
      publishedAt: parseDate(entry.updated) ?? parseDate(entry.published) ?? new Date(),
    });
  }

  return items.filter((i) => i.headline);
}

interface EnforcementRecord {
  recall_number?: string;
  product_description?: string;
  reason_for_recall?: string;
  recalling_firm?: string;
  distribution_pattern?: string;
  classification?: string;
  report_date?: string;
  status?: string;
}

/** openFDA dates are YYYYMMDD. */
function fdaDate(value: string | undefined): Date | null {
  if (!value || value.length !== 8) return null;
  const d = new Date(
    `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`,
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

function yyyymmdd(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * FDA enforcement reports for the last 14 days, Class I and II only. Each record is
 * keyed by its recall number; the openFDA query for that number is a stable,
 * resolvable link to the authoritative record, which is what `reports.url` needs.
 */
export async function fetchEnforcement(
  source: FeedSource,
  now: Date = new Date(),
): Promise<FeedItem[]> {
  const from = new Date(now.getTime() - 14 * 86_400_000);
  const search =
    `report_date:[${yyyymmdd(from)}+TO+${yyyymmdd(now)}]` +
    `+AND+(classification:"Class+I"+OR+classification:"Class+II")`;

  const res = await get(`${source.url}?search=${search}&limit=100`);
  const body = (await res.json()) as { results?: EnforcementRecord[] };

  return (body.results ?? [])
    .filter((r) => r.recall_number)
    .map((r) => ({
      url: `${source.url}?search=recall_number:"${r.recall_number}"`,
      headline: [r.recalling_firm, r.product_description]
        .filter(Boolean)
        .join(" — ")
        .slice(0, 300),
      snippet: [
        r.reason_for_recall,
        r.classification && `Classification: ${r.classification}.`,
        r.distribution_pattern && `Distribution: ${r.distribution_pattern}.`,
        r.status && `Status: ${r.status}.`,
      ]
        .filter(Boolean)
        .join(" ")
        .slice(0, 600),
      sourceName: source.name,
      sourceTier: source.tier,
      publishedAt: fdaDate(r.report_date) ?? now,
    }));
}

async function fetchSource(source: FeedSource, now: Date): Promise<FeedItem[]> {
  if (source.kind === "fda-enforcement") return fetchEnforcement(source, now);
  const res = await get(source.url);
  return parseFeed(await res.text(), source);
}

function googleNewsSource(query: string): FeedSource {
  return {
    id: `google-news:${query}`,
    name: "Google News",
    kind: "rss",
    tier: 3,
    url: `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US`,
  };
}

/**
 * Every configured feed, fetched concurrently. Failures are collected rather than
 * thrown: a feed that is down today is simply missing from this run.
 */
export async function fetchAllFeeds(now: Date = new Date()): Promise<FetchResult> {
  const sources: FeedSource[] = [
    ...SOURCES.federal,
    ...SOURCES.curated,
    ...SOURCES.googleNewsQueries.map(googleNewsSource),
  ];

  const settled = await Promise.allSettled(
    sources.map(async (source) => ({ source, items: await fetchSource(source, now) })),
  );

  const items: FeedItem[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (result.status === "rejected") {
      errors.push(`${sources[i].id}: ${String(result.reason?.message ?? result.reason)}`);
      continue;
    }
    // The same story can appear in several feeds; keep the highest-trust copy.
    for (const item of result.value.items) {
      const existing = seen.has(item.url);
      if (!existing) {
        seen.add(item.url);
        items.push(item);
      } else {
        const prior = items.find((x) => x.url === item.url);
        if (prior && item.sourceTier < prior.sourceTier) prior.sourceTier = item.sourceTier;
      }
    }
  }

  return { items, errors };
}
