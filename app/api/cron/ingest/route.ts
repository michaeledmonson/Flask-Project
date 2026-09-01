// The daily ingestion run (DESIGN.md §5). Triggered by Vercel Cron at 10:00 UTC and
// authorized with CRON_SECRET. One sequential pass: fetch → dedupe → extract → match.

import { NextResponse } from "next/server";

import { extractAll } from "@/lib/ingest/extract";
import { fetchAllFeeds } from "@/lib/ingest/feeds";
import { existingUrls, ingestOne } from "@/lib/ingest/match";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Items older than this are not worth ingesting (§5 step 3). */
const MAX_AGE_DAYS = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const now = new Date();
  const errors: string[] = [];

  // Steps 1–2: every feed, failures collected rather than thrown.
  const { items, errors: feedErrors } = await fetchAllFeeds(now);
  errors.push(...feedErrors);

  // Step 3: drop anything already ingested or too old to matter.
  const seen = await existingUrls();
  const cutoff = now.getTime() - MAX_AGE_DAYS * 86_400_000;
  const fresh = items.filter(
    (item) => !seen.has(item.url) && item.publishedAt.getTime() >= cutoff,
  );

  // Step 4: Haiku turns them into structured records.
  const { results, errors: extractErrors, discarded } = await extractAll(fresh);
  errors.push(...extractErrors);

  // Step 5: attach each record to an outbreak, or open a new one.
  let newReports = 0;
  let newOutbreaks = 0;
  let duplicates = 0;

  for (const { item, extraction } of results) {
    try {
      const counts = await ingestOne(item, extraction, now);
      if (!counts) {
        duplicates++;
        continue;
      }
      newReports += counts.new_reports;
      newOutbreaks += counts.new_outbreaks;
    } catch (err) {
      errors.push(`${item.url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Step 6: the counts are the entire observability story — they show up in the
  // Vercel log for the cron invocation.
  return NextResponse.json({
    fetched: items.length,
    new_reports: newReports,
    new_outbreaks: newOutbreaks,
    skipped: items.length - fresh.length + discarded + duplicates,
    errors,
    duration_ms: Date.now() - startedAt,
  });
}
