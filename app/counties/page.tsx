import type { Metadata } from "next";
import Link from "next/link";

import PageHero from "@/components/browse/PageHero";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { getCountiesWithCounts } from "@/lib/browse";
import { FOCUS_RING_PAPER } from "@/lib/focus";
import { dataAsOf } from "@/lib/data-as-of";
import { COUNTY_COUNT, contractorCountLabel } from "@/lib/registry-stats";
import { createClient } from "@/lib/supabase/server";

/**
 * Counties index — /counties
 * Source: _handoff/02_mockups_production/02_indexes_browse/counties_index.html
 *
 * Server Component, reads via lib/supabase/server.ts (anon, RLS).
 *
 * TWO MOCKUP FEATURES NOT BUILT, both flagged rather than faked:
 *   - The "showing counties nearest Broward first" strip needs Vercel Edge
 *     IP-geolocation (Build Brief Week 3 Day 1). Counties render alphabetically
 *     until that lands; alphabetical is also what the mockup's own lede
 *     promises ("organized by the 67 counties").
 *   - The Nearest / Alphabetical / Most Contractors toggle is client state.
 *     Sorting is a link-driven concern; it can return as ?sort= without JS.
 */

export const metadata: Metadata = {
  title: "Florida contractors by county · Florida Contractor Registry",
  description:
    "Every Florida contractor record organized by the 67 counties of issuance, drawn from the weekly DBPR public records extract.",
  alternates: { canonical: "/counties" },
};

export const revalidate = 86400;

export default async function CountiesPage() {
  const db = createClient();
  const asOf = await dataAsOf();
  const counties = await getCountiesWithCounts(db);

  const totalInCounties = counties.reduce((sum, c) => sum + c.count, 0);

  return (
    <>
      <Header currentPath="/counties" statsTimestamp={asOf} />

      <PageHero
        crumbs={[{ href: "/", label: "Home" }, { label: "Counties" }]}
        title="Florida contractors by"
        emphasis="county."
        lede={
          <>
            Every contractor record in the State of Florida, organized by the{" "}
            {COUNTY_COUNT} counties of issuance. Drawn from the weekly DBPR public
            records extract.
          </>
        }
        stats={[
          { value: contractorCountLabel(), label: "Contractor Records" },
          { value: String(COUNTY_COUNT), label: "Florida Counties" },
          {
            value: totalInCounties.toLocaleString("en-US"),
            label: "Assigned to a County",
            gold: true,
          },
          { value: "Weekly", label: "DBPR Refresh" },
        ]}
      />

      <main className="mx-auto max-w-shell px-8 pb-[72px] pt-12">
        {/* 29,876 rows carry no county_code, so the county counts do not sum to
            the registry total. Saying so beats letting a visitor add them up and
            conclude the numbers are wrong. */}
        <p className="mb-8 border-l-[3px] border-gold bg-gold-pale px-5 py-3.5 text-note leading-[1.55] text-ink">
          <span className="font-semibold">
            These counts do not sum to {contractorCountLabel()}.
          </span>{" "}
          The DBPR extract leaves the county blank on{" "}
          {(266305 - totalInCounties).toLocaleString("en-US")} records — mostly
          out-of-state mailing addresses — and those appear in search but on no
          county page.
        </p>

        <ul className="grid grid-cols-3 gap-4 max-[1000px]:grid-cols-2 max-[700px]:grid-cols-1">
          {counties.map((county) => (
            <li key={county.county_code}>
              <Link
                href={`/county/${county.county_slug}`}
                className={`flex h-full flex-col justify-between border border-gray-200 bg-paper-raised px-6 py-5 transition-colors hover:border-gold hover:bg-gold-pale ${FOCUS_RING_PAPER}`}
              >
                <span className="mb-3 flex items-baseline justify-between gap-3">
                  <span className="font-serif text-[19px] font-semibold tracking-wordmark text-ink">
                    {county.county_name} County
                  </span>
                  <span className="font-mono text-note font-semibold text-navy">
                    {county.count.toLocaleString("en-US")}
                  </span>
                </span>

                <span className="mb-3 block text-ui text-gray-500">
                  {county.region
                    ? county.region.replace(/_/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase())
                    : "Florida"}
                  {county.population && ` · Pop. ${county.population.toLocaleString("en-US")}`}
                </span>

                <span className="font-mono text-micro font-semibold uppercase tracking-[0.06em] text-navy">
                  View contractors →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>

      <Footer lastSyncDate={asOf} />
    </>
  );
}
