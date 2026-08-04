import Link from "next/link";
import { FOCUS_RING_NAVY } from "@/lib/focus";

/**
 * ContractorHeader — persistent header on every authenticated contractor page.
 * Source: _handoff/04_components/contractor_header.html
 * Spec: Build Brief v1.3 §11 (Component reference)
 *
 * One flex row inside a navy-deep bar: logo group, nav, user chip. Shown on
 * /manage/* and /inquiries after a contractor claims their profile.
 *
 * The portal serves a third audience — neither the public homeowner (paper
 * header) nor Jim (admin header). Contractors get the same navy treatment as
 * admin to signal "logged-in area," but the chip reads "Contractor Portal" and
 * the nav is different.
 *
 * DELIBERATE DUPLICATION: this shares ~90% of its markup with AdminHeader, and
 * the source mockup (docs line 348) suggests extracting a shared PortalHeader
 * with a variant prop. We are holding off until a third portal header exists,
 * per the Rule of Three. Do not extract early — revisit then.
 *
 * Server component: nothing here needs client JS. The active route arrives as
 * a prop rather than via usePathname() — the mockup's sample code (docs line
 * 319) calls that hook inside an async function, which is not valid; passing
 * currentPath is the server-side equivalent and matches Header/AdminHeader.
 *
 * Renders ONLY on authenticated contractor routes. Sessions come from an email
 * magic link (no password). Middleware on /manage/* and /inquiries redirects
 * unauthenticated users to /login. Additionally, /manage/[slug] MUST verify
 * that the authenticated contractor owns the requested slug — otherwise
 * contractors could edit each other's profiles by typing URLs (docs line 335).
 *
 * MOBILE: none for v1. The mockup carries no media queries. Unlike admin
 * (desktop-only by design), the contractor portal may need real mobile support
 * later — contractors checking inquiries by phone is plausible — but that is a
 * v1.1 decision driven by usage data (docs line 338).
 */

export interface ContractorHeaderProps {
  /** Current route, e.g. "/inquiries" — drives the gold active underline. */
  currentPath?: string;

  /**
   * The authenticated contractor's profile slug, e.g.
   * "aceca-construction-cgc1520921-davie". Drives the Profile, Photos, and
   * Settings hrefs. Required — a portal session always has one.
   */
  contractorSlug: string;

  /** Contractor's display name, e.g. "Cristian Acero". */
  userName: string;

  /**
   * Avatar initials, e.g. "CA". Uppercased at render.
   * Passed explicitly rather than derived from userName — derivation breaks on
   * single-word names, hyphenates, and suffixes. The session has this value.
   */
  userInitials: string;

  /**
   * count(inquiries) WHERE contractor_dbpr_sync_key IN (the viewer's claimed
   * profiles) AND status = 'unread'. Badge hidden when 0 or absent.
   *
   * THERE IS NO read_at COLUMN — an earlier draft of this comment said there
   * was. inquiries.status is one text column carrying the whole flow
   * ('unread' | 'read' | 'replied' | 'archived'); only replied_at exists
   * alongside it. See lib/inquiries.ts for what that costs.
   */
  unreadInquiries?: number;
}

type ContractorNavLink = {
  href: string;
  label: string;
  /** Set on the one link that carries a count badge. */
  badge?: "inquiries";
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THERE WAS A `built: boolean` HERE, AND ITS JOB IS DONE.
 *
 * It existed so the nav could carry a link to a route that did not exist yet
 * without sending a freshly-verified contractor into a 404 — the worst possible
 * first impression of a portal they were told to trust. Hiding beat disabling:
 * a greyed-out link still says "this is here and you cannot have it".
 *
 * Every route it guarded has now landed or been abandoned. Profile in 145,
 * Inquiries in 147, Settings in 148 — and PHOTOS WAS DELETED RATHER THAN BUILT.
 * Task 146 shipped logo upload as a section inside /manage/[slug], which is
 * where manage_profile.html:756 puts it and where claim_approved.html:446 links
 * (?focus=photo). /manage/[slug]/photos was an inferred href from Build Brief
 * §04 line 344's "Used by → Future" list; no mockup for it exists, and the held
 * portfolio gallery would get its own design rather than inherit that route.
 * A nav entry pointing at a page nobody ever planned is worse than no entry.
 *
 * So the flag went with it: every remaining link is real, and a `built` that is
 * always true plus a `.filter()` that never filters is machinery pretending to
 * do something. RE-ADD IT — this docblock is the spec — the next time a nav
 * link has to ship ahead of its route.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * THREE SECTIONS, THIS ORDER. The mockups show four — contractor_header.html,
 * manage_profile.html, contractor_inquiries.html and claim_approved.html all
 * render Profile / Inquiries / Photos / Settings identically. Photos is
 * deliberately absent; see the block above for why it was deleted rather than
 * built.
 *
 * Profile is slug-scoped; Inquiries is deliberately NOT — it is a flat
 * /inquiries route, matching the access-control note (docs line 335) that names
 * "/manage/* and /inquiries" as two separate middleware targets, and matching
 * the page itself, which is one inbox across every profile the viewer owns.
 *
 * INFERRED HREF: every mockup renders Settings as href="#" — the route was
 * never resolved in the design pass. Build Brief §04 line 344 lists it under
 * "Used by → Future" as /manage/[slug]/settings, which is the basis for the
 * path below and is now the route that exists.
 */
function contractorNavLinks(slug: string): readonly ContractorNavLink[] {
  return [
    { href: `/manage/${slug}`, label: "Profile" },
    { href: "/inquiries", label: "Inquiries", badge: "inquiries" },
    { href: `/manage/${slug}/settings`, label: "Settings" },
  ];
}

/**
 * Gold count pill on a nav link. Renders nothing at zero — the mockup docs are
 * explicit that an empty badge is hidden, not shown as "0" (docs line 308).
 *
 * The digits are aria-hidden and paired with an sr-only phrase, so the link
 * announces "Inquiries, 3 unread" rather than the ambiguous "Inquiries 3".
 *
 * srLabel is a required prop rather than a hardcoded word: AdminHeader's
 * equivalent badge counts *pending* claims, and shipping "pending" to
 * contractors would misdescribe an unread-message count.
 */
function NavBadge({ count, srLabel }: { count?: number; srLabel: string }) {
  if (!count) return null;

  return (
    <>
      <span
        aria-hidden="true"
        className="ml-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-gold px-[5px] font-mono text-chip font-bold text-navy-deep"
      >
        {count}
      </span>
      <span className="sr-only">
        , {count} {srLabel}
      </span>
    </>
  );
}

/**
 * Logo mark + wordmark + Contractor Portal chip.
 *
 * The mockup leaves these as inert <div>s. Wrapping the mark and wordmark in a
 * Link is a deliberate deviation, matching AdminHeader — a dead logo in an app
 * shell reads as a bug. It points at the contractor's own profile, the portal's
 * natural home. The chip stays outside the link; it is a status label, not
 * navigation.
 */
function Logo({ contractorSlug }: { contractorSlug: string }) {
  return (
    <div className="flex shrink-0 items-center gap-3">
      <Link
        href={`/manage/${contractorSlug}`}
        aria-label="Florida Contractor Registry — contractor portal home"
        className={`flex items-center gap-3 ${FOCUS_RING_NAVY}`}
      >
        <span className="flex h-8 w-8 items-center justify-center bg-gold font-serif text-base font-bold italic text-navy-deep">
          F
        </span>
        <span className="font-serif text-[17px] font-semibold tracking-wordmark text-white">
          Florida Contractor Registry
        </span>
      </Link>

      <span className="ml-3.5 border border-gold px-2.5 py-1 font-mono text-chip font-semibold uppercase tracking-eyebrow text-gold-light">
        Contractor Portal
      </span>
    </div>
  );
}

export default function ContractorHeader({
  currentPath,
  contractorSlug,
  userName,
  userInitials,
  unreadInquiries,
}: ContractorHeaderProps) {
  const navLinks = contractorNavLinks(contractorSlug);

  return (
    <header className="border-b-2 border-gold bg-navy-deep py-3.5 text-white">
      <div className="mx-auto flex max-w-app items-center justify-between gap-10 px-8">
        <Logo contractorSlug={contractorSlug} />

        <nav
          aria-label="Contractor portal"
          className="flex gap-7 text-ui font-medium text-white/65"
        >
          {navLinks.map(({ href, label, badge }) => {
            const isActive = currentPath === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={`pb-0.5 transition-colors hover:text-white ${FOCUS_RING_NAVY} ${
                  isActive ? "border-b-2 border-gold text-white" : ""
                }`}
              >
                {label}
                {badge === "inquiries" && (
                  <NavBadge count={unreadInquiries} srLabel="unread" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Static for v1. The mockup docs mention a dropdown for sign-out,
            account, and billing, but no mockup defines its trigger, contents,
            or open state — building it now would mean inventing design. When
            there is a mockup and a real auth flow, this becomes a "use client"
            <UserMenu>. */}
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
