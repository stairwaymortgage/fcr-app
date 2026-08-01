import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Session refresh middleware.
 *
 * THIS FILE IS WHAT MAKES lib/supabase/server.ts CORRECT. Server Components
 * cannot write cookies, so the setAll handler there catches and swallows the
 * error. That swallow is only safe because this middleware refreshes the
 * session on every request and writes the rotated cookies itself.
 *
 * Delete this file and nothing breaks immediately — which is the danger.
 * Sessions simply stop refreshing. Users appear signed in until their access
 * token expires, then get logged out mid-flow, with nothing in the logs
 * pointing back here. The failure surfaces in Week 5 during the claim flow and
 * traces to a file removed weeks earlier.
 *
 * Uses the ANON key. This does not grant privileges; it only refreshes
 * whatever session the request already carries.
 *
 * NEXT 14.2: cookies are read from the request and written to the response
 * directly. The getAll/setAll pair is the current @supabase/ssr API.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Missing config must not take the whole site down. Without these the
  // request simply passes through unauthenticated, which is the same state a
  // signed-out visitor is in. The clients in lib/supabase/ throw with a named
  // variable, so the misconfiguration is still reported loudly at the point
  // where it actually matters.
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Refreshes the session if the access token has expired and writes the
  // rotated cookies via setAll above. getUser and NOT getSession: getSession
  // decodes the cookie without verifying it, so its answer is whatever the
  // browser sent. Below, that difference is a security control.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  /**
   * ═════════════════════════════════════════════════════════════════════════
   * ROUTE GATING — DENY-LIST, NOT ALLOW-LIST.
   *
   * The site is public and must stay public. Homepage, search, contractor
   * profiles, county/city/type pages, all content and legal pages, and the
   * diagnostic are untouched by this block — a new public page is public
   * automatically, with no risk that someone forgets to exempt it.
   *
   * Only the prefixes below are gated. An allow-list would invert that risk:
   * one missed entry and a public page starts demanding a login.
   *
   * THIS IS NOT THE ONLY CHECK. Middleware is a redirect for humans, not a
   * security boundary — it does not run for Server Actions, and a matcher edit
   * silently disables it. Every protected page calls requireUser/requireAdmin,
   * and RLS refuses at the database. Three layers, deliberately.
   * ═════════════════════════════════════════════════════════════════════════
   */
  const path = request.nextUrl.pathname;

  const needsAdmin = path === "/admin" || path.startsWith("/admin/");
  const needsUser =
    needsAdmin ||
    path === "/dashboard" ||
    path.startsWith("/dashboard/") ||
    path === "/manage" ||
    path.startsWith("/manage/") ||
    path === "/inquiries" ||
    path.startsWith("/inquiries/") ||
    path === "/claim" ||
    path.startsWith("/claim/") ||
    /**
     * The claim form lives UNDER the public profile, at
     * /contractor/{slug}/claim — so it cannot be covered by a prefix like
     * everything else here, and a prefix of "/contractor/" would gate all
     * 266,305 public profile pages behind a login.
     *
     * Anchored at both ends: without the $ this also matches
     * /contractor/x/claim-something, and without the restricted slug class a
     * crafted path could widen it further.
     */
    /^\/contractor\/[a-z0-9-]+\/claim$/.test(path);

  if (needsUser && !user) {
    const login = new URL("/login", request.url);
    // Path plus query only — never the origin, so this cannot be reflected
    // back out as an absolute URL. The callback re-validates it regardless.
    login.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  /**
   * Admin is read from app_metadata, never user_metadata — user_metadata is
   * writable by the account itself. See lib/auth.ts for the full reasoning and
   * db/migrations/20260801_fix_is_admin.sql for the database side.
   *
   * Rewritten to the 404 rather than redirected: /admin should not confirm it
   * exists to a signed-in contractor who guessed the URL.
   */
  if (needsAdmin && user) {
    const role = (user.app_metadata as Record<string, unknown> | null)?.role;
    if (role !== "admin") {
      return NextResponse.rewrite(new URL("/not-found", request.url));
    }
  }

  return response;
}

export const config = {
  /**
   * Run on everything except static assets and image files.
   *
   * Auth routes are NOT excluded — /manage/*, /inquiries and /admin/* need the
   * refresh most. This matcher is about skipping requests that carry no
   * session, not about skipping protected paths.
   *
   * This middleware refreshes sessions AND gates /dashboard, /admin, /manage,
   * /inquiries and /claim.
   *
   * ⚠ THE MATCHER IS NOT THE GATE, AND MUST NOT BECOME IT. It decides where
   * this function RUNS — deliberately almost everywhere, because session
   * refresh is for everyone including signed-in visitors browsing public pages.
   * Which paths require a login is decided in the body, by an explicit
   * deny-list.
   *
   * Narrowing this matcher to the protected paths would look like a tidy-up and
   * would silently stop refreshing sessions for everyone else — the exact
   * failure the docblock at the top of this file describes. Conversely, moving
   * the gate INTO the matcher would put the whole public site one regex slip
   * away from requiring a login.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2)$).*)",
  ],
};
