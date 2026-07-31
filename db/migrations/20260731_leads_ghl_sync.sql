-- ==========================================================
-- leads: GoHighLevel sync state
-- Created 2026-07-31. RUN IN THE SUPABASE SQL EDITOR (instant, catalogue only).
-- ==========================================================
--
-- The leads table is the source of truth; GoHighLevel is delivery. A failed
-- push must never cost us the lead, so these columns record what happened to
-- each row rather than letting a network blip make it disappear.
--
-- ghl_synced defaults FALSE, so a row that is written but never pushed is
-- indistinguishable from one whose push failed — both are "not delivered", and
-- both need retrying. That is the behaviour we want: the retry query is simply
-- WHERE ghl_synced = false.
--
-- No index. The retry set is small (failures only) and leads is a low-volume
-- table; a partial index can wait until there is a reason for one.
-- ==========================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS ghl_synced boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ghl_contact_id text,
  ADD COLUMN IF NOT EXISTS ghl_opportunity_id text,
  ADD COLUMN IF NOT EXISTS ghl_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS ghl_last_error text;

COMMENT ON COLUMN leads.ghl_synced IS
  'True once the contact AND opportunity both landed in GoHighLevel. False means undelivered — retry.';
COMMENT ON COLUMN leads.ghl_last_error IS
  'Last GHL failure for this row. Kept after a later success so a flapping integration is visible.';

-- ==========================================================
-- VERIFY
--   SELECT count(*) FROM leads WHERE ghl_synced = false;   -- the retry queue
--   SELECT id, created_at, ghl_last_error FROM leads
--     WHERE ghl_synced = false AND ghl_last_error IS NOT NULL
--     ORDER BY created_at DESC;
-- ==========================================================
