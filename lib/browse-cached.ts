import { unstable_cache } from "next/cache";
import { cache } from "react";

import {
  getCitiesInCounty as getCitiesInCountyUncached,
  getCityBySlug as getCityBySlugUncached,
  getCountyBySlug as getCountyBySlugUncached,
  getCountyMeta as getCountyMetaUncached,
  getCountyNameMap as getCountyNameMapUncached,
  getTypeByCode as getTypeByCodeUncached,
  getTypeCountsInCounty as getTypeCountsInCountyUncached,
  getTypeNameMap as getTypeNameMapUncached,
  getTypesWithCounts as getTypesWithCountsUncached,
  type CityRow,
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
