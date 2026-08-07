/**
 * Negative-test harness for the contractor logo upload.
 *
 * Run AFTER applying db/migrations/20260804_contractor_logo.sql:
 *   node --no-warnings scripts/verify-contractor-logo.mjs
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS BUCKET IS PUBLIC, WHICH INVERTS WHAT THERE IS TO PROVE.
 *
 * For id-photos the question is "can anyone read it". Here reading is the
 * point — a logo that strangers cannot fetch is broken. The questions that
 * matter instead are:
 *
 *   · can anyone WRITE to it who should not, and
 *   · can a contractor make their profile POINT AT a file that is not theirs.
 *
 * The second one is not covered by storage permissions at all. Nothing in
 * Postgres stops an UPDATE that sets custom_logo_path to another contractor's
 * object; only assert_own_photo_path() does, and section D is what proves it.
 *
 * ⚠ THERE ARE NO RLS POLICIES ON storage.objects FOR THIS BUCKET, deliberately
 * — see §3 of the migration. So section B is not testing a policy expression,
 * it is testing that the ABSENCE of a policy denies, which is the property the
 * whole design rests on. If someone adds a permissive policy later "to make
 * uploads work", section B goes red and that is exactly the point.
 *
 * Runs against the LIVE project using .env.local, like every other verify
 * script here. It creates its own users, contractor rows and storage objects
 * and removes them in a finally block.
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
const BUCKET = "contractor-logos";

const admin = createClient(URL_, SVC, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "  PASS" : "  ****FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};
const head = (t) => { console.log(""); console.log(t); };

/** A real 1x1 PNG. Small, valid, and actually decodable as an image. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function mkUser(tag) {
  const email = `logolock-${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const password = randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error) throw new Error(`createUser ${tag}: ${error.message}`);
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error: e2 } = await c.auth.signInWithPassword({ email, password });
  if (e2) throw new Error(`signIn ${tag}: ${e2.message}`);
  return { id: data.user.id, client: c };
}

async function mkContractor(tag, ownerId) {
  const key = `${TEST_ROW_PREFIX}LOGO_${tag}_${randomUUID().slice(0, 8)}`;
  const slug = `testlogo-${tag.toLowerCase()}-${randomUUID().slice(0, 8)}`;
  const { error } = await admin.from("contractors").insert({
    dbpr_sync_key: key,
    license_number: `TESTLOGO${tag}`,
    license_type: "Certified General Contractor",
    qualifying_agent_name: `Test Agent ${tag}`,
    business_name: `Test Contractor ${tag}`,
    license_status: "Current,Active",
    city: "Davie",
    slug,
    claimed_by_user_id: ownerId ?? null,
    claimed_at: ownerId ? new Date().toISOString() : null,
    claim_tier: ownerId ? "claimed" : "unclaimed",
  });
  if (error) throw new Error(`insert contractor ${tag}: ${error.message}`);
  return { key, slug };
}

/** The real upload route: server mints a signed URL, browser PUTs to it. */
async function uploadAs(userClient, path) {
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) return { error };
  const r = await userClient.storage
    .from(BUCKET)
    .uploadToSignedUrl(path, data.token, PNG, { contentType: "image/png" });
  return { error: r.error ?? null };
}

const logoPath = async (key) =>
  (await admin.from("contractors").select("custom_logo_path").eq("dbpr_sync_key", key).single())
    .data?.custom_logo_path;

const objectExists = async (path) => {
  const folder = path.split("/")[0];
  const file = path.split("/").slice(1).join("/");
  const { data } = await admin.storage.from(BUCKET).list(folder);
  return (data ?? []).some((o) => o.name === file);
};

const createdUsers = [];
const createdKeys = [];
const createdPaths = [];

try {
  const A = await mkUser("a");
  const B = await mkUser("b");
  const C = await mkUser("c"); // signed in, claims nothing
  createdUsers.push(A.id, B.id, C.id);

  const a = await mkContractor("A", A.id);
  const b = await mkContractor("B", B.id);
  const free = await mkContractor("FREE", null);
  createdKeys.push(a.key, b.key, free.key);

  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });

  console.log("");
  console.log(`owner A = ${A.id} -> ${a.slug}`);
  console.log(`owner B = ${B.id} -> ${b.slug}`);

  // ────────────────────────────────────────────────────────
  head("── A. THE BUCKET IS CONFIGURED AS THE MIGRATION SAYS ───");
  {
    const { data: buckets } = await admin.storage.listBuckets();
    const logos = buckets.find((x) => x.id === BUCKET);
    ok("contractor-logos exists", !!logos, buckets.map((x) => x.id).join(", "));

    /**
     * ⚠ BAIL HERE, DO NOT CARRY ON. Caught on the first run of this file
     * against a database where the migration had not been applied: with no
     * bucket, allowed_mime_types is undefined, so `!mimes.includes('image/svg+xml')`
     * is TRUE and "NO svg" PASSED. Three of section A's assertions reported
     * green because the thing they were checking did not exist.
     *
     * A suite that partly passes on an unapplied migration is worse than one
     * that fails, because the summary line is the part anyone reads.
     */
    if (!logos) {
      console.log("");
      console.log("  ****STOP  The contractor-logos bucket does not exist, so every check");
      console.log("            below would be vacuous. Apply");
      console.log("            db/migrations/20260804_contractor_logo.sql and re-run.");
      fail++;
      throw new Error("MIGRATION_NOT_APPLIED");
    }

    ok("it is PUBLIC (a logo strangers cannot fetch is broken)", logos.public === true,
       `public=${logos.public}`);
    ok("2 MB limit", logos.file_size_limit === 2097152, String(logos.file_size_limit));
    const mimes = logos.allowed_mime_types ?? [];
    ok("JPEG/PNG/WEBP only", mimes.length === 3 &&
       ["image/jpeg", "image/png", "image/webp"].every((m) => mimes.includes(m)), mimes.join(", "));
    ok("NO svg (script carrier on a public page)", !mimes.includes("image/svg+xml"));
    ok("NO heic (Chrome and Firefox cannot render it)",
       !mimes.includes("image/heic") && !mimes.includes("image/heif"));
    ok("id-photos is still PRIVATE",
       buckets.find((x) => x.id === "id-photos")?.public === false);
  }

  // ────────────────────────────────────────────────────────
  head("── B. NOBODY WRITES AS THEMSELVES (no policy = denied) ─");
  {
    const path = `${a.slug}/logo-${randomUUID()}.png`;
    const { error } = await A.client.storage.from(BUCKET).upload(path, PNG, {
      contentType: "image/png",
    });
    ok("the OWNER cannot upload directly — only via a signed URL", !!error,
       error?.message ?? "ACCEPTED (a policy has been added)");
  }
  {
    const path = `${b.slug}/logo-${randomUUID()}.png`;
    const { error } = await A.client.storage.from(BUCKET).upload(path, PNG, {
      contentType: "image/png",
    });
    ok("A cannot upload into B's folder", !!error, error?.message ?? "ACCEPTED");
  }
  {
    const { error } = await anon.storage.from(BUCKET).upload(
      `${a.slug}/logo-${randomUUID()}.png`, PNG, { contentType: "image/png" });
    ok("anon cannot upload", !!error, error?.message ?? "ACCEPTED");
  }
  {
    const { error } = await anon.rpc("set_own_contractor_image", {
      p_dbpr_sync_key: a.key, p_kind: "logo", p_path: `${a.slug}/x.png`,
    });
    ok("anon cannot call the RPC", !!error, error?.message ?? "ACCEPTED");
  }

  // ────────────────────────────────────────────────────────
  head("── C. THE HAPPY PATH, THROUGH THE REAL ROUTE ───────────");
  const first = `${a.slug}/logo-${randomUUID()}.png`;
  createdPaths.push(first);
  {
    const { error } = await uploadAs(A.client, first);
    ok("owner CAN upload against a server-minted signed URL", !error, error?.message ?? "");
  }
  {
    const { data, error } = await A.client.rpc("set_own_contractor_image", {
      p_dbpr_sync_key: a.key, p_kind: "logo", p_path: first,
    });
    ok("owner CAN record it", !error, error?.message ?? "");
    ok("nothing was displaced on the first upload", data === null, JSON.stringify(data));
    ok("the column now holds the path", (await logoPath(a.key)) === first);
  }
  {
    const url = `${URL_}/storage/v1/object/public/${BUCKET}/${first}`;
    const r = await fetch(url);
    ok("the logo is publicly fetchable (the whole point)", r.ok, `HTTP ${r.status}`);
    ok("and it is served as an image", (r.headers.get("content-type") ?? "").startsWith("image/"),
       r.headers.get("content-type") ?? "(none)");
  }

  // ────────────────────────────────────────────────────────
  head("── D. POINTING AT SOMEBODY ELSE'S FILE ─────────────────");
  //
  // Storage permissions do not cover this. Without assert_own_photo_path(), a
  // contractor could put a rival's image on their own profile — and the delete
  // that accompanies their NEXT upload would remove it from the internet.
  const bPath = `${b.slug}/logo-${randomUUID()}.png`;
  createdPaths.push(bPath);
  await uploadAs(B.client, bPath);
  await B.client.rpc("set_own_contractor_image", {
    p_dbpr_sync_key: b.key, p_kind: "logo", p_path: bPath,
  });
  {
    const { error } = await A.client.rpc("set_own_contractor_image", {
      p_dbpr_sync_key: a.key, p_kind: "logo", p_path: bPath,
    });
    ok("A cannot record B's object as A's logo", !!error, error?.message ?? "ACCEPTED");
    ok("...and A's column is untouched", (await logoPath(a.key)) === first);
    ok("...and B's file still exists", await objectExists(bPath));
  }
  {
    const { error } = await A.client.rpc("set_own_contractor_image", {
      p_dbpr_sync_key: b.key, p_kind: "logo", p_path: `${b.slug}/whatever.png`,
    });
    ok("A cannot set B's logo at all", !!error, error?.message ?? "ACCEPTED");
  }
  {
    const { error } = await C.client.rpc("set_own_contractor_image", {
      p_dbpr_sync_key: free.key, p_kind: "logo", p_path: `${free.slug}/x.png`,
    });
    ok("a user with no claim cannot set an unclaimed profile's logo", !!error,
       error?.message ?? "ACCEPTED");
  }
  {
    const { error } = await A.client
      .from("contractors").update({ custom_logo_path: bPath }).eq("dbpr_sync_key", a.key);
    ok("owner cannot direct-UPDATE the column (revoked 20260803)",
       !!error || (await logoPath(a.key)) === first, error?.message ?? "ACCEPTED");
  }

  // ────────────────────────────────────────────────────────
  head("── E. MALFORMED INPUT IS REFUSED, READABLY ─────────────");
  const bad = [
    ["a nested path", `${a.slug}/sub/logo.png`],
    ["a traversal attempt", `${a.slug}/../${b.slug}/logo.png`],
    ["another slug entirely", `${b.slug}/logo.png`],
    ["a bare filename with no folder", "logo.png"],
    ["an SVG", `${a.slug}/logo.svg`],
    ["a HEIC", `${a.slug}/logo.heic`],
    ["no extension at all", `${a.slug}/logo`],
    ["an HTML file", `${a.slug}/logo.html`],
  ];
  for (const [label, path] of bad) {
    const { error } = await A.client.rpc("set_own_contractor_image", {
      p_dbpr_sync_key: a.key, p_kind: "logo", p_path: path,
    });
    ok(`refused: ${label}`, !!error, error?.message ?? "ACCEPTED");
  }
  for (const kind of ["banner", "LOGO", "", null]) {
    const { error } = await A.client.rpc("set_own_contractor_image", {
      p_dbpr_sync_key: a.key, p_kind: kind, p_path: first,
    });
    ok(`refused: kind ${JSON.stringify(kind)}`, !!error, error?.message ?? "ACCEPTED");
  }
  ok("A's logo survived every refusal above", (await logoPath(a.key)) === first);

  // ────────────────────────────────────────────────────────
  head("── F. REPLACE AND CLEAR, AND NO ORPHANS ────────────────");
  const second = `${a.slug}/logo-${randomUUID()}.png`;
  createdPaths.push(second);
  {
    await uploadAs(A.client, second);
    const { data } = await A.client.rpc("set_own_contractor_image", {
      p_dbpr_sync_key: a.key, p_kind: "logo", p_path: second,
    });
    ok("replacing returns the DISPLACED path, so the caller can delete it",
       data === first, JSON.stringify(data));
    ok("the column moved to the new path", (await logoPath(a.key)) === second);
  }
  {
    // What the Server Action does with that return value.
    await admin.storage.from(BUCKET).remove([first]);
    ok("the displaced object is gone from the bucket", !(await objectExists(first)));

    /**
     * ⚠ THE PLAIN PUBLIC URL KEEPS SERVING FOR A WHILE, AND THAT IS NOT A BUG.
     *
     * An earlier draft asserted `!r.ok` here and failed with HTTP 200 — the
     * object had been fetched moments earlier in section C, so the edge had it
     * cached, and the delete does not purge the CDN. §1 of the migration says
     * exactly this ("DELETION IS NOT INSTANT"), so the assertion was testing
     * something the design explicitly does not promise.
     *
     * A cache-busting query string is a distinct cache key, so it misses the
     * edge and reaches the origin. THAT is the authoritative question — is the
     * object actually gone — and it is what gets asserted.
     *
     * The cached status is reported, not asserted, because it depends on edge
     * state this harness does not control.
     */
    const busted = await fetch(
      `${URL_}/storage/v1/object/public/${BUCKET}/${first}?cachebust=${randomUUID()}`,
    );
    ok("and the ORIGIN no longer serves it", !busted.ok, `HTTP ${busted.status}`);

    const cached = await fetch(`${URL_}/storage/v1/object/public/${BUCKET}/${first}`);
    console.log(
      `          (the cached URL answers HTTP ${cached.status} — expected while the CDN` +
      ` holds it; nothing links to it, and a replacement always has a new path)`,
    );
  }
  {
    const { data } = await A.client.rpc("set_own_contractor_image", {
      p_dbpr_sync_key: a.key, p_kind: "logo", p_path: second,
    });
    ok("re-saving the SAME path displaces nothing (never delete what we just saved)",
       data === null, JSON.stringify(data));
  }
  {
    const { data, error } = await A.client.rpc("set_own_contractor_image", {
      p_dbpr_sync_key: a.key, p_kind: "logo", p_path: null,
    });
    ok("clearing works", !error, error?.message ?? "");
    ok("clearing returns the displaced path too", data === second, JSON.stringify(data));
    ok("the column is now null", (await logoPath(a.key)) === null);
  }
  {
    const { data } = await A.client.rpc("set_own_contractor_image", {
      p_dbpr_sync_key: a.key, p_kind: "owner_photo", p_path: second,
    });
    ok("the owner_photo slot works too (no design yet, but no migration needed)",
       data === null, JSON.stringify(data));
    await A.client.rpc("set_own_contractor_image", {
      p_dbpr_sync_key: a.key, p_kind: "owner_photo", p_path: null,
    });
  }

  console.log("");
  console.log("═".repeat(56));
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log("═".repeat(56));
} catch (e) {
  // The bail above is a controlled stop, not a crash — it has already said why.
  // Anything else is a genuine failure of the harness and must be visible.
  if (e.message !== "MIGRATION_NOT_APPLIED") throw e;
} finally {
  console.log("");
  console.log("cleanup…");
  for (const path of createdPaths) {
    await admin.storage.from(BUCKET).remove([path]);
  }
  for (const key of createdKeys) {
    await admin.from("contractors").delete().eq("dbpr_sync_key", key);
  }
  for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
  console.log(`removed ${createdPaths.length} objects, ${createdKeys.length} contractors, ${createdUsers.length} users`);
}
process.exit(fail === 0 ? 0 : 1);
