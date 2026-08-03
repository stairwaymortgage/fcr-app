/**
 * Negative-test harness for the contractor profile write path.
 *
 * Run AFTER applying db/migrations/20260803_contractor_profile_lockdown.sql:
 *   node --no-warnings scripts/verify-profile-lockdown.mjs
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE POINT IS THE ATTEMPTS THAT MUST FAIL.
 *
 * "The editor saves" is the easy half and proves almost nothing. What this file
 * is for is the other half: a contractor who is legitimately signed in, holds a
 * real approved claim, and posts straight at PostgREST with their own access
 * token instead of using the form. That request never touches the React code,
 * so every check written in TypeScript is irrelevant to it.
 *
 * Before the migration, that request could rewrite license_number, claim_tier,
 * slug and stripe_subscription_id. The mockup calls those fields "Locked -
 * sourced from DBPR" and the lock was CSS. Sections C and D are the ones that
 * would have caught it.
 *
 * Runs against the LIVE project using .env.local, exactly like
 * verify-storage-lockdown.mjs. It creates its own users and contractor rows and
 * removes them in a finally block - it does not read or touch real data.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(URL_, SVC, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "  PASS" : "  ****FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};
const head = (t) => { console.log(""); console.log(t); };

async function mkUser(tag) {
  const email = `profilelock-${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const password = randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error) throw new Error(`createUser ${tag}: ${error.message}`);
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error: e2 } = await c.auth.signInWithPassword({ email, password });
  if (e2) throw new Error(`signIn ${tag}: ${e2.message}`);
  return { id: data.user.id, email, client: c };
}

/** A throwaway contractor row, optionally already claimed by someone. */
async function mkContractor(tag, ownerId) {
  const key = `TESTLOCK-${tag}-${randomUUID().slice(0, 8)}`;
  const { error } = await admin.from("contractors").insert({
    dbpr_sync_key: key,
    license_number: `TESTLIC${tag}`,
    license_type: "Certified General Contractor",
    qualifying_agent_name: `Test Agent ${tag}`,
    business_name: `Test Contractor ${tag}`,
    license_status: "Current,Active",
    city: "Davie",
    claimed_by_user_id: ownerId ?? null,
    claimed_at: ownerId ? new Date().toISOString() : null,
    claim_tier: ownerId ? "claimed" : "unclaimed",
  });
  if (error) throw new Error(`insert contractor ${tag}: ${error.message}`);
  return key;
}

/** Reads a row back with the service role, bypassing RLS entirely. */
async function readRow(key) {
  const { data } = await admin
    .from("contractors")
    .select(
      "custom_about_text, custom_website_url, custom_email, custom_phone, " +
      "custom_service_area, license_number, claim_tier, slug, stripe_subscription_id",
    )
    .eq("dbpr_sync_key", key)
    .single();
  return data;
}

const createdUsers = [];
const createdKeys = [];

try {
  const A = await mkUser("a");
  const B = await mkUser("b");
  const C = await mkUser("c"); // signed in, claims nothing
  createdUsers.push(A.id, B.id, C.id);

  const keyA = await mkContractor("A", A.id);
  const keyB = await mkContractor("B", B.id);
  const keyFree = await mkContractor("FREE", null);
  createdKeys.push(keyA, keyB, keyFree);

  console.log("");
  console.log(`owner A   = ${A.id}  -> ${keyA}`);
  console.log(`owner B   = ${B.id}  -> ${keyB}`);
  console.log(`no-claim C= ${C.id}`);
  console.log(`unclaimed profile   = ${keyFree}`);

  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });

  // ────────────────────────────────────────────────────────
  head("── A. THE OWNER CAN EDIT (must succeed) ────────────────");
  {
    const { error } = await A.client.rpc("update_own_contractor_profile", {
      p_dbpr_sync_key: keyA,
      p_about: "We remodel kitchens in Broward County.",
      p_website: "https://example.com",
      p_email: "Info@Example.com",
      p_phone: "(954) 555-0143",
      p_service_area: "Broward County, South Florida",
    });
    ok("owner updates the five editable fields", !error, error?.message ?? "");
  }
  {
    const row = await readRow(keyA);
    ok("about persisted", row?.custom_about_text === "We remodel kitchens in Broward County.");
    ok("website persisted", row?.custom_website_url === "https://example.com");
    ok("email persisted lowercased", row?.custom_email === "info@example.com", row?.custom_email);
    ok("phone persisted", row?.custom_phone === "(954) 555-0143");
    ok("service area persisted", row?.custom_service_area === "Broward County, South Florida");
  }
  {
    // A blank argument clears the field - this is a full replace, not a patch.
    const { error } = await A.client.rpc("update_own_contractor_profile", {
      p_dbpr_sync_key: keyA, p_about: "   ", p_website: null,
      p_email: null, p_phone: null, p_service_area: null,
    });
    const row = await readRow(keyA);
    ok("blank/NULL clears a field rather than being ignored",
       !error && row?.custom_about_text === null && row?.custom_website_url === null,
       error?.message ?? "");
  }

  // ────────────────────────────────────────────────────────
  head("── B. DIRECT UPDATE IS GONE (must ALL be blocked) ──────");
  {
    const { error } = await A.client
      .from("contractors").update({ custom_about_text: "direct write" }).eq("dbpr_sync_key", keyA);
    const row = await readRow(keyA);
    ok("owner cannot direct-UPDATE even an editable column",
       !!error || row?.custom_about_text !== "direct write",
       error?.message ?? `value is now ${JSON.stringify(row?.custom_about_text)}`);
  }
  {
    const { error } = await A.client
      .from("contractors").insert({
        dbpr_sync_key: `PLANTED-${randomUUID().slice(0, 8)}`,
        license_type: "x", qualifying_agent_name: "x", license_status: "x",
      });
    ok("owner cannot INSERT a contractors row", !!error, error?.message ?? "INSERT ACCEPTED");
  }

  // ────────────────────────────────────────────────────────
  head("── C. THE LOCKED FIELDS (must ALL be unchanged) ────────");
  // Each is attempted individually so a failure names the column that moved.
  const before = await readRow(keyA);
  for (const [column, value] of [
    ["license_number", "FORGED999"],
    ["claim_tier", "featured"],
    ["slug", "forged-slug"],
    ["stripe_subscription_id", "sub_forged"],
    ["license_status", "Current,Active"],
    ["claimed_by_user_id", B.id],
  ]) {
    const { error } = await A.client
      .from("contractors").update({ [column]: value }).eq("dbpr_sync_key", keyA);
    const after = await readRow(keyA);
    const moved = column in after ? after[column] !== before[column] : false;
    ok(`${column} cannot be written directly`, !!error && !moved,
       error?.message ?? (moved ? `CHANGED to ${after[column]}` : "no error but unchanged"));
  }
  {
    // The paid tier specifically: the promote trigger fires on any write to
    // stripe_subscription_id and does not check Stripe.
    const row = await readRow(keyA);
    ok("claim_tier did not become 'featured'", row?.claim_tier !== "featured", row?.claim_tier);
    ok("stripe_subscription_id still empty", !row?.stripe_subscription_id);
  }

  // ────────────────────────────────────────────────────────
  head("── D. SOMEONE ELSE'S PROFILE (must ALL be blocked) ─────");
  {
    const { error } = await B.client.rpc("update_own_contractor_profile", {
      p_dbpr_sync_key: keyA, p_about: "B was here",
    });
    const row = await readRow(keyA);
    ok("B cannot edit A's profile through the RPC",
       !!error && row?.custom_about_text !== "B was here", error?.message ?? "ACCEPTED");
  }
  {
    const { error } = await B.client
      .from("contractors").update({ custom_about_text: "B direct" }).eq("dbpr_sync_key", keyA);
    const row = await readRow(keyA);
    ok("B cannot direct-UPDATE A's profile",
       !!error || row?.custom_about_text !== "B direct", error?.message ?? "ACCEPTED");
  }
  {
    const { error } = await C.client.rpc("update_own_contractor_profile", {
      p_dbpr_sync_key: keyFree, p_about: "claimed by nobody",
    });
    const row = await readRow(keyFree);
    ok("a signed-in user cannot edit an UNCLAIMED profile",
       !!error && row?.custom_about_text !== "claimed by nobody", error?.message ?? "ACCEPTED");
  }
  {
    const { error } = await A.client.rpc("update_own_contractor_profile", {
      p_dbpr_sync_key: "NO-SUCH-KEY-EVER", p_about: "x",
    });
    ok("an unknown sync key is refused", !!error, error?.message ?? "ACCEPTED");
  }

  // ────────────────────────────────────────────────────────
  head("── E. ANON (must ALL be blocked) ───────────────────────");
  {
    const { error } = await anon.rpc("update_own_contractor_profile", {
      p_dbpr_sync_key: keyA, p_about: "anon was here",
    });
    const row = await readRow(keyA);
    ok("anon cannot call the RPC",
       !!error && row?.custom_about_text !== "anon was here", error?.message ?? "ACCEPTED");
  }
  {
    const { error } = await anon
      .from("contractors").update({ custom_about_text: "anon direct" }).eq("dbpr_sync_key", keyA);
    const row = await readRow(keyA);
    ok("anon cannot direct-UPDATE",
       !!error || row?.custom_about_text !== "anon direct", error?.message ?? "ACCEPTED");
  }
  {
    const { data, error } = await anon.from("contractors").select("dbpr_sync_key").limit(1);
    ok("anon CAN still read (the site is public)", !error && !!data, error?.message ?? "");
  }

  // ────────────────────────────────────────────────────────
  head("── F. INPUT CONSTRAINTS (must be refused, readably) ────");
  const bad = [
    ["about over 1200 chars", { p_about: "x".repeat(1201) }],
    ["website with no scheme", { p_website: "example.com" }],
    ["website with a javascript scheme", { p_website: "javascript:alert(1)" }],
    ["website with a data scheme", { p_website: "data:text/html,<script>alert(1)</script>" }],
    ["email with no @", { p_email: "not-an-email" }],
    ["email with no dot in the domain", { p_email: "someone@localhost" }],
    ["phone over 32 chars", { p_phone: "9".repeat(33) }],
    ["service area over 200 chars", { p_service_area: "y".repeat(201) }],
  ];
  for (const [label, args] of bad) {
    const { error } = await A.client.rpc("update_own_contractor_profile", {
      p_dbpr_sync_key: keyA, ...args,
    });
    ok(`refused: ${label}`, !!error, error?.message ?? "ACCEPTED");
  }
  {
    const { error } = await A.client.rpc("update_own_contractor_profile", {
      p_dbpr_sync_key: keyA, p_website: "http://plain-http.example",
    });
    ok("accepted: plain http is allowed", !error, error?.message ?? "");
  }

  console.log("");
  console.log("═".repeat(56));
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log("═".repeat(56));
} finally {
  console.log("");
  console.log("cleanup…");
  for (const key of createdKeys) {
    await admin.from("contractors").delete().eq("dbpr_sync_key", key);
  }
  await admin.from("contractors").delete().like("dbpr_sync_key", "PLANTED-%");
  for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
  console.log(`removed ${createdKeys.length} contractor rows and ${createdUsers.length} users`);
}
process.exit(fail === 0 ? 0 : 1);
