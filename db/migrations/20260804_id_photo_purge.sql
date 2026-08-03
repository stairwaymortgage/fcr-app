-- ==========================================================
-- MAKE THE 90-DAY PURGE POSSIBLE
-- Created 2026-08-04. APPLIED 2026-08-04 — scripts/verify-id-photo-purge.mjs
-- returned 19/19 against the live project: object really gone from the bucket,
-- claim row intact with its status and claimant details, id_photo_url null,
-- id_photo_purged_at set, an unexpired claim untouched, a second run a no-op,
-- and a hand-removed object cleared without failing the batch.
-- ==========================================================
--
-- ⚠ DEPLOY ORDER: RUN THIS BEFORE PUSHING THE PURGE CODE — or rather, before
-- the cron first fires. The route clears id_photo_url, which this migration
-- makes legal. Deploy the code first and every purge run deletes the objects,
-- fails to clear the rows, and reports the failure; the next run then finds the
-- objects already gone and clears the rows properly. So the wrong order is
-- self-healing rather than destructive — but it spends a day looking broken.
--
-- ==========================================================
-- WHAT THE TEST FOUND
-- ==========================================================
--
-- claims.id_photo_url is NOT NULL. The purge was written to clear it, and
-- scripts/verify-id-photo-purge.mjs caught it on the first run against the live
-- project:
--
--   storage remove: OK, 2 objects deleted
--   clearing id_photo_url failed for 2 row(s):
--     null value in column "id_photo_url" of relation "claims"
--     violates not-null constraint
--
-- Worth being precise about how bad that would have been unattended. The
-- objects DO get deleted — the Storage API call succeeds — and only the column
-- clear fails. So the retention job would have worked, reported an error into a
-- log nobody reads, and then re-deleted the same already-absent objects every
-- night forever, because the rows it uses to find work never got cleared. The
-- photographs would be gone and the table would still say they were there:
-- the exact inversion of the "orphaned object" failure the storage migration
-- was written to prevent.
--
-- ==========================================================
-- WHY NOT SIMPLY DROP NOT NULL
-- ==========================================================
--
-- Because NOT NULL is carrying a real guarantee: a claim always arrives with a
-- photo. app/contractor/[slug]/claim/actions.ts verifies the uploaded object
-- exists BEFORE inserting the row, precisely so Jim never opens a verification
-- request with nothing to verify. Dropping the constraint outright would retire
-- that guarantee to enable a purge that runs 90 days later.
--
-- So the constraint is narrowed rather than removed: the path may be null ONLY
-- on a row that records having been purged. An insert has no purged_at, so a
-- photo is still mandatory at submission. The CHECK below is what keeps the two
-- facts from drifting apart.
-- ==========================================================


-- ----------------------------------------------------------
-- 1. WHEN THE PHOTO WAS DESTROYED
-- ----------------------------------------------------------
--
-- A null id_photo_url on its own is ambiguous — "no photo" and "photo deleted
-- on schedule" are different facts, and only one of them is something we want
-- to be able to prove. A retention promise is worth what you can evidence about
-- it, so the purge records the date.

ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS id_photo_purged_at timestamptz;

COMMENT ON COLUMN public.claims.id_photo_purged_at IS
  'When the ID photo was destroyed by the 90-day purge. NULL means the photo is still held. Set together with clearing id_photo_url - see the CHECK on this table and app/api/cron/purge-id-photos.';


-- ----------------------------------------------------------
-- 2. THE PATH MAY ONLY BE NULL ON A PURGED ROW
-- ----------------------------------------------------------

ALTER TABLE public.claims
  ALTER COLUMN id_photo_url DROP NOT NULL;

ALTER TABLE public.claims
  DROP CONSTRAINT IF EXISTS claims_photo_present_unless_purged;

-- Reads as: either we still hold a path, or we have recorded destroying it.
-- Neither "no photo and no explanation" nor "purged but the path is still
-- here" can exist.
ALTER TABLE public.claims
  ADD CONSTRAINT claims_photo_present_unless_purged CHECK (
    (id_photo_url IS NOT NULL AND id_photo_purged_at IS NULL)
    OR
    (id_photo_url IS NULL AND id_photo_purged_at IS NOT NULL)
  );


-- ==========================================================
-- 3. VERIFY
-- ==========================================================
--
--   node --experimental-strip-types --no-warnings=ExperimentalWarning \
--     scripts/verify-id-photo-purge.mjs
--
-- Asserts the object is really gone from the bucket, the claim ROW survives
-- with its status, claimant details and expiry intact, id_photo_url is null,
-- id_photo_purged_at is set, a not-yet-expired claim is untouched, a second run
-- is a no-op, and an object removed by hand does not fail the batch.
--
-- Both halves of the CHECK should be unsatisfiable by hand:
--   UPDATE claims SET id_photo_url = NULL WHERE id = '<any>';          -- fails
--   UPDATE claims SET id_photo_purged_at = now() WHERE id = '<any>';   -- fails
-- ==========================================================
