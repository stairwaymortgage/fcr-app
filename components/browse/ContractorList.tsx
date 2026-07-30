import Link from "next/link";

import {
  ContractorPage,
  ContractorRow,
  PAGE_SIZE,
  personName,
  shortDate,
  titleCase,
} from "@/lib/browse";
import { FOCUS_RING_PAPER } from "@/lib/focus";

/**
 * The shared contractor list — cards, empty states and pagination.
 * Source: _handoff/02_mockups_production/02_indexes_browse/broward_county_index.html
 *
 * ONE COMPONENT FOR THREE ROUTES. The Build Brief route table says the county
 * page "ALSO serves as template for /city/[slug] and /type/[slug]", and the
 * mockups agree — the three differ only in their heading and filter rail. The
 * list itself is identical, so it lives here rather than three times.
 *
 * Server Component: pagination is links, not state.
 */

/** Every card links via the STORED slug column — never a recomputed one. */
function ContractorCard({
  row,
  countyName,
  typeName,
}: {
  row: ContractorRow;
  countyName: string | undefined;
  typeName: string | undefined;
}) {
  const featured = row.claim_tier === "featured";
  const name = row.business_name
    ? titleCase(row.business_name)
    : personName(row.qualifying_agent_name);
  const agent = personName(row.qualifying_agent_name);
  const showAgent =
    row.business_name && row.business_name !== row.qualifying_agent_name;
  const current = row.license_status === "Current";
  // "Certified" types carry statewide authority; "Registered" are local.
  const statewide = row.license_type.startsWith("C");

  return (
    <li>
      <Link
        href={`/contractor/${row.slug}`}
        className={`flex items-center justify-between gap-6 border border-gray-200 px-6 py-5 transition-colors max-[820px]:flex-col max-[820px]:items-start max-[820px]:gap-3 ${FOCUS_RING_PAPER} ${
          featured
            ? "border-gold bg-gradient-to-b from-[#fbf6e3] to-paper"
            : "bg-paper-raised hover:border-gold hover:bg-gold-pale"
        }`}
      >
        <div className="min-w-0">
          <p className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-micro uppercase tracking-[0.06em]">
            {featured && (
              <span className="bg-gold px-1.5 py-0.5 font-semibold text-navy-deep">
                ★ Verified
              </span>
            )}
            <span className="font-semibold tracking-[0.03em] text-gold">
              {row.license_number ?? "No license no."}
            </span>
            <span className="text-gray-500">{typeName ?? row.license_type}</span>
            <span
              className={current ? "text-status-success" : "text-status-error"}
            >
              {row.license_status}
              {row.license_status_secondary && ` · ${row.license_status_secondary}`}
            </span>
          </p>

          <h3 className="mb-1 font-serif text-[19px] font-semibold leading-[1.25] tracking-wordmark text-ink">
            {name}
          </h3>

          {showAgent && (
            <p className="mb-2 text-ui text-gray-500">
              Qualified by <em className="italic text-gray-700">{agent}</em>
            </p>
          )}

          <p className="flex flex-wrap gap-x-5 gap-y-1 text-ui text-gray-700">
            {row.city && (
              <span>
                <span className="font-mono text-micro uppercase tracking-[0.08em] text-gray-500">
                  City{" "}
                </span>
                {titleCase(row.city)}
                {countyName && `, ${countyName} Co.`}
              </span>
            )}
            {shortDate(row.original_license_date) && (
              <span>
                <span className="font-mono text-micro uppercase tracking-[0.08em] text-gray-500">
                  Licensed{" "}
                </span>
                {shortDate(row.original_license_date)}
              </span>
            )}
            <span>
              <span className="font-mono text-micro uppercase tracking-[0.08em] text-gray-500">
                Authority{" "}
              </span>
              {statewide ? "Statewide" : "Local"}
            </span>
          </p>
        </div>

        <span className="flex shrink-0 items-center gap-2 border border-navy px-4 py-2 font-mono text-[12px] font-semibold uppercase tracking-[0.04em] text-navy">
          View Profile
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            className="h-3 w-3"
          >
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </span>
      </Link>
    </li>
  );
}

/**
 * Page-number links.
 *
 * OFFSET PAGINATION, AND ITS LIMIT IS DELIBERATE. parsePage caps at page 400 —
 * 10,000 rows deep — because OFFSET makes Postgres walk and discard every
 * skipped row, so page 5,000 of Miami would scan 125,000 rows to show 25.
 * Keyset pagination would fix that, but nobody browses that deep; they search.
 * The cap keeps a crafted ?page=999999 from becoming a cheap way to load the
 * database.
 */
function Pagination({
  page,
  pageCount,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) return null;

  // A short window around the current page — 400 numbered links would be worse
  // than useless.
  const window = 2;
  const pages: number[] = [];
  for (let p = Math.max(1, page - window); p <= Math.min(pageCount, page + window); p++) {
    pages.push(p);
  }

  const linkClass =
    "border border-gray-300 px-3 py-2 font-mono text-ui text-navy transition-colors hover:border-gold hover:bg-gold-pale";

  return (
    <nav aria-label="Pagination" className="mt-8 flex flex-wrap items-center gap-2">
      {page > 1 && (
        <Link href={hrefFor(page - 1)} className={`${linkClass} ${FOCUS_RING_PAPER}`}>
          ← Previous
        </Link>
      )}

      {pages[0] > 1 && (
        <>
          <Link href={hrefFor(1)} className={`${linkClass} ${FOCUS_RING_PAPER}`}>
            1
          </Link>
          {pages[0] > 2 && <span className="px-1 text-gray-500">…</span>}
        </>
      )}

      {pages.map((p) => (
        <Link
          key={p}
          href={hrefFor(p)}
          aria-current={p === page ? "page" : undefined}
          className={`${linkClass} ${FOCUS_RING_PAPER} ${
            p === page ? "border-navy bg-navy font-semibold text-paper" : ""
          }`}
        >
          {p}
        </Link>
      ))}

      {pages[pages.length - 1] < pageCount && (
        <>
          {pages[pages.length - 1] < pageCount - 1 && (
            <span className="px-1 text-gray-500">…</span>
          )}
          <Link href={hrefFor(pageCount)} className={`${linkClass} ${FOCUS_RING_PAPER}`}>
            {pageCount}
          </Link>
        </>
      )}

      {page < pageCount && (
        <Link href={hrefFor(page + 1)} className={`${linkClass} ${FOCUS_RING_PAPER}`}>
          Next →
        </Link>
      )}
    </nav>
  );
}

export default function ContractorList({
  result,
  qualifier,
  countyNames,
  typeNames,
  hrefFor,
  emptyMessage,
}: {
  result: ContractorPage;
  qualifier: string;
  countyNames: Map<string, string>;
  typeNames: Map<string, string>;
  hrefFor: (page: number) => string;
  emptyMessage: string;
}) {
  if (result.failed) {
    return (
      <div className="border border-gray-200 bg-paper-raised px-8 py-12 text-center">
        <h2 className="mb-2 font-serif text-2xl font-semibold text-navy">
          This list is temporarily unavailable
        </h2>
        <p className="text-note text-gray-700">
          We couldn&rsquo;t load these contractors just now — a problem on our
          side, not with your request. Please try again in a moment.
        </p>
      </div>
    );
  }

  if (result.total === 0) {
    return (
      <div className="border border-gray-200 bg-paper-raised px-8 py-12 text-center">
        <h2 className="mb-2 font-serif text-2xl font-semibold text-navy">
          No contractors listed
        </h2>
        <p className="mx-auto max-w-[420px] text-note leading-[1.6] text-gray-700">
          {emptyMessage}
        </p>
      </div>
    );
  }

  const first = (result.page - 1) * PAGE_SIZE + 1;
  const last = Math.min(result.page * PAGE_SIZE, result.total);

  return (
    <>
      <div className="mb-6 flex items-baseline justify-between gap-4 border-b border-gray-200 pb-4">
        <p className="text-note text-gray-700">
          Showing{" "}
          <em className="font-mono not-italic font-semibold text-ink">
            {first.toLocaleString("en-US")}–{last.toLocaleString("en-US")}
          </em>{" "}
          of{" "}
          <em className="font-mono not-italic font-semibold text-ink">
            {result.total.toLocaleString("en-US")}
          </em>
          <span className="mt-0.5 block text-xs text-gray-500">{qualifier}</span>
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {result.rows.map((row) => (
          <ContractorCard
            key={row.dbpr_sync_key}
            row={row}
            countyName={row.county_code ? countyNames.get(row.county_code) : undefined}
            typeName={typeNames.get(row.license_type)}
          />
        ))}
      </ul>

      <Pagination page={result.page} pageCount={result.pageCount} hrefFor={hrefFor} />
    </>
  );
}
