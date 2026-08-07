import type { Metadata } from "next";
import Link from "next/link";

import Footer from "@/components/Footer";
import Header from "@/components/Header";
import SubmitButton from "@/components/SubmitButton";
import { getCountiesWithCounts } from "@/lib/browse";
import { formatBusinessName, formatPersonName } from "@/lib/contractor-profile";
import { dataAsOf } from "@/lib/data-as-of";
import { FOCUS_RING_PAPER } from "@/lib/focus";
import {
  LIMITS,
  REQUEST_ERROR_TEXT,
  TRADES,
} from "@/lib/registry-requests";
import {
  MIN_QUERY_LENGTH,
  parseQuery,
  searchContractors,
  sortFeaturedFirst,
  type ContractorResult,
} from "@/lib/search";
import { createClient } from "@/lib/supabase/server";

import { submitRegistryRequest } from "./actions";

/**
 * Join the registry — /join
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE DOOR FOR BUSINESSES, REPLACING TWO THAT DID NOT MEET.
 *
 * Before this page there were two contractor-facing entry points and neither
 * worked end to end:
 *
 *   · /contractors said "Claiming opens soon" and had done since before the
 *     claim flow shipped. It was linked from the header, the footer, the
 *     homepage and three content pages, so the most prominent contractor CTA on
 *     the site pointed at a page telling them to come back later.
 *   · /contractor/[slug]/claim was live and reachable only from a profile the
 *     contractor had to find first — and 47% of rows have a NULL licence
 *     number, so "search your licence number" frequently finds nothing.
 *
 * This page is the missing step in front of both: look the business up, and
 * route to whichever answer is true. A match goes into the EXISTING claim flow —
 * there is no second claim implementation here, only a link into it. A miss
 * becomes a registry request, which is a queue for a human rather than a write
 * into the DBPR-derived contractors table.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ THE LOOKUP SEARCHES BY NAME OR LICENCE, AND MUST KEEP DOING BOTH. Two facts
 * about the extract make a licence-only lookup useless here: license_number is
 * NULL on roughly 47% of the 266,305 rows, and there are ~140 duplicate licence
 * numbers. searchContractors already handles both — it tries exact licence
 * equality first, falls back to substring across business name, qualifying
 * agent, city and licence, and returns every match rather than one. Showing
 * several and letting the owner pick is the whole design; picking for them would
 * hand someone the wrong business.
 *
 * STATE LIVES IN THE URL, not in a client component:
 *   ?q=…      the lookup
 *   ?add=1    the request form (reached from "none of these", or a no-match)
 *   ?sent=1   the confirmation
 *   ?e=…      field errors echoed back by the Server Action
 *   ?name=…   the business name refilled after a refused submission
 *
 * The page therefore ships no client JavaScript beyond SubmitButton, and the
 * whole flow works with JS disabled.
 */

export const metadata: Metadata = {
  title: "Get listed or claim your business · Florida Contractor Registry",
  description:
    "Find your Florida contractor license to claim your profile, or ask us to add your business to the registry.",
  alternates: { canonical: "/join" },
  // A form flow has nothing to rank for, and it must not compete with the
  // profile pages it exists to feed. Same call as /diagnostic.
  robots: { index: false, follow: true },
};

/** Result rows shown before "these are all of them" stops being true. */
const SHOWN = 12;

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 font-mono text-micro font-semibold uppercase tracking-eyebrow text-gold">
      {children}
    </p>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-label font-medium uppercase tracking-[0.08em] text-gray-500">
      {children}
    </span>
  );
}

const INPUT_CLASS =
  "border border-gray-300 bg-white px-3 py-2 text-note text-ink focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/10";

/**
 * One candidate from the lookup.
 *
 * The licence number and city are shown because they are how someone tells two
 * identically-named businesses apart — and with ~140 duplicate licence numbers
 * in the extract, sometimes the city is the only discriminator.
 */
function MatchRow({ row }: { row: ContractorResult }) {
  // business_name is NULL on ~125k rows; the qualifying agent is the fallback
  // the profile page itself renders in that case, so the two agree.
  const name = row.business_name
    ? formatBusinessName(row.business_name)
    : formatPersonName(row.qualifying_agent_name);

  return (
    <li className="border border-gray-200 bg-paper-raised px-5 py-4">
      <p className="text-[16px] font-semibold leading-[1.35] text-navy">{name}</p>
      <p className="mt-1 font-mono text-note text-gray-600">
        {row.license_number ?? "No license number on file"}
        {row.city ? ` · ${formatBusinessName(row.city)}, FL` : ""}
        {row.license_status ? ` · ${row.license_status}` : ""}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {/* Anon visitors are not stopped here — the claim page's own
            requireUser() sends them to /login carrying that path as `next`, so
            they land back on the form after the magic link. */}
        <Link
          href={`/contractor/${row.slug}/claim`}
          className={`inline-block border border-navy px-[18px] py-[9px] font-mono text-[12.5px] font-semibold uppercase tracking-[0.03em] text-navy transition-colors hover:bg-navy hover:text-paper ${FOCUS_RING_PAPER}`}
        >
          This is my business →
        </Link>
        <Link
          href={`/contractor/${row.slug}`}
          className={`font-mono text-label uppercase tracking-label text-gray-600 underline underline-offset-2 ${FOCUS_RING_PAPER}`}
        >
          View profile
        </Link>
      </div>
    </li>
  );
}

export default async function JoinPage({
  searchParams,
}: {
  searchParams: { q?: string; add?: string; sent?: string; e?: string; name?: string };
}) {
  const asOf = await dataAsOf();

  const rawQuery = searchParams.q ?? "";
  const parsed = parseQuery(rawQuery);
  const showAddForm = searchParams.add === "1";
  const sent = searchParams.sent === "1";

  // Codes are matched against the known map before rendering, so a crafted ?e=
  // cannot put arbitrary text on the page.
  const errorCodes = (searchParams.e ?? "")
    .split(",")
    .filter((code) => code in REQUEST_ERROR_TEXT);

  let results: ContractorResult[] = [];
  let total = 0;
  /**
   * True when the registry holds more matches than the search cap. The lookup no
   * longer runs a count (see lib/search.ts), so `total` is exact only when this
   * is false — printing it regardless would claim "50 records match" for a name
   * with thousands.
   */
  let hasMore = false;
  let searchFailed = false;

  if (!showAddForm && !sent && parsed.tokens.length > 0) {
    const db = createClient();
    const found = await searchContractors(db, parsed);
    results = sortFeaturedFirst(found.rows);
    total = found.total;
    hasMore = found.hasMore;
    searchFailed = found.failed;
  }

  /**
   * The county list is only read when the form is actually on screen. It is one
   * indexed request against the 67-row reference table, but the lookup step is
   * the common path and should not pay for a control it does not render.
   */
  const counties = showAddForm ? await getCountiesWithCounts(createClient()) : [];

  const searched = !showAddForm && !sent && rawQuery.trim() !== "";
  const noMatches = searched && !parsed.tooShort && !searchFailed && results.length === 0;

  return (
    <>
      <Header statsTimestamp={asOf} />

      <main id="main" className="bg-paper">
        <div className="mx-auto max-w-[760px] px-6 py-16 max-[700px]:py-10">
          <Eyebrow>For Florida contractors</Eyebrow>
          <h1 className="mb-4 font-serif text-[38px] font-semibold leading-[1.1] tracking-[-0.025em] text-navy max-[700px]:text-[29px]">
            Get listed or <em className="italic">claim your business.</em>
          </h1>

          {sent ? (
            <SentPanel />
          ) : showAddForm ? (
            <AddForm
              counties={counties}
              errorCodes={errorCodes}
              defaultName={searchParams.name ?? ""}
            />
          ) : (
            <>
              <p className="mb-8 max-w-[560px] text-[17px] leading-[1.55] text-gray-700">
                Every Florida contractor licensed with DBPR already has a record
                here &mdash; including yours. Find it to take control of what
                homeowners see. If it isn&rsquo;t here, tell us and we&rsquo;ll
                look into adding it.
              </p>

              {/* GET, so a lookup is a shareable URL and the back button works.
                  This is navigation, not a write — it posts nowhere. */}
              <form action="/join" method="get" role="search" className="mb-3 flex gap-2">
                <label htmlFor="q" className="sr-only">
                  Business name or license number
                </label>
                <input
                  id="q"
                  name="q"
                  type="search"
                  defaultValue={rawQuery}
                  placeholder="Business name, your name, or license number"
                  maxLength={120}
                  className={`flex-1 ${INPUT_CLASS}`}
                />
                <button
                  type="submit"
                  className={`bg-navy px-6 py-2 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-paper transition-colors hover:bg-navy-deep ${FOCUS_RING_PAPER}`}
                >
                  Find it
                </button>
              </form>

              <p className="mb-8 text-xs leading-[1.5] text-gray-500">
                Roughly half our records carry no license number, so searching by
                business name or your own name often works better.
              </p>

              {parsed.tooShort && rawQuery.trim() !== "" && (
                <Notice heading="That search was too short.">
                  Enter at least {MIN_QUERY_LENGTH} characters.
                </Notice>
              )}

              {searchFailed && (
                <Notice heading="We couldn't run that search.">
                  Something went wrong on our side &mdash; this is not a result,
                  it&rsquo;s a failure. Please try again in a moment.
                </Notice>
              )}

              {results.length > 0 && (
                <section className="mb-10">
                  <h2 className="mb-4 font-serif text-[22px] font-semibold text-navy">
                    {hasMore
                      ? "More than 50 records match"
                      : total === 1
                        ? "One record matches"
                        : `${total.toLocaleString("en-US")} records match`}
                  </h2>
                  <ul className="flex flex-col gap-3">
                    {results.slice(0, SHOWN).map((row) => (
                      <MatchRow key={row.dbpr_sync_key} row={row} />
                    ))}
                  </ul>
                  {(hasMore || total > SHOWN) && (
                    <p className="mt-4 text-note leading-[1.6] text-gray-600">
                      Showing the first {SHOWN}. If yours isn&rsquo;t here, add
                      your city or license number to the search.
                    </p>
                  )}
                </section>
              )}

              {noMatches && (
                <Notice heading={`Nothing matches "${parsed.raw}".`}>
                  That doesn&rsquo;t necessarily mean you aren&rsquo;t in the
                  registry &mdash; try your own name as the qualifying agent, or
                  your city. If you&rsquo;ve tried those, ask us to add the
                  business.
                </Notice>
              )}

              {searched && !parsed.tooShort && !searchFailed && (
                <div className="border-t border-gray-200 pt-6">
                  <p className="mb-3 text-note leading-[1.6] text-gray-700">
                    {results.length > 0
                      ? "None of these is my business."
                      : "Can't find it?"}
                  </p>
                  <Link
                    href={`/join?add=1${
                      parsed.raw ? `&name=${encodeURIComponent(parsed.raw)}` : ""
                    }`}
                    className={`inline-block bg-navy px-[18px] py-[11px] font-mono text-[12.5px] font-semibold uppercase tracking-[0.03em] text-paper transition-colors hover:bg-navy-deep ${FOCUS_RING_PAPER}`}
                  >
                    Request to be added →
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <Footer lastSyncDate={asOf} />
    </>
  );
}

function Notice({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-8 border-l-[3px] border-l-gold bg-gray-50 px-5 py-4">
      <p className="mb-2 font-mono text-label font-semibold uppercase tracking-label text-navy">
        {heading}
      </p>
      <p className="text-note leading-[1.6] text-gray-700">{children}</p>
    </div>
  );
}

function SentPanel() {
  return (
    <>
      <div className="mb-8 border-l-[3px] border-l-gold bg-gray-50 px-5 py-4">
        <p className="mb-2 font-mono text-label font-semibold uppercase tracking-label text-navy">
          Request received.
        </p>
        <p className="text-note leading-[1.6] text-gray-700">
          We&rsquo;ve emailed you a copy. A person checks every request against
          public DBPR records and will reply to that address either way.
        </p>
      </div>
      <p className="text-note leading-[1.6] text-gray-700">
        This isn&rsquo;t a listing yet &mdash;{" "}
        <Link href="/search">search the registry</Link> once more in the
        meantime, since most licensees are already in it under a name they
        don&rsquo;t expect.
      </p>
    </>
  );
}

/**
 * The "request to be added" form.
 *
 * TWO REQUIRED FIELDS ONLY — business name and email. A business that cannot
 * remember its licence number is precisely the business this queue exists to
 * catch, so requiring one would turn away the intended user. Everything else
 * makes the reviewer's job faster and nothing more.
 *
 * The client-side attributes are courtesies for real people and are NOT the
 * validation; lib/registry-requests.ts re-checks every field on the server and
 * treats all of this as absent.
 */
function AddForm({
  counties,
  errorCodes,
  defaultName,
}: {
  counties: { county_code: string; county_name: string }[];
  errorCodes: string[];
  defaultName: string;
}) {
  return (
    <>
      <p className="mb-8 max-w-[560px] text-[17px] leading-[1.55] text-gray-700">
        Tell us about the business and we&rsquo;ll check it against public DBPR
        records. If we can match it to a license, we&rsquo;ll add the listing.
      </p>

      {errorCodes.length > 0 && (
        <div
          role="alert"
          className="mb-6 border-l-[3px] border-status-error bg-status-errorBg px-4 py-3"
        >
          <p className="mb-1 font-mono text-label font-semibold uppercase tracking-label text-status-error">
            Please fix the following
          </p>
          <ul className="list-disc pl-5 text-note text-status-error">
            {errorCodes.map((code) => (
              <li key={code}>{REQUEST_ERROR_TEXT[code]}</li>
            ))}
          </ul>
        </div>
      )}

      <form action={submitRegistryRequest} className="flex flex-col gap-4">
        {/* Honeypot. Hidden from people, filled in by naive bots. aria-hidden
            and tabIndex keep it away from screen readers and keyboard users. */}
        <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
          <label htmlFor="company_url">Company URL</label>
          <input id="company_url" name="company_url" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        <label className="flex flex-col gap-1">
          <FieldLabel>Business name</FieldLabel>
          <input
            name="business_name"
            type="text"
            required
            minLength={2}
            maxLength={LIMITS.businessName}
            defaultValue={defaultName}
            autoComplete="organization"
            className={INPUT_CLASS}
          />
        </label>

        <div className="grid grid-cols-2 gap-4 max-[600px]:grid-cols-1">
          <label className="flex flex-col gap-1">
            <FieldLabel>
              License number{" "}
              <span className="normal-case tracking-normal">(optional)</span>
            </FieldLabel>
            <input
              name="license_number"
              type="text"
              maxLength={LIMITS.licenseNumber}
              className={INPUT_CLASS}
            />
          </label>

          <label className="flex flex-col gap-1">
            <FieldLabel>
              Trade <span className="normal-case tracking-normal">(optional)</span>
            </FieldLabel>
            <select name="trade" defaultValue="" className={INPUT_CLASS}>
              <option value="">Choose one…</option>
              {TRADES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <FieldLabel>
            County <span className="normal-case tracking-normal">(optional)</span>
          </FieldLabel>
          {/*
            Stored as the county NAME, not the code. This row may never become a
            contractors row — a reviewer reading "Broward" needs no lookup, and a
            code would be dead data if the reference table ever changed shape.
          */}
          <select name="county" defaultValue="" className={INPUT_CLASS}>
            <option value="">Choose one…</option>
            {counties.map((c) => (
              <option key={c.county_code} value={c.county_name}>
                {c.county_name}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-4 max-[600px]:grid-cols-1">
          <label className="flex flex-col gap-1">
            <FieldLabel>
              Your name <span className="normal-case tracking-normal">(optional)</span>
            </FieldLabel>
            <input
              name="contact_name"
              type="text"
              maxLength={LIMITS.contactName}
              autoComplete="name"
              className={INPUT_CLASS}
            />
          </label>

          <label className="flex flex-col gap-1">
            <FieldLabel>Email</FieldLabel>
            <input
              name="email"
              type="email"
              required
              maxLength={LIMITS.email}
              autoComplete="email"
              className={INPUT_CLASS}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4 max-[600px]:grid-cols-1">
          <label className="flex flex-col gap-1">
            <FieldLabel>
              Phone <span className="normal-case tracking-normal">(optional)</span>
            </FieldLabel>
            <input
              name="phone"
              type="tel"
              maxLength={LIMITS.phone}
              autoComplete="tel"
              className={INPUT_CLASS}
            />
          </label>

          <label className="flex flex-col gap-1">
            <FieldLabel>
              Website <span className="normal-case tracking-normal">(optional)</span>
            </FieldLabel>
            <input
              name="website"
              type="text"
              maxLength={LIMITS.website}
              placeholder="yourbusiness.com"
              className={INPUT_CLASS}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <FieldLabel>
            Anything else{" "}
            <span className="normal-case tracking-normal">(optional)</span>
          </FieldLabel>
          <textarea
            name="notes"
            rows={4}
            maxLength={LIMITS.notes}
            className={`resize-y ${INPUT_CLASS}`}
          />
        </label>

        <SubmitButton
          pendingLabel="Sending…"
          className={`mt-1 self-start bg-navy px-6 py-3 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-paper transition-colors hover:bg-navy-deep ${FOCUS_RING_PAPER}`}
        >
          Send request
        </SubmitButton>

        <p className="text-xs leading-[1.5] text-gray-500">
          We use these details to check your business against public records and
          to reply. We don&rsquo;t sell them. See our{" "}
          <Link href="/privacy">privacy policy</Link>.
        </p>
      </form>

      <p className="mt-8 border-t border-gray-200 pt-6 text-note leading-[1.6] text-gray-600">
        Changed your mind? <Link href="/join">Search the registry again</Link>.
      </p>
    </>
  );
}
