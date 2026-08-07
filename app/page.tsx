import Link from "next/link";

import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { dataAsOf } from "@/lib/data-as-of";
import { FOCUS_RING_NAVY, FOCUS_RING_PAPER } from "@/lib/focus";
import {
  COUNTY_COUNT,
  LICENSE_TYPE_COUNT,
  contractorCountLabel,
} from "@/lib/registry-stats";
import { createClient } from "@/lib/supabase/server";

/**
 * Homepage — /
 * Source: _handoff/02_mockups_production/01_public_core/homepage.html
 * Spec: Build Brief v1.3, route table line "01 homepage.html / — Site root.
 *       Hero, search, browse-by-county, browse-by-type, contractor CTA."
 *
 * THE FIRST PAGE THAT RENDERS REAL DATA, so it sets the pattern that /search
 * and /contractor/[slug] follow:
 *
 *   - Server Component. No "use client" anywhere on this page or below it.
 *     Both search inputs are plain GET forms, the sticky header is CSS, and
 *     every hover state is a CSS transition. Nothing needs a hydration bundle.
 *   - Every query goes through lib/supabase/server.ts — the ANON key with RLS
 *     enforced. NOT the admin client. Everything here is public directory data
 *     covered by the "public read contractors" and "public read counties" /
 *     "cities" / "license_types" policies; verified 2026-07-30 that anon reads
 *     contractors and is blocked from leads and claims.
 *   - Queries are issued together in one Promise.all rather than awaited in
 *     sequence, so the page costs roughly one round trip's latency rather than
 *     the sum of all twenty.
 */

/**
 * Revalidate daily — DBPR publishes weekly, so anything shorter re-queries data
 * that cannot have changed.
 *
 * ⚠ THIS CURRENTLY HAS NO EFFECT. `next build` reports / as ƒ (Dynamic), not
 * ○ (Static): lib/supabase/server.ts calls cookies(), and reading cookies opts
 * the whole route out of static rendering, which takes `revalidate` with it.
 * Every visit therefore re-runs all twenty queries below — measured at ~1.25s
 * per request against the live project, against a §09 LCP budget of 2.0s.
 *
 * The declaration is left in place because it is the correct intent and becomes
 * live the moment the cookie dependency goes; it is not load-bearing today.
 *
 * The fix is a decision about the client layer, not about this page: these
 * queries are public aggregates with no per-user component, so the session
 * cookie buys them nothing. Either read them through a cookie-free anon client
 * wrapped in unstable_cache, or hoist them into a route that can stay static.
 * Flagged for review rather than resolved here, because lib/supabase/server.ts
 * is the agreed path for read queries and changing that is not this task's call.
 */
export const revalidate = 86400;

/* ========================================================================== *
 * DATA
 * ========================================================================== */

/**
 * The twelve counties the mockup features, in its order. The first three carry
 * the `featured` gradient treatment.
 *
 * A HAND-PICKED LIST, NOT "TOP 12 BY COUNT". The mockup's order is editorial —
 * Broward, Miami-Dade and Palm Beach lead because that is the South Florida
 * launch market, not because they are the three largest (Orange has more
 * contractors than Palm Beach). Sorting by count would quietly relegate the
 * launch market, so the order is preserved as authored.
 */
const FEATURED_COUNTY_SLUGS = [
  "broward",
  "miami-dade",
  "palm-beach",
  "orange",
  "hillsborough",
  "duval",
  "pinellas",
  "lee",
  "collier",
  "sarasota",
  "brevard",
  "volusia",
] as const;

/** The six licence types the mockup cards, in its order. */
const FEATURED_TYPE_CODES = [
  "CGC",
  "CBC",
  "CRC",
  "CCC",
  "CPC",
  "CMC",
] as const;

/** How many rows the Recently Added list shows. */
const RECENT_LIMIT = 6;

type Db = ReturnType<typeof createClient>;

/**
 * Contractors in one county, counted live.
 *
 * COUNTED PER CELL BECAUSE THERE IS NOWHERE ELSE TO READ IT FROM.
 * reference_cities and reference_license_types both carry a denormalized
 * contractor_count column; reference_counties does not (01_schema.sql), and no
 * view or RPC exposes a GROUP BY. PostgREST cannot aggregate, so the only
 * options were twelve HEAD requests or a schema change, and a migration was not
 * in scope for this task.
 *
 * They run concurrently, so twelve counts cost about one count's latency rather
 * than twelve. They are NOT currently amortised by `revalidate` — see the note
 * on that export; today they run on every request.
 *
 * This does NOT scale to /counties, which needs all 67. That page should get a
 * denormalized reference_counties.contractor_count, backfilled like the cities
 * one, rather than 67 HEAD requests.
 */
async function countByCounty(db: Db, countyCode: string): Promise<number> {
  const { count } = await db
    .from("contractors")
    .select("*", { count: "exact", head: true })
    .eq("county_code", countyCode);
  return count ?? 0;
}

/**
 * Contractors of one licence type, counted live.
 *
 * reference_license_types.contractor_count EXISTS BUT IS ALL ZEROS — the column
 * is in the schema and was never backfilled by the initial import (verified
 * 2026-07-30: every one of the 29 rows reads 0). Reading it would render "0
 * active licenses" on all six cards. Counted live until a backfill lands.
 */
async function countByType(db: Db, typeCode: string): Promise<number> {
  const { count } = await db
    .from("contractors")
    .select("*", { count: "exact", head: true })
    .eq("license_type", typeCode);
  return count ?? 0;
}

/** County cells: reference rows in the mockup's order, each with a live count. */
async function getFeaturedCounties(db: Db) {
  const { data } = await db
    .from("reference_counties")
    .select("county_code, county_name, county_slug")
    .in("county_slug", FEATURED_COUNTY_SLUGS);

  const bySlug = new Map((data ?? []).map((row) => [row.county_slug, row]));

  // Mapped over the constant, not over `data`, so the mockup's editorial order
  // survives — PostgREST returns `in` results in table order, not argument
  // order. Slugs missing from the table drop out rather than render a blank
  // cell.
  const ordered = FEATURED_COUNTY_SLUGS.map((slug) => bySlug.get(slug)).filter(
    (row): row is NonNullable<typeof row> => Boolean(row),
  );

  return Promise.all(
    ordered.map(async (row) => ({
      name: row.county_name,
      slug: row.county_slug,
      count: await countByCounty(db, row.county_code),
    })),
  );
}

/** Type cards: reference rows in the mockup's order, each with a live count. */
async function getFeaturedTypes(db: Db) {
  const { data } = await db
    .from("reference_license_types")
    .select("type_code, type_name")
    .in("type_code", FEATURED_TYPE_CODES);

  const byCode = new Map((data ?? []).map((row) => [row.type_code, row]));

  const ordered = FEATURED_TYPE_CODES.map((code) => byCode.get(code)).filter(
    (row): row is NonNullable<typeof row> => Boolean(row),
  );

  return Promise.all(
    ordered.map(async (row) => ({
      code: row.type_code,
      name: row.type_name,
      count: await countByType(db, row.type_code),
    })),
  );
}

/**
 * Licences that are genuinely active right now — live count.
 *
 * THE PREDICATE IS 'Current' AND NOT YET EXPIRED, AND BOTH HALVES ARE LOAD-
 * BEARING. Status alone does not mean active: 265,804 of the 266,305 rows are
 * license_status = 'Current' (99.8%), because DBPR leaves the status field
 * 'Current' on records that carry no expiration date at all. A tile reading
 * "265,804 Active Licenses" beside a total of 266,305 would be the same
 * overclaim this page just removed, wearing a different label.
 *
 * Adding the expiration test is what makes the number mean something:
 *
 *   265,804  'Current'
 *   122,225  has an expiration_date
 *   119,330  'Current' AND expiration_date >= today   <- this query
 *
 * LIVE, NOT A CONSTANT, because it decreases every day as licences lapse. That
 * is the whole reason it is honest, and the reason it must never be frozen into
 * lib/registry-stats.ts the way the record total is.
 *
 * The date is computed per request rather than pinned, so "active" always means
 * active as of now.
 */
async function getActiveLicenseCount(db: Db): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const { count } = await db
    .from("contractors")
    .select("*", { count: "exact", head: true })
    .eq("license_status", "Current")
    .gte("expiration_date", today);
  return count ?? 0;
}

/**
 * Most recently LICENSED contractors — newest original_license_date first.
 *
 * ORDERED BY original_license_date, NOT updated_at, AND THE DIFFERENCE MATTERS.
 * updated_at looks like the obvious column and is useless here: the initial
 * import wrote all 266,305 rows in one transaction, so every row carries the
 * same updated_at (2026-07-29T16:38:35Z). Ordering by a column whose values are
 * all identical lets Postgres return any six rows it likes, and it returns
 * different ones as the planner sees fit — a section that looks alive while
 * showing noise, and one that stays that way until the weekly cron starts
 * touching individual rows.
 *
 * original_license_date is real DBPR data on every row today. It is populated
 * extract-wide, never future-dated (both verified 2026-07-30), and it answers a
 * question a homeowner actually has — who was licensed most recently — rather
 * than an internal one about our sync. It needs no cron to become meaningful.
 *
 * nullsFirst: false so undated rows sort last instead of leading the list.
 *
 * FILTERED TO ROWS WITH A LICENCE NUMBER so the six shown are proper licences
 * rather than qualifying-business records with nothing to verify.
 *
 * The link target is the STORED slug column, used verbatim — never recomputed.
 * db/migrations/20260730_contractor_slug.sql assigns every slug and suffixes
 * the 1,080 whose natural slug collides, so a TypeScript reimplementation would
 * emit links that 404 for exactly those rows while looking correct.
 */
async function getRecentlyAdded(db: Db) {
  const { data } = await db
    .from("contractors")
    .select(
      "dbpr_sync_key, slug, business_name, qualifying_agent_name, license_number, license_type, city, license_status, original_license_date",
    )
    .not("license_number", "is", null)
    .order("original_license_date", { ascending: false, nullsFirst: false })
    .limit(RECENT_LIMIT);

  return data ?? [];
}

/**
 * "2026-05-22" → "May 22, 2026".
 *
 * Split and reassembled rather than passed to `new Date()`: a bare date string
 * is parsed as UTC midnight and then formatted in the server's zone, which
 * moves the date back a day anywhere west of Greenwich. The licence date is a
 * calendar date, not an instant, so it must never cross a timezone.
 */
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatLicenseDate(value: string | null): string | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/* ========================================================================== *
 * SHARED BITS
 * ========================================================================== */

/**
 * Gold uppercase mono eyebrow with its leading rule.
 * .hero-tag / .section-tag / .contractor-strip-tag are the same treatment at
 * two accent colours, so the rule width and colour are props.
 */
function Eyebrow({
  children,
  tone = "gold",
}: {
  children: React.ReactNode;
  tone?: "gold" | "light";
}) {
  const color = tone === "gold" ? "text-gold" : "text-gold-light";
  const rule = tone === "gold" ? "bg-gold" : "bg-gold-light";
  const width = tone === "gold" ? "w-6" : "w-[18px]";

  return (
    <p
      className={`mb-4 inline-flex items-center gap-2.5 font-mono text-micro font-semibold uppercase tracking-eyebrow ${color}`}
    >
      <span aria-hidden="true" className={`h-px ${width} ${rule}`} />
      {children}
    </p>
  );
}

/** The magnifying glass. Inline SVG — no icon font, no data-URI background. */
function SearchIcon({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={className}
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

/** "View all … →" underlined link. Used under the county grid and type grid. */
function ViewAllLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className={`mt-6 inline-flex items-center gap-2.5 border-b border-gold pb-0.5 text-sm font-semibold text-navy ${FOCUS_RING_PAPER}`}
    >
      {children}
      <span aria-hidden="true">→</span>
    </Link>
  );
}

/* ========================================================================== *
 * SECTIONS
 * ========================================================================== */

/**
 * Hero. The h1's closing phrase is italic per §03's editorial heading pattern.
 *
 * The count in the lede is CONTRACTOR_COUNT, matching the authority band below
 * and the Header above — see the note on that constant. All three move together
 * or none of them do.
 *
 * THE LEDE SAYS "RECORDS", AND THAT WORDING IS LOAD-BEARING. Resolved
 * 2026-07-30: it previously read "All 266,312 active contractor licenses",
 * which was false twice over — the number was the extract's row count rather
 * than the table's, and only 119,330 rows are an unexpired 'Current' licence.
 * "Records" is what the directory actually holds. Do not reintroduce "active"
 * here or in the authority band; see lib/registry-stats.ts for the measured
 * figures behind that.
 */
function Hero() {
  return (
    <section className="border-b border-gray-200 bg-gradient-to-b from-paper to-[#faf6ed] px-8 pb-[72px] pt-[88px]">
      <div className="mx-auto max-w-[1100px]">
        <Eyebrow>A Public Registry of Florida Contractors</Eyebrow>

        <h1 className="mb-6 max-w-[920px] font-serif text-[64px] font-semibold leading-[1.06] tracking-[-0.025em] text-navy max-[1000px]:text-[44px]">
          Look up <em className="italic text-navy-deep">any licensed contractor</em>{" "}
          in Florida.
        </h1>

        {/* "records", not "licenses" — the count includes rows that are not an
            active licence. Changing this one word makes the page false. */}
        <p className="mb-11 max-w-[660px] text-[19px] leading-[1.55] tracking-[-0.005em] text-gray-700">
          All {contractorCountLabel()} Florida contractor records from the DBPR —
          searchable by name, business, license number, or location. Verify
          before you sign.
        </p>

        {/* Second search entry point on the page; the Header carries the other.
            Both are plain GET forms posting `q` to /search — no client JS, and
            they keep working with scripting disabled. */}
        <form
          role="search"
          action="/search"
          method="get"
          className="relative mb-[18px] max-w-[720px]"
        >
          <label htmlFor="hero-search" className="sr-only">
            Search the registry
          </label>
          <SearchIcon className="pointer-events-none absolute left-6 top-1/2 h-[22px] w-[22px] -translate-y-1/2 text-navy" />
          <input
            id="hero-search"
            type="text"
            name="q"
            placeholder='Try: "Aceca Construction", "CGC1520921", "Davie roofing"...'
            className="w-full border border-gray-300 bg-white py-[22px] pl-16 pr-7 text-[17px] tracking-[-0.01em] text-ink transition-[border-color,box-shadow] focus:border-navy focus:outline-none focus:ring-[3px] focus:ring-navy/[0.08]"
          />
        </form>

        <p className="pl-7 text-ui text-gray-500">
          Or browse by <strong className="font-medium text-gray-700">county</strong>,{" "}
          <strong className="font-medium text-gray-700">city</strong>, or{" "}
          <strong className="font-medium text-gray-700">license type</strong>{" "}
          below.
        </p>
      </div>
    </section>
  );
}

/**
 * Authority band — the navy stats strip.
 *
 * NOT components/StatsStrip.tsx. That component is the dashboard metric grid
 * (bordered cards on paper, navy 32px numbers); Build Brief §11 lists its usage
 * as contractor_inquiries and the four admin pages, and the homepage is on
 * neither its list nor the mockup's. This band is a different thing that
 * happens to also show four numbers: navy background, gold 38px serif, white
 * mono labels, no borders, no cards.
 *
 * FIVE TILES, NOT THE MOCKUP'S FOUR. The mockup's first tile is labelled
 * "Active Licenses" over the total record count, which is simply wrong about
 * its own number. Rather than relabel and lose the fact, the band now states
 * both figures plainly:
 *
 *   Contractor Records  266,305   every row we hold        (constant)
 *   Active Licenses     119,330   'Current' and unexpired  (live query)
 *
 * Those two numbers together are the honest version of the single number the
 * mockup tried to show, and the gap between them is the entire reason the
 * earlier copy was false.
 *
 * MIXED CONSTANT AND LIVE, DELIBERATELY, WHICH IS A DEPARTURE. The rule
 * elsewhere on this page is that a figure is either constant or live but never
 * both in one place, so that two totals cannot disagree. These two cannot
 * disagree — they answer different questions, and only one of them is stable
 * enough to freeze. The active count MUST be live: it falls every day as
 * licences lapse, so a constant would be wrong by tomorrow.
 *
 * COUNTY_COUNT and LICENSE_TYPE_COUNT stay constant; they match the live tables
 * exactly (67 and 29, verified 2026-07-30), so querying them would buy nothing.
 */
function AuthorityBand({ activeLicenses }: { activeLicenses: number }) {
  const stats = [
    { value: contractorCountLabel(), label: "Contractor Records" },
    { value: activeLicenses.toLocaleString("en-US"), label: "Active Licenses" },
    { value: String(COUNTY_COUNT), label: "Florida Counties" },
    { value: String(LICENSE_TYPE_COUNT), label: "License Types" },
    { value: "Weekly", label: "DBPR Data Refresh" },
  ];

  return (
    <section className="bg-navy px-8 py-8">
      <dl className="mx-auto grid max-w-shell grid-cols-5 gap-10 max-[1000px]:grid-cols-2 max-[1000px]:gap-8">
        {stats.map(({ value, label }) => (
          // dd before dt in the DOM would read "266,312: Active Licenses"
          // backwards to a screen reader; dt first with order-* for the visual
          // stack matches StatsStrip's approach.
          <div key={label} className="flex flex-col gap-1">
            <dt className="order-2 mt-1.5 font-mono text-micro uppercase tracking-label text-white/75">
              {label}
            </dt>
            <dd className="order-1 font-serif text-[38px] font-semibold leading-none tracking-[-0.02em] text-gold-light">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Browse by county — 12 cells, first three featured, live counts. */
function BrowseCounties({
  counties,
}: {
  counties: Awaited<ReturnType<typeof getFeaturedCounties>>;
}) {
  return (
    <section className="bg-paper px-8 py-[88px]">
      <div className="mx-auto max-w-shell">
        <Eyebrow>Browse by County</Eyebrow>
        <h2 className="mb-3.5 font-serif text-4xl font-semibold leading-[1.15] tracking-[-0.02em] text-navy">
          Every Florida county. <em className="italic">Every contractor.</em>
        </h2>
        <p className="mb-10 max-w-[640px] text-base leading-[1.6] text-gray-700">
          All {COUNTY_COUNT} Florida counties, alphabetically. Each county page
          shows every licensed contractor in that county with their license
          status, type, and contact information.
        </p>

        {/* Single-pixel grid: the container draws top+left, each cell draws
            right+bottom, so interior rules never double up regardless of how
            many columns auto-fill produces. */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] border-l border-t border-gray-200">
          {counties.map(({ name, slug, count }, index) => {
            const featured = index < 3;
            return (
              <Link
                key={slug}
                href={`/county/${slug}`}
                className={`group border-b border-r border-gray-200 px-6 py-5 transition-colors ${FOCUS_RING_PAPER} ${
                  featured
                    ? "bg-gradient-to-b from-gold-pale to-[#fbf4e0]"
                    : "bg-paper-raised hover:bg-gold-pale"
                }`}
              >
                <span className="flex items-baseline justify-between font-serif text-[17px] font-semibold tracking-wordmark">
                  <span
                    className={
                      featured
                        ? "text-navy"
                        : "text-ink transition-colors group-hover:text-navy"
                    }
                  >
                    {name}
                  </span>
                  <span className="font-mono text-micro font-normal tracking-[0.04em] text-gray-500">
                    {count.toLocaleString("en-US")}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>

        <ViewAllLink href="/counties">
          {`View all ${COUNTY_COUNT} counties`}
        </ViewAllLink>
      </div>
    </section>
  );
}

/**
 * Browse by licence type — 6 cards, live counts.
 *
 * The six are the mockup's, kept as authored. Their real counts differ sharply
 * from the mockup's placeholder figures (it shows CGC 28,406 against a true
 * 38,257, and CMC 10,684 against 2,712), so the cards are structurally faithful
 * and numerically honest. If the low ones read badly, swapping CPC/CMC for CAC
 * and CFC — the third and fifth largest — is a one-line change to
 * FEATURED_TYPE_CODES.
 */
function BrowseTypes({
  types,
}: {
  types: Awaited<ReturnType<typeof getFeaturedTypes>>;
}) {
  return (
    // .types-section is `background: white` in the mockup. Rendered as
    // paper-raised: Build Brief §03 prohibits pure white as a surface three
    // separate times, and the token comment records the same resolution for the
    // stats cards. White stays reserved for input fields.
    <section className="border-y border-gray-200 bg-paper-raised px-8 py-[88px]">
      <div className="mx-auto max-w-shell">
        <Eyebrow>Browse by License Type</Eyebrow>
        <h2 className="mb-3.5 font-serif text-4xl font-semibold leading-[1.15] tracking-[-0.02em] text-navy">
          Match the work to the <em className="italic">right license.</em>
        </h2>
        <p className="mb-10 max-w-[640px] text-base leading-[1.6] text-gray-700">
          Florida requires specific license types for different scopes of work. A
          roofer can&rsquo;t do plumbing. A pool contractor can&rsquo;t build
          your kitchen addition. Make sure the contractor you&rsquo;re
          considering is licensed for what they&rsquo;re proposing.
        </p>

        <div className="mt-2 grid grid-cols-3 gap-5 max-[1000px]:grid-cols-1">
          {types.map(({ code, name, count }) => (
            <Link
              key={code}
              href={`/type/${code.toLowerCase()}`}
              className={`border border-gray-200 bg-paper px-7 py-[26px] transition-colors hover:border-gold hover:bg-paper-raised ${FOCUS_RING_PAPER}`}
            >
              <span className="mb-2.5 block font-mono text-micro font-semibold tracking-label text-gold">
                {code}
              </span>
              <span className="mb-2 block font-serif text-[19px] font-semibold leading-[1.3] tracking-wordmark text-ink">
                {name}
              </span>
              {/* "records", not "active licenses" — same correction as the
                  hero. These are all rows of that licence type, not a count of
                  currently-valid ones. */}
              <span className="block text-ui text-gray-500">
                {count.toLocaleString("en-US")} records
              </span>
            </Link>
          ))}
        </div>

        <ViewAllLink href="/types">
          {`View all ${LICENSE_TYPE_COUNT} license types`}
        </ViewAllLink>
      </div>
    </section>
  );
}

/**
 * Recently Added — NOT IN THE MOCKUP. Added on request 2026-07-30.
 *
 * The mockup has no such section; the only reference anywhere in the handoff is
 * a footer link to /updated. Placed directly after the two browse blocks
 * because it is a third way into the same data, and before "Before You Sign",
 * which closes the browse run and pivots to advice.
 *
 * Says "licensed", not "added" or "updated", because that is what the date on
 * each row actually is — see getRecentlyAdded.
 */
function RecentlyAdded({
  contractors,
}: {
  contractors: Awaited<ReturnType<typeof getRecentlyAdded>>;
}) {
  if (contractors.length === 0) return null;

  return (
    <section className="bg-paper px-8 py-[88px]">
      <div className="mx-auto max-w-shell">
        <Eyebrow>Recently Added</Eyebrow>
        <h2 className="mb-3.5 font-serif text-4xl font-semibold leading-[1.15] tracking-[-0.02em] text-navy">
          Newest licenses in <em className="italic">the registry.</em>
        </h2>
        <p className="mb-10 max-w-[640px] text-base leading-[1.6] text-gray-700">
          The most recently issued contractor licenses in the latest DBPR
          extract, by the date the license was originally granted.
        </p>

        <ul className="border-t border-gray-200">
          {contractors.map((row) => {
            const displayName = row.business_name || row.qualifying_agent_name;
            const licensed = formatLicenseDate(row.original_license_date);
            return (
              <li key={row.dbpr_sync_key} className="border-b border-gray-200">
                <Link
                  href={`/contractor/${row.slug}`}
                  className={`group flex items-baseline justify-between gap-6 bg-paper-raised px-6 py-[18px] transition-colors hover:bg-gold-pale max-[1000px]:flex-col max-[1000px]:gap-1 ${FOCUS_RING_PAPER}`}
                >
                  <span className="flex items-baseline gap-3">
                    <span className="font-serif text-[17px] font-semibold tracking-wordmark text-ink transition-colors group-hover:text-navy">
                      {displayName}
                    </span>
                    <span className="font-mono text-micro tracking-[0.04em] text-gray-500">
                      {row.license_number}
                    </span>
                  </span>
                  <span className="flex items-baseline gap-3 text-ui text-gray-700">
                    {row.city && <span>{row.city}</span>}
                    {licensed && (
                      <span className="font-mono text-micro tracking-[0.04em] text-gray-500">
                        Licensed {licensed}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

      </div>
    </section>
  );
}

/** Before You Sign — three static steps. No data. */
function HowToUse() {
  const steps = [
    {
      title: "Verify the license is active.",
      body: "Search by license number or business name. An active license should show “Current” status with an expiration date in the future. Inactive, expired, or revoked licenses are red flags.",
    },
    {
      title: "Match the license to the work.",
      body: "A CGC (General) can do most construction. A CRC (Residential) is limited to 1-2 family homes. A roofing license doesn’t cover electrical. The license type defines the legal scope of work.",
    },
    {
      title: "Check the qualifying agent.",
      body: "Businesses operate under a “qualifying agent” — a licensed individual who legally backs the business. If a contractor’s qualifying agent changed recently, ask why. This is often a warning sign.",
    },
  ];

  return (
    <section className="bg-paper px-8 py-[88px]">
      <div className="mx-auto max-w-shell">
        <Eyebrow>Before You Sign</Eyebrow>
        <h2 className="mb-3.5 font-serif text-4xl font-semibold leading-[1.15] tracking-[-0.02em] text-navy">
          Three minutes can save you <em className="italic">thousands.</em>
        </h2>
        <p className="mb-10 max-w-[640px] text-base leading-[1.6] text-gray-700">
          Most Florida homeowners hire contractors without verifying license
          details. The information is public and free. Here&rsquo;s the
          three-step check we recommend.
        </p>

        <ol className="mt-4 grid grid-cols-3 gap-12 max-[1000px]:grid-cols-1 max-[1000px]:gap-8">
          {steps.map(({ title, body }, index) => (
            <li key={title}>
              {/* Numbered navy square with the inset gold rule — the same mark
                  as the logo, at step scale. */}
              <span
                aria-hidden="true"
                className="relative flex h-9 w-9 items-center justify-center bg-navy font-serif text-lg font-semibold text-gold-light"
              >
                <span className="absolute inset-[3px] border border-gold" />
                {index + 1}
              </span>
              <h3 className="mb-2.5 mt-[18px] font-serif text-[22px] font-semibold leading-[1.3] tracking-[-0.015em] text-ink">
                {title}
              </h3>
              <p className="text-[14.5px] leading-[1.65] text-gray-700">
                {body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** For Contractors CTA. Static; links to the (built later) claim funnel. */
function ContractorCta() {
  return (
    <section className="border-t border-white/5 bg-navy-deep px-8 py-14">
      <div className="mx-auto flex max-w-[1100px] items-center justify-between gap-10 max-[1000px]:flex-col max-[1000px]:items-start">
        <div className="max-w-[640px]">
          <Eyebrow tone="light">For Contractors</Eyebrow>
          <h3 className="mb-3 font-serif text-[28px] font-semibold leading-[1.2] tracking-[-0.015em] text-paper">
            Your profile is already on this site.{" "}
            <em className="italic text-gold-light">Claim it free.</em>
          </h3>
          <p className="text-[15px] leading-[1.6] text-white/75">
            If you&rsquo;re a licensed Florida contractor, your profile exists
            here. Claim it to add your photo, your website, your reviews — and to
            verify that the information shown matches what you want homeowners to
            see.
          </p>
        </div>

        <Link
          href="/join"
          className={`whitespace-nowrap bg-gold px-8 py-4 text-sm font-semibold uppercase tracking-[0.04em] text-navy-deep transition-colors hover:bg-gold-light ${FOCUS_RING_NAVY}`}
        >
          Claim Your Profile →
        </Link>
      </div>
    </section>
  );
}

/* ========================================================================== *
 * PAGE
 * ========================================================================== */

export default async function Home() {
  const db = createClient();

  // One await, not three. Each of these fans out into its own concurrent count
  // queries, so the whole page costs roughly the slowest single query rather
  // than the sum of twenty.
  const [counties, types, recentlyAdded, activeLicenses, asOf] = await Promise.all([
    getFeaturedCounties(db),
    getFeaturedTypes(db),
    getRecentlyAdded(db),
    getActiveLicenseCount(db),
    dataAsOf(),
  ]);

  return (
    <>
      <Header currentPath="/" statsTimestamp={asOf} />

      {/* contractorCount is left to Header's default, which is
          CONTRACTOR_COUNT — the same constant the hero and band read. */}
      <main>
        <Hero />
        <AuthorityBand activeLicenses={activeLicenses} />
        <BrowseCounties counties={counties} />
        <BrowseTypes types={types} />
        <RecentlyAdded contractors={recentlyAdded} />
        <HowToUse />
        <ContractorCta />
      </main>

      <Footer lastSyncDate={asOf} />
    </>
  );
}
