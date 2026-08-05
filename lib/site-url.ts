/**
 * The canonical origin, and the single decision about whether we are indexable.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE ENV VAR FLIPS THE WHOLE SITE AT DNS CUTOVER.
 *
 * Today NEXT_PUBLIC_SITE_URL is the Vercel host, so robots.txt disallows
 * everything and the sitemap is unreferenced. On cutover it becomes
 * https://floridacontractorregistry.com and — with no other change — robots
 * opens up, the sitemap emits apex URLs, canonical tags point at the apex, and
 * Open Graph images resolve against it.
 *
 * That is the whole design goal: there is no second switch to forget.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ WHY "INDEXABLE" IS NOT SIMPLY "NEXT_PUBLIC_SITE_URL IS SET".
 *
 * It is set today, to the preview host. If the rule were "configured means
 * live", the preview deployment would invite Google to index
 * fcr-app.vercel.app — and a duplicate of 266,305 profiles on a second hostname
 * is the single worst SEO mistake available to this project. Google would split
 * ranking signal across two hosts and may keep serving the vercel.app copy long
 * after cutover.
 *
 * So indexability is derived from the canonical host MATCHING THE KNOWN
 * PRODUCTION APEX, which is a constant here rather than configuration. Setting
 * the env var to the apex is the one deliberate act that turns indexing on.
 */

/**
 * The production apex. A CONSTANT, not an env var, and that is the point: it is
 * the thing NEXT_PUBLIC_SITE_URL is compared against, so it cannot itself be
 * the thing that is misconfigured.
 *
 * Bare host, no scheme, no www. The site is served from the apex; a www
 * variant would need a redirect at the DNS/Vercel layer, not a second entry.
 */
export const PRODUCTION_HOST = "floridacontractorregistry.com";

/**
 * Fallback when NEXT_PUBLIC_SITE_URL is unset — a local dev server, or a
 * misconfigured deploy.
 *
 * NEVER THE PRODUCTION APEX. A missing variable must not be indistinguishable
 * from a correct production deploy: defaulting to the apex would make a broken
 * environment claim to be the live site, emit apex URLs in its sitemap, and
 * pass the indexability check. Failing towards localhost fails safe.
 */
const FALLBACK_ORIGIN = "http://localhost:3000";

/**
 * The canonical origin, normalised: scheme + host, never a trailing slash.
 *
 * Accepts the variable with or without a scheme, because "set it to
 * floridacontractorregistry.com" is what a person types and demanding
 * "https://" is a footgun that surfaces as a malformed sitemap rather than an
 * error. A bare value is assumed https — there is no http production here.
 */
export function siteOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return FALLBACK_ORIGIN;

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    return `${url.protocol}//${url.host}`;
  } catch {
    // A malformed value is a deploy error, not something to paper over with the
    // apex. localhost keeps it obviously broken instead of quietly wrong.
    console.error(`[site-url] NEXT_PUBLIC_SITE_URL is not a valid URL: ${raw}`);
    return FALLBACK_ORIGIN;
  }
}

/** The canonical host with no scheme, e.g. "floridacontractorregistry.com". */
export function siteHost(): string {
  try {
    return new URL(siteOrigin()).host;
  } catch {
    return "";
  }
}

/**
 * Absolute URL for a site-relative path. Used by the sitemap, which must emit
 * absolute URLs on the canonical host or Google discards the entries.
 */
export function absoluteUrl(path: string): string {
  return `${siteOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Is this deployment the live public site?
 *
 * `requestHost` is the Host header when the caller can supply it. Passing it is
 * belt-and-braces: a preview deployment inherits production environment
 * variables on Vercel, so a preview could otherwise be serving the apex config
 * from a *-git-*.vercel.app hostname and declare itself indexable. Requiring
 * both to be the apex closes that.
 *
 * Called without a host it degrades to the config check alone, which is still
 * correct for anything not serving an HTTP request.
 */
export function isIndexable(requestHost?: string | null): boolean {
  if (siteHost() !== PRODUCTION_HOST) return false;
  if (!requestHost) return true;
  // Strip any :port before comparing — a proxy may append one.
  return requestHost.trim().toLowerCase().split(":")[0] === PRODUCTION_HOST;
}
