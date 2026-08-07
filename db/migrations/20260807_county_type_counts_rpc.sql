-- ==========================================================
-- county_type_counts() — 18 round trips collapsed into 1
-- Created 2026-08-07. NOT YET APPLIED.
-- ==========================================================
--
-- ✅ THIS FILE IS SAFE TO PASTE AND RUN AS ONE BATCH, unlike
-- 20260807_browse_indexes.sql. Nothing here uses CONCURRENTLY or VACUUM, so the
-- SQL Editor's implicit transaction is fine and is in fact what you want — the
-- function and its grants land together or not at all.
--
-- ⚠ DEPLOY ORDER: THIS FILE FIRST, THEN THE CODE. lib/browse.ts calls this
-- function by name. With the code deployed and this not yet run, every county
-- page's licence-type filter panel fails with PGRST202 ("Could not find the
-- function"). The counts are wrapped so the page still renders, but it renders
-- with no filter counts at all — a visible, silent-looking regression.
--
--
-- ==========================================================
-- WHAT IT REPLACES
-- ==========================================================
--
-- getTypeCountsInCounty() in lib/browse.ts issues ONE count(*) PER LICENCE TYPE,
-- concurrently — about 18 of them on a populated county, each a separate HTTP
-- request to PostgREST and a separate bitmap scan:
--
--   SELECT count(*) FROM contractors WHERE county_code=$1 AND license_type=$2
--
-- Measured on the live table 2026-08-07, county_code '13' (Miami-Dade):
--
--   one type count            13.9 ms   x ~18 requests
--   this GROUP BY, all 29     50.9 ms   x 1 request
--
-- The database time is comparable; the round trips are not. Eighteen sequential
-- HTTP requests from a Vercel function to Supabase cost far more in connection
-- and latency overhead than the 51 ms of query time this replaces them with.
--
-- ⚠ IT RETURNS EVERY TYPE PRESENT, INCLUDING ZERO-COUNT ONES BEING ABSENT.
-- A GROUP BY only produces rows for types that occur, which is exactly what the
-- old code produced after its `.filter(([, n]) => n > 0)`. The caller must keep
-- treating "missing key" as zero rather than assuming all 29 keys are present.
--
--
-- ==========================================================
-- WHY SECURITY INVOKER (THE DEFAULT), NOT SECURITY DEFINER
-- ==========================================================
--
-- Deliberate, and the opposite of approve_claim() / update_own_contractor_profile().
-- Those need DEFINER because they perform a privileged write the caller must not
-- be able to do directly. This one only reads data that is already world-readable:
--
--   "public read contractors"  SELECT  {anon,authenticated}  USING (true)
--
-- As INVOKER it executes with the caller's rights, so RLS still applies and the
-- function cannot return a single row the caller could not have selected
-- themselves. A DEFINER function here would be a standing privilege escalation
-- with no benefit — and it is the kind that gets copied into the next function
-- that does need care.
--
-- STABLE and PARALLEL SAFE: it reads, never writes, and returns the same result
-- within a statement. Both let the planner do more with it.
--
-- SET search_path is pinned regardless of INVOKER/DEFINER, so the function
-- cannot be redirected by a caller's search_path.


-- ----------------------------------------------------------
-- THE FUNCTION
-- ----------------------------------------------------------
--
-- ⚠ THE ZZTEST EXCLUSION MUST STAY IN STEP WITH lib/test-rows.ts.
--
-- The pattern below is duplicated from TEST_ROW_LIKE. That duplication is
-- deliberate and unavoidable — a SQL function cannot import a TypeScript
-- constant — but it is a real seam: change the prefix in one place and the
-- counts silently start including synthetic rows while the listing beside them
-- excludes them, so a county page would show "CGC (7)" above six results.
--
-- If the prefix ever changes, grep for BOTH 'ZZTEST' and TEST_ROW_LIKE.
-- scripts/verify-test-row-isolation.mjs asserts the two agree.

CREATE OR REPLACE FUNCTION public.county_type_counts(p_county_code text)
RETURNS TABLE (type_code text, n bigint)
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public, pg_catalog
AS $$
  SELECT c.license_type, count(*)
    FROM public.contractors c
   WHERE c.county_code = p_county_code
     AND c.dbpr_sync_key NOT LIKE 'ZZTEST%'
   GROUP BY c.license_type;
$$;

COMMENT ON FUNCTION public.county_type_counts(text) IS
  'Licence-type counts within one county, for the county page filter panel. Replaces ~18 per-type count round trips with one GROUP BY. SECURITY INVOKER - reads only public data under RLS. Excludes synthetic ZZTEST_ rows; keep in step with lib/test-rows.ts.';

-- Callable by the public, because the page that calls it is public and the data
-- it returns already is. REVOKE FROM PUBLIC first so the grant is explicit
-- rather than inherited from a platform default.
REVOKE ALL ON FUNCTION public.county_type_counts(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.county_type_counts(text) TO anon, authenticated;


-- ==========================================================
-- AFTER RUNNING, CONFIRM
-- ==========================================================
--
--   -- returns one row per licence type present in Miami-Dade
--   SELECT * FROM county_type_counts('13') ORDER BY n DESC;
--   -- expect ~29 rows, CGC largest. Sum should equal the county total:
--   SELECT sum(n) FROM county_type_counts('13');          -- 26632
--   SELECT count(*) FROM contractors
--    WHERE county_code = '13' AND dbpr_sync_key NOT LIKE 'ZZTEST%';   -- 26632
--   -- If these two disagree, the WHERE clauses have drifted apart.
--
--   -- an unknown county returns zero rows, not an error
--   SELECT count(*) FROM county_type_counts('ZZ');        -- 0
--
--   -- and it is callable with the ANON key, which is how the page calls it
--   curl -s -X POST \
--     "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/county_type_counts" \
--     -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
--     -H "Content-Type: application/json" \
--     -d '{"p_county_code":"13"}'
--   -- MUST return a JSON array of {type_code, n}. A 404 with PGRST202 means the
--   -- GRANT did not take and every county page will render with no filter counts.
-- ==========================================================
