# Deploying to Vercel

Start to finish, about 15 minutes. Everything here is done from your own Vercel and
Neon accounts — no secret ever needs to be pasted into a chat, a commit, or a file in
this repo.

You need: a Vercel account, an Anthropic API key, and this repo pushed to GitHub.

---

## 1. Import the repo

Vercel dashboard → **Add New… → Project** → import `michaeledmonson/Flask-Project`.

Vercel detects Next.js and fills in the build settings correctly. Do not change them.

**Before the first deploy, set the production branch.** The app lives on
`claude/foodborne-illness-tracker-264xhr`, not on `master` (which still holds the old
Flask app). Either:

- **Project Settings → Git → Production Branch** → set it to
  `claude/foodborne-illness-tracker-264xhr`, or
- merge that branch into `master` first and leave the setting alone.

Deploying `master` as-is gives you the old Flask project, not this one.

The first build will fail at the database step. That is expected — there is no database
yet. Continue to step 2.

---

## 2. Attach a Neon database

Project → **Storage** → **Create Database** → **Neon** → accept the free tier.

Vercel sets `DATABASE_URL` on the project automatically. You never see or copy it.

---

## 3. Create the tables

Neon dashboard → your database → **SQL Editor**. Paste the entire contents of
[`db/schema.sql`](./db/schema.sql) and run it.

**Do not run `db/seed.sql` against this database.** The seed is local-development
fixture data — invented outbreaks, invented brands, invented publishers. It is safe to
look at and unsafe to publish, because a public site showing an invented recall reads
as a real one. Production starts empty and fills from the first ingest run.

An empty database is not a broken site: every food renders at Very Low under
"Everything else", which is the honest state until real data arrives.

---

## 4. Set the two remaining environment variables

Project → **Settings → Environment Variables**. Add both to **all** environments
(Production, Preview, Development):

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your key, pasted directly into Vercel |
| `CRON_SECRET` | a random string you generate — see below |

Generate the cron secret on your own machine and paste the output straight into Vercel:

```bash
openssl rand -hex 32
```

`CRON_SECRET` is what stops the public internet from triggering your ingestion job (and
spending your API credit). Once it is set, Vercel Cron sends it automatically as
`Authorization: Bearer …` on the scheduled run; you do not wire that up yourself.

---

## 5. Redeploy

Deployments → the latest one → **⋯ → Redeploy**. This is the first build that has both
the database and the keys, so it is the first one that should go green.

Open the URL. You should get the app with everything at Very Low.

---

## 6. Run the first ingest by hand

Do not wait for the 10:00 UTC cron — you want to see the first run's output.

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://YOUR-PROJECT.vercel.app/api/cron/ingest
```

A healthy response looks like:

```json
{"fetched":143,"new_reports":38,"new_outbreaks":11,"skipped":105,"errors":[],"duration_ms":42311}
```

Reload the site — real outbreaks should now be ranked on the homepage.

### Reading the response

- **`errors` lists a feed** — that feed alone failed; the rest of the run still
  completed. One dead source cannot fail the run by design. A feed that fails every day
  is worth removing from `data/sources.json`.
- **`fetched` is 0 and every feed errored** — outbound network is blocked, or every
  source moved. Check one feed URL from `data/sources.json` in a browser.
- **`new_outbreaks` is 0 but `new_reports` is high** — matching is folding everything
  into existing outbreaks. Working as intended if those outbreaks are genuinely the same
  story; suspicious if the database only has one or two rows.
- **The response never arrives / the function times out** — the run exceeded the
  platform's function duration limit for your plan. The route asks for 300s
  (`app/api/cron/ingest/route.ts`); if your plan caps lower, trim
  `googleNewsQueries` in `data/sources.json` or lower `BATCH_SIZE` in
  `lib/ingest/extract.ts` so a run does less work.

---

## 7. Confirm the schedule

Project → **Cron Jobs** should list `/api/cron/ingest` at `0 10 * * *`, registered from
[`vercel.json`](./vercel.json). Check the invocation log the next morning.

---

## Ongoing costs

- **Vercel** — free tier is sufficient at this traffic.
- **Neon** — free tier is ample; this data is measured in kilobytes.
- **Anthropic** — the only real cost, and it is small. One run classifies roughly
  100–200 short news items with Claude Haiku, which is cents per day. Watch it for the
  first week in the Anthropic console rather than assuming.

---

## Tuning after real data arrives

Everything below is a one-line change plus a redeploy:

| To change | Edit |
|---|---|
| Which feeds are read | `data/sources.json` |
| Foods tracked, and their search aliases | `data/foods.json` |
| Chains and their supplier maps | `data/chains.json` |
| Tier thresholds, decay half-life, confidence | `lib/scoring.ts` |
| Chain signal weights | `WEIGHT_*` in `lib/queries.ts` |

The scoring constants are the ones most likely to need adjusting once you see real
outbreaks. `npm test` covers them — run it after any change there.

Correcting a bad record is plain SQL in the Neon console; there is no admin UI, by
design (`DESIGN.md` §11).
