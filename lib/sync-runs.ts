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

/** sync_runs.status — the CHECK constraint in 08_database/01_schema.sql. */
export type SyncRunStatus = "running" | "success" | "failed";

/** sync_runs.triggered_by — same CHECK. 'manual' is every row today. */
export type SyncRunTrigger = "cron" | "manual";

export interface SyncRun {
  id: string;
  started_at: string;
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

/** Every column. The table is 16 columns wide and the page uses all of them. */
export const SYNC_RUN_COLUMNS =
  "id, started_at, completed_at, status, records_total, records_inserted, " +
  "records_updated, records_unchanged, records_orphaned, error_message, " +
  "error_stack, triggered_by, triggered_by_user_id, source_url, " +
  "source_file_size, source_file_hash";

export const SYNC_STATUS_LABEL: Record<SyncRunStatus, string> = {
  running: "Running",
  success: "Success",
  failed: "Failed",
};

/**
 * Chip colours. `running` borrows StatsStrip's amber rather than a fourth
 * palette entry — an unfinished run is "unusual, not broken", which is exactly
 * the distinction StatusBanner's amber carries.
 */
export const SYNC_STATUS_PILL: Record<SyncRunStatus, string> = {
  running: "bg-status-warnBg text-status-warn",
  success: "bg-status-successBg text-status-success",
  failed: "bg-status-errorBg text-status-error",
};

export const SYNC_STATUS_DOT: Record<SyncRunStatus, string> = {
  running: "bg-status-warn",
  success: "bg-status-success",
  failed: "bg-status-error",
};

/**
 * "14m 22s" / "48s". Null when the run never closed — an open-ended run has no
 * duration, and rendering elapsed-so-far would make a crashed run from March
 * look like it has been working for five months.
 */
export function runDuration(run: Pick<SyncRun, "started_at" | "completed_at">): string | null {
  if (!run.completed_at) return null;
  const ms = new Date(run.completed_at).getTime() - new Date(run.started_at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
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
