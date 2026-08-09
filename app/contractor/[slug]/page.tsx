import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import Footer from "@/components/Footer";
import Header from "@/components/Header";
import StairwayAd from "@/components/StairwayAd";
import {
  ContractorProfile,
  SiblingLicense,
  dbprVerifyUrl,
  formatBusinessName,
  formatDate,
  formatPersonName,
  formatShortDate,
  getContractorBySlug,
  getCountyName,
  getCountySlug,
  getLicenseTypeInfo,
  getSiblingLicenses,
  isClaimed,
  isCurrentLicense,
  isFeatured,
  yearOf,
} from "@/lib/contractor-profile";
import { endSentence } from "@/lib/format-name";
import { FOCUS_RING_PAPER } from "@/lib/focus";
import { logoPublicUrl } from "@/lib/logo";
import { dataAsOf } from "@/lib/data-as-of";
import { createClient } from "@/lib/supabase/server";

/**
 * Contractor profile — /contractor/[slug]
 * Source: _handoff/02_mockups_production/01_public_core/contractor_profile_aceca.html
 *
 * Server Component. The page itself carries no "use client".
 *
 * ⚠ IT SHIPS ZERO CLIENT JS AGAIN, AS OF 2026-08-07. That property was given up
 * on 2026-08-06 for the inquiry form's pending-state button, and returned when
 * the inquiry form was removed. What stands in its place is a single <Link> to
 * the diagnostic, and a link needs no JavaScript.
 *
 * The Turnstile argument that depended on this is therefore live again: adding
 * a challenge widget to this page would cost the zero-JS property for every
 * visitor. There is no longer a public write path here to protect, so the
 * question is moot unless one is added back.
 *
 * READS: lib/supabase/server.ts (anon, RLS). NO WRITE PATH. ./actions.ts still
 * exports submitInquiry and is deliberately left in place — the inquiries table,
 * the /inquiries inbox and its RLS are all intact for the legacy data — but
 * nothing on this page or anywhere else links to it.
 *
 * TWO DELIBERATE DEPARTURES FROM THE MOCKUP, both flagged rather than silently
 * resolved:
 *
 * 1. THE MOCKUP'S FULL-WIDTH CONVERSION BANNER IS STILL NOT BUILT, but the
 *    reason has changed and the old one is no longer true. It used to be "the
 *    diagnostic does not exist yet, so the CTA would point at a 404". The
 *    diagnostic exists and this page now links into it — see QuoteCta below,
 *    which is the sidebar treatment rather than the mockup's large banner
 *    across the top. What remains unbuilt is the banner's PLACEMENT on the
 *    county, city, type and homepage templates (Build Brief Week 4 Day 5).
 *    Those pages still have no route into the diagnostic.
 *
 * 2. THE MOCKUP'S ABOUT PROSE CANNOT BE DERIVED FROM DBPR DATA. It contains
 *    claims like "a level of stability uncommon in an industry where most
 *    businesses dissolve within seven years" and specific statute citations.
 *    None of that is in the extract, and inventing it on an accuracy-pitched
 *    directory is exactly the wrong trade. The About section below states only
 *    what the row actually says. When a profile is claimed, the owner's own
 *    custom_about_text renders instead.
 *
 * The sidebar CTA sits under the licence details, where the inquiry form used to
 * be and for the same reason: a visitor who has just verified a licence is the
 * one most likely to act.
 */

/* ========================================================================== *
 * METADATA
 * ========================================================================== */

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const db = createClient();
  const contractor = await getContractorBySlug(db, params.slug);

  if (!contractor) {
    return { title: "Contractor not found · Florida Contractor Registry" };
  }

  const name = contractor.business_name
    ? formatBusinessName(contractor.business_name)
    : formatPersonName(contractor.qualifying_agent_name);
  const countyName = await getCountyName(db, contractor.county_code);
  const place = [contractor.city, countyName && `${countyName} County`]
    .filter(Boolean)
    .join(", ");

  const description = [
    `${name} —`,
    contractor.license_number
      ? `Florida contractor license ${contractor.license_number}.`
      : "Florida contractor record.",
    place && `Based in ${place}.`,
    `License status: ${contractor.license_status}.`,
    "Verified against public DBPR records.",
  ]
    .filter(Boolean)
    .join(" ");

  const title = contractor.license_number
    ? `${name} (${contractor.license_number}) · Florida Contractor Registry`
    : `${name} · Florida Contractor Registry`;

  /**
   * ⚠ TITLE AND DESCRIPTION ARE UNCHANGED, AND THAT IS THE POINT OF THIS EDIT
   * BEING SMALL. 54.9% of the 266,305 profile titles exceed 60 characters and
   * 45.9% of the descriptions exceed 160 (measured against the live table
   * 2026-08-08). Reformatting either is a rewrite of a quarter-million indexed
   * SERP entries and is explicitly held for Jim.
   *
   * `twitter` IS WRITTEN OUT RATHER THAN LEFT TO FALL BACK ON openGraph. Next
   * derives twitter:* from openGraph only when no `twitter` is in scope — and
   * one always is, from app/layout.tsx. So this page had a correct og:title and
   * a twitter:title reading "Florida Contractor Registry", which is what the
   * live HTML showed before this commit. The card was right on Facebook and
   * LinkedIn and generic on X, for every profile on the site.
   *
   * NOT publicPageMetadata(): that helper emits og `type: "website"`, and these
   * are profiles. The og:type is the one field a shared helper would get wrong
   * here, so this route keeps its own block.
   */
  return {
    title,
    description,
    alternates: { canonical: `/contractor/${contractor.slug}` },
    openGraph: {
      title,
      description,
      type: "profile",
      url: `/contractor/${contractor.slug}`,
    },
    twitter: { title, description },
    // Profiles ARE the pages meant to rank — unlike /search, which is noindex.
    robots: { index: true, follow: true },
  };
}

/* ========================================================================== *
 * SHARED BITS
 * ========================================================================== */

function StatusBadge({
  status,
  secondary,
}: {
  status: string;
  secondary?: string | null;
}) {
  const good = status === "Current";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-[3px] font-mono text-micro font-semibold uppercase tracking-[0.04em] ${
        good
          ? "bg-status-successBg text-status-success"
          : "bg-status-errorBg text-status-error"
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          good ? "bg-status-success" : "bg-status-error"
        }`}
      />
      {secondary ? `${status} · ${secondary}` : status}
    </span>
  );
}

function SideBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 border border-gray-200 bg-paper-raised p-6">
      <h2 className="mb-4 border-b border-gray-200 pb-3 font-mono text-label font-semibold uppercase tracking-label text-gray-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

function DlRow({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="py-[9px]">
      <dt className="mb-[3px] font-mono text-label font-medium uppercase tracking-[0.08em] text-gray-500">
        {term}
      </dt>
      <dd className="text-note font-medium tracking-[-0.005em] text-ink">
        {children}
      </dd>
    </div>
  );
}

/* ========================================================================== *
 * SECTIONS
 * ========================================================================== */

function Breadcrumb({
  countyName,
  countySlug,
  city,
  typeName,
  typeCode,
  name,
}: {
  countyName: string | null;
  countySlug: string | null;
  city: string | null;
  typeName: string | null;
  typeCode: string | null;
  name: string;
}) {
  const crumbs = [
    { href: "/", label: "Home" },
    countySlug && countyName
      ? { href: `/county/${countySlug}`, label: `${countyName} County` }
      : null,
    city
      ? { href: `/search?q=${encodeURIComponent(city)}`, label: formatBusinessName(city) }
      : null,
    typeName && typeCode
      ? { href: `/type/${typeCode.toLowerCase()}`, label: `${typeName}s` }
      : null,
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <nav
      aria-label="Breadcrumb"
      className="border-b border-gray-200 bg-gray-50 px-8 py-3.5"
    >
      <ol className="mx-auto flex max-w-shell flex-wrap items-center text-xs tracking-[-0.005em] text-gray-700">
        {crumbs.map((crumb) => (
          <li key={crumb.href} className="flex items-center">
            <Link
              href={crumb.href}
              className={`hover:text-navy hover:underline ${FOCUS_RING_PAPER}`}
            >
              {crumb.label}
            </Link>
            <span aria-hidden="true" className="mx-2.5 text-gray-500">
              ›
            </span>
          </li>
        ))}
        <li className="font-medium text-ink" aria-current="page">
          {name}
        </li>
      </ol>
    </nav>
  );
}

function Hero({
  contractor,
  name,
  typeName,
  countyName,
  siblings,
}: {
  contractor: ContractorProfile;
  name: string;
  typeName: string | null;
  countyName: string | null;
  siblings: SiblingLicense[];
}) {
  const current = isCurrentLicense(contractor);
  const activeCount = siblings.filter(isCurrentLicense).length;
  const sinceYear = yearOf(contractor.original_license_date);
  const yearsLicensed = sinceYear ? new Date().getFullYear() - sinceYear : null;
  const agent = formatPersonName(contractor.qualifying_agent_name);
  const place = [
    contractor.city && formatBusinessName(contractor.city),
    countyName && `${countyName} County`,
  ]
    .filter(Boolean)
    .join(", ");

  /**
   * The contractor's own logo, if they have uploaded one (task 146).
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * RENDERED ONLY WHEN ONE EXISTS. NO PLACEHOLDER HERE.
   *
   * The editor shows a navy-and-gold initial in this slot, and that is right
   * THERE: it is the thing the upload control is offering to replace. On this
   * page it would be decoration implying an identity mark the business has not
   * got — and it would change the appearance of all 266,000 unclaimed profiles
   * to advertise a feature only claimed ones can use.
   *
   * So an absent logo renders nothing at all and the header keeps its existing
   * layout exactly. The <img> is deliberately not next/image: the optimizer
   * would put a second cache in front of a file the contractor can delete, and
   * a logo that survives its own removal is the one failure this must not have.
   * The bucket's CDN already serves it.
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * ⚠ GATED ON isClaimed(), AND IT WAS NOT WHEN 146 SHIPPED. Every other custom
   * field on this page — About text, phone, email, website — sits behind that
   * gate; the logo was read straight off the column. Unreachable at the time,
   * because only a claimed contractor can upload one, so an unclaimed row always
   * held a null path.
   *
   * Task 148 made it reachable. Releasing a profile nulls claimed_by_user_id,
   * and release_own_contractor_profile() clears custom_logo_path in the same
   * statement — but that is one layer, in another file, and "unclaimed profile
   * still wearing the last owner's branding" is not a failure worth leaving one
   * layer deep. Two independent reasons must now both fail for it to happen.
   */
  const logoUrl = isClaimed(contractor)
    ? logoPublicUrl(contractor.custom_logo_path)
    : null;

  const identity = (
    <>
      <p
        className={`mb-[18px] inline-flex items-center gap-2 px-[11px] py-[5px] text-[11.5px] font-semibold uppercase tracking-[0.06em] ${
          current ? "bg-gray-100 text-gray-700" : "bg-status-errorBg text-status-error"
        }`}
      >
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${
            current ? "bg-status-success" : "bg-status-error"
          }`}
        />
        {current
          ? "Licensed · Active · Verified from DBPR"
          : `License ${contractor.license_status} · Verified from DBPR`}
      </p>

      <h1 className="mb-3.5 font-serif text-5xl font-semibold leading-[1.07] tracking-[-0.025em] text-ink max-[900px]:text-[34px]">
        {name}
      </h1>
    </>
  );

  return (
    <div className="mb-9 border-b border-gray-200 pb-9">
      {logoUrl ? (
        <div className="flex items-start gap-[22px] max-[560px]:flex-col max-[560px]:gap-4">
          <div className="relative h-[90px] w-[90px] shrink-0 bg-gradient-to-br from-navy to-navy-deep">
            {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
            <img
              src={logoUrl}
              alt={`${name} logo`}
              className="h-full w-full object-cover"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-1 border border-gold"
            />
          </div>
          <div>{identity}</div>
        </div>
      ) : (
        identity
      )}

      {/* Assembled only from fields the row actually carries — see the note at
          the top of this file about the mockup's invented prose. */}
      <p className="mb-[22px] text-lg leading-[1.45] tracking-[-0.01em] text-gray-700">
        {typeName ? (
          <>
            A <strong className="font-semibold text-ink">{typeName}</strong>
          </>
        ) : (
          <>A Florida contractor record</>
        )}
        {sinceYear && <> licensed in Florida since {sinceYear}</>}
        {contractor.is_business && agent && <>, qualified by {agent}</>}
        {place && <>. Based in {place}</>}
        {activeCount > 1 && (
          <>
            , with {activeCount} current state licenses under the same qualifying
            agent
          </>
        )}
        .
      </p>

      <dl className="mt-[26px] grid grid-cols-4 border-y border-gray-200 max-[900px]:grid-cols-2">
        <div className="border-r border-gray-200 px-[22px] py-[18px]">
          <dt className="mb-1.5 font-mono text-label font-semibold uppercase tracking-[0.1em] text-gray-500">
            Status
          </dt>
          <dd
            className={`font-serif text-[22px] font-semibold leading-[1.1] ${
              current ? "text-status-success" : "text-status-error"
            }`}
          >
            {current ? "Active" : contractor.license_status}
          </dd>
          <dd className="mt-1 text-[11.5px] text-gray-500">
            {contractor.license_status}
            {contractor.license_status_secondary &&
              ` · ${contractor.license_status_secondary} secondary status`}
          </dd>
        </div>

        <div className="border-r border-gray-200 px-[22px] py-[18px]">
          <dt className="mb-1.5 font-mono text-label font-semibold uppercase tracking-[0.1em] text-gray-500">
            Current Licenses
          </dt>
          <dd className="font-serif text-[22px] font-semibold leading-[1.1] text-ink">
            {activeCount}
          </dd>
          <dd className="mt-1 text-[11.5px] text-gray-500">
            {Array.from(new Set(siblings.map((s) => s.license_type))).join(", ")}
          </dd>
        </div>

        <div className="border-r border-gray-200 px-[22px] py-[18px]">
          <dt className="mb-1.5 font-mono text-label font-semibold uppercase tracking-[0.1em] text-gray-500">
            Years Licensed
          </dt>
          <dd className="font-serif text-[22px] font-semibold leading-[1.1] text-ink">
            {yearsLicensed ?? "—"}
          </dd>
          <dd className="mt-1 text-[11.5px] text-gray-500">
            {sinceYear ? `Since ${sinceYear}` : "Date not on file"}
          </dd>
        </div>

        <div className="px-[22px] py-[18px]">
          <dt className="mb-1.5 font-mono text-label font-semibold uppercase tracking-[0.1em] text-gray-500">
            Service Area
          </dt>
          <dd className="font-serif text-[22px] font-semibold leading-[1.1] text-ink">
            {contractor.state}
          </dd>
          <dd className="mt-1 text-[11.5px] text-gray-500">
            {/* "Certified" licences carry statewide authority; "Registered"
                ones are limited to their local jurisdiction. The distinction is
                the C/R prefix on the DBPR type code. */}
            {contractor.license_type.startsWith("C")
              ? "Statewide authority"
              : "Locally registered"}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * About.
 *
 * Claimed profiles render the owner's own text. Unclaimed ones get a factual
 * summary built from the row — never the mockup's editorial claims, which are
 * not in the data. See the file header.
 */
function About({
  contractor,
  name,
  typeName,
  countyName,
  siblings,
  asOf,
}: {
  contractor: ContractorProfile;
  name: string;
  typeName: string | null;
  countyName: string | null;
  siblings: SiblingLicense[];
  /** Threaded from the page rather than fetched here — see lib/data-as-of.ts. */
  asOf: string;
}) {
  const claimed = isClaimed(contractor);
  const sinceYear = yearOf(contractor.original_license_date);
  const agent = formatPersonName(contractor.qualifying_agent_name);
  const currentSiblings = siblings.filter(isCurrentLicense);

  return (
    <section className="mb-12">
      <h2 className="mb-4 font-serif text-[26px] font-semibold tracking-[-0.015em] text-navy">
        About {name}
      </h2>

      {claimed && contractor.custom_about_text ? (
        <div className="text-base leading-[1.7] tracking-[-0.005em] text-gray-700">
          {contractor.custom_about_text.split("\n").filter(Boolean).map((para, i) => (
            <p key={i} className="mb-3.5 last:mb-0">
              {para}
            </p>
          ))}
        </div>
      ) : (
        <div className="text-base leading-[1.7] tracking-[-0.005em] text-gray-700">
          <p className="mb-3.5">
            {name} is a Florida-licensed contractor record published from the
            Florida DBPR public extract
            {contractor.city && countyName && (
              <>
                , with a mailing address in{" "}
                {formatBusinessName(contractor.city)}, {countyName} County
              </>
            )}
            .{" "}
            {contractor.license_number && typeName && sinceYear && (
              <>
                The primary license on file ({contractor.license_number}) is a{" "}
                {typeName} first issued in {sinceYear}.
              </>
            )}
          </p>

          {contractor.is_business && (
            <p className="mb-3.5">
              The qualifying agent of record is {agent} — the licensed individual
              who legally backs the business.
              {currentSiblings.length > 1 && (
                <>
                  {" "}
                  {agent} qualifies {currentSiblings.length} current licenses,
                  listed below.
                </>
              )}
            </p>
          )}

          <p className="mb-3.5">
            {contractor.disciplinary_codes &&
            contractor.disciplinary_codes.length > 0 ? (
              <>
                DBPR records list {contractor.disciplinary_codes.length}{" "}
                disciplinary code(s) against this license:{" "}
                {contractor.disciplinary_codes.join(", ")}. Check with DBPR for
                the full detail of each action.
              </>
            ) : (
              /* "in the extract we last loaded on X", NOT "in the extract
                 dated X". The date is now derived from when we imported —
                 see lib/data-as-of.ts — and the DBPR extract's own publication
                 date is earlier and different. The old wording attributed our
                 import date to their document. */
              <>
                No disciplinary codes appear against this license in the extract
                we last loaded on {asOf}. That is not a guarantee of a clean
                record — verify current status directly with DBPR before you
                hire.
              </>
            )}
          </p>

          {/* An unclaimed profile is a public record and nothing more. Saying so
              is honest, and it is the natural place for the claim prompt. */}
          <p className="text-note italic text-gray-500">
            This profile has not been claimed by its owner. Everything above is
            drawn from public records — no description, photos, or contact
            details have been supplied by the business.
          </p>
        </div>
      )}
    </section>
  );
}

/** The licence table — all licences under this qualifying agent. */
function Licenses({
  siblings,
  currentSlug,
  typeNames,
}: {
  siblings: SiblingLicense[];
  currentSlug: string;
  typeNames: Map<string, { type_name: string; scope_description: string | null }>;
}) {
  if (siblings.length === 0) return null;

  return (
    <section className="mb-12">
      <h2 className="mb-4 font-serif text-[26px] font-semibold tracking-[-0.015em] text-navy">
        State Licenses{" "}
        <span className="font-mono text-ui font-medium tracking-[0.04em] text-gray-500">
          {siblings.length} on file
        </span>
      </h2>

      <div className="border border-gray-200 bg-paper-raised">
        <div className="grid grid-cols-[130px_1fr_110px_130px] gap-4 border-b border-gray-200 bg-gray-50 px-5 py-3 font-mono text-micro font-semibold uppercase tracking-[0.08em] text-gray-700 max-[900px]:hidden">
          <div>License #</div>
          <div>Type</div>
          <div>Issued</div>
          <div>Status</div>
        </div>

        <ul>
          {siblings.map((row) => {
            const info = typeNames.get(row.license_type);
            const isThisOne = row.slug === currentSlug;
            return (
              <li
                key={row.dbpr_sync_key}
                className="border-b border-gray-200 last:border-b-0"
              >
                <Link
                  href={`/contractor/${row.slug}`}
                  aria-current={isThisOne ? "page" : undefined}
                  className={`grid grid-cols-[130px_1fr_110px_130px] items-center gap-4 px-5 py-4 text-sm transition-colors hover:bg-gray-50 max-[900px]:grid-cols-1 max-[900px]:gap-1 ${FOCUS_RING_PAPER} ${
                    isThisOne ? "bg-gold-pale/40" : ""
                  }`}
                >
                  <span className="font-mono text-note font-medium tracking-[-0.01em] text-navy">
                    {row.license_number ?? "—"}
                  </span>
                  <span className="font-medium text-ink">
                    {info?.type_name ?? row.license_type}
                    <span className="mt-0.5 block text-xs font-normal text-gray-500">
                      {row.business_name
                        ? `DBA: ${formatBusinessName(row.business_name)}`
                        : info?.scope_description ?? "No DBA on file"}
                    </span>
                  </span>
                  <span className="font-mono text-[12.5px] text-gray-700">
                    {formatShortDate(row.original_license_date) ?? "—"}
                  </span>
                  <span>
                    <StatusBadge
                      status={row.license_status}
                      secondary={row.license_status_secondary}
                    />
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

/**
 * FAQ.
 *
 * Every answer is generated from the row, so nothing here can drift from the
 * data. The mockup's version asserts things the extract does not contain; these
 * assert only what it does.
 */
function Faq({
  contractor,
  name,
  countyName,
  siblings,
  asOf,
}: {
  contractor: ContractorProfile;
  name: string;
  countyName: string | null;
  siblings: SiblingLicense[];
  /** Threaded from the page rather than fetched here — see lib/data-as-of.ts. */
  asOf: string;
}) {
  const current = isCurrentLicense(contractor);
  const currentCount = siblings.filter(isCurrentLicense).length;
  const agent = formatPersonName(contractor.qualifying_agent_name);
  const statewide = contractor.license_type.startsWith("C");

  const items: { q: string; a: React.ReactNode }[] = [
    {
      q: `Is ${name} licensed in Florida?`,
      a: current ? (
        <>
          Yes. DBPR records show license{" "}
          {contractor.license_number ?? "on file"} as {contractor.license_status}
          {contractor.license_status_secondary &&
            ` with ${contractor.license_status_secondary} secondary status`}
          , expiring {formatDate(contractor.expiration_date) ?? "on a date not on file"}.
          {currentCount > 1 &&
            ` ${agent} qualifies ${currentCount} current licenses in total.`}
        </>
      ) : (
        <>
          Not currently. DBPR records show this license as{" "}
          {contractor.license_status}
          {contractor.expiration_date &&
            `, with an expiration date of ${formatDate(contractor.expiration_date)}`}
          . Verify directly with DBPR before hiring.
        </>
      ),
    },
    {
      q: `Where does ${name} operate?`,
      a: (
        <>
          The address on file is in{" "}
          {contractor.city ? formatBusinessName(contractor.city) : "Florida"}
          {countyName && `, ${countyName} County`}.{" "}
          {statewide
            ? "Because this is a Certified license, it carries statewide authority and work may be performed in any Florida county."
            : "This is a Registered license, which is limited to the local jurisdiction that issued it rather than the whole state."}
        </>
      ),
    },
    {
      q: `Has ${name} had any disciplinary actions?`,
      a:
        contractor.disciplinary_codes && contractor.disciplinary_codes.length > 0 ? (
          <>
            The extract lists {contractor.disciplinary_codes.length} disciplinary
            code(s): {contractor.disciplinary_codes.join(", ")}. Consult DBPR for
            the detail behind each code.
          </>
        ) : (
          /* Reworded with the About copy above, for the same reason. */
          <>
            No disciplinary codes appear in the DBPR extract we last loaded on{" "}
            {asOf}. Records may have changed since that refresh.
          </>
        ),
    },
    {
      q: "Is this profile claimed by the business?",
      a: isClaimed(contractor) ? (
        <>
          Yes. This profile has been claimed and verified by its owner, who
          supplied the description and contact details shown.
        </>
      ) : (
        <>
          Not yet. This profile is built entirely from public DBPR records. If
          you are {agent} or an authorized representative, you can claim it and
          add your own information.
        </>
      ),
    },
  ];

  return (
    <section className="mb-12">
      <h2 className="mb-4 font-serif text-[26px] font-semibold tracking-[-0.015em] text-navy">
        Common Questions
      </h2>
      <dl>
        {items.map(({ q, a }) => (
          <div key={q} className="border-b border-gray-200 py-[18px] last:border-b-0">
            <dt className="mb-2 font-serif text-lg font-semibold tracking-[-0.01em] text-ink">
              {q}
            </dt>
            <dd className="text-[14.5px] leading-[1.6] text-gray-700">{a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ========================================================================== *
 * QUOTE CTA
 * ========================================================================== */

/**
 * "Request a Quote" — what stands where the inquiry form used to.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE INQUIRY FORM WAS REMOVED FROM THIS PAGE ON 2026-08-07.
 *
 * It posted to submitInquiry in ./actions.ts and wrote the `inquiries` table.
 * That action, that table, the /inquiries inbox and its RLS are all still in
 * place and untouched — the form is simply no longer rendered, so nothing links
 * to the endpoint any more. Legacy inquiries remain readable by the contractors
 * who received them; the inbox is read-only history from today.
 *
 * WHY IT WENT: the site had two consumer capture paths that did not meet. A
 * message here reached one unclaimed business's inbox, which they may never
 * check — 266,305 profiles exist and almost none are claimed — while the
 * diagnostic reached a concierge who actually calls people back. Sending a
 * homeowner to the second is better for them and for the business.
 *
 * ⚠ THIS CARRIES ?from=<slug>, WHICH IS LOAD-BEARING. It is what puts the
 * referring business on the lead in GoHighLevel (the "FCR Referring Contractor"
 * field) and in leads.referring_url. Drop the parameter and the concierge
 * calling that homeowner has no idea which profile they were looking at.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * NO FORM, SO NO CLIENT JS. This is one <Link>, which is why removing the
 * inquiry form also returned this page to shipping no client JavaScript — see
 * the note at the top of the file.
 */
function QuoteCta({ name, slug }: { name: string; slug: string }) {
  return (
    <SideBlock title="Thinking about a project?">
      <p className="mb-4 text-note leading-[1.6] text-gray-700">
        Seven quick questions about what you&rsquo;re planning, and an advisor
        will call you back to walk through your options &mdash; including the
        ones most homeowners don&rsquo;t know they have before signing with
        anyone.
      </p>

      <Link
        href={`/diagnostic?from=${encodeURIComponent(slug)}`}
        className={`inline-block bg-navy px-[18px] py-[11px] font-mono text-[12.5px] font-semibold uppercase tracking-[0.03em] text-paper transition-colors hover:bg-navy-deep ${FOCUS_RING_PAPER}`}
      >
        Request a Quote &rarr;
      </Link>

      <p className="mt-3.5 text-xs leading-[1.5] text-gray-500">
        Free, no obligation, and no credit check. We&rsquo;ll note that you came
        from {endSentence(name)}
      </p>
    </SideBlock>
  );
}

/* ========================================================================== *
 * PAGE
 * ========================================================================== */

/**
 * searchParams is gone from this signature. It existed only to carry the
 * inquiry form's `?inquiry=sent` / `?inquiry=invalid&e=…` round trip, and that
 * form was removed on 2026-08-07. The page now reads nothing from the query
 * string, which is also what lets it go back to being fully static-shaped.
 */
export default async function ContractorProfilePage({
  params,
}: {
  params: { slug: string };
}) {
  const db = createClient();
  const asOf = await dataAsOf();
  const contractor = await getContractorBySlug(db, params.slug);

  // An unknown slug is a 404, not an empty page — it renders app/not-found.tsx
  // and returns the right status code so search engines drop the URL.
  if (!contractor) notFound();

  const [siblings, countyName, countySlug] = await Promise.all([
    getSiblingLicenses(db, contractor.qualifying_agent_name),
    getCountyName(db, contractor.county_code),
    getCountySlug(db, contractor.county_code),
  ]);

  const typeNames = await getLicenseTypeInfo(db, [
    contractor.license_type,
    ...siblings.map((s) => s.license_type),
  ]);

  const name = contractor.business_name
    ? formatBusinessName(contractor.business_name)
    : formatPersonName(contractor.qualifying_agent_name);
  const typeName = typeNames.get(contractor.license_type)?.type_name ?? null;
  const claimed = isClaimed(contractor);

  return (
    <>
      <Header statsTimestamp={asOf} />
      <Breadcrumb
        countyName={countyName}
        countySlug={countySlug}
        city={contractor.city}
        typeName={typeName}
        typeCode={contractor.license_type}
        name={name}
      />

      <main className="mx-auto grid max-w-shell grid-cols-[1fr_360px] gap-16 px-8 pb-[72px] pt-14 max-[1000px]:grid-cols-1 max-[1000px]:gap-10">
        <div>
          <Hero
            contractor={contractor}
            name={name}
            typeName={typeName}
            countyName={countyName}
            siblings={siblings}
          />
          <About
            contractor={contractor}
            name={name}
            typeName={typeName}
            countyName={countyName}
            siblings={siblings}
            asOf={asOf}
          />
          <Licenses
            siblings={siblings}
            currentSlug={contractor.slug}
            typeNames={typeNames}
          />
          <Faq
            contractor={contractor}
            name={name}
            countyName={countyName}
            siblings={siblings}
            asOf={asOf}
          />
        </div>

        <aside className="self-start max-[1000px]:static lg:sticky lg:top-6">
          {/* Stairway Mortgage — Sponsored */}
          <div className="mb-5">
            <span className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2z"/></svg>
              Sponsored
            </span>
            <StairwayAd size="300x250" />
          </div>

          <SideBlock title="Primary License">
            <dl>
              <DlRow term="License Number">
                <span className="font-mono text-[17px] text-navy">
                  {contractor.license_number ?? "None on file"}
                </span>
              </DlRow>
              <DlRow term="License Type">{typeName ?? contractor.license_type}</DlRow>
              <DlRow term="Issued">
                {formatDate(contractor.original_license_date) ?? "Not on file"}
              </DlRow>
              <DlRow term="Expires">
                {formatDate(contractor.expiration_date) ?? "Not on file"}
              </DlRow>
              <DlRow term="Status">
                <StatusBadge
                  status={contractor.license_status}
                  secondary={contractor.license_status_secondary}
                />
              </DlRow>
            </dl>

            {contractor.license_number && (
              <a
                href={dbprVerifyUrl(contractor.license_number)}
                rel="noopener noreferrer nofollow"
                target="_blank"
                className={`mt-[18px] block bg-navy px-4 py-3.5 text-center text-[12.5px] font-medium tracking-[0.02em] text-paper transition-colors hover:bg-navy-deep ${FOCUS_RING_PAPER}`}
              >
                <span className="mb-1 block font-mono text-label uppercase tracking-[0.1em] text-gold-light">
                  Verify on
                </span>
                myfloridalicense.com →
              </a>
            )}
          </SideBlock>

          <SideBlock title="Business Information">
            <dl>
              <DlRow term="Qualifying Agent">
                {formatPersonName(contractor.qualifying_agent_name)}
              </DlRow>
              {(contractor.address_line || contractor.city) && (
                <DlRow term="Mailing Address">
                  <span className="font-serif text-[15.5px] italic leading-[1.5] text-gray-700">
                    {contractor.address_line &&
                      formatBusinessName(contractor.address_line)}
                    {contractor.address_line && <br />}
                    {contractor.city && formatBusinessName(contractor.city)},{" "}
                    {contractor.state} {contractor.zip}
                    {countyName && (
                      <>
                        <br />
                        {countyName} County
                      </>
                    )}
                  </span>
                </DlRow>
              )}

              {/* CLAIMED-ONLY. Owner-supplied contact details are only shown
                  once a verified owner has taken the profile over; on an
                  unclaimed profile these columns are always NULL anyway. */}
              {claimed && contractor.custom_phone && (
                <DlRow term="Phone">{contractor.custom_phone}</DlRow>
              )}
              {claimed && contractor.custom_email && (
                <DlRow term="Email">{contractor.custom_email}</DlRow>
              )}
              {claimed && contractor.custom_website_url && (
                <DlRow term="Website">
                  <a
                    href={contractor.custom_website_url}
                    rel="noopener noreferrer nofollow"
                    target="_blank"
                    className={`text-navy underline decoration-gold underline-offset-2 ${FOCUS_RING_PAPER}`}
                  >
                    {contractor.custom_website_url.replace(/^https?:\/\//, "")}
                  </a>
                </DlRow>
              )}
              {/* Service area is rendered here rather than left for a later
                  task: /manage/[slug] collects it, so without this the editor
                  would take a field that goes nowhere and the editor's own
                  preview would show something the public page does not. */}
              {claimed && contractor.custom_service_area && (
                <DlRow term="Service area">{contractor.custom_service_area}</DlRow>
              )}
            </dl>
          </SideBlock>

          <QuoteCta name={name} slug={contractor.slug} />

          <div className="mb-5 border-l-[3px] border-gold bg-gold-pale px-[18px] py-3.5 text-ui leading-[1.5] text-ink">
            <span className="mb-1.5 block font-mono text-label font-semibold uppercase tracking-[0.1em] text-navy">
              Data Refresh Notice
            </span>
            License information shown is republished from public records of the
            Florida Department of Business and Professional Regulation (DBPR),{" "}
            <strong className="font-semibold text-navy">
              last refreshed {asOf}.
            </strong>{" "}
            License status may have changed since this refresh.
          </div>

          {!claimed && (
            <div className="border border-dashed border-gray-300 bg-gray-50 p-[22px]">
              <span
                aria-hidden="true"
                className="mb-3.5 flex h-8 w-8 items-center justify-center bg-navy font-serif font-bold italic text-gold"
              >
                {name.charAt(0)}
              </span>
              <h2 className="mb-2 font-serif text-[17px] font-semibold tracking-[-0.01em] text-ink">
                Is this your business?
              </h2>
              <p className="mb-3.5 text-note leading-[1.5] text-gray-700">
                Claim this profile to verify your identity, add a description, and
                update your contact information. Free, takes 5 minutes.
              </p>
              {/* Anon visitors are not stopped here — middleware and the page's
                  own requireUser() send them to /login carrying this path as
                  `next`, so they return to the form after the magic link rather
                  than being asked to find it again. */}
              <Link
                href={`/contractor/${contractor.slug}/claim`}
                className={`inline-block border border-navy px-[18px] py-[9px] font-mono text-[12.5px] font-semibold uppercase tracking-[0.03em] text-navy transition-colors hover:bg-navy hover:text-paper ${FOCUS_RING_PAPER}`}
              >
                Claim Profile →
              </Link>
            </div>
          )}

          {isFeatured(contractor) && (
            <p className="mt-4 inline-flex items-center gap-2 bg-gold px-3 py-1.5 font-mono text-label font-semibold uppercase tracking-label text-navy-deep">
              ★ Featured contractor
            </p>
          )}
        </aside>
      </main>

      <Footer lastSyncDate={asOf} />
    </>
  );
}
