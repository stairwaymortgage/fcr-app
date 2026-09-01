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
 * A TABLE READ, WITH THE RPC AS FALLBACK. Changed 2026-09-01.
 *
 * HISTORY, BECAUSE IT EXPLAINS THE SHAPE. Until 2026-08-07 this issued one
 * count(*) per licence type, concurrently — about 18 per populated county, each
 * its own HTTP request to PostgREST. Miami-Dade measured 13.9 ms per type count
 * against 50.9 ms for the single GROUP BY that replaced all of them: comparable
 * database time, eighteen fewer round trips. That GROUP BY is
 * county_type_counts(), and it is still here, below, as the fallback.
 *
 * WHY IT IS NO LONGER THE PRIMARY PATH. The RPC runs as anon, and anon carries
 * statement_timeout = 3s. Its mean is 440.4 ms over 29,443 calls — but its TAIL
 * crosses 3s, and when it does the read fails 57014 and the page renders with
 * no filter counts at all. Observed twice on 2026-09-01: /county/osceola at
 * 04:04:59 during the billing incident, and again in local verification of the
 * Data-Cache work, where /county/broward rendered 0 ?type= links against 56 on
 * production. Caching the call (lib/browse-cached.ts) made the failure rarer —
 * 67 keys, once a day each — and therefore harder to notice, which is not the
 * same as fixing it. A cache in front of a query that can fail is not a fix for
 * the query.
 *
 * reference_county_type_counts is the same aggregate, precomputed by the
 * importer's Phase 4 and read by primary key. Requires
 * db/migrations/20260901_county_type_counts_table.sql; without it this falls
 * back and behaves exactly as it did before.
 *
 * ⚠ BOTH PATHS APPLY THE ZZTEST EXCLUSION IN SQL, duplicating TEST_ROW_LIKE —
 * the RPC in its function body, the table in the repair that fills it. Neither
 * can import a TypeScript constant. If the prefix in lib/test-rows.ts ever
 * changes, BOTH must change with it, or the filter panel counts synthetic rows
 * the listing beside it excludes. That is now two places, not one.
 *
 * FAILS SOFT AND SAYS SO, unchanged: any error on either path ends in an empty
 * map, so the page renders without filter counts rather than 500ing, and each
 * log line names the migration that would fix it.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export async function getTypeCountsInCounty(
  db: Db,
  countyCode: string,
): Promise<Map<string, number>> {
  /**
   * PRIMARY PATH — the denormalised table. Added 2026-09-01.
   *
   * A primary-key range scan on (county_code, type_code) replacing a GROUP BY
   * over 271k rows. The RPC below is kept and still correct; it is simply no
   * longer the thing standing between a visitor and the filter panel.
   *
   * ⚠ READ WITH THE CALLER'S CLIENT, WHICH IS ANON. No service-role client is
   * introduced and none is needed: policy "public read county_type_counts"
   * grants SELECT to anon and authenticated with qual = true, exactly like the
   * three sibling reference tables. A privileged client here would be a
   * standing escalation to read data anon can already select.
   *
   * county_code is NOT selected — it is the filter, identical on every row, and
   * the shape below has no place for it.
   */
  const { data, error } = await db
    .from("reference_county_type_counts")
    .select("type_code, n")
    .eq("county_code", countyCode);

  if (!error && data && data.length > 0) {
    return toTypeCountMap(data as TypeCountRow[]);
  }

  /**
   * FALLBACK — and it is LOUD, because a silent one is the whole problem.
   *
   * Reached when the table is missing (the migration has not been run), when
   * the read errors, or when a county has no rows (which for a real county
   * means the repair has not populated it — every one of the 67 holds more than
   * a page of contractors). All three are "the table is not carrying this yet",
   * and all three degrade to precisely the pre-2026-09-01 behaviour rather than
   * to an empty panel.
   *
   * ⚠ THIS WARNING EXISTING IN THE LOGS AT ALL MEANS THE 3s TAIL IS STILL LIVE.
   * The RPC's mean is 440 ms against anon's 3s statement_timeout, and it is
   * that tail — seen as 57014 on /county/osceola at 04:04:59 during the
   * 2026-09-01 incident — that the table exists to remove. Falling back is
   * correct behaviour and a temporary state, not a resting place: grep this
   * string in Vercel logs after applying the migration and expect zero hits.
   */
  console.warn("[browse] reference_county_type_counts empty/failed, falling back to RPC", {
    countyCode,
    reason: error ? "error" : "empty",
    code: error?.code,
    message: error?.message,
    hint:
      error?.code === "PGRST205" || error?.code === "42P01"
        ? "db/migrations/20260901_county_type_counts_table.sql has not been run."
        : undefined,
  });

  return typeCountsFromRpc(db, countyCode);
}

/** The row shape both paths produce before mapping. */
type TypeCountRow = { type_code: string; n: number | string };

/**
 * The ONE place the returned Map is built, shared by both paths.
 *
 * Extracted rather than duplicated so the two can never drift: the whole point
 * of the fallback is that a caller cannot tell which path served it, and two
 * copies of this mapping is exactly how that stops being true.
 *
 * count(*) is bigint; PostgREST may render it as a JSON string rather than a
 * number, so it is coerced rather than trusted to arrive numeric. The table's
 * `n` is a plain integer and arrives numeric, but the coercion is kept for the
 * RPC path and costs nothing on the other.
 *
 * The `n > 0` filter is preserved from the original. It is a no-op against the
 * table (every row comes from a GROUP BY, so n >= 1) and load-bearing against
 * nothing — it is kept because dropping a filter is a shape change, and this
 * function's contract is that there isn't one.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THE SORT IS NEW ON 2026-09-01 AND IS THE ONE OBSERVABLE CHANGE HERE.
 *
 * NEITHER SOURCE ORDERS ITS ROWS. county_type_counts() is a bare GROUP BY and
 * the table read is a bitmap heap scan; both return rows in whatever order the
 * executor produces. app/county/[slug] then sorts the entries by count
 * descending, and Array.prototype.sort is STABLE — so entries with EQUAL counts
 * render in database row order, which is arbitrary and differs between the two
 * paths.
 *
 * Measured on /county/broward, table path against the live RPC path: all 27
 * codes and all 27 counts identical, and exactly two pairs transposed —
 * PVDR=28 against RB=28, and RS=2 against RM=2. Both exact ties.
 *
 * Sorting here rather than leaving it fixes two things at once. The fallback
 * becomes genuinely invisible: a caller cannot tell which path served it, which
 * is the entire contract of having a fallback, and could not be true while the
 * two disagreed on ties. And the page becomes DETERMINISTIC — today's order is
 * not stable even between two calls to the same RPC, so a tie could swap on any
 * render with nothing having changed.
 *
 * The cost is that a handful of tied entries may appear in a different order
 * than they did before this shipped, once. Counts and codes are unaffected.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function toTypeCountMap(rows: TypeCountRow[]): Map<string, number> {
  return new Map(
    rows
      .map((r) => [r.type_code, Number(r.n)] as const)
      .filter(([, n]) => Number.isFinite(n) && n > 0)
      // Count descending to match how the page renders them, then type_code as
      // the tiebreak — any total order would do, provided both paths use it.
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
}

/**
 * The original RPC read, unchanged in behaviour and now the fallback.
 *
 * FAILS SOFT AND SAYS SO, exactly as before: a missing function (PGRST202, the
 * 20260807 migration not run) or any other error returns an empty map so the
 * page renders without filter counts rather than 500ing.
 */
async function typeCountsFromRpc(db: Db, countyCode: string): Promise<Map<string, number>> {
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

  return toTypeCountMap((data ?? []) as TypeCountRow[]);
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
