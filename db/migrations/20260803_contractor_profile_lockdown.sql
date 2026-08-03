-- ==========================================================
-- CONTRACTOR PORTAL: THE ONLY WRITE PATH IS AN RPC
-- Created 2026-08-03. APPLIED 2026-08-03 — scripts/verify-profile-lockdown.mjs
-- returned 33/33 against the live project. Re-verified the same day: the RPC
-- exists, all three new columns are present, anon and authenticated hold no
-- UPDATE or INSERT grant on contractors, and the old policy is gone.
-- ==========================================================
--
-- DEPLOY ORDER, RECORDED BECAUSE IT COST US.
--
-- This renames custom_logo_url to custom_logo_path and custom_owner_photo_url to
-- custom_owner_photo_path, and lib/contractor-profile.ts names both columns in
-- its SELECT list. The two must land together, migration first: with the code
-- deployed and the migration not yet run, PostgREST rejects the SELECT and every
-- public contractor profile 404s.
--
-- That is exactly what happened on the day, in the gap between running this and
-- the code reaching production. Brief and expected, but the same trap is waiting
-- for the next migration that renames a column this SELECT list names.
--
-- ==========================================================
-- WHAT WAS WRONG
-- ==========================================================
--
-- contractors carried this policy:
--
--   contractor updates own profile | UPDATE | authenticated
--     USING/WITH CHECK: claimed_by_user_id = auth.uid()
--
-- which reads like "a contractor may edit their own profile" and is not what it
-- does. AN RLS POLICY CANNOT RESTRICT COLUMNS. UPDATE was granted on all 33
-- columns to authenticated, no column-level GRANT narrowed it, and no trigger
-- guarded the DBPR fields. So a contractor whose claim had been approved could
-- write:
--
--   license_number, license_status, expiration_date, qualifying_agent_name,
--   disciplinary_codes  -- the DBPR record itself
--   slug                -- their own URL, and anyone else's by collision
--   claim_tier, featured_since, stripe_subscription_id
--                       -- a paid tier, without paying
--   claimed_by_user_id  -- hand the profile to another account
--
-- The manage-profile mockup labels those fields "Locked - sourced from DBPR".
-- That lock was CSS. Anyone posting straight at PostgREST with their own access
-- token bypassed it, and nothing in the database would have refused.
--
-- Worse, contractors_promote_on_subscription fires on ANY update that sets
-- stripe_subscription_id, and does not check Stripe. Writing an arbitrary string
-- to that column set claim_tier = 'featured'.
--
-- ==========================================================
-- THE FIX, AND WHY IT IS AN RPC
-- ==========================================================
--
-- Same shape as approve_claim()/reject_claim() in
-- 20260801_claim_decision_functions.sql: the privileged write lives in one
-- SECURITY DEFINER function with the authorisation check inside it, and the
-- caller loses the ability to do it directly.
--
-- The alternative was column-level grants - REVOKE UPDATE, then GRANT UPDATE
-- (custom_about_text, ...). That works and is more native, but it puts the
-- validation nowhere: length caps and format checks would live only in
-- TypeScript, which is the layer a hand-crafted request skips. The RPC holds
-- the allowlist AND the constraints in the same place the database enforces.
--
-- ==========================================================


-- ----------------------------------------------------------
-- 1. THE MISSING COLUMN
-- ----------------------------------------------------------
--
-- The editor collects a service area (manage_profile.html:791-794) and there
-- was nowhere to put it. Free text, deliberately: the mockup's example is
-- "Broward County, South Florida", which is a sentence, not a county code. A
-- structured county list is a different feature and would need its own UI.

ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS custom_service_area text;

COMMENT ON COLUMN public.contractors.custom_service_area IS
  'Free text, contractor-supplied, e.g. "Broward County, South Florida". Not a county code and not validated against the county tables.';


-- ----------------------------------------------------------
-- 2. BOTH IMAGE COLUMNS HOLD A PATH, NOT A URL
-- ----------------------------------------------------------
--
-- Exactly the trap 20260801_claim_id_photos_storage.sql:132-143 describes for
-- claims.id_photo_url: a column named _url invites storing a public URL, and a
-- public URL is the one thing that undoes a private bucket. That file could not
-- rename its column without touching working code. This one can - neither image
-- column is rendered anywhere today, so both names are fixed BEFORE the first
-- write rather than after.
--
-- Renaming them together is the point. Fixing one and leaving the other would
-- leave the table teaching two different lessons about the same kind of value,
-- and the photo-upload work would have to guess which name was the mistake.
--
-- Verified before renaming: the only references to either column are the SELECT
-- list and the interface in lib/contractor-profile.ts (lines 32 and 56-57).
-- Both are selected; neither is read by a component or rendered by a page.
--
-- Each rename is guarded so this file is safe to run twice, and safe to run
-- against a database where someone has already renamed one of them by hand.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'contractors'
       AND column_name = 'custom_logo_url'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'contractors'
       AND column_name = 'custom_logo_path'
  ) THEN
    ALTER TABLE public.contractors RENAME COLUMN custom_logo_url TO custom_logo_path;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'contractors'
       AND column_name = 'custom_owner_photo_url'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'contractors'
       AND column_name = 'custom_owner_photo_path'
  ) THEN
    ALTER TABLE public.contractors
      RENAME COLUMN custom_owner_photo_url TO custom_owner_photo_path;
  END IF;
END $$;

COMMENT ON COLUMN public.contractors.custom_logo_path IS
  'STORAGE PATH inside the logo bucket - NOT a URL. Never store a public URL here.';
COMMENT ON COLUMN public.contractors.custom_owner_photo_path IS
  'STORAGE PATH inside the logo bucket - NOT a URL. Never store a public URL here.';


-- ----------------------------------------------------------
-- 3. THE ONLY WRITE PATH
-- ----------------------------------------------------------
--
-- FIVE COLUMNS, NAMED LITERALLY. The UPDATE at the bottom is the allowlist -
-- there is no dynamic SQL, no column parameter, and no way to reach a sixth
-- column through it. Adding one is a deliberate edit to this function, which is
-- the point.
--
-- THIS IS A FULL REPLACE OF THE EDITABLE SET, NOT A PATCH. A NULL argument
-- CLEARS its column rather than leaving it untouched, because the editor is one
-- form with an explicit Save: every field is submitted every time, and a
-- contractor who empties the website box means to empty it. A patch-style
-- function would make clearing a field impossible without a second mechanism.
--
-- SECURITY DEFINER with is-this-yours checked FIRST and a pinned search_path,
-- for the reasons written out in 20260801_claim_decision_functions.sql:16-19.
CREATE OR REPLACE FUNCTION public.update_own_contractor_profile(
  p_dbpr_sync_key text,
  p_about         text DEFAULT NULL,
  p_website       text DEFAULT NULL,
  p_email         text DEFAULT NULL,
  p_phone         text DEFAULT NULL,
  p_service_area  text DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_owner   uuid;
  v_about   text;
  v_website text;
  v_email   text;
  v_phone   text;
  v_area    text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You are not signed in.' USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE: two tabs saving at once would otherwise both read the row and
  -- both write. Same reasoning as approve_claim().
  SELECT claimed_by_user_id INTO v_owner
    FROM public.contractors
   WHERE dbpr_sync_key = p_dbpr_sync_key
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such profile.' USING ERRCODE = 'P0002';
  END IF;

  -- One message for "not yours" and "not claimed by anyone". Distinguishing
  -- them would confirm whether a given profile has an owner, which is not
  -- something an arbitrary signed-in visitor should be able to probe.
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'You do not manage this profile.' USING ERRCODE = '42501';
  END IF;

  -- Trim, then blank becomes NULL. A field holding a single space would
  -- otherwise render as an empty row on the public profile.
  v_about   := NULLIF(btrim(COALESCE(p_about, '')), '');
  v_website := NULLIF(btrim(COALESCE(p_website, '')), '');
  v_email   := lower(NULLIF(btrim(COALESCE(p_email, '')), ''));
  v_phone   := NULLIF(btrim(COALESCE(p_phone, '')), '');
  v_area    := NULLIF(btrim(COALESCE(p_service_area, '')), '');

  -- Caps are enforced here rather than as column types, so the message can say
  -- what was wrong. varchar(1200) would raise "value too long for type", which
  -- tells a contractor nothing about which box to shorten.
  IF length(v_about) > 1200 THEN
    RAISE EXCEPTION 'Your About text is % characters. The limit is 1200.', length(v_about)
      USING ERRCODE = '22001';
  END IF;

  IF length(v_website) > 300 THEN
    RAISE EXCEPTION 'That website address is too long (limit 300 characters).'
      USING ERRCODE = '22001';
  END IF;

  IF length(v_email) > 254 THEN
    RAISE EXCEPTION 'That email address is too long (limit 254 characters).'
      USING ERRCODE = '22001';
  END IF;

  IF length(v_phone) > 32 THEN
    RAISE EXCEPTION 'That phone number is too long (limit 32 characters).'
      USING ERRCODE = '22001';
  END IF;

  IF length(v_area) > 200 THEN
    RAISE EXCEPTION 'That service area is too long (limit 200 characters).'
      USING ERRCODE = '22001';
  END IF;

  -- http(s) ONLY. Without a scheme check a contractor can save
  -- "javascript:..." or "data:..." into a field the public profile renders as
  -- an href - stored XSS delivered from a verified business listing. The
  -- profile page should still not trust this; that is two checks, on purpose.
  IF v_website IS NOT NULL AND v_website !~* '^https?://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'Your website must start with http:// or https://'
      USING ERRCODE = '22023';
  END IF;

  -- Deliberately loose. The purpose is to catch a typo before it is published
  -- as a contact route, not to adjudicate RFC 5322 - a regex strict enough to
  -- do that rejects real addresses.
  IF v_email IS NOT NULL
     AND v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' THEN
    RAISE EXCEPTION 'That does not look like an email address.'
      USING ERRCODE = '22023';
  END IF;

  -- THE ALLOWLIST. Five columns. Nothing here can reach license_number,
  -- license_status, slug, claim_tier, featured_since, stripe_subscription_id or
  -- claimed_by_user_id, whatever the caller sends.
  UPDATE public.contractors
     SET custom_about_text   = v_about,
         custom_website_url  = v_website,
         custom_email        = v_email,
         custom_phone        = v_phone,
         custom_service_area = v_area
   WHERE dbpr_sync_key = p_dbpr_sync_key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;

-- anon must not be able to attempt it. The auth.uid() check would refuse
-- anyway, but an un-callable function cannot be probed for error differences.
REVOKE ALL ON FUNCTION public.update_own_contractor_profile(text, text, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_own_contractor_profile(text, text, text, text, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.update_own_contractor_profile(text, text, text, text, text, text) IS
  'The ONLY contractor-facing write path to public.contractors. Five editable columns, allowlisted literally. Direct UPDATE is revoked from authenticated - do not grant it back.';


-- ----------------------------------------------------------
-- 4. CLOSE THE DIRECT PATH
-- ----------------------------------------------------------
--
-- The policy goes first. Leaving it in place with the grants removed would be
-- worse than either state on its own: pg_policies would keep advertising that
-- contractors may update their own row, and the next person reading it would
-- have to check the grant table to find out it does nothing.

DROP POLICY IF EXISTS "contractor updates own profile" ON public.contractors;

-- INSERT is revoked too. No policy allowed it, so RLS was already refusing -
-- but the grant existing at all is what made the UPDATE hole possible, and
-- there is no contractor-facing reason to create a contractors row. The DBPR
-- importer uses the service role, which keeps every grant it has.
REVOKE UPDATE, INSERT ON public.contractors FROM authenticated, anon;

-- ⚠ CONSEQUENCE, ACCEPTED DELIBERATELY: "admin full access contractors" is
-- FOR ALL TO authenticated, so an admin acting through their own session now
-- has no UPDATE on this table either. Nothing does that today - the admin UI
-- reads with the service role, and approve_claim() is SECURITY DEFINER so it
-- still writes claimed_by_user_id normally. If an admin edit screen is ever
-- built, give it its own RPC rather than granting UPDATE back here.


-- ==========================================================
-- 5. VERIFY - scripts/verify-profile-lockdown.mjs does all of this
-- ==========================================================
--
--   node --no-warnings scripts/verify-profile-lockdown.mjs
--
-- An empty table proves nothing, so it creates two contractors owned by two
-- signed-in users and asserts, against the live API:
--
--   a) the owner CAN set the five editable fields through the RPC
--   b) the owner CANNOT direct-UPDATE their own row at all
--   c) license_number, claim_tier, slug and stripe_subscription_id are
--      unchanged after a direct attempt at each
--   d) user B cannot edit user A's profile through the RPC
--   e) a signed-in user with no claim cannot edit an unclaimed profile
--   f) anon can neither call the RPC nor update the table
--   g) over-length and malformed input is refused with a readable message
--
-- Grants, after this runs:
--   SELECT grantee, privilege_type FROM information_schema.column_privileges
--    WHERE table_name='contractors' AND grantee IN ('anon','authenticated')
--    GROUP BY 1,2;              -- expect SELECT and REFERENCES only
-- ==========================================================
