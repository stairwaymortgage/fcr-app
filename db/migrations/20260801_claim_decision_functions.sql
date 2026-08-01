-- ==========================================================
-- APPROVE / REJECT AS SINGLE TRANSACTIONS
-- Created 2026-08-01.
-- ==========================================================
--
-- Approving a claim has always meant TWO writes — the claims row and
-- contractors.claimed_by_user_id — and only the second one grants anything.
-- Run the first alone and the queue looks clean while the contractor signs in
-- to an unclaimed profile with no inquiries.
--
-- Documenting that was a stopgap. This removes it: both writes happen inside
-- one function, so they cannot half-apply. The admin UI calls these instead of
-- issuing UPDATEs, and there is no longer a way to do the first without the
-- second.
--
-- SECURITY DEFINER, so the function may touch contractors regardless of the
-- caller's own policies — with is_admin() checked FIRST and a pinned
-- search_path, because a definer function without those is a privilege
-- escalation waiting to be found.
--
-- CALLED WITH THE ADMIN'S OWN SESSION, NOT THE SERVICE-ROLE KEY. is_admin()
-- reads the caller's JWT; under service-role there is no app_metadata role
-- claim and the check would fail. That is the correct dependency — the
-- reviewer's identity is what authorises the decision, and auth.uid() is what
-- gets recorded in reviewed_by_user_id.
-- ==========================================================

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

  -- A profile can only be handed over once. claims_one_approved_per_profile
  -- would catch this too, but its error names an index rather than the
  -- situation, and this one reaches the reviewer as a sentence.
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
         -- and the claim page both promise. Until now the column only ever
         -- held submission + 90 days.
         id_photo_expires_at = now() + interval '90 days'
   WHERE id = p_claim_id;

  -- THE STATEMENT THAT ACTUALLY GRANTS ACCESS. Every RLS policy the contractor
  -- benefits from tests claimed_by_user_id; none of them look at claim status.
  UPDATE public.contractors
     SET claimed_by_user_id = v_claim.claimant_user_id,
         claimed_at         = now()
   WHERE dbpr_sync_key = v_claim.contractor_dbpr_sync_key;

  -- Other pending claims on this profile are deliberately LEFT PENDING rather
  -- than auto-rejected. A contested profile is a judgement call and the losing
  -- claimant deserves a reason written by a person, not a silent status flip.
  -- The queue shows them as contested so they are not forgotten.
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;


CREATE OR REPLACE FUNCTION public.reject_claim(
  p_claim_id uuid,
  p_reason   text DEFAULT NULL,
  p_notes    text DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.claims
     SET status              = 'rejected',
         reviewed_at         = now(),
         reviewed_by_user_id = auth.uid(),
         rejection_reason    = NULLIF(btrim(COALESCE(p_reason, '')), ''),
         admin_notes         = COALESCE(p_notes, admin_notes),
         id_photo_expires_at = now() + interval '90 days'
   WHERE id = p_claim_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim % is not pending', p_claim_id USING ERRCODE = 'P0002';
  END IF;

  -- contractors is untouched. A rejection must not clear claimed_by_user_id:
  -- on a contested profile that would evict the rightful owner who was already
  -- approved, as a side effect of turning someone else down.
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;


-- anon must not even be able to attempt these. The is_admin() check would
-- refuse anyway, but an un-callable function cannot be probed for timing or
-- error differences.
REVOKE ALL ON FUNCTION public.approve_claim(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_claim(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_claim(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_claim(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.approve_claim(uuid, text) IS
  'Admin only. Marks the claim approved AND links contractors.claimed_by_user_id in one transaction. Use this instead of UPDATEing the two tables by hand.';
COMMENT ON FUNCTION public.reject_claim(uuid, text, text) IS
  'Admin only. rejection_reason is shown verbatim to the contractor on /claim/rejected.';
