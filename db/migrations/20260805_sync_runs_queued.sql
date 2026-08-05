-- ==========================================================
-- sync_runs: a 'queued' status, so a refresh can be REQUESTED
-- by someone who cannot run one
-- Created 2026-08-05. NOT APPLIED — Jim runs this in the SQL editor.
-- ==========================================================
--
-- ⚠ DEPLOY ORDER MATTERS HERE, UNLIKE 20260805_reference_counts_repair.sql.
-- RUN THIS BEFORE DEPLOYING THE CODE THAT USES IT. The "Trigger refresh" button
-- on /admin/sync inserts status='queued', and until the CHECK below is
-- replaced the database rejects that row with 23514. The page renders fine
-- either way; the button is what breaks. Deploying first means an admin who
-- presses it gets an error for no reason.
--
-- Running this BEFORE the deploy is harmless: nothing writes 'queued' yet, and
-- widening a CHECK constraint invalidates nothing already stored.
--
-- VERIFY WITH:  node scripts/verify-sync-queue.mjs
--
--
-- ==========================================================
-- WHY 'queued' IS A REAL STATUS AND NOT A UI FICTION
-- ==========================================================
--
-- The refresh runs from scripts/import-dbpr.mjs on a developer machine: it
-- reads a 47.7MB CSV off disk and holds a fingerprint of all 266,305 existing
-- records in memory. Neither fits a Vercel function, and the source file is not
-- reachable from one. So a button on an admin page CANNOT start a refresh, and
-- one that appeared to would be lying about the most consequential operation
-- this product has.
--
-- What the button can honestly do is record a REQUEST. Jim presses it; the row
-- says who asked and when; whoever has the repository checked out runs the
-- script, which picks the request up and completes it. That is the workflow
-- that actually exists today, and 'queued' is its first state.
--
-- ⚠ THIS IS CORRECT IN BOTH FUTURES. When the DBPR source question is answered
-- (task 158, held pending Adnan), either:
--   · the source turns out to be a fetchable URL — the runner becomes real, and
--     it claims queued rows exactly as the local script does now; the button
--     does not change, only what consumes the queue does; or
--   · the source stays a file someone is handed — the queue semantics are the
--     permanent answer, not a placeholder.
-- Neither outcome invalidates this migration.
--
--
-- ==========================================================
-- 1. THE STATUS
-- ==========================================================
--
-- The constraint is dropped BY LOOKUP rather than by name. 01_schema.sql
-- declares it inline (`status text NOT NULL DEFAULT 'running' CHECK (...)`),
-- so Postgres generated the name — almost certainly sync_runs_status_check,
-- but a hand-edit in the dashboard at any point could have produced something
-- else, and DROP CONSTRAINT on a wrong name aborts the whole script.

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.sync_runs'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.sync_runs DROP CONSTRAINT %I', constraint_name);
    RAISE NOTICE 'dropped %', constraint_name;
  ELSE
    RAISE NOTICE 'no status CHECK found — adding a fresh one';
  END IF;
END $$;

ALTER TABLE public.sync_runs
  ADD CONSTRAINT sync_runs_status_check
  CHECK (status IN ('queued', 'running', 'success', 'failed'));


-- ==========================================================
-- 2. queued_at
-- ==========================================================
--
-- WHY started_at CANNOT DOUBLE AS THE QUEUE TIME. started_at is NOT NULL
-- DEFAULT now(), so a queued row gets one for free — and if the importer then
-- left it alone, `completed_at - started_at` would report the duration of the
-- run PLUS however long the request sat waiting. A refresh queued on Friday and
-- run on Monday would show a duration of three days.
--
-- So the importer RESETS started_at when it claims a queued row, and queued_at
-- keeps the request time. The two together give the operator the number that
-- actually matters on this workflow: how long a request waited before anyone
-- ran it.
--
-- NULL on a run that was never queued — i.e. the script was run directly, which
-- is every row the importer writes today. Null means "not requested through the
-- UI", which is different from "requested at the same moment it started".

ALTER TABLE public.sync_runs
  ADD COLUMN IF NOT EXISTS queued_at timestamptz;

COMMENT ON COLUMN public.sync_runs.queued_at IS
  'When a refresh was REQUESTED from /admin/sync. NULL when the importer was run directly. started_at is when it actually began.';


-- ==========================================================
-- 3. source_url BECOMES NULLABLE
-- ==========================================================
--
-- A queued row does not know its source yet. The importer records the file it
-- actually read, along with that file's size and SHA-256, at the moment it
-- reads it — which is the whole point of recording provenance rather than
-- asserting it.
--
-- The column is NOT NULL DEFAULT 'https://myfloridalicense.com/sto/file_download/
-- extracts/CONSTRUCTIONLICENSE_1.csv', so leaving it unset on a queued row does
-- not leave it empty: it stamps that URL. And that URL is exactly the claim
-- nobody has verified — the open question holding task 158. A queued row would
-- therefore assert, on the admin page, that a refresh nobody has run came from
-- a source nobody has confirmed.
--
-- NULL is the honest value for "not read yet". The DEFAULT is left in place
-- rather than dropped, because nothing passes the column implicitly any more
-- and removing it is a second decision.

ALTER TABLE public.sync_runs
  ALTER COLUMN source_url DROP NOT NULL;


-- ==========================================================
-- 4. WHAT THIS FILE DELIBERATELY DOES NOT ADD
-- ==========================================================
--
-- A PARTIAL UNIQUE INDEX ENFORCING "AT MOST ONE ACTIVE RUN" WAS CONSIDERED AND
-- REJECTED:
--
--     CREATE UNIQUE INDEX one_active_sync_run ON sync_runs ((true))
--       WHERE status IN ('queued', 'running');
--
-- It is the textbook way to make the guard race-proof rather than advisory, and
-- the race is real: two admins pressing the button together both pass an
-- application-level check and both insert.
--
-- It is rejected because of the failure it creates. A run that dies without
-- closing its row leaves status='running' forever — which is a state this
-- system genuinely produces, and which /admin/sync is written to display. With
-- this index in place, that stale row would block every future queue AND block
-- the importer from opening a fresh row, with the only remedy being hand-written
-- SQL against production. Trading a rare duplicate for a recurring deadlock is
-- the wrong way round.
--
-- The guard therefore lives in app/admin/sync/actions.ts, which re-reads the
-- table immediately before inserting. The consequence of losing the race is one
-- redundant queued row: the importer claims the OLDEST and the extra stays
-- visible on the page for a human to see. That is a cosmetic problem, not a
-- data-integrity one.
--
-- NO CHANGES TO RLS OR GRANTS. "admin only sync_runs" is already
-- FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin()), which
-- covers the INSERT the button performs, and 20260804_grant_hygiene.sql never
-- touched this table so the underlying grants are intact.
-- scripts/verify-sync-queue.mjs proves both ends of that rather than assuming:
-- an admin session can insert, an anon session cannot.


-- ==========================================================
-- 5. AFTER RUNNING, CONFIRM
-- ==========================================================
--
--   -- the widened constraint
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.sync_runs'::regclass AND contype = 'c';
--   -- expect: CHECK (status = ANY (ARRAY['queued', 'running', 'success', 'failed']))
--
--   -- the new column and the relaxed one
--   SELECT column_name, is_nullable, data_type
--   FROM information_schema.columns
--   WHERE table_name = 'sync_runs' AND column_name IN ('queued_at', 'source_url');
--   -- expect: queued_at YES timestamptz · source_url YES text
--
--   -- nothing was stored that the old constraint would have rejected
--   SELECT status, count(*) FROM sync_runs GROUP BY status;
--   -- expect: no rows at all today, or only running/success/failed
-- ==========================================================
