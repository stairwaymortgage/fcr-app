import "server-only";

import type { User } from "@supabase/supabase-js";

import { isAdmin } from "@/lib/auth";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

/**
 * Where someone lands after signing in, when they did not ask for anywhere.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS IS SEPARATE FROM safeNext() ON PURPOSE, AND THE SPLIT IS THE POINT.
 *
 * safeNext() answers "is this attacker-supplied path safe to visit". It returns
 * "/" both for an absent `next` and for a hostile one, which is correct for a
 * validator and useless for routing — the two cases are indistinguishable by
 * the time you have its answer.
 *
 * So the caller asks the question in the right order: was a `next` supplied at
 * all, and did it survive validation? If yes, honour it — an explicit
 * destination beats a computed one, and that is what makes requireUser()'s
 * bounce-and-return work. Only when there is no usable `next` does the role
 * decide, which is what resolveLanding() below implements.
 *
 * ⚠ A HOSTILE `next` FALLS BACK TO THE ROLE LANDING, NOT TO "/". Nothing is
 * gained by punishing the visitor for a link someone else composed, and "/" for
 * an admin is a public marketing page — a worse answer than their own console.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The role-derived destination. Assumes the session already exists — call it
 * AFTER the code exchange, never before.
 *
 * ADMIN IS CHECKED FIRST AND WITHOUT A QUERY. isAdmin() reads app_metadata off
 * the verified user, so the common case for the one person who signs in most
 * often costs nothing.
 */
export async function defaultLanding(user: User | null): Promise<string> {
  if (!user) return "/";

  if (isAdmin(user)) return "/admin/claims";

  /**
   * A contractor goes to the profile they manage.
   *
   * ⚠ ORDERED, BECAUSE A CONTRACTOR CAN HOLD SEVERAL LICENCES — the qualifying
   * agent behind Aceca holds three, and /manage is slug-scoped, so there is no
   * "all of them" page to land on. Ordering by claimed_at ascending means they
   * land on the FIRST profile they claimed, which is stable across sessions and
   * is the one they have had longest. An unordered query would return rows in
   * whatever order Postgres felt like, so the same person could land somewhere
   * different on consecutive sign-ins with nothing having changed.
   *
   * The header carries links to the others, and /manage/[slug]/settings lists
   * every profile they manage.
   */
  const db = createClient();
  const { data, error } = await db
    .from("contractors")
    .select("slug")
    .eq("claimed_by_user_id", user.id)
    .order("claimed_at", { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    /**
     * A failed lookup sends them to "/", which is the pre-2026-08-06 behaviour.
     * Never an error page: they have just signed in successfully, and the worst
     * acceptable outcome of "which page would you prefer" is the home page.
     */
    console.warn("[landing] could not resolve a managed profile", {
      code: error.code,
      message: error.message,
    });
    return "/";
  }

  return data?.slug ? `/manage/${data.slug}` : "/";
}

/**
 * The whole decision in one call: honour an explicit destination, otherwise
 * fall back to the role.
 *
 * `raw` is the untouched query-string value — pass it through unvalidated, this
 * function validates it. Passing an already-safeNext()-ed value would defeat
 * the check on the next line, because a hostile path has by then become "/" and
 * is indistinguishable from a real request for the home page.
 */
export async function resolveLanding(
  raw: string | null | undefined,
  user: User | null,
): Promise<string> {
  if (raw) {
    const validated = safeNext(raw);
    // safeNext returns "/" for anything it rejects. A genuine request for "/"
    // is also worth overriding with the role landing, so both collapse here.
    if (validated !== "/") return validated;
  }
  return defaultLanding(user);
}
