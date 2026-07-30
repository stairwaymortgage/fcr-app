-- ==========================================================
-- Pre-computed contractor counts on the reference tables
-- Created 2026-07-30. SAFE TO RUN IN THE SUPABASE SQL EDITOR.
-- ==========================================================
--
-- WHY THIS DOES NOT NEED BATCHING
--
-- The slug backfill needed batching because it worked ROW BY ROW — for each of
-- 266,305 rows it computed a base slug and probed the unique index for a free
-- suffix. That is 266k round trips through plpgsql, which is what exhausted the
-- browser editor's timeout.
--
-- These statements are aggregates. Each one is a SINGLE GROUP BY over
-- contractors, so Postgres makes one pass and writes 67 or 710 rows. That is
-- sub-second work, not 266k operations, and the editor will not notice it.
--
-- If the editor does time out anyway, say so and the population can be driven
-- from Node instead: compute the aggregates locally and PATCH 777 reference
-- rows through PostgREST. It is slower but needs no SQL editor.
--
-- ----------------------------------------------------------
-- WHY PRE-COMPUTE AT ALL
--
-- /counties fired 67 concurrent COUNT queries per page load, because
-- reference_counties has no contractor_count column while reference_cities and
-- reference_license_types do. The numbers only change when the weekly DBPR sync
-- runs, so counting them on every visit is waste. After this, /counties and
-- /cities read a stored integer.
--
-- ----------------------------------------------------------
-- COUNTS ARE SCOPED TO state = 'FL', AND THAT IS A CORRECTION, NOT A
-- REFINEMENT.
--
-- 27,250 of the 266,305 records carry a non-Florida state — GA 4,231, TX 2,735,
-- AL 1,898, NC 1,584 and so on. These are contractors licensed in Florida with
-- an out-of-state mailing address.
--
-- Counting a CITY by name alone therefore mixes states. reference_cities has a
-- row for Birmingham; the live count for city = 'BIRMINGHAM' is 277, of which
-- 257 are Birmingham ALABAMA and exactly 1 is in Florida. Without the state
-- filter, a Florida registry publishes a Birmingham page listing Alabama
-- contractors.
--
-- The existing reference_cities.contractor_count is ALSO wrong, differently:
-- 168 of its 710 values disagree with a live count. It appears to have been
-- derived with county scoping and some spelling normalisation, so St.
-- Petersburg reads 3,353 against 2,802 for the exact name. This migration
-- replaces every value rather than patching the ones that look wrong.
--
-- NOT scoped by county_code, deliberately. 356 city names appear under more
-- than one county code in the extract (JACKSONVILLE under 12), which is DBPR
-- noise rather than geography. Scoping by county would silently drop
-- contractors whose county code is wrong; the city pages show each row's own
-- county instead, so a mismatch is visible.
-- ==========================================================


-- ----- reference_counties -----

ALTER TABLE reference_counties
  ADD COLUMN IF NOT EXISTS contractor_count integer NOT NULL DEFAULT 0;

-- Single pass. Counties with no in-state contractors are reset to 0 by the
-- COALESCE rather than left at a stale value.
UPDATE reference_counties rc
SET contractor_count = COALESCE(c.n, 0)
FROM (
  SELECT county_code, count(*) AS n
  FROM contractors
  WHERE state = 'FL' AND county_code IS NOT NULL
  GROUP BY county_code
) c
WHERE rc.county_code = c.county_code;

-- Counties absent from the aggregate entirely (no matching rows at all).
UPDATE reference_counties
SET contractor_count = 0
WHERE county_code NOT IN (
  SELECT county_code FROM contractors
  WHERE state = 'FL' AND county_code IS NOT NULL
  GROUP BY county_code
);


-- ----- reference_cities -----

-- Matched on upper(city_name) because contractors.city is uppercase throughout
-- the extract while reference_cities.city_name is title case.
UPDATE reference_cities rc
SET contractor_count = COALESCE(c.n, 0)
FROM (
  SELECT upper(trim(city)) AS city_key, count(*) AS n
  FROM contractors
  WHERE state = 'FL' AND city IS NOT NULL
  GROUP BY upper(trim(city))
) c
WHERE upper(rc.city_name) = c.city_key;

-- Cities with no Florida contractors under that exact name — Birmingham is the
-- clearest case. Zero is the honest number; the old value was not.
UPDATE reference_cities
SET contractor_count = 0
WHERE upper(city_name) NOT IN (
  SELECT upper(trim(city)) FROM contractors
  WHERE state = 'FL' AND city IS NOT NULL
  GROUP BY upper(trim(city))
);


-- ==========================================================
-- VERIFY — all instant
--
--   -- every county has a count, and they sum to the in-state total
--   SELECT count(*) FROM reference_counties WHERE contractor_count IS NULL;  -- 0
--   SELECT sum(contractor_count) FROM reference_counties;
--   SELECT count(*) FROM contractors WHERE state='FL' AND county_code IS NOT NULL;
--   -- the last two must match
--
--   -- Broward should read 21,531 minus any out-of-state rows
--   SELECT county_name, contractor_count FROM reference_counties
--   WHERE county_slug = 'broward';
--
--   -- Birmingham must now be 1, not 277
--   SELECT city_name, contractor_count FROM reference_cities
--   WHERE city_slug = 'birmingham';
--
--   -- Miami should read ~16,195
--   SELECT city_name, contractor_count FROM reference_cities
--   WHERE city_slug = 'miami';
--
-- MAINTENANCE: the weekly DBPR sync must re-run both UPDATE statements after
-- it finishes upserting, or these counts drift exactly the way the previous
-- reference_cities values did.
-- ==========================================================
