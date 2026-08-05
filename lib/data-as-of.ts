import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

/**
 * "Data as of …" — the date every public page shows for the registry.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DERIVED, NO LONGER DECLARED. This replaces the DATA_AS_OF constant that sat
 * in lib/registry-stats.ts, plus two independent copies of the same literal in
 * app/not-found.tsx and components/ContentPageLayout.tsx. Three hard-coded
 * strings reading "May 24, 2026" is three chances to update two of them.
 *
 * ⚠ THE DATE THIS RETURNS IS WHEN WE IMPORTED, NOT WHEN DBPR PUBLISHED, AND
 * THOSE ARE DIFFERENT CLAIMS.
 *
 *   max(last_dbpr_sync_at)   2026-07-29   <- this function
 *   the extract's own date   2026-05-22   embedded in every dbpr_sync_key
 *   what the mockups said    2026-05-24   the string that used to ship
 *
 * The mockups' May 24 matched neither. It was chosen because the mockups said
 * so, which is the weakest reason a date on a public page can have.
 *
 * The wording each surface carries has been checked against this meaning:
 * Header's "Data as of X" and Footer's "Last refresh: X" are both true of an
 * import date. The two places on the contractor profile that read "the extract
 * DATED X" were not, and were reworded rather than left to quietly misdescribe
 * the source — an extract published in May does not become a May 24 document
 * because we loaded it in July.
 *
 * If the extract's own publication date is ever wanted on screen, it is a
 * different value from a different source and it needs its own function. Do not
 * repoint this one.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ ANY WRITE TO contractors.last_dbpr_sync_at MOVES THIS DATE ON EVERY PUBLIC
 * PAGE. In particular `node scripts/import-dbpr.mjs --limit 20` stamps the rows
 * it touches with now(), which would advance the site's "data as of" on the
 * strength of twenty rows. That script's docblock carries the same warning;
 * this is the other end of it.
 */

/**
 * Rendered when the query fails or the table is empty.
 *
 * NOT "May 24, 2026". A fallback exists so that a database hiccup degrades the
 * chrome instead of throwing a 500 on every route — but a fallback that states
 * a date nothing ever happened on is a lie told automatically. This is the last
 * import verified against the live project (2026-07-29, 266,305 rows), so the
 * degraded path says something stale and true rather than something invented.
 *
 * Update it when a refresh actually lands. It should never be ahead of reality.
 */
const FALLBACK = "July 29, 2026";

/**
 * Formatted in EASTERN TIME, not the server's zone.
 *
 * Vercel runs UTC and a developer machine does not, so an unpinned format
 * renders a different date on either side of local midnight for the same
 * timestamp. Eastern is the right zone rather than merely a fixed one: this is
 * a Florida registry, and "data as of" is read by people in that state.
 */
function format(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

/**
 * The newest last_dbpr_sync_at in the contractors table, as "July 29, 2026".
 *
 * ONE QUERY PER REQUEST, NOT PER CALL SITE. React's cache() dedupes within a
 * single render pass, which matters because a page can reach this twice — once
 * for Header and once for Footer — and every content page reaches it through
 * ContentPageLayout as well.
 *
 * Ordered-and-limited rather than an aggregate: PostgREST has no max(), and
 * last_dbpr_sync_at is NOT NULL on all 266,305 rows, so the first row of a
 * descending sort is the maximum. nullsFirst:false is belt-and-braces for the
 * day that column becomes nullable.
 *
 * This is a PUBLIC read — "public read contractors" serves it to anon — so no
 * elevated client is involved and no session is required.
 */
export const dataAsOf = cache(async (): Promise<string> => {
  try {
    const db = createClient();
    const { data, error } = await db
      .from("contractors")
      .select("last_dbpr_sync_at")
      .order("last_dbpr_sync_at", { ascending: false, nullsFirst: false })
      .limit(1);

    if (error) {
      console.error("[data-as-of] query failed", error.message);
      return FALLBACK;
    }
    const newest = data?.[0]?.last_dbpr_sync_at;
    return newest ? format(newest) : FALLBACK;
  } catch (err) {
    /**
     * ⚠ NEXT'S CONTROL-FLOW ERRORS MUST BE RE-THROWN, NOT SWALLOWED.
     *
     * cookies() inside createClient() throws a DYNAMIC_SERVER_USAGE error
     * during static generation. That is not a fault — it is how Next signals
     * "this route is dynamic", and it is meant to propagate so the route gets
     * marked ƒ instead of ○.
     *
     * The first version of this catch treated it as a database failure and
     * returned FALLBACK, which printed "[data-as-of] unavailable" for every
     * route on every build. Nothing user-visible broke, because every route
     * here reads cookies elsewhere too and was marked dynamic anyway — but a
     * route whose ONLY dynamic dependency was this function would have been
     * rendered STATIC with the fallback date baked into it permanently. That is
     * the exact failure this module exists to remove.
     *
     * redirect() and notFound() use the same mechanism, so the digest check
     * covers them: neither is thrown from here today, and neither should ever
     * be caught by a helper that does not own the routing decision.
     */
    const digest = (err as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string") throw err;

    // A genuine failure: createClient() throws when the env vars are missing,
    // which is a build or deploy misconfiguration rather than a request-time
    // fault. The chrome should still render so the page's real error is visible.
    console.error("[data-as-of] unavailable", err);
    return FALLBACK;
  }
});
