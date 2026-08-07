import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { revalidateListings } from "@/lib/revalidate";

/**
 * POST /api/revalidate-listings — bust the cached listing pages.
 *
 * Called by scripts/import-dbpr.mjs at the end of a successful run. The weekly
 * DBPR refresh moves every count on /counties, /cities, /types and the homepage,
 * and those pages are statically cached for 24 hours — so without this the site
 * would advertise last week's numbers for up to a day after the import that
 * replaced them.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AUTH: SHARED SECRET IN THE Authorization HEADER, COMPARED IN CONSTANT TIME.
 *
 * Deliberately the SAME mechanism as /api/cron/purge-id-photos rather than a new
 * one: one secret-checking pattern in the codebase is one pattern to get right.
 *
 *   Authorization: Bearer $CRON_SECRET
 *
 * CRON_SECRET is reused rather than minting a REVALIDATE_SECRET. Both endpoints
 * are machine-only, both are operated by us, and a second secret is a second
 * thing to rotate, leak and forget. If these ever need different blast radii
 * they should be split then — the split is cheap, and it is not needed while
 * both mean "our own infrastructure".
 *
 * ⚠ A BAD OR MISSING SECRET GETS 404, NOT 401 — same rule as the cron route and
 * /admin/*. A 401 confirms the route exists and that there is a secret worth
 * guessing. There is nothing to gain from telling an unauthenticated caller that
 * this endpoint is real.
 *
 * WHAT AN ATTACKER WOULD GET IF THE SECRET LEAKED: the ability to make four
 * pages regenerate. No data is read, written or returned. It is a denial-of-
 * service lever at worst — spam it and every request rebuilds four pages — which
 * is why it is still behind a secret rather than left open.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * POST ONLY. A GET would be triggerable by any crawler that found the URL, and
 * "reachable by prefetch" is not a property a cache-invalidation endpoint should
 * have.
 */

/** This route must never itself be cached. */
export const dynamic = "force-dynamic";

function secretMatches(header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  // timingSafeEqual throws on a length mismatch, so lengths are compared first.
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    /**
     * Refused rather than allowed. An unset secret must not turn this into an
     * open endpoint — the same posture the cron route takes, and for a smaller
     * but identical reason: a misconfiguration should fail closed.
     */
    console.error("[revalidate-listings] refused: CRON_SECRET is not set");
    return new NextResponse("Not found", { status: 404 });
  }

  if (!secretMatches(request.headers.get("authorization"), secret)) {
    return new NextResponse("Not found", { status: 404 });
  }

  revalidateListings();

  console.info("[revalidate-listings] listing routes invalidated");
  return NextResponse.json({ ok: true, revalidated: ["/", "/counties", "/cities", "/types"] });
}
