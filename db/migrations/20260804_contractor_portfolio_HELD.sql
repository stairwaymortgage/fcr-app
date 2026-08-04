-- ==========================================================
-- ⚠ HELD — DO NOT RUN. PORTFOLIO PHOTOS.
-- Written 2026-08-04 during build 146. Deliberately NOT applied.
-- ==========================================================
--
-- This file is a decision record as much as a migration. It is complete and
-- believed correct; it is not applied because the FEATURE was cut after recon,
-- not because the SQL is unfinished. Two things must be true before it runs:
--
--   1. A MOCKUP EXISTS. All 28 production mockups were searched on 2026-08-04.
--      The only photo UI in the entire handoff is manage_profile.html:756-771 —
--      a single 140x140 zone with one Upload button, titled "Business Photo or
--      Logo". There is no gallery, no grid, and no reorder control anywhere.
--      "portfolio" appears twice in the mockups: once on /sources (see below)
--      and once as a loan type in admin_leads. Building this means designing it,
--      and design invented at build time is how a product stops looking like one
--      product.
--
--   2. /sources IS UPDATED IN THE SAME CHANGE. That page is live, and under
--      "What's NOT in the data" it tells visitors, in a list of deliberate
--      absences: "Project portfolios. Past project history of any kind."
--      (app/sources/page.tsx:139). Shipping a portfolio gallery while that
--      sentence is published makes our own transparency page false. The
--      surrounding paragraph scopes its reason to DBPR's extract, so an argument
--      exists that contractor-supplied photos are a different thing — but a
--      homeowner reading the page will not draw that distinction, and this site
--      sells itself on saying only true things about its data.
--
-- Everything below assumes 20260804_contractor_logo.sql has already been applied:
-- it reuses assert_own_photo_path() and the {slug}/... path structure defined
-- there, including the reasons slug is the folder segment and dbpr_sync_key
-- cannot be. Read that header before running this.
--
-- If this is ever run, add contractor-portfolio to the KNOWN bucket set in
-- scripts/verify-claim-approval.mjs — it is already listed there, so no edit is
-- needed, but check it rather than assuming.
--
-- ⚠ THE THREE storage.objects POLICIES IN §1 CANNOT BE RUN FROM THE SQL EDITOR.
-- They are kept as a specification, not as runnable SQL. storage.objects is
-- owned by supabase_storage_admin and the editor connects as postgres, which is
-- not a member of that role, so CREATE POLICY there fails with
-- "42501: must be owner of table objects". Confirmed on the live project
-- 2026-08-04; the full account is in §3 of 20260804_contractor_logo.sql.
--
-- They are also PROBABLY UNNECESSARY. If portfolio uploads follow the same route
-- as the logo and the ID photo — a signed upload URL minted server-side for a
-- server-computed path — then no client ever writes as itself, and a signed
-- upload bypasses RLS regardless. Decide that before reaching for the Dashboard:
-- the likely correct edit to this file is to DELETE the three policies below and
-- keep only the bucket INSERT.


-- ----------------------------------------------------------
-- 1. THE BUCKET
-- ----------------------------------------------------------
--
-- Separate from contractor-logos ONLY because file_size_limit is a property of
-- the bucket, and these need different limits. A single shared bucket would have
-- to carry the larger one, and the logo's 2 MB cap would then exist only in
-- TypeScript — the layer a direct POST to the storage API skips.
--
-- 5 MB is a judgement, not a spec: no mockup mentions portfolio photos at all. A
-- 12-megapixel phone JPEG is typically 3-5 MB straight from the camera, and 2 MB
-- would reject most of them with an error a contractor cannot act on.
--
-- Same MIME allowlist and the same two exclusions as the logo bucket — no SVG
-- (script carrier rendered inline on a public page), no HEIC/HEIF (Chrome and
-- Firefox do not render it, so the gallery would look right to the contractor on
-- their iPhone and broken to most of the internet).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contractor-portfolio',
  'contractor-portfolio',
  true,
  5242880,  -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public             = true,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "contractor uploads own portfolio photo" ON storage.objects;
CREATE POLICY "contractor uploads own portfolio photo"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'contractor-portfolio'
    AND array_length(storage.foldername(name), 1) = 1
    AND (storage.foldername(name))[1] IN (
      SELECT slug FROM public.contractors WHERE claimed_by_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "contractor reads own portfolio photos" ON storage.objects;
CREATE POLICY "contractor reads own portfolio photos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'contractor-portfolio'
    AND (storage.foldername(name))[1] IN (
      SELECT slug FROM public.contractors WHERE claimed_by_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "contractor deletes own portfolio photos" ON storage.objects;
CREATE POLICY "contractor deletes own portfolio photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'contractor-portfolio'
    AND (storage.foldername(name))[1] IN (
      SELECT slug FROM public.contractors WHERE claimed_by_user_id = auth.uid()
    )
  );

-- No UPDATE, for the reason in the logo migration: an in-place overwrite keeps
-- the URL and therefore keeps the CDN's copy of the old bytes.

DROP POLICY IF EXISTS "admin full access contractor portfolio" ON storage.objects;
CREATE POLICY "admin full access contractor portfolio"
  ON storage.objects FOR ALL
  TO authenticated
  USING (bucket_id = 'contractor-portfolio' AND is_admin())
  WITH CHECK (bucket_id = 'contractor-portfolio' AND is_admin());


-- ----------------------------------------------------------
-- 2. THE TABLE
-- ----------------------------------------------------------
--
-- ONE ROW PER PHOTO with an explicit integer sort_order. The alternative — a
-- jsonb array on contractors — makes reordering a read-modify-write of the whole
-- list, which is a lost-update race the moment a contractor has two tabs open,
-- and cannot be constrained or indexed per photo.
CREATE TABLE IF NOT EXISTS public.contractor_photos (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

  contractor_dbpr_sync_key text NOT NULL
    REFERENCES public.contractors(dbpr_sync_key) ON DELETE CASCADE,

  -- STORAGE PATH inside contractor-portfolio, '{slug}/portfolio-{uuid}.{ext}'.
  -- Named _path and not _url for the reason 20260803 renamed two columns: a
  -- column called _url invites storing a URL, and a public-bucket URL embeds a
  -- project ref that would have to be rewritten on every restore.
  storage_path             text NOT NULL UNIQUE,

  -- Alt text. NULLable so a future bulk import is not blocked by a field only a
  -- human can write, but the UI requires it: a gallery of unlabelled <img> is
  -- unusable with a screen reader, and these are public pages.
  caption                  text,

  -- 1-based, contractor-controlled. NOT unique per contractor on purpose: the
  -- swap in move_own_contractor_photo() passes through a state where two rows
  -- share a value, and a unique constraint would need a deferrable index to
  -- survive it. Ties break on created_at in every read.
  sort_order               integer NOT NULL DEFAULT 1,

  created_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.contractor_photos IS
  'Contractor-supplied portfolio images shown on the public profile. One row per object in contractor-portfolio. Written ONLY through add/delete/move_own_contractor_photo().';

CREATE INDEX IF NOT EXISTS idx_contractor_photos_order
  ON public.contractor_photos(contractor_dbpr_sync_key, sort_order, created_at);

ALTER TABLE public.contractor_photos ENABLE ROW LEVEL SECURITY;

-- Public read: these are marketing images on a public page, and the bucket serves
-- the bytes to anyone regardless — hiding the rows would only break the page that
-- displays them.
DROP POLICY IF EXISTS "public reads contractor photos" ON public.contractor_photos;
CREATE POLICY "public reads contractor photos"
  ON public.contractor_photos FOR SELECT
  TO anon, authenticated
  USING (true);

-- NO WRITE POLICY, DELIBERATELY, and the reason is the one inquiries taught:
-- AN RLS POLICY CANNOT RESTRICT COLUMNS. A "contractor writes own photos" policy
-- would also let them set sort_order to anything, point storage_path at another
-- contractor's object, or rewrite created_at. Every write goes through an RPC,
-- and the grant is removed so there is no second path.
REVOKE INSERT, UPDATE, DELETE ON public.contractor_photos FROM authenticated, anon;
GRANT SELECT ON public.contractor_photos TO authenticated, anon;

DROP POLICY IF EXISTS "admin full access contractor photos" ON public.contractor_photos;
CREATE POLICY "admin full access contractor photos"
  ON public.contractor_photos FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
-- ⚠ Same accepted consequence as contractors and inquiries: the REVOKE applies to
-- admins acting through their own session too, so this policy grants nothing
-- until a grant exists. Nothing does that today; the admin UI reads service-role.


-- ----------------------------------------------------------
-- 3. ADD / DELETE / REORDER
-- ----------------------------------------------------------
--
-- TWELVE PHOTOS, enforced here rather than in TypeScript because the form is not
-- the only way to reach this function. Twelve is a judgement, not a spec: no
-- mockup states a limit, twelve fills a 4-across grid three rows deep, and every
-- one is a full-size public image this project pays to store and serve.
CREATE OR REPLACE FUNCTION public.add_own_contractor_photo(
  p_dbpr_sync_key text,
  p_storage_path  text,
  p_caption       text
)
RETURNS uuid AS $$
DECLARE
  v_count int;
  v_next  int;
  v_id    uuid;
  v_cap   text;
BEGIN
  IF p_storage_path IS NULL THEN
    RAISE EXCEPTION 'No file was uploaded.' USING ERRCODE = '22023';
  END IF;

  PERFORM public.assert_own_photo_path(p_dbpr_sync_key, p_storage_path);

  SELECT count(*) INTO v_count
    FROM public.contractor_photos
   WHERE contractor_dbpr_sync_key = p_dbpr_sync_key;

  IF v_count >= 12 THEN
    RAISE EXCEPTION 'You already have 12 photos. Remove one before adding another.'
      USING ERRCODE = '23514';
  END IF;

  v_cap := NULLIF(btrim(COALESCE(p_caption, '')), '');
  IF length(v_cap) > 200 THEN
    RAISE EXCEPTION 'That caption is % characters. The limit is 200.', length(v_cap)
      USING ERRCODE = '22001';
  END IF;

  SELECT COALESCE(max(sort_order), 0) + 1 INTO v_next
    FROM public.contractor_photos
   WHERE contractor_dbpr_sync_key = p_dbpr_sync_key;

  INSERT INTO public.contractor_photos
    (contractor_dbpr_sync_key, storage_path, caption, sort_order)
  VALUES (p_dbpr_sync_key, p_storage_path, v_cap, v_next)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;

REVOKE ALL ON FUNCTION public.add_own_contractor_photo(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_own_contractor_photo(text, text, text) TO authenticated;


-- RETURNS THE PATH, for the reason set_own_contractor_image() does: the row goes
-- away here, the object does not, and only the caller can remove it.
CREATE OR REPLACE FUNCTION public.delete_own_contractor_photo(p_photo_id uuid)
RETURNS text AS $$
DECLARE
  v_key  text;
  v_path text;
BEGIN
  SELECT contractor_dbpr_sync_key, storage_path INTO v_key, v_path
    FROM public.contractor_photos
   WHERE id = p_photo_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such photo.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.assert_own_photo_path(v_key, v_path);

  DELETE FROM public.contractor_photos WHERE id = p_photo_id;

  -- Close the gap, so positions stay 1..n and the Move buttons never step over a
  -- hole.
  UPDATE public.contractor_photos p
     SET sort_order = s.rn
    FROM (
      SELECT id, row_number() OVER (ORDER BY sort_order, created_at) AS rn
        FROM public.contractor_photos
       WHERE contractor_dbpr_sync_key = v_key
    ) s
   WHERE p.id = s.id AND p.sort_order <> s.rn;

  RETURN v_path;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;

REVOKE ALL ON FUNCTION public.delete_own_contractor_photo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_own_contractor_photo(uuid) TO authenticated;


-- ONE STEP AT A TIME, NOT AN ARBITRARY POSITION. The UI this backs is a pair of
-- Move up / Move down buttons — there is no reorder mockup anywhere in the
-- handoff, and drag-and-drop needs client JS this app does not ship. A p_position
-- argument would accept 0, 99, or the row's own index, and every one of those
-- cases would need handling for no gain.
CREATE OR REPLACE FUNCTION public.move_own_contractor_photo(
  p_photo_id  uuid,
  p_direction text
)
RETURNS void AS $$
DECLARE
  v_key       text;
  v_path      text;
  v_order     int;
  v_created   timestamptz;
  v_other_id  uuid;
  v_other_ord int;
BEGIN
  IF p_direction IS NULL OR p_direction NOT IN ('up', 'down') THEN
    RAISE EXCEPTION 'Unknown direction "%".', p_direction USING ERRCODE = '22023';
  END IF;

  SELECT contractor_dbpr_sync_key, storage_path, sort_order, created_at
    INTO v_key, v_path, v_order, v_created
    FROM public.contractor_photos
   WHERE id = p_photo_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such photo.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.assert_own_photo_path(v_key, v_path);

  -- The neighbour in the requested direction, ordered exactly the way the page
  -- orders them, so "up" on screen is "up" here even when two rows tie.
  IF p_direction = 'up' THEN
    SELECT id, sort_order INTO v_other_id, v_other_ord
      FROM public.contractor_photos
     WHERE contractor_dbpr_sync_key = v_key
       AND (sort_order, created_at) < (v_order, v_created)
     ORDER BY sort_order DESC, created_at DESC
     LIMIT 1
     FOR UPDATE;
  ELSE
    SELECT id, sort_order INTO v_other_id, v_other_ord
      FROM public.contractor_photos
     WHERE contractor_dbpr_sync_key = v_key
       AND (sort_order, created_at) > (v_order, v_created)
     ORDER BY sort_order, created_at
     LIMIT 1
     FOR UPDATE;
  END IF;

  -- Already at the end. Not an error: the button is disabled in the UI, and a
  -- double-submit racing itself should be a no-op rather than a red banner.
  IF v_other_id IS NULL THEN
    RETURN;
  END IF;

  IF v_other_ord = v_order THEN
    UPDATE public.contractor_photos
       SET sort_order = CASE WHEN p_direction = 'up' THEN v_order - 1 ELSE v_order + 1 END
     WHERE id = p_photo_id;
  ELSE
    UPDATE public.contractor_photos SET sort_order = v_other_ord WHERE id = p_photo_id;
    UPDATE public.contractor_photos SET sort_order = v_order     WHERE id = v_other_id;
  END IF;

  -- Renumber to 1..n so repeated moves cannot drift into negatives.
  UPDATE public.contractor_photos p
     SET sort_order = s.rn
    FROM (
      SELECT id, row_number() OVER (ORDER BY sort_order, created_at) AS rn
        FROM public.contractor_photos
       WHERE contractor_dbpr_sync_key = v_key
    ) s
   WHERE p.id = s.id AND p.sort_order <> s.rn;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;

REVOKE ALL ON FUNCTION public.move_own_contractor_photo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_own_contractor_photo(uuid, text) TO authenticated;
