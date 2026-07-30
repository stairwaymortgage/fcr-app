import type { Metadata } from "next";
import Link from "next/link";

import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { FOCUS_RING_PAPER } from "@/lib/focus";
import { DATA_AS_OF } from "@/lib/registry-stats";
import {
  MIN_QUERY_LENGTH,
  SEARCH_LIMIT,
  abbreviateLicenseType,
  getCountyNames,
  getLicenseTypeNames,
  parseQuery,
  searchCities,
  searchContractors,
  searchLicenseTypes,
  sortFeaturedFirst,
  type ContractorResult,
} from "@/lib/search";
import { createClient } from "@/lib/supabase/server";

/**
 * Search results — /search?q=…
 * Source: _handoff/02_mockups_production/01_public_core/search_results.html
 *
 * Server Component. No "use client": the search input is a plain GET form, the
 * Clear control is a link, and every hover is a CSS transition.
 *
 * `q` IS THE PARAM BOTH EXISTING FORMS ALREADY SUBMIT — Header's SearchBar and
 * the homepage hero both post `name="q"` to /search, so this page is the
 * receiver they were written against. Do not rename it without changing both.
 *
 * All reads go through lib/supabase/server.ts (anon, RLS-enforced). No admin
 * client. Query construction and the reads themselves live in lib/search.ts.
 *
 * DYNAMIC BY NATURE, not by accident: the output depends on searchParams, so
 * there is nothing to prerender and no `revalidate` to set. That makes the
 * cookies() caveat noted on the homepage irrelevant here — this route was always
 * going to run per request.
 */

export async function generateMetadata({
  searchParams,
}: {
  searchParams: { q?: string };
}): Promise<Metadata> {
  const { raw } = parseQuery(searchParams.q);
  return {
    title: raw
      ? `“${raw}” — Search · Florida Contractor Registry`
      : "Search · Florida Contractor Registry",
    // Results pages are thin, duplicative and infinite in number; indexing them
    // competes with the county and type pages that are meant to rank.
    robots: { index: false, follow: true },
  };
}

/* ========================================================================== *
 * SHARED BITS
 * ========================================================================== */

/** Gold uppercase mono eyebrow with its leading rule. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3.5 inline-flex items-center gap-2.5 font-mono text-micro font-semibold uppercase tracking-eyebrow text-gold">
      <span aria-hidden="true" className="h-px w-[18px] bg-gold" />
      {children}
    </p>
  );
}

/**
 * Highlight every matched token inside a string.
 *
 * The mockup marks matches with a gold underlay on a <em> that has its italic
 * removed — a highlighter effect rather than emphasis. Reproduced with a
 * background gradient so the band sits under the text baseline exactly as the
 * mockup's inline style does.
 *
 * BUILT WITH A SPLIT, NOT dangerouslySetInnerHTML. The tokens are visitor input;
 * injecting them into markup would be an XSS hole even after sanitizing. React
 * escapes each fragment here by construction.
 *
 * Tokens are escaped for regex use because sanitize() permits `-` and `&`, and a
 * trailing `-` would otherwise make an invalid character range.
 */
function Highlight({
  text,
  tokens,
}: {
  text: string;
  tokens: readonly string[];
}) {
  if (tokens.length === 0) return <>{text}</>;

  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`, "gi"));
  const lower = tokens.map((t) => t.toLowerCase());

  return (
    <>
      {parts.map((part, index) =>
        lower.includes(part.toLowerCase()) ? (
          <mark
            key={index}
            className="bg-[linear-gradient(180deg,transparent_60%,theme(colors.gold.pale)_60%)] px-0.5 text-inherit"
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** Magnifying glass. Inline SVG — no icon font, no data-URI background. */
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

function SectionHeader({
  title,
  count,
  children,
}: {
  title: string;
  count: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-baseline justify-between border-b border-gray-200 pb-4">
      <h2 className="flex items-baseline gap-3.5 font-serif text-[26px] font-semibold tracking-[-0.015em] text-navy">
        {title}
        <span className="font-mono text-ui font-medium tracking-[0.04em] text-gray-500">
          {count}
        </span>
      </h2>
      {children}
    </div>
  );
}

/* ========================================================================== *
 * SEARCH CONTEXT — the big input at the top
 * ========================================================================== */

function SearchContext({
  query,
  summary,
}: {
  query: string;
  summary: React.ReactNode;
}) {
  return (
    <section className="border-b border-gray-200 bg-paper px-8 pb-6 pt-8">
      <div className="mx-auto max-w-shell">
        <Eyebrow>Search Results</Eyebrow>

        <form
          role="search"
          action="/search"
          method="get"
          className="relative mb-[18px] max-w-[720px]"
        >
          <label htmlFor="search-input" className="sr-only">
            Search the registry
          </label>
          <SearchIcon className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-navy" />
          <input
            id="search-input"
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Search by name, license, city, or county..."
            className="w-full border border-gray-300 bg-white py-[18px] pl-14 pr-[50px] text-[17px] tracking-[-0.01em] text-ink focus:border-navy focus:outline-none focus:ring-[3px] focus:ring-navy/[0.08]"
          />
          {/* The mockup draws a <button>Clear</button>. A button that empties an
              input needs client JS; a link to the bare route clears it on the
              server and costs no bundle. Only rendered when there is something
              to clear. */}
          {query && (
            <Link
              href="/search"
              className={`absolute right-[18px] top-1/2 -translate-y-1/2 px-2 py-1 font-mono text-micro uppercase tracking-[0.08em] text-gray-500 transition-colors hover:text-navy ${FOCUS_RING_PAPER}`}
            >
              Clear
            </Link>
          )}
        </form>

        <p className="text-note text-gray-500">{summary}</p>
      </div>
    </section>
  );
}

/* ========================================================================== *
 * CONTRACTOR RESULTS
 * ========================================================================== */

/** Green pill for a current licence, red for anything else. */
function StatusPill({ status }: { status: string }) {
  const isCurrent = status === "Current";
  const tone = isCurrent
    ? "bg-status-successBg text-status-success"
    : "bg-status-errorBg text-status-error";
  const dot = isCurrent ? "bg-status-success" : "bg-status-error";

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 font-mono text-chip font-semibold uppercase tracking-[0.08em] ${tone}`}
    >
      <span aria-hidden="true" className={`h-[5px] w-[5px] rounded-full ${dot}`} />
      {status}
    </span>
  );
}

function ContractorRow({
  row,
  tokens,
  countyName,
  licenseTypeName,
}: {
  row: ContractorResult;
  tokens: readonly string[];
  countyName: string | undefined;
  licenseTypeName: string | undefined;
}) {
  const featured = row.claim_tier === "featured";
  const displayName = row.business_name || row.qualifying_agent_name;
  // Only worth a second line when it says something the first does not.
  const showAgent =
    row.business_name && row.business_name !== row.qualifying_agent_name;

  return (
    <li className="border-b border-gray-200">
      <Link
        href={`/contractor/${row.slug}`}
        className={`grid grid-cols-[1fr_200px_160px_100px] items-center gap-6 px-4 py-5 transition-colors max-[1000px]:grid-cols-1 max-[1000px]:gap-2 ${FOCUS_RING_PAPER} ${
          featured
            ? "bg-gradient-to-b from-[#fbf6e3] to-paper hover:bg-gold-pale"
            : "hover:bg-gold-pale"
        }`}
      >
        <div className="flex items-start gap-3.5">
          {featured && (
            <span
              aria-label="Featured"
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center bg-gold font-serif text-sm font-bold italic text-navy-deep"
            >
              ★
            </span>
          )}
          <div>
            <p className="mb-1 font-serif text-lg font-semibold leading-[1.25] tracking-wordmark text-ink">
              <Highlight text={displayName} tokens={tokens} />
            </p>
            {showAgent && (
              <p className="flex items-center gap-2 text-ui text-gray-500">
                <span>
                  <Highlight text={row.qualifying_agent_name} tokens={tokens} />
                  , Qualifying Agent
                </span>
              </p>
            )}
          </div>
        </div>

        <div className="font-mono">
          {row.license_number ? (
            <p className="mb-0.5 text-note font-semibold tracking-[0.03em] text-gold">
              <Highlight text={row.license_number} tokens={tokens} />
            </p>
          ) : (
            /* ~125k rows carry no licence number — a qualifying business with no
               individual licence. Saying so is better than an empty column. */
            <p className="mb-0.5 text-note font-semibold tracking-[0.03em] text-gray-400">
              No license no.
            </p>
          )}
          <p className="text-micro uppercase tracking-[0.06em] text-gray-500">
            {licenseTypeName
              ? abbreviateLicenseType(licenseTypeName)
              : row.license_type}
          </p>
        </div>

        <div className="text-note text-gray-700">
          <p className="mb-0.5 font-semibold text-ink">
            {row.city ? (
              <Highlight text={row.city} tokens={tokens} />
            ) : (
              "—"
            )}
            {countyName && `, ${countyName} Co.`}
          </p>
          {row.zip && <p>{row.zip}</p>}
        </div>

        <div className="text-right max-[1000px]:text-left">
          <StatusPill status={row.license_status} />
        </div>
      </Link>
    </li>
  );
}

/* ========================================================================== *
 * EMPTY STATES
 * ========================================================================== */

/**
 * The panel shell shared by all three zero-result states.
 * White in the mockup; rendered paper-raised per §03's no-pure-white rule.
 */
function EmptyPanel({
  glyph,
  heading,
  children,
  chips,
}: {
  glyph: string;
  heading: React.ReactNode;
  children: React.ReactNode;
  chips: { href: string; label: string }[];
}) {
  return (
    <div className="mx-auto mt-6 max-w-[720px] border border-gray-200 bg-paper-raised px-12 py-14 text-center">
      <p
        aria-hidden="true"
        className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-gold-pale font-serif text-[32px] italic text-navy"
      >
        {glyph}
      </p>
      <h2 className="mb-3 font-serif text-2xl font-semibold tracking-[-0.015em] text-navy">
        {heading}
      </h2>
      <div className="mx-auto mb-5 max-w-[480px] text-[14.5px] leading-[1.65] text-gray-700">
        {children}
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {chips.map(({ href, label }) => (
          <Link
            key={label}
            href={href}
            className={`border border-gold-light bg-gold-pale px-3.5 py-2 font-mono text-ui font-medium tracking-[0.02em] text-navy transition-colors hover:bg-gold-light ${FOCUS_RING_PAPER}`}
          >
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}

/**
 * No results.
 *
 * NO "DID YOU MEAN", DELIBERATELY. The mockup offers one, but a real spelling
 * suggestion needs trigram similarity() ranked against the whole table, which
 * PostgREST cannot express without a database function. Rather than fake it, the
 * chips offer what can actually be computed: dropping to the first token when
 * the visitor typed several (a genuinely useful broadening), plus the two browse
 * routes. Wire a real suggestion when a search RPC lands.
 */
function NoResults({ query, tokens }: { query: string; tokens: string[] }) {
  const chips = [
    ...(tokens.length > 1
      ? [{ href: `/search?q=${encodeURIComponent(tokens[0])}`, label: `Try just “${tokens[0]}”` }]
      : []),
    { href: "/counties", label: "Browse by County" },
    { href: "/types", label: "Browse by License Type" },
  ];

  return (
    <EmptyPanel
      glyph="!"
      heading={
        <>
          No results for <em className="italic">“{query}”</em>
        </>
      }
      chips={chips}
    >
      We couldn&rsquo;t find any contractors, businesses, locations, or license
      types matching your search. Try one of the suggestions below, or browse the
      registry by county.
    </EmptyPanel>
  );
}

/** Landed on /search with no query at all. Not a failure — a prompt. */
function NoQuery() {
  return (
    <EmptyPanel
      glyph="?"
      heading={<>Search the registry</>}
      chips={[
        { href: "/counties", label: "Browse by County" },
        { href: "/types", label: "Browse by License Type" },
      ]}
    >
      Enter a business name, a qualifying agent, a license number, or a city.
      Try <span className="font-mono text-ink">CGC1520921</span>, or{" "}
      <span className="font-mono text-ink">Davie roofing</span>.
    </EmptyPanel>
  );
}

/**
 * The search itself failed.
 *
 * A SEPARATE STATE FROM "NO RESULTS", ON PURPOSE. Rendering the no-results
 * panel here would tell a visitor the registry holds no matching contractor,
 * which is a claim we have no basis for when the query never completed — and on
 * an accuracy-pitched directory that is the worst possible thing to get wrong.
 * This says what actually happened and invites a retry.
 */
function SearchFailed({ query }: { query: string }) {
  return (
    <EmptyPanel
      glyph="!"
      heading={<>Search is temporarily unavailable</>}
      chips={[
        { href: `/search?q=${encodeURIComponent(query)}`, label: "Try again" },
        { href: "/counties", label: "Browse by County" },
        { href: "/types", label: "Browse by License Type" },
      ]}
    >
      We couldn&rsquo;t complete that search just now — this is a problem on our
      side, not with your search terms. Please try again in a moment. Browsing by
      county or license type still works.
    </EmptyPanel>
  );
}

/** Query present but under the trigram floor. */
function TooShort({ query }: { query: string }) {
  return (
    <EmptyPanel
      glyph="!"
      heading={<>Search term too short</>}
      chips={[
        { href: "/counties", label: "Browse by County" },
        { href: "/types", label: "Browse by License Type" },
      ]}
    >
      &ldquo;{query}&rdquo; doesn&rsquo;t contain a searchable term. Please use
      at least {MIN_QUERY_LENGTH} characters — punctuation and single letters
      are ignored.
    </EmptyPanel>
  );
}

/* ========================================================================== *
 * PAGE
 * ========================================================================== */

export default async function SearchPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const parsed = parseQuery(searchParams.q);
  const db = createClient();

  // Reference lookups run alongside the searches rather than after them — they
  // do not depend on the results, only on the result cards needing names.
  const [contractors, cities, licenseTypes, countyNames, licenseTypeNames] =
    await Promise.all([
      searchContractors(db, parsed),
      searchCities(db, parsed),
      searchLicenseTypes(db, parsed),
      getCountyNames(db),
      getLicenseTypeNames(db),
    ]);

  const rows = sortFeaturedFirst(contractors.rows);
  const totalMatches = contractors.total + cities.length + licenseTypes.length;
  const hasAnything = rows.length > 0 || cities.length > 0 || licenseTypes.length > 0;

  const summary = !parsed.raw ? (
    "Search 266,305 contractor records by name, license number, or city."
  ) : parsed.tooShort ? (
    <>Enter at least {MIN_QUERY_LENGTH} characters.</>
  ) : (
    <>
      <strong className="font-mono font-semibold text-ink">
        {totalMatches.toLocaleString("en-US")}{" "}
        {totalMatches === 1 ? "result" : "results"}
      </strong>{" "}
      · Searched{" "}
      {parsed.tokens.map((token, index) => (
        <span key={token}>
          {index > 0 && ", "}
          <strong className="font-mono font-semibold text-ink">{token}</strong>
        </span>
      ))}
      , contractors, and locations
      {contractors.matchedByLicenseNumber && " · matched by license number"}
    </>
  );

  return (
    <>
      <Header statsTimestamp={DATA_AS_OF} searchQuery={parsed.raw} />
      <SearchContext query={parsed.raw} summary={summary} />

      <main className="mx-auto max-w-shell px-8 pb-[88px] pt-12">
        {!parsed.raw && <NoQuery />}
        {parsed.tooShort && <TooShort query={parsed.raw} />}

        {/* Order matters: a failed query must claim the empty slot before
            NoResults can, or a broken search reads as an empty registry. */}
        {parsed.tokens.length > 0 && contractors.failed && (
          <SearchFailed query={parsed.raw} />
        )}

        {parsed.tokens.length > 0 && !contractors.failed && !hasAnything && (
          <NoResults query={parsed.raw} tokens={parsed.tokens} />
        )}

        {rows.length > 0 && (
          <section className="mb-14">
            <SectionHeader
              title="Contractors"
              count={`${contractors.total.toLocaleString("en-US")} ${
                contractors.total === 1 ? "match" : "matches"
              }`}
            >
              {/* Capped list, honest label. The count above is the true total;
                  this says plainly how much of it is on the page, so 50 rows
                  never read as "all of them". */}
              {contractors.total > rows.length && (
                <p className="font-mono text-micro tracking-[0.04em] text-gray-500">
                  Showing first {rows.length} of{" "}
                  {contractors.total.toLocaleString("en-US")}
                </p>
              )}
            </SectionHeader>

            <ul className="border-t border-gray-200">
              {rows.map((row) => (
                <ContractorRow
                  key={row.dbpr_sync_key}
                  row={row}
                  tokens={parsed.tokens}
                  countyName={
                    row.county_code
                      ? countyNames.get(row.county_code)
                      : undefined
                  }
                  licenseTypeName={licenseTypeNames.get(row.license_type)}
                />
              ))}
            </ul>

            {contractors.total > SEARCH_LIMIT && (
              <p className="mt-6 text-note text-gray-700">
                Narrow your search to see more — add a city, or use the license
                number.
              </p>
            )}
          </section>
        )}

        {cities.length > 0 && (
          <section className="mb-14">
            <SectionHeader
              title="Locations"
              count={`${cities.length} ${cities.length === 1 ? "match" : "matches"}`}
            />
            <div className="grid grid-cols-3 gap-4 max-[1000px]:grid-cols-1">
              {cities.map((city) => (
                <Link
                  key={city.city_slug}
                  href={`/city/${city.city_slug}`}
                  className={`flex flex-col gap-2 border border-gray-200 bg-paper-raised px-6 py-[22px] transition-colors hover:border-gold hover:bg-gold-pale ${FOCUS_RING_PAPER}`}
                >
                  <span className="font-mono text-label font-semibold uppercase tracking-label text-gold">
                    City · {countyNames.get(city.county_code) ?? "Florida"} County
                  </span>
                  <span className="font-serif text-[22px] font-semibold leading-[1.2] tracking-[-0.015em] text-navy">
                    <Highlight text={city.city_name} tokens={parsed.tokens} />, FL
                  </span>
                  <span className="font-mono text-xs tracking-[0.04em] text-gray-500">
                    {(city.contractor_count ?? 0).toLocaleString("en-US")}{" "}
                    contractors licensed
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {licenseTypes.length > 0 && (
          <section className="mb-14">
            <SectionHeader
              title="License Types"
              count={`${licenseTypes.length} ${
                licenseTypes.length === 1 ? "match" : "matches"
              }`}
            />
            <div className="grid grid-cols-3 gap-4 max-[1000px]:grid-cols-1">
              {licenseTypes.map((type) => (
                <Link
                  key={type.type_code}
                  href={`/type/${type.type_name
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-+|-+$/g, "")}`}
                  className={`flex flex-col gap-2 border border-gray-200 bg-paper-raised px-6 py-[22px] transition-colors hover:border-gold hover:bg-gold-pale ${FOCUS_RING_PAPER}`}
                >
                  <span className="font-mono text-label font-semibold uppercase tracking-label text-gold">
                    License Type · {type.type_code}
                  </span>
                  <span className="font-serif text-[22px] font-semibold leading-[1.2] tracking-[-0.015em] text-navy">
                    <Highlight text={type.type_name} tokens={parsed.tokens} />
                  </span>
                  <span className="font-mono text-xs tracking-[0.04em] text-gray-500">
                    {type.count.toLocaleString("en-US")} records
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>

      <Footer lastSyncDate={DATA_AS_OF} />
    </>
  );
}
