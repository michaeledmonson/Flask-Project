-- Foodborne Illness Tracker — schema
-- Applied manually against Neon: psql "$DATABASE_URL" -f db/schema.sql
-- There is no migration framework by design (see DESIGN.md §11).

CREATE TABLE IF NOT EXISTS outbreaks (
  id               SERIAL PRIMARY KEY,
  food_slug        TEXT NOT NULL,              -- canonical food, see data/foods.json
  pathogen         TEXT NOT NULL,              -- 'salmonella', 'e-coli', 'listeria',
                                               -- 'cyclospora', 'hepatitis-a', 'norovirus', 'other'
  title            TEXT NOT NULL,              -- short human title
  summary          TEXT NOT NULL,              -- 1-2 plain-language sentences
  brands           TEXT[] NOT NULL DEFAULT '{}', -- brand & company names implicated
  states           TEXT[] NOT NULL DEFAULT '{}', -- 2-letter codes; empty = nationwide
  severity         SMALLINT NOT NULL,          -- 1 recall only, 2 illnesses, 3 hospitalizations/
                                               -- deaths or multi-state outbreak
  chains_mentioned TEXT[] NOT NULL DEFAULT '{}', -- chain slugs explicitly named in reporting
  first_reported_at TIMESTAMPTZ NOT NULL,
  last_reported_at  TIMESTAMPTZ NOT NULL,      -- drives decay; updated on every new report
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
  id            SERIAL PRIMARY KEY,
  outbreak_id   INT NOT NULL REFERENCES outbreaks(id) ON DELETE CASCADE,
  url           TEXT NOT NULL UNIQUE,          -- dedupe key for the whole pipeline
  source_name   TEXT NOT NULL,
  source_tier   SMALLINT NOT NULL,             -- 1 official, 2 established outlet, 3 other
  headline      TEXT NOT NULL,
  published_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outbreaks_food ON outbreaks(food_slug);
CREATE INDEX IF NOT EXISTS idx_reports_outbreak ON reports(outbreak_id);
