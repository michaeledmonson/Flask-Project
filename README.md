# Foodborne Illness Tracker

A mobile-first web app that answers one question: **is my food safe right now?**

It tracks US foodborne illness outbreaks (salmonella, E. coli, listeria, cyclospora
and others) and shows the current risk level of ~50 common grocery items and 20 major
restaurant chains. A daily job combines federal recall feeds with news reporting; risk
is recomputed from the raw reports on every page load.

The complete build spec is in [`DESIGN.md`](./DESIGN.md).

## Stack

Next.js (App Router, TypeScript) on Vercel · Postgres via Neon · Tailwind ·
Claude Haiku for extracting structured records from news items.

## Layout

```
app/            pages (/, /food/[slug], /chain/[slug], /about) and API routes
components/     TierBadge, OutbreakCard, HomeView
lib/scoring.ts  the risk model — pure functions, unit tested
lib/queries.ts  reads + scoring assembly, shared by pages and API routes
lib/ingest/     the daily pipeline: feeds → extraction → outbreak matching
data/*.json     curated foods, chains and feeds (edit by git commit, not an admin UI)
db/             schema.sql and a development seed
```

## Running locally

```bash
npm install
cp .env.example .env.local        # then fill in the values

psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/seed.sql   # sample outbreaks, so the UI has something to show

npm run dev
```

`db/seed.sql` is re-runnable and truncates both tables — never point it at production.

### Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `ANTHROPIC_API_KEY` | Claude Haiku extraction in the ingestion pipeline |
| `CRON_SECRET` | Bearer token authorizing `GET /api/cron/ingest` |

## Tests

```bash
npm test
```

Covers `lib/scoring.ts` — decay, confidence, compounding, the trust cap, tier
boundaries, trend and chain weighting. That module is deliberately the only tested one:
it holds all the judgement, and everything else is plumbing over it.

## The ingestion pipeline

`GET /api/cron/ingest` runs daily at 10:00 UTC (`vercel.json`), authorized with
`Authorization: Bearer $CRON_SECRET`:

1. Fetch FDA enforcement reports and the CDC/FoodSafety.gov feeds (tier 1).
2. Fetch curated news feeds (tier 2) and Google News queries (tier 3, upgraded to
   tier 2 when the resolved publisher is a trusted domain).
3. Drop anything already ingested — `reports.url` is the dedupe key — or over 60 days old.
4. Claude Haiku extracts structured records in batches of 10, via a tool schema.
5. Each record joins an existing outbreak (same pathogen and food, reported within 45
   days, preferring a shared brand) or opens a new one.

Every feed is fetched independently, so one dead source cannot fail the run, and a
failed extraction batch simply leaves those URLs to be retried tomorrow. The response
body carries `{fetched, new_reports, new_outbreaks, skipped, errors}` — that is the
whole observability story, readable in the Vercel log for the invocation.

Run it by hand with:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/ingest
```

## Deploying

1. Create the Vercel project and add the Neon integration.
2. Set `DATABASE_URL`, `ANTHROPIC_API_KEY` and `CRON_SECRET`.
3. Apply `db/schema.sql` to the Neon database.
4. Deploy. `vercel.json` registers the daily cron; confirm the first run in the logs.

## Scope

`DESIGN.md` §11 lists what this deliberately does not have — accounts, notifications,
an admin panel, maps, caching layers, an ORM, dark mode. Those omissions are decisions,
not gaps.
