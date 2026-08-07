import "server-only";

import { cache } from "react";

import { createPublicClient } from "@/lib/supabase/public";

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
 * descending sort is the maximum.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ DO NOT ADD nullsFirst: false BACK. IT COST 1,660 ms ON EVERY PAGE.
 *
 * It was here until 2026-08-07 as "belt-and-braces for the day that column
 * becomes nullable". It was the single largest component of TTFB across the
 * entire site — every route, including all 266,305 profiles and /search, because
 * Header and Footer both call this.
 *
 * WHY IT IS SO EXPENSIVE. idx_contractors_last_sync is a default btree, which is
 * ASC NULLS LAST; walked backwards that is DESC NULLS FIRST. So `DESC NULLS
 * LAST` does not match the index ordering in either direction, and Postgres
 * cannot walk-and-stop — it scans all 266,305 rows and sorts them to return one.
 * Measured on the live table:
 *
 *   ORDER BY last_dbpr_sync_at DESC NULLS LAST LIMIT 1
 *     Gather Merge -> Sort -> Parallel Index Only Scan, Heap Fetches: 196191
 *     Execution Time: 1660.882 ms
 *
 *   ORDER BY last_dbpr_sync_at DESC LIMIT 1            <- what ships now
 *     Index Only Scan Backward, Heap Fetches: 1
 *     Execution Time: 0.823 ms
 *
 * A 2,000x difference from one parameter. And the guard was never doing
 * anything: the column is NOT NULL, verified against information_schema.
 *
 * IF IT EVER DOES BECOME NULLABLE, this needs `.not("last_dbpr_sync_at", "is",
 * null)` — a filter, which the index can serve — NOT a nulls-ordering hint.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is a PUBLIC read — "public read contractors" serves it to anon — so no
 * elevated client is involved and no session is required.
 */
export const dataAsOf = cache(async (): Promise<string> => {
  try {
    /**
     * THE COOKIE-FREE CLIENT, AND THAT IS WHAT MAKES ISR POSSIBLE AT ALL.
     *
     * Header and Footer call this, so it runs on every route. While it used
     * lib/supabase/server.ts it read cookies, and reading cookies opts a route
     * into dynamic rendering — which is why six listing routes carried
     * `export const revalidate = 86400` and every one of them still built as ƒ.
     * Switching the pages alone would not have helped; this function would have
     * dragged them back.
     *
     * Safe because the value is identical for every visitor: the newest
     * last_dbpr_sync_at in a world-readable table. Nothing here depends on who
     * is asking. See lib/supabase/public.ts for when that reasoning does NOT
     * hold.
     */
    const db = createPublicClient();
    const { data, error } = await db
      .from("contractors")
      .select("last_dbpr_sync_at")
      .order("last_dbpr_sync_at", { ascending: false })
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
     * ⚠ THE ORIGINAL REASON FOR THIS GUARD IS GONE AS OF 2026-08-07, AND THE
     * GUARD STAYS. It was here because cookies() inside createClient() throws
     * DYNAMIC_SERVER_USAGE during static generation — Next's way of signalling
     * "this route is dynamic" — and an earlier version of this catch treated
     * that as a database failure, which would have baked the fallback date
     * permanently into any route whose only dynamic dependency was this
     * function.
     *
     * This function no longer reads cookies (see createPublicClient above), so
     * that specific throw can no longer originate here. The digest re-throw is
     * kept regardless: notFound() and redirect() use the same mechanism, a
     * future caller may reintroduce a dynamic dependency, and a catch-all that
     * swallows Next's control flow is a trap whichever way it is reached.
     *
     * redirect() and notFound() use the same mechanism, so the digest check
     * covers them: neither is thrown from here today, and neither should ever
     * be caught by a helper that does not own the routing decision.
     */
    const digest = (err as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string") throw err;

    // A genuine failure: createPublicClient() throws when the env vars are missing,
    // which is a build or deploy misconfiguration rather than a request-time
    // fault. The chrome should still render so the page's real error is visible.
    console.error("[data-as-of] unavailable", err);
    return FALLBACK;
  }
});
