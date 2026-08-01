-- ==========================================================
-- SECURITY FIX: is_admin() trusted user-writable metadata
-- Created 2026-08-01. RUN IN THE SUPABASE SQL EDITOR BEFORE LOGIN GOES LIVE.
-- ==========================================================
--
-- 03_rls_policies.sql defined is_admin() as:
--
--   RETURN (
--     (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
--     OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
--   );
--
-- user_metadata is writable BY THE USER. Any authenticated account can call
-- supabase.auth.updateUser({ data: { role: 'admin' } }) with the public anon
-- key and become an admin for every RLS policy on the database.
--
-- PROVEN AGAINST THIS PROJECT ON 2026-08-01 with a throwaway account:
--
--   before:  leads 0 rows   claims 0 rows   inquiries 0 rows
--   call:    updateUser({ data: { role: 'admin' } })   -> ACCEPTED
--   after:   leads 10 rows (real emails)   inquiries 1 row
--
-- That is every lead's name, email, phone and answers; every inquiry; and —
-- once the claim flow ships — every claims row, which holds the storage path
-- of a government ID photo.
--
-- It has not been exploitable so far only because the project has no users.
-- The first magic-link login makes it reachable by the public, which is why
-- this runs BEFORE auth ships, not after.
--
-- THE FIX: app_metadata only. It is writable exclusively by the service role
-- (Admin API / SQL), never by the account itself, so a role claim there is a
-- statement by us rather than by the user.
--
-- SECURITY DEFINER + a pinned search_path so the function cannot be subverted
-- by a caller-controlled search_path.
-- ==========================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog;

COMMENT ON FUNCTION public.is_admin() IS
  'Admin check for RLS. Reads app_metadata ONLY — user_metadata is user-writable and trusting it allowed self-promotion to admin (fixed 2026-08-01).';

-- ==========================================================
-- GRANTING YOURSELF ADMIN
--
-- app_metadata cannot be set from the client. Use the Admin API with the
-- service-role key, or this SQL (Supabase allows it on auth.users):
--
--   UPDATE auth.users
--      SET raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb
--    WHERE email = 'jimb@nexamortgage.com';
--
-- The change takes effect on the user's NEXT token refresh, not immediately.
-- Sign out and back in after running it.
-- ==========================================================

-- ==========================================================
-- VERIFY — as a signed-in NON-admin, every one of these must return 0 rows
-- (not an error, not rows):
--   SELECT count(*) FROM leads;
--   SELECT count(*) FROM claims;
--   SELECT count(*) FROM inquiries;
--
-- And after the UPDATE above + a fresh sign-in, all three return real counts.
-- ==========================================================
