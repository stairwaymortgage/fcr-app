import type { Metadata } from "next";
import Link from "next/link";

import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { dataAsOf } from "@/lib/data-as-of";
import { FOCUS_RING_PAPER } from "@/lib/focus";
import {
  contractorCountLabel,
  COUNTY_COUNT,
  LICENSE_TYPE_COUNT,
} from "@/lib/registry-stats";

/**
 * 404 — lost-visitor recovery page.
 * Source: _handoff/02_mockups_production/09_utility/404.html
 * Spec: Build Brief v1.3 §04 · FILE INVENTORY, Utility (1), which reads
 *       verbatim:
 *
 *         #        28
 *         File     404.html
 *         URL      /404
 *         Purpose  Lost-visitor recovery page. Search bar + helpful links to
 *                  browse counties/types.
 *
 * §11 has no StatusBanner-style entry for this page — it lists seven
 * components and 404 is not one. Its only §11 appearance is inside the Header
 * entry: "Used on: homepage, contractor profiles, search results,
 * county/city/type indexes, county/city/type single pages, for-contractors,
 * all 12 content+legal pages, 404."
 *
 * Server component. Next renders app/not-found.tsx for unmatched routes and
 * for notFound() calls. Search is a native GET form and every link is a
 * <Link>; nothing needs client JS.
 *
 * HEADER: the shipped <Header> is used as-is. The mockup's own header markup
 * is a simplified stand-in with no search bar, predating the component system,
 * and §11 explicitly assigns Header to this page. That means the page carries
 * two search inputs — the site-nav one in the chrome and the recovery one in
 * the right column. They serve different purposes and no searchless Header
 * variant is forked for a single consumer.
 *
 * FOOTER: the shipped <Footer> is used, NOT the mockup's abbreviated one.
 * 404.html's footer names the operating entity as "Florida Contractor Registry
 * LLC" — the STALE pre-bd8541c name. The attorney-mandated entity is Olga's
 * Friends LLC, with "Florida Contractor Registry" as a DBA taking no LLC
 * suffix. Deliberately not matched: byte-for-byte fidelity on legal text
 * exists to serve legal accuracy, and matching a mockup that predates the
 * correction would knowingly ship a wrong entity name. Same principle as
 * §03-beats-mockup on pure white. The mockup file itself should be corrected —
 * flagged for Jim.
 *
 * ICONS ARE INLINE SVG. The mockup draws the search glyph as a CSS background
 * data-URI and the three link arrows as "→" text characters (U+2192).
 * Both are redrawn as geometry, consistent with the StatusBanner ruling: text
 * glyphs render inconsistently across platforms and can fall back to a
 * colour-emoji face.
 *
 * The search icon is NOT shared with Header's. Same geometry, different spec:
 * this one is 18x18 stroked navy, Header's is 16x16 stroked gray-500.
 */

export const metadata: Metadata = {
  // Byte-for-byte from the mockup's <title>.
  title: "Page Not Found — Florida Contractor Registry",
};

/**
 * The hard-coded LAST_SYNC_DATE that stood here is gone.
 *
 * It read "May 24, 2026" — the mockups' value — with a note saying "a 404
 * showing a stale sync date is a small lie, but it is still a lie" and to wire
 * it to the real timestamp in Week 2. That is now lib/data-as-of.ts, and this
 * file is one of three that carried its own copy of the same literal.
 *
 * This component became async to read it. A 404 is rendered by Next for every
 * unmatched route and for every notFound() call, so it now costs one indexed
 * query on those paths — the same query the page that 404'd would have made.
 */

const RECOVERY_LINKS = [
  {
    href: "/counties",
    text: `All ${COUNTY_COUNT} Florida counties`,
    sub: "Browse by county",
  },
  {
    href: "/types",
    text: `All ${LICENSE_TYPE_COUNT} license types`,
    sub: "Browse by trade",
  },
  { href: "/", text: "Back to the homepage", sub: "Start over" },
] as const;

/** 18x18 navy magnifier. Mirrors the mockup's data-URI geometry exactly. */
function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-navy"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

/** Replaces the mockup's "→" character. Nudges right and turns gold on hover. */
function ArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px] shrink-0 text-gray-500 transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-gold"
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export default async function NotFound() {
  const asOf = await dataAsOf();

  return (
    /* The mockup puts min-height/flex on <body> so the footer sits at the
       bottom of short pages. Our root layout owns <body>, so the column lives
       here instead — this page is the only one that needs it today. */
    <div className="flex min-h-screen flex-col">
      <Header statsTimestamp={asOf} />

      <main className="flex flex-1 items-center px-8 py-20">
        <div className="mx-auto w-full max-w-[880px]">
          <div className="grid grid-cols-2 items-center gap-20 max-[880px]:grid-cols-1 max-[880px]:gap-10">
            {/* LEFT — the diagnosis */}
            <div>
              <p className="mb-6 inline-flex items-center gap-3 border border-gray-300 px-[14px] py-2 font-mono text-xs uppercase tracking-[0.16em] text-gray-500">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full bg-status-error"
                />
                Record Not Found
              </p>

              {/* Decorative numeral, not a heading — the <h1> is the sentence
                  below it. The gold zero is upright against italic digits. */}
              <p className="mb-4 font-serif text-[140px] font-semibold italic leading-none tracking-[-0.04em] text-navy max-[880px]:text-[100px]">
                4<span className="not-italic text-gold">0</span>4
              </p>

              <h1 className="mb-[18px] font-serif text-4xl font-semibold leading-[1.15] tracking-[-0.02em] text-ink max-[880px]:text-[28px]">
                This page <em className="italic text-navy">doesn&rsquo;t exist</em>{" "}
                &mdash; or it used to and doesn&rsquo;t anymore.
              </h1>

              <p className="text-base leading-[1.65] text-gray-700">
                The contractor record you&rsquo;re looking for may have been
                removed from the DBPR database, or the URL may be incorrect.
                Either way, the registry has {contractorCountLabel()} other
                licensed contractors &mdash; there&rsquo;s a good chance the one
                you&rsquo;re looking for is among them.
              </p>
            </div>

            {/* RIGHT — the recovery card */}
            <div className="border border-gray-200 bg-paper-raised px-8 py-9">
              {/* Mockup uses <h3>, which would skip a level under the <h1>. */}
              <h2 className="mb-[18px] inline-flex items-center gap-2.5 font-mono text-micro font-semibold uppercase tracking-eyebrow text-gold">
                <span aria-hidden="true" className="h-px w-[18px] bg-gold" />
                Try Searching Instead
              </h2>

              <form
                role="search"
                action="/search"
                method="get"
                className="relative mb-7"
              >
                <label htmlFor="not-found-search" className="sr-only">
                  Search the registry
                </label>
                <SearchIcon />
                <input
                  id="not-found-search"
                  type="text"
                  name="q"
                  placeholder="Contractor name, license #, or city..."
                  className="w-full border border-gray-300 bg-paper py-4 pl-12 pr-4 text-[15px] tracking-[-0.005em] text-ink transition-colors focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/10"
                />
              </form>

              {/* Hairline rules flanking the label — the mockup's ::before and
                  ::after, which cannot be expressed as utilities. */}
              <div className="my-6 flex items-center gap-4 font-mono text-micro uppercase tracking-eyebrow text-gray-500">
                <span aria-hidden="true" className="h-px flex-1 bg-gray-200" />
                Or browse
                <span aria-hidden="true" className="h-px flex-1 bg-gray-200" />
              </div>

              <nav aria-label="Recovery links" className="flex flex-col gap-0.5">
                {RECOVERY_LINKS.map(({ href, text, sub }) => (
                  <Link
                    key={href}
                    href={href}
                    className={`group flex items-center justify-between gap-4 border-b border-gray-200 py-3.5 transition-colors last:border-b-0 hover:text-navy ${FOCUS_RING_PAPER}`}
                  >
                    <span>
                      <span className="block font-serif text-base font-medium tracking-[-0.005em] text-ink">
                        {text}
                      </span>
                      <span className="mt-0.5 block font-mono text-xs tracking-[0.04em] text-gray-500">
                        {sub}
                      </span>
                    </span>
                    <ArrowIcon />
                  </Link>
                ))}
              </nav>

              <aside className="mt-10 border-l-[3px] border-l-gold bg-gold-pale p-6">
                <h2 className="mb-2.5 font-mono text-micro font-semibold uppercase tracking-label text-navy">
                  Why this happens
                </h2>
                <p className="text-note leading-[1.6] text-gray-700">
                  Contractor licenses can be voluntarily withdrawn, revoked, or
                  expire without renewal. When a license is removed from the
                  DBPR database, we remove the corresponding profile during our
                  weekly refresh.
                </p>
                <p className="mt-2 text-note leading-[1.6] text-gray-700">
                  If you believe this page should exist,{" "}
                  <Link
                    href="/about"
                    className={`font-semibold text-navy underline ${FOCUS_RING_PAPER}`}
                  >
                    let us know
                  </Link>
                  .
                </p>
              </aside>
            </div>
          </div>
        </div>
      </main>

      <Footer lastSyncDate={asOf} />
    </div>
  );
}
