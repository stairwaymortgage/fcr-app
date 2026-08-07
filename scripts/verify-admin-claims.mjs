/**
 * Admin claim review — decision functions and who may call them.
 *
 * The approve/reject buttons call approve_claim / reject_claim rather than
 * issuing UPDATEs, so this exercises those functions directly: the authorisation
 * they enforce, and whether approving really links the profile in one shot.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THIS SCRIPT USED TO MUTATE REAL CONTRACTORS. IT COST US A LIVE LISTING.
 *
 * It selected two real rows —
 *
 *   .from("contractors").select(...).is("claimed_by_user_id", null).limit(2)
 *
 * — approved a fabricated claim against one, and restored it afterwards. On
 * 2026-08-07 that left GROSSI (CGC1531481), a real Florida contractor, with
 * claim_tier = 'claimed' and no owner, rendering publicly in that state.
 *
 * TWO SEPARATE BUGS MADE IT POSSIBLE and both are fixed here:
 *
 *   1. The cleanup nulled claimed_by_user_id and claimed_at but NOT claim_tier,
 *      which approve_claim() began setting on 2026-08-03
 *      (20260803_claim_tier_on_approval.sql). The restore was written before
 *      that line existed and never caught up.
 *   2. More fundamentally, "restore afterwards" is not a safety property. The
 *      cleanup is a `finally`, and a `finally` does not run when the process is
 *      killed. Any crash between the approval and the restore leaves a real
 *      business misrepresented on a live site.
 *
 * SO IT NOW BUILDS ITS OWN ROWS. mkContractor() inserts throwaway rows keyed
 * with TEST_ROW_PREFIX, which the public read paths exclude (lib/test-rows.ts),
 * and cleanup DELETEs them rather than trying to guess them back to a previous
 * state. A leaked synthetic row is invisible; a half-restored real one is not.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { TEST_ROW_PREFIX } from "../lib/test-rows.ts";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok = (n, c, d = "") => {
  console.log(`${c ? "  PASS" : "  ****FAIL"}  ${n}${d ? `  — ${d}` : ""}`);
  c ? pass++ : fail++;
};

const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
  "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64");

async function mkUser(tag, isAdminUser = false) {
  const email = `adm-${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const password = randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    app_metadata: isAdminUser ? { role: "admin" } : {},
  });
  if (error) throw new Error(error.message);
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error: e2 } = await c.auth.signInWithPassword({ email, password });
  if (e2) throw new Error(e2.message);
  return { id: data.user.id, email, client: c };
}

const cleanup = { users: [], claims: [], keys: [] };

/**
 * A throwaway contractor row. Never a real one — see the header.
 *
 * Deliberately leaves `slug` NULL: /contractor/[slug] looks rows up by slug, so
 * a synthetic row has no public URL at all even before the read-path filters.
 */
async function mkContractor(tag) {
  const key = `${TEST_ROW_PREFIX}ADMCLAIMS_${tag}_${randomUUID().slice(0, 8)}`;
  cleanup.keys.push(key);
  const { error } = await admin.from("contractors").insert({
    dbpr_sync_key: key,
    license_number: `ZZTESTLIC${tag}`,
    license_type: "Certified General Contractor",
    qualifying_agent_name: `Test Agent ${tag}`,
    business_name: `ZZ Test Contractor ${tag}`,
    license_status: "Current,Active",
    city: "Davie",
    claim_tier: "unclaimed",
  });
  if (error) throw new Error(`insert contractor ${tag}: ${error.message}`);
  return key;
}

async function seedClaim(user, syncKey) {
  const claimId = randomUUID();
  cleanup.claims.push(claimId);
  const path = `${user.id}/${claimId}.jpg`;
  const { data: up } = await admin.storage.from("id-photos").createSignedUploadUrl(path);
  await user.client.storage.from("id-photos")
    .uploadToSignedUrl(path, up.token, JPEG, { contentType: "image/jpeg" });
  await admin.from("claims").insert({
    id: claimId, contractor_dbpr_sync_key: syncKey, claimant_user_id: user.id,
    claimant_name: "Test Claimant", claimant_email: user.email,
    claimant_phone: "(954) 555-0100", claimant_role: "qualifying_agent",
    id_photo_url: path,
  });
  return claimId;
}

try {
  // Two synthetic rows, built here. NOT selected from the live table.
  const targets = [
    { dbpr_sync_key: await mkContractor("a") },
    { dbpr_sync_key: await mkContractor("b") },
  ];
  console.log(`\nsynthetic targets: ${targets.map((t) => t.dbpr_sync_key).join(", ")}`);
  console.log("no real contractor row is read or written by this suite\n");

  const jim = await mkUser("jim", true);
  const alice = await mkUser("alice");
  const bob = await mkUser("bob");
  cleanup.users.push(jim.id, alice.id, bob.id);

  console.log("── WHO MAY DECIDE ──────────────────────────────────────");
  const claim1 = await seedClaim(alice, targets[0].dbpr_sync_key);
  {
    const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
    const { error } = await anon.rpc("approve_claim", { p_claim_id: claim1 });
    ok("anon cannot call approve_claim", !!error, error?.message);
  }
  {
    const { error } = await bob.client.rpc("approve_claim", { p_claim_id: claim1 });
    ok("signed-in NON-admin cannot approve", error?.code === "42501", error?.message);
  }
  {
    const { error } = await bob.client.rpc("reject_claim", { p_claim_id: claim1, p_reason: "nope" });
    ok("signed-in NON-admin cannot reject", error?.code === "42501", error?.message);
  }
  {
    const { data } = await admin.from("claims").select("status").eq("id", claim1).single();
    ok("claim untouched after those attempts", data.status === "pending", data.status);
  }

  console.log("\n── APPROVE LINKS THE PROFILE (one call) ────────────────");
  {
    const { error } = await jim.client.rpc("approve_claim", {
      p_claim_id: claim1, p_notes: "ID matches DBPR record",
    });
    ok("admin approves", !error, error?.message);
  }
  {
    const { data: c } = await admin.from("claims")
      .select("status, reviewed_at, reviewed_by_user_id, admin_notes, id_photo_expires_at")
      .eq("id", claim1).single();
    const { data: k } = await admin.from("contractors")
      .select("claimed_by_user_id, claimed_at").eq("dbpr_sync_key", targets[0].dbpr_sync_key).single();
    ok("claim is approved", c.status === "approved", c.status);
    ok("PROFILE IS LINKED to the claimant", k.claimed_by_user_id === alice.id,
       k.claimed_by_user_id === alice.id ? "claimed_by_user_id = claimant" : `${k.claimed_by_user_id}`);
    ok("claimed_at stamped", !!k.claimed_at, k.claimed_at?.slice(0, 19));
    ok("reviewer recorded as the admin", c.reviewed_by_user_id === jim.id,
       c.reviewed_by_user_id === jim.id ? "reviewed_by_user_id = Jim" : `${c.reviewed_by_user_id}`);
    ok("internal note saved", c.admin_notes === "ID matches DBPR record", c.admin_notes);
    ok("retention re-based on the DECISION", new Date(c.id_photo_expires_at) > new Date(Date.now() + 89 * 864e5),
       c.id_photo_expires_at?.slice(0, 10));
  }
  {
    /**
     * The capability the contractor actually gains — THROUGH THE RPC.
     *
     * This assertion used to issue a direct UPDATE on contractors, which
     * 20260803_contractor_profile_lockdown.sql revoked from `authenticated`
     * along with the "contractor updates own profile" policy. It had been
     * failing ever since, and the failure was the test asking for the hole back:
     * a direct UPDATE grant lets a contractor rewrite license_number,
     * claim_tier, slug and claimed_by_user_id. verify-profile-lockdown.mjs
     * asserts the direct path STAYS shut; this one asserts the RPC works.
     */
    const { error } = await alice.client.rpc("update_own_contractor_profile", {
      p_dbpr_sync_key: targets[0].dbpr_sync_key,
      p_about: "We plumb things.",
    });
    const { data } = await admin.from("contractors")
      .select("custom_about_text")
      .eq("dbpr_sync_key", targets[0].dbpr_sync_key).single();
    ok("claimant can now edit the profile (via the RPC)",
       !error && data?.custom_about_text === "We plumb things.",
       error?.message ?? data?.custom_about_text);
  }
  {
    const { error } = await jim.client.rpc("approve_claim", { p_claim_id: claim1 });
    ok("re-approving an approved claim is refused", !!error, error?.message);
  }

  console.log("\n── CONTESTED PROFILE ───────────────────────────────────");
  {
    const claimB = await seedClaim(bob, targets[0].dbpr_sync_key);
    const { error } = await jim.client.rpc("approve_claim", { p_claim_id: claimB });
    ok("cannot approve a 2nd claim on a claimed profile", !!error, error?.message);
    const { data } = await admin.from("contractors")
      .select("claimed_by_user_id").eq("dbpr_sync_key", targets[0].dbpr_sync_key).single();
    ok("original owner NOT displaced", data.claimed_by_user_id === alice.id, "still Alice");
    // Reject the loser, and confirm it does not clear the winner's ownership.
    await jim.client.rpc("reject_claim", { p_claim_id: claimB, p_reason: "Profile already verified to another person." });
    const { data: after } = await admin.from("contractors")
      .select("claimed_by_user_id").eq("dbpr_sync_key", targets[0].dbpr_sync_key).single();
    ok("rejecting the loser leaves ownership intact", after.claimed_by_user_id === alice.id, "still Alice");
  }

  console.log("\n── REJECT ──────────────────────────────────────────────");
  {
    const claim2 = await seedClaim(bob, targets[1].dbpr_sync_key);
    const { error } = await jim.client.rpc("reject_claim", {
      p_claim_id: claim2, p_reason: "The photo was too blurry to read the name.",
    });
    ok("admin rejects", !error, error?.message);
    const { data: c } = await admin.from("claims")
      .select("status, rejection_reason, reviewed_by_user_id").eq("id", claim2).single();
    ok("status is rejected", c.status === "rejected", c.status);
    ok("reason stored verbatim for the contractor", c.rejection_reason?.startsWith("The photo"), c.rejection_reason);
    const { data: k } = await admin.from("contractors")
      .select("claimed_by_user_id").eq("dbpr_sync_key", targets[1].dbpr_sync_key).single();
    ok("rejection does not claim the profile", k.claimed_by_user_id === null, `${k.claimed_by_user_id}`);
    const { data: seen } = await bob.client.from("claims")
      .select("rejection_reason").eq("id", claim2).single();
    ok("contractor can read their own reason", seen?.rejection_reason?.startsWith("The photo"), "visible");
    // And they may try again.
    const retry = await seedClaim(bob, targets[1].dbpr_sync_key);
    ok("contractor may submit a fresh claim after rejection", !!retry, "accepted");
  }

  console.log(`\n${"═".repeat(56)}\n  ${pass} passed, ${fail} failed\n${"═".repeat(56)}`);
} finally {
  console.log("\ncleanup…");
  for (const id of cleanup.claims) await admin.from("claims").delete().eq("id", id);
  /**
   * DELETE, not restore-by-UPDATE.
   *
   * The old cleanup nulled three columns and tried to put a real row back the
   * way it found it. That is unfixable in principle — it has to enumerate every
   * column any code path might have touched, and it silently rots the moment one
   * is added, which is exactly how claim_tier was missed after
   * 20260803_claim_tier_on_approval.sql. These rows are ours, so they go.
   */
  for (const key of cleanup.keys) {
    await admin.from("contractors").delete().eq("dbpr_sync_key", key);
  }
  for (const uid of cleanup.users) {
    const { data: files } = await admin.storage.from("id-photos").list(uid);
    for (const f of files ?? []) await admin.storage.from("id-photos").remove([`${uid}/${f.name}`]);
    await admin.auth.admin.deleteUser(uid);
  }
  console.log("deleted synthetic contractor rows, claims, users and photos");
}
process.exit(fail === 0 ? 0 : 1);
