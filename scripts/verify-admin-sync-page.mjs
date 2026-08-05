/**
 * /admin/sync — end-to-end render check against a running server.
 *
 *   npx next build && npx next start -p 3111
 *   node scripts/verify-admin-sync-page.mjs http://localhost:3111
 *
 * Creates a throwaway admin, signs in, drives the real route over HTTP with a
 * real session cookie, and deletes the user again. Never prints credentials.
 *
 * WHY OVER HTTP AND NOT AS A UNIT TEST. Everything cheaper than this was
 * already true while the page was broken: tsc passes on a component that throws
 * at render, and the SQL is verified separately by verify-sync-runs.mjs. The
 * only question left is whether requireAdmin() lets an admin through and React
 * renders the result — and that is an HTTP question.
 *
 * It also asserts the shape of the EMPTY STATE, which is the state this page
 * ships in. A dashboard that silently renders zeros where it means "never
 * measured" is the specific failure this whole task exists to avoid, so the
 * copy is asserted rather than eyeballed.
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

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

/** The project ref is the first label of the Supabase hostname. */
const projectRef = new URL(url).hostname.split(".")[0];
const COOKIE_BASE = `sb-${projectRef}-auth-token`;
const MAX_CHUNK = 3180; // @supabase/ssr's own constant — keep in step with it.

let passed = 0;
let failed = 0;
function check(label, ok, detail = "") {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
}

/**
 * Serialise a session the way @supabase/ssr expects to read it back:
 * `base64-` + base64url(JSON), split across numbered cookies past 3180 bytes.
 */
function sessionCookies(session) {
  const value = "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  if (value.length <= MAX_CHUNK) return [`${COOKIE_BASE}=${value}`];
  const parts = [];
  for (let i = 0; i < value.length; i += MAX_CHUNK) {
    parts.push(`${COOKIE_BASE}.${parts.length}=${value.slice(i, i + MAX_CHUNK)}`);
  }
  return parts;
}

const email = `verify-sync-${Date.now()}@example.com`;
const password = `v-${Math.random().toString(36).slice(2)}-${Date.now()}`;
let userId = null;

try {
  console.log(`\n1 — a throwaway admin (app_metadata.role, never user_metadata)`);
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    // app_metadata, because user_metadata is writable by the account itself.
    // See lib/auth.ts — this is the exact distinction that was exploitable
    // until 2026-08-01.
    app_metadata: { role: "admin" },
  });
  check("admin user created", !created.error, created.error?.message);
  if (created.error) throw new Error("cannot continue");
  userId = created.data.user.id;

  const signedIn = await anon.auth.signInWithPassword({ email, password });
  check("session obtained", !signedIn.error, signedIn.error?.message);
  if (signedIn.error) throw new Error("cannot continue");
  const cookie = sessionCookies(signedIn.data.session).join("; ");

  console.log(`\n2 — the gate`);
  const anonResponse = await fetch(`${BASE}/admin/sync`, { redirect: "manual" });
  check("signed-out visitor gets 404, not 403 or a login redirect", anonResponse.status === 404, `HTTP ${anonResponse.status}`);

  const response = await fetch(`${BASE}/admin/sync`, { headers: { cookie }, redirect: "manual" });
  check("the admin gets 200", response.status === 200, `HTTP ${response.status}`);
  const html = await response.text();

  console.log(`\n3 — the page rendered, and rendered the empty state`);
  const has = (needle) => html.includes(needle);

  check("no React error boundary output", !has("Application error") && !has("digest"), "the page threw");
  check("h1 present", has("sync status"));
  check("the empty-state row copy is exact", has("No runs recorded yet — history begins with the next refresh."));
  check("the banner explains why there is no history", has("No runs") && has("had a writer"));
  check("orphans are described as not yet measurable", has("Not measurable yet"));
  // Asserted unconditionally: the rule must survive BOTH orphan branches, and
  // the first version of this page only carried it in the branch that has a
  // count — which is the branch this project has never been in.
  check("the never-delete rule is on the page", has("Orphans are never deleted"));
  check("the local-runner note is on the page", has("Refreshes run locally, not on Vercel"));
  check("the reference-count follow-up is named", has("20260805_reference_counts_repair.sql"));

  console.log(`\n4 — the nav`);
  check("DBPR Sync link is present", has(">DBPR Sync<") || has('"DBPR Sync"'));
  check("it is marked as the current page", /aria-current="page"[^>]*>?[\s\S]{0,200}DBPR Sync|DBPR Sync[\s\S]{0,200}aria-current="page"/.test(html) || has('"/admin/sync"'));
  //   Was "Settings is NOT linked (route does not exist)" until task 159 built
  //   it. The nav rule is that a link appears only once its route does, so this
  //   assertion flips rather than being deleted — it still guards the rule,
  //   just from the other side.
  check("Settings IS linked (route built in 159)", has('"/admin/settings"'));

  console.log(`\n5 — nothing was invented`);
  //   The mockup's sample numbers must not appear anywhere on a page with no
  //   runs. 266,312 is the pre-dedupe row count the mockup used and the table
  //   has never held; 847 and "52 / 52" are its fabricated change and
  //   success-rate figures.
  for (const ghost of ["266,312", "847", "52 / 52", "14m 22s", "Sunday, May 31"]) {
    check(`the mockup's "${ghost}" is absent`, !has(ghost));
  }
  check("the real row count is shown", has("266,305"));
} finally {
  console.log(`\ncleanup…`);
  if (userId) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    console.log(`  ${error ? `FAILED to delete the test user: ${error.message}` : "test admin deleted"}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
