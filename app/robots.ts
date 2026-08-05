import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { absoluteUrl, isIndexable, PRODUCTION_HOST, siteHost } from "@/lib/site-url";

/**
 * robots.txt — the switch that decides whether this deployment is crawlable.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IT DISALLOWS EVERYTHING TODAY, ON PURPOSE, AND THAT IS NOT A PLACEHOLDER.
 *
 * The site currently answers on fcr-app.vercel.app. Letting Google index
 * 266,305 contractor profiles on a hostname we are about to abandon would split
 * ranking signal across two hosts and can leave the vercel.app copy serving in
 * results long after DNS cutover. It is the most expensive reversible mistake
 * available to this project, so the default is closed.
 *
 * ⚠ THERE IS A SECOND REASON, AND IT OUTRANKS THE SEO ONE.
 * app/contractor/[slug]/actions.ts carries an open LAUNCH BLOCKER: the inquiry
 * endpoint is unauthenticated, writes with the service role, and has no rate
 * limiting — and every junk row it accepts is delivered to a contractor as a
 * lead. Two other public POSTs (the diagnostic, the login OTP) are in the same
 * position. Inviting crawlers and the traffic that follows them, before that
 * closes, is opening the door to the room we know is unlocked.
 *
 * SO: DO NOT SET NEXT_PUBLIC_SITE_URL TO THE APEX UNTIL BOTH ARE TRUE —
 * DNS points at this deployment, AND rate limiting has shipped.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The flip is one environment variable. isIndexable() is true only when the
 * canonical host equals the production apex AND the request arrives on it; see
 * lib/site-url.ts for why "configured" is deliberately not the same as "live".
 *
 * DYNAMIC BY NECESSITY. Reading the Host header opts this route out of static
 * generation, which is correct: a robots.txt baked at build time would be
 * wrong the moment the same build is promoted to a different hostname, and
 * Vercel promotes builds between environments as a matter of routine.
 */
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  /**
   * Wrapped because headers() throws outside a request scope. Failing to read
   * the host must fail CLOSED — an unknown host is treated as not-production,
   * which costs a day of crawling at worst and prevents the wrong-host
   * indexing that has no cheap undo.
   */
  let host: string | null = null;
  try {
    host = headers().get("host");
  } catch {
    host = null;
  }

  if (!isIndexable(host)) {
    return {
      rules: [{ userAgent: "*", disallow: "/" }],
      // No sitemap reference. Pointing a crawler at 266,305 URLs while telling
      // it not to crawl them is a mixed signal, and Google has historically
      // treated a sitemap as a discovery hint regardless of robots rules.
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        /**
         * Everything behind a session, plus the auth plumbing. These are
         * already 404 or redirect for an anonymous crawler — this saves the
         * crawl budget rather than providing security, which RLS and
         * requireAdmin() do.
         *
         * /api/ is listed because the cron route is the only thing under it and
         * it authenticates by secret; there is nothing there to index.
         */
        disallow: ["/admin/", "/manage/", "/inquiries", "/dashboard", "/auth/", "/api/"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: siteHost() || PRODUCTION_HOST,
  };
}
