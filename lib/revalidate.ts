import "server-only";

import { revalidatePath, revalidateTag } from "next/cache";

/**
 * Cache invalidation for the ISR listing routes and contractor profiles.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ revalidateTag() AND revalidatePath() BOTH RUN HERE, AND THEY INVALIDATE TWO
 * DIFFERENT CACHES. Neither substitutes for the other.
 *
 * The TTFB audit originally recommended tagging the listings and calling
 * revalidateTag('listings') INSTEAD of revalidatePath. That was wrong, and the
 * reason is worth keeping: tags attach to entries in Next's DATA cache —
 * `fetch(..., { next: { tags } })` and unstable_cache(). The listing routes are
 * cached by the FULL ROUTE cache via `export const revalidate = 86400`, and
 * their data comes from supabase-js, which does not go through Next's
 * instrumented fetch. With nothing tagged, revalidateTag would have returned
 * successfully, invalidated nothing, and left a stale page up for the full 24
 * hours — the worst kind of cache bug, because the call site looks correct and
 * the logs stay quiet.
 *
 * The note that stood here said: "IF TAGS ARE EVER WANTED, the prerequisite is
 * wrapping the browse reads in unstable_cache with a tag … Do not add
 * revalidateTag calls before that exists."
 *
 * THAT PREREQUISITE SHIPPED on 2026-09-01. lib/browse-cached.ts now wraps the
 * page-independent browse reads — county_type_counts above all, at 440 ms and
 * 67 keys — in unstable_cache under the tag "browse". So the tag call below is
 * no longer a no-op, and both lines are needed:
 *
 *   revalidatePath(…)      the four ISR listing ROUTES (rendered HTML)
 *   revalidateTag("browse") the browse DATA read by /county, /city and /type,
 *                           which stay dynamic and cannot use the route cache
 *
 * ⚠ DELETE EITHER AND HALF THE SITE GOES STALE FOR 24 HOURS AFTER AN IMPORT,
 * with nothing failing. The route cache and the data cache have no knowledge of
 * each other.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The routes rendered statically with `export const revalidate = 86400`.
 *
 * ⚠ KEEP THIS LIST IN STEP WITH THE ROUTES THAT DECLARE `revalidate`. A route
 * added there and missed here is a page that never updates until its 24 hours
 * elapse; a route listed here that is dynamic is a harmless no-op. The
 * asymmetry is why the list lives in one place rather than at each call site.
 *
 * The paginated routes (/county/[slug], /city/[slug], /type/[code]) are
 * deliberately ABSENT: they read searchParams and so render dynamically, which
 * means they are never stale and there is nothing to invalidate.
 */
const ISR_LISTING_PATHS = ["/", "/counties", "/cities", "/types"] as const;

/**
 * The Data Cache tag every wrapper in lib/browse-cached.ts is written under.
 *
 * ⚠ KEEP IN STEP WITH THAT FILE. The string is the only thing joining the two —
 * a rename on one side and not the other invalidates nothing, silently, and the
 * browse reads serve week-old counts until their 24h TTL expires.
 */
const BROWSE_DATA_TAG = "browse";

/**
 * Slug shape, so a malformed value cannot reach revalidatePath.
 *
 * Mirrors the guard already in app/admin/claims/actions.ts. revalidatePath takes
 * a path string; an unvalidated slug would let a stray character invalidate
 * something other than the intended page.
 */
const SLUG_SHAPE = /^[a-z0-9-]{1,200}$/;

/**
 * Bust the four cached listing routes.
 *
 * Call after a change that alters what those pages RENDER — a claim decision
 * (claim_tier drives the badge), a release, or the weekly import (every count).
 *
 * NOT after a profile text edit: business_name and the counts are not editable
 * by a contractor, so nothing on a listing changes and four needless
 * regenerations would be triggered by every save.
 */
export function revalidateListings(): void {
  for (const path of ISR_LISTING_PATHS) revalidatePath(path);

  /**
   * The browse DATA, which /county/[slug], /city/[slug] and /type/[code] read.
   *
   * Those three are NOT in ISR_LISTING_PATHS and cannot be: they read
   * searchParams, so they render dynamically and have no route-cache entry to
   * invalidate. What they do have, since 2026-09-01, is cached data — and the
   * import moves every number in it. Without this line the filter counts and
   * city lists on all three would serve the previous week's figures for up to
   * 24 hours after an import that replaced them.
   */
  revalidateTag(BROWSE_DATA_TAG);
}

/**
 * Bust one contractor's public profile and its owner-facing editor.
 *
 * ⚠ THE PROFILE IS THE ONE PAGE THAT MAY NOT GO STALE. A contractor approved
 * ten seconds ago must see their claimed profile now, which is why every
 * decision path calls this synchronously rather than relying on any timer.
 * Listings tolerating 24 hours is a deliberate, separate trade.
 *
 * /contractor/[slug] is dynamic today, so this is currently a no-op there. It is
 * called anyway: the route's render mode is a performance decision that may
 * change, and a caching change that silently stops approvals appearing would be
 * very hard to trace back. Same reasoning as the note in
 * app/admin/claims/actions.ts.
 */
export function revalidateProfile(slug: string | null | undefined): void {
  if (!slug || !SLUG_SHAPE.test(slug)) return;
  revalidatePath(`/contractor/${slug}`);
  revalidatePath(`/manage/${slug}`);
}

/**
 * Everything a claim decision changes: the profile, and the listings whose
 * claim_tier badge it moves.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * FUTURE-PROOFING, NOT DEAD CODE: the Stripe featured-promotion path.
 *
 * public.contractors carries a trigger, contractors_promote_on_subscription,
 * which sets claim_tier = 'featured' whenever stripe_subscription_id is written.
 * Featured placement is exactly the kind of thing a customer checks immediately
 * after paying, and a 24-hour stale listing would be a support ticket every
 * time.
 *
 * ⚠ NOTHING CALLS THIS FOR STRIPE TODAY, AND THAT IS CORRECT. Stripe is skipped
 * per Jim; there is no webhook, no checkout, and no way to exercise the path, so
 * wiring a handler now would ship code that has never once run. When the webhook
 * lands, its handler calls this function after the subscription write — that is
 * the whole integration on this side.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function revalidateAfterClaimDecision(slug: string | null | undefined): void {
  revalidateProfile(slug);
  revalidateListings();
}
