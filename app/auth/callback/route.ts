import { NextResponse, type NextRequest } from "next/server";

import { safeNext } from "@/lib/safe-next";
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
 */


export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

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

  return NextResponse.redirect(`${origin}${next}`);
}
