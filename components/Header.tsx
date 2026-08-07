import Link from "next/link";
import { FOCUS_RING_PAPER } from "@/lib/focus";
import { CONTRACTOR_COUNT } from "@/lib/registry-stats";

/**
 * Header — public site header.
 * Source: _handoff/04_components/header.html
 * Spec: Build Brief v1.3 §11 (Component reference)
 *
 * Two stacked regions that always appear together:
 *   1. Top strip  — navy-deep authority bar. Scrolls away normally; it is a
 *                   one-time authority impression, not a utility.
 *   2. Site header — paper bar with logo, search, and nav. Sticky, so it stays
 *                    reachable while scrolling.
 *
 * Server component: nothing here needs client JS. Sticky is CSS, the mobile
 * nav is a media query, and search submits natively via a GET form.
 *
 * Used on all 28 public-facing pages. NOT used on admin or contractor portal
 * pages — those have their own navy headers.
 */

export interface HeaderProps {
  /** Current route, e.g. "/counties" — drives the active-nav underline. */
  currentPath?: string;
  /**
   * Renders as "Data as of {statsTimestamp}", e.g. "July 29, 2026".
   *
   * Every caller passes `await dataAsOf()` — the date OUR copy of the registry
   * was last refreshed, not the date DBPR published the extract. See
   * lib/data-as-of.ts before writing copy that turns on the difference.
   */
  statsTimestamp: string;
  /** Live count from the contractors table, cached daily. */
  contractorCount?: number;
  /** Prefills the search input on /search results pages. */
  searchQuery?: string;
}

/**
 * ⚠ THE ONLY TWO FORM ENTRY POINTS ON THE SITE ARE IN HERE, and that is the
 * whole point of the 2026-08-07 consolidation. "Request a Quote" is the
 * homeowner's door (the diagnostic); "Join the Registry" is the business's door
 * (/join, which routes to either the claim flow or a registry request). There
 * is deliberately no third — /contact is a routing page with published
 * addresses and no form.
 *
 * "For Contractors" -> /contractors was replaced here. That page said "Claiming
 * opens soon" and was deleted; the URL now 308s to /join. The label changed with
 * it, because "For Contractors" describes an audience and the link is now an
 * action.
 */
const NAV_LINKS = [
  { href: "/counties", label: "Counties" },
  { href: "/types", label: "License Types" },
  { href: "/join", label: "Join the Registry" },
  { href: "/diagnostic", label: "Request a Quote" },
] as const;

/** 6px gold separator between top-strip facts. Decorative. */
function Dot() {
  return (
    <span
      aria-hidden="true"
      className="mx-3 inline-block h-1.5 w-1.5 rounded-full bg-gold align-middle"
    />
  );
}

function TopStrip({
  statsTimestamp,
  contractorCount,
}: {
  statsTimestamp: string;
  contractorCount: number;
}) {
  return (
    <div className="bg-navy-deep text-gold-pale">
      <div className="mx-auto flex max-w-shell items-center justify-between px-8 py-2 text-xs font-medium uppercase tracking-[0.08em]">
        <p>
          Florida Public Records
          <Dot />
          {contractorCount.toLocaleString("en-US")} Licensed Contractors
          <Dot />
          Refreshed Weekly from DBPR
        </p>
        <p>Data as of {statsTimestamp}</p>
      </div>
    </div>
  );
}

/** Logo mark + wordmark in a single anchor, both linking home. */
function Logo() {
  return (
    <Link
      href="/"
      aria-label="Florida Contractor Registry — home"
      className={`flex shrink-0 items-center gap-[14px] ${FOCUS_RING_PAPER}`}
    >
      <span className="relative flex h-[42px] w-[42px] items-center justify-center bg-navy">
        {/* .logo-mark::after — gold rule inset 4px inside the navy square */}
        <span aria-hidden="true" className="absolute inset-1 border border-gold" />
        <span className="relative z-[1] font-serif text-xl font-bold italic text-gold">
          F
        </span>
      </span>
      <span className="flex flex-col leading-[1.15]">
        <span className="font-serif text-[19px] font-semibold tracking-wordmark text-navy">
          Florida Contractor Registry
        </span>
        <span className="mt-0.5 text-micro font-medium uppercase tracking-eyebrow text-gray-500">
          Public Records · Verified Licenses
        </span>
      </span>
    </Link>
  );
}

function SearchBar({ searchQuery }: { searchQuery?: string }) {
  return (
    <form
      role="search"
      action="/search"
      method="get"
      className="relative w-full max-w-[480px] flex-1"
    >
      <label htmlFor="header-search" className="sr-only">
        Search the registry
      </label>
      {/* .search-bar::before — same geometry as the mockup's data-URI icon */}
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        id="header-search"
        type="text"
        name="q"
        defaultValue={searchQuery}
        placeholder="Search by name, license, city, or county..."
        className="w-full border border-gray-300 bg-white py-[11px] pl-11 pr-4 text-sm tracking-[-0.005em] text-ink transition-colors focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/10"
      />
    </form>
  );
}

export default function Header({
  currentPath,
  statsTimestamp,
  contractorCount = CONTRACTOR_COUNT,
  searchQuery,
}: HeaderProps) {
  return (
    <>
      <TopStrip
        statsTimestamp={statsTimestamp}
        contractorCount={contractorCount}
      />

      <header className="sticky top-0 z-50 border-b border-gray-200 bg-paper py-[22px]">
        <div className="mx-auto flex max-w-shell items-center justify-between gap-10 px-8 max-[1000px]:gap-4">
          <Logo />
          <SearchBar searchQuery={searchQuery} />

          {/* Below 1000px the links drop out; search becomes the primary
              action. A hamburger menu is explicitly out of scope for v1. */}
          <nav
            aria-label="Primary"
            className="flex gap-7 text-ui font-medium text-gray-700 max-[1000px]:hidden"
          >
            {NAV_LINKS.map(({ href, label }) => {
              const isActive = currentPath === href;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={isActive ? "page" : undefined}
                  className={`pb-0.5 transition-colors hover:text-navy ${FOCUS_RING_PAPER} ${
                    isActive ? "border-b-2 border-gold text-navy" : ""
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
    </>
  );
}
