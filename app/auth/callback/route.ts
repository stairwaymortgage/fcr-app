import { NextResponse, type NextRequest } from "next/server";

import { resolveLanding } from "@/lib/landing";
import { createClient } from "@/lib/supabase/server";

/**
 * Magic-link landing — /auth/callback
 *
 * Supabase sends the visitor here with ?code=…; this exchanges that code for a
 * session and sets the cookies. It is the only place a session is created.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ?next IS ATTACKER-CONTROLLED. IT IS VALIDATED, NOT TRUSTED.
 *
 * The whole URL arrives in an email, and anyone can compose that email. Passing
 * ?next straight to redirect() would make this an open redirect on an auth
 * endpoint — the most useful kind to a phisher, because the victim really did
 * just sign in to the real site before being bounced somewhere else.
 *
 * safeNext() in lib/safe-next.ts accepts only a same-site absolute path, and
 * lives in its own module so it can be unit-tested — inside this handler the
 * security-critical branch was unreachable without a valid single-use code.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS FILE DEPENDS ON A SETTING THAT DOES NOT LIVE IN THIS REPO.
 *
 * The Supabase email templates (Auth → Email Templates) must send token_hash,
 * NOT the default {{ .ConfirmationURL }}:
 *
 *   Confirm signup:  {{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=signup
 *   Magic Link:      {{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=magiclink
 *
 * {{ .ConfirmationURL }} routes the click through Supabase's /auth/v1/verify,
 * which consumes the token and hands us ?code= — the PKCE flow. PKCE pairs
 * that code with a verifier cookie held ONLY in the browser that requested the
 * link, so opening the email anywhere else fails.
 *
 * OBSERVED IN PRODUCTION 2026-08-01, and it is worth being precise about what
 * it looks like, because it does not look like a bug. Supabase accepted the
 * click and set email_confirmed_at; the address really was confirmed. Only the
 * session failed:
 *
 *   [auth] code exchange failed — "PKCE code verifier not found in storage"
 *
 * The token is spent by then, so every retry of that same link reports
 * "Email link is invalid or has expired" — which reads like an expiry problem
 * and sends you looking at link lifetimes, the wrong place entirely.
 *
 * The token_hash branch below exists precisely to avoid this and is checked
 * first. It cannot help while the template keeps sending ?code=. If sign-in
 * starts failing for people reading email on a different device, CHECK THE
 * TEMPLATES BEFORE CHANGING THIS FILE.
 * ═══════════════════════════════════════════════════════════════════════════
 */


export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  /**
   * ⚠ THE RAW VALUE, RESOLVED AFTER THE SESSION EXISTS — not safeNext() here.
   *
   * Two changes on 2026-08-06, and they are connected. resolveLanding() still
   * validates the path (it calls safeNext internally), but when no usable
   * `next` was supplied it picks a destination from the signed-in user's ROLE
   * instead of defaulting everyone to "/". That lookup needs the session, which
   * does not exist until the exchange below succeeds — so the value is computed
   * at each redirect site rather than once up here, where it would have been
   * resolved against a signed-out user and always returned "/".
   */
  const rawNext = searchParams.get("next");

  /**
   * Supabase reports a refused or expired link as ?error=…, not by omitting
   * the code. Surfaced as a friendly reason rather than a blank failure.
   */
  const errorCode = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  if (errorCode) {
    console.warn("[auth] callback returned an error", { errorCode, errorDescription });
    return NextResponse.redirect(`${origin}/auth/error?reason=link`);
  }

  const supabase = createClient();

  /**
   * TWO LINK SHAPES, AND THE SECOND ONE IS NOT OPTIONAL.
   *
   * ?code= is the PKCE flow. exchangeCodeForSession pairs the code with a
   * verifier cookie that signInWithOtp set — IN THE BROWSER THAT ASKED. That
   * makes it strictly single-device: request the link on a laptop, open it on
   * the phone where the email actually is, and the verifier is absent, so it
   * fails. The visitor sees "that link didn't work" for a link that is
   * perfectly valid, and the more they retry the more it fails.
   *
   * Contractors read email on their phones. This would have been a steady
   * trickle of people unable to sign in, with nothing wrong in the logs.
   *
   * ?token_hash= (verifyOtp) carries no browser-bound state, so it works from
   * any device. Both are accepted; token_hash is checked first because when
   * Supabase sends it, it is the one that will succeed.
   */
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (tokenHash) {
    /**
     * `signup` is in this list because of the FIRST sign-in specifically.
     * With "Confirm email" ON, a contractor who has never signed in gets a
     * confirmation link carrying type=signup, not type=magiclink — verified
     * against the live project: generateLink's action_link had type=signup and
     * the same click both confirmed the address and created the session.
     *
     * Defaulting an unknown type to "magiclink" would have rejected exactly
     * one visitor: the brand-new contractor, on their very first attempt.
     */
    const { error } = await supabase.auth.verifyOtp({
      type:
        (type as "magiclink" | "signup" | "email" | "recovery" | "invite" | "email_change") ??
        "magiclink",
      token_hash: tokenHash,
    });
    if (error) {
      console.warn("[auth] verifyOtp failed", { status: error.status, message: error.message });
      return NextResponse.redirect(`${origin}/auth/error?reason=used`);
    }

    const { data: verified } = await supabase.auth.getUser();
    const next = await resolveLanding(rawNext, verified.user);
    return NextResponse.redirect(`${origin}${next}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/error?reason=missing`);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Single-use codes: a second click on the same link lands here. Common
    // enough that it deserves its own message rather than a generic failure.
    console.warn("[auth] code exchange failed", { status: error.status, message: error.message });
    return NextResponse.redirect(`${origin}/auth/error?reason=used`);
  }

  const { data: exchanged } = await supabase.auth.getUser();
  const next = await resolveLanding(rawNext, exchanged.user);
  return NextResponse.redirect(`${origin}${next}`);
}
