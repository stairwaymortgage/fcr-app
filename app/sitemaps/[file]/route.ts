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
      // Number() on a \d{1,3} capture cannot be NaN, and the range is checked
      // inside contractorSitemap() against the live count — so a chunk that
      // exists today and not next week 404s rather than serving an empty file.
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
