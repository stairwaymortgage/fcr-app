import type { Metadata } from "next";
import Link from "next/link";

import PageHero from "@/components/browse/PageHero";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { getCities, getCountyMeta } from "@/lib/browse";
import { FOCUS_RING_PAPER } from "@/lib/focus";
import { dataAsOf } from "@/lib/data-as-of";
import { publicPageMetadata } from "@/lib/seo";
import { createPublicClient } from "@/lib/supabase/public";

/**
 * Cities index — /cities
 * Source: _handoff/02_mockups_production/02_indexes_browse/cities_index.html
 *
 * GROUPED BY COUNTY, which the mockup's flat proximity-sorted grid cannot be
 * without Edge geolocation (Week 3 Day 1). Grouping is the honest alternative
 * to a "nearest you" list that has no idea where you are, and it gives 710
 * cities a structure a visitor can scan.
 *
 * COVERS 710 OF THE 5,977 DISTINCT CITY NAMES in the contractor data. The
 * reference table is a curated set of real Florida municipalities; the rest are
 * spelling variants, unincorporated places and out-of-state mailing addresses.
 * Contractors in the other 5,267 are reachable through search and their county
 * page, just not through a /city URL.
 */

export const metadata: Metadata = publicPageMetadata({
  title: "Florida contractors by city · Florida Contractor Registry",
  description:
    "Browse Florida contractor records by city, grouped by county. Drawn from the weekly DBPR public records extract.",
  path: "/cities",
});

export const revalidate = 86400;

export default async function CitiesPage() {
  const db = createPublicClient();
  const [cities, countyMeta, asOf] = await Promise.all([
    getCities(db),
    getCountyMeta(db),
    dataAsOf(),
  ]);

  // Grouped in JS: PostgREST cannot GROUP BY, and 710 rows is nothing to sort
  // in memory. One request instead of 67.
  const byCounty = new Map<string, typeof cities>();
  for (const city of cities) {
    const list = byCounty.get(city.county_code) ?? [];
    list.push(city);
    byCounty.set(city.county_code, list);
  }

  const groups = Array.from(byCounty.entries())
    .map(([code, list]) => ({
      code,
      name: countyMeta.get(code)?.name ?? "Other",
      slug: countyMeta.get(code)?.slug ?? null,
      cities: [...list].sort(
        (a, b) => (b.contractor_count ?? 0) - (a.contractor_count ?? 0),
      ),
      total: list.reduce((sum, c) => sum + (c.contractor_count ?? 0), 0),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <Header statsTimestamp={asOf} />

      <PageHero
        crumbs={[{ href: "/", label: "Home" }, { label: "Cities" }]}
        title="Florida contractors by"
        emphasis="city."
        lede={
          <>
            {cities.length.toLocaleString("en-US")} Florida municipalities with
            contractor records on file, grouped by county. Each city page lists
            every licensed contractor with a mailing address there.
          </>
        }
        stats={[
          { value: cities.length.toLocaleString("en-US"), label: "Cities" },
          { value: String(groups.length), label: "Counties Represented" },
          {
            value: groups
              .reduce((sum, g) => sum + g.total, 0)
              .toLocaleString("en-US"),
            label: "Contractors in Listed Cities",
            gold: true,
          },
          { value: "Weekly", label: "DBPR Refresh" },
        ]}
      />

      <main className="mx-auto max-w-shell px-8 pb-[72px] pt-12">
        {/* The counts below come from reference_cities.contractor_count, which
            was derived at import and is not maintained — Miami reads 16,191
            against a live 16,202. Each city page shows its own live total. */}
        <p className="mb-10 text-note leading-[1.55] text-gray-500">
          City totals are from the most recent import and may lag the live count
          slightly; each city page shows its current total.
        </p>

        <div className="flex flex-col gap-10">
          {groups.map((group) => (
            <section key={group.code}>
              <h2 className="mb-4 flex items-baseline gap-3 border-b border-gray-200 pb-3 font-serif text-[22px] font-semibold tracking-[-0.015em] text-navy">
                {group.slug ? (
                  <Link
                    href={`/county/${group.slug}`}
                    className={`hover:underline ${FOCUS_RING_PAPER}`}
                  >
                    {group.name} County
                  </Link>
                ) : (
                  <span>{group.name} County</span>
                )}
                <span className="font-mono text-ui font-medium tracking-[0.04em] text-gray-500">
                  {group.cities.length}{" "}
                  {group.cities.length === 1 ? "city" : "cities"}
                </span>
              </h2>

              <ul className="grid grid-cols-4 gap-3 max-[1000px]:grid-cols-2 max-[640px]:grid-cols-1">
                {group.cities.map((city) => (
                  <li key={city.city_slug}>
                    <Link
                      href={`/city/${city.city_slug}`}
                      className={`flex items-baseline justify-between gap-3 border border-gray-200 bg-paper-raised px-4 py-3 transition-colors hover:border-gold hover:bg-gold-pale ${FOCUS_RING_PAPER}`}
                    >
                      <span className="min-w-0 truncate font-serif text-[16px] font-semibold tracking-wordmark text-ink">
                        {city.city_name}
                      </span>
                      <span className="shrink-0 font-mono text-micro text-gray-500">
                        {(city.contractor_count ?? 0).toLocaleString("en-US")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>

      <Footer lastSyncDate={asOf} />
    </>
  );
}
