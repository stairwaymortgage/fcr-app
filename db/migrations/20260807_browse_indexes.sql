-- ==========================================================
-- BROWSE / LISTING INDEXES — TTFB work
-- Created 2026-08-07. NOT YET APPLIED.
-- ==========================================================
--
-- ⚠⚠ RUN EACH STATEMENT SEPARATELY. DO NOT PASTE THIS WHOLE FILE AND HIT RUN.
--
-- Every CREATE INDEX below uses CONCURRENTLY, and CONCURRENTLY CANNOT RUN
-- INSIDE A TRANSACTION BLOCK. The Supabase SQL Editor wraps a multi-statement
-- submission in one transaction, so pasting the file as a batch fails with:
--
--   ERROR: 25001: CREATE INDEX CONCURRENTLY cannot run inside a transaction block
--
-- Select ONE statement, run it, wait for it to finish, then the next. There are
-- four statements: three indexes and one VACUUM at the foot.
--
-- WHY CONCURRENTLY AT ALL: plain CREATE INDEX takes a SHARE lock and blocks
-- every write to public.contractors while it builds. That table has 266,305
-- rows and the weekly importer writes all of them. CONCURRENTLY builds without
-- blocking writers, at the cost of two table passes and the transaction rule
-- above. Same reasoning as the note in 20260730_search_indexes.sql, but that
-- file could use the plain form because the tables were small at the time.
--
-- EACH ONE TAKES ROUGHLY 10-40 SECONDS on this table. If a CONCURRENTLY build
-- fails partway it leaves an INVALID index behind, which is not used by the
-- planner and must be dropped before retrying:
--
--   SELECT indexrelid::regclass AS bad_index
--     FROM pg_index WHERE NOT indisvalid;
--   DROP INDEX CONCURRENTLY <name>;
--
--
-- ==========================================================
-- WHAT THESE FIX, MEASURED ON THE LIVE TABLE 2026-08-07
-- ==========================================================
--
-- Every listing query has the same shape: equality on ONE column, then
-- ORDER BY business_name, qualifying_agent_name, then LIMIT 25. Today only the
-- equality half is indexed, so Postgres bitmap-scans every matching row and
-- top-N sorts it to return 25.
--
--   /county/miami-dade   26,632 rows scanned and sorted     42-52 ms
--   /city/miami          16,202 rows, AND it falls through
--                        to the GIN trigram index          188 ms
--
-- ⚠ THE CITY CASE IS AN INDEX THAT LOOKS RIGHT AND IS NOT. There is already an
-- idx_contractors_city_tier, but it is on lower(city) while lib/browse.ts
-- filters plain `city`. An expression index only serves the exact expression, so
-- the planner ignores it and uses idx_contractors_city_trgm — a trigram index
-- doing an equality match, 153 ms in the index scan alone with 2,866 rows
-- removed by recheck. Do not "fix" this by lowercasing the query; the data is
-- stored upper-case and the equality is correct as written.
--
-- COLUMN NAMES BELOW ARE VERIFIED AGAINST information_schema.columns on the live
-- project, not transcribed from memory. All are text and all exist:
--   county_code, city, license_type, business_name, qualifying_agent_name
-- (There is no business_or_agent_name column — that spelling returns 42703.)
--
--
-- ==========================================================
-- WHAT IS DELIBERATELY *NOT* HERE
-- ==========================================================
--
-- NO INDEX FOR data-as-of. That query costs 1,660 ms today and is the single
-- largest component of TTFB on EVERY page, but the cause is in the application,
-- not the schema: it orders DESC NULLS LAST, and the existing
-- idx_contractors_last_sync is a default btree (ASC NULLS LAST) whose reverse is
-- DESC NULLS FIRST — so the ordering cannot be served from the index and all
-- 266,305 rows are scanned and sorted.
--
-- Dropping `nullsFirst: false` in lib/data-as-of.ts makes the EXISTING index
-- serve it via Index Only Scan Backward in 0.8 ms — a 2,000x improvement with no
-- new index. Adding a DESC NULLS LAST index instead would paper over the bug and
-- charge every future write for the privilege. The column is NOT NULL, so the
-- NULLS LAST guard was never doing anything.


-- ----------------------------------------------------------
-- STATEMENT 1 of 4 — county listings
-- ----------------------------------------------------------
-- Serves /county/[slug]: WHERE county_code = $1 ORDER BY business_name,
-- qualifying_agent_name LIMIT 25. Lets the planner walk the index and stop at
-- 25 rather than materialising the whole county.
--
-- Column order matters: the equality column FIRST, then the two sort columns in
-- the order the query sorts them. Reversing them makes the index useless here.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contractors_county_name
  ON public.contractors (county_code, business_name, qualifying_agent_name);


-- ----------------------------------------------------------
-- STATEMENT 2 of 4 — city listings
-- ----------------------------------------------------------
-- Serves /city/[slug]. This is the one replacing a 188 ms trigram scan; see the
-- note above on why idx_contractors_city_tier does not apply.
--
-- idx_contractors_city_tier is left in place. It is on lower(city) and may serve
-- a case-insensitive lookup elsewhere; dropping it is a separate decision from
-- adding this, and this file is about making the slow path fast.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contractors_city_name
  ON public.contractors (city, business_name, qualifying_agent_name);


-- ----------------------------------------------------------
-- STATEMENT 3 of 4 — licence-type listings
-- ----------------------------------------------------------
-- Serves /type/[code]. Same shape as the two above.
--
-- ⚠ THIS DOES NOT REPLACE idx_contractors_county_type_tier, which serves the
-- (county_code, license_type) pair used by the county page's ?type= filter and
-- by the type-count aggregate. Both are needed; they lead with different columns.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contractors_type_name
  ON public.contractors (license_type, business_name, qualifying_agent_name);


-- ----------------------------------------------------------
-- STATEMENT 4 of 4 — housekeeping
-- ----------------------------------------------------------
-- ⚠ ALSO RUN ON ITS OWN. VACUUM cannot run inside a transaction block either.
--
-- Unrelated to the indexes above, and visible in every index-only scan plan
-- taken today: the data-as-of query reported
--
--   Heap Fetches: 196191
--
-- on an INDEX ONLY scan. An index-only scan should fetch from the heap almost
-- never; 196k fetches means the visibility map is stale after the last import,
-- so Postgres cannot trust the index alone and visits the table anyway. That
-- tax is paid by every index-only scan on this table, not just that one query.
--
-- ANALYZE is included because the three new indexes above need statistics before
-- the planner will choose them confidently.
--
-- Expect this to take a few minutes on 266,305 rows. It is safe to run at any
-- time and does not block reads or writes.

VACUUM (ANALYZE) public.contractors;


-- ==========================================================
-- AFTER RUNNING, CONFIRM
-- ==========================================================
--
--   -- all three exist AND are valid (indisvalid = true)
--   SELECT c.relname AS index_name, i.indisvalid
--     FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
--    WHERE c.relname IN ('idx_contractors_county_name',
--                        'idx_contractors_city_name',
--                        'idx_contractors_type_name');
--   -- 3 rows, all indisvalid = t. A row with indisvalid = f means the
--   -- CONCURRENTLY build failed — drop it and re-run that statement.
--
--   -- the county plan should now be an Index Scan with no Sort node
--   EXPLAIN ANALYZE
--   SELECT dbpr_sync_key, slug, business_name, qualifying_agent_name
--     FROM contractors
--    WHERE county_code = '13' AND dbpr_sync_key NOT LIKE 'ZZTEST%'
--    ORDER BY business_name ASC NULLS LAST, qualifying_agent_name ASC
--    LIMIT 25;
--   -- BEFORE: Bitmap Heap Scan + top-N Sort, ~42-52 ms
--   -- AFTER:  Index Scan using idx_contractors_county_name, low single-digit ms
--
--   -- the city plan should stop using idx_contractors_city_trgm
--   EXPLAIN ANALYZE
--   SELECT dbpr_sync_key, slug, business_name, qualifying_agent_name
--     FROM contractors
--    WHERE city = 'MIAMI' AND dbpr_sync_key NOT LIKE 'ZZTEST%'
--    ORDER BY business_name ASC NULLS LAST, qualifying_agent_name ASC
--    LIMIT 25;
--   -- BEFORE: Bitmap Index Scan on idx_contractors_city_trgm, ~188 ms
--   -- AFTER:  Index Scan using idx_contractors_city_name, low single-digit ms
--
-- ⚠ IF THE PLANNER STILL PICKS THE OLD PLAN, the statistics are stale — run
-- statement 4 again. Do not force it with enable_bitmapscan or an index hint.
-- ==========================================================
