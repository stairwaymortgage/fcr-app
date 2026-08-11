/**
 * sync_runs — the DBPR refresh audit log, and the orphan question.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE WRITER, ONE READER. scripts/import-dbpr.mjs opens and closes every row;
 * /admin/sync renders them. Nothing else touches this table, and nothing in the
 * request path writes to it — a refresh is a local run, not a Vercel function.
 *
 * The table existed from day one and held ZERO rows until task 157, because the
 * initial import predated the instrumentation. That is why the module below
 * takes such care with the empty case: "no runs recorded" is the state this
 * page ships in, and it must not be dressed up as "no problems".
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * sync_runs.status.
 *
 * 'queued' was added by db/migrations/20260805_sync_runs_queued.sql and is the
 * only one of the four that no automated process produces: it means a human
 * pressed "Trigger refresh" on /admin/sync and is waiting for somebody with the
 * repository checked out to run the importer. See that migration for why a
 * button on a serverless page cannot honestly do anything more.
 */
export type SyncRunStatus = "queued" | "running" | "success" | "failed";

/** sync_runs.triggered_by — same CHECK. 'manual' is every row today. */
export type SyncRunTrigger = "cron" | "manual";

/**
 * Statuses that mean "a refresh is outstanding".
 *
 * The queue guard and the importer's claim both key off this set, so they
 * cannot drift apart into disagreeing about what "already in progress" means.
 */
export const ACTIVE_SYNC_STATUSES: readonly SyncRunStatus[] = ["queued", "running"];

/**
 * A 'running' row older than this is presumed dead and closed as 'failed'.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS: A KILLED IMPORTER BLOCKS THE QUEUE FOREVER.
 *
 * sync_runs row 35398367 sat 'running' from 2026-08-10 14:05 UTC with a null
 * completed_at because the process that opened it was killed and never reached
 * its own catch block. ACTIVE_SYNC_STATUSES includes 'running', so /admin/sync
 * refused every subsequent queue request — the button reported "a refresh is
 * already queued or running" about a process that had not existed for hours,
 * and nothing in the product could clear it. It took a hand-written UPDATE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 3 HOURS IS ~5x THE LONGEST RUN EVER RECORDED (c695fa18, 2,205s / 37 min on
 * 2026-08-10, which itself was ~50% slower than the 2026-08-06 run because of
 * the three browse indexes added between them). Wide enough that a slow-but-
 * alive import is never stomped mid-flight; narrow enough that a dead one does
 * not outlive the working day.
 *
 * ⚠ 'queued' IS NEVER SWEPT, AT ANY AGE. A queued row waiting days is the
 * feature working, not staleness: run 2f1ab744 was requested on a Wednesday and
 * legitimately claimed the following Monday, 343,455s later. Ageing out queued
 * rows would silently delete refresh requests.
 *
 * ⚠ DUPLICATED IN scripts/import-dbpr.mjs AS STALE_RUN_HOURS. That script is
 * plain .mjs and cannot import this module. Same seam as ZZTEST /
 * TEST_ROW_LIKE: if you change this number, grep for STALE_RUN_HOURS and change
 * both. The two sweeps are otherwise identical by design.
 */
export const STALE_RUN_HOURS = 3;

/**
 * How old the newest SUCCESSFUL run may get before the staleness alarm fires.
 *
 * DBPR publishes weekly, so 7 would fire on the normal cadence every time a run
 * slipped by an afternoon. 8 gives a full day of slack while still catching a
 * missed week on the next daily check.
 *
 * ⚠ MEASURED AGAINST THE NEWEST SUCCESS, NOT THE NEWEST ROW — so a failed
 * import does not reset the clock, and a week of failures still trips the alarm
 * on schedule. That is the property that makes one threshold cover both "nobody
 * ran it" and "it ran and died", which is why there is no second check for
 * failures. See app/api/cron/check-sync-staleness/route.ts.
 */
export const SYNC_STALE_AFTER_DAYS = 8;

export interface SyncRun {
  id: string;
  started_at: string;
  /** When the refresh was REQUESTED. Null when the importer was run directly. */
  queued_at: string | null;
  completed_at: string | null;
  status: SyncRunStatus;
  records_total: number | null;
  records_inserted: number | null;
  records_updated: number | null;
  records_unchanged: number | null;
  records_orphaned: number | null;
  error_message: string | null;
  error_stack: string | null;
  triggered_by: SyncRunTrigger;
  triggered_by_user_id: string | null;
  source_url: string | null;
  source_file_size: number | null;
  source_file_hash: string | null;
}

/** Every column. The table is 17 columns wide and the page uses all of them. */
export const SYNC_RUN_COLUMNS =
  "id, started_at, queued_at, completed_at, status, records_total, " +
  "records_inserted, records_updated, records_unchanged, records_orphaned, " +
  "error_message, error_stack, triggered_by, triggered_by_user_id, source_url, " +
  "source_file_size, source_file_hash";

export const SYNC_STATUS_LABEL: Record<SyncRunStatus, string> = {
  queued: "Queued",
  running: "Running",
  success: "Success",
  failed: "Failed",
};

/**
 * Chip colours.
 *
 * `running` borrows StatsStrip's amber rather than a fourth palette entry — an
 * unfinished run is "unusual, not broken", which is exactly the distinction
 * StatusBanner's amber carries.
 *
 * `queued` is deliberately NEUTRAL GREY, not amber. A queued run is the system
 * working as designed: somebody asked for a refresh and it is waiting to be
 * run. Colouring it as a warning would make the normal state of this workflow
 * look like a fault, and would train the operator to ignore the colour that
 * marks a genuinely stuck run.
 */
export const SYNC_STATUS_PILL: Record<SyncRunStatus, string> = {
  queued: "bg-gray-100 text-gray-700",
  running: "bg-status-warnBg text-status-warn",
  success: "bg-status-successBg text-status-success",
  failed: "bg-status-errorBg text-status-error",
};

export const SYNC_STATUS_DOT: Record<SyncRunStatus, string> = {
  queued: "bg-gray-400",
  running: "bg-status-warn",
  success: "bg-status-success",
  failed: "bg-status-error",
};

/** The exact command an operator has to run. One definition, three renderers. */
export const IMPORTER_COMMAND = "node scripts/import-dbpr.mjs";

/**
 * "14m 22s" / "48s". Null when the run never closed — an open-ended run has no
 * duration, and rendering elapsed-so-far would make a crashed run from March
 * look like it has been working for five months.
 */
export function runDuration(run: Pick<SyncRun, "started_at" | "completed_at">): string | null {
  if (!run.completed_at) return null;
  return elapsed(run.started_at, run.completed_at);
}

/**
 * How long a queued request waited before anyone ran it.
 *
 * Null on a run that was never queued — the importer was run directly, which is
 * every row written before the queue existed. Measured to started_at, which the
 * importer RESETS when it claims the row precisely so that this and
 * runDuration() measure two different things rather than overlapping.
 */
export function queueWait(
  run: Pick<SyncRun, "queued_at" | "started_at" | "status">,
  now: Date = new Date(),
): string | null {
  if (!run.queued_at) return null;
  // Still waiting: measure to now, because the wait has not finished.
  const end = run.status === "queued" ? now.toISOString() : run.started_at;
  return elapsed(run.queued_at, end);
}

/** "14m 22s" / "48s" / "3h 20m" between two timestamps. Null if incoherent. */
function elapsed(fromIso: string, toIso: string): string | null {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Whole days between a timestamp and now. Floor, so "today" reads 0. */
export function daysSince(iso: string, now: Date = new Date()): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
}

/** "47.7 MB". Decimal MB, matching what an operator sees in a file manager. */
export function fileSizeLabel(bytes: number | null): string {
  if (bytes === null) return "—";
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

/**
 * A count column that may legitimately be null.
 *
 * NULL AND ZERO ARE DIFFERENT CLAIMS AND MUST NOT RENDER THE SAME. Null means
 * the run did not measure this — an import run with --no-diff, or any row
 * written before the census existed. Zero means it measured and found none.
 * Collapsing them with `?? 0` would turn "we did not look" into "there were no
 * orphans", which is the exact reassurance this page must never give falsely.
 */
export function countLabel(n: number | null): string {
  return n === null ? "Not measured" : n.toLocaleString("en-US");
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ORPHANS: RECORDS THE REGISTRY STILL HAS AND DBPR NO LONGER PUBLISHES.
 *
 * A contractor row is orphaned when its last_dbpr_sync_at predates the newest
 * SUCCESSFUL run. The importer stamps every row it finds in the extract, so a
 * row left behind is one the extract stopped carrying — a licence that lapsed,
 * was revoked, or was withdrawn.
 *
 * ⚠ NEVER DELETED. contractors.claimed_by_user_id is the parent of a claim, and
 * claims carry the identity evidence a person submitted to prove they own a
 * business. Deleting an orphan would cascade that away — destroying the audit
 * record of a decision, not just a directory listing. A licence disappearing
 * from a weekly public extract is also not proof it no longer exists; DBPR
 * omits delinquent and void records from the public export entirely, so a
 * legitimately-suspended contractor looks identical to a deleted one from here.
 *
 * So this counts. It does not clean up, and there is no code path that does.
 *
 * Measured off started_at rather than completed_at: every stamp the run wrote
 * lands after it began, so started_at is the boundary. completed_at would
 * classify rows written during a long run as orphans of that same run.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function orphanCutoff(run: Pick<SyncRun, "started_at">): string {
  return run.started_at;
}
