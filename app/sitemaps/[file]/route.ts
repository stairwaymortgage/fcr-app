import { headers } from "next/headers";

import { isIndexable } from "@/lib/site-url";
import { contractorSitemap, pagesSitemap } from "@/lib/sitemap";

/**
 * /sitemaps/pages.xml and /sitemaps/contractors-{n}.xml — the child sitemaps.
 *
 * ONE ROUTE FOR BOTH SHAPES, because they differ only in which query fills
 * them and the alternative is two nearly identical files. The filename is
 * parsed here rather than expressed as nested routes so that the set of valid
 * names lives in one place and anything else is a clean 404 — a sitemap URL
 * that 200s with the wrong content is worse than one that does not exist.
 *
 * 404s off the apex, exactly as /sitemap.xml does. See that file.
 */
/**
 * ⚠ ISR WAS ATTEMPTED HERE ON 2026-09-01 AND DOES NOT WORK. force-dynamic is
 * restored deliberately; do not swap it for `revalidate` again without reading
 * this.
 *
 * `export const revalidate = 86400` was applied in place of this line and the
 * build was inspected rather than trusted. The route STILL compiled as
 * ƒ (Dynamic), with no entry in `dynamicRoutes` and none in `routes` in
 * .next/prerender-manifest.json — the directive was dead config, exactly like
 * the six listing routes lib/supabase/public.ts documents.
 *
 * THE CAUSE IS NOT cookies()/headers(), WHICH WAS THE OBVIOUS SUSPECT. The
 * handler reads headers() via safeHost(), so that was tested first: with the
 * headers import and safeHost removed entirely, the route was STILL ƒ with no
 * prerender entry. The blocker is structural — a dynamic segment ([file]) needs
 * generateStaticParams to be prerendered, the same reason app/contractor/[slug]
 * needed one before its ISR took effect.
 *
 * MAKING IT WORK WOULD COST TWO THINGS, NEITHER OF THEM FREE:
 *   1. generateStaticParams enumerating pages.xml and every contractors-N,
 *      which needs the chunk count at build time and prerenders all six chunks
 *      into every deploy.
 *   2. Giving up the request-host check — a prerendered route cannot read
 *      headers(), so isIndexable() would fall back to the env-configured host
 *      and the *.vercel.app alias would serve an indexable sitemap instead of
 *      404ing. app/robots.ts explains at length why that host must not serve
 *      indexable content.
 *
 * The origin-side caching this was meant to buy is still available without
 * either cost — wrap the generation in unstable_cache, as lib/browse-cached.ts
 * does — but that is a different change and is not made here.
 */
export const dynamic = "force-dynamic";

/**
 * A contractor chunk is 50,000 slugs — fifty PostgREST pages, six at a time.
 * The default 15s budget is not enough for a cold one, and a truncated sitemap
 * is worse than a slow one because it silently de-lists profiles.
 */
export const maxDuration = 60;

const CONTRACTOR_FILE = /^contractors-(\d{1,3})\.xml$/;

export async function GET(
  _request: Request,
  { params }: { params: { file: string } },
) {
  if (!isIndexable(safeHost())) {
    return new Response("Not found", { status: 404 });
  }

  const file = params.file;

  try {
    let xml: string | null = null;

    if (file === "pages.xml") {
      xml = await pagesSitemap();
    } else {
      const match = CONTRACTOR_FILE.exec(file);
      // Number() on a \d{1,3} capture cannot be NaN. The range is checked
      // inside contractorSitemap() — since 2026-09-01 against MAX_CHUNKS and
      // the emptiness of the result rather than an exact count(*), for the
      // reasons set out there — so a chunk that exists today and not next week
      // still 404s rather than serving an empty file.
      if (match) xml = await contractorSitemap(Number(match[1]));
    }

    if (xml === null) return new Response("Not found", { status: 404 });

    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    console.error(`[sitemap] ${file} failed`, err);
    // Never a partial or empty urlset — Google would treat the missing URLs as
    // de-listed. An error tells it to come back.
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
