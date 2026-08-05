"use server";

import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth";
import { ACTIVE_SYNC_STATUSES } from "@/lib/sync-runs";
import { createClient } from "@/lib/supabase/server";

/**
 * The DBPR refresh queue — one write, and it is a request rather than an action.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THIS FILE MAY EXPORT ONLY ASYNC FUNCTIONS. NOTHING ELSE. EVER.
 * "use server" makes every export a server reference; tsc, lint and build all
 * pass on a violation and the runtime does not. See app/manage/[slug]/actions.ts.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BUTTON DOES NOT START A REFRESH, AND THE ROW IT WRITES SAYS SO.
 *
 * A refresh is scripts/import-dbpr.mjs: a 47.7MB CSV read from disk and a
 * fingerprint of all 266,305 existing records held in memory. That does not run
 * in a Vercel function, and the source file is not reachable from one. So this
 * records status='queued' with the requester's identity, and the page tells the
 * operator the exact command to run.
 *
 * The alternative — a button that spins and then claims success — would be the
 * single most damaging lie this admin surface could tell, because the whole
 * point of /admin/sync is to answer "is our data current?" honestly.
 *
 * When task 158's source question is answered this file may not change at all:
 * a real runner consumes the same queue. See
 * db/migrations/20260805_sync_runs_queued.sql.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WRITTEN WITH THE ADMIN'S OWN SESSION, NOT THE SERVICE ROLE — the same rule as
 * app/admin/leads/actions.ts. "admin only sync_runs" (FOR ALL, USING
 * is_admin(), WITH CHECK is_admin()) refuses the insert at the database if the
 * caller is not an admin, so requireAdmin() below is the first of two checks
 * rather than the only one. scripts/verify-sync-queue.mjs proves both ends.
 */

/** Codes the page maps to sentences. Never a raw Postgres message. */
type QueueError = "active" | "failed" | "constraint";

function back(error?: QueueError): never {
  redirect(error ? `/admin/sync?e=${error}` : "/admin/sync");
}

/**
 * Queue a DBPR refresh.
 *
 * Takes no FormData. There is nothing to configure: the importer reads one
 * file from one path, and any option worth having (--no-diff, --limit) is a
 * decision made by the person at the terminal, not by whoever pressed a button
 * three days earlier.
 */
export async function queueRefresh(): Promise<void> {
  const user = await requireAdmin();
  const db = createClient();

  /**
   * THE GUARD, RE-CHECKED HERE RATHER THAN TRUSTED FROM THE PAGE.
   *
   * /admin/sync hides the button when a run is outstanding, but that HTML was
   * rendered at some point in the past — possibly before the run it is deciding
   * about existed. A stale tab left open overnight would otherwise queue a
   * second refresh on top of one already waiting.
   *
   * Not race-proof, deliberately, and the migration records why: the partial
   * unique index that would make it so turns a crashed run into a permanent
   * deadlock. Losing this race costs one redundant queued row, which the
   * importer ignores (it claims the oldest) and the page displays.
   */
  const { data: active, error: readError } = await db
    .from("sync_runs")
    .select("id, status")
    .in("status", ACTIVE_SYNC_STATUSES)
    .limit(1);

  if (readError) {
    console.error("[admin/sync] could not check for an active run", readError.message);
    back("failed");
  }
  if (active && active.length > 0) back("active");

  const { error } = await db.from("sync_runs").insert({
    status: "queued",
    queued_at: new Date().toISOString(),
    triggered_by: "manual",
    /**
     * The one column this project has never written. It exists so that a
     * refresh request carries a name — which matters precisely because the
     * person who queues it and the person who runs it are not the same person.
     */
    triggered_by_user_id: user.id,
    /**
     * NULL, NOT THE COLUMN DEFAULT. A queued row has not read anything yet, so
     * it has no source to report; the importer records the file it actually
     * opened, when it opens it.
     *
     * The default is doubly wrong to stamp here. It asserts a fetch that has
     * not happened, and its host (the bare myfloridalicense.com) serves no
     * files at all — it redirects to www2. See scripts/import-dbpr.mjs and
     * docs/dbpr-source.md.
     */
    source_url: null,
  });

  if (error) {
    console.error("[admin/sync] queue failed", { code: error.code, message: error.message });
    /**
     * 23514 is the status CHECK. It means the code shipped ahead of
     * db/migrations/20260805_sync_runs_queued.sql, which is the one deploy-order
     * mistake this feature can make — so it gets its own message telling the
     * operator what to run, rather than the generic "something went wrong".
     */
    back(error.code === "23514" ? "constraint" : "failed");
  }

  back();
}
