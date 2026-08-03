-- ==========================================================
-- APPROVAL MUST SET claim_tier. IT NEVER DID.
-- Created 2026-08-03. APPLIED 2026-08-03 — scripts/verify-claim-approval.mjs
-- returned 24/24, including the claim_tier assertions this file exists for, the
-- featured-not-demoted guard, and the whole-table check that no row has an owner
-- while still reading 'unclaimed'. verify-profile-lockdown.mjs still 33/33.
-- ==========================================================
--
-- DEPLOY ORDER: EITHER WAY IS SAFE THIS TIME. Nothing in the accompanying code
-- change reads a column that does not already exist, so the app works against
-- an un-migrated database and this migration works against the old code. That
-- is the opposite of 20260803_contractor_profile_lockdown.sql, which renamed
-- columns a SELECT list named and had to land first. Sequence it however you
-- like; the two together are what close the bug.
--
-- ==========================================================
-- WHAT WAS WRONG
-- ==========================================================
--
-- approve_claim() wrote two columns on the contractors row:
--
--   claimed_by_user_id = <the claimant>
--   claimed_at         = now()
--
-- and left claim_tier at its default of 'unclaimed'. Nothing else on the
-- approval path touched it. The only code that has ever written claim_tier is
-- the promote_to_featured_on_subscription trigger, which sets 'featured' when a
-- Stripe subscription appears and drops back to 'claimed' when one is removed -
-- a path a newly approved contractor never takes. So 'claimed' was a legal
-- value in the CHECK constraint that nothing ever assigned.
--
-- isClaimed() in lib/contractor-profile.ts read claim_tier. The result, live on
-- 2026-08-03: a contractor completed verification, was approved, saved an About
-- text and contact details through the editor, and their public profile still
-- showed the DBPR-generated description, the "This profile has not been claimed
-- by its owner" disclaimer, and the "Is this your business?" claim box. Every
-- custom field was hidden. The row said claimed_by_user_id = <them> and
-- claim_tier = 'unclaimed' at the same time.
--
-- The editor worked throughout, which is what made it confusing: /manage gates
-- on claimed_by_user_id and the public page gated on claim_tier. Two definitions
-- of "claimed", and approval only ever satisfied one of them.
--
-- ==========================================================
-- THE FIX IS IN TWO PLACES AND BOTH ARE NEEDED
-- ==========================================================
--
-- Here: approval sets claim_tier, so the column means what its name says.
--
-- In the application: isClaimed() now reads claimed_by_user_id, which is the
-- column that actually grants every capability - it is what every RLS policy
-- tests and what approve_claim() has always written. claim_tier keeps its real
-- job, which is isFeatured().
--
-- Either change alone would have fixed the symptom. Both together remove the
-- possibility of the two columns disagreeing again, which is the actual defect.
-- ==========================================================


-- ----------------------------------------------------------
-- 1. APPROVAL SETS THE TIER
-- ----------------------------------------------------------
--
-- Reproduced in full because CREATE OR REPLACE needs the whole body. The ONLY
-- change from 20260801_claim_decision_functions.sql is the claim_tier line in
-- the second UPDATE, marked below.

CREATE OR REPLACE FUNCTION public.approve_claim(
  p_claim_id uuid,
  p_notes    text DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_claim   record;
  v_claimed uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE: two admins approving the same claim at once would otherwise
  -- both read 'pending' and both write. The row lock serialises them; the
  -- second then fails the status test below.
  SELECT * INTO v_claim
    FROM public.claims
   WHERE id = p_claim_id AND status = 'pending'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim % is not pending', p_claim_id USING ERRCODE = 'P0002';
  END IF;

  -- A profile can only be handed over once.
  SELECT claimed_by_user_id INTO v_claimed
    FROM public.contractors
   WHERE dbpr_sync_key = v_claim.contractor_dbpr_sync_key
   FOR UPDATE;

  IF v_claimed IS NOT NULL AND v_claimed <> v_claim.claimant_user_id THEN
    RAISE EXCEPTION 'profile is already claimed by another user'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.claims
     SET status              = 'approved',
         reviewed_at         = now(),
         reviewed_by_user_id = auth.uid(),
         admin_notes         = COALESCE(p_notes, admin_notes),
         -- Retention runs from the DECISION, which is what the table comment
         -- and the claim page both promise.
         id_photo_expires_at = now() + interval '90 days'
   WHERE id = p_claim_id;

  -- THE STATEMENT THAT ACTUALLY GRANTS ACCESS. Every RLS policy the contractor
  -- benefits from tests claimed_by_user_id; none of them look at claim status.
  UPDATE public.contractors
     SET claimed_by_user_id = v_claim.claimant_user_id,
         claimed_at         = now(),
         -- ▼ THE ONLY NEW LINE. Without it an approved profile kept rendering
         -- as unclaimed on the public page.
         --
         -- NULLIF/COALESCE rather than a plain assignment so re-approving a
         -- profile that is already 'featured' cannot demote it to 'claimed' and
         -- silently cancel someone's paid placement. Only 'unclaimed' is
         -- promoted; anything else is left exactly as it is.
         claim_tier         = COALESCE(NULLIF(claim_tier, 'unclaimed'), 'claimed')
   WHERE dbpr_sync_key = v_claim.contractor_dbpr_sync_key;

  -- Other pending claims on this profile are deliberately LEFT PENDING rather
  -- than auto-rejected. A contested profile is a judgement call and the losing
  -- claimant deserves a reason written by a person.
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;

REVOKE ALL ON FUNCTION public.approve_claim(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_claim(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.approve_claim(uuid, text) IS
  'Admin only. Marks the claim approved, links contractors.claimed_by_user_id AND promotes claim_tier to claimed, in one transaction. Use this instead of UPDATEing the tables by hand.';


-- ----------------------------------------------------------
-- 2. BACKFILL THE ROWS APPROVED BEFORE THE FIX
-- ----------------------------------------------------------
--
-- Every profile that already has an owner but is still sitting at 'unclaimed'.
-- Without this, existing approvals stay broken on the public page no matter
-- what the function does from now on - the approval that created them has
-- already run and will not run again.
--
-- Narrow on purpose. It touches only rows where the two columns already
-- disagree, so it cannot alter a 'featured' row and cannot claim a profile that
-- has no owner.

UPDATE public.contractors
   SET claim_tier = 'claimed'
 WHERE claimed_by_user_id IS NOT NULL
   AND claim_tier = 'unclaimed';


-- ----------------------------------------------------------
-- 3. WHAT claim_tier IS FOR, NOW THAT IT IS NOT THE CLAIM FLAG
-- ----------------------------------------------------------

COMMENT ON COLUMN public.contractors.claim_tier IS
  'unclaimed | claimed | featured. Display tier, driving isFeatured(). NOT the source of truth for whether a profile is claimed - that is claimed_by_user_id, which is what every RLS policy tests and what isClaimed() reads. Set by approve_claim() and by promote_to_featured_on_subscription().';

COMMENT ON COLUMN public.contractors.claimed_by_user_id IS
  'auth.users id of the verified owner, written by approve_claim(). THE source of truth for "is this profile claimed" - every RLS policy and isClaimed() test this column.';


-- ==========================================================
-- 4. VERIFY
-- ==========================================================
--
--   node --no-warnings scripts/verify-claim-approval.mjs
--
-- Extended in the same change to call approve_claim() rather than hand-written
-- UPDATEs, and to assert claim_tier after approval - the assertion whose absence
-- is why this shipped.
--
-- No row should be left disagreeing:
--   SELECT count(*) FROM contractors
--    WHERE claimed_by_user_id IS NOT NULL AND claim_tier = 'unclaimed';  -- 0
--   SELECT count(*) FROM contractors
--    WHERE claimed_by_user_id IS NULL AND claim_tier <> 'unclaimed';     -- 0
-- ==========================================================
