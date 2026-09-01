// Step 5 of the pipeline (DESIGN.md §5): decide whether an extracted record joins an
// existing outbreak or starts a new one. Deterministic — no LLM involved.

import { query, transaction } from "../db.ts";
import type { OutbreakRow } from "../types.ts";
import type { Extraction } from "./extract.ts";
import type { FeedItem } from "./feeds.ts";

/** An item joins an outbreak only if that outbreak was reported on this recently. */
export const MATCH_WINDOW_DAYS = 45;

export interface IngestCounts {
  new_reports: number;
  new_outbreaks: number;
}

function shareBrand(a: readonly string[], b: readonly string[]): boolean {
  const norm = (s: string) => s.toLowerCase().trim();
  const left = a.map(norm).filter(Boolean);
  const right = b.map(norm).filter(Boolean);
  return left.some((x) => right.some((y) => x.includes(y) || y.includes(x)));
}

/**
 * Same pathogen and food, still within the match window. Where several candidates
 * qualify, one sharing a brand wins; otherwise the most recently updated.
 */
export function pickOutbreak(
  candidates: readonly OutbreakRow[],
  extraction: Extraction,
): OutbreakRow | null {
  const eligible = candidates.filter(
    (o) => o.pathogen === extraction.pathogen && o.food_slug === extraction.food_slug,
  );
  if (eligible.length === 0) return null;

  return (
    eligible.find((o) => shareBrand(o.brands, extraction.brands)) ?? eligible[0]
  );
}

/**
 * Insert one report, attaching it to a matching outbreak or creating one. Returns
 * null when the URL was already ingested (the pipeline's dedupe key).
 */
export async function ingestOne(
  item: FeedItem,
  extraction: Extraction,
  now: Date = new Date(),
): Promise<IngestCounts | null> {
  const cutoff = new Date(now.getTime() - MATCH_WINDOW_DAYS * 86_400_000);

  const candidates = await query<OutbreakRow>(
    `SELECT id, food_slug, pathogen, title, summary, brands, states, severity,
            chains_mentioned, first_reported_at, last_reported_at, created_at
       FROM outbreaks
      WHERE pathogen = $1 AND food_slug = $2 AND last_reported_at >= $3
      ORDER BY last_reported_at DESC`,
    [extraction.pathogen, extraction.food_slug, cutoff.toISOString()],
  );

  const match = pickOutbreak(candidates, extraction);

  return transaction(async (run) => {
    let outbreakId: number;
    let createdOutbreak = false;

    if (match) {
      // Union the new facts in; severity only ever ratchets up.
      //
      // States need care: an empty array encodes "nationwide", so a plain union
      // would *narrow* a nationwide outbreak the moment one report named a state,
      // hiding it from users everywhere else. Nationwide on either side wins.
      await run(
        `UPDATE outbreaks
            SET last_reported_at = GREATEST(last_reported_at, $2),
                first_reported_at = LEAST(first_reported_at, $2),
                brands = ARRAY(SELECT DISTINCT unnest(brands || $3::text[])),
                states = CASE
                           WHEN cardinality(states) = 0 OR cardinality($4::text[]) = 0
                           THEN '{}'::text[]
                           ELSE ARRAY(SELECT DISTINCT unnest(states || $4::text[]))
                         END,
                chains_mentioned = ARRAY(SELECT DISTINCT unnest(chains_mentioned || $5::text[])),
                severity = GREATEST(severity, $6)
          WHERE id = $1`,
        [
          match.id,
          item.publishedAt.toISOString(),
          extraction.brands,
          extraction.states,
          extraction.chains_mentioned,
          extraction.severity,
        ],
      );
      outbreakId = match.id;
    } else {
      const inserted = await run<{ id: number }>(
        `INSERT INTO outbreaks
           (food_slug, pathogen, title, summary, brands, states, severity,
            chains_mentioned, first_reported_at, last_reported_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
         RETURNING id`,
        [
          extraction.food_slug,
          extraction.pathogen,
          extraction.title,
          extraction.summary,
          extraction.brands,
          extraction.states,
          extraction.severity,
          extraction.chains_mentioned,
          item.publishedAt.toISOString(),
        ],
      );
      outbreakId = inserted[0].id;
      createdOutbreak = true;
    }

    // ON CONFLICT covers the race where the same URL arrives twice in one run.
    const report = await run<{ id: number }>(
      `INSERT INTO reports (outbreak_id, url, source_name, source_tier, headline, published_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (url) DO NOTHING
       RETURNING id`,
      [
        outbreakId,
        item.url,
        item.sourceName,
        item.sourceTier,
        item.headline,
        item.publishedAt.toISOString(),
      ],
    );

    if (report.length === 0) {
      // Already ingested; roll the outbreak change back by failing the transaction.
      throw new DuplicateReport();
    }

    return { new_reports: 1, new_outbreaks: createdOutbreak ? 1 : 0 };
  }).catch((err) => {
    if (err instanceof DuplicateReport) return null;
    throw err;
  });
}

class DuplicateReport extends Error {}

/** URLs already in `reports` — the pipeline's step-3 dedupe set. */
export async function existingUrls(): Promise<Set<string>> {
  const rows = await query<{ url: string }>(`SELECT url FROM reports`);
  return new Set(rows.map((r) => r.url));
}
