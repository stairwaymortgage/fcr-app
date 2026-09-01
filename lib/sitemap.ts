import "server-only";

import { absoluteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { TEST_ROW_LIKE, excludeTestRows } from "@/lib/test-rows";

/**
 * Sitemap generation — 266,305 profiles plus the browse and content pages.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A SITEMAP INDEX AND SEVEN CHILD FILES, BECAUSE ONE FILE CANNOT HOLD THIS.
 * The sitemaps.org limit — enforced by Google — is 50,000 URLs and 50MB
 * uncompressed per file. 266,305 profiles need six, and the browse and content
 * pages get a seventh so they are not buried behind a quarter of a million
 * profile URLs.
 *
 * ROUTE HANDLERS RATHER THAN Next's generateSitemaps(). The convention-based
 * helper emits a URL shape that has moved between Next versions, and the one
 * thing a sitemap must be is a set of URLs that actually resolve. These routes
 * emit exactly what the index advertises, and it is checkable by fetching them.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** sitemaps.org's per-file ceiling. Not a tuning knob. */
export const URLS_PER_SITEMAP = 50_000;

/**
 * PostgREST's own page ceiling — asking for more silently truncates.
 *
 * ⚠ THIS IS A SERVER LIMIT, NOT A PREFERENCE, AND IT WAS RE-VERIFIED ON
 * 2026-09-01 BEFORE AN ATTEMPT TO RAISE IT. Against the live project, as anon:
 *
 *   Range: 0-999    ->  Content-Range: 0-999/*   1000 rows
 *   Range: 0-9999   ->  Content-Range: 0-999/*   1000 rows   ← capped
 *   ?limit=10000    ->                           1000 rows   ← capped
 *
 * Supabase enforces db-max-rows = 1000. The cap is reported in Content-Range
 * but supabase-js does NOT throw on it, so raising this constant does not fail
 * — it silently returns a tenth of the rows. At DB_PAGE = 10_000 the loop below
 * would build five offsets instead of fifty and each would come back with 1,000
 * rows, so a chunk would advertise 5,000 URLs instead of 50,000 and Google
 * would read the missing 45,000 as de-listed. Nothing would error.
 *
 * Do not raise this without first re-running the check above. If Supabase's
 * db-max-rows is ever raised on the project, this constant can follow it and
 * not before.
 */
const DB_PAGE = 1_000;

/**
 * Hard ceiling on the chunk index, checked before any query runs.
 *
 * Replaces the exact count that used to bound `chunk` — see contractorSitemap.
 * 40 x 50,000 = 2,000,000 profiles, roughly seven times the current 271,050, so
 * it will not bind on growth; its job is to stop /sitemaps/contractors-999.xml
 * from reaching the database at all. The route's own regex allows three digits,
 * which without this would be 1,000 reachable URLs each running the deepest
 * possible page queries.
 */
const MAX_CHUNKS = 40;

/** Concurrent slug pages. Fifty sequential round trips is a slow cold request. */
const CONCURRENCY = 6;

/**
 * Static and browse URLs. Counties, cities and types are read live so a new
 * reference row appears without anyone remembering this file exists.
 */
const STATIC_PATHS = [
  "/",
  "/counties",
  "/cities",
  "/types",
  /**
   * /contractors was here until 2026-08-07. It now 308s to /join (see
   * next.config.mjs), and a URL that redirects must not be in a sitemap — it
   * tells Google the canonical address is one that is not.
   *
   * /join does NOT replace it, deliberately: that page is robots noindex, being
   * a form flow with nothing to rank for, and listing a noindexed URL is the
   * same contradiction pointing the other way.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * ⚠ EVERY PATH IN THIS LIST MUST BE INDEXABLE. /search AND /diagnostic WERE
   * NOT, AND HAVE BEEN REMOVED (2026-08-08, approved).
   *
   * Both set robots noindex in their own metadata and were listed here anyway —
   * the sitemap asking Google to crawl a URL the page then tells it to drop.
   * The note that used to sit here flagged /diagnostic and MISSED /search,
   * which is the tell: a prose warning next to a list does not scale, because
   * the next reader checks the item the comment names and not the other
   * fourteen. The 2026-08-08 audit found /search by reading the list against
   * each page's robots value rather than against this comment.
   *
   * /search was the worse of the two: thin, duplicative, infinite in number, and
   * competing with the county and type pages that are meant to rank.
   *
   * THE RULE, NOT THE INSTANCE: before adding a path here, open the page and
   * check its `robots`. If it is noindex, it does not belong in a sitemap.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  "/contact",
  "/about",
  "/sources",
  "/verify",
  "/permits",
  "/complaint",
  "/hiring-checklist",
  "/terms",
  "/privacy",
  "/cookies",
  "/dmca",
  "/sms-terms",
  "/featured-terms",
] as const;

/**
 * ⚠ NO <lastmod>, ANYWHERE, AND THAT IS DELIBERATE.
 *
 * The only timestamps available are last_dbpr_sync_at — identical across every
 * row and moving on every refresh — and updated_at, which the importer does not
 * maintain. Stamping the sync date would tell Google that all 266,305 profiles
 * changed simultaneously every week, which is both false and actively harmful:
 * it burns crawl budget re-fetching a quarter of a million unchanged pages and
 * teaches the crawler that our lastmod means nothing.
 *
 * Google ignores <changefreq> and <priority> outright, so those are absent too.
 * A sitemap that says only "these URLs exist" is the honest one.
 */
function urlset(paths: string[]): string {
  const urls = paths
    .map((p) => `  <url><loc>${escapeXml(absoluteUrl(p))}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** How many contractor rows there are, and therefore how many child files. */
export async function contractorSitemapCount(): Promise<number> {
  const db = createClient();
  /**
   * ⚠ THIS PREDICATE MUST MATCH contractorSitemapChunk's EXACTLY. The count
   * decides how many child files the index advertises and the chunk query fills
   * them; if one excludes a row the other includes, the last chunk either 404s
   * or silently drops URLs. Both carry .not(slug is null) and both exclude
   * synthetic rows — change one, change the other.
   */
  const { count, error } = await excludeTestRows(
    db
      .from("contractors")
      .select("dbpr_sync_key", { count: "exact", head: true })
      .not("slug", "is", null),
  );
  if (error) throw new Error(`sitemap count: ${error.message}`);
  return Math.max(1, Math.ceil((count ?? 0) / URLS_PER_SITEMAP));
}

/**
 * The index. Lists the pages file and one entry per contractor chunk.
 */
export async function sitemapIndex(): Promise<string> {
  const chunks = await contractorSitemapCount();
  const children = [
    absoluteUrl("/sitemaps/pages.xml"),
    ...Array.from({ length: chunks }, (_, i) => absoluteUrl(`/sitemaps/contractors-${i}.xml`)),
  ];
  const entries = children
    .map((loc) => `  <sitemap><loc>${escapeXml(loc)}</loc></sitemap>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>\n`;
}

/** Static pages plus every county, city and licence-type index. */
export async function pagesSitemap(): Promise<string> {
  const db = createClient();
  const [counties, cities, types] = await Promise.all([
    db.from("reference_counties").select("county_slug"),
    db.from("reference_cities").select("city_slug"),
    db.from("reference_license_types").select("type_code"),
  ]);

  const paths: string[] = [...STATIC_PATHS];
  for (const c of counties.data ?? []) paths.push(`/county/${c.county_slug}`);
  for (const c of cities.data ?? []) paths.push(`/city/${c.city_slug}`);
  /**
   * Lowercased because /type/[code] lowercases the segment when building links
   * and uppercases it for the lookup. A sitemap listing /type/CGC would
   * advertise a URL that resolves but differs in case from every internal link
   * — two URLs for one page, which is the duplicate-content problem a sitemap
   * exists to avoid.
   */
  for (const t of types.data ?? []) paths.push(`/type/${String(t.type_code).toLowerCase()}`);

  return urlset(paths);
}

/**
 * One chunk of contractor profile URLs.
 *
 * Ordered by slug, which is UNIQUE and NOT NULL on all 266,305 rows (verified
 * 2026-08-05). Ordering is not decoration: PostgREST gives no stability
 * guarantee for an unordered range, so paging without it can return a row twice
 * and skip another — in a sitemap that means one URL advertised twice and one
 * never advertised at all.
 */
export async function contractorSitemap(chunk: number): Promise<string | null> {
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * NO EXACT COUNT HERE ANY MORE. Removed 2026-09-01.
   *
   * This used to open with `await contractorSitemapCount()` and 404 any chunk
   * at or beyond the total. That count is an exact count(*) over 271,050 rows
   * behind a NOT LIKE filter — MEASURED AT 1,349 ms (parallel index-only scan,
   * 13,611 heap fetches) — and it ran on EVERY chunk request purely to decide
   * whether the chunk existed. Generating chunk N's URLs never needed it.
   *
   * WHAT REPLACES IT — a bounded check that issues no query at all, plus the
   * result itself. Both halves are needed:
   *
   *   MAX_CHUNKS   rejects an absurd chunk index for free, before any I/O.
   *   empty result rejects a chunk that is merely beyond today's data.
   *
   * WHY NOT SIMPLY RENDER AN EMPTY urlset for an out-of-range chunk: the route
   * above is explicit that a sitemap URL which 200s with the wrong content is
   * worse than one that does not exist, and an empty urlset for a chunk Google
   * has previously seen populated reads as "every URL in here is gone". A 404
   * says "come back", which is what the old count-based guard said too. This
   * preserves that behaviour exactly.
   *
   * ⚠ CHUNK 0 IS EXEMPT from the empty-result rule, deliberately. The old guard
   * used Math.max(1, ceil(count / URLS_PER_SITEMAP)), so chunk 0 was valid even
   * against an empty table and rendered an empty urlset. Dropping that exemption
   * would turn an empty contractors table from "a sitemap with no URLs" into
   * "the sitemap is missing", which is a different and worse signal.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  if (!Number.isInteger(chunk) || chunk < 0 || chunk >= MAX_CHUNKS) return null;

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * SERVICE ROLE HERE, AND ONLY HERE. Changed 2026-09-01 to stop an
   * intermittent 500. This is the one client swap in this file — the count
   * above and pagesSitemap() below both still use the anon client.
   *
   * THE BUG IT FIXES, mechanism confirmed from production logs:
   *
   *   [sitemap] contractors-5.xml failed Error: sitemap chunk 5 at 254000:
   *     canceling statement due to statement timeout
   *       at async Promise.all (index 4)
   *
   * The six queries of the FIRST batch launch together — the stack traces name
   * indices 3 and 4 — and six simultaneous deep-OFFSET scans contend enough
   * that one crosses anon's statement_timeout of 3s. PostgREST returns 57014,
   * the `throw` below rejects Promise.all, the remaining ~45 queries are
   * abandoned, and the route catch returns 500 "Sitemap unavailable". Measured
   * amplification on the same offsets: 0.58-0.74s run sequentially, 1.11-1.40s
   * at six-way concurrency. Under production load that clears 3s.
   *
   *   anon            statement_timeout = 3s    ← what was failing
   *   authenticated                     = 8s
   *   service_role                      = 120s  ← 40x the headroom
   *
   * ⚠ THE FAST RESPONSE WAS THE FAILURE, which is what made this easy to
   * misread: a failing chunk 5 returned in ~4s (aborted in the first batch)
   * against ~8s for a successful one. It also returned 19 bytes — the length of
   * "Sitemap unavailable", NOT an empty urlset, which is 111 bytes. The route's
   * "never serve an empty urlset" contract held throughout; Google saw a 500
   * and a retry instruction, never a de-listing signal.
   *
   * ⚠ 14661c1 MADE THIS MORE LIKELY, WHICH IS WORTH KNOWING RATHER THAN
   * FORGETTING. Removing the 1,349 ms exact count from the top of this function
   * also removed the serial delay that had been staggering the six-way burst.
   * That commit is still right — the count was pure waste — but it is why the
   * 500s became noticeable when they did.
   *
   * ⚠ WHY THIS IS NOT A PRIVILEGE ESCALATION, and the check to repeat if the
   * query below ever changes: it selects ONE column, `slug`, from a table whose
   * RLS policy is already "public read contractors" SELECT to {anon,
   * authenticated} USING (true). Every row it returns is a URL we are actively
   * asking Google to crawl. Bypassing RLS here grants access to nothing that
   * was not already public. If this query is ever widened to another column or
   * table, that reasoning has to be redone — service-role does not re-check it.
   *
   * ⚠ THE REAL COST, STATED: a service-role query may hold a pooler connection
   * for up to 120s instead of being cut at 3s, and six run at once. On
   * 2026-09-01 pooler saturation is exactly what turned a crawler into a 13x
   * billing event. The trade is accepted because the alternative — a sitemap
   * that intermittently 500s — is a live SEO defect, and because these chunks
   * are CDN-cached and fetched by crawlers rather than by users. It is a trade,
   * not a free win.
   *
   * createAdminClient() throws if SUPABASE_SERVICE_ROLE_KEY is missing rather
   * than degrading to anon, so a misconfigured environment fails loudly here
   * instead of quietly reinstating the 3s ceiling this change exists to escape.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  const db = createAdminClient();
  const start = chunk * URLS_PER_SITEMAP;
  const offsets: number[] = [];
  for (let o = 0; o < URLS_PER_SITEMAP; o += DB_PAGE) offsets.push(start + o);

  const pages = await mapLimit(offsets, CONCURRENCY, async (from) => {
    const { data, error } = await db
      // Predicate mirrors contractorSitemapCount — see the note there.
      .from("contractors")
      .select("slug")
      .not("slug", "is", null)
      .not("dbpr_sync_key", "like", TEST_ROW_LIKE)
      .order("slug", { ascending: true })
      .range(from, from + DB_PAGE - 1);
    if (error) throw new Error(`sitemap chunk ${chunk} at ${from}: ${error.message}`);
    return (data ?? []).map((r) => `/contractor/${r.slug}`);
  });

  const paths = pages.flat();

  /**
   * The second half of the guard the exact count used to provide. A chunk past
   * the end of the data yields nothing from all of its pages; that is the
   * signal, and it costs no extra query because the pages have already run.
   *
   * ⚠ THE RESIDUAL, STATED RATHER THAN HIDDEN: an out-of-range chunk below
   * MAX_CHUNKS still pays for its page queries before 404ing, and those are the
   * deepest and slowest ones. MAX_CHUNKS caps how many such URLs exist; the
   * 404 response carries no Cache-Control, so they are not CDN-absorbed the way
   * a 200 is. Not addressed here because closing it properly means knowing the
   * row count cheaply, which is the keyset/estimate work that is out of scope.
   */
  if (paths.length === 0 && chunk > 0) return null;

  return urlset(paths);
}
