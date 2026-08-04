-- ==========================================================
-- RELEASING A CLAIMED PROFILE — THE ONLY WAY BACK OUT
-- Created 2026-08-04. APPLIED 2026-08-04 by Jim in the Supabase SQL Editor.
-- Verified by scripts/verify-release-profile.mjs against the live project.
-- ==========================================================
--
-- ⚠ DEPLOY ORDER: THIS FILE FIRST, THEN CODE. /manage/[slug]/settings calls
-- release_own_contractor_profile() by name; with the code deployed and this not
-- yet run, the Release button fails with PGRST202 while the rest of the page
-- works. Same partial failure as the inquiries inbox and the logo upload.
--
-- ==========================================================
-- WHY THIS EXISTS
-- ==========================================================
--
-- There is currently NO way for a contractor to undo a claim. approve_claim()
-- links contractors.claimed_by_user_id, and nothing anywhere unlinks it —
-- verified by searching the whole repo for unclaim/release/revoke on 2026-08-04.
-- The only exit today is asking Jim to run UPDATEs by hand, which is precisely
-- the hand-written-two-statement hazard that approve_claim() was written to
-- remove.
--
-- Who needs it: someone who claimed the wrong licence of the three their agent
-- holds; a qualifying agent who has left the business; an owner who sold it.
-- All three are ordinary, and all three currently end in a support request.
--
-- ==========================================================
-- WHAT IT DOES, AND THE FOUR THINGS THAT ARE NOT OBVIOUS
-- ==========================================================
--
-- 1. THE CLAIMS ROW STAYS 'approved'. A release does not unmake the
--    verification — a real person did submit a real government ID and Jim did
--    approve it, and that remains true afterwards. Rewriting the row to
--    'rejected' would be a lie in the audit trail, and 'released' is not in the
--    column's CHECK constraint (pending/approved/rejected). Instead released_at
--    is stamped below: additive, no constraint change, and it keeps
--    "was this identity verified" and "does this person still manage the
--    listing" as the two separate questions they actually are.
--
-- 2. THE CUSTOM TEXT IS KEPT. custom_about_text, custom_website_url,
--    custom_email, custom_phone and custom_service_area survive a release.
--    Every one is gated behind isClaimed() on the public profile — which reads
--    claimed_by_user_id — so nulling the linkage hides all of it immediately
--    and completely. Keeping the columns means a mis-click is recoverable by
--    re-claiming rather than retyping twelve hundred characters.
--
--    ⚠ THIS IS NOT A DATA-DELETION MECHANISM AND MUST NOT BE SOLD AS ONE. A
--    contractor asking us to erase what they wrote is a different request with
--    a different answer; the settings page says so in as many words.
--
-- 3. THE LOGO IS DELETED, and it is the one thing that must be. Unlike the text,
--    the logo is an object in a PUBLIC bucket: it is served by URL to anyone who
--    has it, and no amount of gating on the page can stop that. A released
--    profile whose owner's logo is still fetchable from our infrastructure is a
--    promise broken in the one place the page cannot cover.
--
--    Postgres cannot delete a storage object, so the function RETURNS the paths
--    it cleared and the caller must remove them — the same contract
--    set_own_contractor_image() already uses, for the same reason.
--
-- 4. RE-CLAIMING IS A FULL RE-VERIFICATION. After a release,
--    claimed_by_user_id is null, so /contractor/{slug}/claim shows the form
--    again — the page gates on the live linkage, not on claim history, and the
--    old claim is 'approved' rather than 'pending' so it blocks nothing. That
--    means a fresh ID photo and another manual review. Correct (identity should
--    be re-checked when a listing changes hands) but expensive for a mis-click,
--    which is why the UI requires typing the licence number to confirm.
--
-- WHAT IT DELIBERATELY DOES NOT DO: delete the account. claims.claimant_user_id
-- is REFERENCES auth.users(id) ON DELETE CASCADE, so deleting the auth user
-- destroys the verification record along with it. Self-serve account deletion
-- would quietly erase the audit trail for every claim that user ever made.
-- That stays a support request until there is a design that preserves the
-- record.


-- ----------------------------------------------------------
-- 1. THE AUDIT COLUMN
-- ----------------------------------------------------------
--
-- Nullable and additive. NULL means "this approval is still in force"; a
-- timestamp means "the claimant handed the listing back on this date".
--
-- ON claims RATHER THAN A claim_releases TABLE because a release is an event in
-- the life of one claim, not an entity with its own attributes. If releases ever
-- need a reason, an actor, or more than one per claim, that is when it becomes
-- a table — and moving it then is a smaller change than pretending now.
ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS released_at timestamptz;

COMMENT ON COLUMN public.claims.released_at IS
  'Set when the claimant voluntarily released the profile. The row stays status=approved on purpose - the identity WAS verified; this records that the linkage was later given up. NULL means the approval is still in force.';


-- ----------------------------------------------------------
-- 2. THE FUNCTION
-- ----------------------------------------------------------
--
-- SECURITY DEFINER with ownership checked FIRST and a pinned search_path, for
-- the reasons in 20260801_claim_decision_functions.sql:16-19.
--
-- RETURNS the storage paths it cleared, so the caller can delete the objects.
-- Both image columns are returned even though only the logo has a UI today —
-- custom_owner_photo_path can hold a path the moment that slot is built, and a
-- release that silently left it behind would be a leak nobody was looking for.
-- ⚠ THE PATHS ARE READ BEFORE THE UPDATE, NOT RETURNED BY IT. An earlier draft
-- of this function used UPDATE ... RETURNING to hand back the image paths, which
-- silently returns NULL every time: RETURNING sees the NEW row, and the new row
-- is the one whose image columns were just set to NULL. The caller would have
-- got two nulls, deleted nothing, and left both objects in a public bucket with
-- nothing in the database referencing them — a leak with no symptom.
--
CREATE OR REPLACE FUNCTION public.release_own_contractor_profile(
  p_dbpr_sync_key text
)
RETURNS TABLE (logo_path text, owner_photo_path text) AS $$
DECLARE
  v_owner uuid;
  v_logo  text;
  v_photo text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You are not signed in.' USING ERRCODE = '42501';
  END IF;

  SELECT claimed_by_user_id, custom_logo_path, custom_owner_photo_path
    INTO v_owner, v_logo, v_photo
    FROM public.contractors
   WHERE dbpr_sync_key = p_dbpr_sync_key
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such profile.' USING ERRCODE = 'P0002';
  END IF;

  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'You do not manage this profile.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.claims
     SET released_at = now()
   WHERE contractor_dbpr_sync_key = p_dbpr_sync_key
     AND claimant_user_id = auth.uid()
     AND status = 'approved'
     AND released_at IS NULL;

  UPDATE public.contractors
     SET claimed_by_user_id      = NULL,
         claimed_at              = NULL,
         claim_tier              = 'unclaimed',
         custom_logo_path        = NULL,
         custom_owner_photo_path = NULL
   WHERE dbpr_sync_key = p_dbpr_sync_key;

  logo_path        := v_logo;
  owner_photo_path := v_photo;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;

REVOKE ALL ON FUNCTION public.release_own_contractor_profile(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_own_contractor_profile(text) TO authenticated;

COMMENT ON FUNCTION public.release_own_contractor_profile(text) IS
  'Contractor-initiated release of a claimed profile. Clears the linkage and both image columns, stamps claims.released_at, KEEPS the custom text (hidden by isClaimed anyway) and KEEPS the claims row at status=approved. Returns the storage paths it cleared - the caller MUST delete those objects.';


-- ==========================================================
-- 3. VERIFY - scripts/verify-release-profile.mjs (written with the build)
-- ==========================================================
--
--   node --no-warnings scripts/verify-release-profile.mjs
--
-- The attempts that must fail:
--   a) anon cannot call it; a signed-in user with no claim cannot call it
--   b) contractor B cannot release contractor A's profile
--   c) a released profile cannot be released twice into a second released_at
--
-- And the state afterwards:
--   d) claimed_by_user_id, claimed_at, claim_tier, and BOTH image columns clear
--   e) the claims row is still status='approved', now with released_at set
--   f) custom_about_text and the contact columns are UNCHANGED
--   g) the public profile stops showing every custom field (isClaimed is false)
--   h) the returned logo path is the one that was set, so the caller can delete
--      the object — and after the caller does, it is gone from the bucket
--   i) the profile is claimable again by a different user
-- ==========================================================
