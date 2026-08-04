-- ==========================================================
-- INQUIRIES: THE CONTRACTOR'S ONLY WRITE PATH IS AN RPC
-- Created 2026-08-04. APPLIED 2026-08-04 — scripts/verify-inquiries-lockdown.mjs
-- returned 38/38 against the live project, having returned 25/38 against it
-- immediately before, with every failure in sections D and E. That before/after
-- pair is the evidence; a suite that only ever ran green would not have shown
-- the hole existed.
--
-- Applied in two passes. The second is a one-line fix to the null guard in §1,
-- caught by section F of the verify script: `NULL NOT IN (...)` is NULL rather
-- than TRUE, so a null p_status walked past the readable check and hit the
-- column's NOT NULL constraint instead. Same function, replaced in place.
-- ==========================================================
--
-- ⚠ DEPLOY ORDER: MIGRATION FIRST, THEN CODE. OBSERVED, NOT PREDICTED —
-- /inquiries was smoke-tested against the live project before this file was
-- applied, and mark-as-read failed with PGRST202 "could not find the function
-- set_own_inquiry_status" while the list, the tabs, the search and the detail
-- pane all rendered correctly. Exactly the partial failure described below.
--
-- app/inquiries/ calls set_own_inquiry_status() for every state change —
-- mark-as-read on open, Archive, Mark as Replied, Move back to inbox. With the
-- code deployed and this file not yet run, PostgREST answers
-- "Could not find the function public.set_own_inquiry_status" and every one of
-- those actions fails; the inbox still lists and reads correctly, so the
-- failure is partial and easy to miss.
--
-- The reverse order is harmless: applying this before the code ships removes an
-- UPDATE grant that nothing in the app was using. Nothing reads or writes
-- inquiries today except the service-role INSERT in
-- app/contractor/[slug]/actions.ts, which keeps every grant it has.
--
-- ==========================================================
-- WHAT WAS WRONG — AND WHAT WAS NOT
-- ==========================================================
--
-- The recon flag was: "contractor updates own inquiries" has USING but
-- with_check: null — can a contractor UPDATE a row INTO a state they shouldn't,
-- or reassign contractor_dbpr_sync_key to somebody else's profile?
--
-- NO, AND THAT PART IS A FALSE ALARM. For an UPDATE policy Postgres uses the
-- USING expression as the WITH CHECK when WITH CHECK is omitted, so the NEW row
-- must satisfy the same ownership test as the old one. Verified against the live
-- project on 2026-08-04 with two signed-in users holding two claimed profiles:
--
--   A moves own inquiry to B's contractor  -> 42501, new row violates RLS policy
--   A moves own inquiry to own 2nd profile -> allowed (still A's, harmless)
--   A updates B's inquiry                  -> 0 rows
--   A INSERTs an inquiry                   -> 42501 (no INSERT policy)
--   A DELETEs own inquiry                  -> 0 rows (no DELETE policy)
--   anon SELECT / UPDATE                   -> 0 rows
--
-- Adding an explicit WITH CHECK would therefore change nothing at runtime. It is
-- still worth stating in a policy that survives this file — see §3.
--
-- ==========================================================
-- THE REAL HOLE: COLUMN SCOPE
-- ==========================================================
--
-- AN RLS POLICY CANNOT RESTRICT COLUMNS. The same sentence that opens
-- 20260803_contractor_profile_lockdown.sql, and the same bug, one table over.
-- UPDATE is granted on all nine columns to authenticated, no column-level GRANT
-- narrows it, and no trigger guards the homeowner's half of the row. So a
-- contractor with an approved claim, posting straight at PostgREST with their
-- own access token, could write — verified live, same session as above:
--
--   message      -- the homeowner's own words, rewritten to anything
--   from_email   -- the reply-to address, repointed
--   from_name    -- who it says sent it
--   from_phone
--   created_at   -- backdated, so "received 9 min ago" is whatever they say
--   replied_at   -- a response time they did not achieve
--
-- The final row after that run read: from_email 'attacker@example.com',
-- message 'TAMPERED', created_at '2020-01-01'. Nothing in the database refused.
--
-- WHY IT MATTERS HERE SPECIFICALLY. An inquiry is the record of what a homeowner
-- asked for and when. It is the thing a contractor and a homeowner would
-- disagree about later, it is what a complaint would be adjudicated against, and
-- once the Featured tier exists it is what a contractor is BILLED for — a party
-- who can edit the record of the lead can edit the evidence for the dispute
-- about the lead. Only the contractor's own workflow state (status, replied_at)
-- is theirs to write.
--
-- The contractor UI never offered any of this, exactly as the manage-profile
-- mockup labelled the DBPR fields "Locked". That lock was CSS. This one is not.
--
-- ==========================================================
-- THE FIX, AND WHY IT IS AN RPC
-- ==========================================================
--
-- Same shape and the same reasoning as update_own_contractor_profile(): the
-- privileged write lives in one SECURITY DEFINER function with the authorisation
-- check inside it, and the caller loses the ability to do it directly.
--
-- Column-level GRANT UPDATE (status, replied_at) would close the tampering hole
-- too, and is more native. It is not enough here, because the two columns are
-- coupled: "replied" is only true if replied_at is set, and a caller holding
-- both grants can set either without the other — status 'replied' with a null
-- replied_at, or a replied_at on an archived row. The RPC makes replied_at a
-- consequence of the transition rather than an input, which no grant can do.


-- ----------------------------------------------------------
-- 1. THE ONLY CONTRACTOR-FACING WRITE PATH
-- ----------------------------------------------------------
--
-- TWO COLUMNS, NAMED LITERALLY, and one of them is not a parameter. There is no
-- dynamic SQL and no column argument; reaching from_name or created_at through
-- this function is impossible whatever the caller sends.
--
-- SECURITY DEFINER with is-this-yours checked FIRST and a pinned search_path,
-- for the reasons written out in 20260801_claim_decision_functions.sql:16-19.
CREATE OR REPLACE FUNCTION public.set_own_inquiry_status(
  p_inquiry_id uuid,
  p_status     text
)
RETURNS void AS $$
DECLARE
  v_owner   uuid;
  v_current text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You are not signed in.' USING ERRCODE = '42501';
  END IF;

  -- The allowed set is written here as well as in the column's CHECK
  -- constraint. The CHECK would refuse a bad value anyway, with
  -- "violates check constraint inquiries_status_check" — an operator's
  -- sentence. This one is a contractor's.
  --
  -- IS NULL IS TESTED SEPARATELY, and it is not belt-and-braces. `NULL NOT IN
  -- (...)` evaluates to NULL, not TRUE, so a null argument walks straight past
  -- an IN test and falls through to the UPDATE, where the column's NOT NULL
  -- refuses it — correctly, but with "null value in column status violates
  -- not-null constraint", which is exactly the operator's sentence this branch
  -- exists to avoid. Caught by section F of the verify script.
  IF p_status IS NULL OR p_status NOT IN ('unread', 'read', 'replied', 'archived') THEN
    RAISE EXCEPTION 'Unknown inquiry status "%".', p_status USING ERRCODE = '22023';
  END IF;

  -- FOR UPDATE on the inquiry, not on the contractor: two tabs archiving the
  -- same inquiry would otherwise both read 'unread' and both write. Same
  -- reasoning as approve_claim().
  SELECT i.status, c.claimed_by_user_id
    INTO v_current, v_owner
    FROM public.inquiries i
    JOIN public.contractors c
      ON c.dbpr_sync_key = i.contractor_dbpr_sync_key
   WHERE i.id = p_inquiry_id
   FOR UPDATE OF i;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such inquiry.' USING ERRCODE = 'P0002';
  END IF;

  -- One message for "not yours" and "sent to a profile nobody has claimed".
  -- Distinguishing them would let any signed-in visitor probe, one inquiry id
  -- at a time, whether a given inquiry exists and whether its profile has an
  -- owner. Same rule as update_own_contractor_profile().
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'That inquiry was not sent to a profile you manage.'
      USING ERRCODE = '42501';
  END IF;

  -- replied_at IS SET HERE, NEVER PASSED IN. It is a fact about when the
  -- transition happened, so the caller has no business supplying it.
  --
  -- SET ONCE AND NEVER CLEARED, including when the row is later archived or
  -- pushed back to 'read'. status is a single column carrying the whole flow
  -- (there is no read_at or archived_at), so archiving already destroys the
  -- read/replied distinction; replied_at is the only durable evidence that a
  -- contractor responded at all, and response time is exactly the number this
  -- product will be judged on. COALESCE keeps the FIRST reply's timestamp
  -- rather than the most recent one, which is the honest reading of
  -- "responded within 4 hours".
  UPDATE public.inquiries
     SET status = p_status,
         replied_at = CASE
           WHEN p_status = 'replied' THEN COALESCE(replied_at, now())
           ELSE replied_at
         END
   WHERE id = p_inquiry_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;

-- anon must not be able to attempt it. The auth.uid() check would refuse
-- anyway, but an un-callable function cannot be probed for error differences.
REVOKE ALL ON FUNCTION public.set_own_inquiry_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_own_inquiry_status(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.set_own_inquiry_status(uuid, text) IS
  'The ONLY contractor-facing write path to public.inquiries. Writes status, and replied_at as a consequence of the transition. Direct UPDATE is revoked from authenticated - do not grant it back.';


-- ----------------------------------------------------------
-- 2. CLOSE THE DIRECT PATH
-- ----------------------------------------------------------
--
-- The policy goes first, for the reason recorded in the profile lockdown:
-- leaving it behind with the grant removed is worse than either state alone,
-- because pg_policies would keep advertising a write that no longer works and
-- the next reader would have to check the grant table to discover it does
-- nothing.

DROP POLICY IF EXISTS "contractor updates own inquiries" ON public.inquiries;

-- INSERT and DELETE are revoked alongside UPDATE. No policy allowed either, so
-- RLS was already refusing both — but on contractors it was precisely the
-- unused grant that made the UPDATE hole reachable the moment a policy appeared,
-- and there is no contractor-facing reason to create or destroy an inquiry. The
-- public contact form inserts with the service role
-- (app/contractor/[slug]/actions.ts), which keeps every grant it has.
--
-- SELECT is deliberately untouched: "contractor reads own inquiries" is the
-- policy the inbox reads under, and it is correct as written.
REVOKE UPDATE, INSERT, DELETE ON public.inquiries FROM authenticated, anon;

-- ⚠ CONSEQUENCE, ACCEPTED DELIBERATELY, IDENTICAL TO THE ONE ON contractors:
-- "admin full access inquiries" is FOR ALL TO authenticated, so an admin acting
-- through their own session now has no UPDATE, INSERT or DELETE on this table
-- either. Nothing does that today — there is no admin inquiries screen, and the
-- admin UI reads with the service role. If one is ever built, give it its own
-- RPC rather than granting UPDATE back here.


-- ----------------------------------------------------------
-- 3. SAY IT IN THE POLICY THAT REMAINS
-- ----------------------------------------------------------
--
-- The SELECT policy is unchanged in behaviour. The comment exists because the
-- next person to read pg_policies will find one policy for contractors on a
-- table whose UI plainly writes to it, and should not have to reconstruct why.

COMMENT ON POLICY "contractor reads own inquiries" ON public.inquiries IS
  'Read-only by design. Contractors write through set_own_inquiry_status() only; direct UPDATE/INSERT/DELETE are revoked from authenticated. Do not add a write policy here - a policy cannot restrict columns, which is the bug this replaced.';


-- ==========================================================
-- 4. VERIFY - scripts/verify-inquiries-lockdown.mjs does all of this
-- ==========================================================
--
--   node --no-warnings scripts/verify-inquiries-lockdown.mjs
--
-- An empty table proves nothing, so it creates two contractors owned by two
-- signed-in users, plus an unclaimed one, and asserts against the live API:
--
--   a) a contractor sees their own inquiries and ONLY their own
--   b) anon sees none, and cannot write
--   c) a contractor cannot UPDATE another contractor's inquiries
--   d) a contractor cannot direct-UPDATE their OWN inquiries at all — message,
--      from_email, from_name, created_at and replied_at are unchanged after a
--      direct attempt at each. This is the hole this migration closes.
--   e) the sync key still cannot be reassigned to another contractor
--   f) the owner CAN move their own inquiry through read / replied / archived
--      and back, via the RPC
--   g) replied_at is set by the 'replied' transition, is not cleared by a later
--      archive, and keeps its FIRST value across a second reply
--   h) user B cannot call the RPC on user A's inquiry; a signed-in user with no
--      claim cannot call it on an unclaimed profile's inquiry; anon cannot call
--      it at all; an invalid status value is refused
--
-- Grants, after this runs:
--   SELECT grantee, privilege_type FROM information_schema.column_privileges
--    WHERE table_name='inquiries' AND grantee IN ('anon','authenticated')
--    GROUP BY 1,2;              -- expect SELECT and REFERENCES only
-- ==========================================================
