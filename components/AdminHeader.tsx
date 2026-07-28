import Link from "next/link";

/**
 * AdminHeader — persistent header on every /admin/* page.
 * Source: _handoff/04_components/admin_header.html
 * Spec: Build Brief v1.3 §11 (Component reference)
 *
 * One flex row inside a navy-deep bar: logo group, nav, user chip. Far simpler
 * than the public Header — no top strip, no search, and NOT sticky (the mockup
 * sets no position; admin pages scroll under it).
 *
 * Deliberately distinct from the public header so admin context is
 * unmistakable: navy-deep surface instead of paper, a 2px gold hairline
 * instead of a 1px gray one, and a gold "Admin" chip beside the wordmark.
 *
 * Server component: nothing here needs client JS. The active route arrives as
 * a prop rather than via usePathname() — the mockup's sample code (docs line
 * 327) calls that hook inside an async function, which is not valid; passing
 * currentPath is the server-side equivalent and matches Header.
 *
 * Renders ONLY on authenticated admin routes. /admin/* is auth-gated at the
 * middleware level; a non-admin hitting an admin URL is redirected to login
 * before any of this renders (docs line 339).
 *
 * MOBILE: none. Admin pages are desktop-only by design for v1 (docs line 342)
 * — Jim is not reviewing claims from a phone. The mockup carries no media
 * queries and neither does this. A hamburger collapse below 1200px is a
 * future iteration, not an omission.
 */

export interface AdminHeaderProps {
  /** Current route, e.g. "/admin/claims" — drives the gold active underline. */
  currentPath?: string;

  /** Authenticated admin's display name, e.g. "Jim Blackburn". */
  userName: string;

  /**
   * Avatar initials, e.g. "JB". Uppercased at render.
   * Passed explicitly rather than derived from userName — derivation breaks on
   * single-word names, hyphenates, and suffixes. The session has this value.
   */
  userInitials: string;

  /** count(claims) WHERE status = 'pending'. Badge hidden when 0 or absent. */
  pendingClaims?: number;

  /** Unread lead count. Badge hidden when 0 or absent. */
  pendingLeads?: number;
}

type AdminNavLink = {
  href: string;
  label: string;
  /** Which count prop feeds this link's badge, if any. */
  badge?: "claims" | "leads";
};

/**
 * Five sections, this order. Verified identical across admin_header.html and
 * the four current 08_admin/ pages.
 *
 * admin_claim_review.html shows only four links (no /admin/sync) with href="#"
 * throughout — it is the oldest mockup of the set and is treated as stale.
 */
const NAV_LINKS: readonly AdminNavLink[] = [
  { href: "/admin/claims", label: "Claims", badge: "claims" },
  { href: "/admin/leads", label: "Leads", badge: "leads" },
  { href: "/admin/contractors", label: "Contractors" },
  { href: "/admin/sync", label: "DBPR Sync" },
  { href: "/admin/settings", label: "Settings" },
];

/**
 * Focus treatment for links on the navy-deep surface.
 * Identical to Footer's — same surface, so the same offset color.
 */
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-gold-light focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-navy-deep";

/**
 * Gold count pill on a nav link. Renders nothing at zero — the mockup docs are
 * explicit that an empty badge is hidden, not shown as "0" (docs line 315).
 *
 * The digits are aria-hidden and paired with an sr-only phrase, so the link
 * announces "Claims, 7 pending" rather than the ambiguous "Claims 7".
 */
function NavBadge({ count }: { count?: number }) {
  if (!count) return null;

  return (
    <>
      <span
        aria-hidden="true"
        className="ml-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-gold px-[5px] font-mono text-chip font-bold text-navy-deep"
      >
        {count}
      </span>
      <span className="sr-only">, {count} pending</span>
    </>
  );
}

/**
 * Logo mark + wordmark + Admin chip.
 *
 * The mark inverts the public Header's: a solid gold square with a navy-deep
 * glyph, and no inset rule.
 *
 * The mockup leaves these as inert <div>s. Wrapping the mark and wordmark in a
 * Link is a deliberate deviation — a dead logo in an app shell reads as a bug.
 * The Admin chip stays outside the link; it is a status label, not navigation.
 */
function Logo() {
  return (
    <div className="flex shrink-0 items-center gap-3">
      <Link
        href="/admin"
        aria-label="Florida Contractor Registry — admin home"
        className={`flex items-center gap-3 ${FOCUS_RING}`}
      >
        <span className="flex h-8 w-8 items-center justify-center bg-gold font-serif text-base font-bold italic text-navy-deep">
          F
        </span>
        <span className="font-serif text-[17px] font-semibold tracking-wordmark text-white">
          Florida Contractor Registry
        </span>
      </Link>

      <span className="ml-3.5 border border-gold px-2.5 py-1 font-mono text-chip font-semibold uppercase tracking-eyebrow text-gold-light">
        Admin
      </span>
    </div>
  );
}

export default function AdminHeader({
  currentPath,
  userName,
  userInitials,
  pendingClaims,
  pendingLeads,
}: AdminHeaderProps) {
  const badgeCounts = { claims: pendingClaims, leads: pendingLeads };

  return (
    <header className="border-b-2 border-gold bg-navy-deep py-3.5 text-white">
      <div className="mx-auto flex max-w-app items-center justify-between gap-10 px-8">
        <Logo />

        <nav
          aria-label="Admin"
          className="flex gap-7 text-ui font-medium text-white/65"
        >
          {NAV_LINKS.map(({ href, label, badge }) => {
            const isActive = currentPath === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={`pb-0.5 transition-colors hover:text-white ${FOCUS_RING} ${
                  isActive ? "border-b-2 border-gold text-white" : ""
                }`}
              >
                {label}
                <NavBadge count={badge ? badgeCounts[badge] : undefined} />
              </Link>
            );
          })}
        </nav>

        {/* Static for v1. The mockup docs mention a sign-out dropdown, but no
            mockup defines its trigger, contents, or open state — building it
            now would mean inventing design. When there is a mockup and a real
            auth flow, this becomes a "use client" <UserMenu>. */}
        <div className="flex shrink-0 items-center gap-2.5 text-ui text-white/75">
          <span
            aria-hidden="true"
            className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-gold text-xs font-bold text-navy-deep"
          >
            {userInitials.toUpperCase()}
          </span>
          <span>{userName}</span>
        </div>
      </div>
    </header>
  );
}
