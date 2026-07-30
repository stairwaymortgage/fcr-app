import type { Metadata } from "next";
import Link from "next/link";

import PageHero from "@/components/browse/PageHero";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { getTypesWithCounts } from "@/lib/browse";
import { FOCUS_RING_PAPER } from "@/lib/focus";
import { DATA_AS_OF, LICENSE_TYPE_COUNT } from "@/lib/registry-stats";
import { createClient } from "@/lib/supabase/server";

/**
 * Licence types index — /types
 * Source: _handoff/02_mockups_production/02_indexes_browse/license_types_index.html
 *
 * URLS ARE /type/{CODE}, NOT THE SLUGIFIED NAME. The two mockups disagree:
 * this one links /type/cgc, while homepage.html links
 * /type/certified-general-contractor. The code wins — it is the primary key of
 * reference_license_types, so the route resolves with one indexed lookup and no
 * transform. That also removed the three separate request-time name-slugify
 * implementations that had accumulated on the homepage, search and profile
 * pages, which were the same drift hazard the contractor slug had.
 */

export const metadata: Metadata = {
  title: "Florida contractor license types · Florida Contractor Registry",
  description:
    "The Florida contractor license categories, what each one legally covers, and how many records hold it. From the weekly DBPR public records extract.",
  alternates: { canonical: "/types" },
};

export const revalidate = 86400;

export default async function TypesPage() {
  const db = createClient();
  const types = await getTypesWithCounts(db);

  const held = types.filter((t) => t.count > 0);
  const empty = types.filter((t) => t.count === 0);
  const totalHeld = held.reduce((sum, t) => sum + t.count, 0);

  return (
    <>
      <Header currentPath="/types" statsTimestamp={DATA_AS_OF} />

      <PageHero
        crumbs={[{ href: "/", label: "Home" }, { label: "License Types" }]}
        title="Florida contractor"
        emphasis="license types."
        lede={
          <>
            Florida issues {LICENSE_TYPE_COUNT} contractor license categories,
            each defining the scope of work its holder may legally perform.
            The difference matters — a roofing license doesn&rsquo;t cover
            electrical work, and a residential contractor cannot legally build a
            four-storey commercial building.
          </>
        }
        stats={[
          { value: String(types.length), label: "License Categories" },
          { value: String(held.length), label: "With Records on File", gold: true },
          { value: totalHeld.toLocaleString("en-US"), label: "Records Categorised" },
          { value: "Weekly", label: "DBPR Refresh" },
        ]}
      />

      <main className="mx-auto max-w-shell px-8 pb-[72px] pt-12">
        <ul className="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
          {held.map((type) => (
            <li key={type.type_code}>
              <Link
                href={`/type/${type.type_code.toLowerCase()}`}
                className={`flex h-full flex-col border border-gray-200 bg-paper-raised px-6 py-5 transition-colors hover:border-gold hover:bg-gold-pale ${FOCUS_RING_PAPER}`}
              >
                <span className="mb-2 flex items-baseline justify-between gap-4">
                  <span className="flex items-baseline gap-3">
                    <span className="font-mono text-micro font-semibold tracking-label text-gold">
                      {type.type_code}
                    </span>
                    <span className="font-serif text-[19px] font-semibold tracking-wordmark text-ink">
                      {type.type_name}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-note font-semibold text-navy">
                    {type.count.toLocaleString("en-US")}
                  </span>
                </span>

                {type.scope_description && (
                  <span className="mb-3 block text-note leading-[1.55] text-gray-700">
                    {type.scope_description}
                  </span>
                )}

                <span className="mt-auto font-mono text-micro font-semibold uppercase tracking-[0.06em] text-navy">
                  View contractors →
                </span>
              </Link>
            </li>
          ))}
        </ul>

        {/*
          Shown, not hidden. Eleven categories exist in Florida law with no
          records in our data — every electrical class among them, because DBPR
          publishes electrical licences in a separate extract we do not import.
          Listing them with a plain explanation is more honest than a types index
          that silently claims Florida has 18 categories.
        */}
        {empty.length > 0 && (
          <section className="mt-14 border-t border-gray-200 pt-8">
            <h2 className="mb-2 font-serif text-[22px] font-semibold tracking-[-0.015em] text-navy">
              Categories with no records in this extract
            </h2>
            <p className="mb-5 max-w-[720px] text-note leading-[1.6] text-gray-700">
              These {empty.length} license categories exist in Florida law, but no
              records appear under them in the DBPR CONSTRUCTIONLICENSE extract we
              republish. Electrical licenses in particular are published by DBPR
              in a separate file that this registry does not yet import — so an
              electrical contractor may well be licensed without appearing here.
            </p>
            <ul className="flex flex-wrap gap-2">
              {empty.map((type) => (
                <li
                  key={type.type_code}
                  className="border border-gray-200 bg-gray-50 px-3 py-1.5 text-ui text-gray-700"
                >
                  <span className="font-mono text-micro font-semibold tracking-label text-gray-500">
                    {type.type_code}
                  </span>{" "}
                  {type.type_name}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <Footer lastSyncDate={DATA_AS_OF} />
    </>
  );
}
