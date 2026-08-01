"use server";

import { headers } from "next/headers";
import { z } from "zod";

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

const Schema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  /** Where to land after the link is clicked. Validated in the callback. */
  next: z.string().max(300).optional().or(z.literal("")),
  /** Hidden field. Bots fill it; people cannot see it. */
  website: z.string().max(0),
});

export type LoginResult = { ok: boolean; error?: string };

export async function sendMagicLink(input: unknown): Promise<LoginResult> {
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

  const callback = new URL("/auth/callback", origin);
  if (next) callback.searchParams.set("next", next);

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
