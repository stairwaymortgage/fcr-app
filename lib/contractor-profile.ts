import type { createClient } from "@/lib/supabase/server";

/**
 * Contractor profile reads — everything /contractor/[slug] needs.
 *
 * All reads use the caller's anon client (lib/supabase/server.ts) under RLS.
 * The only privileged statement anywhere near this page is the inquiry INSERT
 * in ./actions.ts, which is deliberately isolated there.
 */

type Db = ReturnType<typeof createClient>;

/**
 * A PROFILE IS ONE LICENCE ROW, BUT IT DISPLAYS THE AGENT'S WHOLE STACK.
 *
 * contractors has one row per licence, not per business: Aceca Construction
 * appears three times (CGC, CCC, CFC) because it holds three licences. The slug
 * therefore identifies a single row.
 *
 * The mockup's "Active State Licenses" table lists five licences on Aceca's
 * page, and those five are exactly the rows sharing qualifying_agent_name
 * 'ACERO, CRISTIAN F' — including two under different business names (Green
 * Bolt General Construction, Complete Highway Improvement). Verified against
 * live data 2026-07-30. So the grouping key for the licence table is the
 * qualifying agent, not the business.
 */
const PROFILE_COLUMNS =
  "dbpr_sync_key, slug, business_name, qualifying_agent_name, license_number, " +
  "license_type, is_business, address_line, city, county_code, state, zip, " +
  "license_status, license_status_secondary, original_license_date, " +
  "expiration_date, disciplinary_codes, claim_tier, claimed_at, " +
  "custom_about_text, custom_logo_path, custom_owner_photo_path, custom_phone, " +
  "custom_email, custom_website_url, custom_service_area, claimed_by_user_id";

export interface ContractorProfile {
  dbpr_sync_key: string;
  slug: string;
  business_name: string | null;
  qualifying_agent_name: string;
  license_number: string | null;
  license_type: string;
  is_business: boolean;
  address_line: string | null;
  city: string | null;
  county_code: string | null;
  state: string;
  zip: string | null;
  license_status: string;
  license_status_secondary: string | null;
  original_license_date: string | null;
  expiration_date: string | null;
  disciplinary_codes: string[] | null;
  claim_tier: string;
  claimed_at: string | null;
  custom_about_text: string | null;
  /** STORAGE PATHS, not URLs — see the column comments in the lockdown migration. */
  custom_logo_path: string | null;
  custom_owner_photo_path: string | null;
  custom_phone: string | null;
  custom_email: string | null;
  custom_website_url: string | null;
  custom_service_area: string | null;
  /**
   * ═════════════════════════════════════════════════════════════════════════
   * FETCHED FOR A CONDITIONAL. NEVER RENDERED, NEVER SERIALISED.
   *
   * This is an auth.users id, and it is deliberately not in any output. It
   * exists in the payload of /contractor/[slug] for exactly one purpose:
   * isClaimed() below. Verified on 2026-08-03 —
   *
   *   - no JSX on the public profile prints it;
   *   - getContractorBySlug has exactly two callers, both in
   *     app/contractor/[slug]/page.tsx (generateMetadata and the page);
   *   - that file ships NO client component, so React never serialises the
   *     contractor object into an RSC payload. The only client component in
   *     that route tree is claim/ClaimForm.tsx, which receives named scalar
   *     props (slug, syncKey, licenseNumber, businessName, defaultEmail,
   *     attestation) and never the row.
   *
   * ⚠ THE LAST POINT IS A CONDITION, NOT A FACT ABOUT THE COLUMN. The moment
   * anything on that page becomes a Client Component and is handed
   * `contractor`, this uuid lands in the HTML as serialised props and is
   * readable with View Source. If you add one, pass named fields — never the
   * whole row.
   * ═════════════════════════════════════════════════════════════════════════
   */
  claimed_by_user_id: string | null;
}

/**
 * One contractor by slug.
 *
 * maybeSingle() rather than single(): a missing slug is an ordinary 404, not an
 * exception. single() throws PGRST116 on zero rows, which would surface as a
 * 500 for what is just a mistyped URL.
 *
 * Served by idx_contractors_slug (UNIQUE) — one index probe, no scan.
 */
export async function getContractorBySlug(
  db: Db,
  slug: string,
): Promise<ContractorProfile | null> {
  const { data, error } = await db
    .from("contractors")
    .select(PROFILE_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("[profile] lookup failed", { slug, message: error.message });
    return null;
  }

  // Cast through unknown deliberately. supabase-js parses the select string at
  // the type level to infer the row shape, and it can only do that for a single
  // string literal — PROFILE_COLUMNS is assembled with `+` for readability, so
  // inference degrades to GenericStringError and a direct cast is rejected. The
  // runtime shape is still exactly ContractorProfile; only the inference is
  // lost. Keep the interface in step with the column list by hand.
  return (data as unknown as ContractorProfile) ?? null;
}

/**
 * FORMERLY getManagedContractorBySlug, now deliberately gone.
 *
 * It existed only to fetch claimed_by_user_id alongside the profile, on the
 * argument that the public page had no business carrying a user id it did not
 * use. That argument lost to a correctness one: isClaimed() has to read the
 * ownership column, so it is in PROFILE_COLUMNS and the second function was
 * two near-identical queries with two log tags.
 *
 * /manage/[slug] uses getContractorBySlug and compares claimed_by_user_id to
 * the session itself. See the note on the field for why carrying it is safe,
 * and for the condition that makes it safe.
 */

export interface SiblingLicense {
  dbpr_sync_key: string;
  slug: string;
  license_number: string | null;
  license_type: string;
  business_name: string | null;
  original_license_date: string | null;
  expiration_date: string | null;
  license_status: string;
  license_status_secondary: string | null;
}

/**
 * Every licence held by the same qualifying agent, oldest first.
 *
 * Bounded at 25. A qualifying agent legally may hold many licences, and an
 * unbounded select here would be an unbounded query driven by a URL — the same
 * hazard the search page caps at 50. Twenty-five comfortably covers the real
 * distribution (Aceca's agent holds five).
 */
export async function getSiblingLicenses(
  db: Db,
  qualifyingAgentName: string,
): Promise<SiblingLicense[]> {
  const { data, error } = await db
    .from("contractors")
    .select(
      "dbpr_sync_key, slug, license_number, license_type, business_name, " +
        "original_license_date, expiration_date, license_status, license_status_secondary",
    )
    .eq("qualifying_agent_name", qualifyingAgentName)
    .order("original_license_date", { ascending: true, nullsFirst: false })
    .limit(25);

  if (error) return [];
  // Same concatenated-select inference limitation as getContractorBySlug.
  return (data ?? []) as unknown as SiblingLicense[];
}

/** county_code -> county_name. Single row, not the whole table. */
export async function getCountyName(
  db: Db,
  countyCode: string | null,
): Promise<string | null> {
  if (!countyCode) return null;
  const { data } = await db
    .from("reference_counties")
    .select("county_name, county_slug")
    .eq("county_code", countyCode)
    .maybeSingle();
  return data?.county_name ?? null;
}

/** county_code -> county_slug, for the breadcrumb link. */
export async function getCountySlug(
  db: Db,
  countyCode: string | null,
): Promise<string | null> {
  if (!countyCode) return null;
  const { data } = await db
    .from("reference_counties")
    .select("county_slug")
    .eq("county_code", countyCode)
    .maybeSingle();
  return data?.county_slug ?? null;
}

export interface LicenseTypeInfo {
  type_code: string;
  type_name: string;
  scope_description: string | null;
}

/**
 * Type names for every code in the licence table, in one request.
 *
 * `in` rather than one lookup per row: a five-licence agent would otherwise
 * cost five round trips for data that lives in a 29-row table.
 */
export async function getLicenseTypeInfo(
  db: Db,
  typeCodes: string[],
): Promise<Map<string, LicenseTypeInfo>> {
  if (typeCodes.length === 0) return new Map();
  const { data, error } = await db
    .from("reference_license_types")
    .select("type_code, type_name, scope_description")
    .in("type_code", Array.from(new Set(typeCodes)));

  if (error || !data) return new Map();
  return new Map(data.map((row) => [row.type_code, row as LicenseTypeInfo]));
}

/* ========================================================================== *
 * DERIVED VALUES
 * ========================================================================== */

/**
 * Is this profile under the owner's control?
 *
 * THERE IS NO is_claimed COLUMN. 01_schema.sql models this as claim_tier —
 * 'unclaimed' | 'claimed' | 'featured' — alongside claimed_by_user_id and
 * claimed_at. Anything other than 'unclaimed' means a verified owner has taken
 * the profile over, so custom_* fields become trustworthy enough to render.
 *
 * ALL 266,305 ROWS ARE 'unclaimed' TODAY (verified 2026-07-30), because the
 * claim flow ships in Week 5. Every claimed-only branch below is therefore
 * written but unreachable in production right now, and cannot be verified by
 * loading a real page. Treat those branches as untested until the first real
 * claim exists.
 */
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OWNERSHIP, NOT TIER. THIS USED TO READ claim_tier AND THAT WAS THE BUG.
 *
 * approve_claim() has always written claimed_by_user_id and never claim_tier,
 * so an approved profile sat at 'unclaimed' and this returned false. Live on
 * 2026-08-03: a verified contractor saved an About text and contact details,
 * and their public page still showed the DBPR-generated description, the "has
 * not been claimed by its owner" disclaimer, the claim box, and none of their
 * contact fields. Meanwhile /manage worked perfectly, because it gates on
 * claimed_by_user_id — two definitions of "claimed", and approval satisfied
 * only one.
 *
 * claimed_by_user_id is the right one and always was: it is the column every
 * RLS policy tests, the column update_own_contractor_profile() checks, and the
 * column that decides whether the contractor can do anything at all. A profile
 * is claimed when someone owns it.
 *
 * 20260803_claim_tier_on_approval.sql fixes the function and backfills, so the
 * two columns now agree. This reads the one that cannot drift.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function isClaimed(contractor: ContractorProfile): boolean {
  return contractor.claimed_by_user_id !== null;
}

export function isFeatured(contractor: ContractorProfile): boolean {
  return contractor.claim_tier === "featured";
}

/** Business name when there is one, else the individual licensee. */
export function displayName(contractor: ContractorProfile): string {
  return contractor.business_name || contractor.qualifying_agent_name;
}

/**
 * Name casing lives in lib/format-name.ts — one implementation for the whole
 * app. These aliases keep the existing call sites in this page working while
 * pointing at it.
 */
export { businessName as formatBusinessName, personName as formatPersonName } from "@/lib/format-name";

/**
 * "2012-09-24" -> "September 24, 2012".
 *
 * Split rather than passed to Date(): a bare date string parses as UTC midnight
 * and formats in the server's zone, moving the date back a day west of
 * Greenwich. A licence date is a calendar date, not an instant.
 */
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatDate(value: string | null): string | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "2012-09-24" -> "Sept 2012", for the compact licence table. */
export function formatShortDate(value: string | null): string | null {
  if (!value) return null;
  const [y, m] = value.split("-").map(Number);
  if (!y || !m) return null;
  return `${MONTHS[m - 1].slice(0, 4).replace("June", "Jun").replace("July", "Jul")} ${y}`;
}

export function yearOf(value: string | null): number | null {
  if (!value) return null;
  const y = Number(value.split("-")[0]);
  return Number.isFinite(y) ? y : null;
}

/**
 * A licence is current if DBPR says so AND it has not expired.
 *
 * Both halves, for the same reason the homepage's active count needs both:
 * 99.8% of rows carry license_status 'Current', including many with no
 * expiration date at all, so status alone means very little.
 */
export function isCurrentLicense(row: {
  license_status: string;
  expiration_date: string | null;
}): boolean {
  if (row.license_status !== "Current") return false;
  if (!row.expiration_date) return false;
  return row.expiration_date >= new Date().toISOString().slice(0, 10);
}

/** The DBPR public verification URL for a licence number. */
export function dbprVerifyUrl(licenseNumber: string): string {
  return `https://www.myfloridalicense.com/wl11.asp?mode=1&namechange=Y&licnbr=${encodeURIComponent(licenseNumber)}`;
}
