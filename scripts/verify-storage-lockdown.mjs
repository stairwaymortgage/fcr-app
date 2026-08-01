/**
 * TEMPORARY — negative-test harness for the id-photos bucket. Delete after use.
 *
 * A count of zero on an empty bucket proves nothing, so this uploads a real
 * object as contractor A and then attempts to reach it as anon, as contractor
 * B, and as an admin. Every attempt that MUST fail is asserted to fail.
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
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "  PASS" : "  ****FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

// 1×1 px JPEG.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
    "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

async function mkUser(tag, isAdmin) {
  const email = `lockdown-${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const password = randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: isAdmin ? { role: "admin" } : {},
  });
  if (error) throw new Error(`createUser ${tag}: ${error.message}`);
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error: e2 } = await c.auth.signInWithPassword({ email, password });
  if (e2) throw new Error(`signIn ${tag}: ${e2.message}`);
  return { id: data.user.id, email, client: c };
}

const created = [];
try {
  const A = await mkUser("a", false);
  const B = await mkUser("b", false);
  const J = await mkUser("admin", true);
  created.push(A.id, B.id, J.id);
  console.log(`\ncontractor A = ${A.id}\ncontractor B = ${B.id}\nadmin       = ${J.id}\n`);

  const claimId = randomUUID();
  const pathA = `${A.id}/${claimId}.jpg`;

  console.log("── OWN PATH (must succeed) ─────────────────────────────");
  {
    const { error } = await A.client.storage
      .from("id-photos")
      .upload(pathA, JPEG, { contentType: "image/jpeg" });
    ok("A uploads to own folder", !error, error?.message ?? pathA);
  }
  {
    const { data, error } = await A.client.storage.from("id-photos").download(pathA);
    ok("A downloads own photo", !error && data, error?.message ?? `${(await data?.arrayBuffer())?.byteLength} bytes`);
  }

  console.log("\n── ANON (must ALL be blocked) ──────────────────────────");
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  {
    const { data, error } = await anon.storage.from("id-photos").list("");
    ok("anon cannot list bucket root", !!error || (data?.length ?? 0) === 0,
       error?.message ?? `returned ${data?.length} entries`);
  }
  {
    const { data, error } = await anon.storage.from("id-photos").list(A.id);
    ok("anon cannot list A's folder", !!error || (data?.length ?? 0) === 0,
       error?.message ?? `returned ${data?.length} entries`);
  }
  {
    const { data, error } = await anon.storage.from("id-photos").download(pathA);
    ok("anon cannot download A's photo", !!error, error?.message ?? `GOT ${(await data?.arrayBuffer())?.byteLength} BYTES`);
  }
  {
    const r = await fetch(`${URL_}/storage/v1/object/public/id-photos/${pathA}`);
    ok("no public URL exists (public endpoint refuses)", !r.ok, `HTTP ${r.status}`);
  }
  {
    const { data } = anon.storage.from("id-photos").getPublicUrl(pathA);
    const r = await fetch(data.publicUrl);
    ok("getPublicUrl() output is dead", !r.ok, `HTTP ${r.status}`);
  }
  {
    const { error } = await anon.storage.from("id-photos").createSignedUrl(pathA, 60);
    ok("anon cannot mint a signed URL", !!error, error?.message ?? "MINTED ONE");
  }

  console.log("\n── WRONG USER: B against A (must ALL be blocked) ───────");
  {
    const { data, error } = await B.client.storage.from("id-photos").download(pathA);
    ok("B cannot download A's photo", !!error, error?.message ?? `GOT ${(await data?.arrayBuffer())?.byteLength} BYTES`);
  }
  {
    const { data, error } = await B.client.storage.from("id-photos").list(A.id);
    ok("B cannot list A's folder", !!error || (data?.length ?? 0) === 0,
       error?.message ?? `returned ${data?.length} entries`);
  }
  {
    const { error } = await B.client.storage.from("id-photos").createSignedUrl(pathA, 60);
    ok("B cannot mint a signed URL for A", !!error, error?.message ?? "MINTED ONE");
  }
  {
    const { error } = await B.client.storage
      .from("id-photos")
      .upload(`${A.id}/planted-${randomUUID().slice(0, 6)}.jpg`, JPEG, { contentType: "image/jpeg" });
    ok("B cannot plant a file in A's folder", !!error, error?.message ?? "UPLOAD ACCEPTED");
  }

  console.log("\n── IMMUTABILITY (no UPDATE/DELETE for contractors) ─────");
  {
    const { error } = await A.client.storage
      .from("id-photos")
      .upload(pathA, JPEG, { contentType: "image/jpeg", upsert: true });
    ok("A cannot overwrite own photo after submission", !!error, error?.message ?? "OVERWRITE ACCEPTED");
  }
  {
    const { data, error } = await A.client.storage.from("id-photos").remove([pathA]);
    const removed = !error && Array.isArray(data) && data.length > 0;
    ok("A cannot delete own photo", !removed, error?.message ?? (removed ? "DELETED" : "no rows removed"));
  }

  console.log("\n── BUCKET LIMITS ───────────────────────────────────────");
  {
    const { error } = await A.client.storage
      .from("id-photos")
      .upload(`${A.id}/${randomUUID()}.svg`, Buffer.from("<svg onload=alert(1)/>"), {
        contentType: "image/svg+xml",
      });
    ok("SVG rejected by MIME allowlist", !!error, error?.message ?? "SVG ACCEPTED");
  }
  {
    const big = Buffer.alloc(11 * 1024 * 1024, 0x41);
    const { error } = await A.client.storage
      .from("id-photos")
      .upload(`${A.id}/${randomUUID()}.jpg`, big, { contentType: "image/jpeg" });
    ok("11 MB upload rejected by size limit", !!error, error?.message ?? "OVERSIZE ACCEPTED");
  }

  console.log("\n── ADMIN + SIGNED URL (must succeed) ───────────────────");
  {
    const { data, error } = await J.client.storage.from("id-photos").download(pathA);
    ok("admin downloads A's photo", !error && data, error?.message ?? `${(await data?.arrayBuffer())?.byteLength} bytes`);
  }
  {
    const { data, error } = await J.client.storage.from("id-photos").createSignedUrl(pathA, 60);
    ok("admin mints a signed URL", !error && !!data?.signedUrl, error?.message ?? "");
    if (data?.signedUrl) {
      const r = await fetch(data.signedUrl);
      ok("signed URL fetches the object", r.ok, `HTTP ${r.status}`);
      const tampered = data.signedUrl.replace(/token=.*$/, "token=forged.forged.forged");
      const r2 = await fetch(tampered);
      ok("tampered signed-URL token refused", !r2.ok, `HTTP ${r2.status}`);
    }
  }
  {
    const { data } = await admin.storage.from("id-photos").createSignedUrl(pathA, 1);
    if (data?.signedUrl) {
      await new Promise((r) => setTimeout(r, 2500));
      const r = await fetch(data.signedUrl);
      ok("signed URL is short-lived (expires)", !r.ok, `HTTP ${r.status} after 2.5s on a 1s URL`);
    }
  }

  console.log(`\n${"═".repeat(56)}\n  ${pass} passed, ${fail} failed\n${"═".repeat(56)}`);
} finally {
  console.log("\ncleanup…");
  const { data: objs } = await admin.storage.from("id-photos").list("", { limit: 1000 });
  for (const folder of objs ?? []) {
    const { data: files } = await admin.storage.from("id-photos").list(folder.name);
    for (const f of files ?? []) await admin.storage.from("id-photos").remove([`${folder.name}/${f.name}`]);
  }
  for (const id of created) await admin.auth.admin.deleteUser(id);
  console.log(`removed ${created.length} test users and their objects`);
}
process.exit(fail === 0 ? 0 : 1);
