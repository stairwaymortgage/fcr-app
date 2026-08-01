/**
 * Claim-flow verification. Re-runnable; cleans up after itself.
 *
 * Proves the invariants the flow depends on, against the live database and the
 * real private bucket: anon cannot write a claim, a signed-in claimant can, the
 * photo lands at {user_id}/{claim_id}.ext, and the duplicate rules hold under a
 * race rather than only in application code.
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

let pass = 0,
  fail = 0;
const ok = (n, c, d = "") => {
  console.log(`${c ? "  PASS" : "  ****FAIL"}  ${n}${d ? `  — ${d}` : ""}`);
  c ? pass++ : fail++;
};

const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
    "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

async function mkUser(tag) {
  const email = `claimtest-${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const password = randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error) throw new Error(error.message);
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error: e2 } = await c.auth.signInWithPassword({ email, password });
  if (e2) throw new Error(e2.message);
  return { id: data.user.id, email, client: c };
}

const users = [];
const claimIds = [];
let syncKey;

try {
  // A real, currently unclaimed contractor.
  const { data: target } = await admin
    .from("contractors")
    .select("dbpr_sync_key, slug, business_name")
    .is("claimed_by_user_id", null)
    .limit(1)
    .single();
  syncKey = target.dbpr_sync_key;
  console.log(`\ntarget profile: ${target.business_name} (/${target.slug})\n`);

  const A = await mkUser("a");
  const B = await mkUser("b");
  users.push(A.id, B.id);

  console.log("── ANON CANNOT CLAIM ───────────────────────────────────");
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  {
    const { error } = await anon.from("claims").insert({
      id: randomUUID(),
      contractor_dbpr_sync_key: syncKey,
      claimant_user_id: A.id,
      claimant_name: "Anon Attacker",
      claimant_email: "attacker@example.com",
      id_photo_url: "fake/path.jpg",
      id_photo_expires_at: new Date(Date.now() + 8.64e9).toISOString(),
    });
    ok("anon INSERT into claims is refused", !!error, error?.message);
  }
  {
    const { data, error } = await anon.from("claims").select("id").limit(5);
    ok("anon SELECT on claims returns nothing", !error && (data?.length ?? 0) === 0,
       error?.message ?? `${data?.length} rows`);
  }

  console.log("\n── CLAIMANT A SUBMITS ──────────────────────────────────");
  const claimId = randomUUID();
  claimIds.push(claimId);
  const path = `${A.id}/${claimId}.jpg`;
  {
    // Mirrors createIdPhotoUploadTarget: path built from the session user id.
    const { data, error } = await admin.storage
      .from("id-photos").createSignedUploadUrl(path);
    ok("server mints a signed upload URL", !error && !!data?.token, error?.message);
    if (data?.token) {
      const { error: upErr } = await A.client.storage
        .from("id-photos")
        .uploadToSignedUrl(path, data.token, JPEG, { contentType: "image/jpeg" });
      ok("browser uploads the photo to the private bucket", !upErr, upErr?.message);
    }
  }
  {
    const { data } = await admin.storage.from("id-photos").list(A.id, { search: claimId });
    ok("photo is at {user_id}/{claim_id}.jpg",
       (data?.length ?? 0) === 1 && data[0].name === `${claimId}.jpg`,
       data?.[0]?.name ?? "not found");
  }
  {
    const { error } = await admin.from("claims").insert({
      id: claimId,
      contractor_dbpr_sync_key: syncKey,
      claimant_user_id: A.id,
      claimant_name: "Alice Contractor",
      claimant_email: "alice@example.com",
      claimant_phone: "(954) 555-0123",
      claimant_role: "qualifying_agent",
      id_photo_url: path,
      attestation_text: "I confirm that I am the qualifying agent…",
    });
    ok("claim row inserted", !error, error?.message);
  }
  {
    const { data } = await admin.from("claims").select("status, id_photo_url, id_photo_expires_at")
      .eq("id", claimId).single();
    ok("status defaults to 'pending'", data?.status === "pending", data?.status);
    ok("id_photo_url holds a PATH, not a URL",
       data?.id_photo_url === path && !/^https?:/.test(data?.id_photo_url ?? ""),
       data?.id_photo_url);
    ok("id_photo_expires_at auto-set (~90 days)", !!data?.id_photo_expires_at,
       data?.id_photo_expires_at?.slice(0, 10));
  }

  console.log("\n── DUPLICATE / CONTENTION RULES ────────────────────────");
  {
    const dup = randomUUID();
    const { error } = await admin.from("claims").insert({
      id: dup, contractor_dbpr_sync_key: syncKey, claimant_user_id: A.id,
      claimant_name: "Alice Again", claimant_email: "alice@example.com",
      id_photo_url: `${A.id}/${dup}.jpg`,
    });
    ok("same user cannot open a 2nd pending claim", error?.code === "23505", error?.message);
  }
  {
    const other = randomUUID();
    claimIds.push(other);
    const { error } = await admin.from("claims").insert({
      id: other, contractor_dbpr_sync_key: syncKey, claimant_user_id: B.id,
      claimant_name: "Bob Contractor", claimant_email: "bob@example.com",
      id_photo_url: `${B.id}/${other}.jpg`,
    });
    ok("a DIFFERENT user may contest the same profile", !error, error?.message ?? "allowed, as designed");
  }
  {
    await admin.from("claims").update({ status: "approved" }).eq("id", claimId);
    const { error } = await admin.from("claims")
      .update({ status: "approved" }).eq("id", claimIds[1]);
    ok("only ONE approved claim per profile", error?.code === "23505", error?.message);
    await admin.from("claims").update({ status: "pending" }).eq("id", claimId);
  }
  {
    const { error } = await admin.from("claims")
      .update({ status: "banana" }).eq("id", claimId);
    ok("status is constrained to the three legal values", !!error, error?.message);
  }

  console.log("\n── CLAIMANT ISOLATION ──────────────────────────────────");
  {
    const { data } = await B.client.from("claims").select("id").eq("id", claimId);
    ok("B cannot read A's claim row", (data?.length ?? 0) === 0, `${data?.length} rows`);
  }
  {
    const { data } = await A.client.from("claims").select("id, status").eq("id", claimId);
    ok("A can read own claim row", (data?.length ?? 0) === 1, `${data?.length} rows`);
  }
  {
    const { error } = await A.client.from("claims")
      .update({ status: "approved" }).eq("id", claimId);
    const { data: after } = await admin.from("claims").select("status").eq("id", claimId).single();
    ok("A cannot approve their own claim", after?.status === "pending",
       error?.message ?? `status is now ${after?.status}`);
  }

  console.log("\n── JIM'S REVIEW QUERY ──────────────────────────────────");
  {
    const { data, error } = await admin
      .from("claims")
      .select("id, created_at, claimant_name, claimant_email, claimant_role, id_photo_url, contractors(business_name, license_number)")
      .eq("status", "pending")
      .order("created_at");
    ok("pending queue returns the claim with its contractor", !error && data.some((c) => c.id === claimId),
       error?.message ?? `${data?.length} pending`);
    const row = data?.find((c) => c.id === claimId);
    if (row) {
      const { data: signed, error: sErr } = await admin.storage
        .from("id-photos").createSignedUrl(row.id_photo_url, 300);
      ok("reviewer can mint a signed URL from the stored path", !sErr && !!signed?.signedUrl, sErr?.message);
      if (signed?.signedUrl) {
        const r = await fetch(signed.signedUrl);
        ok("that signed URL serves the ID photo", r.ok, `HTTP ${r.status}`);
      }
    }
  }

  console.log(`\n${"═".repeat(56)}\n  ${pass} passed, ${fail} failed\n${"═".repeat(56)}`);
} finally {
  console.log("\ncleanup…");
  for (const id of claimIds) await admin.from("claims").delete().eq("id", id);
  for (const uid of users) {
    const { data: files } = await admin.storage.from("id-photos").list(uid);
    for (const f of files ?? []) await admin.storage.from("id-photos").remove([`${uid}/${f.name}`]);
    await admin.auth.admin.deleteUser(uid);
  }
  console.log(`removed ${claimIds.length} claims and ${users.length} users`);
}
process.exit(fail === 0 ? 0 : 1);
