import type { createClient } from "@/lib/supabase/server";
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

type Db = ReturnType<typeof createClient>;

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
): Promise<ContractorPage> {
  const from = (page - 1) * PAGE_SIZE;

  // Synthetic verify-suite rows never appear in a browse list. See
  // lib/test-rows.ts for why the read paths carry this and not just cleanup.
  let query = excludeTestRows(
    db.from("contractors").select(LIST_COLUMNS, { count: "exact" }),
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

  const total = count ?? 0;
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

export async function getCountyBySlug(db: Db, slug: string) {
  const { data } = await db
    .from("reference_counties")
    .select("county_code, county_name, county_slug, region, population")
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
 * All 29 licence types with live counts.
 *
 * COUNTED LIVE because reference_license_types.contractor_count is zero on all
 * 29 rows — the column exists but the initial import never backfilled it.
 * 29 concurrent index probes.
 *
 * ELEVEN TYPES HAVE ZERO CONTRACTORS, including every electrical class (EC, ER,
 * ES) — DBPR publishes electrical licences in a separate extract we do not
 * import. The index page shows them with a count of 0 rather than hiding them,
 * because a licence type existing with nobody holding it is true and useful;
 * their /type pages render an explicit empty state.
 */
export async function getTypesWithCounts(db: Db): Promise<TypeRow[]> {
  const { data, error } = await db
    .from("reference_license_types")
    .select("type_code, type_name, category, scope_description");

  if (error || !data) return [];

  const withCounts = await Promise.all(
    data.map(async (type) => {
      const { count } = await db
        .from("contractors")
        .select("*", { count: "exact", head: true })
        .eq("license_type", type.type_code);
      return { ...type, count: count ?? 0 };
    }),
  );

  return withCounts.sort((a, b) => b.count - a.count);
}

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
 * Limited to the types that actually occur, and issued concurrently. Skipping
 * the 11 empty types keeps this at ~18 probes rather than 29.
 */
export async function getTypeCountsInCounty(
  db: Db,
  countyCode: string,
  typeCodes: string[],
): Promise<Map<string, number>> {
  const entries = await Promise.all(
    typeCodes.map(async (code) => {
      const { count } = await db
        .from("contractors")
        .select("*", { count: "exact", head: true })
        .eq("county_code", countyCode)
        .eq("license_type", code);
      return [code, count ?? 0] as const;
    }),
  );
  return new Map(entries.filter(([, n]) => n > 0));
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
export { businessName as titleCase, personName } from "@/lib/format-name";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2012-09-24" -> "Sep 2012". Split, never Date() — a calendar date must not
 *  cross a timezone. */
export function shortDate(value: string | null): string | null {
  if (!value) return null;
  const [y, m] = value.split("-").map(Number);
  return y && m ? `${MONTHS[m - 1]} ${y}` : null;
}
