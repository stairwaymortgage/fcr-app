-- ==========================================================
-- contractors.slug — stable public profile URLs
-- Created 2026-07-30. Revised for batched execution.
--
-- RUN IN THREE PARTS. Parts 1 and 3 go in the Supabase SQL editor and finish
-- instantly. Part 2 is the heavy one and is driven from a local script.
-- ==========================================================
--
-- WHY IT IS SPLIT
--
-- The original single-file version timed out in the browser SQL editor with
-- "Failed to fetch". Only ONE statement is expensive — the backfill UPDATE over
-- 266,305 rows. Everything else is catalogue-only (ADD COLUMN, CREATE FUNCTION,
-- CREATE TRIGGER) and returns in milliseconds regardless of table size.
--
-- So the backfill becomes a function that processes N rows per call and reports
-- how many it did. A local script calls it repeatedly until it returns 0. Each
-- call is its own short transaction, so nothing runs long enough to time out
-- and a failure part-way through simply leaves the remaining rows NULL for the
-- next call to pick up.
--
-- THE SLUG LOGIC STAYS ENTIRELY IN SQL. The driving script only calls the
-- function and counts — it never computes a slug. That keeps one implementation
-- for the backfill, the insert trigger, and any future repair.
--
-- ----------------------------------------------------------
-- WHY A STORED COLUMN AT ALL
--
-- Measured across all 266,305 rows on 2026-07-30, the obvious scheme
-- {business_name}-{license_number}-{city} produces 950 colliding groups and
-- 1,080 unreachable profiles. pinch-a-penny-tampa alone maps to 18 contractors.
--
-- 125,348 rows have license_number IS NULL, so for those the licence component
-- vanishes and the slug collapses to {name}-{city}. A further 140 licence
-- numbers are shared by 280 rows (CRS continuing-education records), so the
-- licence number is not unique even where it exists.
--
-- Adding columns does not fix it. Even slugify(dbpr_sync_key) — the PRIMARY KEY
-- — still collides once, because slugifying is lossy. Uniqueness cannot be
-- DERIVED; it is ENFORCED here by a UNIQUE index plus a -2/-3 suffix.
--
-- Slugs are STORED because slugifying cannot be reversed: a computed slug would
-- have to be resolved by parsing the licence number back out of the URL, which
-- is impossible for the 125,348 rows that have none.
--
-- THIS SQL IS THE ONLY SLUG IMPLEMENTATION. The app SELECTs the column and uses
-- it verbatim for hrefs. A TypeScript reimplementation that disagreed on one
-- accent or comma would emit links that 404 while both halves looked correct.
-- ==========================================================


-- ==========================================================
-- PART 1 — SQL EDITOR. Instant: no table scan, catalogue changes only.
-- ==========================================================

CREATE EXTENSION IF NOT EXISTS unaccent;

ALTER TABLE contractors ADD COLUMN IF NOT EXISTS slug text;

-- Partial UNIQUE index, created BEFORE the backfill for two reasons: it makes
-- the per-row "is this slug taken" probe below an index lookup rather than a
-- scan, and it guarantees correctness even if two batches somehow overlap.
-- NULLs never conflict in a btree, so an all-NULL column indexes fine.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contractors_slug
  ON contractors(slug);

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
    -- nullif(..., '') IS LOAD-BEARING. concat_ws returns an EMPTY STRING when
    -- every argument is NULL, never NULL, so without this the coalesce would
    -- accept '' and the fallbacks would never fire — giving that row an empty
    -- slug and a URL of /contractor/. No current row hits this; a future
    -- extract with an all-punctuation name would.
    nullif(
      concat_ws('-',
        contractor_slugify(coalesce(business_name, qualifying_agent_name)),
        contractor_slugify(license_number),
        contractor_slugify(city)
      ),
      ''
    ),
    contractor_slugify(dbpr_sync_key),
    'contractor'
  );
$$;

/*
 * Assign slugs to at most `batch_size` rows. Returns how many it assigned.
 *
 * ORDERED BY dbpr_sync_key SO THE RESULT IS REPRODUCIBLE. That ordering decides
 * which of the 18 Pinch A Penny rows keeps the bare slug and which become
 * -2 … -18. Any non-deterministic order would reassign suffixes on a re-run,
 * silently repointing live URLs at different contractors.
 *
 * The suffix loop probes the UNIQUE index created above, so it costs an index
 * lookup per candidate rather than a scan.
 */
CREATE OR REPLACE FUNCTION contractor_backfill_slugs(batch_size int DEFAULT 5000)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  r          record;
  base_slug  text;
  candidate  text;
  suffix     int;
  done       int := 0;
BEGIN
  FOR r IN
    SELECT dbpr_sync_key, business_name, qualifying_agent_name,
           license_number, city
    FROM contractors
    WHERE slug IS NULL
    ORDER BY dbpr_sync_key
    LIMIT batch_size
  LOOP
    base_slug := contractor_base_slug(r.business_name, r.qualifying_agent_name,
                                      r.license_number, r.city, r.dbpr_sync_key);
    candidate := base_slug;
    suffix    := 1;

    WHILE EXISTS (SELECT 1 FROM contractors WHERE slug = candidate) LOOP
      suffix    := suffix + 1;
      candidate := base_slug || '-' || suffix;
    END LOOP;

    UPDATE contractors SET slug = candidate WHERE dbpr_sync_key = r.dbpr_sync_key;
    done := done + 1;
  END LOOP;

  RETURN done;
END;
$$;

-- THIS FUNCTION MUST NOT BE PUBLICLY CALLABLE. PostgREST exposes every function
-- in the public schema as an RPC endpoint, so without this revoke any anonymous
-- visitor could POST to /rest/v1/rpc/contractor_backfill_slugs and start a
-- 266k-row write loop. service_role still has it, which is how the local script
-- drives the backfill.
REVOKE EXECUTE ON FUNCTION contractor_backfill_slugs(int) FROM PUBLIC, anon, authenticated;


-- ==========================================================
-- PART 2 — LOCAL SCRIPT, NOT THIS FILE.
--
--   node scripts/run-slug-migration.mjs
--
-- Calls contractor_backfill_slugs(5000) repeatedly until it returns 0.
-- Roughly 54 calls for 266,305 rows. Safe to stop and re-run: it only ever
-- touches rows where slug IS NULL.
-- ==========================================================


-- ==========================================================
-- PART 3 — SQL EDITOR, after Part 2 reports 0 remaining. Instant.
-- ==========================================================

-- Fails loudly if any row is still unpopulated, which is the behaviour we want:
-- better a failed migration than a silently unreachable profile.
ALTER TABLE contractors ALTER COLUMN slug SET NOT NULL;

/*
 * New rows get a slug automatically, so the weekly DBPR sync cannot forget.
 *
 * BEFORE INSERT ONLY, DELIBERATELY. The sync UPSERTs; an ON UPDATE trigger
 * would recompute the slug whenever DBPR changed a business name or city, and
 * every inbound link and indexed URL for that contractor would break. A slug is
 * assigned once and belongs to that row for good.
 */
CREATE OR REPLACE FUNCTION contractors_assign_slug()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  base_slug text;
  candidate text;
  suffix    int := 1;
BEGIN
  IF NEW.slug IS NOT NULL THEN
    RETURN NEW;
  END IF;

  base_slug := contractor_base_slug(NEW.business_name, NEW.qualifying_agent_name,
                                    NEW.license_number, NEW.city, NEW.dbpr_sync_key);
  candidate := base_slug;

  WHILE EXISTS (SELECT 1 FROM contractors WHERE slug = candidate) LOOP
    suffix    := suffix + 1;
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
-- VERIFY (SQL editor, all instant)
--
--   SELECT count(*) FROM contractors WHERE slug IS NULL;          -- expect 0
--
--   SELECT count(*) FROM (
--     SELECT slug FROM contractors GROUP BY slug HAVING count(*) > 1
--   ) d;                                                          -- expect 0
--
--   SELECT slug FROM contractors WHERE license_number = 'CGC1520921';
--   -- expect aceca-construction-inc-cgc1520921-davie
--
--   SELECT slug FROM contractors
--   WHERE slug LIKE 'pinch-a-penny-tampa%' ORDER BY slug;  -- expect 18 rows
-- ==========================================================
