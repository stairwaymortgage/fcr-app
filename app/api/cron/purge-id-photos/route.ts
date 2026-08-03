import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { ID_PHOTO_BUCKET } from "@/lib/claims";
import { purgeExpiredIdPhotos } from "@/lib/purge-id-photos";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Scheduled ID photo purge — GET /api/cron/purge-id-photos
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS KEEPS A PROMISE THAT WAS ALREADY IN WRITING.
 *
 * public.claims is commented "ID photos auto-delete 90 days post-decision" and
 * id_photo_expires_at is NOT NULL, so every claim has carried a deletion date
 * since the table existed. Nothing deleted anything. The migration that set the
 * column said so plainly: as written, that comment was a claim we did not keep,
 * and if it reached a privacy policy it became a false statement about PII
 * handling. The first submissions reach 90 days around 2026-10-30.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A BAD SECRET GETS 404, NOT 401.
 *
 * Same rule as /admin/*. A 401 confirms the route exists and that there is a
 * secret worth guessing; a 404 is the answer any nonexistent path gives. This
 * endpoint deletes government ID photographs on a timer — it should not
 * announce itself to anyone scanning for it.
 *
 * The comparison is constant-time. A bearer secret compared with === leaks its
 * length and prefix through response timing, which is a small leak but an
 * entirely avoidable one.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * GET because Vercel Cron only issues GET. A GET that deletes data is not
 * something to do casually — it is acceptable here only because the route is
 * unreachable without the shared secret, and is never linked, never in a
 * sitemap, and noindex by virtue of being an API route.
 *
 * SERVICE ROLE, NECESSARILY. The bucket grants contractors no DELETE at all
 * (deliberately — see the storage migration: an approved claim whose evidence
 * has been erased by the person it approved cannot be audited). Only the
 * service role can remove these objects, which is why this is a server route
 * with no user session rather than anything a contractor can trigger.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function secretMatches(header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  // timingSafeEqual throws on a length mismatch, so the lengths are compared
  // first — that comparison is itself not constant-time, but a secret's LENGTH
  // is not the part worth protecting.
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    /**
     * Refuse rather than run unauthenticated. A deployment that has forgotten
     * CRON_SECRET must not expose an open endpoint that deletes ID photos, and
     * it must not silently succeed either — the log line is how a misconfigured
     * environment gets noticed before the retention promise quietly lapses.
     */
    console.error("[cron] purge-id-photos refused: CRON_SECRET is not set");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  if (!secretMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const started = Date.now();
  const result = await purgeExpiredIdPhotos(createAdminClient(), {
    bucket: ID_PHOTO_BUCKET,
  });
  const ms = Date.now() - started;

  /**
   * Logged on every run, including the quiet ones. A purge job that only speaks
   * up when it deletes something is indistinguishable from a purge job that has
   * silently stopped running, and the failure mode here is invisible: nothing
   * breaks, photographs simply keep existing past the date we promised.
   */
  console.log("[cron] purge-id-photos", { ...result, ms });

  // 200 even with failures inside the batch: the run itself completed, and a
  // non-2xx would make Vercel report the schedule as broken when it is working
  // and simply hit a bad chunk. The counts and errors carry the detail.
  return NextResponse.json({ ok: true, ...result, ms });
}
