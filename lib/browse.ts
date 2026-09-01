import type { SupabaseClient } from "@supabase/supabase-js";
// Relative, not "@/lib/test-rows" — see the note in lib/search.ts. A value
// import on an aliased path breaks node's type-stripping loader, which the
// verify suites use.
import { excludeTestRows } from "./test-rows.ts";

/**
 * Browse-page reads — /counties, /county/[slug], /cities, /city/[slug],
 * /types, /type/[code].
 *
 * All reads use the caller's anon client (lib/supabase/server.ts) under RLS.
 * No admin client anywhere in this module.
 *
 * INDEX COVERAGE — measured against the live table 2026-07-30, best of three,
 * with a ~316ms baseline (indexed btree equality) and a 1540ms control (ILIKE
 * on an unindexed column):
 *
 *   county_code = '06'                      326ms   idx_contractors_county_type_tier
 *   county_code='06' AND license_type='CGC' 288ms   same index, both columns
 *   license_type = 'CGC'                    289ms
 *   city = 'MIAMI'                          315ms   idx_contractors_city_tier
 *
 * Every filter lands on the baseline, so no new index was needed for these six
 * pages. Re-measure before adding a filter on any other column.
 */

/**
 * Either Supabase client.
 *
 * Widened from ReturnType<typeof createClient> on 2026-08-07 so these helpers
 * accept lib/supabase/public.ts's cookie-free client as well as the
 * session-carrying one from lib/supabase/server.ts. Both are SupabaseClient and
 * both read under the same anon RLS; only the cookie dependency differs, and
 * that dependency is what decides whether the calling route can be static.
 *
 * The caller picks. Nothing in this module should ever construct a client.
 */
type Db = SupabaseClient;

/** Rows per page. Bounded — never an unbounded select against 266,305 rows. */
export const PAGE_SIZE = 25;

/**
 * Deepest page we will serve. 400 × 25 = 10,000 rows.
 *
 * OFFSET pagination makes Postgres walk and discard every skipped row, so page
 * 1,531 of /type/cgc would scan 38,250 rows to show 25. Nobody browses that
 * deep — they search — and the cap stops a crafted ?page=999999 being a cheap
 * way to load the database.
 *
 * pageCount IS CLAMPED TO THIS TOO, in getContractorPage. They have to agree:
 * an unclamped pageCount had the "last page" link pointing at page 1531 while
 * parsePage silently served page 400, so the link went somewhere other than
 * where it said.
 */
export const MAX_PAGE = 400;

/** Parse ?page=, clamped to [1, MAX_PAGE]. */
export function parsePage(raw: string | undefined): number {
  const n = Number(raw ?? "1");
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), MAX_PAGE);
}

export interface ContractorRow {
  dbpr_sync_key: string;
  slug: string;
  business_name: string | null;
  qualifying_agent_name: string;
  license_number: string | null;
  license_type: string;
  city: string | null;
  county_code: string | null;
  license_status: string;
  license_status_secondary: string | null;
  original_license_date: string | null;
  claim_tier: string;
}

const LIST_COLUMNS =
  "dbpr_sync_key, slug, business_name, qualifying_agent_name, license_number, " +
  "license_type, city, county_code, license_status, license_status_secondary, " +
  "original_license_date, claim_tier";

export interface ContractorPage {
  rows: ContractorRow[];
  total: number;
  page: number;
  pageCount: number;
  failed: boolean;
}

/**
 * One page of contractors under an arbitrary equality filter.
 *
 * Shared by /county/[slug], /city/[slug] and /type/[code] — the three pages the
 * mockups describe as one template. The filter is a column/value pair rather
 * than three near-identical functions.
 *
 * ORDERED BY business_name THEN qualifying_agent_name, nulls last. The second
 * key is not decoration: ~125k rows have a NULL business_name, and without a
 * deterministic tiebreak Postgres may return equal-keyed rows in a different
 * order between requests — which with OFFSET pagination means a row can appear
 * on two pages or none.
 *
 * `failed` distinguishes a query error from an empty result, for the same
 * reason /search does: rendering "no contractors here" when the query never ran
 * tells the visitor something we have no basis for.
 */
export async function getContractorPage(
  db: Db,
  filters: Record<string, string>,
  page: number,
  /**
   * Pass a total the caller already knows, to skip the exact count.
   *
   * ⚠ THE COUNT IS THE EXPENSIVE HALF OF THIS FUNCTION. `count: "exact"` makes
   * Postgres count every matching row before returning 25 of them — measured at
   * 122 ms for Miami-Dade against 42 ms for the rows themselves. On the county
   * page that work is pure waste twice over: the unfiltered total is already
   * stored in reference_counties.contractor_count, and the ?type= total is
   * already in the map getTypeCountsInCounty returns.
   *
   * Omit it and the count runs as before, which is what /city and /type still
   * do — their totals are not precomputed anywhere.
   */
  knownTotal?: number,
): Promise<ContractorPage> {
  const from = (page - 1) * PAGE_SIZE;

  // Synthetic verify-suite rows never appear in a browse list. See
  // lib/test-rows.ts for why the read paths carry this and not just cleanup.
  let query = excludeTestRows(
    db
      .from("contractors")
      .select(LIST_COLUMNS, knownTotal === undefined ? { count: "exact" } : {}),
  );
  for (const [column, value] of Object.entries(filters)) {
    query = query.eq(column, value);
  }

  const { data, count, error } = await query
    .order("business_name", { ascending: true, nullsFirst: false })
    .order("qualifying_agent_name", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);

  if (error) {
    console.error("[browse] contractor page failed", { filters, page, message: error.message });
    return { rows: [], total: 0, page, pageCount: 0, failed: true };
  }

  // knownTotal wins when supplied — `count` is null in that case, because the
  // query above deliberately did not ask for one.
  const total = knownTotal ?? count ?? 0;
  return {
    rows: (data ?? []) as unknown as ContractorRow[],
    total,
    page,
    pageCount: Math.min(MAX_PAGE, Math.max(1, Math.ceil(total / PAGE_SIZE))),
    failed: false,
  };
}

/* ========================================================================== *
 * COUNTIES
 * ========================================================================== */

export interface CountyRow {
  county_code: string;
  county_name: string;
  county_slug: string;
  region: string | null;
  population: number | null;
  count: number;
}

/**
 * All 67 counties, reading the PRE-COMPUTED count.
 *
 * ONE REQUEST, NOT 67. This previously fired a concurrent COUNT per county
 * because reference_counties had no contractor_count column. The numbers only
 * change when the weekly DBPR sync runs, so counting them per visit was waste —
 * db/migrations/20260730_reference_counts.sql adds and populates the column.
 *
 * The stored value is scoped to state = 'FL'; see that migration for why.
 */
export async function getCountiesWithCounts(db: Db): Promise<CountyRow[]> {
  const stored = await db
    .from("reference_counties")
    .select("county_code, county_name, county_slug, region, population, contractor_count")
    .order("county_name", { ascending: true });

  if (!stored.error && stored.data) {
    return stored.data.map((county) => ({
      county_code: county.county_code,
      county_name: county.county_name,
      county_slug: county.county_slug,
      region: county.region,
      population: county.population,
      count: county.contractor_count ?? 0,
    }));
  }

  /*
   * FALLBACK: the migration has not run yet, so contractor_count does not
   * exist and the select above 400s. Counting live keeps /counties working
   * either side of the migration, which is the whole point — the slug switch
   * taught us that shipping a query against a column that does not exist yet
   * takes a working page down.
   *
   * 67 concurrent index probes, ~1.7s. Correct but wasteful; it disappears the
   * moment the column lands.
   */
  console.warn("[browse] reference_counties.contractor_count missing — counting live");

  const { data, error } = await db
    .from("reference_counties")
    .select("county_code, county_name, county_slug, region, population")
    .order("county_name", { ascending: true });

  if (error || !data) return [];

  return Promise.all(
    data.map(async (county) => {
      const { count } = await db
        .from("contractors")
        .select("*", { count: "exact", head: true })
        .eq("county_code", county.county_code)
        .eq("state", "FL");
      return { ...county, count: count ?? 0 };
    }),
  );
}

/**
 * ⚠ ROUTES MUST IMPORT THIS FROM lib/browse-cached.ts, NOT FROM HERE.
 *
 * generateMetadata and the page body both look up the same slug, so an
 * unwrapped call costs two identical queries per request. The React cache()
 * wrapper that dedupes them lives next door — see that file for why it is not
 * applied here.
 */
export async function getCountyBySlug(db: Db, slug: string) {
  const { data } = await db
    .from("reference_counties")
    // contractor_count added 2026-08-07: the county page uses it as the list
    // total instead of paying for a second exact count of the same 26k rows.
    .select("county_code, county_name, county_slug, region, population, contractor_count")
    .eq("county_slug", slug)
    .maybeSingle();
  return data ?? null;
}

/** county_code -> { name, slug }, when a county link is needed as well. */
export async function getCountyMeta(
  db: Db,
): Promise<Map<string, { name: string; slug: string }>> {
  const { data } = await db
    .from("reference_counties")
    .select("county_code, county_name, county_slug");
  return new Map(
    (data ?? []).map((r) => [r.county_code, { name: r.county_name, slug: r.county_slug }]),
  );
}

/** county_code -> county_name, for rendering a county on a contractor row. */
export async function getCountyNameMap(db: Db): Promise<Map<string, string>> {
  const { data } = await db
    .from("reference_counties")
    .select("county_code, county_name");
  return new Map((data ?? []).map((r) => [r.county_code, r.county_name]));
}

/* ========================================================================== *
 * CITIES
 * ========================================================================== */

export interface CityRow {
  city_slug: string;
  city_name: string;
  county_code: string;
  contractor_count: number | null;
}

/**
 * All 710 reference cities.
 *
 * reference_cities.contractor_count IS USED HERE AND IS SLIGHTLY STALE.
 * Miami reads 16,191 against a live count of 16,202 — the column was derived at
 * import and nothing maintains it. Eleven rows on sixteen thousand is not worth
 * 710 live counts on an index page; the city's own page shows the live total.
 * Flagged so the discrepancy is a known quantity rather than a surprise.
 */
export async function getCities(db: Db): Promise<CityRow[]> {
  const { data, error } = await db
    .from("reference_cities")
    .select("city_slug, city_name, county_code, contractor_count")
    .order("city_name", { ascending: true });
  return error || !data ? [] : (data as CityRow[]);
}

/** Import from lib/browse-cached.ts in routes — see getCountyBySlug. */
export async function getCityBySlug(db: Db, slug: string) {
  const { data } = await db
    .from("reference_cities")
    .select("city_slug, city_name, county_code, contractor_count")
    .eq("city_slug", slug)
    .maybeSingle();
  return data ?? null;
}

/**
 * The top cities within one county, for the county page's city strip.
 *
 * Reads reference_cities rather than aggregating contractors, so it is one
 * request against a 710-row table.
 */
export async function getCitiesInCounty(
  db: Db,
  countyCode: string,
  limit = 14,
): Promise<CityRow[]> {
  const { data } = await db
    .from("reference_cities")
    .select("city_slug, city_name, county_code, contractor_count")
    .eq("county_code", countyCode)
    .order("contractor_count", { ascending: false, nullsFirst: false })
    .limit(limit);
  return (data ?? []) as CityRow[];
}

/* ========================================================================== *
 * LICENCE TYPES
 * ========================================================================== */

export interface TypeRow {
  type_code: string;
  type_name: string;
  category: string;
  scope_description: string | null;
  count: number;
}

/**
 * All 29 licence types with their stored counts.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * READS reference_license_types.contractor_count. IT NO LONGER COUNTS LIVE.
 *
 * This function used to fire 29 concurrent `count(*) exact` probes — one per
 * licence type — because the comment here said the column "is zero on all 29
 * rows, the initial import never backfilled it". That was true when it was
 * written and is NOT true any more: the importer's Phase 4
 * (repair_reference_counts, scripts/import-dbpr.mjs) backfills it on every
 * successful run, and the five-week all-zeros window that justified counting
 * live is the exact bug that phase was built to close.
 *
 * Verified against the live table on 2026-09-01 before this change: all 29 rows
 * match a live count(*) EXACTLY, zero drift, 114,631 stored against 114,631
 * live. This is not an approximation being traded for speed — it is the same
 * number, already computed.
 *
 * WHY IT MATTERED ENOUGH TO CHANGE. Each probe is a count over up to ~50k index
 * entries, and together with the two sibling call sites (app/page.tsx's
 * countByType, lib/search.ts's searchLicenseTypes) this query shape was the
 * single largest consumer of database time on the project: 953,690 calls and
 * 30.5 hours of execution since the 2026-07-29 stats reset, ~76% of all
 * measured time, still running at ~675/hr when it was removed.
 *
 * STALENESS IS BOUNDED BY THE WEEKLY IMPORT, and that is the accepted trade —
 * these are counts on an index page, sourced from an extract DBPR publishes
 * weekly. A number up to a week old on /types is not meaningfully worse than
 * one that was recomputed a second ago from data that is itself a week old.
 *
 * ⚠ IF PHASE 4 FAILS, THESE COUNTS GO STALE SILENTLY HERE — the page renders
 * whatever the column says with no indication of its age. That failure is not
 * invisible overall: Phase 4 logs loudly, and /admin/sync's drift panel
 * compares stored against live and reports the gap. Do not add a drift check to
 * this function; that would reintroduce the scan this change removed.
 *
 * ELEVEN TYPES HAVE ZERO CONTRACTORS, including every electrical class (EC, ER,
 * ES) — DBPR publishes electrical licences in a separate extract we do not
 * import. The index page shows them with a count of 0 rather than hiding them,
 * because a licence type existing with nobody holding it is true and useful;
 * their /type pages render an explicit empty state. Those eleven read 0 in the
 * column too, so the swap does not change what they render.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export async function getTypesWithCounts(db: Db): Promise<TypeRow[]> {
  const { data, error } = await db
    .from("reference_license_types")
    .select("type_code, type_name, category, scope_description, contractor_count");

  if (error || !data) return [];

  // contractor_count is destructured out rather than spread through: TypeRow's
  // field is `count`, and carrying both would leave two names for one number.
  return data
    .map(({ contractor_count, ...type }) => ({
      ...type,
      count: (contractor_count as number | null) ?? 0,
    }))
    .sort((a, b) => b.count - a.count);
}

/** Import from lib/browse-cached.ts in routes — see getCountyBySlug. */
export async function getTypeByCode(db: Db, code: string) {
  const { data } = await db
    .from("reference_license_types")
    .select("type_code, type_name, category, scope_description")
    .eq("type_code", code.toUpperCase())
    .maybeSingle();
  return data ?? null;
}

/** type_code -> type_name, for the licence-type caption on a contractor row. */
export async function getTypeNameMap(db: Db): Promise<Map<string, string>> {
  const { data } = await db
    .from("reference_license_types")
    .select("type_code, type_name");
  return new Map((data ?? []).map((r) => [r.type_code, r.type_name]));
}

/**
 * Counts per licence type within one county — the county page's filter counts.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE RPC, NOT ~18 ROUND TRIPS. Changed 2026-08-07.
 *
 * This used to issue one count(*) per licence type, concurrently — about 18 of
 * them on a populated county, each its own HTTP request to PostgREST. Measured
 * on the live table for Miami-Dade: 13.9 ms per type count versus 50.9 ms for
 * the single GROUP BY that replaces all of them. The database time is
 * comparable; eighteen round trips from a Vercel function are not.
 *
 * Requires db/migrations/20260807_county_type_counts_rpc.sql.
 *
 * ⚠ THE RPC APPLIES THE ZZTEST EXCLUSION ITSELF, in SQL, duplicating
 * TEST_ROW_LIKE. It has to — a SQL function cannot import a TS constant. If the
 * prefix in lib/test-rows.ts ever changes, that function must change with it, or
 * the filter panel will count synthetic rows the listing beside it excludes.
 *
 * FAILS SOFT AND SAYS SO. A missing function (PGRST202, i.e. the migration has
 * not been run) or any other error returns an empty map, so the page renders
 * without filter counts rather than 500ing. The log names the migration,
 * because "the filter panel is empty" is not a symptom anyone would trace back
 * to a missing RPC on their own.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export async function getTypeCountsInCounty(
  db: Db,
  countyCode: string,
): Promise<Map<string, number>> {
  const { data, error } = await db.rpc("county_type_counts", {
    p_county_code: countyCode,
  });

  if (error) {
    console.error("[browse] county_type_counts failed — filter counts omitted", {
      countyCode,
      code: error.code,
      message: error.message,
      hint:
        error.code === "PGRST202"
          ? "db/migrations/20260807_county_type_counts_rpc.sql has not been run."
          : undefined,
    });
    return new Map();
  }

  const rows = (data ?? []) as { type_code: string; n: number | string }[];
  // count(*) is bigint; PostgREST may render it as a JSON string rather than a
  // number, so it is coerced rather than trusted to arrive numeric.
  return new Map(
    rows
      .map((r) => [r.type_code, Number(r.n)] as const)
      .filter(([, n]) => Number.isFinite(n) && n > 0),
  );
}

/* ========================================================================== *
 * FORMATTING
 * ========================================================================== */

/**
 * Name casing lives in lib/format-name.ts — one implementation for the whole
 * app. `titleCase` here had drifted from the profile page's copy: it omitted
 * "Co", so "SMITH & SONS CO." cased differently on a browse card than on a
 * profile.
 */
// Relative + .ts extension, not "@/lib/format-name": this module is imported at
// runtime by scripts/verify-test-row-isolation.mjs under
// --experimental-strip-types, where node resolves neither the alias nor an
// extensionless path. Same constraint as lib/search.ts — see the note there.
export { businessName as titleCase, personName } from "./format-name.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2012-09-24" -> "Sep 2012". Split, never Date() — a calendar date must not
 *  cross a timezone. */
export function shortDate(value: string | null): string | null {
  if (!value) return null;
  const [y, m] = value.split("-").map(Number);
  return y && m ? `${MONTHS[m - 1]} ${y}` : null;
}
