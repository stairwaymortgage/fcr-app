import Link from "next/link";

/**
 * Footer — site-wide footer.
 * Source: _handoff/04_components/footer.html
 * Spec: Build Brief v1.3 §11 (Component reference)
 *
 * Three stacked sections inside one navy-deep block:
 *   1. Disclaimer — FDUTPA non-affiliation language. Required on every page.
 *   2. Link grid  — 4 columns, reflowing to 2 below 1000px.
 *   3. Bottom bar — copyright + registered address, and the DBPR refresh date.
 *
 * Server component: no interactivity anywhere. Link hover is a CSS transition.
 *
 * Used on every public-facing page. NOT used on admin or contractor portal
 * pages.
 *
 * ENTITY NAMES ARE ATTORNEY-MANDATED. The source mockup carries stale text
 * from an earlier design pass ("Florida Contractor Registry LLC"). The
 * operating entity is Olga's Friends LLC; "Florida Contractor Registry" is a
 * DBA to be filed under Fla. Stat. § 865.09 and takes no LLC suffix.
 *
 * Per docs line 332: NMLS and AfBA disclosures must NOT appear here. The
 * concierge model keeps the site non-licensed, and those disclosures are
 * delivered verbally at hand-off. If asked to add them, push back and cite
 * Build Brief §2.8.
 */

export interface FooterProps {
  /**
   * Latest DBPR sync date, e.g. "May 24, 2026".
   * Same value as Header's statsTimestamp.
   */
  lastSyncDate: string;

  /**
   * Defaults to the current year.
   * Worth passing explicitly on static pages: `new Date()` evaluates at build
   * time, so a page built in December still reads the old year in January
   * until it is redeployed.
   */
  copyrightYear?: number;
}

const FOOTER_COLUMNS = [
  {
    heading: "Browse",
    links: [
      { href: "/counties", label: "All Counties" },
      { href: "/types", label: "License Types" },
      { href: "/cities", label: "Top Cities" },
      { href: "/updated", label: "Recently Updated" },
    ],
  },
  {
    heading: "For Homeowners",
    links: [
      { href: "/hiring-checklist", label: "Hiring Checklist" },
      { href: "/verify", label: "How to Verify a License" },
      { href: "/permits", label: "Permit Look-Up Guide" },
      { href: "/complaint", label: "File a Complaint" },
    ],
  },
  {
    heading: "For Contractors",
    links: [
      { href: "/contractors", label: "Claim Your Profile" },
      { href: "/contractors/edit", label: "Update Information" },
      { href: "/contractors/website", label: "Get a Website" },
      { href: "/contractors/resources", label: "Contractor Resources" },
    ],
  },
  {
    heading: "About",
    links: [
      { href: "/about", label: "Methodology" },
      { href: "/sources", label: "Data Sources" },
      { href: "/privacy", label: "Privacy Policy" },
      { href: "/terms", label: "Terms of Service" },
    ],
  },
] as const;

/** Focus treatment for links on the navy-deep surface. */
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-gold-light focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-navy-deep";

function FooterColumn({
  heading,
  links,
}: {
  heading: string;
  links: readonly { href: string; label: string }[];
}) {
  return (
    <div>
      {/* Mockup uses <h5>; rendered as <h2> so the document outline does not
          skip levels. Styling is byte-identical. */}
      <h2 className="mb-[14px] font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-gold-light">
        {heading}
      </h2>
      <ul>
        {links.map(({ href, label }) => (
          <li key={href} className="py-1 text-[13px]">
            <Link
              href={href}
              className={`text-white/65 transition-colors hover:text-gold-light ${FOCUS_RING}`}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Footer({
  lastSyncDate,
  copyrightYear = new Date().getFullYear(),
}: FooterProps) {
  return (
    <footer className="bg-navy-deep pb-7 pt-14 text-white/65">
      <div className="mx-auto max-w-shell px-8">
        <p className="mb-8 max-w-[820px] text-[12.5px] leading-[1.65] tracking-[-0.005em] text-white/55">
          <strong className="font-semibold text-white/85">
            FloridaContractorRegistry.com
          </strong>{" "}
          is a private commercial directory operated by Olga&rsquo;s Friends
          LLC. We are{" "}
          <strong className="font-semibold text-white/85">
            not affiliated with, endorsed by, or operated by
          </strong>{" "}
          the State of Florida, the Florida Department of Business and
          Professional Regulation (DBPR), the Construction Industry Licensing
          Board, or any government agency. License information shown is
          republished from public DBPR records under Chapter 119, Florida
          Statutes, and may not reflect the most current status. For official
          license verification, visit{" "}
          <a
            href="https://www.myfloridalicense.com"
            target="_blank"
            rel="noopener noreferrer"
            className={`text-gold-light underline ${FOCUS_RING}`}
          >
            myfloridalicense.com
          </a>
          .
        </p>

        <nav
          aria-label="Footer"
          className="grid grid-cols-4 gap-10 border-y border-white/10 py-8 max-[1000px]:grid-cols-2 max-[1000px]:gap-8"
        >
          {FOOTER_COLUMNS.map(({ heading, links }) => (
            <FooterColumn key={heading} heading={heading} links={links} />
          ))}
        </nav>

        <div className="flex items-center justify-between pt-7 text-[11.5px] tracking-[0.02em] text-white/40 max-[1000px]:flex-col max-[1000px]:items-start max-[1000px]:gap-2.5">
          <div>
            <p>
              &copy; {copyrightYear} Olga&rsquo;s Friends LLC. All rights
              reserved.
            </p>
            <p>1520 E Sunrise Blvd, Fort Lauderdale, FL 33304</p>
          </div>
          <p>Data sourced from DBPR &middot; Last refresh: {lastSyncDate}</p>
        </div>
      </div>
    </footer>
  );
}
