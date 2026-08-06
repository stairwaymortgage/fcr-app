-- ==========================================================
-- RATE LIMITING — the counter table and the one function that reads it
-- Created 2026-08-06. APPLIED 2026-08-06 by Jim in the SQL editor.
-- ==========================================================
--
-- VERIFIED AFTER APPLYING:  node --no-warnings scripts/verify-rate-limit.mjs
--   43 passed, 0 failed — including the check that decides whether any of this
--   is worth having: anon calling check_rate_limit is refused with 42501
--   permission denied. See section E of that script.
--
-- Every statement here is idempotent (CREATE ... IF NOT EXISTS, CREATE OR
-- REPLACE, REVOKE/GRANT), so re-running the whole file is safe.
--
-- Closes the LAUNCH BLOCKER documented at the foot of
-- app/contractor/[slug]/actions.ts and app/diagnostic/actions.ts. Nothing in the
-- application calls anything here until the accompanying TypeScript ships, so
-- this file is safe to run BEFORE the deploy and must be run before it — the
-- limiter fails open, so deploying the code first would simply leave every
-- endpoint unlimited while logging that the function is missing.
--
-- DEPLOY ORDER: this file, then the deploy. Not the other way round.
--
--
-- ==========================================================
-- WHY POSTGRES AND NOT REDIS
-- ==========================================================
--
-- The docblock in actions.ts nominates @upstash/ratelimit. This does the same
-- job against the database that is already here, and the reasoning is worth
-- recording because the obvious objection to it is correct but does not bite:
--
-- THE OBJECTION: every limiter check is now a WRITE to the primary database, so
-- an attacker's flood adds write load and WAL to the same Postgres that serves
-- the public directory. True. It does not decide the question, because the
-- volume at which that matters is the volume at which application-level
-- limiting has already lost — a Vercel function still boots, runs and bills for
-- every request it rejects. Only the edge can drop traffic before compute, which
-- is why the Vercel WAF rules are step 1 and this is step 2. This layer exists
-- to protect the database contents and the contractor's inbox, not the bill.
--
-- WHAT POSTGRES BUYS: no new vendor in the launch path, no new secret to
-- rotate, no second thing that can be down on the day, and — the reason that
-- actually mattered — a queryable abuse trail from day one. We do not yet know
-- this product's abuse profile. "Which bucket is saturating, and since when" is
-- a SELECT here and a paid analytics add-on there.
--
-- WHEN TO REVISIT: if sustained abuse ever shows up as real load on this table.
-- lib/rate-limit.ts is written against a single checkLimit() seam so the store
-- can be swapped without touching any of the six call sites.
--
--
-- ==========================================================
-- FIXED WINDOW, AND WHY THAT IS ENOUGH
-- ==========================================================
--
-- A sliding window is more accurate at the boundary; a fixed window can admit up
-- to 2x the limit across one boundary. At the thresholds these buckets use, 2x
-- of "3 inquiries per 10 minutes" is 6 inquiries in a few seconds, which is
-- indistinguishable from an impatient human and nothing anyone would act on.
--
-- Buying the accuracy back would mean either a second weighted window or a row
-- per hit. The row-per-hit shape is the one to avoid: it turns every check into
-- an unbounded INSERT plus a COUNT over a growing table, which is the failure
-- mode the objection above actually describes.
--
--
-- ==========================================================
-- THE IDENTIFIER IS A HASH. THIS TABLE HOLDS NO PII.
-- ==========================================================
--
-- identifier stores a peppered SHA-256 of the IP address, email or user id —
-- never the value itself. lib/rate-limit.ts does the hashing before it ever gets
-- here.
--
-- This is a deliberate trade and it costs something real. Raw IPs would let you
-- answer "which /24 sent 400 inquiries" directly in the SQL editor. Hashes
-- cannot. The trade is taken because the alternative is a new table logging the
-- IP address of every visitor who fills in a form, with no retention policy and
-- no mention on /privacy — a new PII store created as a side effect of a
-- spam control. Vercel's firewall analytics already reports top offending IPs,
-- which is both where you would look and where you would act on the answer.
--
-- The pepper (RATE_LIMIT_PEPPER) matters: an unsalted SHA-256 of an IPv4
-- address is reversible by brute force in seconds, there being only four
-- billion of them. The application falls back to unpeppered hashing with a loud
-- warning if the variable is missing, because a missing environment variable
-- must not take lead capture down — the same posture as middleware.ts.


-- ----------------------------------------------------------
-- 1. THE TABLE
-- ----------------------------------------------------------
--
-- One row per (bucket, identifier) pair, reused for the life of that pair
-- rather than one row per request. The table's size is therefore bounded by the
-- number of distinct actors in the retention window, not by traffic — a flood
-- of a million requests from one IP is still one row.

CREATE TABLE IF NOT EXISTS public.rate_limits (
  -- Which limit this is: 'inquiry:ip', 'diagnostic:ip', 'login-send:email', …
  -- Named in lib/rate-limit.ts, never assembled from user input.
  bucket        text        NOT NULL,

  -- Peppered SHA-256 hex of the IP / email / user id. See the note above.
  identifier    text        NOT NULL,

  -- Start of the CURRENT window. Advanced to now() by the function below only
  -- once the previous window has fully elapsed, which is what makes a
  -- continuously-hammering client fall out of its block after one window rather
  -- than being extended forever by its own retries.
  window_start  timestamptz NOT NULL DEFAULT now(),

  hits          integer     NOT NULL DEFAULT 0,

  PRIMARY KEY (bucket, identifier)
);

COMMENT ON TABLE public.rate_limits IS
  'Fixed-window rate limit counters. identifier is a peppered SHA-256, never a raw IP or email. Written only by check_rate_limit() under service-role; purged daily by /api/cron/purge-id-photos.';

-- For the purge only. The primary key already serves every read the function
-- does, so this index exists solely so the daily DELETE does not seq-scan.
CREATE INDEX IF NOT EXISTS rate_limits_window_start_idx
  ON public.rate_limits (window_start);


-- ----------------------------------------------------------
-- 2. RLS AND GRANTS — CLOSED TO EVERYONE BUT SERVICE-ROLE
-- ----------------------------------------------------------
--
-- RLS on with NO POLICIES AT ALL, which is the strictest state: every policy-
-- checked role is denied everything, and service-role bypasses RLS by design.
-- Same shape as leads.
--
-- ⚠ AN ANON-READABLE LIMITER TABLE WOULD BE AN ABUSE VECTOR IN ITSELF, not just
-- an information leak. Read access tells an attacker exactly how close to the
-- threshold they are and when their window resets, which is the one piece of
-- information that turns "guess and get blocked" into "pace precisely under the
-- limit forever". Write access would let them evict or inflate anyone else's
-- counter. Neither is granted, and neither should be granted later for
-- debugging convenience — read it in the SQL editor instead.

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Belt and braces behind RLS, matching 20260804_grant_hygiene.sql: the policy
-- refuses, and there is no grant sitting behind it either.
REVOKE ALL ON public.rate_limits FROM anon, authenticated;


-- ----------------------------------------------------------
-- 3. check_rate_limit() — COUNT AND VERDICT IN ONE STATEMENT
-- ----------------------------------------------------------
--
-- ⚠ THE INSERT ... ON CONFLICT IS THE WHOLE CONCURRENCY STORY, AND IT MUST STAY
-- ONE STATEMENT.
--
-- The read-then-write shape this replaces — SELECT the count, decide, UPDATE —
-- is a lost-update race: two simultaneous requests both read 2, both conclude
-- they are under a limit of 3, and both write 3. Under exactly the burst of
-- concurrent traffic a rate limiter exists to catch, that is when it fails.
--
-- ON CONFLICT DO UPDATE takes a row lock and serialises the contenders, so N
-- concurrent calls produce N distinct increments. Do not "simplify" this into a
-- SELECT followed by an UPDATE.
--
-- BOTH CASE EXPRESSIONS READ rl.window_start, which inside DO UPDATE is the
-- PRE-UPDATE value. That is what makes them consistent with each other: they
-- cannot disagree about whether the window had expired, because they are both
-- looking at the same old row.
--
-- THE REJECTED ATTEMPT IS COUNTED TOO. A caller already over the limit still
-- increments. This is deliberate — it is what stops a blocked client from
-- discovering the exact threshold by probing — and it is safe because
-- window_start is not touched while the window is live, so the block still
-- expires one window after it began however hard the caller retries.

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_bucket          text,
  p_identifier      text,
  p_limit           integer,
  p_window_seconds  integer
)
RETURNS TABLE (allowed boolean, hit_count integer, retry_after integer)
AS $$
DECLARE
  v_hits          integer;
  v_window_start  timestamptz;
BEGIN
  -- Arguments are validated rather than trusted. This function runs SECURITY
  -- DEFINER, and a caller that could pass p_limit => 2147483647 would have a
  -- documented way to switch the limiter off.
  IF p_bucket IS NULL OR p_bucket = '' OR p_identifier IS NULL OR p_identifier = '' THEN
    RAISE EXCEPTION 'check_rate_limit: bucket and identifier are required';
  END IF;
  IF p_limit < 1 OR p_limit > 100000 THEN
    RAISE EXCEPTION 'check_rate_limit: limit out of range (%)', p_limit;
  END IF;
  IF p_window_seconds < 1 OR p_window_seconds > 604800 THEN
    RAISE EXCEPTION 'check_rate_limit: window out of range (%)', p_window_seconds;
  END IF;

  INSERT INTO public.rate_limits AS rl (bucket, identifier, window_start, hits)
  VALUES (p_bucket, left(p_identifier, 200), now(), 1)
  ON CONFLICT (bucket, identifier) DO UPDATE
    SET
      window_start = CASE
        WHEN rl.window_start < now() - make_interval(secs => p_window_seconds)
          THEN now()
        ELSE rl.window_start
      END,
      hits = CASE
        WHEN rl.window_start < now() - make_interval(secs => p_window_seconds)
          THEN 1
        ELSE rl.hits + 1
      END
  RETURNING rl.hits, rl.window_start INTO v_hits, v_window_start;

  RETURN QUERY SELECT
    v_hits <= p_limit,
    v_hits,
    -- Seconds until this window expires. Surfaced so the caller can send a
    -- Retry-After and tell a real person how long to wait, rather than a bare
    -- refusal that reads like a broken form.
    GREATEST(
      0,
      ceil(
        extract(epoch FROM (v_window_start + make_interval(secs => p_window_seconds)) - now())
      )::integer
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;

COMMENT ON FUNCTION public.check_rate_limit(text, text, integer, integer) IS
  'Atomically increments a fixed-window counter and returns the verdict. Service-role only — see the REVOKE below.';

-- ⚠ THIS FUNCTION MUST NOT BE PUBLICLY CALLABLE.
--
-- PostgREST exposes every function in the public schema as an RPC endpoint. Left
-- callable by anon, /rest/v1/rpc/check_rate_limit would let anybody burn any
-- bucket they could guess the identifier for — including, with a hash of a
-- competitor's IP, locking a real visitor out of the inquiry form. It would also
-- confirm whether a given hash is currently limited, which is the probing oracle
-- section 2 refuses to grant by other means.
--
-- The application calls this with the service-role client only.
REVOKE ALL ON FUNCTION public.check_rate_limit(text, text, integer, integer)
  FROM PUBLIC, anon, authenticated;

-- Explicit rather than inherited. Supabase's default privileges already grant
-- functions in public to service_role, so the REVOKE above does not remove it —
-- but relying on a platform default to keep the limiter working is not a
-- dependency worth having silently.
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, integer)
  TO service_role;


-- ----------------------------------------------------------
-- 4. DUPLICATE-SUPPRESSION INDEXES
-- ----------------------------------------------------------
--
-- The counters above are only half of the control. Both lead paths also collapse
-- repeat submissions from the same SENDER within 24 hours, which catches the
-- actor the counters cannot see: one who stays politely under every window but
-- submits from a rotating IP pool all week. The target has to stay constant for
-- the spam to land, so (sender, target) is the pair worth collapsing.
--
-- ⚠ THESE INDEXES ARE NOT AN OPTIMISATION. Each suppression check is a SELECT on
-- the hot path of an unauthenticated endpoint, executed BEFORE the insert on
-- every submission — including every submission of a flood. Unindexed, the
-- lookup is a sequential scan over a table that only grows, so the anti-abuse
-- check becomes the most expensive thing an attacker can make us do. That is the
-- limiter funding the attack.
--
-- LOCKING: plain CREATE INDEX takes a SHARE lock and blocks writes to the table
-- while it builds — see the note in 20260730_search_indexes.sql. Both tables are
-- small today (leads and inquiries are early-stage, thousands of rows at most),
-- so this is a sub-second lock and CONCURRENTLY is not worth the complexity of
-- its failure modes. If either table is ever large when this is re-run, use
-- CREATE INDEX CONCURRENTLY instead — it cannot run inside a transaction block.

-- Inquiry: the check is
--   WHERE contractor_dbpr_sync_key = $1 AND from_email = $2 AND created_at >= $3
-- Equality columns first, then the range column, which is the order that lets
-- one index serve the whole predicate.
CREATE INDEX IF NOT EXISTS inquiries_dedupe_idx
  ON public.inquiries (contractor_dbpr_sync_key, from_email, created_at DESC);

-- Diagnostic: the check matches EITHER contact field, because a spammer who
-- rotates one usually does not rotate both, and a real homeowner who mistypes
-- their email still has the same phone. Two separate indexes rather than one
-- composite: the predicate is an OR, and Postgres serves that with a BitmapOr
-- over both — a composite (email, phone) index could not be used for the phone
-- half at all.
CREATE INDEX IF NOT EXISTS leads_dedupe_email_idx
  ON public.leads (email, created_at DESC);

CREATE INDEX IF NOT EXISTS leads_dedupe_phone_idx
  ON public.leads (phone, created_at DESC);


-- ----------------------------------------------------------
-- 5. RETENTION
-- ----------------------------------------------------------
--
-- The longest window any bucket uses is 24 hours, so a row whose window started
-- more than 48 hours ago cannot affect any verdict. It is kept for 48 rather
-- than 24 so that a purge which fails to run for a day does not change
-- behaviour.
--
-- Run daily by /api/cron/purge-id-photos, which already holds the service-role
-- key and already runs at 07:00. Adding a second cron entry for one DELETE
-- would be a second thing to notice had stopped.
--
-- This statement is also safe to run by hand at any time.
DELETE FROM public.rate_limits
WHERE window_start < now() - interval '48 hours';


-- ==========================================================
-- 6. AFTER RUNNING, CONFIRM
-- ==========================================================
--
--   -- the three dedupe indexes from section 4 exist
--   SELECT indexname FROM pg_indexes
--    WHERE indexname IN ('inquiries_dedupe_idx',
--                        'leads_dedupe_email_idx',
--                        'leads_dedupe_phone_idx');
--   -- 3 rows. Fewer means a CREATE INDEX failed on a column name — check that
--   -- inquiries.contractor_dbpr_sync_key and leads.phone are spelled as above.
--
--
-- These are run in the SQL editor, where you are postgres rather than anon, so
-- they exercise the function itself. The REVOKE is checked separately below.
--
--   -- first call in a fresh bucket: allowed, 1 hit
--   SELECT * FROM check_rate_limit('verify:selftest', 'abc', 3, 600);
--   --  allowed | hit_count | retry_after
--   --  t       | 1         | 600
--
--   -- call it three more times; the fourth must be refused
--   SELECT * FROM check_rate_limit('verify:selftest', 'abc', 3, 600);   -- t, 2
--   SELECT * FROM check_rate_limit('verify:selftest', 'abc', 3, 600);   -- t, 3
--   SELECT * FROM check_rate_limit('verify:selftest', 'abc', 3, 600);   -- f, 4
--
--   -- a DIFFERENT identifier in the same bucket is unaffected
--   SELECT * FROM check_rate_limit('verify:selftest', 'xyz', 3, 600);   -- t, 1
--
--   -- window expiry, without waiting ten minutes: age the row by hand
--   UPDATE rate_limits SET window_start = now() - interval '11 minutes'
--    WHERE bucket = 'verify:selftest' AND identifier = 'abc';
--   SELECT * FROM check_rate_limit('verify:selftest', 'abc', 3, 600);
--   --  t | 1 | 600      <- reset, NOT 5. If this returns 5 the CASE is wrong.
--
--   -- clean up the self-test
--   DELETE FROM rate_limits WHERE bucket = 'verify:selftest';
--
--
-- ⚠ THE ONE CHECK THAT MATTERS MOST — that the public cannot call this.
-- Run against the REST endpoint with the ANON key, not in the SQL editor:
--
--   curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rpc/check_rate_limit" \
--     -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
--     -H "Content-Type: application/json" \
--     -d '{"p_bucket":"probe","p_identifier":"probe","p_limit":1,"p_window_seconds":60}'
--
-- MUST return 404 with code PGRST202 ("Could not find the function ... in the
-- schema cache") or a 42501 permission-denied. A 200 with a verdict means the
-- REVOKE in section 3 did not take, and the limiter is itself an abuse
-- endpoint — do not deploy until that curl fails.
--
-- A count of 0 in rate_limits proves nothing on its own; the curl above is the
-- negative test that does.
-- ==========================================================
