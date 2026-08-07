import "server-only";

import { createHash } from "node:crypto";
import { headers } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Rate limiting — the single seam every public write path calls.
 *
 * Closes the LAUNCH BLOCKER documented at the foot of
 * app/contractor/[slug]/actions.ts and app/diagnostic/actions.ts. Requires
 * db/migrations/20260806_rate_limits.sql to have been run first; see the note on
 * failing open below for what happens if it has not been.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS LAYER DOES AND DOES NOT PROTECT.
 *
 * It protects the DATABASE CONTENTS and the CONTRACTOR'S INBOX. A well-formed
 * flood can no longer bury a paying contractor's leads under junk, or fill the
 * leads table with PII-shaped garbage, or mail-bomb a third party through our
 * login form.
 *
 * IT DOES NOT PROTECT THE BILL, AND CANNOT. A Server Action rejected here has
 * already booted a Vercel function, run middleware, and been invoiced. Dropping
 * traffic before compute is the Vercel WAF's job and is configured in the
 * dashboard, not here. If this file is ever cited as the reason volumetric
 * abuse is handled, that is a misreading of it.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THIS FAILS OPEN. THAT IS A DECISION, NOT AN OVERSIGHT.
 *
 * If the RPC is missing, the database is unreachable, or anything else throws,
 * checkLimit() returns { allowed: true } and logs loudly.
 *
 * The alternative is worse for this product specifically. Both docblocks this
 * work closes say the same thing in different words — "a dropped inquiry is a
 * lost lead", "a dropped lead is the funnel's whole product". A limiter outage
 * that failed closed would silently convert every submission into a refusal:
 * the contractor sees no leads, the visitor sees an error, and nothing points
 * at the limiter. We would be doing the attacker's job during our own outage.
 *
 * THE ONE ARGUABLE EXCEPTION IS OTP VERIFICATION, where failing open means
 * unlimited brute-force attempts against an 8-digit code for the duration of
 * the outage. It still fails open here, because Supabase enforces its own
 * verification limits underneath as a backstop, and because a login nobody can
 * complete is itself an outage. If that judgement is ever revisited, revisit it
 * at the call site in app/login/actions.ts — not by changing this default for
 * every endpoint at once.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Peppered so the stored digest is not reversible.
 *
 * An unsalted SHA-256 of an IPv4 address is not anonymisation — there are only
 * four billion of them and the whole table can be built in seconds. With a
 * secret pepper the digest is meaningless to anyone who does not hold it.
 *
 * MISSING IS SURVIVABLE, ON PURPOSE. An unset variable degrades to unpeppered
 * hashing rather than throwing, because throwing here would take down lead
 * capture over a configuration mistake — the same posture as middleware.ts.
 * It warns once per process so the degradation is visible in the logs without
 * one line per submission.
 */
let pepperWarned = false;
function pepper(): string {
  const value = process.env.RATE_LIMIT_PEPPER;
  if (value) return value;
  if (!pepperWarned) {
    pepperWarned = true;
    console.warn(
      "[rate-limit] RATE_LIMIT_PEPPER is not set. Identifiers are being hashed " +
        "unsalted, which is reversible for IP addresses. Rate limiting still " +
        "works. Set it in .env.local and in the Vercel project (all environments).",
    );
  }
  return "";
}

/** Never store the raw IP, email or user id. See the note in the migration. */
function hashIdentifier(value: string): string {
  return createHash("sha256").update(`${pepper()}:${value}`).digest("hex");
}

/**
 * The caller's IP, reduced to the unit we actually want to limit.
 *
 * ⚠ IPv6 IS TRUNCATED TO ITS /64, AND IPv4 IS NOT.
 *
 * A residential IPv6 allocation is typically a /64 or larger, so one household
 * holds 18 quintillion addresses and can present a fresh one per request. Keyed
 * on the full address, an IPv6 limiter is decorative. Keyed on the /64 it
 * behaves like the IPv4 one. IPv4 is used whole because addresses there are
 * scarce and shared — truncating to a /24 would put a whole ISP's customers in
 * one bucket.
 *
 * ⚠ THE HEADER IS ONLY TRUSTWORTHY BECAUSE VERCEL SETS IT.
 *
 * x-forwarded-for is a request header like any other; a client can send one.
 * What makes it usable is that Vercel's proxy overwrites it before the function
 * sees it. x-real-ip is preferred here because it is a single value with no
 * list to parse, and parsing is where the classic mistake lives — taking the
 * leftmost entry of a list an attacker can prepend to.
 *
 * THIS NEEDS ONE LIVE CHECK BEFORE IT IS RELIED ON. Deploy to preview, then:
 *
 *   curl -X POST https://<preview>/… -H 'x-forwarded-for: 1.2.3.4'
 *
 * repeatedly with a different spoofed value each time. If the limit still trips,
 * the header is being overwritten and this is sound. If each spoofed value gets
 * its own fresh allowance, it is not, and the limiter is bypassable by a header.
 */
function clientIpKey(): string | null {
  const h = headers();

  const realIp = h.get("x-real-ip")?.trim();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = realIp || forwarded;

  if (!ip) return null;

  // IPv6 — keep the first four hextets (the /64 network), discard the host part.
  if (ip.includes(":")) {
    const hextets = ip.split(":");
    return hextets.slice(0, 4).join(":") + "::/64";
  }

  return ip;
}

/**
 * Bucket definitions.
 *
 * Every limit in the application is declared HERE rather than inline at the
 * call sites, so the whole policy can be read on one screen and reviewed as a
 * whole. Bucket names are constants and are never assembled from user input.
 *
 * The windows are deliberately short-and-long in pairs on the two lead paths: a
 * short window stops a burst, a long one stops a slow drip that would stay
 * under the short window all day.
 */
export const LIMITS = {
  /** Inquiry, per IP. Two windows. */
  INQUIRY_IP_BURST: { bucket: "inquiry:ip", limit: 3, windowSeconds: 600 },
  INQUIRY_IP_DAY: { bucket: "inquiry:ip:day", limit: 10, windowSeconds: 86_400 },

  /**
   * Inquiry, per CONTRACTOR. The one limit that survives IP rotation, and the
   * one that directly protects the thing being sold: a Featured contractor is
   * paying for leads, so burying their inbox is the abuse that actually costs
   * money. Keyed on the sync key, so a botnet with a fresh IP per request still
   * cannot post more than this to any single business.
   */
  INQUIRY_CONTRACTOR: { bucket: "inquiry:contractor", limit: 5, windowSeconds: 3_600 },

  /**
   * Diagnostic — the tightest limits here, because it is the most expensive
   * write we accept from an anonymous stranger.
   *
   * Each accepted submission costs a leads row of PII, a GHL contact, a GHL
   * opportunity and a human concierge callback. The inquiry form's junk costs a
   * contractor an email; this one's junk costs staff time and pollutes the CRM
   * that the sales process runs on.
   *
   * ⚠ THE DAILY LIMIT IS 3, NOT 5 — deliberately below what the shape of the
   * form suggests. A homeowner completes this wizard about their house roughly
   * once, so three in a day is already generous for a genuine visitor who
   * abandons and restarts.
   *
   * WHAT THIS COSTS AND WHY IT IS STILL RIGHT: a shared IP — an office, a
   * building's wifi, a mobile carrier behind CGNAT — puts several real
   * households in one bucket, and the fourth of them in a day is refused. That
   * is a real lost lead and it is not hypothetical on mobile networks. It is
   * accepted because the refusal is visible and recoverable (the visitor is told
   * to call, and the number is on the page), whereas the failure in the other
   * direction is a concierge working a queue of fabricated callbacks and losing
   * trust in the whole funnel. Revisit if the logs ever show this bucket
   * tripping against traffic that converts.
   */
  DIAGNOSTIC_IP_BURST: { bucket: "diagnostic:ip", limit: 2, windowSeconds: 600 },
  DIAGNOSTIC_IP_DAY: { bucket: "diagnostic:ip:day", limit: 3, windowSeconds: 86_400 },

  /**
   * Registry request (/join, the no-match branch) — the diagnostic's shape and
   * the diagnostic's numbers.
   *
   * The short-and-long pair is what matters and is copied deliberately: a
   * business asks to be listed roughly once, so a burst window stops a script
   * and a daily window stops the slow drip that would stay under it.
   *
   * ⚠ THE COST PROFILE HERE IS LOWER THAN THE DIAGNOSTIC'S, so if these ever
   * trip against real traffic, this is the pair to loosen first. An accepted
   * request costs a row, one Resend email and a minute of a reviewer's time — it
   * does NOT spend a GHL contact, a GHL opportunity or a concierge callback. The
   * numbers are matched to the diagnostic's for consistency, not because the
   * blast radius is the same.
   *
   * THE SHARED-IP COST IS REAL AND IS THE SAME ONE DIAGNOSTIC_IP_DAY DESCRIBES:
   * two partners in one office submitting their two businesses is 2, and the
   * third is refused. The refusal names an email address to write to instead —
   * see REQUEST_ERROR_TEXT.rate — so it is recoverable rather than a dead end.
   */
  REGISTRY_REQUEST_IP_BURST: { bucket: "registry-request:ip", limit: 2, windowSeconds: 600 },
  REGISTRY_REQUEST_IP_DAY: { bucket: "registry-request:ip:day", limit: 3, windowSeconds: 86_400 },

  /** Magic-link send, per IP. */
  LOGIN_SEND_IP: { bucket: "login-send:ip", limit: 3, windowSeconds: 900 },

  /**
   * Magic-link send, per EMAIL ADDRESS — the anti-mail-bomb control, and the
   * more important of this pair.
   *
   * Without it, `sendLoginCode({ email: "victim@example.com" })` in a loop is a
   * mail bomb aimed at a third party that we send, from our domain, at our
   * expense — and it exhausts the project's Supabase email allowance, which
   * locks every real contractor out of their own login. The per-IP limit above
   * does not stop that from a botnet; this does, because the target address is
   * the thing that has to stay constant for the attack to work.
   */
  LOGIN_SEND_EMAIL: { bucket: "login-send:email", limit: 3, windowSeconds: 3_600 },

  /**
   * OTP verification — the brute-force control, and the most security-critical
   * limit here. Keyed on the email because that is what the guess is against;
   * the IP limit below is the secondary net for someone spraying many addresses.
   */
  LOGIN_VERIFY_EMAIL: { bucket: "login-verify:email", limit: 5, windowSeconds: 900 },
  LOGIN_VERIFY_IP: { bucket: "login-verify:ip", limit: 20, windowSeconds: 3_600 },

  /**
   * ID-photo upload targets, per USER.
   *
   * Keyed on the user id rather than the IP because this endpoint requires a
   * session — though note that a session costs one email and two requests, so
   * "authenticated" is not much of a control on its own and this limit is
   * carrying real weight.
   *
   * WHAT IT STOPS: createIdPhotoUploadTarget() mints a FRESH claim id and a
   * fresh storage path on every call by design, and its two guards ("not yet
   * claimed", "no pending claim of mine") are both satisfied indefinitely until
   * a claim row is actually written. So without this, one account could mint
   * unlimited signed upload URLs and push 10MB per object into a private bucket
   * across 266,305 unclaimed contractors — and nothing would ever remove them,
   * because the 90-day purge scans the claims table and an orphaned object has
   * no claim row. The purge sweep added alongside this limit is the other half.
   */
  CLAIM_UPLOAD_USER: { bucket: "claim-upload:user", limit: 5, windowSeconds: 3_600 },
  CLAIM_UPLOAD_USER_DAY: { bucket: "claim-upload:user:day", limit: 20, windowSeconds: 86_400 },

  /** Claim submission, per user. The partial unique index already handles
   *  duplicates; this is here so the endpoint is not the one unlimited one. */
  CLAIM_SUBMIT_USER: { bucket: "claim-submit:user", limit: 10, windowSeconds: 3_600 },
} as const;

export type LimitSpec = { bucket: string; limit: number; windowSeconds: number };

export type LimitVerdict = {
  allowed: boolean;
  /** Seconds until the window resets. 0 when allowed or unknown. */
  retryAfter: number;
};

const ALLOWED: LimitVerdict = { allowed: true, retryAfter: 0 };

/**
 * Check one bucket.
 *
 * `identifier` is the RAW value — an IP, an email, a user id, a sync key. It is
 * hashed here so no call site has to remember to, and so no call site can
 * accidentally pass one through unhashed.
 */
export async function checkLimit(
  spec: LimitSpec,
  identifier: string | null,
): Promise<LimitVerdict> {
  /**
   * An unidentifiable caller is allowed through.
   *
   * This is the fail-open policy applied to its most common cause: no IP header,
   * which happens in local development on every request. Failing closed here
   * would make `next dev` reject every form submission, and the fix someone
   * reaches for under that pressure is to delete the limiter call.
   */
  if (!identifier) {
    console.warn("[rate-limit] no identifier available", { bucket: spec.bucket });
    return ALLOWED;
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("check_rate_limit", {
      p_bucket: spec.bucket,
      p_identifier: hashIdentifier(identifier),
      p_limit: spec.limit,
      p_window_seconds: spec.windowSeconds,
    });

    if (error) {
      // PGRST202 here means the migration has not been run. Named explicitly
      // because that is the realistic cause and the message otherwise reads
      // like a transient database fault.
      console.error("[rate-limit] CHECK FAILED — FAILING OPEN, endpoint is unlimited", {
        bucket: spec.bucket,
        code: error.code,
        message: error.message,
        hint:
          error.code === "PGRST202"
            ? "db/migrations/20260806_rate_limits.sql has not been run."
            : undefined,
      });
      return ALLOWED;
    }

    // The function RETURNS TABLE, so supabase-js hands back an array of rows.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      console.error("[rate-limit] RPC returned no row — FAILING OPEN", {
        bucket: spec.bucket,
      });
      return ALLOWED;
    }

    return {
      allowed: Boolean(row.allowed),
      retryAfter: Number(row.retry_after) || 0,
    };
  } catch (err) {
    console.error("[rate-limit] CHECK THREW — FAILING OPEN, endpoint is unlimited", {
      bucket: spec.bucket,
      error: String(err).slice(0, 300),
    });
    return ALLOWED;
  }
}

/**
 * Check several buckets and return the first refusal.
 *
 * ⚠ SEQUENTIAL, NOT Promise.all, AND THAT IS THE POINT. Short-circuiting on the
 * first refusal means an actor who is already blocked costs one round trip
 * rather than three. Under the flood this exists to handle, the blocked path is
 * the hot path — so it is the one worth making cheap.
 *
 * Order the specs cheapest-and-most-likely-to-trip first.
 */
export async function checkLimits(
  checks: Array<{ spec: LimitSpec; identifier: string | null }>,
): Promise<LimitVerdict> {
  for (const { spec, identifier } of checks) {
    const verdict = await checkLimit(spec, identifier);
    if (!verdict.allowed) return verdict;
  }
  return ALLOWED;
}

/** The per-IP key for the current request, already reduced. */
export function requestIp(): string | null {
  return clientIpKey();
}
