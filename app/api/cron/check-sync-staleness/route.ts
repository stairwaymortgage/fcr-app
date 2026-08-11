import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { sendOperationalAlert } from "@/lib/email";
import { SYNC_STALE_AFTER_DAYS } from "@/lib/sync-runs";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * DBPR refresh staleness alarm — GET /api/cron/check-sync-staleness
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE REFRESH HAS NO SCHEDULE, SO THIS WATCHES FOR ITS ABSENCE INSTEAD.
 *
 * On 2026-08-09/10 a weekly refresh was expected and none happened. The
 * investigation found there was nothing to fail: no GitHub Actions workflow has
 * ever existed in this repository (`git log --all -- .github` is empty), and
 * vercel.json has never had a sync entry. "Next scheduled run: Sunday 02:00 ET"
 * came from admin_sync_status.html, a mockup, and app/admin/sync/page.tsx
 * documents declining to implement it. The run the importer picked up that day
 * was a queue request from the PREVIOUS WEDNESDAY, waiting 343,455 seconds.
 *
 * ⚠ AND A SCHEDULE STILL CANNOT BE ADDED. The importer reads a 47.7MB CSV from
 * local disk; DBPR publishes it behind a Cloudflare managed challenge that
 * refuses automated requests from anywhere (docs/dbpr-source.md). No Vercel
 * function or CI runner can obtain the file. Until that is solved the refresh
 * is a human act.
 *
 * So this does not schedule anything. It makes the ABSENCE of a refresh loud,
 * which is the only failure mode nobody can see: the site keeps serving, every
 * page renders normally, and the data silently ages. /admin/sync already shows
 * a 14-day warning — but only to someone who visits /admin/sync, and nobody did
 * for four days.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ MEASURED AGAINST THE NEWEST *SUCCESSFUL* RUN, NOT THE NEWEST ROW. This is
 * the whole design and it is one line of query. A failed import does not reset
 * the clock, so "nobody ran it" and "it ran every night and died every night"
 * both trip the same alarm at the same threshold. There is deliberately no
 * second check for failures — a second condition is a second thing to get
 * wrong, and it would fire on the transient failures the importer already
 * recovers from by itself.
 *
 * IT ALERTS EVERY DAY WHILE STALE, WITH NO SUPPRESSION STATE. Considered and
 * rejected: suppression means a table, a reset rule, and a way for the alarm to
 * silence itself permanently through a bug. A daily email during an actual data
 * outage is not noise, and the remedy — run the importer — takes half an hour.
 *
 * A BAD SECRET GETS 404, not 401. Same rule as /api/cron/purge-id-photos and
 * /api/revalidate-listings: a 401 confirms the route exists and that there is a
 * secret worth guessing.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function secretMatches(header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  // timingSafeEqual throws on a length mismatch, so lengths are compared first.
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    console.error("[cron] check-sync-staleness refused: CRON_SECRET is not set");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  if (!secretMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const db = createAdminClient();

  /**
   * ORDERED BY completed_at, NOT started_at. What matters is when the data
   * last became current, and a long run that started before a short one can
   * finish after it. The column is null on queued/running/crashed rows, which
   * the status filter has already excluded.
   */
  const { data, error } = await db
    .from("sync_runs")
    .select("id, completed_at, records_total")
    .eq("status", "success")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    /**
     * A failed CHECK is not a passed check. Returning 200 here would let a
     * broken query masquerade as "data is fresh" for as long as it kept
     * failing — the alarm would be silently disarmed, which is worse than not
     * having one. 500 makes Vercel report the schedule as failing.
     */
    console.error("[cron] check-sync-staleness could not read sync_runs", error.message);
    return NextResponse.json({ error: "check failed" }, { status: 500 });
  }

  const lastSuccess = data?.completed_at ?? null;
  const ageDays = lastSuccess
    ? Math.floor((Date.now() - new Date(lastSuccess).getTime()) / 86_400_000)
    : null;
  const stale = ageDays === null || ageDays >= SYNC_STALE_AFTER_DAYS;

  let alerted = false;
  let alertError: string | undefined;

  if (stale) {
    const body = lastSuccess
      ? [
          `The DBPR registry data is ${ageDays} days old.`,
          ``,
          `Last successful refresh : ${lastSuccess}`,
          `Records in that run     : ${data?.records_total?.toLocaleString("en-US") ?? "unknown"}`,
          `Alarm threshold         : ${SYNC_STALE_AFTER_DAYS} days`,
          ``,
          `DBPR publishes weekly, so the registry is now at least one full`,
          `extract behind. Every listing page is serving figures from that date.`,
          ``,
          `TO FIX — on the machine holding the CSV:`,
          `  1. Download the current CONSTRUCTIONLICENSE_1.csv from DBPR into`,
          `     _handoff/07_source_data/`,
          `  2. NEXT_PUBLIC_SITE_URL=https://floridacontractorregistry.com \\`,
          `       node scripts/import-dbpr.mjs`,
          ``,
          `The importer repairs the reference counts and busts the listing cache`,
          `itself. Nothing else is needed afterwards.`,
        ].join("\n")
      : [
          `sync_runs contains no successful refresh at all.`,
          ``,
          `This is either a brand-new database or the audit table has been`,
          `cleared. If the registry is populated, the data predates the`,
          `importer's audit trail and its true age is unknown.`,
        ].join("\n");

    const result = await sendOperationalAlert(
      `[FCR] DBPR data is ${ageDays === null ? "of unknown age" : `${ageDays} days old`}`,
      body,
    );
    alerted = result.ok;
    alertError = result.error;

    if (!result.ok) {
      /**
       * ⚠ THE ALARM FAILING TO SEND IS ITSELF AN ALARM, and the only place it
       * can be reported is this log. Loud, and distinguishable from the quiet
       * healthy line below.
       */
      console.error("[cron] check-sync-staleness STALE BUT ALERT FAILED TO SEND", {
        ageDays,
        lastSuccess,
        error: result.error,
      });
    }
  }

  /**
   * Logged on every run, healthy or not — the same rule as the ID-photo purge.
   * A monitor that only speaks when it finds a problem is indistinguishable
   * from a monitor that has stopped running, which is the exact failure this
   * route was built to catch. Being silent about itself would be ironic.
   */
  console.log("[cron] check-sync-staleness", { lastSuccess, ageDays, stale, alerted });

  /**
   * 200 even when stale. Stale data is a finding, not a malfunction of this
   * check — a non-2xx would make Vercel report the SCHEDULE as broken when the
   * schedule is working perfectly and reporting bad news. Only a check that
   * could not run returns non-2xx (see the 500 above).
   */
  return NextResponse.json({
    ok: true,
    lastSuccess,
    ageDays,
    thresholdDays: SYNC_STALE_AFTER_DAYS,
    stale,
    alerted,
    ...(alertError ? { alertError } : {}),
  });
}
