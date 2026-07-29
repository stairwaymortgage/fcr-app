import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client — for Client Components only.
 *
 * Uses the ANON key, so every query is subject to Row Level Security. That is
 * the point: this client runs in the visitor's browser and its key is visible
 * in the page source. It is safe to expose precisely because RLS decides what
 * it can reach.
 *
 * What that means in practice, from 03_rls_policies.sql:
 *   contractors  SELECT allowed to anon  ("public read contractors")
 *   leads        NO anon access at all   ("leads contain PII")
 *   claims       admin only
 *
 * So a browser client can read the directory and nothing else. Anything
 * needing more — inserting a lead, reading claims, admin work — goes through a
 * server route using lib/supabase/admin.ts. Never reach for the service-role
 * key to "make a client query work"; if a query is blocked here, RLS is doing
 * its job.
 *
 * A FACTORY, NOT A SINGLETON. Each call returns a fresh client. Module-level
 * singletons leak auth state between users under React strict mode and during
 * fast refresh.
 *
 * Server Components must use lib/supabase/server.ts instead — this one cannot
 * see the session cookie.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Fail loudly at construction rather than letting the client build with
  // `undefined` and surface later as an opaque 401 from PostgREST.
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

  return createBrowserClient(url, anonKey);
}
