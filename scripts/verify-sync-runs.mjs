/**
 * sync_runs instrumentation + orphan detection — verification.
 *
 *   node scripts/verify-sync-runs.mjs
 *
 * Writes two throwaway sync_runs rows, exercises the exact lifecycle
 * scripts/import-dbpr.mjs uses, and deletes them again. Touches no other table
 * and never writes to contractors. Never prints credential values.
 *
 * WHY IT WRITES AT ALL. The importer's audit row is the one part of task 157
 * that cannot be checked by reading: the columns exist, but whether an insert
 * satisfies every NOT NULL and CHECK on the table is a question only an insert
 * answers. The first attempt at a full import failed on a constraint 57,000
 * rows in; discovering the same class of problem after a 40-minute run is the
 * outcome this script exists to prevent.
 *
 * CLEANUP IS UNCONDITIONAL — the finally block runs even when an assertion
 * throws, so a failed verification does not leave fake history on /admin/sync.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !serviceKey || !anonKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;
const created = [];

function check(label, ok, detail = "") {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
}

try {
  // ==========================================================
  console.log("\n1 — the table, before anything");
  // ==========================================================
  const before = await db.from("sync_runs").select("id", { count: "exact", head: true });
  check("sync_runs is reachable with the service role", !before.error, before.error?.message);
  console.log(`        ${before.count ?? 0} row(s) currently recorded`);

  // ==========================================================
  console.log("\n2 — RLS: anon must not read the sync log");
  // ==========================================================
  //
  // A COUNT OF 0 ON AN EMPTY TABLE PROVES NOTHING, so this asserts on the
  // shape of the refusal rather than on emptiness: with rows present, anon must
  // still come back with none. The test row from section 3 exists by the time
  // this matters, and section 6 re-runs the check with data in place.
  const anonEarly = await anon.from("sync_runs").select("id");
  check(
    "anon reads no rows through RLS",
    (anonEarly.data ?? []).length === 0,
    anonEarly.error ? anonEarly.error.message : `saw ${anonEarly.data?.length} row(s)`,
  );

  // ==========================================================
  console.log("\n3 — open a run, exactly as the importer does");
  // ==========================================================
  const opened = await db
    .from("sync_runs")
    .insert({
      status: "running",
      triggered_by: "manual",
      source_url: "file:VERIFY/scripts/verify-sync-runs.mjs",
      source_file_size: 47_700_000,
      source_file_hash: "0".repeat(64),
    })
    .select("id, started_at, status, completed_at")
    .single();

  check("insert succeeds against every NOT NULL and CHECK", !opened.error, opened.error?.message);
  if (opened.error) throw new Error("cannot continue without a row");
  created.push(opened.data.id);

  check("status defaults through as 'running'", opened.data.status === "running");
  check("started_at is set by the database", Boolean(opened.data.started_at));
  check("completed_at is null on an open run", opened.data.completed_at === null);

  // ==========================================================
  console.log("\n4 — close it 'success' with the census counts");
  // ==========================================================
  const counts = {
    records_total: 266_305,
    records_inserted: 12,
    records_updated: 340,
    records_unchanged: 265_953,
    records_orphaned: 7,
  };
  const closed = await db
    .from("sync_runs")
    .update({ status: "success", completed_at: new Date().toISOString(), ...counts })
    .eq("id", opened.data.id)
    .select("status, completed_at, records_total, records_inserted, records_updated, records_unchanged, records_orphaned")
    .single();

  check("update succeeds", !closed.error, closed.error?.message);
  check("status is 'success'", closed.data?.status === "success");
  check("completed_at is stored", Boolean(closed.data?.completed_at));
  for (const [col, want] of Object.entries(counts)) {
    check(`${col} round-trips as ${want.toLocaleString("en-US")}`, closed.data?.[col] === want);
  }

  // The three counts must reconcile with the total, or the census is lying.
  const censusSum =
    (closed.data?.records_inserted ?? 0) +
    (closed.data?.records_updated ?? 0) +
    (closed.data?.records_unchanged ?? 0);
  check(
    "inserted + updated + unchanged === records_total",
    censusSum === closed.data?.records_total,
    `${censusSum} vs ${closed.data?.records_total}`,
  );

  // ==========================================================
  console.log("\n5 — a failed run records the error, not just the failure");
  // ==========================================================
  const failedRun = await db
    .from("sync_runs")
    .insert({ status: "running", triggered_by: "manual", source_url: "file:VERIFY" })
    .select("id")
    .single();
  check("second row opens", !failedRun.error, failedRun.error?.message);
  if (!failedRun.error) {
    created.push(failedRun.data.id);
    const boom = new Error("batch at offset 57000 failed: ON CONFLICT DO UPDATE command cannot affect row a second time");
    const recorded = await db
      .from("sync_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: boom.message.slice(0, 2000),
        error_stack: String(boom.stack ?? "").slice(0, 20000),
      })
      .eq("id", failedRun.data.id)
      .select("status, error_message, error_stack")
      .single();

    check("status is 'failed'", recorded.data?.status === "failed");
    check("error_message is stored verbatim", recorded.data?.error_message === boom.message);
    check("error_stack is stored", (recorded.data?.error_stack ?? "").includes("verify-sync-runs"));
  }

  // ==========================================================
  console.log("\n6 — RLS again, now that rows exist");
  // ==========================================================
  const anonLate = await anon.from("sync_runs").select("id, error_message");
  check(
    "anon still reads no rows, with 2 present",
    (anonLate.data ?? []).length === 0,
    anonLate.error ? anonLate.error.message : `saw ${anonLate.data?.length} row(s)`,
  );
  const anonWrite = await anon
    .from("sync_runs")
    .insert({ status: "running", triggered_by: "manual" })
    .select("id");
  check(
    "anon cannot insert a run",
    Boolean(anonWrite.error) || (anonWrite.data ?? []).length === 0,
    "anon INSERT was accepted",
  );
  if (!anonWrite.error && anonWrite.data?.[0]?.id) created.push(anonWrite.data[0].id);

  // ==========================================================
  console.log("\n7 — the orphan query");
  // ==========================================================
  //
  // Orphan = last_dbpr_sync_at older than the newest successful run's
  // started_at. The success row from section 4 was opened seconds ago, so every
  // contractor loaded on 2026-07-29 is older than it and the count must equal
  // the whole table. That is a positive test with a known answer, rather than a
  // zero that would pass whether or not the filter works.
  const total = await db.from("contractors").select("dbpr_sync_key", { count: "exact", head: true });
  const orphans = await db
    .from("contractors")
    .select("dbpr_sync_key", { count: "exact", head: true })
    .lt("last_dbpr_sync_at", opened.data.started_at);
  check(
    "every existing row predates a run opened just now",
    orphans.count === total.count,
    `${orphans.count} of ${total.count}`,
  );
  console.log(`        ${(total.count ?? 0).toLocaleString("en-US")} contractor rows, all stamped before this test run`);

  // The inverse: nothing can be newer than a run that has not stamped anything.
  const future = await db
    .from("contractors")
    .select("dbpr_sync_key", { count: "exact", head: true })
    .gte("last_dbpr_sync_at", opened.data.started_at);
  check("no row is stamped at or after that run", future.count === 0, `${future.count} row(s)`);

  // ==========================================================
  console.log("\n8 — 'latest successful run' skips failed and running rows");
  // ==========================================================
  const latestSuccess = await db
    .from("sync_runs")
    .select("id, status")
    .eq("status", "success")
    .order("started_at", { ascending: false })
    .limit(1);
  check(
    "the success row is the one selected, not the newer failed one",
    latestSuccess.data?.[0]?.id === opened.data.id,
    `got ${latestSuccess.data?.[0]?.id ?? "nothing"}`,
  );
} finally {
  // ==========================================================
  console.log("\ncleanup…");
  // ==========================================================
  for (const id of created) {
    const { error } = await db.from("sync_runs").delete().eq("id", id);
    console.log(`  ${error ? `FAILED to delete ${id}: ${error.message}` : `deleted ${id}`}`);
  }
  const after = await db.from("sync_runs").select("id", { count: "exact", head: true });
  const clean = (after.count ?? -1) === 0;
  console.log(
    clean
      ? "  sync_runs is empty again — /admin/sync shows its real empty state"
      : `  ⚠ sync_runs still holds ${after.count} row(s); check they are real runs`,
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
