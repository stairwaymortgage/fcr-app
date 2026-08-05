import type { Metadata } from "next";

import AdminHeader from "@/components/AdminHeader";
import StatsStrip from "@/components/StatsStrip";
import StatusBanner from "@/components/StatusBanner";
import { requireAdmin } from "@/lib/auth";
import { FOCUS_RING_PAPER } from "@/lib/focus";
import {
  checkReferenceCounts,
  REPAIR_MIGRATION,
  VERIFY_COMMAND,
  type ReferenceCountReport,
} from "@/lib/reference-counts";
import { createClient } from "@/lib/supabase/server";
import {
  ACTIVE_SYNC_STATUSES,
  countLabel,
  daysSince,
  fileSizeLabel,
  IMPORTER_COMMAND,
  orphanCutoff,
  queueWait,
  runDuration,
  SYNC_RUN_COLUMNS,
  SYNC_STATUS_DOT,
  SYNC_STATUS_LABEL,
  SYNC_STATUS_PILL,
  type SyncRun,
} from "@/lib/sync-runs";
import { absoluteTime, relativeTime } from "@/lib/time";

import { queueRefresh } from "./actions";

/**
 * DBPR sync status — /admin/sync
 * Source: _handoff/02_mockups_production/08_admin/admin_sync_status.html
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE HONEST VERSION OF A MOCKUP DRAWN AROUND A RUN THAT NEVER HAPPENED.
 *
 * admin_sync_status.html renders run #487 of a weekly cron: 52 of 52 successful
 * runs over a year, 847 changes applied, a 14m 22s duration broken into five
 * timed stages. None of that has ever existed. sync_runs held zero rows until
 * scripts/import-dbpr.mjs was instrumented in task 157, and the one import this
 * project has performed — 266,305 rows on 2026-07-29 — predates the
 * instrumentation and left no audit row behind. It is not backfillable: the
 * counts it would need were never measured.
 *
 * So this page ships with a real empty state, and the empty state is the point.
 * Everything it renders comes from a sync_runs row; nothing is seeded, averaged
 * or inferred from the mockup's sample data.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * NOT BUILT FROM THE MOCKUP, EACH FOR A REASON:
 *
 *   · "Run Sync Manually" — shipped as "Trigger refresh", which QUEUES rather
 *     than runs. The refresh is a local Node script reading a 47.7MB CSV off
 *     disk and holding 266k fingerprints in memory; no Vercel function can do
 *     that, and the source file is not reachable from one. So the button
 *     records a request with the requester's name, and the page tells the
 *     operator the command to run. A button that spun and then claimed success
 *     would be the most damaging lie this surface could tell, because the one
 *     question it exists to answer is "is our data current?".
 *   · "View Logs" / /admin/sync/logs. The log IS this table; a second route
 *     showing the same twelve rows unpaginated is not a feature.
 *   · Per-record change lists ("Added · New licenses issued by DBPR · +132").
 *     The importer counts changes, it does not record WHICH rows changed —
 *     that needs a per-run diff table, which is its own build and its own
 *     retention decision.
 *   · The five-stage timing breakdown (download, schema validation, county
 *     mapping, licence type mapping, ISR cache refresh). Four of those five
 *     stages do not exist as discrete steps, and ISR is not in play — every
 *     route here reads cookies and is therefore dynamic.
 *   · "Recent Alerts & Notes". An editorial feed with no writer and no table.
 *   · "52 / 52 Successful Runs (1 yr)". Rendered as "of N recorded" instead,
 *     because the denominator is the number of runs this table has seen and
 *     saying "1 yr" over two rows would be a fabrication.
 *   · "Next scheduled run: Sunday 02:00 ET". Nothing is scheduled. Task 158's
 *     trigger is HELD pending the question of where the CSV actually comes
 *     from, and inventing a cadence on screen would answer it by accident.
 *
 * ⚠ THE SOURCE IS RENDERED FROM THE ROW, NEVER ASSUMED. Each run records the
 * source it actually read; the importer writes the local file path rather than
 * sync_runs' default DBPR URL, because no fetch happens. The panel renders
 * whatever the row says, so when a --download run starts recording a real URL
 * this page will not need editing.
 *
 * Provenance is settled and written up in docs/dbpr-source.md: DBPR publishes
 * the extract weekly at www2.myfloridalicense.com, and that host sits behind a
 * Cloudflare managed challenge that refuses automated requests. The panel says
 * so, because "why is this still manual?" is the first question this page
 * invites and the answer is not a matter of anyone's priorities.
 */

export const metadata: Metadata = {
  title: "DBPR Sync · Admin",
  robots: { index: false, follow: false },
};

/** The mockup's "Last 12 Runs". Weekly cadence makes that a quarter of history. */
const HISTORY_LIMIT = 12;

/** ?e= codes set by ./actions.ts. Never a raw Postgres message. */
const ERROR_TEXT: Record<string, string> = {
  active:
    "A refresh is already queued or running, so nothing was added. The one below is still waiting.",
  failed: "Something went wrong on our side. Nothing was queued — try again.",
  constraint:
    "The database has not been migrated yet. Run db/migrations/20260805_sync_runs_queued.sql, then press this again.",
};

export default async function AdminSyncPage({
  searchParams,
}: {
  searchParams: { e?: string };
}) {
  const user = await requireAdmin();

  /**
   * The admin's own session, as on /admin/leads. "admin only sync_runs" (FOR
   * ALL, USING is_admin()) is doing real work on every query below —
   * requireAdmin() is the first of two checks, not the only one.
   */
  const db = createClient();

  const [runsResult, runCounts, contractorTotal, headerCounts, referenceCounts] = await Promise.all([
    db
      .from("sync_runs")
      .select(SYNC_RUN_COLUMNS, { count: "exact" })
      .order("started_at", { ascending: false })
      .limit(HISTORY_LIMIT),
    loadRunCounts(db),
    db.from("contractors").select("dbpr_sync_key", { count: "exact", head: true }),
    loadHeaderCounts(db),
    /**
     * The drift check runs on every page load, alongside everything else, and
     * costs four queries. It belongs HERE rather than on a settings page
     * because this is where the refresh workflow lives: the run that
     * invalidates these counts and the notice that they need repairing should
     * be on one screen.
     */
    checkReferenceCounts(db),
  ]);

  if (runsResult.error) {
    console.error("[admin/sync] history query failed", runsResult.error.message);
  }

  // `as unknown as` for the reason /admin/leads needs it: the select list is an
  // assembled string, so supabase-js cannot infer a row type from it.
  const runs = (runsResult.data ?? []) as unknown as SyncRun[];

  /**
   * THE BANNER DESCRIBES THE LAST FINISHED ATTEMPT, NOT THE NEWEST ROW.
   *
   * Once a refresh can be queued, the newest row is frequently a request that
   * has not run — and "last run · queued" is a category error. Worse, a queued
   * or running row rendered here would say the same thing the trigger section
   * above already says, in a louder voice.
   *
   * So the three sections answer three different questions: the trigger section
   * owns "is something outstanding", this owns "how did the last completed
   * refresh go", and the history table owns everything. Found within the
   * fetched page rather than queried, which is safe because the guard permits
   * at most one outstanding run — so a finished row is at worst second.
   */
  const latest =
    runs.find((r) => r.status === "success" || r.status === "failed") ?? null;

  /**
   * The newest SUCCESSFUL run, which is not necessarily the newest run. A failed
   * or still-running attempt must not become the orphan baseline: measuring
   * against a run that never finished stamping rows would report most of the
   * registry as orphaned.
   *
   * Queried separately rather than searched within `runs`, because the newest
   * success can sit outside the twelve rows on screen once a run fails
   * repeatedly — which is exactly when this number matters.
   */
  const { data: lastSuccessRows } = await db
    .from("sync_runs")
    .select("id, started_at, completed_at, records_total, records_orphaned")
    .eq("status", "success")
    .order("started_at", { ascending: false })
    .limit(1);
  const lastSuccess = (lastSuccessRows?.[0] ?? null) as
    | Pick<
        SyncRun,
        "id" | "started_at" | "completed_at" | "records_total" | "records_orphaned"
      >
    | null;

  /**
   * The outstanding run, if there is one — what the queue guard keys off.
   *
   * Queried separately rather than found within `runs` for the same reason
   * lastSuccess is: the history table is capped at twelve, and a request queued
   * months ago and never actioned would drop off the bottom exactly when it
   * most needs surfacing. Ordered OLDEST first, because that is the one the
   * importer will claim and therefore the one to tell the operator about.
   */
  const { data: activeRows } = await db
    .from("sync_runs")
    .select(SYNC_RUN_COLUMNS)
    .in("status", ACTIVE_SYNC_STATUSES)
    .order("queued_at", { ascending: true, nullsFirst: false })
    .limit(1);
  const active = (activeRows?.[0] ?? null) as unknown as SyncRun | null;

  /**
   * ORPHANS, COUNTED LIVE RATHER THAN READ OFF THE RUN ROW.
   *
   * The importer records records_orphaned at the moment it ran; this asks the
   * table the same question now. The two should agree, and where they do not,
   * the live figure is the true one — a row can be added by hand or a run can
   * be interrupted after the census. Both are shown, and disagreement is
   * surfaced rather than resolved silently.
   *
   * Never a delete. See lib/sync-runs.ts.
   */
  const orphanLive = lastSuccess
    ? (
        await db
          .from("contractors")
          .select("dbpr_sync_key", { count: "exact", head: true })
          .lt("last_dbpr_sync_at", orphanCutoff(lastSuccess))
      ).count ?? 0
    : null;

  const displayName =
    (user.user_metadata?.full_name as string | undefined)?.trim() ||
    (user.email ?? "").split("@")[0] ||
    "Admin";

  const totalRuns = runCounts.total;

  return (
    <>
      <AdminHeader
        currentPath="/admin/sync"
        userName={displayName}
        userInitials={initialsFor(displayName)}
        pendingClaims={headerCounts.pendingClaims}
        pendingLeads={headerCounts.newLeads}
      />

      <main id="main" className="min-h-screen bg-gray-100">
        <div className="mx-auto max-w-app px-8 py-8 max-[900px]:px-5">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="mb-1.5 font-serif text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] text-navy">
                DBPR <em className="italic">sync status</em>
              </h1>
              <p className="text-note text-gray-500">
                <strong className="font-medium text-gray-700">
                  {(contractorTotal.count ?? 0).toLocaleString("en-US")} contractor
                  records
                </strong>{" "}
                · {totalRuns === 0 ? "no refreshes recorded" : `${totalRuns} recorded ${totalRuns === 1 ? "run" : "runs"}`}
              </p>
            </div>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className={`text-note font-medium text-gray-600 underline hover:text-navy ${FOCUS_RING_PAPER}`}
              >
                Sign out
              </button>
            </form>
          </div>

          {/* ── STATUS BANNER ─────────────────────────────────────────── */}
          {latest === null ? (
            <div className="mb-8">
              <StatusBanner
                variant="warn"
                tag="No history"
                headline={
                  <>
                    No runs <em className="italic">recorded yet</em>
                  </>
                }
                detail={
                  <>
                    History begins with the next refresh. The registry’s{" "}
                    {(contractorTotal.count ?? 0).toLocaleString("en-US")} records
                    were loaded before <code className="font-mono">sync_runs</code>{" "}
                    had a writer, so that import left no audit row and cannot be
                    reconstructed — the counts it would need were never measured.
                    Run <code className="font-mono">node scripts/import-dbpr.mjs</code>{" "}
                    and the first row appears here.
                  </>
                }
              />
            </div>
          ) : (
            <div className="mb-8">
              <StatusBanner
                variant={latest.status === "success" ? "success" : "error"}
                tag={`Last run · ${SYNC_STATUS_LABEL[latest.status]}`}
                headline={
                  latest.status === "success" ? (
                    <>
                      Refresh completed <em className="italic">without errors</em>
                    </>
                  ) : (
                    <>
                      The last refresh <em className="italic">failed</em>
                    </>
                  )
                }
                detail={<BannerDetail run={latest} />}
                timestamp={absoluteTime(latest.started_at)}
                duration={runDuration(latest) ?? undefined}
              />
            </div>
          )}

          {searchParams.e && ERROR_TEXT[searchParams.e] && (
            <p
              role="alert"
              className="mb-6 border-l-[3px] border-status-error bg-status-errorBg px-4 py-3 text-note text-status-error"
            >
              {ERROR_TEXT[searchParams.e]}
            </p>
          )}

          {/* ── TRIGGER ───────────────────────────────────────────────── */}
          <div className="mb-8">
            <TriggerSection active={active} />
          </div>

          {/* ── STATS ─────────────────────────────────────────────────── */}
          <div className="mb-8">
            <StatsStrip
              ariaLabel="Sync statistics"
              columns={4}
              cards={[
                {
                  value: (contractorTotal.count ?? 0).toLocaleString("en-US"),
                  label: "Contractor Records",
                  /* NOT "active licenses" — see lib/registry-stats.ts. */
                  delta: "records, not active licences",
                  deltaType: "flat",
                },
                {
                  value: lastSuccess ? `${daysSince(lastSuccess.started_at)}d` : "—",
                  label: "Days Since Last Success",
                  color: lastSuccess && daysSince(lastSuccess.started_at) > 14 ? "warn" : undefined,
                  delta: lastSuccess ? "no schedule set" : "never recorded",
                  deltaType: "flat",
                },
                {
                  value:
                    latest && latest.records_inserted !== null
                      ? (latest.records_inserted + (latest.records_updated ?? 0)).toLocaleString("en-US")
                      : "—",
                  label: "Changes Last Run",
                  color: "gold",
                  delta:
                    latest && latest.records_inserted !== null
                      ? `${latest.records_inserted.toLocaleString("en-US")} added · ${(latest.records_updated ?? 0).toLocaleString("en-US")} updated`
                      : "not measured",
                  deltaType: "flat",
                },
                {
                  value: orphanLive === null ? "—" : orphanLive.toLocaleString("en-US"),
                  label: "Orphaned Records",
                  color: orphanLive ? "warn" : undefined,
                  delta:
                    orphanLive === null
                      ? "needs a successful run"
                      : "counted, never deleted",
                  deltaType: "flat",
                },
              ]}
            />
          </div>

          <div className="mb-8 grid grid-cols-2 gap-6 max-[1100px]:grid-cols-1">
            {/* ── ORPHANS ─────────────────────────────────────────────── */}
            <Panel
              title="Orphaned records"
              meta={lastSuccess ? `since ${relativeTime(lastSuccess.started_at)}` : undefined}
            >
              {lastSuccess === null ? (
                <>
                  <p className="mb-4 text-note leading-[1.6] text-gray-600">
                    Not measurable yet. An orphan is a record whose{" "}
                    <code className="font-mono text-[12px]">last_dbpr_sync_at</code>{" "}
                    predates the newest successful run, so the count needs at
                    least one successful run to measure against. There has not
                    been one.
                  </p>
                  {/* The rule is stated in BOTH branches. It was originally only
                      in the branch with a count, which put it out of sight for
                      exactly as long as the page is empty — and the empty period
                      is when someone is most likely to be reading this code and
                      deciding what the cleanup step should do. */}
                  <p className="border-l-[3px] border-l-gold bg-gold-pale px-4 py-3 text-note leading-[1.6] text-gray-700">
                    <strong className="font-semibold text-ink">
                      Orphans are never deleted.
                    </strong>{" "}
                    When this does start counting, it counts and stops there. A
                    contractor row is the parent of any claim against it, and a
                    claim carries the identity evidence someone submitted to prove
                    they own that business — deleting the row cascades that away.
                  </p>
                </>
              ) : (
                <>
                  <p className="mb-4 font-serif text-[30px] font-semibold leading-[1.1] tracking-[-0.015em] text-navy">
                    {(orphanLive ?? 0).toLocaleString("en-US")}
                  </p>
                  <p className="mb-4 text-note leading-[1.6] text-gray-700">
                    {orphanLive === 0 ? (
                      <>
                        Every record in the table was present in the most recent
                        extract. Nothing has been left behind.
                      </>
                    ) : (
                      <>
                        These records are in our table and were{" "}
                        <strong className="font-semibold text-ink">not</strong> in
                        the extract the last successful run loaded. Most will be
                        licences that lapsed, were revoked, or were withdrawn.
                      </>
                    )}
                  </p>
                  {/* The prohibition is on the page, not only in the code. The
                      next person to look at a five-figure orphan count will
                      reach for a DELETE, and this is where they are told why
                      not. */}
                  <p className="mb-4 border-l-[3px] border-l-gold bg-gold-pale px-4 py-3 text-note leading-[1.6] text-gray-700">
                    <strong className="font-semibold text-ink">
                      Orphans are never deleted.
                    </strong>{" "}
                    A contractor row is the parent of any claim against it, and a
                    claim carries the identity evidence someone submitted to prove
                    they own that business. Deleting the row cascades that away —
                    it destroys the audit record of a decision, not just a
                    listing. DBPR also omits delinquent and void licences from the
                    public extract entirely, so a suspended contractor is
                    indistinguishable from a deleted one at this distance. There
                    is no code path that removes them.
                  </p>
                  {lastSuccess.records_orphaned !== null &&
                    lastSuccess.records_orphaned !== orphanLive && (
                      <p className="text-micro leading-[1.5] text-gray-500">
                        The run itself recorded{" "}
                        {lastSuccess.records_orphaned.toLocaleString("en-US")}. The
                        figure above is a live count taken now, and where the two
                        disagree the live one is current.
                      </p>
                    )}
                </>
              )}
            </Panel>

            {/* ── PROVENANCE ──────────────────────────────────────────── */}
            <Panel title="Source & verification" meta={latest ? "last run" : undefined}>
              {latest === null ? (
                <p className="text-note leading-[1.6] text-gray-600">
                  Nothing to show until a run records where it read from.
                </p>
              ) : (
                <>
                  <dl className="grid grid-cols-[150px_1fr] gap-x-4 border border-gray-200">
                    <Row term="Triggered by">
                      {latest.triggered_by === "manual"
                        ? "Manual — local CLI run"
                        : "Scheduled"}
                    </Row>
                    <Row term="Source">
                      <span className="break-all font-mono text-[12px]">
                        {latest.source_url ?? "—"}
                      </span>
                    </Row>
                    <Row term="File size">{fileSizeLabel(latest.source_file_size)}</Row>
                    <Row term="File hash">
                      <span className="break-all font-mono text-[12px]">
                        {latest.source_file_hash
                          ? `${latest.source_file_hash.slice(0, 32)}…`
                          : "—"}
                      </span>
                    </Row>
                    <Row term="Records loaded">{countLabel(latest.records_total)}</Row>
                    <Row term="Inserted">{countLabel(latest.records_inserted)}</Row>
                    <Row term="Updated">{countLabel(latest.records_updated)}</Row>
                    <Row term="Unchanged">{countLabel(latest.records_unchanged)}</Row>
                  </dl>

                  {latest.source_url?.startsWith("file:") && (
                    <p className="mt-4 border-l-[3px] border-l-gold bg-gold-pale px-4 py-3 text-note leading-[1.6] text-gray-700">
                      <strong className="font-semibold text-ink">
                        This run read a local file, not DBPR.
                      </strong>{" "}
                      The extract is published by DBPR at{" "}
                      <span className="break-all font-mono text-[12px]">
                        www2.myfloridalicense.com/sto/file_download/extracts/CONSTRUCTIONLICENSE_1.csv
                      </span>{" "}
                      and refreshed there weekly, but that address sits behind a
                      Cloudflare challenge that refuses automated requests — so
                      the copy on disk was downloaded by a person, and no
                      schedule can currently replace them. Whoever runs the
                      importer is attesting that the file they have is the
                      current one.
                    </p>
                  )}

                  {latest.status === "failed" && latest.error_message && (
                    <div className="mt-4 border-l-[3px] border-status-error bg-status-errorBg px-4 py-3">
                      <p className="mb-1 font-mono text-label font-semibold uppercase tracking-label text-status-error">
                        Error
                      </p>
                      <p className="font-mono text-[12px] leading-[1.55] text-status-error">
                        {latest.error_message}
                      </p>
                      {latest.error_stack && (
                        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-[1.5] text-gray-600">
                          {latest.error_stack}
                        </pre>
                      )}
                    </div>
                  )}
                </>
              )}
            </Panel>
          </div>

          {/* ── REFERENCE COUNT DRIFT ─────────────────────────────────── */}
          <div className="mb-8">
            <DriftPanel report={referenceCounts} />
          </div>

          {/* ── HISTORY ───────────────────────────────────────────────── */}
          <div className="border border-gray-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-6 py-4">
              <h2 className="inline-flex items-center gap-2.5 font-mono text-label font-semibold uppercase tracking-eyebrow text-navy">
                <span aria-hidden="true" className="h-px w-4 bg-gold" />
                Run history
              </h2>
              <p className="font-mono text-micro uppercase tracking-label text-gray-500">
                {totalRuns === 0
                  ? "nothing recorded"
                  : `${runCounts.successful} of ${totalRuns} successful${
                      totalRuns > HISTORY_LIMIT ? ` · showing the latest ${HISTORY_LIMIT}` : ""
                    }`}
              </p>
            </div>

            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <Th>Run</Th>
                  <Th>Started</Th>
                  <Th>Duration</Th>
                  <Th align="right">Records</Th>
                  <Th align="right">Changes</Th>
                  <Th align="right">Orphaned</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {runs.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-5 py-12 text-center text-note leading-[1.6] text-gray-600"
                    >
                      No runs recorded yet — history begins with the next refresh.
                    </td>
                  </tr>
                )}

                {runs.map((run) => {
                  const changes =
                    run.records_inserted === null
                      ? null
                      : run.records_inserted + (run.records_updated ?? 0);
                  return (
                    <tr
                      key={run.id}
                      className={`border-b border-gray-100 last:border-b-0 hover:bg-gray-50 ${
                        run.status === "failed" ? "border-l-[3px] border-l-status-error" : ""
                      }`}
                    >
                      <td className="px-5 py-3.5 align-top font-mono text-[12.5px] text-gray-700">
                        {run.id.slice(0, 8)}
                      </td>
                      {/* A queued row has not started, so its started_at is
                          the moment it was requested and showing it under
                          "Started" would be false. The importer resets
                          started_at when it claims the row, at which point
                          this column becomes true of it. */}
                      <td className="px-5 py-3.5 align-top">
                        {run.status === "queued" ? (
                          <>
                            <span className="whitespace-nowrap font-mono text-label tracking-[0.02em] text-gray-500">
                              Not started
                            </span>
                            {run.queued_at && (
                              <p className="mt-0.5 font-mono text-chip uppercase tracking-label text-gray-500">
                                requested {relativeTime(run.queued_at)}
                              </p>
                            )}
                          </>
                        ) : (
                          <>
                            <time
                              dateTime={run.started_at}
                              title={absoluteTime(run.started_at)}
                              className="whitespace-nowrap font-mono text-label tracking-[0.02em] text-gray-500"
                            >
                              {relativeTime(run.started_at)}
                            </time>
                            <p className="mt-0.5 font-mono text-chip uppercase tracking-label text-gray-500">
                              {run.triggered_by}
                              {run.queued_at && " · queued"}
                            </p>
                          </>
                        )}
                      </td>
                      <td className="px-5 py-3.5 align-top font-mono text-[12.5px] text-gray-700">
                        {runDuration(run) ?? "—"}
                      </td>
                      <td className="px-5 py-3.5 text-right align-top font-mono text-[12.5px] text-gray-700">
                        {countLabel(run.records_total)}
                      </td>
                      <td className="px-5 py-3.5 text-right align-top font-mono text-[12.5px] font-semibold text-navy">
                        {changes === null ? "Not measured" : changes.toLocaleString("en-US")}
                      </td>
                      <td className="px-5 py-3.5 text-right align-top font-mono text-[12.5px] text-gray-700">
                        {countLabel(run.records_orphaned)}
                      </td>
                      <td className="px-5 py-3.5 align-top">
                        <span
                          className={`inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-[11.5px] font-semibold ${SYNC_STATUS_PILL[run.status]}`}
                        >
                          <span
                            aria-hidden="true"
                            className={`h-1.5 w-1.5 rounded-full ${SYNC_STATUS_DOT[run.status]}`}
                          />
                          {SYNC_STATUS_LABEL[run.status]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* THE RUNNER NOTE. Whoever opens this page wondering why there is no
              "run now" button should find the answer here rather than in a
              commit message. */}
          <p className="mt-6 text-note leading-[1.6] text-gray-600">
            <strong className="font-medium text-gray-700">
              Refreshes run locally, not on Vercel.
            </strong>{" "}
            The importer reads a 47.7 MB CSV from disk and holds a fingerprint of
            every existing record in memory to classify the changes; neither fits a
            serverless function’s time or memory budget, and the source file is not
            reachable from one. Run{" "}
            <code className="font-mono text-[12px]">node scripts/import-dbpr.mjs</code>{" "}
            from the repository, then run{" "}
            <code className="font-mono text-[12px]">
              db/migrations/20260805_reference_counts_repair.sql
            </code>{" "}
            — the importer updates contractors and this log, and does not touch the
            reference counts that /counties and /types read.
          </p>
        </div>
      </main>
    </>
  );
}

/**
 * Reference-count drift — "are /counties and /types serving current figures?"
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ONE FAILURE ON THIS PAGE THAT IS INVISIBLE EVERYWHERE ELSE.
 *
 * The public browse pages read pre-computed integers. A DBPR refresh moves
 * every underlying count and updates none of them, and the repair is a SQL file
 * a human runs. Nothing enforced that, nothing reported it, and the symptom is
 * a page that looks perfectly normal while being a week wrong — which is how
 * reference_license_types read 0 for all 29 rows for five weeks.
 *
 * So it is stated as a first-class outcome next to the run history, not folded
 * into a stat card. A number that is quietly wrong deserves more than a badge.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function DriftPanel({ report }: { report: ReferenceCountReport }) {
  if (report.error || !report.counties || !report.types) {
    return (
      <Panel title="Reference counts" meta="not measurable">
        <p className="text-note leading-[1.6] text-gray-600">
          The check could not run, so whether /counties and /types are current is
          unknown — which is not the same as fine. Run{" "}
          <code className="font-mono text-[12px]">{VERIFY_COMMAND}</code> to
          measure it directly.
        </p>
      </Panel>
    );
  }

  const { counties, types } = report;

  return (
    <Panel
      title="Reference counts"
      meta={report.ok ? "in agreement" : "repair needed"}
    >
      {!report.ok && (
        <p className="mb-5 border-l-[3px] border-status-error bg-status-errorBg px-4 py-3 text-note leading-[1.6] text-status-error">
          <strong className="font-semibold">
            /counties and /types are serving stale figures.
          </strong>{" "}
          The stored counts no longer match the contractors table, which is what
          a DBPR refresh does to them. Run{" "}
          <code className="font-mono text-[12px]">{REPAIR_MIGRATION}</code> in
          the SQL editor to bring them back into line.
        </p>
      )}

      <dl className="grid grid-cols-[150px_1fr] gap-x-4 border border-gray-200">
        <DriftRow
          term="Counties"
          check={counties}
          note={`${counties.rows} rows · Florida-addressed only`}
        />
        <DriftRow
          term="License types"
          check={types}
          note={`${types.rows} rows · all states`}
        />
      </dl>

      <p className="mt-4 text-micro leading-[1.5] text-gray-500">
        {/* The limitation is on the page, not only in lib/reference-counts.ts.
            An operator who reads "in agreement" as "verified correct" and skips
            the script has been misled by this panel, so it says what it is. */}
        This compares <strong className="font-medium text-gray-600">totals</strong>,
        which is cheap enough to run on every page load but would not catch two
        per-row errors that cancel out.{" "}
        <code className="font-mono">{VERIFY_COMMAND}</code> compares all 806 rows
        individually and is the exact answer. Cities are checked only there — the
        equivalent query here needs a 710-value filter.
      </p>
    </Panel>
  );
}

function DriftRow({
  term,
  check,
  note,
}: {
  term: string;
  check: { stored: number; live: number; drifted: boolean };
  note: string;
}) {
  return (
    <div className="col-span-2 grid grid-cols-[150px_1fr] gap-4 border-b border-gray-100 px-4 py-3 last:border-b-0 max-[520px]:grid-cols-1 max-[520px]:gap-1">
      <dt className="font-mono text-label font-medium uppercase tracking-[0.06em] text-gray-500">
        {term}
      </dt>
      <dd className="text-note leading-[1.55] text-ink">
        <span className="flex flex-wrap items-baseline gap-2">
          <span
            className={`inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-[11.5px] font-semibold ${
              check.drifted
                ? "bg-status-errorBg text-status-error"
                : "bg-status-successBg text-status-success"
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${
                check.drifted ? "bg-status-error" : "bg-status-success"
              }`}
            />
            {check.drifted ? "Drifted" : "In agreement"}
          </span>
          <span className="font-mono text-[12.5px] text-gray-700">
            stored {check.stored.toLocaleString("en-US")} · live{" "}
            {check.live.toLocaleString("en-US")}
            {check.drifted && (
              <span className="text-status-error">
                {" "}
                · {check.live > check.stored ? "+" : ""}
                {(check.live - check.stored).toLocaleString("en-US")}
              </span>
            )}
          </span>
        </span>
        <span className="mt-1 block font-mono text-chip uppercase tracking-label text-gray-500">
          {note}
        </span>
      </dd>
    </div>
  );
}

/**
 * Trigger refresh — the queue, and the honesty about what a queue is.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TWO STATES, AND THE BUTTON IS ABSENT IN THE SECOND RATHER THAN DISABLED.
 *
 * A `disabled` button is a dead control that gives no reason; the same lesson
 * AdminHeader records about nav links pointing at 404s — hiding beats
 * disabling. When something is outstanding, its own card takes the space and
 * says what is waiting and what to do about it, which is strictly more
 * information than a greyed-out button.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The command is rendered as selectable text rather than described in prose,
 * because the operator's next action is to paste it into a terminal. It comes
 * from IMPORTER_COMMAND so the page, the runner note at the foot of this file
 * and lib/sync-runs.ts cannot drift into naming different scripts.
 */
function TriggerSection({ active }: { active: SyncRun | null }) {
  if (active) {
    const isQueued = active.status === "queued";
    const waited = queueWait(active);

    return (
      <section
        className={`border bg-white ${
          isQueued ? "border-gray-300" : "border-status-warnEdge"
        }`}
      >
        <div
          className={`flex flex-wrap items-start justify-between gap-4 border-b px-6 py-4 ${
            isQueued
              ? "border-gray-200 bg-gray-50"
              : "border-status-warnEdge bg-status-warnBg"
          }`}
        >
          <h2 className="inline-flex items-center gap-2.5 font-mono text-label font-semibold uppercase tracking-eyebrow text-navy">
            <span aria-hidden="true" className="h-px w-4 bg-gold" />
            {isQueued ? "Refresh queued" : "Refresh running"}
          </h2>
          <span
            className={`inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-[11.5px] font-semibold ${SYNC_STATUS_PILL[active.status]}`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${SYNC_STATUS_DOT[active.status]}`}
            />
            {SYNC_STATUS_LABEL[active.status]}
          </span>
        </div>

        <div className="px-6 py-5">
          {isQueued ? (
            <>
              <p className="mb-4 text-note leading-[1.6] text-gray-700">
                Requested{" "}
                {active.queued_at ? relativeTime(active.queued_at) : "at an unrecorded time"}
                {waited && <> · waiting {waited}</>}. Nothing runs on its own —
                a refresh happens when someone with the repository checked out
                runs the importer, and it will pick this request up and complete
                it.
              </p>
              <p className="mb-2 font-mono text-label font-medium uppercase tracking-label text-gray-500">
                Run this
              </p>
              <p className="mb-4 select-all break-all border border-gray-200 bg-gray-50 px-4 py-3 font-mono text-[13px] text-ink">
                {IMPORTER_COMMAND}
              </p>
              <p className="text-micro leading-[1.5] text-gray-500">
                Then run{" "}
                <code className="font-mono">
                  db/migrations/20260805_reference_counts_repair.sql
                </code>
                . Pressing the button again while this is waiting adds nothing —
                the request is already recorded.
              </p>
            </>
          ) : (
            <p className="text-note leading-[1.6] text-gray-700">
              A run has been open since {absoluteTime(active.started_at)}. Either
              it is still working, or the process died before it could record an
              outcome — a run that crashes leaves its row exactly like this. No
              new refresh can be queued until it closes, because two importers
              writing the same 266,305 rows at once is not a state worth
              producing.
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="border border-gray-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-6 py-4">
        <h2 className="inline-flex items-center gap-2.5 font-mono text-label font-semibold uppercase tracking-eyebrow text-navy">
          <span aria-hidden="true" className="h-px w-4 bg-gold" />
          Trigger refresh
        </h2>
        <p className="font-mono text-micro uppercase tracking-label text-gray-500">
          nothing queued
        </p>
      </header>

      <div className="flex flex-wrap items-start justify-between gap-6 px-6 py-5">
        <div className="min-w-[280px] max-w-[620px] flex-1">
          <p className="mb-3 text-note leading-[1.6] text-gray-700">
            <strong className="font-semibold text-ink">
              This queues a refresh; it does not run one.
            </strong>{" "}
            The importer reads a 47.7 MB file from disk and holds a fingerprint
            of every existing record in memory, which no serverless function can
            do — and the source file is not reachable from one. Pressing this
            records the request, with your name against it, for whoever runs the
            script next.
          </p>
          <p className="text-micro leading-[1.5] text-gray-500">
            The queued request appears here and in the history below until the
            importer claims it.
          </p>
        </div>

        {/* A plain form POST to a Server Action. No client JS on this page, and
            no confirm dialog — queueing is reversible by ignoring it, and the
            guard already prevents a second one. */}
        <form action={queueRefresh}>
          <button
            type="submit"
            className={`whitespace-nowrap bg-navy px-5 py-3 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-paper transition-colors hover:bg-navy-deep ${FOCUS_RING_PAPER}`}
          >
            Trigger refresh
          </button>
        </form>
      </div>
    </section>
  );
}

/** "Jim Blackburn" -> "JB". Same helper as the other admin pages. */
function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0]}${parts[parts.length - 1][0]}`;
}

/**
 * Counted with head:true rather than over the twelve fetched rows — the history
 * table is capped, so counting what is on screen would freeze the success rate
 * at "12 of 12" forever.
 */
async function loadRunCounts(db: ReturnType<typeof createClient>) {
  const runCount = () => db.from("sync_runs").select("id", { count: "exact", head: true });
  const [total, successful] = await Promise.all([
    runCount(),
    runCount().eq("status", "success"),
  ]);
  return { total: total.count ?? 0, successful: successful.count ?? 0 };
}

/** The two badges AdminHeader renders. Same queries as /admin/leads. */
async function loadHeaderCounts(db: ReturnType<typeof createClient>) {
  const [pendingClaims, newLeads] = await Promise.all([
    db.from("claims").select("id", { count: "exact", head: true }).eq("status", "pending"),
    db.from("leads").select("id", { count: "exact", head: true }).eq("status", "new"),
  ]);
  return { pendingClaims: pendingClaims.count ?? 0, newLeads: newLeads.count ?? 0 };
}

/**
 * Only ever handed a finished run — see where `latest` is derived. The queued
 * and running cases live in TriggerSection, which is why there is no branch for
 * them here.
 */
function BannerDetail({ run }: { run: SyncRun }) {
  if (run.status === "failed") {
    return (
      <>
        Nothing was rolled back: rows upserted before the failure are still in the
        table, so the registry is in a partial state until a run completes. The
        importer is safe to re-run — every write is an upsert keyed on{" "}
        <code className="font-mono">dbpr_sync_key</code>.
      </>
    );
  }

  return (
    <>
      {countLabel(run.records_total)} records processed
      {run.records_inserted !== null ? (
        <>
          {" "}
          — {run.records_inserted.toLocaleString("en-US")} added,{" "}
          {(run.records_updated ?? 0).toLocaleString("en-US")} updated,{" "}
          {(run.records_unchanged ?? 0).toLocaleString("en-US")} unchanged.
        </>
      ) : (
        <>. Change counts were not measured on this run.</>
      )}{" "}
      No cadence is scheduled — the next refresh happens when someone runs it.
    </>
  );
}

function Panel({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-gray-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-6 py-4">
        <h2 className="inline-flex items-center gap-2.5 font-mono text-label font-semibold uppercase tracking-eyebrow text-navy">
          <span aria-hidden="true" className="h-px w-4 bg-gold" />
          {title}
        </h2>
        {meta && (
          <p className="font-mono text-micro uppercase tracking-label text-gray-500">
            {meta}
          </p>
        )}
      </header>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={`px-5 py-3 font-mono text-label font-semibold uppercase tracking-label text-gray-500 ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="col-span-2 grid grid-cols-[150px_1fr] gap-4 border-b border-gray-100 px-4 py-2.5 last:border-b-0 max-[520px]:grid-cols-1 max-[520px]:gap-1">
      <dt className="font-mono text-label font-medium uppercase tracking-[0.06em] text-gray-500">
        {term}
      </dt>
      <dd className="text-note leading-[1.55] text-ink">{children}</dd>
    </div>
  );
}
