import type { createClient } from "@/lib/supabase/server";
/**
 * ⚠ RELATIVE, NOT "@/lib/test-rows", AND IT HAS TO BE.
 *
 * This module is imported at RUNTIME by scripts/verify-test-row-isolation.mjs
 * under `node --experimental-strip-types`, which resolves real specifiers and
 * knows nothing about tsconfig path aliases. The existing `@/` import above
 * survives only because `import type` is erased before node ever sees it; a
 * value import on the same path throws ERR_MODULE_NOT_FOUND and takes the whole
 * suite with it.
 *
 * Any future VALUE import added to this file must be relative for the same
 * reason. Same applies to lib/browse.ts.
 */
import { excludeTestRows } from "./test-rows.ts";

/**
 * Registry search — query parsing and the four data reads behind /search.
 *
 * Kept out of the page so the parsing rules are unit-checkable and so /county,
 * /city and /type can reuse the same tokenizer in Week 3.
 *
 * EVERY READ HERE IS PUBLIC DIRECTORY DATA VIA THE ANON CLIENT. The caller
 * passes a client built by lib/supabase/server.ts; nothing in this module
 * reaches for service-role, and nothing it touches is behind an RLS policy that
 * anon cannot satisfy (contractors, reference_counties, reference_cities,
 * reference_license_types are all "public read").
 */

type Db = ReturnType<typeof createClient>;

/**
 * Rows per search. Hard cap — never issue an unbounded select against 266,305
 * rows. The page reports the true total alongside, from an exact count, so a
 * capped list never reads as a complete one.
 */
export const SEARCH_LIMIT = 50;

/**
 * Shortest query we will run.
 *
 * TWO IS THE FLOOR, THREE IS WHERE IT GETS FAST. A GIN trigram index stores
 * 3-character grams, so a 1–2 character pattern cannot be satisfied from the
 * index and degrades to a scan of the whole table no matter what indexes exist.
 * Single characters are rejected outright; two-character queries are allowed
 * because "AC" is a plausible thing to type, and they are rare enough that the
 * occasional scan is acceptable. Do not lower this to 1.
 */
export const MIN_QUERY_LENGTH = 2;

/** Tokens beyond this are dropped, to bound the number of ANDed filters. */
const MAX_TOKENS = 5;

/** Matches "CGC1520921", "cgc 1520921", "RR0067890" — a licence number. */
const LICENSE_NUMBER_SHAPE = /^[a-z]{2,4}\s*\d{4,10}$/i;

export interface ParsedQuery {
  /** The raw string, trimmed. Echoed back into the search input. */
  raw: string;
  /** Sanitized search terms, ANDed together. Empty when the query is unusable. */
  tokens: string[];
  /** Set when the whole query is licence-number shaped, e.g. "CGC1520921". */
  licenseNumber: string | null;
  /**
   * True when a query was supplied but nothing searchable survived parsing.
   *
   * COVERS TWO CASES, AND THE SECOND IS EASY TO MISS: the whole string being
   * under MIN_QUERY_LENGTH, and a string that clears that bar but leaves no
   * token that does. "x,y)" sanitizes to "x y" — three characters, so it passes
   * the length gate — yet both tokens are single characters and get dropped,
   * leaving nothing to query. Without this flag the page rendered an entirely
   * empty <main>: no results, no empty state, no explanation. Found 2026-07-30.
   */
  tooShort: boolean;
}

/**
 * Strip everything that would change the meaning of a PostgREST filter.
 *
 * THIS IS A CORRECTNESS BOUNDARY, NOT TIDYING. Search terms are interpolated
 * into the `or=(...)` filter string that supabase-js sends as a query
 * parameter, and that grammar is delimited by commas, parentheses and dots. A
 * query of `a,b` or `foo)` would otherwise produce a filter PostgREST parses as
 * extra conditions — at best a 400, at worst a filter that means something
 * other than what the visitor typed.
 *
 * `%` and `_` are stripped for a second reason: they are LIKE wildcards. Left
 * in, a query of `%` becomes ILIKE '%%%' and matches all 266,305 rows.
 *
 * Everything outside a conservative whitelist goes. Letters, digits, spaces,
 * hyphens, ampersands and apostrophes survive, which covers real business names
 * ("A&B Roofing", "O'Brien Construction", "Smith-Jones LLC").
 */
function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9\s&'-]/g, " ").replace(/\s+/g, " ").trim();
}

/** Parse a raw `?q=` value into something safe to query with. */
export function parseQuery(raw: string | undefined): ParsedQuery {
  const trimmed = (raw ?? "").trim();
  const cleaned = sanitize(trimmed);

  if (cleaned.length < MIN_QUERY_LENGTH) {
    return {
      raw: trimmed,
      tokens: [],
      licenseNumber: null,
      tooShort: trimmed.length > 0,
    };
  }

  // A licence number is matched as a unit, not tokenized — "cgc 1520921" is one
  // identifier that happens to contain a space, and splitting it would search
  // for "cgc" and "1520921" separately.
  const licenseNumber = LICENSE_NUMBER_SHAPE.test(cleaned)
    ? cleaned.replace(/\s+/g, "").toUpperCase()
    : null;

  const tokens = cleaned
    .split(" ")
    .filter((token) => token.length >= MIN_QUERY_LENGTH)
    .slice(0, MAX_TOKENS);

  // Nothing survived tokenizing even though the whole string cleared the length
  // gate — see the note on `tooShort`. Reported as unusable rather than run as
  // an empty search.
  if (tokens.length === 0) {
    return { raw: trimmed, tokens: [], licenseNumber: null, tooShort: true };
  }

  return { raw: trimmed, tokens, licenseNumber, tooShort: false };
}

/** The columns a result card needs. Selected explicitly — never `*`. */
const RESULT_COLUMNS =
  "dbpr_sync_key, slug, business_name, qualifying_agent_name, license_number, license_type, city, county_code, zip, license_status, claim_tier";

export interface ContractorResult {
  dbpr_sync_key: string;
  slug: string;
  business_name: string | null;
  qualifying_agent_name: string;
  license_number: string | null;
  license_type: string;
  city: string | null;
  county_code: string | null;
  zip: string | null;
  license_status: string;
  claim_tier: string;
}

export interface ContractorSearchResult {
  rows: ContractorResult[];
  /** Exact total, which may exceed rows.length — see SEARCH_LIMIT. */
  total: number;
  /** True when the licence-number fast path produced the rows. */
  matchedByLicenseNumber: boolean;
  /**
   * True when the query itself failed, as opposed to matching nothing.
   *
   * THESE TWO MUST NOT LOOK THE SAME TO THE VISITOR. An earlier version
   * returned an empty row set on error, so a failed request rendered the "No
   * results for X" panel — telling someone the registry holds no such
   * contractor when in fact we never successfully asked. Caught on 2026-07-30
   * when a cold-start request for "aceca" rendered zero results and the same
   * query a second later returned four.
   */
  failed: boolean;
}

/**
 * One OR group per token: the token may appear in any of the four columns.
 *
 * `*` is the wildcard rather than `%` because this string goes into a URL query
 * parameter, where a literal `%` starts a percent-escape. PostgREST accepts `*`
 * and translates it.
 */
function orFilterFor(token: string): string {
  return [
    `business_name.ilike.*${token}*`,
    `qualifying_agent_name.ilike.*${token}*`,
    `city.ilike.*${token}*`,
    `license_number.ilike.*${token}*`,
  ].join(",");
}

/**
 * Contractor results.
 *
 * TWO-PHASE, BECAUSE A LICENCE NUMBER IS AN IDENTIFIER, NOT A NAME. When the
 * query is licence-shaped we try exact equality first: it is served by the
 * existing btree at ~300ms, and someone typing CGC1520921 wants that licence,
 * not every record containing that digit run. Only if exact finds nothing do we
 * fall through to substring matching, so a partial licence number still works.
 *
 * MULTI-TOKEN IS AND-ACROSS-TOKENS, OR-ACROSS-COLUMNS. "acero davie" must
 * require both terms, each free to match a different column — the name in
 * qualifying_agent_name and the city in city. Consecutive .or() calls are ANDed
 * by PostgREST, which expresses exactly that. A single ILIKE '%acero davie%'
 * would match nothing, because no one column contains both words.
 *
 * ORDERING IS ALPHABETICAL, AND FEATURED-FIRST IS DELIBERATELY NOT DONE HERE.
 * See sortFeaturedFirst.
 */
export async function searchContractors(
  db: Db,
  parsed: ParsedQuery,
): Promise<ContractorSearchResult> {
  if (parsed.tokens.length === 0) {
    return { rows: [], total: 0, matchedByLicenseNumber: false, failed: false };
  }

  if (parsed.licenseNumber) {
    // Both branches exclude synthetic verify-suite rows. See lib/test-rows.ts.
    const exact = await excludeTestRows(
      db
        .from("contractors")
        .select(RESULT_COLUMNS, { count: "exact" })
        .eq("license_number", parsed.licenseNumber),
    ).limit(SEARCH_LIMIT);

    if (!exact.error && (exact.count ?? 0) > 0) {
      return {
        rows: (exact.data ?? []) as ContractorResult[],
        total: exact.count ?? 0,
        matchedByLicenseNumber: true,
        failed: false,
      };
    }
    // A failed exact lookup falls through to the substring search rather than
    // returning: the fallback may well succeed, and if it also fails the error
    // surfaces there.
  }

  let query = excludeTestRows(
    db.from("contractors").select(RESULT_COLUMNS, { count: "exact" }),
  );
  for (const token of parsed.tokens) {
    query = query.or(orFilterFor(token));
  }

  const { data, count, error } = await query
    // business_name is NULL on ~125k rows; nullsFirst: false puts those after
    // the named businesses rather than leading the page with blanks. The
    // qualifying_agent_name tiebreak makes the order deterministic — without it
    // Postgres may return equal-keyed rows differently between requests.
    .order("business_name", { ascending: true, nullsFirst: false })
    .order("qualifying_agent_name", { ascending: true })
    .limit(SEARCH_LIMIT);

  if (error) {
    // Logged, not swallowed. Without this the only symptom of a broken search
    // is a page that claims the registry has nothing matching.
    console.error("[search] contractor query failed", {
      tokens: parsed.tokens,
      code: error.code,
      message: error.message,
    });
    return { rows: [], total: 0, matchedByLicenseNumber: false, failed: true };
  }

  return {
    rows: (data ?? []) as ContractorResult[],
    total: count ?? 0,
    matchedByLicenseNumber: false,
    failed: false,
  };
}

/**
 * Featured rows to the top of the page's slice.
 *
 * DONE IN JS, AND `ORDER BY claim_tier DESC` WOULD BE A BUG. claim_tier holds
 * the strings 'unclaimed' | 'claimed' | 'featured', so sorting it descending
 * orders them alphabetically: unclaimed, featured, claimed. That puts unclaimed
 * FIRST — the exact opposite of featured-first. The existing
 * idx_contractors_featured_alpha index in 02_indexes.sql is built on
 * (claim_tier DESC, business_name) and carries the same flaw.
 *
 * PostgREST cannot express a CASE ordering, so a correct DB-level sort needs
 * either a numeric tier column or a generated sort key. That is worth doing when
 * Featured actually ships (Week 6, Stripe) — at which point this function should
 * be deleted rather than kept, because sorting only within the fetched 50 leaves
 * a featured contractor ranked 51st invisible.
 *
 * Harmless today: every row in the table is 'unclaimed', so this is a no-op that
 * documents the trap. Verified 2026-07-30.
 */
export function sortFeaturedFirst(rows: ContractorResult[]): ContractorResult[] {
  return [...rows].sort((a, b) => {
    const rank = (tier: string) => (tier === "featured" ? 0 : 1);
    return rank(a.claim_tier) - rank(b.claim_tier);
  });
}

export interface CityResult {
  city_slug: string;
  city_name: string;
  county_code: string;
  contractor_count: number | null;
}

/**
 * Matching cities, for the Locations section.
 *
 * No index needed and none added: reference_cities is 710 rows, so a scan is
 * measured in microseconds. Adding a trigram index to a table this small would
 * cost more to maintain than it saves.
 */
export async function searchCities(
  db: Db,
  parsed: ParsedQuery,
): Promise<CityResult[]> {
  if (parsed.tokens.length === 0) return [];

  let query = db
    .from("reference_cities")
    .select("city_slug, city_name, county_code, contractor_count");
  for (const token of parsed.tokens) {
    query = query.or(`city_name.ilike.*${token}*,city_slug.ilike.*${token}*`);
  }

  const { data, error } = await query
    .order("contractor_count", { ascending: false, nullsFirst: false })
    .limit(6);

  return error ? [] : ((data ?? []) as CityResult[]);
}

export interface LicenseTypeResult {
  type_code: string;
  type_name: string;
  count: number;
}

/**
 * Matching licence types, for the License Types section.
 *
 * reference_license_types.contractor_count is zero on all 29 rows (never
 * backfilled by the initial import), so the count comes from a live query per
 * matched type. Bounded to 4 matches, so worst case is 4 extra HEAD requests —
 * and in practice a search matches zero or one type.
 */
export async function searchLicenseTypes(
  db: Db,
  parsed: ParsedQuery,
): Promise<LicenseTypeResult[]> {
  if (parsed.tokens.length === 0) return [];

  let query = db
    .from("reference_license_types")
    .select("type_code, type_name");
  for (const token of parsed.tokens) {
    query = query.or(`type_name.ilike.*${token}*,type_code.ilike.*${token}*`);
  }

  const { data, error } = await query.limit(4);
  if (error || !data) return [];

  return Promise.all(
    data.map(async (row) => {
      const { count } = await db
        .from("contractors")
        .select("*", { count: "exact", head: true })
        .eq("license_type", row.type_code);
      return { ...row, count: count ?? 0 };
    }),
  );
}

/**
 * county_code -> county_name.
 *
 * FETCHED AND JOINED IN JS BECAUSE THERE IS NO FOREIGN KEY. 01_schema.sql
 * declares contractors.county_code as a bare `text` column with no REFERENCES
 * clause (reference_cities.county_code has one; contractors does not), and
 * PostgREST will only embed across a declared FK. All 67 rows in one request is
 * cheaper than adding the constraint would be disruptive.
 */
export async function getCountyNames(db: Db): Promise<Map<string, string>> {
  const { data, error } = await db
    .from("reference_counties")
    .select("county_code, county_name");
  if (error || !data) return new Map();
  return new Map(data.map((row) => [row.county_code, row.county_name]));
}

/** type_code -> type_name, for the licence-type caption on a result card. */
export async function getLicenseTypeNames(db: Db): Promise<Map<string, string>> {
  const { data, error } = await db
    .from("reference_license_types")
    .select("type_code, type_name");
  if (error || !data) return new Map();
  return new Map(data.map((row) => [row.type_code, row.type_name]));
}

/**
 * "Certified General Contractor" -> "Cert. General Contractor".
 * The mockup abbreviates the leading word to keep the licence column narrow.
 */
export function abbreviateLicenseType(name: string): string {
  return name.replace(/^Certified\b/, "Cert.").replace(/^Registered\b/, "Reg.");
}
