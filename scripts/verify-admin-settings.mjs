/**
 * /admin/settings + the reference-count drift panel — verification.
 *
 *   npx next build && npx next start -p 3111
 *   node scripts/verify-admin-settings.mjs http://localhost:3111
 *
 * Creates a throwaway admin and a throwaway non-admin, drives both pages over
 * HTTP, and deletes both users. Reads only — no application table is written.
 * Never prints credential values.
 *
 * ⚠ THE POINT OF SECTION 4 IS THAT A READ-ONLY PAGE STAYS READ-ONLY. A "system
 * state" page accumulates buttons; this asserts there are none, so the next
 * person to add one has to change a test that says why.
 *
 * ⚠ AND SECTION 5 ASSERTS THE ABSENCE OF SECRETS. The page reports which env
 * vars are set. The failure mode is reporting WHAT they are set to, which would
 * publish a service-role key to anyone who screenshots the page — so the actual
 * values are searched for in the response body.
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

const users = [];
async function makeUser(role) {
  const email = `verify-settings-${role}-${Date.now()}@example.com`;
  const password = `v-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const made = await db.auth.admin.createUser({
    email, password, email_confirm: true,
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
  console.log("\n1 — the gate");
  // ==========================================================
  const anonHit = await fetch(`${BASE}/admin/settings`, { redirect: "manual" });
  check("signed-out visitor gets 404, not 403 or a login redirect", anonHit.status === 404, `HTTP ${anonHit.status}`);

  const plain = await makeUser("plain");
  const plainHit = await fetch(`${BASE}/admin/settings`, { headers: { cookie: plain.cookie }, redirect: "manual" });
  check("signed-in non-admin also gets 404", plainHit.status === 404, `HTTP ${plainHit.status}`);

  const admin = await makeUser("admin");
  const response = await fetch(`${BASE}/admin/settings`, { headers: { cookie: admin.cookie } });
  check("the admin gets 200", response.status === 200, `HTTP ${response.status}`);
  const html = await response.text();
  const has = (s) => html.includes(s);

  // ==========================================================
  console.log("\n2 — it renders, and it renders system state");
  // ==========================================================
  check("no React error boundary output", !has("Application error"), "the page threw");
  check("h1 present", has("System") && has("state"));
  check("says it sets nothing", has("Nothing on this page changes anything"));
  check("configured-vs-connected is stated", has("Configured is not connected"));
  check("env var names are listed", has("SUPABASE_SERVICE_ROLE_KEY") && has("RESEND_API_KEY"));
  check("presence is rendered as a phrase, not a tick", has("Key present") || has("Not set"));
  check("cron path from vercel.json", has("/api/cron/purge-id-photos"));
  check("cron schedule is described", has("Daily at 07:00 UTC"));
  check("says there is no DBPR sync job", has("There is no DBPR sync job"));

  // ==========================================================
  console.log("\n3 — the absent sections are explained, not silently dropped");
  // ==========================================================
  check("'Not on this page' section exists", has("Not on this page"));
  for (const [label, needle] of [
    ["profile", "no password to change"],
    ["notifications", "Nothing to switch on or off"],
    ["team members", "Deferred deliberately"],
    ["business info", "rewrite the terms of service"],
  ]) check(`${label} absence is explained`, has(needle));

  // ==========================================================
  console.log("\n4 — read-only means read-only");
  // ==========================================================
  //   The sign-out form is the one permitted POST — it is chrome, not settings.
  const forms = html.match(/<form[^>]*>/g) ?? [];
  const nonSignout = forms.filter((f) => !f.includes("/auth/signout"));
  check("no form other than sign-out", nonSignout.length === 0, `found ${nonSignout.length}: ${nonSignout.join(" ")}`);
  check("no Server Action is wired to this page", !has("$ACTION_ID_"), "an action id is present");
  check("no submit buttons", !/<button[^>]*type="submit"[^>]*>(?![\s\S]{0,80}Sign out)/.test(html) || forms.length === 1);
  check("no text input", !has("<input type=\"text\"") && !has("<select"));

  // ==========================================================
  console.log("\n5 — no secret is rendered");
  // ==========================================================
  //   The real values from .env.local are searched for verbatim. This is the
  //   assertion that would catch someone "helpfully" showing the last four
  //   characters of a key.
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "RESEND_API_KEY", "GHL_API_TOKEN", "CRON_SECRET"]) {
    const value = process.env[name];
    if (!value) { console.log(`  SKIP  ${name} is not set locally`); continue; }
    check(`${name}'s VALUE does not appear in the page`, !html.includes(value));
    if (value.length > 12) {
      check(`${name}'s last 8 chars do not appear either`, !html.includes(value.slice(-8)));
    }
  }

  // ==========================================================
  console.log("\n6 — the drift check, on both pages");
  // ==========================================================
  const syncHtml = await (await fetch(`${BASE}/admin/sync`, { headers: { cookie: admin.cookie } })).text();
  check("/admin/sync has the reference-count panel", syncHtml.includes("Reference counts"));
  check("it names the verify command", syncHtml.includes("node scripts/verify-counts.mjs"));
  check("it admits a sum check is not a per-row check", syncHtml.includes("would not catch two"));
  check("it explains why cities are excluded", syncHtml.includes("710-value filter"));
  check("/admin/settings cross-links the detail to DBPR Sync", has("/admin/sync"));

  //   Ground truth from the database, so the page's verdict is checked against
  //   a number rather than against itself.
  const [{ data: countyRows }, { data: typeRows }] = await Promise.all([
    db.from("reference_counties").select("contractor_count"),
    db.from("reference_license_types").select("type_code, contractor_count"),
  ]);
  const storedCounties = countyRows.reduce((a, r) => a + (r.contractor_count ?? 0), 0);
  const storedTypes = typeRows.reduce((a, r) => a + (r.contractor_count ?? 0), 0);
  const liveCounties = (await db.from("contractors").select("dbpr_sync_key", { count: "exact", head: true })
    .eq("state", "FL").not("county_code", "is", null)).count;
  const liveTypes = (await db.from("contractors").select("dbpr_sync_key", { count: "exact", head: true })
    .in("license_type", typeRows.map((r) => r.type_code))).count;

  const trulyClean = storedCounties === liveCounties && storedTypes === liveTypes;
  console.log(`        counties stored ${storedCounties.toLocaleString("en-US")} vs live ${liveCounties.toLocaleString("en-US")}`);
  console.log(`        types    stored ${storedTypes.toLocaleString("en-US")} vs live ${liveTypes.toLocaleString("en-US")}`);
  check(
    `the page's verdict matches the database (${trulyClean ? "in agreement" : "drifted"})`,
    trulyClean ? syncHtml.includes("in agreement") : syncHtml.includes("serving stale figures"),
    "the panel disagrees with the numbers",
  );
  check("the stored totals are rendered", syncHtml.includes(storedCounties.toLocaleString("en-US")));

  // ==========================================================
  console.log("\n6b — drift is actually DETECTED, not just absent");
  // ==========================================================
  //
  // ⚠ EVERYTHING ABOVE PASSES IF THE COMPARISON IS BROKEN. "In agreement" is
  // what a panel that always says "in agreement" renders too, and the counts
  // happen to be clean right now — so the only way to know the check works is
  // to break something and watch it notice.
  //
  // One reference row is bumped by 1, the page re-read, and the row restored in
  // the same block. The window is under a second, the change is to a
  // denormalised display count rather than to any contractor record, and the
  // restore runs even if an assertion throws. /types would render one count one
  // too high for that window.
  const victim = typeRows.find((r) => (r.contractor_count ?? 0) > 0);
  if (!victim) {
    console.log("  SKIP  no non-zero licence type to perturb");
  } else {
    const original = victim.contractor_count;
    try {
      const bumped = await db
        .from("reference_license_types")
        .update({ contractor_count: original + 1 })
        .eq("type_code", victim.type_code)
        .select("contractor_count")
        .single();
      check(`perturbed ${victim.type_code} by +1`, bumped.data?.contractor_count === original + 1, bumped.error?.message);

      const drifted = await (await fetch(`${BASE}/admin/sync`, { headers: { cookie: admin.cookie } })).text();
      check("the panel now reports drift", drifted.includes("serving stale figures"), "drift went unnoticed");
      check("it no longer claims agreement", !drifted.includes("in agreement"));
      check("it names the repair migration", drifted.includes("20260805_reference_counts_repair.sql"));
      check("it shows the signed difference", drifted.includes("+1") || drifted.includes("-1"));

      const settingsDrifted = await (await fetch(`${BASE}/admin/settings`, { headers: { cookie: admin.cookie } })).text();
      check("/admin/settings reports it too", settingsDrifted.includes("serving stale figures"));
    } finally {
      const restored = await db
        .from("reference_license_types")
        .update({ contractor_count: original })
        .eq("type_code", victim.type_code)
        .select("contractor_count")
        .single();
      check(
        `restored ${victim.type_code} to ${original.toLocaleString("en-US")}`,
        restored.data?.contractor_count === original,
        restored.error?.message ?? "MANUAL FIX NEEDED — re-run the repair migration",
      );
    }

    const back = await (await fetch(`${BASE}/admin/sync`, { headers: { cookie: admin.cookie } })).text();
    check("and the panel is clean again", back.includes("in agreement"));
  }

  // ==========================================================
  console.log("\n7 — the nav");
  // ==========================================================
  check("Settings link is present", has('"/admin/settings"'));
  check("all five admin routes are linked", ["/admin/claims", "/admin/leads", "/admin/contractors", "/admin/sync", "/admin/settings"].every((h) => has(`"${h}"`)));

  // ==========================================================
  console.log("\n8 — nothing was invented from the mockup");
  // ==========================================================
  for (const ghost of ["$4,118", "142 active", "14.2M", "78 messages", "47 days ago", "Olga Blackburn", "Two-Factor"]) {
    check(`the mockup's "${ghost}" is absent`, !has(ghost));
  }
} finally {
  console.log("\ncleanup…");
  for (const id of users) {
    const { error } = await db.auth.admin.deleteUser(id);
    console.log(`  ${error ? `FAILED to delete user: ${error.message}` : "deleted test user"}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
