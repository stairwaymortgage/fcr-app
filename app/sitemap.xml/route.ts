import { headers } from "next/headers";

import { isIndexable } from "@/lib/site-url";
import { sitemapIndex } from "@/lib/sitemap";

/**
 * /sitemap.xml — the sitemap index.
 *
 * ⚠ 404s UNTIL THE SITE IS LIVE ON THE APEX, and that is the same decision
 * robots.txt makes rather than a second one. A reachable sitemap can be
 * submitted to Search Console by hand, and on this deployment every URL inside
 * it would be an fcr-app.vercel.app URL — exactly the wrong-host indexing the
 * robots rules exist to prevent. Serving nothing is the coherent answer.
 *
 * See lib/site-url.ts: flipping NEXT_PUBLIC_SITE_URL to the apex turns this on
 * along with everything else.
 */
export const dynamic = "force-dynamic";

/**
 * The index counts contractors and nothing more, so it is fast — but it shares
 * a budget with the children below, which are not. Raised together so a slow
 * cold read cannot 504 the entry point to the whole sitemap.
 */
export const maxDuration = 60;

export async function GET() {
  if (!isIndexable(safeHost())) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const xml = await sitemapIndex();
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        // One hour at the edge. The URL SET changes only when contractors are
        // added or removed, which happens on a weekly refresh at most.
        "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    console.error("[sitemap] index failed", err);
    // 500, not an empty sitemap. An empty <sitemapindex> is a valid document
    // that tells Google we have no pages, which it will act on.
    return new Response("Sitemap unavailable", { status: 500 });
  }
}

function safeHost(): string | null {
  try {
    return headers().get("host");
  } catch {
    return null;
  }
}
