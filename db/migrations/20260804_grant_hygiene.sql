-- ==========================================================
-- GRANT HYGIENE — REMOVING PRIVILEGES NOTHING USES
-- Created 2026-08-04. NOT APPLIED — Jim runs this in the SQL editor.
-- ==========================================================
--
-- NO DEPLOY-ORDER CONSTRAINT. Nothing in the application calls anything here,
-- and no code change depends on it. Run it before or after the /admin/leads
-- build; the page behaves identically either way.
--
-- ==========================================================
-- THIS IS NOT AN INCIDENT. IT IS THE SHAPE OF ONE.
-- ==========================================================
--
-- Every reachable operation is already refused. Probed against the live project
-- on 2026-08-04 with a throwaway non-admin user and a throwaway lead row (the
-- nine real leads were never touched):
--
--   non-admin SELECT leads   -> 0 rows
--   non-admin UPDATE leads   -> 0 rows      (the probe row was unchanged after)
--   non-admin DELETE leads   -> 0 rows      (the probe row still existed after)
--   non-admin INSERT leads   -> 42501, new row violates row-level security
--   anon      SELECT leads   -> 0 rows
--   anon      UPDATE leads   -> 0 rows
--
-- RLS is doing its job. What this file removes is the GRANT sitting behind it,
-- and the reason is written on the tin of a migration we already shipped —
-- 20260803_contractor_profile_lockdown.sql, §4:
--
--   "INSERT is revoked too. No policy allowed it, so RLS was already refusing —
--    but the grant existing at all is what made the UPDATE hole possible."
--
-- One permissive policy, added by someone who did not know the grants were
-- wide, is the whole distance between "RLS refuses" and "anon writes to a table
-- of names, emails and phone numbers".
--
-- ⚠ AND TWO PRIVILEGES ARE NOT COVERED BY RLS AT ALL. Row security applies to
-- SELECT, INSERT, UPDATE and DELETE. It does NOT apply to TRUNCATE or TRIGGER —
-- those are decided by the grant alone. So `anon` and `authenticated` currently
-- hold two privileges on these tables that no policy can restrain.
--
-- The mitigating fact, stated so nobody over-reads this: neither is reachable
-- through PostgREST, which only speaks SELECT/INSERT/UPDATE/DELETE. Invoking
-- them needs a direct Postgres connection, which needs the database password —
-- not the anon key that ships in every page of the site. This is hygiene, not a
-- live hole.


-- ==========================================================
-- 1. leads — THE ONE THIS WAS ASKED FOR
-- ==========================================================
--
-- anon has no business with this table in any capacity. Lead capture writes
-- with the SERVICE ROLE (app/diagnostic/actions.ts:196, createAdminClient),
-- which bypasses grants and RLS entirely, so revoking everything from anon
-- cannot affect it. Verified before writing this file rather than assumed —
-- if that insert had used the session client, this revoke would have silently
-- ended lead capture.
REVOKE ALL ON public.leads FROM anon;

-- authenticated keeps SELECT/INSERT/UPDATE/DELETE because the admin pages read
-- and write leads through the ADMIN'S OWN SESSION, so "admin only leads"
-- (FOR ALL, USING is_admin()) is what gates them — RLS enforcing at the database
-- rather than the application deciding. It loses the two privileges RLS cannot
-- reach and nothing uses.
REVOKE TRUNCATE, TRIGGER ON public.leads FROM authenticated;


-- ==========================================================
-- 2. THE SAME PATTERN, THREE MORE TABLES — SEPARABLE, READ FIRST
-- ==========================================================
--
-- Checking the leads grants meant listing them, and the listing showed this is
-- not a leads problem. Reporting only the table that was asked about would have
-- been the less useful answer. Live state on 2026-08-04, anon AND authenticated
-- identical on each:
--
--   leads         DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   claims        DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   contractors   DELETE, REFERENCES, SELECT, TRIGGER, TRUNCATE
--   inquiries     REFERENCES, SELECT, TRIGGER, TRUNCATE
--
-- Two of those are marks left by our own lockdowns, and both are worth naming:
--
--   · contractors still grants DELETE and TRUNCATE. 20260803's §4 revoked
--     "UPDATE, INSERT" and stopped there. Nothing grants a non-admin a DELETE
--     policy, so it is refused today — but the migration that closed the UPDATE
--     hole left its neighbour open, which is exactly the thing that file warns
--     about happening again.
--
--   · inquiries still grants TRUNCATE and TRIGGER. That one is mine:
--     20260804_inquiry_status_lockdown.sql revoked UPDATE, INSERT and DELETE
--     and did not think about the two privileges RLS does not cover.
--
-- THIS SECTION IS SAFE TO SKIP. Section 1 stands alone and is what was
-- approved. Skipping this one leaves the state above unchanged — refused by
-- RLS, wider than it needs to be.
--
-- ⚠ IF YOU RUN IT, KNOW WHAT IT COSTS. Revoking DELETE from authenticated on
-- contractors and claims means an ADMIN acting through their own session can no
-- longer delete a row from either, the same accepted consequence 20260803
-- recorded for UPDATE. Nothing does that today: the admin UI reads with the
-- service role, approve_claim()/reject_claim() are SECURITY DEFINER, and every
-- verify script cleans up with the service role. If an admin delete screen is
-- ever built it needs its own RPC, not a grant handed back.

-- claims — anon never touches it. A claim is submitted by a signed-in claimant
-- under "claimant creates own claim" (TO authenticated), and reviewed by an
-- admin. anon holding DELETE on the identity-verification audit trail is the
-- starkest line in the table above.
REVOKE ALL ON public.claims FROM anon;
REVOKE TRUNCATE, TRIGGER ON public.claims FROM authenticated;

-- contractors — anon keeps SELECT. The directory is public and 266,305 rows of
-- it are served to signed-out visitors; that grant is load-bearing.
REVOKE DELETE, TRUNCATE, TRIGGER ON public.contractors FROM anon;
REVOKE DELETE, TRUNCATE, TRIGGER ON public.contractors FROM authenticated;

-- inquiries — anon keeps nothing. The public contact form inserts with the
-- service role (app/contractor/[slug]/actions.ts), and the contractor inbox
-- reads under the session, so authenticated keeps SELECT.
REVOKE ALL ON public.inquiries FROM anon;
REVOKE TRUNCATE, TRIGGER ON public.inquiries FROM authenticated;


-- ==========================================================
-- 3. AFTER RUNNING, CONFIRM
-- ==========================================================
--
--   SELECT table_name, grantee,
--          string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
--     FROM information_schema.role_table_grants
--    WHERE table_schema='public'
--      AND table_name IN ('leads','claims','inquiries','contractors')
--      AND grantee IN ('anon','authenticated')
--    GROUP BY table_name, grantee ORDER BY table_name, grantee;
--
-- Expected after BOTH sections:
--
--   claims        anon           (no rows)
--   claims        authenticated  DELETE, INSERT, REFERENCES, SELECT, UPDATE
--   contractors   anon           REFERENCES, SELECT
--   contractors   authenticated  REFERENCES, SELECT
--   inquiries     anon           (no rows)
--   inquiries     authenticated  REFERENCES, SELECT
--   leads         anon           (no rows)
--   leads         authenticated  DELETE, INSERT, REFERENCES, SELECT, UPDATE
--
-- Then, from the repo — these are the regression tests for it, and every one of
-- them exercises the paths these grants used to cover:
--
--   node --no-warnings scripts/verify-profile-lockdown.mjs     -- expect 33/33
--   node --no-warnings scripts/verify-inquiries-lockdown.mjs   -- expect 38/38
--   node --no-warnings scripts/verify-claim-approval.mjs       -- expect 27/27
--   node --no-warnings scripts/verify-contractor-logo.mjs      -- expect 45/45
--   node --no-warnings scripts/verify-release-profile.mjs      -- expect 27/27
--
-- If section 2 broke something, one of those five is where it shows up. Run
-- them before trusting this file.
-- ==========================================================
