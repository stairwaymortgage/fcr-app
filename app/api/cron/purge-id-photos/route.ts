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
  const admin = createAdminClient();
  const result = await purgeExpiredIdPhotos(admin, {
    bucket: ID_PHOTO_BUCKET,
  });

  /**
   * RATE-LIMIT COUNTER RETENTION — a second, unrelated sweep riding this
   * schedule.
   *
   * ⚠ IT LIVES HERE RATHER THAN IN ITS OWN CRON ENTRY ON PURPOSE. A second
   * scheduled route would be a second thing that can silently stop running, and
   * this DELETE is one statement against a table nobody watches. Bolted to a job
   * that already holds the service-role key, already runs daily, and already
   * logs on every run, it inherits all of that supervision for free.
   *
   * The longest window any bucket uses is 24 hours, so a row whose window began
   * more than 48 hours ago cannot affect any verdict. 48 rather than 24 so that
   * a purge which fails to run for a day changes nothing about behaviour.
   *
   * ⚠ IT MUST NOT BE ABLE TO FAIL THE ID-PHOTO PURGE. That is the sweep with a
   * privacy promise behind it and a date already in writing; this one only
   * reclaims space. So it runs after, its error is logged rather than thrown,
   * and the route still returns 200 — the counters growing for another day is a
   * non-event, ID photos outliving their deletion date is not.
   */
  let rateLimitRowsPurged: number | null = null;
  const { error: rateLimitPurgeError, count } = await admin
    .from("rate_limits")
    .delete({ count: "exact" })
    .lt("window_start", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());

  if (rateLimitPurgeError) {
    console.error("[cron] rate_limits purge failed — counters will keep growing", {
      code: rateLimitPurgeError.code,
      message: rateLimitPurgeError.message,
      hint:
        rateLimitPurgeError.code === "42P01"
          ? "db/migrations/20260806_rate_limits.sql has not been run."
          : undefined,
    });
  } else {
    rateLimitRowsPurged = count ?? 0;
  }

  const ms = Date.now() - started;

  /**
   * Logged on every run, including the quiet ones. A purge job that only speaks
   * up when it deletes something is indistinguishable from a purge job that has
   * silently stopped running, and the failure mode here is invisible: nothing
   * breaks, photographs simply keep existing past the date we promised.
   */
  console.log("[cron] purge-id-photos", { ...result, rateLimitRowsPurged, ms });

  // 200 even with failures inside the batch: the run itself completed, and a
  // non-2xx would make Vercel report the schedule as broken when it is working
  // and simply hit a bad chunk. The counts and errors carry the detail.
  return NextResponse.json({ ok: true, ...result, rateLimitRowsPurged, ms });
}
