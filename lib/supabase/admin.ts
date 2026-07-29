import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — SERVER ONLY. BYPASSES ROW LEVEL SECURITY.
 *
 * This client can read and write every row in every table regardless of
 * policy. It is the most dangerous module in the repository. If the key it
 * holds reaches a browser bundle, every visitor gains full read/write access
 * to the leads table (PII), the claims table (government ID references) and
 * all 266,305 contractor rows.
 *
 * USE IT ONLY WHERE RLS GENUINELY CANNOT WORK:
 *   - inserting leads from the diagnostic form. 03_rls_policies.sql:
 *     "Inserts from server-side (using service-role key) bypass RLS by
 *     design. Form submissions go through a Next.js API route that uses
 *     service-role."
 *   - the DBPR weekly sync, which writes contractors with no user session
 *   - admin operations that must act across users
 *
 * DO NOT reach for this because a query returned nothing. An empty result from
 * lib/supabase/server.ts usually means RLS is working correctly; reaching for
 * service-role to "fix" it removes the protection instead of the bug.
 *
 * ---------------------------------------------------------------------------
 * THREE GUARDS, EACH CATCHING A DIFFERENT FAILURE
 *
 * 1. import "server-only"      BUILD TIME. If any Client Component imports
 *                              this module, the build fails with an explicit
 *                              error. The bundle never gets created. This is
 *                              the primary protection.
 *
 * 2. typeof window check       RUNTIME. Catches paths the bundler cannot see:
 *                              a plain .mjs script, a route that becomes
 *                              "use client" through a transitive import, or a
 *                              bundler edge case. Fails loudly instead of
 *                              leaking quietly.
 *
 * 3. NEXT_PUBLIC_ assertion    THE ONE THAT MATTERS MOST, and the only one
 *                              that catches the realistic accident. Guards 1
 *                              and 2 both assume the key stays in a
 *                              server-only variable. The actual mistake a
 *                              developer makes is hitting "undefined env var",
 *                              renaming it to NEXT_PUBLIC_SUPABASE_SERVICE_-
 *                              ROLE_KEY because that is how the other Supabase
 *                              vars are named, and shipping. Next.js inlines
 *                              every NEXT_PUBLIC_ variable into the client
 *                              bundle at build time, so the master key is then
 *                              served to every visitor — with this module
 *                              still correctly server-only and both other
 *                              guards still passing.
 * ---------------------------------------------------------------------------
 */

// Guard 2 — runtime backstop.
if (typeof window !== "undefined") {
  throw new Error(
    "lib/supabase/admin.ts was loaded in a browser context. This module holds " +
      "the service-role key, which bypasses Row Level Security. It must never " +
      "be imported from a Client Component or any browser-reachable path. Use " +
      "lib/supabase/client.ts in the browser, or lib/supabase/server.ts in a " +
      "Server Component.",
  );
}

// Guard 3 — a service-role key must never live under a NEXT_PUBLIC_ name.
const publiclyExposedServiceKeys = Object.keys(process.env).filter(
  (name) => name.startsWith("NEXT_PUBLIC_") && /SERVICE_ROLE/i.test(name),
);
if (publiclyExposedServiceKeys.length > 0) {
  throw new Error(
    `A service-role key is exposed under a NEXT_PUBLIC_ name: ` +
      `${publiclyExposedServiceKeys.join(", ")}. Next.js inlines every ` +
      `NEXT_PUBLIC_ variable into the client bundle at build time, so this key ` +
      `is being served to every visitor and grants full RLS-bypassing access ` +
      `to leads, claims and contractors. Rename it to ` +
      `SUPABASE_SERVICE_ROLE_KEY (no prefix) and rotate the key in Supabase → ` +
      `Project Settings → API, because it must be assumed compromised.`,
  );
}

/**
 * A FACTORY, NOT A SINGLETON — consistent with the other two clients, and it
 * keeps each call site's usage independently traceable.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is not set. Add it to .env.local and to the " +
        "Vercel project (all environments).",
    );
  }
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local and to the " +
        "Vercel project as a SERVER-ONLY variable. Do NOT prefix it with " +
        "NEXT_PUBLIC_ — that would inline it into the client bundle.",
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      // A service-role client represents no user, so it must never write a
      // session cookie or try to refresh a token. Leaving these on can persist
      // service-role credentials into a cookie store.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
