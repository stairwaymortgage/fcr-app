/**
 * What approval actually changes — and what it does NOT.
 *
 * The point of this script is the middle section: flipping claims.status to
 * 'approved' on its own grants the contractor nothing. Every capability they
 * gain is keyed off contractors.claimed_by_user_id, which is a SECOND
 * statement. Run one without the other and the claim looks approved in the
 * table while the contractor sees an unclaimed profile.
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

const cleanup = { users: [], claims: [], inquiries: [], syncKey: null };

try {
  const { data: target } = await admin.from("contractors")
    .select("dbpr_sync_key, slug, business_name, qualifying_agent_name, claimed_by_user_id")
    .is("claimed_by_user_id", null).limit(1).single();
  cleanup.syncKey = target.dbpr_sync_key;
  console.log(`\ntarget: ${target.business_name}`);
  console.log(`qualifying agent on file: ${target.qualifying_agent_name ?? "(none)"}\n`);

  const email = `approve-${randomUUID().slice(0, 8)}@example.com`;
  const password = randomUUID();
  const { data: u } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  cleanup.users.push(u.user.id);
  const contractor = createClient(URL_, ANON, { auth: { persistSession: false } });
  await contractor.auth.signInWithPassword({ email, password });

  // An inquiry already waiting for whoever claims this profile.
  const { data: inq } = await admin.from("inquiries").insert({
    contractor_dbpr_sync_key: target.dbpr_sync_key,
    from_name: "Homeowner Test", from_email: "homeowner@example.com",
    message: "Do you handle roof replacements in this area?",
  }).select("id").single();
  cleanup.inquiries.push(inq.id);

  const claimId = randomUUID();
  cleanup.claims.push(claimId);
  const path = `${u.user.id}/${claimId}.jpg`;
  const { data: up } = await admin.storage.from("id-photos").createSignedUploadUrl(path);
  await contractor.storage.from("id-photos").uploadToSignedUrl(path, up.token, JPEG, { contentType: "image/jpeg" });
  await admin.from("claims").insert({
    id: claimId, contractor_dbpr_sync_key: target.dbpr_sync_key,
    claimant_user_id: u.user.id, claimant_name: "Test Claimant",
    claimant_email: email, claimant_phone: "(954) 555-0100",
    claimant_role: "qualifying_agent", id_photo_url: path,
  });

  console.log("── BEFORE APPROVAL ─────────────────────────────────────");
  {
    const { data } = await contractor.from("contractors")
      .update({ custom_about_text: "hello" }).eq("dbpr_sync_key", target.dbpr_sync_key).select();
    ok("contractor cannot edit the profile", (data?.length ?? 0) === 0, `${data?.length ?? 0} rows updated`);
  }
  {
    const { data } = await contractor.from("inquiries").select("id");
    ok("contractor cannot see the waiting inquiry", (data?.length ?? 0) === 0, `${data?.length ?? 0} rows`);
  }

  console.log("\n── STEP 1 ONLY: status='approved' ──────────────────────");
  console.log("   (the mistake this section exists to demonstrate)");
  await admin.from("claims").update({
    status: "approved", reviewed_at: new Date().toISOString(),
  }).eq("id", claimId);
  {
    const { data } = await admin.from("claims").select("status").eq("id", claimId).single();
    ok("claim row now reads 'approved'", data.status === "approved", data.status);
  }
  {
    const { data } = await contractor.from("contractors")
      .update({ custom_about_text: "hello" }).eq("dbpr_sync_key", target.dbpr_sync_key).select();
    ok("...but the contractor STILL cannot edit the profile", (data?.length ?? 0) === 0,
       `${data?.length ?? 0} rows updated — approval alone grants nothing`);
  }
  {
    const { data } = await contractor.from("inquiries").select("id");
    ok("...and STILL cannot see the inquiry", (data?.length ?? 0) === 0, `${data?.length ?? 0} rows`);
  }

  console.log("\n── STEP 2: link the profile to the user ────────────────");
  await admin.from("contractors").update({
    claimed_by_user_id: u.user.id, claimed_at: new Date().toISOString(),
  }).eq("dbpr_sync_key", target.dbpr_sync_key);
  {
    const { data } = await contractor.from("contractors")
      .update({ custom_about_text: "We roof things." })
      .eq("dbpr_sync_key", target.dbpr_sync_key).select("custom_about_text");
    ok("contractor CAN now edit their profile", data?.[0]?.custom_about_text === "We roof things.",
       data?.[0]?.custom_about_text);
  }
  {
    const { data } = await contractor.from("inquiries").select("id, from_name");
    ok("contractor CAN now see their inquiry", (data?.length ?? 0) === 1, data?.[0]?.from_name);
  }
  {
    const { data } = await contractor.from("contractors")
      .update({ custom_about_text: "nope" }).neq("dbpr_sync_key", target.dbpr_sync_key).select();
    ok("contractor still cannot edit ANY other profile", (data?.length ?? 0) === 0,
       `${data?.length ?? 0} of 266K rows`);
  }

  console.log("\n── REJECTION → REAPPLY ─────────────────────────────────");
  // Reset to an unclaimed, rejected state.
  await admin.from("contractors").update({ claimed_by_user_id: null, claimed_at: null, custom_about_text: null })
    .eq("dbpr_sync_key", target.dbpr_sync_key);
  await admin.from("claims").update({
    status: "rejected", rejection_reason: "The photo was too blurry to read the name.",
  }).eq("id", claimId);
  {
    const { data } = await contractor.from("claims").select("status, rejection_reason").eq("id", claimId).single();
    ok("contractor sees their own rejection reason", data?.rejection_reason?.startsWith("The photo"),
       data?.rejection_reason);
  }
  {
    const retry = randomUUID();
    cleanup.claims.push(retry);
    const { error } = await admin.from("claims").insert({
      id: retry, contractor_dbpr_sync_key: target.dbpr_sync_key,
      claimant_user_id: u.user.id, claimant_name: "Test Claimant",
      claimant_email: email, id_photo_url: `${u.user.id}/${retry}.jpg`,
    });
    ok("same user CAN submit a fresh claim after rejection", !error, error?.message ?? "accepted");
  }

  console.log("\n── ID PHOTO EXPOSURE ───────────────────────────────────");
  {
    const { count } = await admin.storage.from("id-photos").list(u.user.id).then((r) => ({ count: r.data?.length }));
    ok("photo exists in the private bucket only", count >= 1, `${count} object(s) in ${u.user.id}/`);
  }
  {
    const { data: buckets } = await admin.storage.listBuckets();
    ok("no other bucket exists to copy it into", buckets.length === 1 && buckets[0].id === "id-photos",
       buckets.map((b) => `${b.id}(public=${b.public})`).join(", "));
  }
  {
    const { data: signed } = await admin.storage.from("id-photos").createSignedUrl(path, 300);
    const r = await fetch(signed.signedUrl);
    const cc = r.headers.get("cache-control") ?? "";
    ok("signed URL serves the photo", r.ok, `HTTP ${r.status}`);
    ok("response is not publicly cacheable", !/\bpublic\b/.test(cc) || /private|no-store|max-age=0/.test(cc),
       `cache-control: ${cc || "(none)"}`);
    const url = new URL(signed.signedUrl);
    ok("URL carries a token (unguessable)", !!url.searchParams.get("token"),
       `${url.pathname.slice(0, 40)}…?token=…`);
  }
  {
    const { data: short } = await admin.storage.from("id-photos").createSignedUrl(path, 1);
    await new Promise((r) => setTimeout(r, 2500));
    const r = await fetch(short.signedUrl);
    ok("a 1s signed URL is dead after 2.5s", !r.ok, `HTTP ${r.status}`);
  }

  console.log(`\n${"═".repeat(56)}\n  ${pass} passed, ${fail} failed\n${"═".repeat(56)}`);
} finally {
  console.log("\ncleanup…");
  for (const id of cleanup.claims) await admin.from("claims").delete().eq("id", id);
  for (const id of cleanup.inquiries) await admin.from("inquiries").delete().eq("id", id);
  if (cleanup.syncKey) {
    await admin.from("contractors").update({
      claimed_by_user_id: null, claimed_at: null, custom_about_text: null,
    }).eq("dbpr_sync_key", cleanup.syncKey);
  }
  for (const uid of cleanup.users) {
    const { data: files } = await admin.storage.from("id-photos").list(uid);
    for (const f of files ?? []) await admin.storage.from("id-photos").remove([`${uid}/${f.name}`]);
    await admin.auth.admin.deleteUser(uid);
  }
  console.log("restored contractor row, removed claims, inquiries, users and photos");
}
process.exit(fail === 0 ? 0 : 1);
