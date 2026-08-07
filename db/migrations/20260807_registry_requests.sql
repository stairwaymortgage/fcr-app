-- ==========================================================
-- REGISTRY REQUESTS — "add my business" submissions from /join
-- Created 2026-08-07. NOT YET APPLIED — run in the Supabase SQL editor.
-- ==========================================================
--
-- Every statement is idempotent (CREATE ... IF NOT EXISTS, CREATE POLICY guarded
-- by a DROP, REVOKE/GRANT), so re-running the whole file is safe.
--
-- DEPLOY ORDER: this file, THEN the deploy. The Server Action that writes this
-- table ships in the same change; deploying first means every submission fails
-- with PGRST205 "Could not find the table" and the visitor is told the request
-- did not send. Unlike the rate limiter, this one does not fail open — a lost
-- request here is a business that thinks it asked to be listed and was not.
--
--
-- ==========================================================
-- WHAT THIS TABLE IS FOR, AND WHAT IT DELIBERATELY IS NOT
-- ==========================================================
--
-- /join step 1 searches the 266,305-row contractors table. A match routes into
-- the existing claim flow. A MISS lands here: a business that believes it should
-- be in the registry and is not.
--
-- ⚠ THIS IS A REQUEST QUEUE, NOT A SHADOW CONTRACTORS TABLE. Approving a row
-- here does NOT create a contractor. It records that a human decided the listing
-- should exist; the listing itself is then created by hand. That split is
-- deliberate for this pass:
--
--   · contractors is DBPR-derived and the importer owns every column in it. A
--     row inserted from a web form has no dbpr_sync_key, so the next weekly
--     refresh would classify it as an orphan (see lib/sync-runs.ts) and the
--     reference counts would drift against a row DBPR has never heard of.
--   · The whole product claim is "republished from public DBPR records". A
--     self-submitted business silently mixed into that set breaks the claim on
--     the one page that makes it.
--
-- So the approval is a decision, not a write. If auto-provisioning is ever
-- wanted, it needs its own provenance column on contractors first — not a
-- widening of this table.
--
--
-- ==========================================================
-- THIS TABLE HOLDS PII AND IS CLOSED TO THE PUBLIC
-- ==========================================================
--
-- contact_name, email, phone. Same class of data as `leads`, and it gets the
-- same posture: RLS on, no anon policy of any kind, service-role writes, admins
-- read through their own session.
--
-- ⚠ NO ANON INSERT POLICY IS GRANTED, ON PURPOSE. The obvious shape — "let anon
-- INSERT, that is what a public form does" — hands anyone holding the anon key
-- (it ships in the browser bundle) an unauthenticated, unthrottled writer into a
-- PII table, addressable directly at /rest/v1/registry_requests and never
-- passing through the rate limiter, the honeypot or the validation in
-- app/join/actions.ts. The Server Action writes with service-role instead, which
-- is the same decision leads and inquiries already made and for the same reason.


-- ----------------------------------------------------------
-- 1. THE TABLE
-- ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.registry_requests (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- The only two fields the form requires. Everything else is optional because
  -- a business that cannot remember its licence number is exactly the business
  -- this queue exists to catch, and a required field it cannot fill is a
  -- request that never arrives.
  business_name   text        NOT NULL,
  email           text        NOT NULL,

  license_number  text,
  trade           text,
  county          text,
  contact_name    text,
  phone           text,
  website         text,
  notes           text,

  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'approved', 'rejected')),

  reviewed_at     timestamptz,

  -- The admin who decided. NULL until reviewed. ON DELETE SET NULL rather than
  -- CASCADE: removing a staff account must not delete the decision history of
  -- every request they ever touched.
  reviewed_by     uuid        REFERENCES auth.users (id) ON DELETE SET NULL,

  -- Free-text, staff-written, never shown to the requester. "Approve = admin
  -- manually creates the listing later" means the note is where the reviewer
  -- records what they actually did.
  review_note     text
);

COMMENT ON TABLE public.registry_requests IS
  'Public "add my business" requests from /join, for businesses with no DBPR match. Holds PII (contact_name, email, phone). Written only by app/join/actions.ts under service-role; read and decided by admins. Approving does NOT create a contractors row.';

COMMENT ON COLUMN public.registry_requests.reviewed_by IS
  'auth.users id of the deciding admin. NULL while pending.';

COMMENT ON COLUMN public.registry_requests.review_note IS
  'Internal. Never sent to the requester — there is no decision email on this queue.';


-- ----------------------------------------------------------
-- 2. INDEXES
-- ----------------------------------------------------------
--
-- The admin queue is "pending first, oldest first", which is the same shape
-- /admin/claims uses. A partial index on the pending rows keeps that read cheap
-- however many decided rows accumulate behind it.

CREATE INDEX IF NOT EXISTS registry_requests_pending_idx
  ON public.registry_requests (created_at)
  WHERE status = 'pending';

-- For the "all requests" view, which orders newest-first across every status.
CREATE INDEX IF NOT EXISTS registry_requests_created_idx
  ON public.registry_requests (created_at DESC);

-- Duplicate suppression in app/join/actions.ts is
--   WHERE email = $1 AND created_at >= $2
-- Equality column first, then the range column — same ordering rule as the
-- dedupe indexes in 20260806_rate_limits.sql.
CREATE INDEX IF NOT EXISTS registry_requests_dedupe_idx
  ON public.registry_requests (email, created_at DESC);


-- ----------------------------------------------------------
-- 3. RLS
-- ----------------------------------------------------------
--
-- anon gets nothing: no SELECT, no INSERT, no policy. service-role bypasses RLS
-- and is how the form writes. Admins read and decide through their own session,
-- which is what makes is_admin() — not a check in TypeScript — the last word.

ALTER TABLE public.registry_requests ENABLE ROW LEVEL SECURITY;

-- Belt and braces behind RLS, matching 20260804_grant_hygiene.sql: the policy
-- refuses, and there is no table grant sitting behind it either.
REVOKE ALL ON public.registry_requests FROM anon, authenticated;

-- Re-runnable: a CREATE POLICY on an existing name is an error, not a no-op.
DROP POLICY IF EXISTS "admin only registry_requests" ON public.registry_requests;

CREATE POLICY "admin only registry_requests"
  ON public.registry_requests
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- The policy above is checked against a role that has no grants, so grant back
-- exactly what an admin session needs and nothing more. No INSERT and no DELETE:
-- rows are created by the public form under service-role, and a decided request
-- is history — the admin surface offers approve and reject, never delete.
GRANT SELECT, UPDATE ON public.registry_requests TO authenticated;


-- ==========================================================
-- 4. AFTER RUNNING, CONFIRM
-- ==========================================================
--
--   -- the table and its three indexes exist
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'registry_requests';
--   -- expect: registry_requests_pkey, registry_requests_pending_idx,
--   --         registry_requests_created_idx, registry_requests_dedupe_idx
--
--   -- RLS is on and there is exactly one policy
--   SELECT relrowsecurity FROM pg_class
--    WHERE oid = 'public.registry_requests'::regclass;          -- t
--   SELECT policyname FROM pg_policies
--    WHERE tablename = 'registry_requests';                     -- 1 row
--
--
-- ⚠ THE CHECK THAT MATTERS — that the public cannot read or write this table.
-- Run against the REST endpoint with the ANON key, not in the SQL editor:
--
--   -- must NOT return rows
--   curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/registry_requests?select=*" \
--     -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"
--
--   -- must NOT insert
--   curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/registry_requests" \
--     -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
--     -H "Content-Type: application/json" \
--     -d '{"business_name":"probe","email":"probe@example.com"}'
--
-- Both must fail with 401 / 42501 permission denied. A 200 on either means the
-- REVOKE in section 3 did not take.
--
-- ⚠ AN EMPTY RESULT FROM THE FIRST CURL PROVES NOTHING ON ITS OWN while the
-- table is empty — a permission failure and an empty table look identical. Do
-- the INSERT probe, then re-read as postgres in the SQL editor to confirm the
-- row is genuinely absent:
--
--   SELECT count(*) FROM registry_requests WHERE business_name = 'probe';  -- 0
-- ==========================================================
