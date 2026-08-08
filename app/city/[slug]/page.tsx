import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import ContractorList from "@/components/browse/ContractorList";
import { Breadcrumb } from "@/components/browse/PageHero";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import {
  getContractorPage,
  getCountyMeta,
  getCountyNameMap,
  getTypeNameMap,
  parsePage,
} from "@/lib/browse";
import { getCityBySlug } from "@/lib/browse-cached";
import { FOCUS_RING_PAPER } from "@/lib/focus";
import { dataAsOf } from "@/lib/data-as-of";
import { publicPageMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

/**
 * Single city — /city/[slug]
 * Same template as /county/[slug], per the Build Brief route table.
 *
 * ---------------------------------------------------------------------------
 * FILTERED ON CITY NAME ALONE, NOT city + county. This is a real judgement
 * call, so it is written down rather than left implicit.
 *
 * 356 city names in the contractor data appear under more than one county code
 * — JACKSONVILLE under 12, ORLANDO under 11, TAMPA under 10. Florida has no
 * city spanning twelve counties; this is DBPR data noise, where a mailing
 * address carries a county code that does not match its city.
 *
 * Scoping the query to the reference city's county_code would look tidier and
 * would silently drop every contractor whose county code is wrong — the visitor
 * would see a short list with no indication anything was missing. Filtering on
 * the city name shows everyone who says they are in that city, and each row
 * prints its own county so a mismatch is visible rather than hidden.
 *
 * SCOPED TO state = 'FL', WHICH IS NOT OPTIONAL. 27,250 records carry a
 * non-Florida state — contractors licensed in Florida with an out-of-state
 * mailing address. reference_cities has a Birmingham row, and city alone
 * matched 277 contractors there, of which 257 are Birmingham ALABAMA and one is
 * in Florida. A Florida registry cannot publish that page.
 *
 * The city column is uppercase throughout the extract, so the reference city
 * name is uppercased to match; idx_contractors_city_tier serves it at ~315ms.
 * ---------------------------------------------------------------------------
 */

export const revalidate = 86400;

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const db = createClient();
  const city = await getCityBySlug(db, params.slug);
  if (!city) return { title: "City not found · Florida Contractor Registry" };

  // Title and description unchanged — indexed at ~1,000 pages. See the note in
  // app/county/[slug]/page.tsx; this only adds the missing social card.
  return {
    ...publicPageMetadata({
      title: `Licensed contractors in ${city.city_name}, Florida`,
      description: `Contractor records on file with the Florida DBPR for ${city.city_name} — license numbers, types, status and qualifying agents, refreshed weekly.`,
      path: `/city/${city.city_slug}`,
    }),
    robots: { index: true, follow: true },
  };
}

export default async function CityPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { page?: string };
}) {
  const db = createClient();
  const asOf = await dataAsOf();
  const city = await getCityBySlug(db, params.slug);
  if (!city) notFound();

  const page = parsePage(searchParams.page);

  const [result, countyNames, countyMeta, typeNames] = await Promise.all([
    getContractorPage(db, { city: city.city_name.toUpperCase(), state: "FL" }, page),
    getCountyNameMap(db),
    getCountyMeta(db),
    getTypeNameMap(db),
  ]);

  const county = countyMeta.get(city.county_code);

  // How many of the rows on this page sit in a different county than the
  // reference table assigns — the split-city effect, made visible.
  const otherCounty = result.rows.filter(
    (r) => r.county_code && r.county_code !== city.county_code,
  ).length;

  return (
    <>
      <Header statsTimestamp={asOf} />

      <section className="border-b border-gray-200 bg-gradient-to-b from-paper to-[#faf6ed] px-8 pb-9 pt-8">
        <div className="mx-auto max-w-shell">
          <Breadcrumb
            crumbs={[
              { href: "/", label: "Home" },
              { href: "/cities", label: "Cities" },
              ...(county
                ? [{ href: `/county/${county.slug}`, label: `${county.name} County` }]
                : []),
              { label: city.city_name },
            ]}
          />
          <h1 className="mb-3.5 font-serif text-[42px] font-semibold leading-[1.08] tracking-[-0.025em] text-navy max-[900px]:text-[32px]">
            Licensed contractors in <em className="italic">{city.city_name}</em>
          </h1>
          <p className="max-w-[720px] text-[17px] leading-[1.55] text-gray-700">
            <strong className="font-semibold text-ink">
              {result.total.toLocaleString("en-US")} contractor records
            </strong>{" "}
            with a mailing address in {city.city_name}
            {county && `, ${county.name} County`}, Florida. Republished weekly
            from Florida DBPR public records.
          </p>
        </div>
      </section>

      <main className="mx-auto max-w-shell px-8 pb-[72px] pt-10">
        {otherCounty > 0 && (
          <p className="mb-6 border-l-[3px] border-gold bg-gold-pale px-5 py-3.5 text-note leading-[1.55] text-ink">
            {otherCounty} of the records on this page carry a county other than{" "}
            {county?.name ?? "the expected one"} in the DBPR extract. They are
            listed because their address says {city.city_name}; each row shows
            the county DBPR has on file.
          </p>
        )}

        <ContractorList
          result={result}
          qualifier={`Contractor records in ${city.city_name}, Florida`}
          countyNames={countyNames}
          typeNames={typeNames}
          hrefFor={(p) =>
            p > 1 ? `/city/${city.city_slug}?page=${p}` : `/city/${city.city_slug}`
          }
          emptyMessage={`The DBPR extract holds no contractor records with a ${city.city_name} address.`}
        />

        {county && (
          <p className="mt-10 text-note text-gray-700">
            <Link
              href={`/county/${county.slug}`}
              className={`border-b border-gold pb-0.5 font-semibold text-navy ${FOCUS_RING_PAPER}`}
            >
              Browse all of {county.name} County →
            </Link>
          </p>
        )}
      </main>

      <Footer lastSyncDate={asOf} />
    </>
  );
}
