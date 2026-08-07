/**
 * Negative-test harness for the contractor inquiries inbox.
 *
 * Run AFTER applying db/migrations/20260804_inquiry_status_lockdown.sql:
 *   node --no-warnings scripts/verify-inquiries-lockdown.mjs
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE POINT IS THE ATTEMPTS THAT MUST FAIL.
 *
 * "The inbox lists my inquiries" is the easy half. What this file is for is a
 * contractor who is legitimately signed in, holds an approved claim, and posts
 * straight at PostgREST with their own access token instead of using the page.
 * That request never touches the React code, so every check written in
 * TypeScript is irrelevant to it.
 *
 * Before the migration, that request could rewrite the homeowner's message, the
 * reply-to address, the sender's name and the received timestamp on any inquiry
 * sent to them — the record of what was asked for and when, which is the thing a
 * later dispute turns on. Section D is the one that would have caught it.
 *
 * Section C is the check that was FLAGGED and turned out to be a false alarm:
 * the UPDATE policy had USING with with_check null, and Postgres reuses USING as
 * the WITH CHECK, so reassigning contractor_dbpr_sync_key to another
 * contractor's key was already refused. It stays in the suite anyway — the
 * reason it holds is a Postgres default, and a default is exactly the kind of
 * thing a future policy edit can switch off without anyone noticing.
 *
 * Runs against the LIVE project using .env.local, exactly like
 * verify-profile-lockdown.mjs. It creates its own users, contractor rows and
 * inquiries and removes them in a finally block — it does not read or touch real
 * data.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { TEST_ROW_PREFIX } from "../lib/test-rows.ts";

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
  const email = `inqlock-${tag}-${randomUUID().slice(0, 8)}@example.com`;
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
  const key = `${TEST_ROW_PREFIX}INQ_${tag}_${randomUUID().slice(0, 8)}`;
  const { error } = await admin.from("contractors").insert({
    dbpr_sync_key: key,
    license_number: `TESTINQ${tag}`,
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

/** An inquiry as the public contact form would create one: service role, four
 *  columns, schema defaults for status / replied_at / created_at. */
async function mkInquiry(key, name) {
  const { data, error } = await admin
    .from("inquiries")
    .insert({
      contractor_dbpr_sync_key: key,
      from_name: name,
      from_email: `${name}@example.com`,
      from_phone: "(954) 555-0287",
      message: "Original message, written by the homeowner.",
    })
    .select("id")
    .single();
  if (error) throw new Error(`insert inquiry for ${key}: ${error.message}`);
  return data.id;
}

/** Reads a row back with the service role, bypassing RLS entirely. */
async function readInquiry(id) {
  const { data } = await admin
    .from("inquiries")
    .select("contractor_dbpr_sync_key, from_name, from_email, from_phone, message, status, replied_at, created_at")
    .eq("id", id)
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
  const keyA2 = await mkContractor("A2", A.id); // A holds two licences
  const keyB = await mkContractor("B", B.id);
  const keyFree = await mkContractor("FREE", null);
  createdKeys.push(keyA, keyA2, keyB, keyFree);

  const inqA = await mkInquiry(keyA, "alice");
  const inqA2 = await mkInquiry(keyA2, "avery");
  const inqB = await mkInquiry(keyB, "bob");
  const inqFree = await mkInquiry(keyFree, "frankie");

  console.log("");
  console.log(`owner A    = ${A.id}  -> ${keyA} (+ ${keyA2})`);
  console.log(`owner B    = ${B.id}  -> ${keyB}`);
  console.log(`no-claim C = ${C.id}`);
  console.log(`unclaimed profile    = ${keyFree}`);

  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });

  // ────────────────────────────────────────────────────────
  head("── A. THE INBOX SEES ITS OWN MAIL, AND ONLY ITS OWN ────");
  {
    const { data, error } = await A.client
      .from("inquiries")
      .select("id, contractor_dbpr_sync_key")
      .in("id", [inqA, inqA2, inqB, inqFree]);
    const ids = new Set((data ?? []).map((r) => r.id));
    ok("A sees both of their own profiles' inquiries",
       !error && ids.has(inqA) && ids.has(inqA2), error?.message ?? `${ids.size} rows`);
    ok("A does NOT see B's inquiry", !ids.has(inqB));
    ok("A does NOT see an unclaimed profile's inquiry", !ids.has(inqFree));
  }
  {
    const { data } = await B.client.from("inquiries").select("id").in("id", [inqA, inqB]);
    const ids = new Set((data ?? []).map((r) => r.id));
    ok("B sees their own inquiry", ids.has(inqB));
    ok("B does NOT see A's inquiry", !ids.has(inqA));
  }
  {
    const { data } = await C.client.from("inquiries").select("id");
    ok("a signed-in user with no claim sees nothing", (data ?? []).length === 0,
       `${(data ?? []).length} rows`);
  }

  // ────────────────────────────────────────────────────────
  head("── B. ANON (must ALL be blocked) ───────────────────────");
  {
    const { data, error } = await anon.from("inquiries").select("id");
    ok("anon cannot read any inquiry", !error ? (data ?? []).length === 0 : true,
       error?.message ?? `${(data ?? []).length} rows`);
  }
  {
    const { error } = await anon.from("inquiries").update({ status: "archived" }).eq("id", inqA);
    const row = await readInquiry(inqA);
    ok("anon cannot direct-UPDATE", !!error || row?.status !== "archived",
       error?.message ?? "ACCEPTED");
  }
  {
    const { error } = await anon.rpc("set_own_inquiry_status", {
      p_inquiry_id: inqA, p_status: "archived",
    });
    const row = await readInquiry(inqA);
    ok("anon cannot call the RPC", !!error && row?.status !== "archived",
       error?.message ?? "ACCEPTED");
  }
  {
    const { error } = await anon.from("inquiries").insert({
      contractor_dbpr_sync_key: keyA,
      from_name: "spam", from_email: "spam@example.com", message: "hello there",
    });
    ok("anon cannot INSERT (the form uses the service role)", !!error,
       error?.message ?? "ACCEPTED");
  }

  // ────────────────────────────────────────────────────────
  head("── C. CROSS-TENANT (the flagged with_check question) ───");
  {
    const { error } = await A.client
      .from("inquiries").update({ status: "archived" }).eq("id", inqB);
    const row = await readInquiry(inqB);
    ok("A cannot UPDATE B's inquiry", row?.status === "unread",
       error?.message ?? `status=${row?.status}`);
  }
  {
    const { error } = await A.client.rpc("set_own_inquiry_status", {
      p_inquiry_id: inqB, p_status: "archived",
    });
    const row = await readInquiry(inqB);
    ok("A cannot reach B's inquiry through the RPC",
       !!error && row?.status === "unread", error?.message ?? "ACCEPTED");
  }
  {
    const { error } = await C.client.rpc("set_own_inquiry_status", {
      p_inquiry_id: inqFree, p_status: "read",
    });
    const row = await readInquiry(inqFree);
    ok("a user with no claim cannot touch an unclaimed profile's inquiry",
       !!error && row?.status === "unread", error?.message ?? "ACCEPTED");
  }
  {
    // The false alarm, kept as a regression test: USING doubles as WITH CHECK.
    const { error } = await A.client
      .from("inquiries")
      .update({ contractor_dbpr_sync_key: keyB })
      .eq("id", inqA);
    const row = await readInquiry(inqA);
    ok("A cannot move their own inquiry onto B's profile",
       row?.contractor_dbpr_sync_key === keyA, error?.message ?? "ACCEPTED");
  }

  // ────────────────────────────────────────────────────────
  head("── D. THE HOLE THIS MIGRATION CLOSES ───────────────────");
  //
  // Every one of these SUCCEEDED before 20260804_inquiry_status_lockdown.sql.
  // A is the legitimate owner of this inquiry; that is the point. Ownership is
  // not permission to rewrite the homeowner's half of the row.
  const before = await readInquiry(inqA);
  const tamper = [
    ["the homeowner's message", { message: "TAMPERED" }, "message"],
    ["the reply-to address", { from_email: "attacker@example.com" }, "from_email"],
    ["who it says sent it", { from_name: "Someone Else" }, "from_name"],
    ["the phone number", { from_phone: "(000) 000-0000" }, "from_phone"],
    ["the received timestamp", { created_at: "2020-01-01T00:00:00Z" }, "created_at"],
    ["a response time they did not achieve", { replied_at: "2020-01-01T00:00:00Z" }, "replied_at"],
    ["the workflow status, directly", { status: "replied" }, "status"],
  ];
  for (const [label, patch, column] of tamper) {
    const { error } = await A.client.from("inquiries").update(patch).eq("id", inqA);
    const after = await readInquiry(inqA);
    ok(`owner cannot rewrite ${label}`,
       String(after?.[column]) === String(before?.[column]),
       error?.message ?? `now ${JSON.stringify(after?.[column])}`);
  }
  {
    const { error } = await A.client.from("inquiries").delete().eq("id", inqA);
    const after = await readInquiry(inqA);
    ok("owner cannot DELETE an inquiry", !!after, error?.message ?? "row survives");
  }
  {
    const { error } = await A.client.from("inquiries").insert({
      contractor_dbpr_sync_key: keyA,
      from_name: "self-sent", from_email: "self@example.com", message: "hello there",
    });
    ok("owner cannot INSERT an inquiry to themselves", !!error,
       error?.message ?? "ACCEPTED");
  }

  // ────────────────────────────────────────────────────────
  head("── E. THE WORKFLOW THE INBOX ACTUALLY NEEDS ────────────");
  {
    const { error } = await A.client.rpc("set_own_inquiry_status", {
      p_inquiry_id: inqA, p_status: "read",
    });
    const row = await readInquiry(inqA);
    ok("owner CAN mark their own inquiry read", !error && row?.status === "read",
       error?.message ?? `status=${row?.status}`);
    ok("marking read does not set replied_at", row?.replied_at === null,
       `replied_at=${row?.replied_at}`);
  }
  let firstReplyAt = null;
  {
    const { error } = await A.client.rpc("set_own_inquiry_status", {
      p_inquiry_id: inqA, p_status: "replied",
    });
    const row = await readInquiry(inqA);
    firstReplyAt = row?.replied_at;
    ok("owner CAN mark replied", !error && row?.status === "replied", error?.message ?? "");
    ok("the 'replied' transition sets replied_at", !!row?.replied_at,
       `replied_at=${row?.replied_at}`);
  }
  {
    await A.client.rpc("set_own_inquiry_status", { p_inquiry_id: inqA, p_status: "read" });
    await A.client.rpc("set_own_inquiry_status", { p_inquiry_id: inqA, p_status: "replied" });
    const row = await readInquiry(inqA);
    ok("a second reply keeps the FIRST replied_at", row?.replied_at === firstReplyAt,
       `${firstReplyAt} -> ${row?.replied_at}`);
  }
  {
    const { error } = await A.client.rpc("set_own_inquiry_status", {
      p_inquiry_id: inqA, p_status: "archived",
    });
    const row = await readInquiry(inqA);
    ok("owner CAN archive", !error && row?.status === "archived", error?.message ?? "");
    ok("archiving does NOT clear replied_at", row?.replied_at === firstReplyAt,
       `replied_at=${row?.replied_at}`);
  }
  {
    const { error } = await A.client.rpc("set_own_inquiry_status", {
      p_inquiry_id: inqA, p_status: "read",
    });
    const row = await readInquiry(inqA);
    ok("owner CAN move an archived inquiry back to the inbox",
       !error && row?.status === "read", error?.message ?? "");
  }
  {
    // The homeowner's half of the row must be untouched by all of the above.
    const row = await readInquiry(inqA);
    ok("the homeowner's fields survived the whole workflow",
       row?.message === before?.message &&
       row?.from_email === before?.from_email &&
       row?.from_name === before?.from_name &&
       row?.created_at === before?.created_at,
       `${row?.from_name} / ${row?.from_email}`);
  }

  // ────────────────────────────────────────────────────────
  head("── F. INPUT CONSTRAINTS (must be refused, readably) ────");
  for (const bad of ["deleted", "REPLIED", "", "read; drop table inquiries", null]) {
    const { error } = await A.client.rpc("set_own_inquiry_status", {
      p_inquiry_id: inqA, p_status: bad,
    });
    ok(`refused: status ${JSON.stringify(bad)}`, !!error, error?.message ?? "ACCEPTED");
  }
  {
    const { error } = await A.client.rpc("set_own_inquiry_status", {
      p_inquiry_id: randomUUID(), p_status: "read",
    });
    ok("refused: an inquiry id that does not exist", !!error, error?.message ?? "ACCEPTED");
  }

  console.log("");
  console.log("═".repeat(56));
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log("═".repeat(56));
} finally {
  console.log("");
  console.log("cleanup…");
  // Inquiries first — the FK to contractors is ON DELETE CASCADE, but deleting
  // them explicitly keeps this honest if that ever changes.
  for (const key of createdKeys) {
    await admin.from("inquiries").delete().eq("contractor_dbpr_sync_key", key);
    await admin.from("contractors").delete().eq("dbpr_sync_key", key);
  }
  for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
  console.log(`removed ${createdKeys.length} contractor rows and ${createdUsers.length} users`);
}
process.exit(fail === 0 ? 0 : 1);
