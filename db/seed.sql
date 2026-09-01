-- Development seed: a realistic snapshot so the UI is buildable before the ingestion
-- pipeline exists (DESIGN.md §10). Dates are relative to now(), so the decay math and
-- trend arrows stay meaningful whenever this is applied.
--
--   psql "$DATABASE_URL" -f db/schema.sql -f db/seed.sql
--
-- Re-runnable: it clears both tables first. Never run this against production data.

TRUNCATE reports, outbreaks RESTART IDENTITY CASCADE;

INSERT INTO outbreaks
  (food_slug, pathogen, title, summary, brands, states, severity, chains_mentioned,
   first_reported_at, last_reported_at)
VALUES
  -- Very High: fresh, official, multi-state, hospitalizations.
  ('eggs', 'salmonella',
   'Salmonella — Country Eggs brand shell eggs',
   'A multi-state salmonella outbreak has been linked to shell eggs distributed under the Country Eggs label; the FDA has issued a recall and several people have been hospitalized.',
   ARRAY['Country Eggs LLC', 'Sunrise Valley Farms'], ARRAY[]::TEXT[], 3, ARRAY[]::TEXT[],
   now() - interval '11 days', now() - interval '2 days'),

  -- High: official, serious, still recent.
  ('deli-meat', 'listeria',
   'Listeria — sliced deli meats from Harborview Provisions',
   'The CDC is investigating listeria illnesses tied to deli meats sliced at the counter; Harborview Provisions has recalled affected lots nationwide.',
   ARRAY['Harborview Provisions'], ARRAY[]::TEXT[], 3, ARRAY[]::TEXT[],
   now() - interval '24 days', now() - interval '6 days'),

  -- Named chain + a supplier brand: exercises all three §7 chain signals.
  ('romaine-lettuce', 'e-coli',
   'E. coli — romaine lettuce linked to Taylor Farms product',
   'Health officials are investigating E. coli illnesses in three western states connected to romaine lettuce; reporting has named servings at Chipotle locations among the exposures.',
   ARRAY['Taylor Farms'], ARRAY['CA', 'OR', 'WA'], 2, ARRAY['chipotle'],
   now() - interval '19 days', now() - interval '12 days'),

  -- Regionally relevant to the default state (NY).
  ('bagged-salad', 'cyclospora',
   'Cyclospora — bagged salad kits in the Northeast',
   'A cluster of cyclospora infections in the Northeast has been associated with packaged salad kits sold at regional grocers.',
   ARRAY['Greenline Fresh'], ARRAY['NY', 'NJ', 'CT'], 2, ARRAY[]::TEXT[],
   now() - interval '28 days', now() - interval '20 days'),

  ('cucumbers', 'salmonella',
   'Salmonella — whole cucumbers from Del Sol Produce',
   'Whole cucumbers distributed in the Southwest were recalled after salmonella was detected during routine testing; illnesses have been reported.',
   ARRAY['Del Sol Produce'], ARRAY['CA', 'AZ', 'NV'], 2, ARRAY[]::TEXT[],
   now() - interval '31 days', now() - interval '25 days'),

  -- Recall only, no illnesses: the low end of severity.
  ('ice-cream', 'listeria',
   'Listeria — Northfield Creamery ice cream recall',
   'Northfield Creamery is voluntarily recalling several pint flavors after listeria was found on production equipment. No illnesses have been reported.',
   ARRAY['Northfield Creamery'], ARRAY[]::TEXT[], 1, ARRAY[]::TEXT[],
   now() - interval '9 days', now() - interval '8 days'),

  -- Single tier-3 source only: should be visible but capped at Moderate.
  ('flour', 'e-coli',
   'E. coli — reports of illness linked to raw flour',
   'A local outlet has reported a small number of E. coli illnesses possibly connected to raw flour used in unbaked dough. No official recall has been issued.',
   ARRAY[]::TEXT[], ARRAY['TX'], 2, ARRAY[]::TEXT[],
   now() - interval '4 days', now() - interval '3 days'),

  ('oysters', 'norovirus',
   'Norovirus — raw oysters harvested in the Pacific Northwest',
   'Raw oysters from several Pacific Northwest harvest areas have been linked to norovirus illnesses; the affected harvest lots have been closed.',
   ARRAY['Puget Shellfish Co.'], ARRAY['WA', 'OR'], 2, ARRAY[]::TEXT[],
   now() - interval '18 days', now() - interval '15 days'),

  -- Dormant (D < 0.05): excluded from active lists, shown under "Past events".
  ('onions', 'salmonella',
   'Salmonella — imported red onions',
   'A large multi-state salmonella outbreak was traced to imported red onions. The outbreak was declared over after the implicated product left the market.',
   ARRAY['Sierra Grove Imports'], ARRAY[]::TEXT[], 3, ARRAY[]::TEXT[],
   now() - interval '260 days', now() - interval '220 days');

INSERT INTO reports (outbreak_id, url, source_name, source_tier, headline, published_at)
SELECT o.id, v.url, v.source_name, v.source_tier, v.headline, v.published_at
FROM (VALUES
  -- eggs: official + corroborating trade press, with a follow-up this week
  ('Salmonella — Country Eggs brand shell eggs',
   'https://www.fda.gov/safety/recalls/country-eggs-salmonella-2026',
   'FDA', 1, 'Country Eggs LLC recalls shell eggs due to salmonella contamination',
   now() - interval '11 days'),
  ('Salmonella — Country Eggs brand shell eggs',
   'https://www.cdc.gov/salmonella/country-eggs-08-26/index.html',
   'CDC', 1, 'Salmonella outbreak linked to shell eggs: 42 cases across 12 states',
   now() - interval '5 days'),
  ('Salmonella — Country Eggs brand shell eggs',
   'https://www.foodsafetynews.com/2026/08/egg-recall-expands-hospitalizations/',
   'Food Safety News', 2, 'Egg recall expands as hospitalizations climb',
   now() - interval '2 days'),

  -- deli meat: official + national outlet
  ('Listeria — sliced deli meats from Harborview Provisions',
   'https://www.cdc.gov/listeria/outbreaks/deli-meat-08-26/index.html',
   'CDC', 1, 'Listeria outbreak linked to meats sliced at deli counters',
   now() - interval '24 days'),
  ('Listeria — sliced deli meats from Harborview Provisions',
   'https://www.npr.org/2026/08/deli-meat-listeria-recall',
   'NPR Health', 2, 'Deli meat recall widens amid listeria investigation',
   now() - interval '6 days'),

  -- romaine: two independent outlets, no official notice
  ('E. coli — romaine lettuce linked to Taylor Farms product',
   'https://www.foodsafetynews.com/2026/08/romaine-e-coli-western-states/',
   'Food Safety News', 2, 'E. coli illnesses in three western states point to romaine',
   now() - interval '19 days'),
  ('E. coli — romaine lettuce linked to Taylor Farms product',
   'https://foodpoisoningbulletin.com/2026/romaine-e-coli-chipotle-servings/',
   'Food Poisoning Bulletin', 2, 'Investigators look at romaine served at Chipotle locations',
   now() - interval '12 days'),

  -- bagged salad: single established outlet
  ('Cyclospora — bagged salad kits in the Northeast',
   'https://www.foodsafetynews.com/2026/08/cyclospora-salad-kits-northeast/',
   'Food Safety News', 2, 'Cyclospora cluster tied to Northeast salad kits',
   now() - interval '28 days'),
  ('Cyclospora — bagged salad kits in the Northeast',
   'https://www.foodsafetynews.com/2026/08/cyclospora-salad-kits-update/',
   'Food Safety News', 2, 'Cyclospora case count rises to 31 in salad kit cluster',
   now() - interval '20 days'),

  -- cucumbers: official recall
  ('Salmonella — whole cucumbers from Del Sol Produce',
   'https://www.fda.gov/safety/recalls/del-sol-cucumbers-salmonella-2026',
   'FDA', 1, 'Del Sol Produce recalls whole cucumbers over salmonella',
   now() - interval '31 days'),

  -- ice cream: official, recall only
  ('Listeria — Northfield Creamery ice cream recall',
   'https://www.fda.gov/safety/recalls/northfield-creamery-listeria-2026',
   'FDA', 1, 'Northfield Creamery recalls ice cream pints after listeria finding',
   now() - interval '9 days'),

  -- flour: a single unverified local report
  ('E. coli — reports of illness linked to raw flour',
   'https://www.hillcountryledger.example/news/raw-flour-illness-cluster',
   'Hill Country Ledger', 3, 'Local families report illness after eating raw cookie dough',
   now() - interval '3 days'),

  -- oysters: established outlet + a smaller one
  ('Norovirus — raw oysters harvested in the Pacific Northwest',
   'https://www.foodsafetynews.com/2026/08/norovirus-oysters-pacific-northwest/',
   'Food Safety News', 2, 'Norovirus illnesses prompt Pacific Northwest oyster closures',
   now() - interval '18 days'),
  ('Norovirus — raw oysters harvested in the Pacific Northwest',
   'https://www.coastwatchdaily.example/oyster-harvest-closures',
   'Coast Watch Daily', 3, 'Harvest areas closed after diners fall ill',
   now() - interval '15 days'),

  -- onions: dormant past event
  ('Salmonella — imported red onions',
   'https://www.fda.gov/safety/recalls/imported-red-onions-salmonella',
   'FDA', 1, 'FDA warns consumers not to eat imported red onions',
   now() - interval '260 days'),
  ('Salmonella — imported red onions',
   'https://www.cdc.gov/salmonella/red-onions/index.html',
   'CDC', 1, 'Salmonella outbreak linked to red onions declared over',
   now() - interval '220 days')
) AS v(outbreak_title, url, source_name, source_tier, headline, published_at)
JOIN outbreaks o ON o.title = v.outbreak_title;
