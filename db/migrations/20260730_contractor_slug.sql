-- ==========================================================
-- contractors.slug — stable public profile URLs
-- Created 2026-07-30. RUN THIS IN THE SUPABASE SQL EDITOR.
-- ==========================================================
--
-- WHY A STORED COLUMN AND NOT A DERIVED SLUG
--
-- Measured across all 266,305 rows on 2026-07-30, the obvious scheme
-- {business_name}-{license_number}-{city} produces 950 colliding groups and
-- 1,080 unreachable profiles. Worst case: pinch-a-penny-tampa maps to 18
-- different contractors.
--
-- The cause is that 125,348 rows have license_number IS NULL — the QB
-- qualifying-business records. For those the licence component disappears and
-- the slug collapses to {name}-{city}, which is not unique for franchises.
--
-- Adding more columns does not fix it:
--   name + licence + city                  1,080 unreachable
--   name + licence_type + licence + city    1,080 unreachable  (all QB anyway)
--   name + licence + city + original_date      10 unreachable
--   slugify(dbpr_sync_key)  (the PRIMARY KEY)   1 unreachable  <- still not 0
--
-- Even the primary key collides, because slugifying is lossy: two punctuation
-- variants of "NORTH FLORIDA METAL ROOFING, L.L.C." reduce to one string.
-- Uniqueness therefore cannot be DERIVED. It has to be ENFORCED, which is what
-- the unique index plus the -2/-3 suffix below do. After this runs the count is
-- 0 by construction, not by luck.
--
-- Slugs must also be STORED rather than computed per request: slugifying cannot
-- be reversed, so a computed slug would have to be resolved by pulling the
-- licence number back out of the URL — impossible for the 125,348 rows that
-- have none. A stored column gives one indexed lookup that works for every row.
--
-- ----------------------------------------------------------
-- THIS SQL IS THE ONLY SLUG IMPLEMENTATION. Do not add a second one in
-- TypeScript. The app must SELECT the slug column and use it verbatim for
-- hrefs; a JS reimplementation that disagreed on one row — one accent, one
-- punctuation mark — would emit a link that 404s while both halves looked
-- correct in isolation. lib/contractor-slug.ts is retired by this migration.
-- ----------------------------------------------------------

-- unaccent so "PEÑA CONSTRUCTION" becomes pena-construction rather than
-- pe-a-construction. Standard contrib module, available on Supabase.
CREATE EXTENSION IF NOT EXISTS unaccent;

ALTER TABLE contractors ADD COLUMN IF NOT EXISTS slug text;

-- IMMUTABLE so it can be used in an index expression if ever needed, and so the
-- planner can fold it. STRICT: NULL in, NULL out, which is what lets concat_ws
-- below drop absent components cleanly.
CREATE OR REPLACE FUNCTION contractor_slugify(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT nullif(
    trim(both '-' from regexp_replace(lower(unaccent(value)), '[^a-z0-9]+', '-', 'g')),
    ''
  );
$$;

-- The base slug for a row, before any uniqueness suffix.
-- concat_ws skips NULL components, so a row with no licence number yields
-- {name}-{city} and a row with no city yields {name}-{licence}.
CREATE OR REPLACE FUNCTION contractor_base_slug(
  business_name text,
  qualifying_agent_name text,
  license_number text,
  city text,
  dbpr_sync_key text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(
    -- nullif(..., '') IS LOAD-BEARING, not defensive noise. concat_ws returns
    -- an EMPTY STRING when every argument is NULL, never NULL — so without this
    -- the coalesce below would accept '' as a real value and the fallbacks
    -- would never fire, giving that row an empty slug and a URL of
    -- /contractor/. No row in the current 266,305 hits this (verified by
    -- simulating the whole expression on 2026-07-30), but a future DBPR extract
    -- whose name, licence and city are all punctuation would.
    nullif(
      concat_ws('-',
        contractor_slugify(coalesce(business_name, qualifying_agent_name)),
        contractor_slugify(license_number),
        contractor_slugify(city)
      ),
      ''
    ),
    -- Last resort: a row whose name, licence and city all slugify to nothing.
    -- The PK always yields something, and the unique suffix below handles the
    -- one case where two PKs reduce to the same string.
    contractor_slugify(dbpr_sync_key),
    'contractor'
  );
$$;

-- ----------------------------------------------------------
-- BACKFILL
--
-- ORDER BY dbpr_sync_key IN THE WINDOW IS LOAD-BEARING. It decides which of the
-- 18 Pinch A Penny rows keeps the bare slug and which become -2 … -18. Ordering
-- by anything non-deterministic — or re-running this after rows change — would
-- reassign those suffixes, silently repointing live URLs at different
-- contractors and invalidating whatever Google has indexed. dbpr_sync_key is
-- the primary key, so the assignment is reproducible.
--
-- Guarded by "WHERE slug IS NULL" so re-running is safe: already-assigned slugs
-- are never recomputed.
-- ----------------------------------------------------------
WITH base AS (
  SELECT
    dbpr_sync_key,
    contractor_base_slug(business_name, qualifying_agent_name,
                         license_number, city, dbpr_sync_key) AS raw
  FROM contractors
  WHERE slug IS NULL
),
numbered AS (
  SELECT
    dbpr_sync_key,
    raw,
    row_number() OVER (PARTITION BY raw ORDER BY dbpr_sync_key) AS n
  FROM base
)
UPDATE contractors c
SET slug = CASE WHEN x.n = 1 THEN x.raw ELSE x.raw || '-' || x.n END
FROM numbered x
WHERE c.dbpr_sync_key = x.dbpr_sync_key;

-- Enforces the uniqueness the scheme cannot provide, AND serves the profile
-- lookup. One index, both jobs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contractors_slug
  ON contractors(slug);

ALTER TABLE contractors ALTER COLUMN slug SET NOT NULL;

-- ----------------------------------------------------------
-- NEW ROWS
--
-- The weekly DBPR sync inserts contractors. Without this trigger those rows
-- would land with slug NULL — which the NOT NULL above now rejects outright,
-- so the sync would start failing rather than quietly producing unreachable
-- profiles. Either way the trigger is what keeps it working.
--
-- BEFORE INSERT ONLY, DELIBERATELY. The sync UPSERTs, so an ON UPDATE trigger
-- would recompute the slug whenever DBPR changed a business name or city — and
-- every existing inbound link and indexed URL would break. A slug is assigned
-- once and then belongs to that row for good.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION contractors_assign_slug()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  base_slug text;
  candidate text;
  suffix int := 1;
BEGIN
  -- An explicitly supplied slug is respected, so a backfill or data fix can set
  -- one deliberately.
  IF NEW.slug IS NOT NULL THEN
    RETURN NEW;
  END IF;

  base_slug := contractor_base_slug(NEW.business_name, NEW.qualifying_agent_name,
                                    NEW.license_number, NEW.city, NEW.dbpr_sync_key);
  candidate := base_slug;

  WHILE EXISTS (SELECT 1 FROM contractors WHERE slug = candidate) LOOP
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix;
  END LOOP;

  NEW.slug := candidate;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contractors_assign_slug ON contractors;
CREATE TRIGGER trg_contractors_assign_slug
  BEFORE INSERT ON contractors
  FOR EACH ROW
  EXECUTE FUNCTION contractors_assign_slug();

-- ==========================================================
-- VERIFY AFTER RUNNING — all four should hold
--
--   -- 1. every row has a slug
--   SELECT count(*) AS missing FROM contractors WHERE slug IS NULL;
--   -- expect 0
--
--   -- 2. zero collisions across all 266,305 rows
--   SELECT count(*) AS colliding_groups FROM (
--     SELECT slug FROM contractors GROUP BY slug HAVING count(*) > 1
--   ) d;
--   -- expect 0
--
--   -- 3. the mockup's example resolves
--   SELECT slug FROM contractors WHERE license_number = 'CGC1520921';
--   -- expect aceca-construction-inc-cgc1520921-davie
--
--   -- 4. the franchise case got suffixed rather than dropped
--   SELECT slug FROM contractors
--   WHERE slug LIKE 'pinch-a-penny-tampa%' ORDER BY slug;
--   -- expect 18 rows: the bare slug plus -2 … -18
-- ==========================================================
