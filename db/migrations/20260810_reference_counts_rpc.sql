-- ==========================================================
-- Reference-count repair + verify as callable functions
-- Created 2026-08-10. APPLIED 2026-08-10.
-- ==========================================================
--
-- APPLIED RESULT, for the record:
--   statement 1                     service_role statement_timeout = 120s ✓
--   repair_reference_counts() x2    0 / 0 / 0 both times (idempotent ✓)
--   verify_reference_counts()       0 mismatches across 806 reference rows ✓
--   anon/authenticated EXECUTE      false x4 — but only after the fix below.
--
-- ⚠ THE GRANTS SECTION OF THIS FILE WAS WRONG WHEN FIRST APPLIED and was
-- corrected in place. If you are reading this file as a template, read the
-- GRANTS section before anything else — it is the part that bit.
--
-- ✅ SAFE TO PASTE AND RUN AS ONE BATCH — with ONE exception, marked below.
-- Nothing here uses CONCURRENTLY or VACUUM, so the SQL Editor's implicit
-- transaction is what you want: the functions and their grants land together
-- or not at all. STATEMENT 1 is the exception and must be run on its own.
--
-- ⚠ DEPLOY ORDER: THIS FILE FIRST, THEN THE CODE. scripts/import-dbpr.mjs
-- gains a Phase 4 that calls both functions by name, and
-- scripts/verify-counts.mjs is rewritten to call verify_reference_counts().
-- With the code shipped and this not run, Phase 4 logs a PGRST202 ("Could not
-- find the function") and carries on — it is best-effort by design — but
-- verify-counts.mjs fails outright, because measuring nothing is not a pass.
--
--
-- ==========================================================
-- WHAT THIS REPLACES, AND WHY IT IS NOT JUST TIDINESS
-- ==========================================================
--
-- db/migrations/20260805_reference_counts_repair.sql closes with:
--
--   "re-run this whole file after every DBPR refresh. The importer does not do
--    it ... a refresh whose reference counts were not repaired leaves
--    /counties, /cities and /types reporting the previous week's figures."
--
-- That instruction lives in a SQL comment and in the importer's closing stdout.
-- Both are read by a human who has just watched a 35-minute job finish, and
-- neither is read by anything that can act. The failure mode is silent: every
-- page renders normally while being a week wrong, which is exactly how
-- reference_license_types read 0 for all 29 rows for five weeks.
--
-- The repair logic below is COPIED VERBATIM from that file — same rules, same
-- deliberate asymmetries (state='FL' on the two geographic tables, no filter on
-- licence types; see that file's header for why, it is not an oversight). The
-- only change is the ZZTEST predicate, discussed below. Nothing about WHAT a
-- correct count is has been revisited here.
--
--
-- ==========================================================
-- ⚠⚠ STATEMENT 1 IS A PREREQUISITE, NOT AN OPTIMISATION
-- ==========================================================
--
-- MEASURED ON THIS PROJECT 2026-08-10, EXPLAIN (ANALYZE, BUFFERS):
--
--   counties  GROUP BY county_code            5,800 ms   Parallel Seq Scan
--   cities    GROUP BY upper(trim(city))      3,000 ms   Parallel Seq Scan
--   types     GROUP BY license_type          ~3,000 ms   same shape
--                                            ─────────
--   read time before a single UPDATE runs    ~12,000 ms
--
-- THE IMPORTER GETS 8 SECONDS. It reaches the database through PostgREST as
-- service_role, and service_role carries no statement_timeout of its own:
--
--   authenticator   statement_timeout = 8s   ← inherited by service_role
--   service_role    (no rolconfig)
--   database default                = 120s
--
-- So repair_reference_counts() called over PostgREST is cancelled with 57014
-- roughly half way through the first aggregate, every time. Not intermittently
-- — deterministically.
--
-- ⚠ AND IT CANNOT BE FIXED INSIDE THE FUNCTION. A `SET statement_timeout` in a
-- function's definition does NOT rescue it: Postgres arms the statement timer
-- once, at statement start, and a GUC change inside that statement does not
-- re-arm it. Verified on this project 2026-08-10 — a function declared
-- SET statement_timeout='30s' was still cancelled at 2s by the session value:
--
--   ERROR: 57014 canceling statement due to statement timeout
--   CONTEXT: SQL function "tmo_test" statement 1
--
-- That is why the manual step has always worked: the SQL Editor connects as
-- `postgres`, which gets the 120s database default and never meets PostgREST.
-- Automating the step means giving the importer the same room.
--
-- WHAT ELSE THIS FIXES: the Phase 2 statement timeouts that killed run
-- e9964049 today. Those are the same 8s ceiling applied to 500-row upserts that
-- now write 18 index entries per row. This statement addresses both.
--
-- WHAT IT COSTS — the honest version. This widens the ceiling for ALL
-- service-role traffic, not just the importer: claim signed URLs, the ID-photo
-- purge, lead inserts. Every one of those is a single-row or small query that
-- finishes in milliseconds, so this does not change their behaviour — it
-- changes how long a PATHOLOGICAL one is allowed to run before being cut off.
-- The exposure is a slow query holding a pooled connection for up to 120s
-- instead of 8s. Weighed against a weekly import that cannot otherwise run
-- unattended, that is the right trade — but it is a real one and it is not
-- reversible by accident, so it is stated rather than buried.
--
-- ⚠ RUN STATEMENT 1 ON ITS OWN, NOT AS PART OF THE BATCH. ALTER ROLE is
-- transactional but NOTIFY is not delivered until commit, and pgrst must see
-- the reload signal after the role change is visible. Run it, wait, then run
-- the rest of the file.
--
-- IF YOU DECLINE STATEMENT 1: stop here. The rest of this file will install
-- cleanly and both functions will fail at runtime with 57014. The repair stays
-- a manual SQL-Editor step and item 3 does not land. That is a legitimate
-- choice — it is a real widening of service_role — but it is all-or-nothing.


-- ----------------------------------------------------------
-- STATEMENT 1 of 2 — RUN THIS ALONE, FIRST
-- ----------------------------------------------------------

ALTER ROLE service_role SET statement_timeout = '120s';
NOTIFY pgrst, 'reload config';

-- Confirm before continuing — expect {statement_timeout=120s}:
--   SELECT rolname, rolconfig FROM pg_roles WHERE rolname = 'service_role';


-- ----------------------------------------------------------
-- STATEMENT 2 of 2 — the rest of this file, as one batch
-- ----------------------------------------------------------
--
-- ==========================================================
-- WHY SECURITY INVOKER, AND WHY THE GRANTS ARE NARROW
-- ==========================================================
--
-- Both functions are INVOKER (the default), matching county_type_counts() and
-- unlike approve_claim(). Neither needs to do anything the caller cannot: the
-- only caller is service_role, which already holds UPDATE on the three
-- reference tables and bypasses RLS. A DEFINER function here would be a
-- standing privilege escalation with no benefit — and repair_ WRITES, which is
-- precisely the kind of function that must not be reachable by a role that
-- could not perform the write directly.
--
-- ⚠ POSTGRES GRANTS EXECUTE TO PUBLIC BY DEFAULT. Left alone, every function
-- created here would be callable by anon over the public REST API — and
-- repair_reference_counts() is a write that seq-scans 271k rows three times.
-- That is an unauthenticated CPU-burn lever. REVOKE FROM PUBLIC comes first,
-- then a single explicit GRANT, for both functions.
--
-- NOT GRANTED TO authenticated. The /admin/sync drift panel currently measures
-- this itself through checkReferenceCounts() on the admin session client, and
-- is deliberately left alone by this change — switching that page to the RPC is
-- a separate edit needing its own grant, and this file does not pre-authorise
-- it.
--
--
-- ==========================================================
-- ⚠ ONE DELIBERATE DEVIATION FROM THE 20260805 FILE: ZZTEST
-- ==========================================================
--
-- The repair below excludes rows keyed 'ZZTEST%'. The file it is copied from
-- does not. This is a change in behaviour and it is called out rather than
-- slipped in.
--
-- WHY: lib/test-rows.ts exists because a verify suite mutated a real
-- contractor's live listing. Its second half of the fix is that every public
-- read path EXCLUDES synthetic rows — because cleanup runs in a `finally`,
-- which does not survive a killed process. So a leaked ZZTEST row is invisible
-- in listings. Without this predicate it would still be COUNTED in the stored
-- integer above those listings, and /county/[slug] would render "N contractors"
-- over N-1 results. That is the exact seam county_type_counts() warns about.
--
-- IT IS A NO-OP TODAY. Measured 2026-08-10: 0 rows match 'ZZTEST%', so applying
-- this changes not one stored count. It only differs from the old file under
-- the leak conditions test-rows.ts was written to survive.
--
-- ⚠ KEEP IN STEP WITH TEST_ROW_LIKE in lib/test-rows.ts. Same duplication, same
-- reason (a SQL function cannot import a TypeScript constant), same remedy:
-- grep for BOTH 'ZZTEST' and TEST_ROW_LIKE if the prefix ever changes.
-- scripts/verify-test-row-isolation.mjs asserts the two agree.


CREATE OR REPLACE FUNCTION public.repair_reference_counts()
RETURNS TABLE (table_name text, rows_repaired integer)
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_catalog
AS $$
DECLARE
  matched integer;
  zeroed  integer;
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

  -- Counties the aggregate did not reach at all, reset rather than left stale.
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
  -- An out-of-state CGC still holds a Florida licence and /type/[code] lists
  -- them; filtering here would make the badge disagree with the rows beneath.
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
  -- contractors.city is uppercase throughout the extract; city_name is title
  -- case.
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
END;
$$;


-- ==========================================================
-- verify_reference_counts() — measurement, no writes
-- ==========================================================
--
-- RETURNS ONE ROW PER REFERENCE ROW, not a summary. 806 rows in one round trip,
-- replacing the ~1,530 individual head:true count requests verify-counts.mjs
-- issues today (67 counties x 2 + 710 cities + 29 types, ten at a time).
--
-- The caller decides what is a mismatch, so the script keeps its own reporting
-- and its --verbose row listing without this function needing to know about
-- either.
--
-- ⚠ live_unfiltered IS POPULATED FOR COUNTIES ONLY, and it is not the rule.
-- It is the count WITHOUT state='FL'. It exists because 20260805's header
-- documents a bug report filed against a table that was correct — someone
-- measured counties without the filter, got "42 of 67 disagree", and reported
-- it. verify-counts.mjs prints both numbers side by side so that distinction
-- stays visible rather than being rediscovered. NULL for the other two tables,
-- where the question does not arise.
--
-- STABLE and PARALLEL SAFE: reads only. Both let the planner parallelise the
-- seq scans, which is where all of its time goes.

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
  ) ci ON ci.city_key = upper(rc.city_name);
$$;


-- ----------------------------------------------------------
-- GRANTS — REVOKE FROM PUBLIC IS NOT ENOUGH ON SUPABASE
-- ----------------------------------------------------------
--
-- ⚠⚠ THIS FILE SHIPPED WRONG ONCE. READ THIS BEFORE WRITING THE NEXT FUNCTION.
--
-- The first version of this section said only:
--
--   REVOKE ALL ON FUNCTION public.repair_reference_counts() FROM PUBLIC;
--
-- and it did NOT work. Verified on this project 2026-08-10: after running it,
-- has_function_privilege() returned TRUE for anon and authenticated on BOTH
-- functions — including repair_, which WRITES and seq-scans 271k rows three
-- times. PostgREST exposes every function in `public` as an RPC endpoint, so
-- for as long as that was live, /rest/v1/rpc/repair_reference_counts was an
-- unauthenticated CPU-burn lever.
--
-- WHY. Two separate grants exist and REVOKE ... FROM PUBLIC only removes one:
--
--   1. Postgres's own default — EXECUTE to PUBLIC on every new function.
--      This is the one FROM PUBLIC removes.
--   2. SUPABASE'S default privileges — ALTER DEFAULT PRIVILEGES ... GRANT
--      EXECUTE ON FUNCTIONS TO anon, authenticated, service_role. These are
--      DIRECT grants to the named roles. Revoking PUBLIC does nothing to them,
--      and a direct grant is sufficient on its own.
--
-- So the roles must be named. The privilege check is the only way to know —
-- reading the REVOKE and reasoning about it is exactly what produced the bug.
--
-- ⚠ THE CORRECT PATTERN WAS ALREADY IN THIS REPO AND WAS NOT FOLLOWED.
-- db/migrations/20260806_rate_limits.sql:246 gets it right for
-- check_rate_limit():
--
--   REVOKE ALL ON FUNCTION public.check_rate_limit(...) FROM PUBLIC, anon, authenticated;
--
-- Copy that form. Every future function in this schema, without exception:
-- REVOKE FROM PUBLIC, anon, authenticated — then GRANT back only what is
-- needed — then PROVE it with has_function_privilege().
--
-- GRANT TO service_role is explicit rather than inherited, for the reason
-- 20260806 gives: Supabase's defaults already grant it, but a limiter (or a
-- weekly import) that silently depends on a platform default is a dependency
-- worth writing down.

REVOKE ALL ON FUNCTION public.repair_reference_counts()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_reference_counts()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.repair_reference_counts() TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_reference_counts() TO service_role;

COMMENT ON FUNCTION public.repair_reference_counts() IS
  'Recomputes reference_{counties,cities,license_types}.contractor_count from contractors. Re-runnable; returns rows changed per table. Service-role only — see the REVOKE above.';
COMMENT ON FUNCTION public.verify_reference_counts() IS
  'Read-only. One row per reference row with stored vs live counts. Service-role only.';


-- ==========================================================
-- AFTER RUNNING, CONFIRM
-- ==========================================================
--
--   -- 1. the timeout took (expect {statement_timeout=120s})
--   SELECT rolname, rolconfig FROM pg_roles WHERE rolname = 'service_role';
--
--   -- 2. anon and authenticated CANNOT call either function.
--   --    Expect false in all four columns. A true here is the one dangerous
--   --    outcome of this file and is worth checking rather than assuming.
--   SELECT has_function_privilege('anon',          'public.repair_reference_counts()', 'EXECUTE') AS anon_repair,
--          has_function_privilege('authenticated', 'public.repair_reference_counts()', 'EXECUTE') AS auth_repair,
--          has_function_privilege('anon',          'public.verify_reference_counts()', 'EXECUTE') AS anon_verify,
--          has_function_privilege('authenticated', 'public.verify_reference_counts()', 'EXECUTE') AS auth_verify;
--
--   -- 3. the repair is a no-op on already-correct data (expect 0, 0, 0)
--   SELECT * FROM repair_reference_counts();
--
--   -- 4. and nothing disagrees afterwards (expect 0)
--   SELECT count(*) FROM verify_reference_counts() WHERE stored IS DISTINCT FROM live_count;
--
-- ⚠ RUN 3 TWICE. It is written to be re-runnable and the second run must also
-- report 0, 0, 0. A non-zero second run means an UPDATE is rewriting rows it
-- already fixed — an IS DISTINCT FROM guard has been dropped somewhere.
--
--
-- ==========================================================
-- SCHEMA-WIDE FUNCTION GRANT AUDIT — run 2026-08-10, after the bug above
-- ==========================================================
--
-- Prompted by this file shipping an ineffective REVOKE. Every function in
-- `public` was checked, not just the two added here. THE QUERY, so it can be
-- re-run rather than re-derived:
--
--   SELECT p.proname,
--          pg_get_function_identity_arguments(p.oid) AS args,
--          CASE p.prosecdef WHEN true THEN 'DEFINER' ELSE 'INVOKER' END AS security,
--          has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
--          has_function_privilege('service_role',  p.oid, 'EXECUTE') AS svc
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--    ORDER BY p.proname;
--
-- FINDING: no unintended grant exposes data or a write. Detail —
--
--   CORRECTLY LOCKED (anon=f, auth=f, service_role=t):
--     check_rate_limit, repair_reference_counts, verify_reference_counts
--
--   DEFINER WRITES, anon=f / authenticated=t — CORRECT. Each performs a
--   privileged write on behalf of the signed-in caller and does its own
--   ownership check internally; anon is excluded on all six:
--     approve_claim, reject_claim, release_own_contractor_profile,
--     set_own_contractor_image, set_own_inquiry_status,
--     update_own_contractor_profile
--
--   anon=t / auth=t AND INTENDED:
--     county_type_counts   — public browse data; its own migration argues the case
--     is_admin             — DEFINER, but returns one boolean ABOUT THE CALLER and
--                            is referenced by RLS policies, which evaluate as the
--                            querying role. anon MUST retain EXECUTE or every
--                            policy using it errors. Returns nothing anon could
--                            not already infer about itself.
--     assert_own_photo_path — same story for the storage policies.
--
--   anon=t / auth=t, UNNECESSARY BUT HARMLESS — flagged, not fixed here:
--     contractor_slugify, contractor_base_slug   pure string functions, no data
--     contractors_assign_slug, set_updated_at,
--     promote_to_featured_on_subscription        trigger functions; a direct call
--                                                errors, and triggers do not check
--                                                EXECUTE at fire time
--   These carry Supabase's default grant for no reason. Removing them is a
--   grant-hygiene follow-up in the spirit of 20260804_grant_hygiene.sql, NOT
--   done in this file because it is unrelated to reference counts and would
--   make this migration's blast radius larger than its subject.
--
--   NOT OURS: the pg_trgm / unaccent extension functions (gtrgm_*, similarity*,
--   word_similarity*, unaccent*, set_limit, show_limit, show_trgm) are owned by
--   supabase_admin and granted by the extension. Out of scope and not safe to
--   revoke piecemeal.
-- ==========================================================
