/**
 * Refresh queue lifecycle — verification.
 *
 *   npx next build && npx next start -p 3111
 *   node scripts/verify-sync-queue.mjs http://localhost:3111
 *
 * Drives the whole loop: an admin queues through the real Server Action over
 * HTTP, the request appears on the page, the importer's claim logic takes it,
 * and it completes. Then the negative cases — anon and a signed-in non-admin
 * must not be able to queue, and a second queue must be refused while one is
 * outstanding.
 *
 * Creates two throwaway users and its own sync_runs rows, and deletes all of
 * them in a finally block so a failed assertion cannot leave fake history on
 * /admin/sync. Never prints credential values.
 *
 * ⚠ REQUIRES db/migrations/20260805_sync_runs_queued.sql. Without it the status
 * CHECK rejects 'queued' and section 1 fails with 23514 — which the script
 * reports as exactly that rather than as a mystery.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const BASE = process.argv[2] ?? "http://localhost:3111";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const projectRef = new URL(url).hostname.split(".")[0];
const COOKIE_BASE = `sb-${projectRef}-auth-token`;
const MAX_CHUNK = 3180;

let passed = 0;
let failed = 0;
function check(label, ok, detail = "") {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
}

function sessionCookie(session) {
  const value = "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  if (value.length <= MAX_CHUNK) return `${COOKIE_BASE}=${value}`;
  const parts = [];
  for (let i = 0; i < value.length; i += MAX_CHUNK) {
    parts.push(`${COOKIE_BASE}.${parts.length}=${value.slice(i, i + MAX_CHUNK)}`);
  }
  return parts.join("; ");
}

/**
 * Press the button the way a browser with NO JAVASCRIPT does.
 *
 * ⚠ THERE ARE TWO WAYS TO INVOKE A SERVER ACTION AND THEY ARE NOT
 * INTERCHANGEABLE. The client-side runtime POSTs with a `Next-Action` header;
 * progressive enhancement renders
 *
 *     <form action="" encType="multipart/form-data" method="POST">
 *       <input type="hidden" name="$ACTION_ID_<hash>" …>
 *
 * and POSTs that field as ordinary multipart form data. The first version of
 * this helper sent the hash as a `Next-Action` header with an empty body,
 * which Next ignored — every assertion downstream failed while the helper
 * itself reported success, because "the request did not 500" is not the same
 * as "the action ran".
 *
 * The no-JS path is also the one that matters: /admin/sync ships no client
 * JavaScript, so this IS how the button works in production.
 *
 * The field name is read out of the rendered HTML rather than hard-coded — the
 * hash is a build artefact and changes whenever the action's module does. That
 * also makes this break loudly if the form stops being a plain POST form,
 * rather than silently testing nothing.
 */
/** The action's form field id, or null when the page renders no button. */
async function readActionField(cookie) {
  const page = await fetch(`${BASE}/admin/sync`, { headers: { cookie } });
  if (page.status !== 200) return null;
  const html = await page.text();
  return html.match(/\$ACTION_ID_[0-9a-f]+/)?.[0] ?? null;
}

/**
 * POST the action field. Separate from reading it, because the guard can only
 * be tested by REPLAYING a field captured earlier: once something is queued the
 * button is gone from the page, so there is nothing left to scrape. That is the
 * stale-tab case the server-side re-check exists for, and testing it any other
 * way tests nothing.
 */
async function postAction(cookie, field) {
  // FormData lets fetch build the multipart body and boundary itself; a
  // hand-rolled body is one CRLF away from being silently ignored.
  const form = new FormData();
  form.set(field, "");

  const response = await fetch(`${BASE}/admin/sync`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie },
    body: form,
  });
  return {
    status: response.status,
    // A Server Action redirect surfaces as this header in the no-JS path.
    location: response.headers.get("location") ?? response.headers.get("x-action-redirect") ?? "",
  };
}

async function pressTriggerButton(cookie) {
  const field = await readActionField(cookie);
  if (!field) return { ok: false, reason: "no $ACTION_ID_ field in the rendered page" };
  return { ok: true, field, ...(await postAction(cookie, field)) };
}

const created = [];
const users = [];

async function makeUser(role) {
  const email = `verify-queue-${role}-${Date.now()}@example.com`;
  const password = `v-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const made = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: role === "admin" ? { role: "admin" } : {},
  });
  if (made.error) throw new Error(`${role}: ${made.error.message}`);
  users.push(made.data.user.id);
  const signedIn = await anon.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`${role} sign-in: ${signedIn.error.message}`);
  return { id: made.data.user.id, cookie: sessionCookie(signedIn.data.session) };
}

try {
  // ==========================================================
  console.log("\n0 — preconditions");
  // ==========================================================
  const before = await db.from("sync_runs").select("id, status");
  check("sync_runs is reachable", !before.error, before.error?.message);
  const preexisting = before.data ?? [];
  if (preexisting.length) {
    console.log(`        ⚠ ${preexisting.length} pre-existing row(s): ${preexisting.map((r) => r.status).join(", ")}`);
    console.log(`        the guard tests below assume none are queued/running`);
  }

  const probe = await db
    .from("sync_runs")
    .insert({ status: "queued", queued_at: new Date().toISOString(), triggered_by: "manual", source_url: null })
    .select("id, status, queued_at, source_url")
    .single();
  /**
   * THE MIGRATION HAS THREE PARTS AND EACH FAILS DIFFERENTLY. Catching only the
   * CHECK violation was not enough: the first real run of this script hit
   * PGRST204 for the missing queued_at column and reported it as a stack trace
   * rather than as "you have not run the migration", which is the one thing the
   * operator needs to be told.
   *
   *   23514   the status CHECK still rejects 'queued'   (part 1 missing)
   *   PGRST204 no queued_at column in the schema cache  (part 2 missing)
   *   23502   source_url is still NOT NULL             (part 3 missing)
   */
  const NOT_MIGRATED = { 23514: "the status CHECK still rejects 'queued'", PGRST204: "queued_at does not exist", 23502: "source_url is still NOT NULL" };
  if (probe.error && NOT_MIGRATED[probe.error.code]) {
    console.log(`\n  ✗ ${NOT_MIGRATED[probe.error.code]} (${probe.error.code}).`);
    console.log("    db/migrations/20260805_sync_runs_queued.sql has not been applied.");
    console.log("    Run it in the SQL editor, then re-run this script.\n");
    process.exit(1);
  }
  check("'queued' is an accepted status", !probe.error, `${probe.error?.code} ${probe.error?.message}`);
  if (probe.error) throw new Error("cannot continue");
  created.push(probe.data.id);
  check("queued_at round-trips", Boolean(probe.data.queued_at));
  check("source_url accepts NULL (not the DBPR default)", probe.data.source_url === null);

  // Clear it so the guard tests start from a clean slate.
  await db.from("sync_runs").delete().eq("id", probe.data.id);
  created.pop();

  // ==========================================================
  console.log("\n1 — an admin queues through the real Server Action");
  // ==========================================================
  const adminUser = await makeUser("admin");
  const pressed = await pressTriggerButton(adminUser.cookie);
  check("the trigger form posted", pressed.ok, pressed.reason ?? "");

  const afterQueue = await db
    .from("sync_runs")
    .select("id, status, queued_at, triggered_by, triggered_by_user_id, source_url, started_at")
    .eq("status", "queued");
  check("exactly one queued row exists", afterQueue.data?.length === 1, `saw ${afterQueue.data?.length}`);
  const queuedRow = afterQueue.data?.[0];
  if (queuedRow) created.push(queuedRow.id);

  check("triggered_by is 'manual'", queuedRow?.triggered_by === "manual");
  check(
    "triggered_by_user_id is the admin who pressed it",
    queuedRow?.triggered_by_user_id === adminUser.id,
    `got ${queuedRow?.triggered_by_user_id}`,
  );
  check("source_url is null, not the unverified DBPR default", queuedRow?.source_url === null);

  // ==========================================================
  console.log("\n2 — it is visible on the page, with the command to run");
  // ==========================================================
  const page = await fetch(`${BASE}/admin/sync`, { headers: { cookie: adminUser.cookie } });
  const html = await page.text();
  check("page still renders", page.status === 200, `HTTP ${page.status}`);
  check("the queued state is shown", html.includes("Refresh queued"));
  check("the exact command is on the page", html.includes("node scripts/import-dbpr.mjs"));
  check("it says nothing runs on its own", html.includes("Nothing runs on its own"));
  check("the trigger button is GONE, not disabled", !html.includes("Trigger refresh</button>"));
  check("the history row says 'Not started'", html.includes("Not started"));

  // ==========================================================
  console.log("\n3 — the guard: no second queue while one is outstanding");
  // ==========================================================
  //   The button is now absent from the page, so a fresh scrape finds nothing —
  //   which is the UI half of the guard, asserted in section 2. What is left to
  //   prove is the SERVER half: a tab opened before the queue existed still
  //   holds a working action id, and replaying it must be refused.
  check("no button is left to scrape while one is queued", (await readActionField(adminUser.cookie)) === null);

  const replay = await postAction(adminUser.cookie, pressed.field);
  check("the stale press reached the action", replay.status < 500, `HTTP ${replay.status}`);
  check(
    "it was redirected to ?e=active rather than queueing",
    replay.location.includes("e=active"),
    `location "${replay.location}"`,
  );

  const afterSecond = await db.from("sync_runs").select("id").eq("status", "queued");
  check("still exactly one queued row", afterSecond.data?.length === 1, `saw ${afterSecond.data?.length}`);
  for (const r of afterSecond.data ?? []) if (!created.includes(r.id)) created.push(r.id);

  const guarded = await fetch(`${BASE}/admin/sync?e=active`, { headers: { cookie: adminUser.cookie } });
  const guardedHtml = await guarded.text();
  check("the page explains the refusal", guardedHtml.includes("already queued or running"));

  // ==========================================================
  console.log("\n4 — the importer claims it (startRun's logic, exactly)");
  // ==========================================================
  const { data: toClaim } = await db
    .from("sync_runs")
    .select("id, queued_at")
    .eq("status", "queued")
    .order("queued_at", { ascending: true, nullsFirst: false })
    .limit(1);
  check("the importer finds the queued row", toClaim?.length === 1);

  const claimStart = new Date().toISOString();
  const claimed = await db
    .from("sync_runs")
    .update({
      status: "running",
      started_at: claimStart,
      source_url: "file:_handoff/07_source_data/CONSTRUCTIONLICENSE_1.csv",
      source_file_size: 47_700_000,
      source_file_hash: "a".repeat(64),
    })
    .eq("id", toClaim[0].id)
    .eq("status", "queued")
    .select("id, status, started_at, queued_at, triggered_by_user_id")
    .maybeSingle();

  check("the claim succeeded", !claimed.error && Boolean(claimed.data), claimed.error?.message);
  check("status moved to 'running'", claimed.data?.status === "running");
  //   Compared as instants, not as strings: Postgres returns
  //   "…T21:04:11.123+00:00" where the client sent "…T21:04:11.123Z". Same
  //   moment, different text, and a string compare fails on every green run.
  check(
    "started_at was RESET to claim time",
    new Date(claimed.data?.started_at).getTime() === new Date(claimStart).getTime(),
    `${claimed.data?.started_at} vs ${claimStart}`,
  );
  check("queued_at was preserved", Boolean(claimed.data?.queued_at));
  check(
    "the requester's id survived the claim",
    claimed.data?.triggered_by_user_id === adminUser.id,
  );
  check(
    "started_at is now later than queued_at, so duration excludes the wait",
    new Date(claimed.data.started_at) >= new Date(claimed.data.queued_at),
  );

  // The compare-and-swap: a second importer must not claim the same row.
  const doubleClaim = await db
    .from("sync_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", toClaim[0].id)
    .eq("status", "queued")
    .select("id");
  check(
    "a second importer cannot claim the same row",
    (doubleClaim.data ?? []).length === 0,
    `claimed ${doubleClaim.data?.length} row(s) a second time`,
  );

  // ==========================================================
  console.log("\n5 — and completes");
  // ==========================================================
  const done = await db
    .from("sync_runs")
    .update({
      status: "success",
      completed_at: new Date().toISOString(),
      records_total: 266_305,
      records_inserted: 0,
      records_updated: 0,
      records_unchanged: 266_305,
      records_orphaned: 0,
    })
    .eq("id", toClaim[0].id)
    .select("status, completed_at, records_total")
    .single();
  check("the run completed", done.data?.status === "success", done.error?.message);

  const noneActive = await db.from("sync_runs").select("id").in("status", ["queued", "running"]);
  check("nothing is outstanding any more", (noneActive.data ?? []).length === 0);

  const reopened = await fetch(`${BASE}/admin/sync`, { headers: { cookie: adminUser.cookie } });
  const reopenedHtml = await reopened.text();
  check("the trigger button is back", reopenedHtml.includes("Trigger refresh"));
  check("the banner reports the finished run", reopenedHtml.includes("without errors"));

  // ==========================================================
  console.log("\n6 — who cannot queue");
  // ==========================================================
  const anonPress = await fetch(`${BASE}/admin/sync`, { method: "POST", redirect: "manual" });
  check(
    "anon POST to the route does not queue",
    anonPress.status === 404 || anonPress.status === 405 || anonPress.status >= 300,
    `HTTP ${anonPress.status}`,
  );

  const plainUser = await makeUser("plain");
  const plainPress = await pressTriggerButton(plainUser.cookie);
  check("a signed-in non-admin cannot even load the page", !plainPress.ok, "the page rendered for them");

  //   The database is the second gate, independent of the route. A non-admin
  //   holding a valid session must be refused by RLS even posting straight at
  //   PostgREST — which is the attack the route check alone would not stop.
  const plainClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const plainEmail = `verify-queue-direct-${Date.now()}@example.com`;
  const plainPassword = `v-${Math.random().toString(36).slice(2)}`;
  const directUser = await db.auth.admin.createUser({
    email: plainEmail, password: plainPassword, email_confirm: true, app_metadata: {},
  });
  if (!directUser.error) {
    users.push(directUser.data.user.id);
    await plainClient.auth.signInWithPassword({ email: plainEmail, password: plainPassword });
    const directInsert = await plainClient
      .from("sync_runs")
      .insert({ status: "queued", queued_at: new Date().toISOString(), triggered_by: "manual" })
      .select("id");
    check(
      "a non-admin session is refused by RLS at PostgREST",
      Boolean(directInsert.error) || (directInsert.data ?? []).length === 0,
      "the insert was accepted",
    );
    for (const r of directInsert.data ?? []) created.push(r.id);
  }

  const anonInsert = await anon
    .from("sync_runs")
    .insert({ status: "queued", queued_at: new Date().toISOString(), triggered_by: "manual" })
    .select("id");
  check(
    "anon is refused by RLS at PostgREST",
    Boolean(anonInsert.error) || (anonInsert.data ?? []).length === 0,
    "the insert was accepted",
  );
  for (const r of anonInsert.data ?? []) created.push(r.id);
} finally {
  // ==========================================================
  console.log("\ncleanup…");
  // ==========================================================
  const seen = new Set();
  for (const id of created) {
    if (seen.has(id)) continue;
    seen.add(id);
    const { error } = await db.from("sync_runs").delete().eq("id", id);
    console.log(`  ${error ? `FAILED to delete run ${id}: ${error.message}` : `deleted run ${id}`}`);
  }
  for (const id of users) {
    const { error } = await db.auth.admin.deleteUser(id);
    console.log(`  ${error ? `FAILED to delete user: ${error.message}` : "deleted test user"}`);
  }
  const after = await db.from("sync_runs").select("id", { count: "exact", head: true });
  console.log(`  sync_runs now holds ${after.count ?? "?"} row(s)`);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
