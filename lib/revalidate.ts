import "server-only";

import { revalidatePath } from "next/cache";

/**
 * Cache invalidation for the ISR listing routes and contractor profiles.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ revalidateTag() IS NOT USED HERE, AND THE PLAN THAT PROPOSED IT WAS WRONG.
 *
 * The TTFB audit recommended tagging the listings and calling
 * revalidateTag('listings'). That does not work with what actually ships.
 *
 * Tags attach to entries in Next's DATA cache — `fetch(..., { next: { tags } })`
 * and unstable_cache(). The listing routes are cached by the FULL ROUTE cache,
 * via `export const revalidate = 86400`, and their data comes from supabase-js,
 * which does not go through Next's instrumented fetch. There is no tag on
 * anything, so revalidateTag('listings') would return successfully, invalidate
 * nothing, and leave a stale page up for the full 24 hours — the worst kind of
 * cache bug, because the call site looks correct and the logs stay quiet.
 *
 * revalidatePath() invalidates the route cache directly, which is the cache
 * these pages actually use. So this module names the four ISR routes explicitly.
 *
 * IF TAGS ARE EVER WANTED, the prerequisite is wrapping the browse reads in
 * unstable_cache with a tag — a different change with its own trade-offs (it
 * caches the DATA across routes rather than the rendered page). Do not add
 * revalidateTag calls before that exists.
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
