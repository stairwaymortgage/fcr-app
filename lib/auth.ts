import "server-only";

import { notFound, redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

/**
 * Auth helpers. The single place the app decides who someone is.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADMIN IS READ FROM app_metadata, NEVER user_metadata.
 *
 * user_metadata is writable by the account itself:
 * `supabase.auth.updateUser({ data: { role: 'admin' } })` succeeds with the
 * public anon key. Trusting it means any signed-up visitor is an admin.
 *
 * That was the live definition of the SQL is_admin() until 2026-08-01, and it
 * was demonstrably exploitable — a throwaway account read every row of leads
 * after one updateUser call. db/migrations/20260801_fix_is_admin.sql fixes the
 * database side; this file is the application side of the same rule, and the
 * two must not diverge.
 *
 * app_metadata can only be written with the service-role key, so a role claim
 * there is an assertion by us rather than by the user.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * getUser, NEVER getSession.
 *
 * getSession reads the cookie and decodes it without contacting the auth
 * server — the payload is whatever the browser sent. getUser verifies the JWT.
 * For a page that merely renders a name the difference is cosmetic; for one
 * that gates access it is the entire control.
 */
export async function getUser(): Promise<User | null> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}

export function isAdmin(user: User | null): boolean {
  if (!user) return false;
  return (user.app_metadata as Record<string, unknown> | null)?.role === "admin";
}

/**
 * Require any signed-in user, or bounce to the login page.
 *
 * `next` is preserved so the visitor lands where they were going. See
 * safeNext() in app/auth/callback/route.ts for why it is validated there
 * rather than trusted.
 */
export async function requireUser(next?: string): Promise<User> {
  const user = await getUser();
  if (!user) {
    redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  }
  return user;
}

/**
 * Require an admin.
 *
 * EVERY non-admin gets 404 — signed in or not. Not 403, and not a login
 * redirect: both of those confirm the route exists, and "/admin/claims wants a
 * login" tells an attacker precisely what to phish for. A 404 is the same
 * answer a nonexistent path gives.
 *
 * That means a SIGNED-OUT ADMIN also gets 404 and has to visit /login first.
 * Deliberate, and matched by the same rule in middleware.ts — the two must
 * agree, or the middleware 404s a page that would have redirected.
 */
export async function requireAdmin(): Promise<User> {
  const user = await getUser();
  // notFound() is typed `never`, so this narrows `user` for the return below.
  if (!user || !isAdmin(user)) notFound();
  return user;
}
