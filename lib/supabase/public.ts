import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Anon Supabase client with NO cookie dependency — for public reads only.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS EXISTS SO A ROUTE CAN BE STATICALLY RENDERED. THAT IS ITS WHOLE JOB.
 *
 * lib/supabase/server.ts calls cookies() to carry the session. Reading cookies
 * opts a route into DYNAMIC rendering in the Next App Router — permanently, and
 * silently. Six listing routes had `export const revalidate = 86400` declared
 * and every one of them still built as ƒ (Dynamic), because createClient()
 * reached for cookies() somewhere in the render. The revalidate directive was
 * dead code from the day it was written.
 *
 * There is nothing to fix in server.ts: it is correct for what it does. The
 * error was using a session-carrying client for reads that have no session to
 * carry.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ IDENTICAL REACH, NOT ELEVATED REACH. This uses the same anon key and is
 * subject to the same RLS policies. On a public page with no signed-in user,
 * server.ts's client already behaves exactly like this one — the difference is
 * that this one cannot see a session, not that it can see more.
 *
 *   "public read contractors"  SELECT  {anon,authenticated}  USING (true)
 *
 * ⚠ SO IT MUST NEVER BE USED WHERE THE ANSWER DEPENDS ON WHO IS ASKING.
 *
 * Any read whose result changes with the viewer — /manage, /inquiries, the claim
 * pages, anything behind requireUser(), anything an admin sees more of — MUST
 * keep using lib/supabase/server.ts. With this client those queries do not
 * error; they silently return the anon view, which is the worst possible
 * failure: a contractor's own inbox rendering as empty rather than as forbidden.
 *
 * If you are unsure which to use, the test is not "is this page public" but "if
 * two different people load this, must they see different bytes?". If yes, use
 * server.ts.
 *
 * SAFE TODAY FOR: the county / city / type listings, the browse indexes, the
 * reference tables, and data-as-of — all of which serve identical bytes to
 * everyone and are already cached publicly by definition.
 *
 * NOT A SINGLETON, for the same reason server.ts is not: @supabase/ssr and
 * supabase-js both hold per-instance state, and a module-level client shared
 * across concurrent requests is a category of bug not worth the allocation
 * saved. This one has no session to leak, but the habit is what matters.
 */
export function createPublicClient() {
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

  return createSupabaseClient(url, anonKey, {
    auth: {
      /**
       * All three off deliberately. There is no session here by design, and
       * leaving these on makes the client try to read and write one — which on
       * the server means touching storage that does not exist, and defeats the
       * point of the module.
       */
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
