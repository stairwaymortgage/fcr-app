-- ==========================================================
-- CLAIM FLOW: columns the form collects + duplicate prevention
-- Created 2026-08-01.
-- ==========================================================

-- ----------------------------------------------------------
-- 1. COLUMNS THE MOCKUP COLLECTS AND THE TABLE HAD NOWHERE TO PUT
-- ----------------------------------------------------------
--
-- contractor_claim_flow.html asks for role, phone, a business description and a
-- website. Without these the form would collect them and drop them on the
-- floor — the contractor answers questions that go nowhere and Jim reviews a
-- claim missing the two fields that identify the person (role and phone).

ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS claimant_role text,
  ADD COLUMN IF NOT EXISTS claimant_phone text,
  -- PROPOSED, not applied. These are unverified strings typed by someone who
  -- is not yet proven to control the profile, so they must not touch
  -- public.contractors until a human approves the claim. Naming them
  -- proposed_* makes a mistaken UPDATE ... FROM claims obvious in review.
  ADD COLUMN IF NOT EXISTS proposed_business_description text,
  ADD COLUMN IF NOT EXISTS proposed_business_website text,
  ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NOT NULL DEFAULT false,
  -- The attestation is stored VERBATIM, for the same reason leads store
  -- sms_consent_text: the evidentiary value of a consent record is that it
  -- proves what the person actually saw. A claim is an assertion of legal
  -- authority over a licensed business; if it is ever disputed, "they ticked a
  -- box" is worth much less than the sentence they ticked.
  ADD COLUMN IF NOT EXISTS attestation_text text;

ALTER TABLE public.claims
  DROP CONSTRAINT IF EXISTS claims_role_check;
ALTER TABLE public.claims
  ADD CONSTRAINT claims_role_check CHECK (
    claimant_role IS NULL OR
    claimant_role IN ('qualifying_agent', 'owner_officer', 'authorized_rep')
  );

COMMENT ON COLUMN public.claims.proposed_business_description IS
  'Unverified. Applied to contractors only on approval, never automatically.';
COMMENT ON COLUMN public.claims.attestation_text IS
  'Verbatim text the claimant agreed to, stored as evidence. See lib/claims.ts.';


-- ----------------------------------------------------------
-- 2. id_photo_expires_at — the column is NOT NULL and nothing was setting it
-- ----------------------------------------------------------
--
-- A default so an insert cannot fail on a column the form has no business
-- knowing about. 90 days from submission is a FLOOR: the table's stated policy
-- is 90 days post-DECISION, so the purge job should use
-- greatest(created_at, reviewed_at) + 90 days. Still not implemented — see the
-- warning in 20260801_claim_id_photos_storage.sql.
ALTER TABLE public.claims
  ALTER COLUMN id_photo_expires_at SET DEFAULT (now() + interval '90 days');


-- ----------------------------------------------------------
-- 3. DUPLICATE AND CONTENTION RULES — ENFORCED IN THE DATABASE
-- ----------------------------------------------------------
--
-- The application checks these too, but application checks lose the race. Two
-- taps on a slow phone submit twice before the first insert lands, and both
-- SELECTs see no existing claim. Only a unique index actually prevents it.

-- One PENDING claim per (profile, person). A rejected claim is deliberately
-- NOT covered: someone who photographed their licence badly must be able to
-- try again, and a permanent lockout after one rejection would be a support
-- burden with no security benefit.
CREATE UNIQUE INDEX IF NOT EXISTS claims_one_pending_per_user_profile
  ON public.claims (contractor_dbpr_sync_key, claimant_user_id)
  WHERE status = 'pending';

-- One APPROVED claim per profile, ever. contractors.claimed_by_user_id can
-- only hold one uuid, so a second approved claim would silently disagree with
-- the profile about who owns it — and which of the two is authoritative would
-- depend on which query you happened to run.
CREATE UNIQUE INDEX IF NOT EXISTS claims_one_approved_per_profile
  ON public.claims (contractor_dbpr_sync_key)
  WHERE status = 'approved';

-- Jim's review queue joins claims to contractors; without this every review
-- page scans 266K rows.
CREATE INDEX IF NOT EXISTS idx_claims_contractor
  ON public.claims (contractor_dbpr_sync_key);

-- "Do I already have a claim in flight?" runs on every claim page load.
CREATE INDEX IF NOT EXISTS idx_claims_claimant
  ON public.claims (claimant_user_id, status);


-- ----------------------------------------------------------
-- 4. TWO CLAIMANTS, ONE PROFILE — DELIBERATELY ALLOWED
-- ----------------------------------------------------------
--
-- Nothing above stops two different people holding a pending claim on the same
-- profile, and that is on purpose. A qualifying agent and an owner may both
-- submit in good faith, and a licence that changed hands genuinely has two
-- people with a story. Blocking the second would let whoever claims first
-- freeze out the rightful owner for as long as the queue takes — a trivial
-- denial-of-service against a real contractor's listing.
--
-- So both are accepted, both are shown to Jim as contested, and a human picks.
-- Approving one leaves the other pending; Jim rejects it explicitly, which is
-- the record you want in a dispute.
--
-- ⚠ The moment the second is approved the unique index above raises
--   duplicate key value violates unique constraint "claims_one_approved_per_profile"
-- which is the intended outcome, but reads as a database error rather than
-- "this profile is already claimed" until the admin UI translates it.


-- ----------------------------------------------------------
-- 5. THE REVIEW PROCESS, WHERE THE REVIEWER WILL ACTUALLY BE
-- ----------------------------------------------------------
--
-- docs/claim-review-runbook.md is the full version. These COMMENTs duplicate
-- the essentials onto the table itself, because there is no admin UI and the
-- review happens in the Supabase dashboard — where a markdown file in a repo
-- is not in front of anyone. Same lesson as the leads table: a capture point
-- nobody checks is worth nothing, and a process that lives only in a document
-- the reviewer never opens is a process that does not exist.
--
-- The two-statement approval is called out in the status column comment too,
-- since that is the field someone edits when they think they are approving.

COMMENT ON TABLE public.claims IS
'Contractor identity verification attempts. ID photos auto-delete 90 days post-decision (PURGE JOB NOT BUILT YET).

HOW TO REVIEW: docs/claim-review-runbook.md in the repo.

Queue:  SELECT * FROM claims WHERE status = ''pending'' ORDER BY created_at;
Photo:  Storage -> id-photos -> folder named for claimant_user_id -> click the file.
        (The dashboard authenticates as service role. No signed URL needed.)
Check:  name on the ID vs contractors.qualifying_agent_name.

APPROVING TAKES TWO STATEMENTS. The second one is what actually grants access:
  UPDATE claims SET status=''approved'', reviewed_at=now(), reviewed_by_user_id=''<you>'' WHERE id=''<claim>'';
  UPDATE contractors SET claimed_by_user_id=''<claimant_user_id>'', claimed_at=now() WHERE dbpr_sync_key=''<key>'';
Run only the first and the claim reads approved while the contractor sees an unclaimed profile and no inquiries.';

COMMENT ON COLUMN public.claims.status IS
'pending | approved | rejected. Setting this to approved GRANTS NOTHING on its own - contractors.claimed_by_user_id is what every RLS policy tests. See the table comment.';

COMMENT ON COLUMN public.claims.claimant_user_id IS
'auth.users id. Also the FOLDER NAME holding the ID photo in the private id-photos bucket.';

COMMENT ON COLUMN public.claims.rejection_reason IS
'Shown VERBATIM to the contractor on /claim/rejected. Write it for them to read; use admin_notes for internal notes. Rejection is not a lockout - they can submit again immediately.';
