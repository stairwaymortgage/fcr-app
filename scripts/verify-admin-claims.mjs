/**
 * Admin claim review — decision functions and who may call them.
 *
 * The approve/reject buttons call approve_claim / reject_claim rather than
 * issuing UPDATEs, so this exercises those functions directly: the authorisation
 * they enforce, and whether approving really links the profile in one shot.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

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
  const { data: targets } = await admin.from("contractors")
    .select("dbpr_sync_key, business_name, qualifying_agent_name")
    .is("claimed_by_user_id", null).limit(2);
  cleanup.keys = targets.map((t) => t.dbpr_sync_key);
  console.log(`\ntarget: ${targets[0].business_name}`);
  console.log(`qualifying agent: ${targets[0].qualifying_agent_name ?? "(none)"}\n`);

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
    // The capability the contractor actually gains.
    const { data } = await alice.client.from("contractors")
      .update({ custom_about_text: "We plumb things." })
      .eq("dbpr_sync_key", targets[0].dbpr_sync_key).select("custom_about_text");
    ok("claimant can now edit the profile", data?.[0]?.custom_about_text === "We plumb things.",
       data?.[0]?.custom_about_text);
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
  for (const key of cleanup.keys) {
    await admin.from("contractors").update({
      claimed_by_user_id: null, claimed_at: null, custom_about_text: null,
    }).eq("dbpr_sync_key", key);
  }
  for (const uid of cleanup.users) {
    const { data: files } = await admin.storage.from("id-photos").list(uid);
    for (const f of files ?? []) await admin.storage.from("id-photos").remove([`${uid}/${f.name}`]);
    await admin.auth.admin.deleteUser(uid);
  }
  console.log("restored contractor rows, removed claims, users and photos");
}
process.exit(fail === 0 ? 0 : 1);
