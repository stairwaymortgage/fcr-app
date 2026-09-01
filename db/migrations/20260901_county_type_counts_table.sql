-- ==========================================================
-- reference_county_type_counts — the county filter panel, denormalised
-- Created 2026-09-01. NOT YET APPLIED.
-- ==========================================================
--
-- ✅ SAFE TO PASTE AND RUN AS ONE BATCH. Nothing here uses CONCURRENTLY or
-- VACUUM, so the SQL Editor's implicit transaction is what you want — the
-- table, its policies, both function replacements and the grants land together
-- or not at all.
--
-- ⚠ DEPLOY ORDER: THIS FILE FIRST, THEN THE CODE — but the usual consequence
-- does not apply here, and that is deliberate. lib/browse.ts reads the new
-- table and FALLS BACK to county_type_counts() when it is missing or empty, so
-- shipping the code first degrades to exactly today's behaviour (a 440 ms RPC)
-- rather than an empty filter panel. Order still matters for the benefit, not
-- for correctness.
--
--
-- ==========================================================
-- WHY: A 3-SECOND CEILING OVER A 440 ms MEAN
-- ==========================================================
--
-- county_type_counts() is called by /county/[slug] to render the licence-type
-- filter panel. It runs as `anon`, and anon carries statement_timeout = 3s:
--
--   anon            statement_timeout = 3s     ← the ceiling
--   authenticated                     = 8s
--   service_role                      = 120s
--
-- The RPC's mean is 440.4 ms over 29,443 calls (pg_stat_statements, 34 days).
-- Its TAIL crosses 3s, and when it does the read fails 57014 and the page
-- renders with NO FILTER COUNTS AT ALL. That is not theoretical:
--
--   2026-09-01 04:04:59  /county/osceola  57014 canceling statement due to
--                        statement timeout   (in the incident logs)
--   2026-09-01 ~12:50    local verification of the Data-Cache work: first
--                        render of /county/broward showed 0 ?type= links
--                        against 56 on production, same 57014.
--
-- Caching it (lib/browse-cached.ts, 2026-09-01) reduced the exposure — 67 keys,
-- once a day each — but did not remove it: the failure moved to the FIRST
-- request after each invalidation, where it is rarer and therefore harder to
-- catch. A cache in front of a query that can fail is not a fix for the query.
--
-- ⚠ THE RPC IS KEPT, AS A FALLBACK, NOT DELETED. If the table is missing (this
-- file not yet run) or returns nothing for a county, lib/browse.ts calls the
-- RPC exactly as it does today. The failure mode this file removes is the
-- common path; the uncommon path keeps its existing behaviour rather than
-- gaining a new one.
--
--
-- ==========================================================
-- ⚠ NO state='FL' FILTER, MATCHING THE RPC IT REPLACES
-- ==========================================================
--
-- This is the one place a copy-paste from repair_reference_counts() would be
-- WRONG, so it is stated before the code rather than after.
--
-- reference_counties and reference_cities count WHERE state='FL'.
-- reference_license_types does not. county_type_counts() does not either, and
-- this table must match COUNTY_TYPE_COUNTS, not its sibling tables — because
-- the number it feeds sits above a list produced by getContractorPage() with
-- filters {county_code, license_type} and no state filter. A state-filtered
-- count over a non-state-filtered list is a badge that disagrees with the rows
-- beneath it.
--
-- MEASURED, county_code '13' (Miami-Dade), 2026-09-01:
--
--   county_code only, no ZZTEST         27,247   ← the RPC, and this table
--   county_code AND state='FL'          27,245
--   reference_counties.contractor_count 27,245
--
-- ⚠ THOSE LAST TWO ARE A PRE-EXISTING INCONSISTENCY AND THIS FILE DOES NOT
-- TOUCH IT. /county/[slug] renders the stored 27,245 as its unfiltered total
-- while its own list query would return 27,247 rows — the two out-of-state
-- records with a Miami-Dade county code. It is off by two on the largest
-- county and correspondingly less elsewhere. Worth fixing; not here, because
-- doing it inside a migration about filter counts would change a number on 67
-- live pages as a side effect of an unrelated change. Filed, not fixed.
--
--
-- ==========================================================
-- SIZE, AND WHY A TABLE RATHER THAN A MATERIALIZED VIEW
-- ==========================================================
--
-- 1,416 rows — every (county_code, license_type) pair that occurs. It is small
-- enough that the whole table is one or two pages of heap.
--
-- A MATERIALIZED VIEW would express this more directly, and is rejected for one
-- reason: REFRESH MATERIALIZED VIEW takes an ACCESS EXCLUSIVE lock (or needs
-- CONCURRENTLY plus a unique index, which cannot run inside the importer's
-- transaction). The three sibling reference tables are plain tables repaired by
-- UPDATE, Phase 4 already knows how to call one function, and a fourth table
-- repaired the same way costs nothing new to operate. Consistency with the
-- existing pattern beats elegance here.


-- ----------------------------------------------------------
-- THE TABLE
-- ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.reference_county_type_counts (
  county_code text    NOT NULL,
  type_code   text    NOT NULL,
  n           integer NOT NULL,
  PRIMARY KEY (county_code, type_code)
);

COMMENT ON TABLE public.reference_county_type_counts IS
  'Denormalised licence-type counts per county, for the /county/[slug] filter panel. Rebuilt by repair_reference_counts() in the importer Phase 4. Replaces the county_type_counts() RPC on the read path, which is kept as a fallback. NOT state-filtered - matches the RPC and the list query it sits above, not reference_counties.';

-- The PRIMARY KEY doubles as the read index: the only query is
-- WHERE county_code = $1, which is a prefix of (county_code, type_code).
-- No second index is created, deliberately - it would be redundant.

-- ---- RLS, matching the three sibling reference tables exactly ----
--
-- Same shape as "public read counties" / "admin write counties": the data is
-- already world-readable (it is an aggregate of contractors, which anon can
-- SELECT under "public read contractors"), and only an admin may write it
-- through the API. The importer writes as service_role, which bypasses RLS.

ALTER TABLE public.reference_county_type_counts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read county_type_counts" ON public.reference_county_type_counts;
CREATE POLICY "public read county_type_counts"
  ON public.reference_county_type_counts
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "admin write county_type_counts" ON public.reference_county_type_counts;
CREATE POLICY "admin write county_type_counts"
  ON public.reference_county_type_counts
  FOR ALL TO authenticated
  USING (is_admin());

-- Table privileges are separate from RLS and both must allow the read.
GRANT SELECT ON public.reference_county_type_counts TO anon, authenticated;
GRANT ALL    ON public.reference_county_type_counts TO service_role;


-- ----------------------------------------------------------
-- repair_reference_counts() — now four tables, not three
-- ----------------------------------------------------------
--
-- SIGNATURE IS UNCHANGED, so CREATE OR REPLACE is legal and existing privileges
-- survive it. The grants are re-asserted at the foot of this file anyway — see
-- 20260810's GRANTS section for why reading a REVOKE and reasoning about it is
-- exactly what shipped a bug last time.
--
-- ⚠ THE FIRST THREE BLOCKS ARE COPIED VERBATIM from 20260810_reference_counts_rpc.sql
-- and MUST stay that way. Nothing about what a correct county/city/type count
-- is has been revisited here; only a fourth block is added. If those blocks ever
-- diverge between the two files, this one is the newer and that file's header
-- explains the rules.
--
-- COST: a fourth aggregate, GROUP BY (county_code, license_type) over 271k rows
-- — the same shape as the three that precede it, so expect the phase to go from
-- roughly 12s to roughly 15-17s. Well inside service_role's 120s, which
-- STATEMENT 1 of 20260810 already granted and which this file depends on. If
-- that ALTER ROLE was ever reverted, this function fails 57014 like the others.
--
-- ⚠ THE ZZTEST EXCLUSION MUST STAY IN STEP WITH lib/test-rows.ts (TEST_ROW_LIKE
-- = 'ZZTEST%'). Same duplication, same reason, same remedy: grep for BOTH if
-- the prefix ever changes. scripts/verify-test-row-isolation.mjs asserts the
-- two agree, and its county_type_counts assertion covers this table too.

CREATE OR REPLACE FUNCTION public.repair_reference_counts()
RETURNS TABLE (table_name text, rows_repaired integer)
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_catalog
AS $$
DECLARE
  matched integer;
  zeroed  integer;
  removed integer;
BEGIN
  -- ---- reference_counties — count WHERE state='FL' ----
  UPDATE reference_counties rc
  SET contractor_count = COALESCE(c.n, 0)
  FROM (
    SELECT county_code, count(*) AS n
    FROM contractors
    WHERE state = 'FL'
      AND county_code IS NOT NULL
      AND dbpr_sync_key NOT LIKE 'ZZTEST%'
    GROUP BY county_code
  ) c
  WHERE rc.county_code = c.county_code
    AND rc.contractor_count IS DISTINCT FROM COALESCE(c.n, 0);
  GET DIAGNOSTICS matched = ROW_COUNT;

  UPDATE reference_counties
  SET contractor_count = 0
  WHERE contractor_count <> 0
    AND county_code NOT IN (
      SELECT county_code FROM contractors
      WHERE state = 'FL'
        AND county_code IS NOT NULL
        AND dbpr_sync_key NOT LIKE 'ZZTEST%'
      GROUP BY county_code
    );
  GET DIAGNOSTICS zeroed = ROW_COUNT;

  table_name := 'reference_counties';
  rows_repaired := matched + zeroed;
  RETURN NEXT;

  -- ---- reference_license_types — NO state filter, deliberately ----
  UPDATE reference_license_types rt
  SET contractor_count = COALESCE(c.n, 0)
  FROM (
    SELECT license_type, count(*) AS n
    FROM contractors
    WHERE license_type IS NOT NULL
      AND dbpr_sync_key NOT LIKE 'ZZTEST%'
    GROUP BY license_type
  ) c
  WHERE rt.type_code = c.license_type
    AND rt.contractor_count IS DISTINCT FROM COALESCE(c.n, 0);
  GET DIAGNOSTICS matched = ROW_COUNT;

  UPDATE reference_license_types
  SET contractor_count = 0
  WHERE contractor_count <> 0
    AND type_code NOT IN (
      SELECT license_type FROM contractors
      WHERE license_type IS NOT NULL
        AND dbpr_sync_key NOT LIKE 'ZZTEST%'
      GROUP BY license_type
    );
  GET DIAGNOSTICS zeroed = ROW_COUNT;

  table_name := 'reference_license_types';
  rows_repaired := matched + zeroed;
  RETURN NEXT;

  -- ---- reference_cities — count WHERE state='FL', matched on upper() ----
  UPDATE reference_cities rc
  SET contractor_count = COALESCE(c.n, 0)
  FROM (
    SELECT upper(trim(city)) AS city_key, count(*) AS n
    FROM contractors
    WHERE state = 'FL'
      AND city IS NOT NULL
      AND dbpr_sync_key NOT LIKE 'ZZTEST%'
    GROUP BY upper(trim(city))
  ) c
  WHERE upper(rc.city_name) = c.city_key
    AND rc.contractor_count IS DISTINCT FROM COALESCE(c.n, 0);
  GET DIAGNOSTICS matched = ROW_COUNT;

  UPDATE reference_cities
  SET contractor_count = 0
  WHERE contractor_count <> 0
    AND upper(city_name) NOT IN (
      SELECT upper(trim(city)) FROM contractors
      WHERE state = 'FL'
        AND city IS NOT NULL
        AND dbpr_sync_key NOT LIKE 'ZZTEST%'
      GROUP BY upper(trim(city))
    );
  GET DIAGNOSTICS zeroed = ROW_COUNT;

  table_name := 'reference_cities';
  rows_repaired := matched + zeroed;
  RETURN NEXT;

  -- ---- reference_county_type_counts — NEW 2026-09-01 ----
  --
  -- ⚠ A CHILD TABLE, NOT A COLUMN ON AN EXISTING ROW. The three blocks above
  -- UPDATE a count on rows that already exist and are never created or removed
  -- by the repair. This one owns its rows entirely: a county that gains its
  -- first CGC needs a row INSERTED, and one whose last CGC lapses needs that
  -- row DELETED. An UPDATE-only repair copied from above would leave the
  -- lapsed pair reading its old non-zero count forever.
  --
  -- NO state FILTER — see the header. This matches county_type_counts().
  --
  -- IDEMPOTENT: the ON CONFLICT carries a WHERE, so a second run rewrites
  -- nothing and reports 0. The confirmation block at the foot of this file
  -- asks you to run it twice for exactly that reason.

  WITH live AS (
    SELECT county_code,
           license_type AS type_code,
           count(*)::integer AS n
    FROM contractors
    WHERE county_code IS NOT NULL
      AND license_type IS NOT NULL
      AND dbpr_sync_key NOT LIKE 'ZZTEST%'
    GROUP BY county_code, license_type
  ),
  deleted AS (
    DELETE FROM reference_county_type_counts t
    WHERE NOT EXISTS (
      SELECT 1 FROM live l
      WHERE l.county_code = t.county_code AND l.type_code = t.type_code
    )
    RETURNING 1
  ),
  upserted AS (
    INSERT INTO reference_county_type_counts AS t (county_code, type_code, n)
    SELECT county_code, type_code, n FROM live
    ON CONFLICT (county_code, type_code) DO UPDATE
      SET n = EXCLUDED.n
      WHERE t.n IS DISTINCT FROM EXCLUDED.n
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM deleted) + (SELECT count(*) FROM upserted)
    INTO removed;

  table_name := 'reference_county_type_counts';
  rows_repaired := removed;
  RETURN NEXT;
END;
$$;


-- ----------------------------------------------------------
-- verify_reference_counts() — now covers the fourth table
-- ----------------------------------------------------------
--
-- SIGNATURE UNCHANGED. The new rows use key = 'county:type' and label = the
-- county name, so scripts/verify-counts.mjs groups them under a fourth heading
-- without knowing anything new. live_unfiltered stays NULL — the counties-only
-- distinction 20260810 documents does not arise here, because this table is
-- already the unfiltered shape.
--
-- ⚠ THIS ADDS ~1,416 ROWS to a result that returns 806 today. Still one round
-- trip, still far cheaper than the per-row count requests it replaced.

CREATE OR REPLACE FUNCTION public.verify_reference_counts()
RETURNS TABLE (
  table_name      text,
  key             text,
  label           text,
  stored          integer,
  live_count      bigint,
  live_unfiltered bigint
)
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public, pg_catalog
AS $$
  SELECT 'reference_counties'::text,
         rc.county_code::text,
         rc.county_name::text,
         rc.contractor_count,
         COALESCE(fl.n, 0),
         COALESCE(al.n, 0)
  FROM reference_counties rc
  LEFT JOIN (
    SELECT county_code, count(*) AS n FROM contractors
    WHERE state = 'FL' AND county_code IS NOT NULL
      AND dbpr_sync_key NOT LIKE 'ZZTEST%'
    GROUP BY county_code
  ) fl ON fl.county_code = rc.county_code
  LEFT JOIN (
    SELECT county_code, count(*) AS n FROM contractors
    WHERE county_code IS NOT NULL
      AND dbpr_sync_key NOT LIKE 'ZZTEST%'
    GROUP BY county_code
  ) al ON al.county_code = rc.county_code

  UNION ALL

  SELECT 'reference_license_types'::text,
         rt.type_code::text,
         rt.type_name::text,
         rt.contractor_count,
         COALESCE(t.n, 0),
         NULL::bigint
  FROM reference_license_types rt
  LEFT JOIN (
    SELECT license_type, count(*) AS n FROM contractors
    WHERE license_type IS NOT NULL
      AND dbpr_sync_key NOT LIKE 'ZZTEST%'
    GROUP BY license_type
  ) t ON t.license_type = rt.type_code

  UNION ALL

  SELECT 'reference_cities'::text,
         rc.city_slug::text,
         rc.city_name::text,
         rc.contractor_count,
         COALESCE(ci.n, 0),
         NULL::bigint
  FROM reference_cities rc
  LEFT JOIN (
    SELECT upper(trim(city)) AS city_key, count(*) AS n FROM contractors
    WHERE state = 'FL' AND city IS NOT NULL
      AND dbpr_sync_key NOT LIKE 'ZZTEST%'
    GROUP BY upper(trim(city))
  ) ci ON ci.city_key = upper(rc.city_name)

  UNION ALL

  -- FULL OUTER JOIN, not LEFT. The three above compare a stored row against a
  -- live count and a missing live count is 0. Here a pair can be missing from
  -- EITHER side — a stored row whose licence type has lapsed (stored, no live)
  -- or a new pair the repair has not run for (live, no stored) — and both are
  -- mismatches the caller must see. A LEFT JOIN would hide the second kind,
  -- which is the more likely one.
  SELECT 'reference_county_type_counts'::text,
         COALESCE(s.county_code, l.county_code) || ':' || COALESCE(s.type_code, l.type_code),
         COALESCE(rc.county_name, COALESCE(s.county_code, l.county_code))::text,
         s.n,
         COALESCE(l.n, 0),
         NULL::bigint
  FROM reference_county_type_counts s
  FULL OUTER JOIN (
    SELECT county_code, license_type AS type_code, count(*) AS n
    FROM contractors
    WHERE county_code IS NOT NULL AND license_type IS NOT NULL
      AND dbpr_sync_key NOT LIKE 'ZZTEST%'
    GROUP BY county_code, license_type
  ) l ON l.county_code = s.county_code AND l.type_code = s.type_code
  LEFT JOIN reference_counties rc
    ON rc.county_code = COALESCE(s.county_code, l.county_code);
$$;


-- ----------------------------------------------------------
-- GRANTS — re-asserted, not assumed
-- ----------------------------------------------------------
--
-- CREATE OR REPLACE preserves privileges, so strictly these are unchanged. They
-- are repeated because 20260810 shipped an ineffective REVOKE and its own
-- header says the lesson is to name the roles and then PROVE it. Cheap to
-- repeat, expensive to be wrong about.
--
-- ⚠ REVOKE ... FROM PUBLIC IS NOT ENOUGH ON SUPABASE. Supabase's ALTER DEFAULT
-- PRIVILEGES grants EXECUTE directly to anon and authenticated; a direct grant
-- is unaffected by revoking PUBLIC and is sufficient on its own. Name the roles.

REVOKE ALL ON FUNCTION public.repair_reference_counts()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_reference_counts()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.repair_reference_counts() TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_reference_counts() TO service_role;

COMMENT ON FUNCTION public.repair_reference_counts() IS
  'Recomputes reference_{counties,cities,license_types}.contractor_count and rebuilds reference_county_type_counts from contractors. Re-runnable; returns rows changed per table. Service-role only - see the REVOKE above.';
COMMENT ON FUNCTION public.verify_reference_counts() IS
  'Read-only. One row per reference row with stored vs live counts, across all four reference tables. Service-role only.';


-- ==========================================================
-- AFTER RUNNING, CONFIRM
-- ==========================================================
--
--   -- 1. first repair populates the new table; the other three report 0
--   SELECT * FROM repair_reference_counts();
--   -- expect reference_county_type_counts = 1416, the rest 0
--
--   -- 2. RUN IT AGAIN. All four must report 0. A non-zero second run means the
--   --    ON CONFLICT ... WHERE guard is not doing its job and every import
--   --    rewrites 1,416 rows for nothing.
--   SELECT * FROM repair_reference_counts();
--
--   -- 3. nothing disagrees, across all four tables now (expect 0)
--   SELECT count(*) FROM verify_reference_counts()
--    WHERE stored IS DISTINCT FROM live_count;
--
--   -- 4. the new table agrees with the RPC it replaces, for a real county.
--   --    This is the assertion that matters: the read path is only safe to
--   --    switch if these are identical.
--   SELECT count(*) AS disagreements FROM (
--     SELECT type_code, n FROM reference_county_type_counts WHERE county_code = '13'
--     EXCEPT
--     SELECT type_code, n::integer FROM county_type_counts('13')
--   ) x;                                                    -- expect 0
--   SELECT sum(n) FROM reference_county_type_counts WHERE county_code = '13';
--                                                           -- expect 27247
--
--   -- 5. anon CAN read the table (the filter panel depends on it) …
--   SELECT has_table_privilege('anon', 'public.reference_county_type_counts', 'SELECT');
--                                                           -- expect true
--   --    … and CANNOT write it, nor call either function.
--   SELECT has_table_privilege('anon', 'public.reference_county_type_counts', 'INSERT') AS anon_insert,
--          has_function_privilege('anon',          'public.repair_reference_counts()', 'EXECUTE') AS anon_repair,
--          has_function_privilege('authenticated', 'public.repair_reference_counts()', 'EXECUTE') AS auth_repair,
--          has_function_privilege('anon',          'public.verify_reference_counts()', 'EXECUTE') AS anon_verify,
--          has_function_privilege('authenticated', 'public.verify_reference_counts()', 'EXECUTE') AS auth_verify;
--   -- expect false in all five.
--
--   -- 6. and the read the page actually makes is fast (expect well under 1 ms)
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT type_code, n FROM reference_county_type_counts WHERE county_code = '13';
-- ==========================================================
