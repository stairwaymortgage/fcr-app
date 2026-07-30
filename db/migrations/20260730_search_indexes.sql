-- ==========================================================
-- Search indexes — trigram coverage for /search
-- Created 2026-07-30. RUN THIS IN THE SUPABASE SQL EDITOR.
-- ==========================================================
--
-- WHY THIS EXISTS
--
-- _handoff/08_database/02_indexes.sql was run and pg_trgm IS enabled, but it
-- creates exactly one trigram index — on business_name. /search matches four
-- columns, so three of them fall back to a sequential scan over 266,305 rows.
--
-- Measured against the live project on 2026-07-30, best of three runs, with a
-- ~300ms baseline round trip (an indexed btree equality lookup):
--
--   license_number = 'CGC1520921'          300ms   btree, indexed
--   business_name ILIKE '%aceca%'          293ms   trigram, indexed  <- fast
--   city ILIKE '%davie%'                   864ms   SEQ SCAN
--   qualifying_agent_name ILIKE '%aceca%' 1006ms   SEQ SCAN
--   address_line ILIKE '%greenbrier%'     1034ms   SEQ SCAN (control, no index)
--
-- The two uncovered search columns land within noise of the unindexed control,
-- which is what identifies them as scans rather than index probes. business_name
-- lands on the baseline, which is what confirms pg_trgm works and the extension
-- does not need enabling.
--
-- After this migration all four columns are trigram-covered, so the OR across
-- them can be served by a BitmapOr of four index scans instead of one scan of
-- the whole table.
--
-- ----------------------------------------------------------
-- LOCKING. Plain CREATE INDEX takes a SHARE lock: it blocks WRITES to
-- contractors for the duration but does NOT block reads, so the live site stays
-- up. The only writer is the weekly DBPR sync, so run this any time that is not
-- mid-sync and the lock costs nothing.
--
-- If you would rather not block writes at all, add CONCURRENTLY to each
-- statement — but then each must run on its own, outside any transaction block,
-- and a failed build leaves an INVALID index you have to drop by hand. Plain is
-- the better trade here.
-- ----------------------------------------------------------

-- Already enabled — included so this file is self-contained on a fresh project.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Qualifying agent: the individual licensee. NOT NULL on every row, and the
-- display name whenever business_name is absent (~125k rows), so a name search
-- that skips it misses every sole-qualifier record.
CREATE INDEX IF NOT EXISTS idx_contractors_qualifying_agent_trgm
  ON contractors USING gin (qualifying_agent_name gin_trgm_ops);

-- City: "davie roofing" and "miami" are expected query shapes, and city is one
-- of the four columns /search fans out across.
CREATE INDEX IF NOT EXISTS idx_contractors_city_trgm
  ON contractors USING gin (city gin_trgm_ops);

-- Licence number: the existing btree serves `=` (already fast) but cannot serve
-- ILIKE '%1520921%' or a prefix under this database's collation, so a partial
-- licence number scans today. /search does exact-match first and only falls
-- back to substring, but the fallback should not cost a full scan.
CREATE INDEX IF NOT EXISTS idx_contractors_license_number_trgm
  ON contractors USING gin (license_number gin_trgm_ops);

-- ==========================================================
-- VERIFY AFTER RUNNING
--
--   EXPLAIN ANALYZE
--   SELECT dbpr_sync_key FROM contractors
--   WHERE qualifying_agent_name ILIKE '%acero%';
--
-- Expect "Bitmap Index Scan on idx_contractors_qualifying_agent_trgm".
-- If it still says "Seq Scan on contractors", the index did not build —
-- check for an error above rather than assuming it worked.
--
-- Then re-run the timings in the header. Expect city and qualifying_agent_name
-- to drop to roughly the 300ms baseline.
-- ==========================================================
