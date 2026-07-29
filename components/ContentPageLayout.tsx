import type { ReactNode } from "react";
import Link from "next/link";

import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { FOCUS_RING_PAPER } from "@/lib/focus";

/**
 * ContentPageLayout — the shared shell for all 12 long-form pages.
 * Source: _handoff/05_template/content_page_template.html
 * Spec: Build Brief v1.3 §11 · COMPONENTS, ContentPageLayout entry (read
 *       2026-07-29), which specifies verbatim:
 *
 *         Source: content_page_template.html · The shared shell for long-form
 *         pages. Three columns: sidebar nav (with section + legal groups) +
 *         main article (kicker + headline + lede + body) + right rail (related
 *         modules).
 *         Used on: about, sources, hiring_checklist, verify, permits,
 *         complaint, privacy, terms, sms_terms, cookies, dmca,
 *         featured_terms. That's 12 pages using one component.
 *         Props
 *           slug: string — for active-nav highlighting
 *           kicker: string — small uppercase tag
 *           h1Plain: string — first part of headline ("How to verify a")
 *           h1Em: string — italicized part ("license.")
 *           lede: string — large intro paragraph
 *           children: ReactNode — main body content
 *           readMinutes: number — estimated read time
 *           isLegal?: boolean — applies legal-specific styling (banner at top,
 *                               section numbers)
 *
 * Server component. Every link is a <Link>; nothing needs client JS.
 *
 * §11 INACCURACY #3 — isLegal IS UNBUILDABLE AS SPECIFIED. It describes a
 * boolean that applies "banner at top, section numbers". Neither can come from
 * a boolean:
 *
 *   The banner copy is attorney-drafted and DIFFERENT on all six legal pages.
 *   No flag can carry six texts.
 *
 *   Section numbers are authored per heading in the markup
 *   (<h2><span class="section-num">1</span>Who we are</h2>), not generated.
 *
 * In the mockups both are plain CSS classes styling page-authored markup.
 * Retained here as a reserved flag; the treatments ship instead as the
 * <LegalBanner> and <SectionHeading> exports below, which pages compose inside
 * children. See their docblocks for why neither takes a className.
 *
 * §11 INACCURACY #4 — "right rail (related modules)" reads as page-specific
 * content. It is not: the rail markup is byte-identical across about, privacy,
 * terms and verify (md5 of the <aside> matches on all four). It is hard-coded
 * here, with an optional rightRail override for future pages that genuinely
 * differ.
 *
 * (Inaccuracy #1 was ListDetailLayout's "40%/60%" split, really 380px or 420px
 * plus 1fr. #2 was StatusBanner's claimed admin_claim_review consumer, which
 * contains zero banners.)
 *
 * STYLING CALLER MARKUP. The template styles descendants of .content-body —
 * p, h2, h3, ul, ol, a — so that pages can write plain semantic HTML instead of
 * classing every paragraph across twelve long documents. With no stylesheet to
 * scope, that is expressed as Tailwind arbitrary variants ([&_p]:...) in
 * CONTENT_BODY below. Verbose, but it keeps typography owned by the layout and
 * introduces no hand-written CSS and no inline styles.
 *
 * SURFACES: paper throughout, with the rail modules on paper-raised per the
 * §03 pure-white resolution.
 */

/* -------------------------------------------------------------------------
 * Sidebar navigation. Identical on content and legal pages — verified
 * byte-for-byte between about.html and privacy.html, so isLegal does NOT
 * change it. The active item is driven by `slug` alone.
 *
 * featured_terms consumes this layout but is deliberately absent from the nav,
 * matching featured_terms.html itself. It is reached from the pricing flow.
 * ---------------------------------------------------------------------- */
const SITE_PAGES = [
  { href: "/about", label: "About" },
  { href: "/sources", label: "Data Sources" },
  { href: "/hiring-checklist", label: "Hiring Checklist" },
  { href: "/verify", label: "How to Verify a License" },
  { href: "/permits", label: "Permit Look-Up Guide" },
  { href: "/complaint", label: "File a Complaint" },
] as const;

const LEGAL_PAGES = [
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/sms-terms", label: "SMS Terms" },
  { href: "/cookies", label: "Cookie Notice" },
  { href: "/dmca", label: "DMCA" },
] as const;

/**
 * Typography for page-authored body markup, as arbitrary variants.
 *
 * Grouped and commented because it is long by necessity: every rule here
 * corresponds to a `.content-body <element>` rule in the template, and the
 * alternative is asking twelve prose pages to class every tag by hand.
 *
 * The list markers are the template's ::before pseudo-elements — a 14px gold
 * rule for bullets, and a CSS counter for ordered items. Both are reproduced
 * with `before:` variants rather than hand-written CSS.
 */
const CONTENT_BODY = [
  // Paragraphs
  "[&_p]:mb-[22px] [&_p]:text-[17px] [&_p]:leading-[1.7] [&_p]:tracking-[-0.005em] [&_p]:text-ink",
  "[&_p:last-child]:mb-0",
  "[&_strong]:font-semibold",
  "[&_em]:italic",
  // Inline links — navy with a gold underline that fills on hover
  `[&_a]:text-navy [&_a]:border-b [&_a]:border-gold [&_a]:pb-px [&_a:hover]:bg-gold-pale`,
  // Headings. Children start at h2; the layout owns h1.
  "[&_h2]:mt-14 [&_h2]:mb-5 [&_h2]:font-serif [&_h2]:text-[32px] [&_h2]:font-semibold [&_h2]:leading-[1.2] [&_h2]:tracking-[-0.02em] [&_h2]:text-navy",
  "[&_h2:first-child]:mt-0",
  "[&_h3]:mt-9 [&_h3]:mb-3.5 [&_h3]:font-serif [&_h3]:text-[22px] [&_h3]:font-semibold [&_h3]:leading-[1.3] [&_h3]:tracking-[-0.015em] [&_h3]:text-navy",
  // Lists
  "[&_ul]:mb-[22px] [&_ol]:mb-[22px]",
  "[&_ul>li]:relative [&_ul>li]:py-1 [&_ul>li]:pl-7 [&_ul>li]:text-[17px] [&_ul>li]:leading-[1.65] [&_ul>li]:text-ink",
  "[&_ul>li]:before:absolute [&_ul>li]:before:left-0 [&_ul>li]:before:top-[14px] [&_ul>li]:before:h-px [&_ul>li]:before:w-3.5 [&_ul>li]:before:bg-gold [&_ul>li]:before:content-['']",
  "[&_ol]:[counter-reset:numlist]",
  "[&_ol>li]:relative [&_ol>li]:py-2 [&_ol>li]:pl-11 [&_ol>li]:text-[17px] [&_ol>li]:leading-[1.65] [&_ol>li]:text-ink [&_ol>li]:[counter-increment:numlist]",
  "[&_ol>li]:before:absolute [&_ol>li]:before:left-0 [&_ol>li]:before:top-2 [&_ol>li]:before:w-8 [&_ol>li]:before:font-serif [&_ol>li]:before:text-[17px] [&_ol>li]:before:font-semibold [&_ol>li]:before:italic [&_ol>li]:before:text-gold [&_ol>li]:before:[content:counter(numlist)_'.']",
].join(" ");

export interface ContentPageLayoutProps {
  /** §11: slug — for active-nav highlighting, e.g. "/privacy". */
  slug: string;

  /** §11: kicker — small uppercase tag, e.g. "A Note From the Publisher". */
  kicker: string;

  /** §11: h1Plain — first part of headline ("About the"). */
  h1Plain: string;

  /**
   * §11: h1Em — italicized part ("registry."). Carries the closing full stop:
   * the editorial pattern italicises the final phrase including its period.
   */
  h1Em: string;

  /** §11: lede — large intro paragraph, serif, rule beneath. */
  lede: string;

  /** §11: children — main body content. Starts at <h2>; the layout owns <h1>. */
  children: ReactNode;

  /** §11: readMinutes — renders as "~ N min read". Caller-supplied; computing
   *  it would mean walking a ReactNode tree and would misread lists. */
  readMinutes: number;

  /**
   * §11: isLegal — RESERVED, and narrower than §11 describes. See inaccuracy
   * #3 in the file docblock: the banner and section numbers ship as
   * <LegalBanner> and <SectionHeading> because a boolean cannot carry six
   * attorney-drafted texts or per-page authored numbering. Kept so the §11
   * signature is honoured and so a future legal-only treatment has a home.
   */
  isLegal?: boolean;

  /**
   * ADDITION beyond §11 — the left half of the meta footer, which §11 has no
   * prop for. Content pages read "Page last updated · May 24, 2026"; legal
   * pages read "Effective · May 24, 2026". Both the label and the date vary.
   */
  metaLabel: string;

  /**
   * ADDITION beyond §11 — optional override for the right rail. The rail is
   * identical on every consumer today (inaccuracy #4), so it is hard-coded;
   * this exists for a future page that genuinely differs.
   */
  rightRail?: ReactNode;
}

/**
 * The legal notice banner that opens all six legal pages.
 *
 * NO className PROP, DELIBERATELY, AND DO NOT ADD ONE. Every legal page passes
 * content only — the label and the body text. All styling lives in here, so
 * six attorney-reviewed pages are guaranteed to render the same treatment and
 * a page physically cannot diverge. Consistency is enforced by the type
 * system rather than by review discipline. A className passthrough would undo
 * exactly that guarantee.
 *
 * Geometry verified byte-identical across cookies, dmca, featured_terms,
 * privacy, sms_terms and terms.
 */
export function LegalBanner({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-8 border-l-4 border-l-gold bg-navy px-6 py-[18px] text-sm leading-[1.6] text-white [&_a]:border-b [&_a]:border-gold [&_a]:text-gold-light">
      <strong className="mb-1 block font-mono text-micro font-bold uppercase tracking-label text-gold-light">
        {label}
      </strong>
      {children}
    </div>
  );
}

/**
 * A numbered <h2> for legal pages: gold mono numeral, then the heading text.
 *
 * NO className PROP, DELIBERATELY, AND DO NOT ADD ONE — same reasoning as
 * <LegalBanner>. The page supplies the number and the words; nothing else.
 *
 * Renders a real <h2> so it inherits the body typography and sits correctly in
 * the outline alongside unnumbered headings.
 *
 * The numeral is separated from the heading text by margin, not whitespace, so
 * the two run together in the accessibility tree — a screen reader announces
 * "1Who we are". The visible numeral is therefore aria-hidden and paired with
 * an sr-only phrase, which also reads better for legal citation: "Section 1.
 * Who we are".
 */
export function SectionHeading({
  num,
  children,
}: {
  num: number;
  children: ReactNode;
}) {
  return (
    <h2>
      <span className="sr-only">Section {num}. </span>
      <span
        aria-hidden="true"
        className="mr-3.5 align-[4px] font-mono text-sm font-semibold tracking-[0.04em] text-gold"
      >
        {num}
      </span>
      {children}
    </h2>
  );
}

/** Replaces the rail button's "→" character. */
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
      className="ml-1 inline-block h-3.5 w-3.5 align-[-1px]"
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

/** Gold hairline preceding an eyebrow. Decorative. */
function Hairline({ width }: { width: "w-6" | "w-3.5" }) {
  return <span aria-hidden="true" className={`h-px ${width} bg-gold`} />;
}

function NavGroup({
  items,
  slug,
}: {
  items: readonly { href: string; label: string }[];
  slug: string;
}) {
  return (
    <ul>
      {items.map(({ href, label }) => {
        const isActive = slug === href;
        return (
          <li
            key={href}
            className={`border-l py-[7px] pl-3.5 ${
              isActive ? "border-l-gold" : "border-l-gray-200"
            }`}
          >
            <Link
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={`block leading-[1.5] transition-colors hover:text-navy ${FOCUS_RING_PAPER} ${
                isActive ? "font-semibold text-navy" : "text-gray-500"
              }`}
            >
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The rail. Hard-coded because it is identical on every consumer.
 *
 * Module titles are <h3> under a visually hidden <h2>, so the rail forms its
 * own subtree in the heading outline rather than emitting siblings of the
 * article's section headings. The mockup uses <h4> directly, which skips a
 * level; this is the accessibility upgrade.
 */
function RightRail() {
  return (
    <>
      <h2 className="sr-only" id="related-heading">
        Related resources
      </h2>

      <div className="mb-5 border border-gray-200 bg-paper-raised px-[22px] py-6">
        <p className="mb-2.5 inline-flex items-center gap-2 font-mono text-chip font-semibold uppercase tracking-eyebrow text-gold">
          <Hairline width="w-3.5" />
          Search
        </p>
        <h3 className="mb-3 font-serif text-lg font-semibold leading-[1.25] tracking-[-0.01em] text-navy">
          Find a <em className="italic">contractor</em>
        </h3>
        <p className="mb-4 text-[13.5px] leading-[1.55] text-gray-700">
          Search 266,312 active Florida contractor licenses by name, license
          number, city, or county.
        </p>
        <Link
          href="/"
          className={`inline-block border-b border-gold pb-0.5 text-xs font-semibold uppercase tracking-[0.06em] text-navy transition-colors hover:text-gold ${FOCUS_RING_PAPER}`}
        >
          Start a search
          <ArrowIcon />
        </Link>
      </div>

      <div className="mb-5 border border-gray-200 bg-paper-raised px-[22px] py-6">
        <p className="mb-2.5 inline-flex items-center gap-2 font-mono text-chip font-semibold uppercase tracking-eyebrow text-gold">
          <Hairline width="w-3.5" />
          Helpful Pages
        </p>
        <h3 className="mb-3 font-serif text-lg font-semibold leading-[1.25] tracking-[-0.01em] text-navy">
          Other resources
        </h3>
        <ul className="mt-3">
          {[
            { href: "/hiring-checklist", label: "Hiring Checklist" },
            { href: "/verify", label: "How to Verify a License" },
            { href: "/sources", label: "Where the Data Comes From" },
          ].map(({ href, label }) => (
            <li
              key={href}
              className="border-b border-gray-100 py-1.5 text-ui text-gray-700 last:border-b-0"
            >
              <Link
                href={href}
                className={`transition-colors hover:text-navy ${FOCUS_RING_PAPER}`}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/**
 * PLACEHOLDER DATA. Header and Footer both require the DBPR refresh date and
 * there is no data layer yet. Wire to the real ingestion_runs timestamp in
 * Week 2, same as app/not-found.tsx.
 */
const LAST_SYNC_DATE = "May 24, 2026";

export default function ContentPageLayout({
  slug,
  kicker,
  h1Plain,
  h1Em,
  lede,
  children,
  readMinutes,
  metaLabel,
  rightRail,
}: ContentPageLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header currentPath={slug} statsTimestamp={LAST_SYNC_DATE} />

      <div className="mx-auto grid w-full max-w-shell grid-cols-[220px_1fr_220px] gap-[60px] px-8 pb-24 pt-12 max-[1200px]:grid-cols-1 max-[1200px]:gap-8">
        {/* LEFT — page navigation. The "Site Pages" tag stays a <p>: as an
            <h2> it would land before the article's <h1> in the outline. */}
        <nav
          aria-label="Site pages"
          className="sticky top-[110px] self-start text-ui max-[1200px]:static"
        >
          <p className="mb-[18px] inline-block border-b border-gold pb-3.5 font-mono text-[10.5px] font-semibold uppercase tracking-eyebrow text-gold">
            Site Pages
          </p>
          <NavGroup items={SITE_PAGES} slug={slug} />
          <p className="mb-2 ml-3.5 mt-6 font-mono text-chip font-semibold uppercase tracking-eyebrow text-gray-400">
            Legal
          </p>
          <NavGroup items={LEGAL_PAGES} slug={slug} />
        </nav>

        {/* CENTRE — the article */}
        <article className="mx-auto w-full min-w-0 max-w-[680px]">
          <p className="mb-4 inline-flex items-center gap-2.5 font-mono text-micro font-semibold uppercase tracking-eyebrow text-gold">
            <Hairline width="w-6" />
            {kicker}
          </p>

          {/* Fraunces italic on the closing phrase — font-weight is unchanged
              at 600 across both halves; only font-style differs. */}
          <h1 className="mb-6 font-serif text-[56px] font-semibold leading-[1.05] tracking-[-0.025em] text-navy max-[1200px]:text-[42px]">
            {h1Plain} <em className="italic">{h1Em}</em>
          </h1>

          <p className="mb-10 border-b border-gray-200 pb-8 font-serif text-[22px] font-normal leading-[1.45] tracking-[-0.01em] text-gray-700 max-[1200px]:text-[18px]">
            {lede}
          </p>

          <div className={CONTENT_BODY}>{children}</div>

          <div className="mt-[72px] flex items-baseline justify-between border-t border-gray-200 pt-7 font-mono text-micro uppercase tracking-[0.06em] text-gray-500">
            <span>{metaLabel}</span>
            <span>~ {readMinutes} min read</span>
          </div>
        </article>

        {/* RIGHT — related modules */}
        <aside
          aria-labelledby={rightRail ? undefined : "related-heading"}
          aria-label={rightRail ? "Related" : undefined}
          className="sticky top-[110px] self-start max-[1200px]:static"
        >
          {rightRail ?? <RightRail />}
        </aside>
      </div>

      <Footer lastSyncDate={LAST_SYNC_DATE} />
    </div>
  );
}
