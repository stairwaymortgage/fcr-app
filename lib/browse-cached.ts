import { unstable_cache } from "next/cache";
import { cache } from "react";

import {
  getCitiesInCounty as getCitiesInCountyUncached,
  getCityBySlug as getCityBySlugUncached,
  getContractorPage as getContractorPageUncached,
  getCountyBySlug as getCountyBySlugUncached,
  getCountyMeta as getCountyMetaUncached,
  getCountyNameMap as getCountyNameMapUncached,
  getTypeByCode as getTypeByCodeUncached,
  getTypeCountsInCounty as getTypeCountsInCountyUncached,
  getTypeNameMap as getTypeNameMapUncached,
  getTypesWithCounts as getTypesWithCountsUncached,
  type CityRow,
  type ContractorPage,
  type TypeRow,
} from "@/lib/browse";
import { createPublicClient } from "@/lib/supabase/public";

/**
 * Cached wrappers around the page-independent browse reads.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A SEPARATE FILE AND NOT cache() CALLS IN lib/browse.ts.
 *
 * generateMetadata and the page body of /county/[slug] both call
 * getCountyBySlug with the same slug, so an unwrapped call costs two identical
 * queries on every request. React's cache() dedupes them within one render pass.
 * The obvious home for that is lib/browse.ts itself.
 *
 * It cannot live there, because lib/browse.ts is loaded at RUNTIME by
 * scripts/verify-test-row-isolation.mjs under `node --experimental-strip-types`,
 * and react is CommonJS: `import { cache } from "react"` fails there with
 * "Named export 'cache' not found", and the namespace form
 * (`import * as React`) yields an object whose `cache` is undefined. Either way
 * the whole suite dies on import — and that suite is what proves synthetic rows
 * stay out of the cached listings.
 *
 * ⚠ next/cache IS NOW IN THE SAME POSITION and the same rule protects it. This
 * file gained unstable_cache on 2026-09-01; lib/browse.ts must stay free of
 * BOTH imports or that suite stops loading. Verified: that script imports
 * ../lib/browse.ts only, never this file.
 *
 * SAME SPLIT AS lib/email.ts / lib/email-copy.ts, and for the same reason: the
 * part that must be exercisable offline is kept clear of the dependency that
 * makes it unloadable.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * TWO LAYERS OF CACHE, DOING DIFFERENT JOBS.
 *
 *   unstable_cache  — Next's Data Cache. Survives across requests and across
 *                     instances, 24h TTL, invalidated by tag. This is the layer
 *                     that stops a crawler turning page views into queries.
 *   cache()         — React per-request memoisation, layered ON TOP where a
 *                     function is called twice in one render (the three slug
 *                     lookups, from generateMetadata and the body). Without it
 *                     the Data Cache would be consulted twice for one answer.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THREE RULES EVERY WRAPPER BELOW OBEYS. Breaking any one is silent.
 *
 * 1. NO COOKIES INSIDE THE CACHED CALLBACK. Each creates its own
 *    createPublicClient(). lib/supabase/server.ts calls cookies(), and a
 *    dynamic API inside an unstable_cache callback throws at runtime. This is
 *    also why these wrappers take no `db` argument — accepting one would let a
 *    caller hand in a cookie-carrying client and smuggle a session into a
 *    shared cache entry. The client is built inside, where it cannot be wrong.
 *
 * 2. NOTHING A Map IS CACHED DIRECTLY. The Data Cache serialises to JSON, and
 *    a Map serialises to {} — it would come back EMPTY, with no error, and the
 *    county filter panel would silently render nothing. Every Map-returning
 *    read is cached as an ARRAY OF ENTRIES and rebuilt into a Map outside the
 *    cache boundary.
 *
 * 3. FAILURES ARE NEVER CACHED. getTypeCountsInCounty in lib/browse.ts fails
 *    soft — it logs and returns an empty Map so the page renders without filter
 *    counts rather than 500ing. That is right for a live read and WRONG to
 *    cache: one transient timeout would pin an empty filter panel for 24 hours.
 *    The cached callback throws instead, so nothing is written, and the
 *    fail-soft behaviour is reapplied outside in the wrapper.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * INVALIDATION: one tag, "browse", busted by revalidateListings() in
 * lib/revalidate.ts — which the importer's Phase 4 already calls through
 * /api/revalidate-listings. Per-entity tags (county:13 and the like) were
 * considered and deliberately left out: the only invalidator is a weekly import
 * that moves every count at once, so a finer tag would ship a key nothing ever
 * uses. Same reasoning lib/revalidate.ts applies to the Stripe path.
 *
 * TTL IS 24h, matching the listing routes. If Phase 4 fails, these go stale for
 * at most a day and /admin/sync's drift panel reports it — the same bounded,
 * visible failure the stored counts already have.
 */

/** Shared by every wrapper below. */
const BROWSE_TAG = "browse";
const DAY_SECONDS = 86400;

/* ========================================================================== *
 * SLUG LOOKUPS — plain objects, safe to cache as-is
 * ========================================================================== */

const countyBySlugCached = unstable_cache(
  async (slug: string) => getCountyBySlugUncached(createPublicClient(), slug),
  ["browse", "county-by-slug"],
  { revalidate: DAY_SECONDS, tags: [BROWSE_TAG] },
);

const cityBySlugCached = unstable_cache(
  async (slug: string) => getCityBySlugUncached(createPublicClient(), slug),
  ["browse", "city-by-slug"],
  { revalidate: DAY_SECONDS, tags: [BROWSE_TAG] },
);

const typeByCodeCached = unstable_cache(
  async (code: string) => getTypeByCodeUncached(createPublicClient(), code),
  ["browse", "type-by-code"],
  { revalidate: DAY_SECONDS, tags: [BROWSE_TAG] },
);

/** cache() on top: called from generateMetadata AND the page body. */
export const getCountyBySlug = cache(countyBySlugCached);
export const getCityBySlug = cache(cityBySlugCached);
export const getTypeByCode = cache(typeByCodeCached);

/* ========================================================================== *
 * REFERENCE READS — page-independent, identical for every viewer
 * ========================================================================== */

/**
 * Cheap in DATABASE time (0.1–3.2 ms measured) but not in WALL time: each is a
 * separate HTTP round trip from the function to PostgREST, and /county/[slug]
 * made five of them per render. pg_stat_statements only counts the former,
 * which is why these looked free and were not.
 */
const citiesInCountyCached = unstable_cache(
  async (countyCode: string) => getCitiesInCountyUncached(createPublicClient(), countyCode),
  ["browse", "cities-in-county"],
  { revalidate: DAY_SECONDS, tags: [BROWSE_TAG] },
);

export function getCitiesInCounty(countyCode: string): Promise<CityRow[]> {
  return citiesInCountyCached(countyCode);
}

const typesWithCountsCached = unstable_cache(
  async () => getTypesWithCountsUncached(createPublicClient()),
  ["browse", "types-with-counts"],
  { revalidate: DAY_SECONDS, tags: [BROWSE_TAG] },
);

export function getTypesWithCounts(): Promise<TypeRow[]> {
  return typesWithCountsCached();
}

/* ========================================================================== *
 * THE Map-RETURNING READS — cached as entries, rebuilt outside (rule 2)
 * ========================================================================== */

const countyNameEntriesCached = unstable_cache(
  async () => Array.from((await getCountyNameMapUncached(createPublicClient())).entries()),
  ["browse", "county-name-entries"],
  { revalidate: DAY_SECONDS, tags: [BROWSE_TAG] },
);

export const getCountyNameMap = cache(
  async (): Promise<Map<string, string>> => new Map(await countyNameEntriesCached()),
);

const typeNameEntriesCached = unstable_cache(
  async () => Array.from((await getTypeNameMapUncached(createPublicClient())).entries()),
  ["browse", "type-name-entries"],
  { revalidate: DAY_SECONDS, tags: [BROWSE_TAG] },
);

export const getTypeNameMap = cache(
  async (): Promise<Map<string, string>> => new Map(await typeNameEntriesCached()),
);

const countyMetaEntriesCached = unstable_cache(
  async () => Array.from((await getCountyMetaUncached(createPublicClient())).entries()),
  ["browse", "county-meta-entries"],
  { revalidate: DAY_SECONDS, tags: [BROWSE_TAG] },
);

export const getCountyMeta = cache(
  async (): Promise<Map<string, { name: string; slug: string }>> =>
    new Map(await countyMetaEntriesCached()),
);

/* ========================================================================== *
 * THE ONE THAT MATTERS — county_type_counts
 * ========================================================================== */

/**
 * THE REASON THIS FILE GREW. At 440.4 ms mean over 29,443 calls it is, since
 * the license_type counts came out on 2026-09-01, the largest query on the
 * project — and it is PAGE-INDEPENDENT with only 67 distinct keys.
 *
 * That combination is what makes caching worth it here and not on the listing
 * query beside it. A crawler walking all 7,576 paginated county URLs touches
 * 7,576 distinct list-query keys (every one a cold miss on a single sweep) but
 * only 67 of these. This entry is hit ~99% of the time under exactly the crawl
 * pattern that saturated Postgres on 2026-09-01; a per-page cache would be hit
 * ~0% of it.
 *
 * ⚠ THROWS RATHER THAN RETURNING AN EMPTY RESULT — see rule 3 above. An empty
 * result is not a legitimate answer for any real county: all 67 hold more than
 * one page of contractors, so zero rows means the RPC failed (or its migration
 * is missing) and must not be written to a 24-hour cache. A county that
 * genuinely had no contractors would simply never cache and re-query each time,
 * which is correct behaviour rather than a wrong page.
 */
const typeCountEntriesCached = unstable_cache(
  async (countyCode: string) => {
    const entries = Array.from(
      (await getTypeCountsInCountyUncached(createPublicClient(), countyCode)).entries(),
    );
    if (entries.length === 0) {
      // The uncached read already logged the underlying cause.
      throw new Error(`county_type_counts returned nothing for ${countyCode} — not caching`);
    }
    return entries;
  },
  ["browse", "county-type-counts"],
  { revalidate: DAY_SECONDS, tags: [BROWSE_TAG] },
);

/**
 * Fail-soft is reapplied HERE, outside the cache, preserving the contract the
 * county page was written against: no filter counts rather than a 500.
 */
export async function getTypeCountsInCounty(countyCode: string): Promise<Map<string, number>> {
  try {
    return new Map(await typeCountEntriesCached(countyCode));
  } catch (err) {
    /**
     * LOGGED, NOT SWALLOWED. The first draft of this caught silently, on the
     * reasoning that the uncached read had already logged the cause — and that
     * was wrong twice over. The throw above is raised HERE, for the empty case,
     * and nothing else would ever report it; and a 57014 seen once during
     * local verification looked at first like a bug in this file rather than
     * the pre-existing RPC fragility it actually was. A refusal to cache is a
     * decision worth a line in the log.
     *
     * ⚠ THIS FIRES ON EVERY REQUEST WHILE THE RPC IS UNHEALTHY, because the
     * failure is deliberately not cached. That is the intended noise: the
     * alternative is one quiet line and a blank filter panel for 24 hours.
     */
    console.error("[browse-cached] county_type_counts not cached — filter counts omitted", {
      countyCode,
      message: err instanceof Error ? err.message : String(err),
    });
    return new Map();
  }
}


/* ========================================================================== *
 * THE PAGINATED READ — Tier 2, added 2026-09-11
 * ========================================================================== */

/**
 * One page of contractors, Data-Cached per (filter, page, knownTotal).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS IS THE "TIER 2" f150991 DELIBERATELY DID NOT DO, AND THE REASON IT
 * DECLINED HAS SINCE BEEN REMOVED. That commit's note reads: "Tier 2 (caching
 * getContractorPage per page) is deliberately NOT done: it would be ~31,700
 * keys". That figure came from MAX_PAGE = 400. Step 2 of the cost work lowered
 * MAX_PAGE to 20 on 2026-09-10, which cuts the reachable key space by 20x
 * along its deepest dimension and is what makes this worth doing now.
 *
 * ⚠ IT DOES NOT REDUCE FUNCTION INVOCATIONS, AND NOTHING HERE PRETENDS TO.
 * /county, /city and /type read searchParams, so they are dynamically rendered
 * on every request and each request is an invocation no matter what this
 * caches. Forcing them into ISR was attempted on 2026-09-11 and produced
 * DYNAMIC_SERVER_USAGE — a 500 on every one of those pages; see the note in
 * app/county/[slug]/page.tsx. What this removes is the DATABASE WORK inside
 * those invocations: the row query and, for /city and /type, the exact count
 * that goes with it. That is Fluid Active CPU and Supabase load, not
 * invocation count.
 *
 * THE KEY IS THE FILTER ENTRIES, SORTED. filters arrives as a
 * Record<string, string> whose key order is the call site's insertion order —
 * /county builds { county_code } or { county_code, license_type } depending on
 * the facet. unstable_cache derives its key by serialising the arguments, so an
 * object would make {a,b} and {b,a} two different entries for one answer.
 * Sorting the entries before they cross the boundary makes the key canonical.
 *
 * knownTotal IS PART OF THE KEY, DELIBERATELY. It changes the `total` and
 * `pageCount` in the result, so it cannot be cached across two different
 * values — and it is not merely cosmetic: the county page passes a stored count
 * so the expensive exact count(*) never runs. It moves only on a weekly import,
 * which busts this tag anyway, so it adds no churn in practice. null rather
 * than undefined because undefined is not JSON-serialisable and would make the
 * key unstable.
 *
 * ⚠ RULE 3 ABOVE IS THE SUBTLE ONE HERE, AND IT IS WHY THIS IS NOT A ONE-LINE
 * WRAPPER. getContractorPage does not throw on a failed query: it logs and
 * returns { rows: [], total: 0, failed: true } so the page can say "we could
 * not load this" instead of 500ing. Caching that object would pin an EMPTY
 * LISTING for 24 hours on one transient timeout — on the pages the sitemap
 * sends Google to. So the callback throws when `failed` is set, nothing is
 * written, and the fail-soft shape is rebuilt outside the cache boundary.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const contractorPageCached = unstable_cache(
  async (
    filterEntries: [string, string][],
    page: number,
    knownTotal: number | null,
  ): Promise<ContractorPage> => {
    // RULE 1: the client is built INSIDE, cookie-free. A `db` parameter would
    // let a caller hand in a session-carrying client and write a per-user
    // answer into a shared cache entry.
    const result = await getContractorPageUncached(
      createPublicClient(),
      Object.fromEntries(filterEntries),
      page,
      knownTotal ?? undefined,
    );

    // RULE 3: never cache a failure. getContractorPage has already logged the
    // cause by this point, so this throw needs no log of its own — unlike the
    // county-counts wrapper above, whose throw is raised for a case the
    // uncached read treats as success.
    if (result.failed) {
      throw new Error(`contractor page not cached: query failed (page ${page})`);
    }
    return result;
  },
  ["browse-contractor-page"],
  { revalidate: DAY_SECONDS, tags: [BROWSE_TAG] },
);

/**
 * Cache-wrapped getContractorPage. Takes no `db` — see rule 1 above.
 *
 * Signature otherwise matches lib/browse.ts's, so the three call sites change
 * only by dropping their first argument.
 */
export async function getContractorPage(
  filters: Record<string, string>,
  page: number,
  knownTotal?: number,
): Promise<ContractorPage> {
  const filterEntries = Object.entries(filters).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  try {
    return await contractorPageCached(filterEntries, page, knownTotal ?? null);
  } catch {
    /**
     * The fail-soft contract, reapplied. Shape is copied from the uncached
     * read's error branch so ContractorList renders the same "could not load"
     * state it has always rendered. pageCount 0 rather than 1 — matching
     * lib/browse.ts — so the pagination nav renders nothing at all.
     */
    return { rows: [], total: 0, page, pageCount: 0, failed: true };
  }
}
