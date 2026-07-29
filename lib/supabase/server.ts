import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server Supabase client — for Server Components, Route Handlers and Server
 * Actions.
 *
 * Uses the ANON key and the request's session cookie, so RLS applies with the
 * signed-in user's identity. That is what makes the policies in
 * 03_rls_policies.sql evaluate correctly:
 *
 *   "contractor updates own profile"  claimed_by_user_id = auth.uid()
 *   "admin full access contractors"   is_admin()  reads the JWT
 *
 * NOT A PRIVILEGED CLIENT. A common misreading is that "server client" means
 * elevated rights. It does not. On a public page with no session this has
 * exactly the same reach as the browser client — anon. The difference is that
 * it carries the session, not that it carries more power. Work that must
 * bypass RLS (inserting a lead, admin writes) uses lib/supabase/admin.ts, and
 * that choice should always be deliberate.
 *
 * A FACTORY, NOT A SINGLETON. @supabase/ssr requires a fresh instance per
 * request; a module-level client would serve one user's session to another.
 *
 * NEXT 14.2: cookies() is synchronous here. It becomes async in Next 15 — on
 * upgrade this needs `const cookieStore = await cookies()` and the function
 * becomes async, which ripples to every caller.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is not set. Add it to .env.local and to the " +
        "Vercel project (all environments).",
    );
  }
  if (!anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. Add it to .env.local and to " +
        "the Vercel project (all environments). It is the publishable key " +
        "from Supabase → Project Settings → API, NOT the service-role key.",
    );
  }

  const cookieStore = cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies, so this throws there.
          //
          // SWALLOWING IT IS ONLY CORRECT BECAUSE middleware.ts REFRESHES THE
          // SESSION ON EVERY REQUEST. Delete or disable that middleware and
          // this catch silently stops sessions from refreshing: users appear
          // signed in until their token expires, then get logged out
          // mid-flow, with nothing in the logs pointing here.
          //
          // The getAll/setAll pair is the current @supabase/ssr API. The older
          // get/set/remove triple is deprecated.
        }
      },
    },
  });
}
