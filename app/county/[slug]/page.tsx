import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import ContractorList from "@/components/browse/ContractorList";
import { Breadcrumb } from "@/components/browse/PageHero";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import StairwayAd from "@/components/StairwayAd";
import { getContractorPage, parsePage } from "@/lib/browse";
/**
 * ⚠ THE BROWSE READS COME FROM browse-cached, NOT browse. Every import moved
 * here on 2026-09-01 is page-independent and now served from Next's Data Cache
 * under the "browse" tag; the two that stayed above vary with ?page and are
 * deliberately uncached. Importing any of these from "@/lib/browse" still
 * compiles and still returns the right answer — it just silently reinstates a
 * query per request, which is the whole thing this change removed.
 *
 * They take NO db argument by design: each builds its own cookie-free client
 * inside the cached callback. See lib/browse-cached.ts.
 */
import {
  getCitiesInCounty,
  getCountyBySlug,
  getCountyNameMap,
  getTypeCountsInCounty,
  getTypeNameMap,
  getTypesWithCounts,
} from "@/lib/browse-cached";
import { FOCUS_RING_PAPER } from "@/lib/focus";
import { dataAsOf } from "@/lib/data-as-of";
import { publicPageMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

/**
 * Single county — /county/[slug]
 * Source: _handoff/02_mockups_production/02_indexes_browse/broward_county_index.html
 *
 * Build Brief route table: "Single county template. ALSO serves as template for
 * /city/[slug] and /type/[slug]" — hence components/browse/ContractorList.
 *
 * THE LICENCE-TYPE FILTER IS A LINK, NOT A CHECKBOX. The mockup draws
 * checkboxes, which need client JS to do anything. ?type=CGC is a plain
 * navigation, works with scripting off, is linkable and indexable, and lands on
 * idx_contractors_county_type_tier — the same index already serving the
 * unfiltered page. Multi-select is what the checkboxes imply; it can return as
 * a repeated query param when there is a reason for it.
 *
 * The conversion banner the mockup opens with is Week 4 Day 5, with the
 * diagnostic it feeds. Not built — same call as the homepage and profile.
 */

export const revalidate = 86400;

/**
 * ⚠ THE LINE ABOVE IS NOT IN EFFECT TODAY. Verified 2026-09-01: this route
 * answers x-vercel-cache: MISS on every request. It reads searchParams for
 * pagination AND renders through lib/supabase/server.ts, which calls cookies()
 * — either alone forces dynamic rendering. See the caching block at the top of
 * app/contractor/[slug]/page.tsx for the full mechanism. Left in place rather
 * than deleted because making it true is a wanted change; it is simply a larger
 * one than the cap below, since paginated output has to be cached per page.
 * Do not read it as evidence that this route is cached.
 */

/**
 * A CEILING, NOT A TARGET — the same blast-radius limiter added to the profile
 * route on 2026-09-01, and for the same incident. Measured p95 here is 0.73s
 * warm and 4.37s on a cold render, so 20s leaves ample headroom while removing
 * the 300-second default that let 158 requests hang in the pooler queue and
 * burn 13.2 function-hours in five minutes.
 */
export const maxDuration = 20;

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const county = await getCountyBySlug(params.slug);
  if (!county) return { title: "County not found · Florida Contractor Registry" };

  /**
   * Title and description are UNCHANGED and deliberately so — they are indexed
   * across all 67 counties, and restyling them (adding the site-name suffix
   * every other page carries, for instance) is a bulk rewrite of live SERP text
   * that is Jim's call, not a side effect of fixing the social card.
   *
   * publicPageMetadata adds the openGraph and twitter blocks these pages never
   * had: without them Next hands down app/layout.tsx's, whose og:url is "/" —
   * so every county page told a scraper it was the homepage.
   */
  return {
    ...publicPageMetadata({
      title: `Licensed contractors in ${county.county_name} County, Florida`,
      description: `Every contractor record on file with the Florida DBPR for ${county.county_name} County — license numbers, types, status and city, refreshed weekly.`,
      path: `/county/${county.county_slug}`,
    }),
    robots: { index: true, follow: true },
  };
}

export default async function CountyPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { page?: string; type?: string };
}) {
  const db = createClient();
  const asOf = await dataAsOf();
  const county = await getCountyBySlug(params.slug);
  if (!county) notFound();

  const page = parsePage(searchParams.page);
  // Uppercased and validated against the reference table below — never passed
  // to the query straight from the URL.
  const rawType = (searchParams.type ?? "").toUpperCase().replace(/[^A-Z]/g, "");

  const [allTypes, countyNames, typeNames, cities, typeCounts] = await Promise.all([
    getTypesWithCounts(),
    getCountyNameMap(),
    getTypeNameMap(),
    getCitiesInCounty(county.county_code),
    // One RPC for all 29 counts. Moved into this batch because the list query
    // below now depends on its result for the total. Cached since 2026-09-01 —
    // it was the most expensive read on this page at 440 ms, and with only 67
    // possible keys it is a cache hit on all but the first request per county.
    getTypeCountsInCounty(county.county_code),
  ]);

  const activeType = allTypes.some((t) => t.type_code === rawType) ? rawType : "";

  /**
   * THE TOTAL IS NOT COUNTED AGAIN — both values are already in hand.
   *
   * Unfiltered, it is reference_counties.contractor_count, maintained by the
   * importer. Filtered, it is the entry the RPC above already returned for that
   * licence type. Asking Postgres to count 26,632 rows a second time to learn a
   * number we are holding cost 122 ms per request.
   *
   * ⚠ THE STORED COUNT CAN LAG. reference_counties.contractor_count is derived
   * at import and repaired by hand; /admin/sync has a drift check for exactly
   * this. The city index page already accepts the same trade and says so. If it
   * is ever wrong the page shows a stale total above an accurate list, which is
   * the same failure mode /cities has had all along — visible, bounded, and
   * cheaper than the alternative on every request forever.
   *
   * undefined (not 0) when neither is known, so getContractorPage falls back to
   * counting rather than confidently rendering "0 contractor records".
   */
  const knownTotal = activeType
    ? typeCounts.get(activeType)
    : (county.contractor_count ?? undefined);

  const result = await getContractorPage(
    db,
    activeType
      ? { county_code: county.county_code, license_type: activeType }
      : { county_code: county.county_code },
    page,
    knownTotal,
  );

  const hrefFor = (p: number) => {
    const q = new URLSearchParams();
    if (activeType) q.set("type", activeType);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return `/county/${county.county_slug}${s ? `?${s}` : ""}`;
  };

  const sortedTypeCounts = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <Header currentPath="/counties" statsTimestamp={asOf} />

      <section className="border-b border-gray-200 bg-gradient-to-b from-paper to-[#faf6ed] px-8 pb-9 pt-8">
        <div className="mx-auto max-w-shell">
          <Breadcrumb
            crumbs={[
              { href: "/", label: "Home" },
              { href: "/counties", label: "Florida Counties" },
              { label: `${county.county_name} County` },
            ]}
          />
          <h1 className="mb-3.5 font-serif text-[42px] font-semibold leading-[1.08] tracking-[-0.025em] text-navy max-[900px]:text-[32px]">
            Licensed contractors in{" "}
            <em className="italic">{county.county_name} County</em>
          </h1>
          <p className="max-w-[720px] text-[17px] leading-[1.55] text-gray-700">
            <strong className="font-semibold text-ink">
              {result.total.toLocaleString("en-US")} contractor records
            </strong>{" "}
            with a mailing address in {county.county_name} County, Florida
            {activeType && (
              <>
                , holding a{" "}
                <strong className="font-semibold text-ink">
                  {typeNames.get(activeType) ?? activeType}
                </strong>{" "}
                license
              </>
            )}
            . All licenses republished weekly from Florida DBPR public records.
          </p>
        </div>
      </section>

      {cities.length > 0 && (
        <div className="border-b border-gray-200 bg-gray-50 px-8 py-4">
          <div className="mx-auto flex max-w-shell flex-wrap items-center gap-2">
            <span className="mr-2 font-mono text-label font-semibold uppercase tracking-label text-gray-500">
              Browse by city
            </span>
            {cities.map((city) => (
              <Link
                key={city.city_slug}
                href={`/city/${city.city_slug}`}
                className={`border border-gray-300 bg-paper-raised px-3 py-1.5 text-ui text-navy transition-colors hover:border-gold hover:bg-gold-pale ${FOCUS_RING_PAPER}`}
              >
                {city.city_name}{" "}
                <span className="font-mono text-micro text-gray-500">
                  {(city.contractor_count ?? 0).toLocaleString("en-US")}
                </span>
              </Link>
            ))}
            <Link
              href="/cities"
              className={`border-b border-gold pb-0.5 text-ui font-semibold text-navy ${FOCUS_RING_PAPER}`}
            >
              View all cities →
            </Link>
          </div>
        </div>
      )}

      <main className="mx-auto grid max-w-shell grid-cols-[260px_1fr_300px] gap-12 px-8 pb-[72px] pt-10 max-[1200px]:grid-cols-[260px_1fr] max-[1000px]:grid-cols-1 max-[1000px]:gap-8">
        <aside className="self-start">
          <h2 className="mb-4 border-b border-gray-200 pb-3 font-mono text-label font-semibold uppercase tracking-label text-gray-500">
            License Type
          </h2>
          <ul className="flex flex-col">
            <li>
              <Link
                href={`/county/${county.county_slug}`}
                aria-current={!activeType ? "true" : undefined}
                className={`flex items-baseline justify-between gap-3 border-b border-gray-200 py-2.5 text-note transition-colors hover:text-navy ${FOCUS_RING_PAPER} ${
                  !activeType ? "font-semibold text-navy" : "text-gray-700"
                }`}
              >
                All types
                <span className="font-mono text-micro text-gray-500">
                  {activeType ? "" : result.total.toLocaleString("en-US")}
                </span>
              </Link>
            </li>
            {sortedTypeCounts.map(([code, count]) => (
              <li key={code}>
                <Link
                  href={`/county/${county.county_slug}?type=${code}`}
                  aria-current={activeType === code ? "true" : undefined}
                  className={`flex items-baseline justify-between gap-3 border-b border-gray-200 py-2.5 text-note transition-colors hover:text-navy ${FOCUS_RING_PAPER} ${
                    activeType === code ? "font-semibold text-navy" : "text-gray-700"
                  }`}
                >
                  <span className="min-w-0 truncate">
                    {typeNames.get(code) ?? code}
                  </span>
                  <span className="shrink-0 font-mono text-micro text-gray-500">
                    {count.toLocaleString("en-US")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </aside>

        <div>
          <ContractorList
            result={result}
            qualifier={`Contractor records in ${county.county_name} County${
              activeType ? ` · ${typeNames.get(activeType) ?? activeType}` : ""
            }`}
            countyNames={countyNames}
            typeNames={typeNames}
            hrefFor={hrefFor}
            emptyMessage={
              activeType
                ? `No ${typeNames.get(activeType) ?? activeType} records are on file for ${county.county_name} County. Try All types.`
                : `The DBPR extract holds no contractor records for ${county.county_name} County.`
            }
          />
        </div>

        {/* Stairway Mortgage — right sidebar */}
        <aside className="self-start max-[1200px]:col-span-full max-[1200px]:flex max-[1200px]:justify-center lg:sticky lg:top-6">
          <StairwayAd size="300x250" />
        </aside>
      </main>

      <Footer lastSyncDate={asOf} />
    </>
  );
}
