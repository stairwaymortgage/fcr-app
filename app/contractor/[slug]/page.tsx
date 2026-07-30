import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import Footer from "@/components/Footer";
import Header from "@/components/Header";
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
import { FOCUS_RING_PAPER } from "@/lib/focus";
import { DATA_AS_OF } from "@/lib/registry-stats";
import { createClient } from "@/lib/supabase/server";

import { submitInquiry } from "./actions";

/**
 * Contractor profile — /contractor/[slug]
 * Source: _handoff/02_mockups_production/01_public_core/contractor_profile_aceca.html
 *
 * Server Component. The inquiry form posts to a Server Action, so the whole
 * page still ships zero client JS — no "use client" here or below.
 *
 * READS: lib/supabase/server.ts (anon, RLS). WRITE: ./actions.ts only.
 *
 * TWO DELIBERATE DEPARTURES FROM THE MOCKUP, both flagged rather than silently
 * resolved:
 *
 * 1. THE CONVERSION BANNER IS NOT BUILT. The mockup opens with a large
 *    "Before you sign..." banner linking into the diagnostic flow, and calls it
 *    "the ONE loud element on the page". Build Brief Week 4 Day 5 is
 *    "Banner placement. Add the conversion banner to contractor_profile_aceca,
 *    county/city/type pages, and homepage" — it ships with the diagnostic it
 *    feeds, which does not exist yet. Building it now would mean a prominent
 *    CTA pointing at a 404.
 *
 * 2. THE MOCKUP'S ABOUT PROSE CANNOT BE DERIVED FROM DBPR DATA. It contains
 *    claims like "a level of stability uncommon in an industry where most
 *    businesses dissolve within seven years" and specific statute citations.
 *    None of that is in the extract, and inventing it on an accuracy-pitched
 *    directory is exactly the wrong trade. The About section below states only
 *    what the row actually says. When a profile is claimed, the owner's own
 *    custom_about_text renders instead.
 *
 * The inquiry form is an ADDITION — the mockup has no contact form anywhere.
 * Built on request; placed in the sidebar under the licence details, where a
 * visitor who has just verified the licence is most likely to act.
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

  return (
    <div className="mb-9 border-b border-gray-200 pb-9">
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
}: {
  contractor: ContractorProfile;
  name: string;
  typeName: string | null;
  countyName: string | null;
  siblings: SiblingLicense[];
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
              <>
                No disciplinary codes appear against this license in the extract
                dated {DATA_AS_OF}. That is not a guarantee of a clean record —
                verify current status directly with DBPR before you hire.
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
}: {
  contractor: ContractorProfile;
  name: string;
  countyName: string | null;
  siblings: SiblingLicense[];
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
          <>
            No disciplinary codes appear in the DBPR extract dated {DATA_AS_OF}.
            Records may have changed since that refresh.
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
 * INQUIRY FORM
 * ========================================================================== */

const ERROR_TEXT: Record<string, string> = {
  name: "Enter your name (2–100 characters).",
  email: "Enter a valid email address.",
  phone: "That phone number doesn’t look right.",
  message: "Your message must be between 10 and 2,000 characters.",
  contractor: "We couldn’t match that contractor. Please reload and try again.",
  spam: "That submission looked automated. Please try again.",
  failed: "Something went wrong on our side. Please try again in a moment.",
};

/**
 * Contact form. NOT IN THE MOCKUP — added on request.
 *
 * Posts to the Server Action in ./actions.ts, which is the only write path in
 * the public app. No "use client": a plain form with a server action works
 * without JavaScript, and validation feedback comes back through the URL rather
 * than through useFormState (which would require a client bundle).
 *
 * The client-side attributes below (required, maxLength, type="email") are
 * courtesies for real users and are NOT the validation. A server action is a
 * directly callable endpoint, so actions.ts re-checks every field on the
 * server and treats all of this as absent.
 */
function InquiryForm({
  contractor,
  name,
  state,
  errorCodes,
}: {
  contractor: ContractorProfile;
  name: string;
  state: string | undefined;
  errorCodes: string[];
}) {
  if (state === "sent") {
    return (
      <SideBlock title="Message sent">
        <p className="text-note leading-[1.6] text-gray-700">
          Your message has been sent to {name}. They&rsquo;ll see it the next time
          they check their inquiries.
        </p>
        <p className="mt-3 text-xs leading-[1.6] text-gray-500">
          This profile is unclaimed, so the business has not yet verified its
          contact details with us. If you don&rsquo;t hear back, verify the
          license with DBPR and contact them directly.
        </p>
      </SideBlock>
    );
  }

  return (
    <SideBlock title={`Contact ${name}`}>
      {errorCodes.length > 0 && (
        <ul className="mb-4 border-l-[3px] border-status-error bg-status-errorBg px-4 py-3 text-xs leading-[1.55] text-status-error">
          {errorCodes.map((code) => (
            <li key={code}>{ERROR_TEXT[code] ?? "Please check your details."}</li>
          ))}
        </ul>
      )}

      <form action={submitInquiry} className="flex flex-col gap-3">
        <input type="hidden" name="slug" value={contractor.slug} />
        <input
          type="hidden"
          name="contractor_dbpr_sync_key"
          value={contractor.dbpr_sync_key}
        />

        {/* Honeypot. Hidden from people, filled in by naive bots. aria-hidden
            and tabIndex keep it away from screen readers and keyboard users. */}
        <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
          <label htmlFor="website">Website</label>
          <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-label font-medium uppercase tracking-[0.08em] text-gray-500">
            Your name
          </span>
          <input
            name="from_name"
            type="text"
            required
            minLength={2}
            maxLength={100}
            autoComplete="name"
            className="border border-gray-300 bg-white px-3 py-2 text-note text-ink focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/10"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-label font-medium uppercase tracking-[0.08em] text-gray-500">
            Email
          </span>
          <input
            name="from_email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            className="border border-gray-300 bg-white px-3 py-2 text-note text-ink focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/10"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-label font-medium uppercase tracking-[0.08em] text-gray-500">
            Phone <span className="normal-case tracking-normal">(optional)</span>
          </span>
          <input
            name="from_phone"
            type="tel"
            maxLength={32}
            autoComplete="tel"
            className="border border-gray-300 bg-white px-3 py-2 text-note text-ink focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/10"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-mono text-label font-medium uppercase tracking-[0.08em] text-gray-500">
            What do you need done?
          </span>
          <textarea
            name="message"
            required
            minLength={10}
            maxLength={2000}
            rows={4}
            className="resize-y border border-gray-300 bg-white px-3 py-2 text-note text-ink focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/10"
          />
        </label>

        <button
          type="submit"
          className={`mt-1 bg-navy px-4 py-3 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-paper transition-colors hover:bg-navy-light ${FOCUS_RING_PAPER}`}
        >
          Send message
        </button>

        <p className="text-xs leading-[1.5] text-gray-500">
          Your message goes to this contractor through the registry. We
          don&rsquo;t sell your details.
        </p>
      </form>
    </SideBlock>
  );
}

/* ========================================================================== *
 * PAGE
 * ========================================================================== */

export default async function ContractorProfilePage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { inquiry?: string; e?: string };
}) {
  const db = createClient();
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
  const errorCodes =
    searchParams.inquiry === "invalid" && searchParams.e
      ? searchParams.e.split(",").filter((c) => c in ERROR_TEXT)
      : [];

  return (
    <>
      <Header statsTimestamp={DATA_AS_OF} />
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
          />
        </div>

        <aside className="self-start max-[1000px]:static lg:sticky lg:top-6">
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
                className={`mt-[18px] block bg-navy px-4 py-3.5 text-center text-[12.5px] font-medium tracking-[0.02em] text-paper transition-colors hover:bg-navy-light ${FOCUS_RING_PAPER}`}
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
            </dl>
          </SideBlock>

          <InquiryForm
            contractor={contractor}
            name={name}
            state={searchParams.inquiry}
            errorCodes={errorCodes}
          />

          <div className="mb-5 border-l-[3px] border-gold bg-gold-pale px-[18px] py-3.5 text-ui leading-[1.5] text-ink">
            <span className="mb-1.5 block font-mono text-label font-semibold uppercase tracking-[0.1em] text-navy">
              Data Refresh Notice
            </span>
            License information shown is republished from public records of the
            Florida Department of Business and Professional Regulation (DBPR),{" "}
            <strong className="font-semibold text-navy">
              last refreshed {DATA_AS_OF}.
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
              <Link
                href="/contractors"
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

      <Footer lastSyncDate={DATA_AS_OF} />
    </>
  );
}
