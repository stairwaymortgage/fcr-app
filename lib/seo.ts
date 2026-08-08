import type { Metadata } from "next";

/**
 * Page metadata for public routes — ONE implementation, used everywhere.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS: A PAGE THAT SETS title AND description STILL SHIPS THE
 * SITE-WIDE SOCIAL CARD.
 *
 * Next merges metadata one key at a time. app/layout.tsx defines `openGraph`
 * and `twitter` blocks with their own title and description; a page that sets
 * only the top-level `title`/`description` does NOT backfill them. It inherits
 * the layout's blocks verbatim.
 *
 * Confirmed on the live site 2026-08-08, before this file existed. Every
 * county, city, licence-type and content page emitted:
 *
 *   og:title       Florida Contractor Registry
 *   og:description A searchable registry of Florida contractor records, …
 *   og:url         https://floridacontractorregistry.com
 *
 * The og:url is the part that is not merely generic but wrong: ~1,100 pages
 * each told a scraper they WERE the homepage. Nothing renders differently and
 * no build warns, which is why it survived — the same shape of bug as a dead
 * Tailwind class, and the reason scripts/verify-design-tokens.mjs exists.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ `twitter` IS WRITTEN OUT EXPLICITLY RATHER THAN LEANING ON THE FALLBACK.
 * Next will derive twitter:title from openGraph when `twitter` is absent — but
 * it is NOT absent here: the layout defines one, so an un-overridden page
 * inherits the layout's twitter title and never reaches the fallback. Setting
 * both is the version whose behaviour does not depend on how deeply Next merges
 * an inherited sibling key, and it is verifiable by reading the emitted HTML.
 *
 * ⚠ `path` IS SITE-RELATIVE AND MUST STAY THAT WAY. metadataBase in
 * app/layout.tsx resolves it against the canonical origin, so this file has no
 * opinion about the host and cannot disagree with lib/site-url.ts about it.
 *
 * TITLES ARE PASSED IN FULL, SUFFIX AND ALL. There is no title.template — see
 * the note in app/layout.tsx for why adding one would double the suffix on
 * thirty-plus existing pages.
 */
export function publicPageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  /** Site-relative, leading slash, no query string: "/about". */
  path: string;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, url: path },
    twitter: { title, description },
  };
}
