"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { LIMITS as RATE, checkLimit, requestIp } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/**
 * Magic-link request.
 *
 * ---------------------------------------------------------------------------
 * THE RESULT IS THE SAME WHETHER OR NOT THE EMAIL EXISTS.
 *
 * "No account with that email" turns this form into an account-existence
 * oracle: anyone can test whether a given contractor has claimed their profile,
 * and the contractor list is public. So the page always says "check your
 * email", and a genuine send failure is logged server-side rather than shown.
 *
 * The cost is that a typo looks identical to success. That is the accepted
 * trade — the same one every serious auth form makes — and the copy tells the
 * visitor to check the address if nothing arrives.
 * ---------------------------------------------------------------------------
 *
 * shouldCreateUser IS TRUE, DELIBERATELY. A contractor claiming a profile for
 * the first time has no account yet; requiring a separate signup step for a
 * passwordless flow would be a second email for no gain. Creating an account
 * grants nothing on its own — every table is closed to a plain authenticated
 * user by RLS, and admin comes from app_metadata which this path cannot set.
 */

const VerifySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  token: z.string().trim().max(32),
});

const Schema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  /** Where to land after the link is clicked. Validated in the callback. */
  next: z.string().max(300).optional().or(z.literal("")),
  /** Hidden field. Bots fill it; people cannot see it. */
  website: z.string().max(0),
});

export type LoginResult = { ok: boolean; error?: string };

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WE SIGN IN WITH A CODE, NOT A CLICKABLE LINK.
 *
 * A one-time link is consumed by whoever fetches it FIRST, and that is often
 * not the person. Corporate mail scanners and Outlook Safe Links fetch every
 * URL in an inbound message to check it, which spends the token before the
 * recipient has seen the email. They then click a valid link and are told it
 * has already been used — which is true, and completely opaque.
 *
 * Observed on this project, 2026-08-01: repeated "already been used" on links
 * that had never been clicked. Copy-pasting the URL by hand worked, which is
 * the signature of pre-fetch rather than expiry.
 *
 * A code cannot be spent by fetching anything. There is no URL in the email at
 * all, which also disposes of the other two link problems for free: long links
 * broken across lines by mail clients, and Safe Links rewriting the host.
 *
 * signInWithOtp sends BOTH shapes — which one arrives is decided entirely by
 * the email template. The templates must therefore contain {{ .Token }} and NO
 * link: leave a link in and a scanner still burns the token, and the code in
 * the same message dies with it.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export async function sendLoginCode(input: unknown): Promise<LoginResult> {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That doesn't look like a valid email address." };
  }
  const { email, next, website } = parsed.data;

  if (website) {
    // Honeypot. Reported as success so a bot learns nothing from the response.
    return { ok: true };
  }

  /**
   * RATE LIMIT — TWO BUCKETS THAT ARE REFUSED IN TWO DIFFERENT WAYS, and the
   * difference is the point rather than an inconsistency.
   *
   * PER-IP is refused OUT LOUD. The only person who trips it is the person
   * making the requests, and they are usually a real contractor who did not get
   * the first email and is pressing the button again. Telling them to wait is
   * the honest and useful answer.
   *
   * PER-EMAIL IS REFUSED SILENTLY — we return ok:true and send nothing.
   *
   * ⚠ DO NOT "FIX" THIS INTO AN HONEST ERROR MESSAGE. This whole action is
   * built so that the response is identical whether or not an account exists
   * (see the note at the top of the file). A visible "too many codes have been
   * sent to that address" would reintroduce exactly the oracle that design
   * removes, and a worse one: it answers "has anyone been requesting codes for
   * this address", which is a question about a THIRD PARTY that the person
   * asking has no relationship to. The attack this bucket exists to stop —
   * sendLoginCode({ email: victim }) in a loop — is run by someone who is not
   * the victim, so the refusal must be invisible to them.
   *
   * The real contractor's experience of a silent drop is one missing email,
   * which is the same thing the honeypot and every send failure above already
   * look like, and the copy tells them to try again.
   */
  const ipVerdict = await checkLimit(RATE.LOGIN_SEND_IP, requestIp());
  if (!ipVerdict.allowed) {
    return {
      ok: false,
      error: "Too many sign-in requests. Wait a few minutes and try again.",
    };
  }

  const emailVerdict = await checkLimit(RATE.LOGIN_SEND_EMAIL, email);
  if (!emailVerdict.allowed) {
    console.warn("[login] send suppressed — per-address limit reached, reported as success", {
      retryAfter: emailVerdict.retryAfter,
    });
    return { ok: true };
  }

  /**
   * The redirect target is built from the request's own origin rather than a
   * hard-coded URL, so localhost, Vercel previews and production each send a
   * link that points back at themselves. Supabase still has the final say:
   * anything not in its Redirect URLs allowlist is refused, which is what makes
   * this safe to derive from a header.
   */
  const h = headers();
  const origin =
    h.get("origin") ??
    (h.get("host") ? `https://${h.get("host")}` : process.env.NEXT_PUBLIC_SITE_URL);

  if (!origin) {
    console.error("[login] cannot determine origin for the magic-link redirect");
    return { ok: false, error: "Something went wrong on our side. Please try again." };
  }

  /**
   * `next` IS ALWAYS SET, EVEN WHEN THERE IS NOTHING TO PRESERVE.
   *
   * Not cosmetic. The email templates build the link by appending to
   * {{ .RedirectTo }}, which is this URL:
   *
   *   {{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=magiclink
   *
   * That concatenation is only valid if this URL already carries a query
   * string. Omitting `next` when it is empty would emit ".../auth/callback&
   * token_hash=…" — one malformed link, sent only to visitors who arrived at
   * /login directly rather than by being bounced there. The common path would
   * keep working, which is what would make it hard to spot.
   */
  const callback = new URL("/auth/callback", origin);
  callback.searchParams.set("next", next || "/dashboard");

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callback.toString(), shouldCreateUser: true },
  });

  if (error) {
    /**
     * Logged, not shown. Rate limiting is the common cause and its message
     * ("email rate limit exceeded") would confirm the address exists.
     */
    console.error("[login] magic link send failed", {
      status: error.status,
      message: error.message,
    });
  }

  return { ok: true };
}

/**
 * Exchange the emailed code for a session.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * type: "email" COVERS BOTH SHAPES — VERIFIED, NOT ASSUMED.
 *
 * A returning contractor's code comes from the Magic Link template and a
 * brand-new one's from Confirm Signup, and the links those templates carry
 * declare type=magiclink and type=signup respectively. It would be reasonable
 * to expect verifyOtp to need the matching type, and /auth/callback does have
 * to make that distinction for token_hash.
 *
 * It does not apply here. Probed against this project on 2026-08-01: a code
 * from EITHER template verifies with type "email".
 *
 *   existing user -> otp 98568613 (link said type=magiclink) -> "email" OK
 *   new user      -> otp 38986825 (link said type=signup)    -> "email" OK
 *
 * So there is one path rather than a try-this-then-that chain whose second
 * branch would only ever run for first-time contractors — the people least
 * able to report what went wrong.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE CODE LENGTH IS NOT SIX. This project issues EIGHT digits. Nothing here
 * hard-codes a length: the digits are extracted and passed on, and Supabase
 * decides. A maxLength of 6 in the UI would silently truncate every real code,
 * and the failure would look like "the code doesn't work".
 */
export async function verifyLoginCode(input: unknown): Promise<LoginResult> {
  const parsed = VerifySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Enter the code from your email." };
  }

  const email = parsed.data.email;
  // Digits only: people paste codes with spaces, and some mail clients insert
  // a non-breaking space or a soft hyphen mid-number.
  const token = parsed.data.token.replace(/\D/g, "");
  if (token.length < 4 || token.length > 12) {
    return { ok: false, error: "That code doesn't look right. It's the number in your email." };
  }

  /**
   * RATE LIMIT — THE BRUTE-FORCE CONTROL. The most security-critical limit in
   * the application, and the reason is arithmetic: the code is EIGHT digits, so
   * a guess has a 1-in-100,000,000 chance. Unlimited attempts turn that from a
   * wall into a waiting game — a few hours of requests against a known
   * contractor's address is a realistic path to a session.
   *
   * KEYED ON THE EMAIL FIRST, because that is what the guess is against. The
   * per-IP bucket behind it is the secondary net for someone spraying many
   * addresses from one place rather than hammering one address.
   *
   * ⚠ THIS FAILS OPEN, WHICH HERE MEANS UNLIMITED GUESSES DURING A POSTGRES
   * OUTAGE. That is the one genuinely uncomfortable consequence of the
   * fail-open policy in lib/rate-limit.ts, and it is taken with two things
   * behind it: Supabase enforces its own verification limits underneath, and a
   * login nobody can complete is itself an outage. If that judgement is ever
   * revisited, revisit it HERE — at this call site — not by flipping the
   * default for all six endpoints at once.
   *
   * REFUSAL WEARS THE SAME BLAND MESSAGE as a wrong code, for the same reason:
   * the failure text on this path must never distinguish "wrong code" from
   * "no such account", or it enumerates which contractors have signed up.
   */
  const attemptVerdict = await checkLimit(RATE.LOGIN_VERIFY_EMAIL, email);
  const ipAttemptVerdict = attemptVerdict.allowed
    ? await checkLimit(RATE.LOGIN_VERIFY_IP, requestIp())
    : attemptVerdict;

  if (!attemptVerdict.allowed || !ipAttemptVerdict.allowed) {
    console.warn("[login] verification refused — attempt limit reached", {
      perEmail: !attemptVerdict.allowed,
      perIp: !ipAttemptVerdict.allowed,
    });
    return {
      ok: false,
      error: "Too many attempts. Request a new code and try again in a few minutes.",
    };
  }

  const supabase = createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });

  if (error || !data.session) {
    /**
     * Deliberately one message for every failure — wrong code, expired code,
     * no such address. Distinguishing them turns this into an oracle: an
     * attacker could separate "wrong code" from "no account" and enumerate
     * which contractors have signed up, and the contractor list is public.
     *
     * Logged with the real reason so a genuine outage is still diagnosable.
     */
    console.warn("[login] code verification failed", {
      status: error?.status,
      message: error?.message,
    });
    return { ok: false, error: "That code is wrong or has expired. Request a new one." };
  }

  return { ok: true };
}
