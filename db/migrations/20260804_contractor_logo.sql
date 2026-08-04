-- ==========================================================
-- CONTRACTOR LOGO: PUBLIC BUCKET + THE ONLY WRITE PATH
-- Created 2026-08-04. APPLIED 2026-08-04 by Jim in the Supabase SQL Editor,
-- after one failed attempt whose whole transaction rolled back — see §3 for what
-- failed and why the file no longer contains it.
-- ==========================================================
--
-- ⚠ DEPLOY ORDER: THIS FILE FIRST, THEN CODE. The photo UI calls
-- set_own_contractor_image() by name and uploads into the bucket created here.
-- With the code deployed and this not yet run, the upload fails with PGRST202
-- and a storage 404 while the rest of /manage keeps working — the same partial
-- failure the inquiries inbox hit earlier the same day.
--
-- ONE FILE, THOUGH THE CONVENTION IS TWO (20260801_claims_flow.sql +
-- 20260801_claim_id_photos_storage.sql split schema from storage). Deliberate:
-- the bucket without the RPC accepts uploads that nothing records, and the RPC
-- without the bucket records paths to objects that cannot exist. Both halves are
-- small, and a half-applied pair is the failure this ordering exists to prevent.
--
-- ==========================================================
-- SCOPE: THE LOGO ONLY. PORTFOLIO PHOTOS ARE HELD.
-- ==========================================================
--
-- Build 146 was scoped as "logo + portfolio photos". Portfolio was cut after
-- recon, and the reason is on the record rather than in a chat log:
--
--   · NO MOCKUP EXISTS. All 28 production mockups were searched — the only photo
--     UI in the handoff is manage_profile.html:756-771, a single 140x140 zone
--     with one Upload button, titled "Business Photo or Logo". There is no
--     gallery, no grid, and no reorder control anywhere to build against.
--
--   · /sources CONTRADICTS IT. That page is live, and under "What's NOT in the
--     data" it tells visitors: "Project portfolios. Past project history of any
--     kind." Shipping a portfolio gallery without editing that page publishes a
--     contradiction on our own domain.
--
-- The portfolio schema, its three RPCs and its bucket are written and held in
-- 20260804_contractor_portfolio_HELD.sql. DO NOT RUN THAT FILE until both of
-- the above are resolved.
--
-- ==========================================================
-- WHY THE PATH IS KEYED ON slug — AND NOT ON auth.uid() OR dbpr_sync_key
-- ==========================================================
--
-- id-photos uses {auth.uid()}/{claim_id}.ext and compares segment 1 to
-- auth.uid()::text. THAT PATTERN MUST NOT BE COPIED HERE, because this bucket is
-- PUBLIC: the path appears verbatim in an <img src> on a public profile page, so
-- every segment of it is published.
--
-- Publishing auth.uid() would break a rule this codebase states outright.
-- lib/contractor-profile.ts documents claimed_by_user_id as "FETCHED FOR A
-- CONDITIONAL. NEVER RENDERED, NEVER SERIALISED" — the same uuid in an image URL
-- renders on every profile the contractor owns and correlates them to each other
-- for anyone reading the HTML.
--
-- ⚠ dbpr_sync_key CANNOT BE USED EITHER, and this is the trap worth recording.
-- It looks like an identifier and is not URL-safe. Real values, sampled from the
-- live table on 2026-08-04:
--
--   QB||ADERHOLT & ASSOCIATES LLC|12/18/2007
--   CAC|CAC1814296|ADERMAN, RANDY TODD|12/09/2004
--
-- Pipes, spaces, commas, ampersands, apostrophes — and SLASHES, from the date. A
-- slash in a storage path is a folder separator, so "12/18/2007" silently
-- becomes three nested folders, so (storage.foldername(name))[1] stops being the
-- key anything can compare, and the server-side path check in
-- assert_own_photo_path() starts passing or failing according to a licence date.
-- Test keys shaped like TESTLOCK-A-1234 would never have surfaced it.
--
-- slug is the right segment: [a-z0-9-] by construction (contractor_slugify),
-- UNIQUE by index, already public in the URL of every profile page, and readable
-- in the Storage dashboard when something needs debugging.
--
-- ⚠ THIS DEPENDS ON SLUGS BEING IMMUTABLE, true today by two independent facts:
-- contractor_backfill_slugs() only ever fills WHERE slug IS NULL, and
-- 20260803_contractor_profile_lockdown.sql revoked UPDATE on contractors from
-- authenticated and anon, so nothing but the service role can change one. If
-- either changes, a renamed profile orphans its own object — the image keeps
-- serving (public bucket, stored path unchanged) but the app can no longer
-- reconcile or replace it, because assert_own_photo_path() would reject the old
-- path against the new slug. The fix at that point is a dedicated opaque
-- photo_folder uuid column, not a rename cascade.


-- ==========================================================
-- 1. THE BUCKET — AND IT IS THE PROJECT'S FIRST PUBLIC ONE
-- ==========================================================
--
-- id-photos is private and four independent things keep it that way. This one is
-- the opposite by design: public = true means EVERY object is readable by anyone
-- at a guessable-shaped URL, and RLS IS NOT CONSULTED FOR READS AT ALL. Correct here — the point of a logo is to be shown to
-- strangers — but it inverts the assumption every other storage rule in this
-- project was written under.
--
-- Three consequences, accepted deliberately:
--
--   1. NOTHING PRIVATE MAY EVER BE PUT IN THIS BUCKET. Not an ID photo, not a
--      licence document, not a "temporary" copy of anything from id-photos.
--      scripts/verify-claim-approval.mjs asserted "no other bucket exists to copy
--      it into" precisely because a second bucket is where that mistake goes.
--      That assertion has been narrowed, not deleted: it now checks id-photos is
--      still private and that no ID photo is servable from any public bucket.
--
--   2. DELETION IS NOT INSTANT. Public objects are CDN-cached, so a removed logo
--      can still be served briefly after the column is cleared. This is why a
--      replacement writes a NEW randomised filename instead of overwriting: an
--      overwrite keeps serving the previous image from cache at the same URL,
--      which is indistinguishable from "the upload didn't work".
--
--   3. UPLOADS ARE UNMODERATED CONTENT ON A PUBLIC PAGE. A verified contractor
--      can put any image on their own public profile, and the first anyone here
--      knows of it is a complaint. /dmca is a form and a promise with no admin
--      action behind it. FLAGGED, NOT SOLVED — the takedown tool belongs in the
--      same milestone as the first paying contractor, alongside inquiry rate
--      limiting.
--
-- 2 MB is the mockup's own number (manage_profile.html:766 — "PNG, JPG, or SVG ·
-- Max 2 MB · Square format recommended (at least 400x400px)"). A logo is a
-- graphic, not a photograph; 2 MB is generous for one.
--
-- ⚠ NO image/svg+xml, IN CONTRADICTION OF THAT SAME CAPTION. The mockup is
-- wrong, and this is the call the claim flow already made against its own
-- caption's "PDF". An SVG is a script carrier: rendered inline it executes, and
-- this renders on a public page beside a "Verified" badge. The UI copy says
-- JPG / PNG / WEBP.
--
-- ⚠ NO image/heic or image/heif, in contradiction of id-photos, which allows
-- both. The difference is the audience: an ID photo is opened by one reviewer in
-- a dashboard that can convert it; this one is served straight into an <img> for
-- the public. Chrome and Firefox do not render HEIC, so the profile would look
-- right to the contractor on their iPhone and broken to most of the internet —
-- the worst failure shape there is. iOS converts to JPEG when uploading through a
-- file input, so the common path works; the residual case needs an error that
-- says so, not a generic reject.
--
-- allowed_mime_types is checked against the Content-Type the CLIENT sends. It is
-- a guardrail against mistakes, NOT a proof of file contents — same warning as
-- 20260801_claim_id_photos_storage.sql, and it matters more here because these
-- bytes are served to the public rather than to one reviewer.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contractor-logos',
  'contractor-logos',
  true,
  2097152,  -- 2 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public             = true,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ==========================================================
-- 2. PATH STRUCTURE  →  {slug}/logo-{uuid}.{ext}
-- ==========================================================
--
--   aceca-construction-cgc1520921-davie/logo-a1b2c3d4.jpg
--
-- SEGMENT 1 IS THE ACCESS CONTROL, not a naming convention. The server builds it
-- from the session's own profile when minting the upload token, and
-- assert_own_photo_path() re-derives and re-checks it before any path is
-- recorded. See the header for why it is the slug.
--
-- The uuid in the filename is not secrecy; the bucket is public. It exists so
-- that replacing a logo writes a new path, which is what defeats the CDN cache.


-- ==========================================================
-- 3. THERE ARE NO POLICIES ON storage.objects. READ WHY.
-- ==========================================================
--
-- The first draft of this file created four — INSERT/SELECT/DELETE for the
-- owner plus admin ALL — and opened with
-- `ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY`. It cannot run:
--
--   ERROR: 42501: must be owner of table objects
--
-- storage.objects and storage.buckets are owned by supabase_storage_admin, and
-- the SQL Editor connects as postgres, which is NOT a member of that role
-- (checked on the live project 2026-08-04: pg_has_role('postgres',
-- 'supabase_storage_admin','member') = false). So `SET ROLE
-- supabase_storage_admin` does not rescue it either. Creating a policy, and
-- toggling RLS, both require ownership. Neither is available from SQL here.
--
-- The ALTER TABLE was also redundant: storage.objects already has
-- relrowsecurity = true. Supabase enables it on the table by default.
--
-- ⚠ THE SAME TWO LINES APPEAR IN 20260801_claim_id_photos_storage.sql, whose
-- header says APPLIED. Both cannot be true today. That file's three policies do
-- exist on the live project under exactly the names it lists, so either they
-- were created through the Dashboard's Storage → Policies UI and the file
-- documents them after the fact, or the permission changed under us since
-- 2026-08-01. Which one is not recoverable from here. What matters is the
-- consequence: THAT FILE IS NOT RUNNABLE AS WRITTEN, and its "APPLIED" note
-- describes verified state rather than a script that executed.
--
-- ----------------------------------------------------------
-- AND THEN: NO POLICY IS NEEDED, BECAUSE NOTHING WRITES AS THE USER
-- ----------------------------------------------------------
--
-- Hitting the ownership error is what surfaced the better question — how does
-- the ID photo upload work, given the same constraint? The answer is already in
-- this repo, and it is not the policies:
--
--   app/contractor/[slug]/claim/actions.ts:165 mints a signed upload URL with
--   the SERVICE ROLE, for a path the server computes from the session. The
--   browser then PUTs the bytes to that URL.
--
-- A SIGNED UPLOAD URL BYPASSES RLS — it is authorised by the token, not by the
-- caller's role. So "claimant uploads own id photo" is not what makes that
-- upload succeed, and an equivalent policy here would not be what makes this
-- one succeed either.
--
-- The logo therefore follows the same route, which the claim form documents at
-- ClaimForm.tsx:26-36:
--
--   1. the server verifies the session owns the profile, builds
--      {slug}/logo-{uuid}.{ext} itself, and mints a one-shot upload token;
--   2. the browser uploads straight to the bucket — no bytes through the app
--      server, so the 1 MB Server Action body cap never applies;
--   3. set_own_contractor_image() records the path, re-checking ownership
--      inside the database;
--   4. the displaced object is deleted server-side with the service role.
--
-- NO PART OF THE PATH IS CLIENT-CONTROLLED, which is a stronger property than
-- any policy expression validating a path the client chose. The bucket's own
-- size and MIME limits still apply to the signed upload in step 2, whatever the
-- browser believes about the file.
--
-- WHAT THIS COSTS, STATED PLAINLY: anon and authenticated hold no policy on
-- this bucket, so RLS denies every direct client write — which is the intent,
-- but it also means there is no database backstop behind step 1. If the
-- ownership check in the Server Action were wrong, nothing below it would
-- refuse. That is the same trust already placed in the inquiry INSERT
-- (app/contractor/[slug]/actions.ts) and in createIdPhotoUploadTarget(), and it
-- is why the check lives next to the RPC call and is covered by
-- scripts/verify-contractor-logo.mjs rather than left to review.
--
-- IF A BACKSTOP IS WANTED LATER, it goes in through the Dashboard UI, not this
-- file — Storage → contractor-logos → Policies → New policy, INSERT for
-- authenticated:
--
--   bucket_id = 'contractor-logos'
--   AND array_length(storage.foldername(name), 1) = 1
--   AND (storage.foldername(name))[1] IN (
--     SELECT slug FROM public.contractors WHERE claimed_by_user_id = auth.uid())
--
-- It would be belt-and-braces: signed uploads would still bypass it. Record it
-- here if it is ever added, because a policy created in the Dashboard is
-- invisible to this repo — which is exactly how the id-photos drift above
-- happened.


-- ==========================================================
-- 4. IS THIS PROFILE MINE, AND IS THIS PATH IN ITS FOLDER?
-- ==========================================================
--
-- Split out because the held portfolio migration needs the identical two answers
-- from four more functions, and repeating them is how they drift apart.
--
-- SECURITY DEFINER is NOT set here. This is a helper called from inside a
-- function that already has it; definer rights of its own would make it an
-- independently callable privileged primitive.
CREATE OR REPLACE FUNCTION public.assert_own_photo_path(
  p_dbpr_sync_key text,
  p_storage_path  text
)
RETURNS void AS $$
DECLARE
  v_owner uuid;
  v_slug  text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You are not signed in.' USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE: two tabs uploading at once would otherwise both read the row and
  -- both write. Same reasoning as update_own_contractor_profile().
  SELECT claimed_by_user_id, slug INTO v_owner, v_slug
    FROM public.contractors
   WHERE dbpr_sync_key = p_dbpr_sync_key
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such profile.' USING ERRCODE = 'P0002';
  END IF;

  -- One message for "not yours" and "not claimed by anyone", so this cannot be
  -- used to probe which profiles have owners. Same rule as
  -- update_own_contractor_profile().
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'You do not manage this profile.' USING ERRCODE = '42501';
  END IF;

  IF p_storage_path IS NULL THEN
    RETURN;  -- clearing the image; there is no path to check
  END IF;

  -- ⚠ THE STORAGE POLICY ABOVE ALREADY STOPS A CONTRACTOR WRITING OUTSIDE THEIR
  -- OWN FOLDER. This stops something different and otherwise unguarded:
  -- RECORDING a path they did not write. Without it a contractor could point
  -- custom_logo_path at a rival's object — it renders on their profile, and the
  -- delete that accompanies the next replacement would take the rival's image off
  -- the internet.
  IF p_storage_path !~ ('^' || v_slug || '/[A-Za-z0-9._-]+$') THEN
    RAISE EXCEPTION 'That file is not in your profile''s folder.'
      USING ERRCODE = '42501';
  END IF;

  -- Extension allowlist, mirroring the bucket's allowed_mime_types. The bucket
  -- checks the Content-Type the client SENDS, which is a guardrail rather than a
  -- fact about the bytes; this checks the name it will be served under. Neither
  -- is proof, and both are cheap.
  IF lower(p_storage_path) !~ '\.(jpg|jpeg|png|webp)$' THEN
    RAISE EXCEPTION 'Your logo must be a JPG, PNG or WEBP file.' USING ERRCODE = '22023';
  END IF;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_catalog;


-- ==========================================================
-- 5. THE ONLY CONTRACTOR-FACING WRITE PATH TO THE IMAGE COLUMNS
-- ==========================================================
--
-- A SEPARATE RPC RATHER THAN TWO MORE ARGUMENTS ON
-- update_own_contractor_profile(). That function documents itself as a FULL
-- REPLACE of the editable set — every field is submitted on every save, and a
-- NULL argument CLEARS its column. An image does not follow that contract: it is
-- uploaded outside the form's save cycle, so folding it in would mean Save
-- silently deletes the logo of anyone whose form was rendered before the upload.
-- That bug only reproduces for the person it happens to.
--
-- RETURNS THE OLD PATH, AND THE CALLER MUST DELETE THAT OBJECT. Postgres cannot
-- remove a storage object, so a replaced logo would otherwise sit in a public
-- bucket forever, still served at its old URL. Returning it makes the cleanup an
-- explicit job rather than an invisible leak.
--
-- p_kind is checked against two literals. BOTH columns are handled although only
-- the logo has a design today (manage_profile.html:756-771 is a single zone), so
-- that custom_owner_photo_path needs no migration when it gets one.
CREATE OR REPLACE FUNCTION public.set_own_contractor_image(
  p_dbpr_sync_key text,
  p_kind          text,
  p_path          text
)
RETURNS text AS $$
DECLARE
  v_old text;
BEGIN
  -- IS NULL tested separately: `NULL NOT IN (...)` evaluates to NULL, not TRUE,
  -- so a null argument walks straight past an IN test. That cost
  -- set_own_inquiry_status() its readable error message earlier the same day.
  IF p_kind IS NULL OR p_kind NOT IN ('logo', 'owner_photo') THEN
    RAISE EXCEPTION 'Unknown image kind "%".', p_kind USING ERRCODE = '22023';
  END IF;

  PERFORM public.assert_own_photo_path(p_dbpr_sync_key, p_path);

  IF p_kind = 'logo' THEN
    SELECT custom_logo_path INTO v_old
      FROM public.contractors WHERE dbpr_sync_key = p_dbpr_sync_key;
    UPDATE public.contractors SET custom_logo_path = p_path
     WHERE dbpr_sync_key = p_dbpr_sync_key;
  ELSE
    SELECT custom_owner_photo_path INTO v_old
      FROM public.contractors WHERE dbpr_sync_key = p_dbpr_sync_key;
    UPDATE public.contractors SET custom_owner_photo_path = p_path
     WHERE dbpr_sync_key = p_dbpr_sync_key;
  END IF;

  -- NULL when there was nothing to replace, and NULL when the new path equals the
  -- old one — deleting that object would erase the image just saved.
  RETURN CASE WHEN v_old IS DISTINCT FROM p_path THEN v_old ELSE NULL END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;

-- anon must not be able to attempt it. The auth.uid() check would refuse anyway,
-- but an un-callable function cannot be probed for error differences.
REVOKE ALL ON FUNCTION public.set_own_contractor_image(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_own_contractor_image(text, text, text) TO authenticated;

COMMENT ON FUNCTION public.set_own_contractor_image(text, text, text) IS
  'The ONLY contractor-facing write path to contractors.custom_logo_path / custom_owner_photo_path. Returns the PREVIOUS path - the caller must delete that storage object or it leaks into a public bucket. Pass NULL to clear.';


-- ==========================================================
-- 6. AFTER RUNNING, CONFIRM
-- ==========================================================
--
--   SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets;
--     -- expect id-photos public=false and contractor-logos public=true, with
--     -- NO image/svg+xml, image/heic or image/heif on the new one
--
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname='storage' AND tablename='objects' ORDER BY policyname;
--     -- expect EXACTLY the three id-photos policies, unchanged. This file adds
--     -- none, and cannot — see §3.
--
-- Then, from the repo:
--
--   node --no-warnings scripts/verify-contractor-logo.mjs   -- expect all green
--   node --no-warnings scripts/verify-claim-approval.mjs    -- expect 27/27
--
-- The second one matters as much as the first: its bucket assertion was rewritten
-- for exactly this change, and it is what proves no ID photo became public.
--
-- The attempts that must fail, all covered by verify-contractor-logo.mjs:
--
--   a) anon cannot call the RPC, upload, list, or delete
--   b) a contractor cannot upload into another contractor's folder
--   c) a contractor cannot RECORD another contractor's object as their own logo
--      (the assert_own_photo_path check — storage RLS does not cover this)
--   d) a contractor cannot direct-UPDATE custom_logo_path (revoked 20260803)
--   e) a nested path, a non-image extension and an unknown kind are all refused
--   f) the RPC returns the displaced path exactly once, and NULL when unchanged
--   g) a contractor CAN upload, replace and clear their own logo, and the old
--      object is gone from the bucket afterwards
-- ==========================================================
