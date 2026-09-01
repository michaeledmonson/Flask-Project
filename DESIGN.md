# Foodborne Illness Tracker — Design & Requirements

A mobile-first web app that tracks US foodborne illness outbreaks (E. coli, salmonella,
cyclospora, listeria, etc.) and shows, at a glance, the current risk level of grocery
items and restaurant chains. Hosted on Vercel, refreshed by a daily ingestion job that
combines federal recall feeds with news reporting.

This document is the complete build spec. Every decision below was confirmed with the
product owner. **Build exactly this — no more.** A "Do not build" list is at the end
and is as binding as the requirements.

---

## 1. Product principles

1. **Answer the question in one glance.** The user's question is "is my food safe right
   now?" The homepage must answer it without reading, scrolling, or tapping.
2. **Honest about uncertainty.** Risk ratings show their work: every rating links to the
   underlying outbreaks and sources. Weakly-sourced signals are visible but capped.
3. **Lean by design.** No accounts, no notifications, no admin panel, no maps, no
   background workers. One database, one cron job, one deploy target.

---

## 2. Confirmed scope decisions

| Decision | Choice |
|---|---|
| Stack | Next.js (App Router, TypeScript) on Vercel; replaces the existing Flask code entirely |
| Database | Postgres via Neon (Vercel marketplace integration), accessed with `@neondatabase/serverless` and plain SQL |
| Ingestion | Daily Vercel Cron: federal feeds (structured backbone) + curated news RSS + Google News RSS, with Claude Haiku extracting structured records from news items |
| Risk display | 5-tier scale: Very Low / Low / Moderate / High / Very High |
| Recency decay | 30-day half-life; new reporting on an outbreak resets its clock |
| Source trust | Reports weighted by source tier; a single low-tier article can never push an item above Moderate |
| Location | State-level tagging; user picks their state once (default NY, stored in localStorage); no geolocation |
| Restaurant chains | Hand-curated supplier map (~15–20 major chains) + automatic name-mention matching |
| Accounts / alerts | None in v1 |
| Homepage | Risk-ranked food grid with pinned search and filter chips; chains on a second tab |

---

## 3. Architecture

```
┌─────────────────────────── Vercel ───────────────────────────┐
│                                                              │
│  Next.js app                                                 │
│  ├─ Pages (server components, mobile-first)                  │
│  ├─ GET /api/foods, /api/foods/[slug]                        │
│  ├─ GET /api/chains, /api/chains/[slug]                      │
│  └─ GET /api/cron/ingest   ← Vercel Cron, daily 10:00 UTC    │
│                                    │                         │
└────────────────────────────────────┼─────────────────────────┘
                                     │
        ┌──────────────┐   ┌─────────▼─────────┐
        │ Neon Postgres│◄──│ Ingestion pipeline│──► Anthropic API
        └──────────────┘   └─────────▲─────────┘    (Haiku, JSON
                                     │               extraction)
                    FDA / FoodSafety.gov / CDC feeds
                    Curated news RSS + Google News RSS
```

- **No separate backend.** All server logic lives in Next.js route handlers and server
  components.
- **Risk is computed at read time.** Active outbreaks number in the dozens, not
  millions. Scoring is a pure TypeScript function over rows — no cached scores, no
  materialized views, no jobs beyond the one daily ingest.
- **Env vars:** `DATABASE_URL`, `ANTHROPIC_API_KEY`, `CRON_SECRET`.
- **Dependencies (complete list):** `next`, `react`, `react-dom`, `tailwindcss`,
  `@neondatabase/serverless`, `@anthropic-ai/sdk`, `fast-xml-parser` (RSS parsing).
  If a task seems to need another dependency, it is probably out of scope.

---

## 4. Data model

One migration file, `db/schema.sql`, applied manually against Neon (no migration
framework).

```sql
CREATE TABLE outbreaks (
  id               SERIAL PRIMARY KEY,
  food_slug        TEXT NOT NULL,              -- canonical food, see foods.json
  pathogen         TEXT NOT NULL,              -- 'salmonella', 'e-coli', 'listeria',
                                               -- 'cyclospora', 'hepatitis-a', 'norovirus', 'other'
  title            TEXT NOT NULL,              -- short human title, e.g.
                                               -- "Salmonella — Country Eggs brand eggs"
  summary          TEXT NOT NULL,              -- 1–2 plain-language sentences
  brands           TEXT[] NOT NULL DEFAULT '{}', -- brand & company names implicated
  states           TEXT[] NOT NULL DEFAULT '{}', -- 2-letter codes; empty = nationwide
  severity         SMALLINT NOT NULL,          -- 1 recall only, 2 illnesses, 3 hospitalizations/
                                               -- deaths or multi-state outbreak
  chains_mentioned TEXT[] NOT NULL DEFAULT '{}', -- chain slugs explicitly named in reporting
  first_reported_at TIMESTAMPTZ NOT NULL,
  last_reported_at  TIMESTAMPTZ NOT NULL,      -- drives decay; updated on every new report
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  id            SERIAL PRIMARY KEY,
  outbreak_id   INT NOT NULL REFERENCES outbreaks(id) ON DELETE CASCADE,
  url           TEXT NOT NULL UNIQUE,          -- dedupe key for the whole pipeline
  source_name   TEXT NOT NULL,
  source_tier   SMALLINT NOT NULL,             -- 1 official, 2 established outlet, 3 other
  headline      TEXT NOT NULL,
  published_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_outbreaks_food ON outbreaks(food_slug);
CREATE INDEX idx_reports_outbreak ON reports(outbreak_id);
```

Everything hand-curated lives in versioned config files, **not** the database, so tuning
is a git commit rather than an admin UI:

- **`data/foods.json`** — canonical food list: `{ slug, name, category, aliases[] }`.
  Categories: `produce`, `dairy-eggs`, `meat-poultry`, `seafood`, `packaged`, `other`.
  Seed with ~40 common items (eggs, romaine lettuce, bagged salad, ground beef, deli
  meat, cantaloupe, raw milk cheese, cucumbers, onions, flour, peanut butter, …).
  Search matches `name` and `aliases`. The extractor may propose a food not in this
  list; it is stored with its proposed slug and category `other` and still works —
  promoting it to the curated list is a later git commit.
- **`data/sources.json`** — feeds the ingester reads (see §5).
- **`data/chains.json`** — restaurant chains (see §7).

---

## 5. Daily ingestion pipeline

`GET /api/cron/ingest`, triggered by Vercel Cron (`vercel.json`: `0 10 * * *`),
authorized by `Authorization: Bearer ${CRON_SECRET}`. Set `maxDuration: 300`. The whole
pipeline is one sequential function — no queues.

**Step 1 — fetch structured federal feeds** (tier 1, no LLM needed for discovery):
- FDA enforcement API: `https://api.fda.gov/food/enforcement.json` — last 14 days,
  Class I and II recalls.
- FoodSafety.gov recall/outbreak RSS.
- CDC food safety alerts RSS.

**Step 2 — fetch news feeds** from `data/sources.json`:
- Curated outlets (tier 2): Food Safety News, Food Poisoning Bulletin, and 2–3 wire/major
  outlet food-recall feeds.
- Google News RSS queries (tier 3 by default; item tier upgraded to 2 when the resolved
  domain is in the curated list): `"salmonella outbreak"`, `"e coli outbreak"`,
  `"listeria recall"`, `"cyclospora"`, `"food recall"` — each as
  `https://news.google.com/rss/search?q=<query>&hl=en-US&gl=US`.

**Step 3 — dedupe.** Drop any item whose URL already exists in `reports`. Also drop
items older than 60 days.

**Step 4 — LLM extraction.** Send new items (title + snippet + source + date) to Claude
Haiku (`claude-haiku-4-5-20251001`) in batches of ~10, using a tool/JSON schema so output
is strictly structured:

```jsonc
{
  "relevant": true,            // false → discard (not a US foodborne illness event)
  "pathogen": "salmonella",
  "food_slug": "eggs",         // choose from provided canonical list, or propose
                               // a new kebab-case slug if genuinely absent
  "brands": ["Country Eggs LLC"],
  "states": ["CA","NV"],       // [] if nationwide or unstated
  "severity": 2,               // 1 recall only / 2 illnesses / 3 hospitalizations,
                               // deaths, or multi-state outbreak
  "chains_mentioned": [],      // slugs from provided chain list
  "title": "Salmonella — Country Eggs brand eggs",
  "summary": "One plain-language sentence on what happened and what's affected."
}
```

The prompt includes the canonical food list and chain list so the model maps to known
slugs. Federal-feed items are already structured but still pass through extraction to
fill `food_slug`/`severity`/`summary` uniformly.

**Step 5 — match or create outbreak.** Deterministic heuristic, no LLM:
a new item joins an existing outbreak when **pathogen and food_slug match** and the
outbreak's `last_reported_at` is within 45 days; prefer the candidate sharing a brand.
Otherwise insert a new outbreak. On match: insert the report, update
`last_reported_at = max(existing, published_at)`, union `brands`, `states`, and
`chains_mentioned`, and raise `severity` if the new report's is higher (never lower it).

**Step 6 — log.** Return counts `{fetched, new_reports, new_outbreaks, skipped}` in the
response body so runs are inspectable in Vercel logs. That is the entire observability
story.

Failure posture: each feed fetch is independently try/caught — one dead feed must not
kill the run. An LLM error skips that batch; the URLs remain un-ingested and are
retried naturally the next day.

---

## 6. Risk scoring

Pure functions in `lib/scoring.ts` — the only unit-tested module.

**Per outbreak:**

```
confidence C:
  1.0   any tier-1 report (official recall/alert)
  0.85  ≥2 independent tier-2/3 sources (distinct domains)
  0.7   single tier-2 report
  0.4   single tier-3 report

decay    D = 0.5 ^ (days_since_last_reported / 30)

score    S = (severity / 3) × C × D          → (0, 1]
```

An outbreak with `D < 0.05` (~4+ months quiet) is inactive: excluded from scoring and
from "active" UI lists (still visible on the food's detail page under "Past events").

**Per food item** (probabilistic OR, so concurrent outbreaks compound):

```
R = 1 − Π (1 − Sᵢ)   over active outbreaks for that food
```

**Tier mapping:**

| R | Tier | Color token |
|---|---|---|
| ≥ 0.70 | Very High | red |
| ≥ 0.40 | High | orange |
| ≥ 0.20 | Moderate | amber |
| ≥ 0.07 | Low | yellow-green |
| > 0 | Very Low | green |
| 0 / no active outbreaks | Very Low | green |

**Trust cap:** if every active outbreak for a food has `C ≤ 0.4` (single low-tier
sourcing only), the food's tier is capped at Moderate regardless of R.

**Trend:** recompute R as of 7 days ago (same rows, decay shifted; ignore reports newer
than 7 days). `rising` if tier increased or R grew >25% relative, `falling` if the
reverse, else `steady`.

**Location relevance** (a display flag, never a score input): an outbreak is relevant to
the user's state when `states` is empty (nationwide) or contains it. The food list's
state filter hides foods whose active outbreaks are all irrelevant to the chosen state;
"All states" shows everything.

---

## 7. Restaurant chain risk

`data/chains.json` — ~15–20 major chains, hand-curated from public reporting (news,
trade press, chains' own supplier disclosures):

```jsonc
{
  "slug": "chipotle",
  "name": "Chipotle",
  "suppliers": ["Taylor Farms", "FreshPoint"],   // company names, best-effort
  "key_ingredients": ["romaine-lettuce", "tomatoes", "cilantro"]  // food slugs
}
```

A chain's risk aggregates three signal types, each an outbreak set scored with the §6
formula:

1. **Direct mentions** (full weight): outbreaks whose `chains_mentioned` includes the
   chain.
2. **Supplier matches** (weight ×0.8): outbreaks where a `brands` entry matches a listed
   supplier (case-insensitive substring both directions).
3. **Ingredient exposure** (weight ×0.3): active outbreaks on the chain's
   `key_ingredients` foods.

`R_chain = 1 − Π(1 − wᵢSᵢ)`, same tier mapping and trust cap. The chain detail page
groups evidence under labeled headings ("Named in reporting", "Supplier recall",
"Ingredient risk") and carries a permanent caveat: *"Supplier relationships are compiled
from public reporting and may be incomplete or outdated."*

---

## 8. API routes

All JSON, all GET, no auth (public data):

- `GET /api/foods?q=&state=&category=` → `[{ slug, name, category, tier, trend,
  activeOutbreakCount, latestHeadline, relevantToState }]`, sorted by R desc, then name.
- `GET /api/foods/[slug]` → food + active outbreaks (each with reports) + past events.
- `GET /api/chains?state=` → same list shape as foods.
- `GET /api/chains/[slug]` → chain + grouped evidence.
- `GET /api/cron/ingest` → pipeline (bearer-token protected).

Pages may equally fetch via server components directly; the API routes exist so the
data is also reachable as JSON. Either way, query + scoring logic lives once, in
`lib/`.

---

## 9. UI / UX

Mobile-first (design at 390px; single centered column, max-width ~640px on desktop).
Tailwind only — **no component library**. System font stack. Light theme only.

Tier badges are a colored pill **with the tier text inside** — never color alone
(colorblind accessibility). One shared `<TierBadge>` component.

### Screens (4 total)

**1. Home `/`** — the entire product in one screen:
- Compact header: app name + state selector (native `<select>`, 50 states + "All",
  default NY, persisted to localStorage).
- Pinned search input ("Search a food… eggs, romaine, ground beef").
- Tab switcher: **Groceries | Restaurants**.
- Category filter chips (Groceries tab only): All / Produce / Dairy & Eggs /
  Meat & Poultry / Seafood / Packaged.
- Risk-ranked list. Each row: food name, `<TierBadge>`, trend arrow (↑ ↓ →), one-line
  latest headline, and a subtle "· reported in NY" marker when state-relevant. Foods
  with no active outbreaks appear collapsed under a single "Everything else — Very Low"
  section listing just their names.
- Restaurants tab: identical row layout for chains.

**2. Food detail `/food/[slug]`**
- Food name, large `<TierBadge>`, trend, "last updated" date.
- **Why this rating** — auto-generated sentence: *"2 active outbreaks: a multi-state
  salmonella outbreak linked to Country Eggs brand (official FDA recall, updated
  Aug 24), and …"*
- Active outbreak cards: pathogen, brands, affected states (or "Nationwide"), severity
  in words, timeline (first/last reported), and source links each labeled
  **Official / News / Unverified** (tiers 1/2/3).
- **What you can do** — static per-severity copy (check brands/lot codes, discard, etc.).
- Past events, collapsed.

**3. Chain detail `/chain/[slug]`** — as food detail, evidence grouped per §7, with the
supplier-data caveat.

**4. About `/about`** — plain-language methodology (sources, tiers, decay, the 5-tier
scale) and the disclaimer: *"Informational only — not medical or food-safety advice.
Always verify against the linked official notices."* Footer-linked from every page.

Empty states: search with no hits → "No active outbreaks found for '…' — that usually
means good news." Zero-data day one → the "Everything else" section covers it.

---

## 10. Build order

Each step ends runnable. Seed data (`db/seed.sql`, ~8 realistic outbreaks + reports
across foods/tiers/dates, including one chain mention) makes the UI buildable before the
pipeline exists.

1. **Scaffold** — Next.js + TS + Tailwind; `db/schema.sql`, `db/seed.sql`;
  `data/foods.json`, `data/sources.json`, `data/chains.json`; Neon connected.
2. **Scoring** — `lib/scoring.ts` pure functions + unit tests (decay, confidence,
   compounding, cap, tier mapping, trend).
3. **Reads** — `lib/queries.ts` + API routes against seed data.
4. **UI** — all four screens against seed data.
5. **Pipeline** — `/api/cron/ingest` (feeds → dedupe → Haiku extraction → match/insert),
   `vercel.json` cron entry. Verify with a manual authorized call.
6. **Deploy** — Vercel project, env vars, run schema against Neon, confirm cron.

---

## 11. Do not build (binding)

- No user accounts, auth, or sessions; no email/push notifications.
- No admin dashboard or CMS — curation is git commits to `data/*.json`; corrections are
  SQL.
- No maps or geolocation. No city-level anything.
- No caching layers, queues, workers, or scheduled jobs beyond the single daily cron.
- No score persistence/history tables — trend is recomputed from decay math.
- No ORM, no migration framework, no state-management library, no component library.
- No dark mode, i18n, or historical charts/graphs.
- No web scraping of full article HTML — RSS titles + snippets are sufficient input for
  extraction (follow-the-link is the user's job, via the source links).
- No tests beyond `lib/scoring.ts` unit tests.

If a requirement seems to demand one of these, the requirement is being misread —
re-read this document.
