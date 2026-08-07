import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import ContractorList from "@/components/browse/ContractorList";
import { Breadcrumb } from "@/components/browse/PageHero";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import {
  getContractorPage,
  getCountyNameMap,
  getTypeNameMap,
  parsePage,
} from "@/lib/browse";
import { getTypeByCode } from "@/lib/browse-cached";
import { FOCUS_RING_PAPER } from "@/lib/focus";
import { dataAsOf } from "@/lib/data-as-of";
import { createClient } from "@/lib/supabase/server";

/**
 * Single licence type — /type/[code]
 * Same template as /county/[slug], per the Build Brief route table.
 *
 * KEYED ON type_code (the primary key of reference_license_types), lowercased
 * in the URL and uppercased for the lookup. license_types_index.html links
 * /type/cgc; homepage.html links the slugified name. The code wins — see the
 * note on /types.
 *
 * ELEVEN CODES RESOLVE TO A REAL CATEGORY WITH ZERO RECORDS (all electrical
 * classes among them, published by DBPR in an extract we do not import). Those
 * pages render a 200 with an explicit explanation rather than a 404: the
 * category exists, and saying "no records here, and here is why" is more useful
 * than pretending the URL is wrong.
 */

export const revalidate = 86400;

export async function generateMetadata({
  params,
}: {
  params: { code: string };
}): Promise<Metadata> {
  const db = createClient();
  const type = await getTypeByCode(db, params.code);
  if (!type) return { title: "License type not found · Florida Contractor Registry" };

  return {
    title: `${type.type_name} (${type.type_code}) — Florida contractors`,
    description:
      type.scope_description ??
      `Florida contractor records holding a ${type.type_name} license (${type.type_code}), from the weekly DBPR public records extract.`,
    alternates: { canonical: `/type/${type.type_code.toLowerCase()}` },
    robots: { index: true, follow: true },
  };
}

export default async function TypePage({
  params,
  searchParams,
}: {
  params: { code: string };
  searchParams: { page?: string };
}) {
  const db = createClient();
  const asOf = await dataAsOf();
  const type = await getTypeByCode(db, params.code);
  if (!type) notFound();

  const page = parsePage(searchParams.page);

  const [result, countyNames, typeNames] = await Promise.all([
    getContractorPage(db, { license_type: type.type_code }, page),
    getCountyNameMap(db),
    getTypeNameMap(db),
  ]);

  const statewide = type.type_code.startsWith("C");

  return (
    <>
      <Header currentPath="/types" statsTimestamp={asOf} />

      <section className="border-b border-gray-200 bg-gradient-to-b from-paper to-[#faf6ed] px-8 pb-9 pt-8">
        <div className="mx-auto max-w-shell">
          <Breadcrumb
            crumbs={[
              { href: "/", label: "Home" },
              { href: "/types", label: "License Types" },
              { label: type.type_name },
            ]}
          />
          <p className="mb-3 inline-flex items-center gap-2 bg-gray-100 px-[11px] py-[5px] font-mono text-micro font-semibold uppercase tracking-[0.06em] text-gray-700">
            {type.type_code}
            <span aria-hidden="true">·</span>
            {statewide ? "Statewide authority" : "Local registration"}
          </p>
          <h1 className="mb-3.5 font-serif text-[42px] font-semibold leading-[1.08] tracking-[-0.025em] text-navy max-[900px]:text-[32px]">
            <em className="italic">{type.type_name}</em>
          </h1>
          <p className="max-w-[720px] text-[17px] leading-[1.55] text-gray-700">
            <strong className="font-semibold text-ink">
              {result.total.toLocaleString("en-US")} contractor records
            </strong>{" "}
            hold a {type.type_name} license in the current DBPR extract.
            {type.scope_description && ` ${type.scope_description}`}
          </p>
        </div>
      </section>

      <main className="mx-auto max-w-shell px-8 pb-[72px] pt-10">
        {result.total === 0 ? (
          <div className="mx-auto max-w-[640px] border border-gray-200 bg-paper-raised px-10 py-12 text-center">
            <h2 className="mb-3 font-serif text-2xl font-semibold text-navy">
              No records in this category
            </h2>
            <p className="mb-5 text-note leading-[1.65] text-gray-700">
              {type.type_name} is a real Florida license category, but no records
              appear under it in the DBPR CONSTRUCTIONLICENSE extract this
              registry republishes.
              {type.type_code.startsWith("E") && (
                <>
                  {" "}
                  Electrical licenses are published by DBPR in a separate file we
                  do not yet import, so an electrical contractor may be fully
                  licensed without appearing here.
                </>
              )}{" "}
              Verify directly with DBPR before concluding a contractor is
              unlicensed.
            </p>
            <Link
              href="/types"
              className={`inline-block border border-navy px-4 py-2 font-mono text-[12.5px] font-semibold uppercase tracking-[0.04em] text-navy transition-colors hover:bg-navy hover:text-paper ${FOCUS_RING_PAPER}`}
            >
              ← All license types
            </Link>
          </div>
        ) : (
          <ContractorList
            result={result}
            qualifier={`Contractor records holding a ${type.type_name} license`}
            countyNames={countyNames}
            typeNames={typeNames}
            hrefFor={(p) =>
              p > 1
                ? `/type/${type.type_code.toLowerCase()}?page=${p}`
                : `/type/${type.type_code.toLowerCase()}`
            }
            emptyMessage={`No records hold a ${type.type_name} license in this extract.`}
          />
        )}
      </main>

      <Footer lastSyncDate={asOf} />
    </>
  );
}
