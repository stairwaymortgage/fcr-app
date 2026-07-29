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
  // rotated cookies via setAll above. Do not remove: this single call is the
  // entire purpose of the file.
  await supabase.auth.getUser();

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
   * NOTE: this middleware only REFRESHES sessions. It does not gate access.
   * Route protection for /admin/* and /manage/* is a separate concern; the
   * component docblocks describe the intended checks, and none of it is built
   * yet.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2)$).*)",
  ],
};
