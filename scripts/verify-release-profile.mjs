/**
 * Negative-test harness for contractor-initiated profile release.
 *
 * Run AFTER applying db/migrations/20260804_release_own_profile.sql:
 *   node --no-warnings scripts/verify-release-profile.mjs
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS IS THE ONLY FUNCTION IN THE PRODUCT THAT GIVES SOMETHING UP.
 *
 * Everything else a contractor can call adds or edits. This one unlinks a
 * profile that a human verified against a government ID, and it cannot be
 * undone without that review happening again. So the questions are different
 * from the other suites':
 *
 *   · can somebody release a profile that is not theirs (sections A and B)
 *   · does the release leave the row in a coherent state, or half-released
 *     with claimed_by_user_id null and claim_tier still 'claimed' — the exact
 *     disagreement 20260803_claim_tier_on_approval.sql exists because of
 *     (section C)
 *   · does the audit trail survive it (section D) — a released profile must
 *     still be able to answer "was this person ever verified, and when did they
 *     hand it back"
 *   · is the logo actually GONE from the public bucket, not merely unlinked
 *     (section E). This is the one thing page-level gating cannot do.
 *
 * Runs against the LIVE project using .env.local. Creates its own users,
 * contractor rows, claims and storage objects, and removes them in a finally.
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
const BUCKET = "contractor-logos";

const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "  PASS" : "  ****FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};
const head = (t) => { console.log(""); console.log(t); };

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function mkUser(tag) {
  const email = `release-${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const password = randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser ${tag}: ${error.message}`);
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error: e2 } = await c.auth.signInWithPassword({ email, password });
  if (e2) throw new Error(`signIn ${tag}: ${e2.message}`);
  return { id: data.user.id, email, client: c };
}

/** A claimed profile with custom content, a logo object, and an approved claim. */
async function mkClaimedProfile(tag, owner) {
  const key = `TESTREL-${tag}-${randomUUID().slice(0, 8)}`;
  const slug = `testrel-${tag.toLowerCase()}-${randomUUID().slice(0, 8)}`;
  const { error } = await admin.from("contractors").insert({
    dbpr_sync_key: key,
    license_number: `TESTREL${tag}`,
    license_type: "Certified General Contractor",
    qualifying_agent_name: `Test Agent ${tag}`,
    business_name: `Test Contractor ${tag}`,
    license_status: "Current,Active",
    city: "Davie",
    slug,
    claimed_by_user_id: owner.id,
    claimed_at: new Date().toISOString(),
    claim_tier: "claimed",
    custom_about_text: "We build kitchens.",
    custom_email: "hello@example.com",
    custom_phone: "(954) 555-0100",
    custom_website_url: "https://example.com",
    custom_service_area: "Broward County",
  });
  if (error) throw new Error(`insert contractor ${tag}: ${error.message}`);

  // The logo, uploaded the way the app uploads it.
  const logoPath = `${slug}/logo-${randomUUID()}.png`;
  const { data: signed } = await admin.storage.from(BUCKET).createSignedUploadUrl(logoPath);
  await owner.client.storage
    .from(BUCKET)
    .uploadToSignedUrl(logoPath, signed.token, PNG, { contentType: "image/png" });
  await owner.client.rpc("set_own_contractor_image", {
    p_dbpr_sync_key: key, p_kind: "logo", p_path: logoPath,
  });

  // An approved claim, as approve_claim() would have left it.
  const claimId = randomUUID();
  const { error: claimError } = await admin.from("claims").insert({
    id: claimId,
    contractor_dbpr_sync_key: key,
    claimant_user_id: owner.id,
    claimant_name: `Test Agent ${tag}`,
    claimant_email: owner.email,
    id_photo_url: `${owner.id}/${claimId}.jpg`,
    id_photo_expires_at: new Date(Date.now() + 90 * 86400_000).toISOString(),
    status: "approved",
    reviewed_at: new Date().toISOString(),
  });
  if (claimError) throw new Error(`insert claim ${tag}: ${claimError.message}`);

  return { key, slug, logoPath, claimId };
}

const row = async (key) =>
  (await admin
    .from("contractors")
    .select("claimed_by_user_id, claimed_at, claim_tier, custom_logo_path, custom_owner_photo_path, custom_about_text, custom_email, custom_phone, custom_website_url, custom_service_area")
    .eq("dbpr_sync_key", key)
    .single()).data;

const claimRow = async (id) =>
  (await admin.from("claims").select("status, released_at, reviewed_at").eq("id", id).single()).data;

const objectExists = async (path) => {
  const { data } = await admin.storage.from(BUCKET).list(path.split("/")[0]);
  return (data ?? []).some((o) => o.name === path.split("/").slice(1).join("/"));
};

const users = [];
const keys = [];
const paths = [];

try {
  const A = await mkUser("a");
  const B = await mkUser("b");
  const C = await mkUser("c"); // signed in, claims nothing
  users.push(A.id, B.id, C.id);

  const a = await mkClaimedProfile("A", A);
  const b = await mkClaimedProfile("B", B);
  keys.push(a.key, b.key);
  paths.push(a.logoPath, b.logoPath);

  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const before = await row(a.key);

  console.log("");
  console.log(`owner A = ${A.id} -> ${a.slug}`);
  console.log(`owner B = ${B.id} -> ${b.slug}`);

  // ────────────────────────────────────────────────────────
  head("── A. ONLY THE OWNER CAN RELEASE ───────────────────────");
  {
    const { error } = await anon.rpc("release_own_contractor_profile", { p_dbpr_sync_key: a.key });
    ok("anon cannot call it", !!error, error?.message ?? "ACCEPTED");
    ok("...and A's profile is untouched", (await row(a.key))?.claimed_by_user_id === A.id);
  }
  {
    const { error } = await B.client.rpc("release_own_contractor_profile", { p_dbpr_sync_key: a.key });
    ok("B cannot release A's profile", !!error, error?.message ?? "ACCEPTED");
    ok("...and A's profile is untouched", (await row(a.key))?.claimed_by_user_id === A.id);
  }
  {
    const { error } = await C.client.rpc("release_own_contractor_profile", { p_dbpr_sync_key: a.key });
    ok("a user with no claim cannot release it", !!error, error?.message ?? "ACCEPTED");
  }
  {
    const { error } = await A.client.rpc("release_own_contractor_profile", {
      p_dbpr_sync_key: `NOPE-${randomUUID()}`,
    });
    ok("releasing a profile that does not exist is refused", !!error, error?.message ?? "ACCEPTED");
  }

  // ────────────────────────────────────────────────────────
  head("── B. THE OWNER CAN, AND GETS THE PATHS BACK ───────────");
  let returned;
  {
    const { data, error } = await A.client.rpc("release_own_contractor_profile", {
      p_dbpr_sync_key: a.key,
    });
    returned = (data ?? [])[0];
    ok("owner CAN release", !error, error?.message ?? "");
    ok("it returns the logo path the caller must delete",
       returned?.logo_path === a.logoPath, JSON.stringify(returned));
    ok("owner_photo_path comes back null (no UI for it yet)",
       returned?.owner_photo_path === null, JSON.stringify(returned?.owner_photo_path));
  }

  // ────────────────────────────────────────────────────────
  head("── C. THE ROW IS COHERENT, NOT HALF-RELEASED ───────────");
  {
    const after = await row(a.key);
    ok("claimed_by_user_id is null", after?.claimed_by_user_id === null);
    ok("claimed_at is null", after?.claimed_at === null);
    // The disagreement 20260803_claim_tier_on_approval.sql exists because of.
    ok("claim_tier is back to 'unclaimed'", after?.claim_tier === "unclaimed", after?.claim_tier);
    ok("custom_logo_path is cleared", after?.custom_logo_path === null);
    ok("custom_owner_photo_path is cleared", after?.custom_owner_photo_path === null);
  }
  {
    const after = await row(a.key);
    ok("custom_about_text is KEPT (hidden, not deleted)",
       after?.custom_about_text === before.custom_about_text, after?.custom_about_text ?? "(null)");
    ok("contact columns are KEPT",
       after?.custom_email === before.custom_email &&
       after?.custom_phone === before.custom_phone &&
       after?.custom_website_url === before.custom_website_url &&
       after?.custom_service_area === before.custom_service_area);
  }

  // ────────────────────────────────────────────────────────
  head("── D. THE AUDIT TRAIL SURVIVES ─────────────────────────");
  {
    const c = await claimRow(a.claimId);
    ok("the claim is STILL status='approved' (the ID really was checked)",
       c?.status === "approved", c?.status);
    ok("released_at is stamped", !!c?.released_at, c?.released_at ?? "(null)");
    ok("reviewed_at is untouched", !!c?.reviewed_at);
  }
  {
    // Releasing twice must not overwrite the first release's timestamp with a
    // second one — the row would then misreport when the listing was given up.
    const first = (await claimRow(a.claimId))?.released_at;
    const { error } = await A.client.rpc("release_own_contractor_profile", {
      p_dbpr_sync_key: a.key,
    });
    ok("releasing an already-released profile is refused", !!error, error?.message ?? "ACCEPTED");
    ok("...and released_at keeps its original value",
       (await claimRow(a.claimId))?.released_at === first);
  }

  // ────────────────────────────────────────────────────────
  head("── E. THE LOGO IS ACTUALLY GONE ────────────────────────");
  {
    ok("the object still exists until the caller removes it", await objectExists(a.logoPath),
       "Postgres cannot delete storage objects — this is the contract");
    // What app/manage/[slug]/settings/actions.ts does with the returned path.
    await admin.storage.from(BUCKET).remove([returned.logo_path]);
    ok("after the caller removes it, it is gone from the bucket",
       !(await objectExists(a.logoPath)));
    const busted = await fetch(
      `${URL_}/storage/v1/object/public/${BUCKET}/${a.logoPath}?cachebust=${randomUUID()}`,
    );
    ok("and the origin no longer serves it", !busted.ok, `HTTP ${busted.status}`);
  }

  // ────────────────────────────────────────────────────────
  head("── F. THE PROFILE IS CLAIMABLE AGAIN ───────────────────");
  {
    // Someone else takes it, exactly as approve_claim() would.
    const { error } = await admin.from("contractors").update({
      claimed_by_user_id: C.id, claimed_at: new Date().toISOString(), claim_tier: "claimed",
    }).eq("dbpr_sync_key", a.key);
    ok("a different user can be linked to it", !error, error?.message ?? "");
    ok("and the new owner can release it in turn",
       !(await C.client.rpc("release_own_contractor_profile", { p_dbpr_sync_key: a.key })).error);
  }
  {
    // B's profile was never touched by any of this.
    const bRow = await row(b.key);
    ok("B's profile is untouched throughout", bRow?.claimed_by_user_id === B.id &&
       bRow?.claim_tier === "claimed" && bRow?.custom_logo_path === b.logoPath);
  }

  console.log("");
  console.log("═".repeat(56));
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log("═".repeat(56));
} finally {
  console.log("");
  console.log("cleanup…");
  for (const p of paths) await admin.storage.from(BUCKET).remove([p]);
  for (const k of keys) {
    // claims cascade from contractors, but delete explicitly so this stays
    // honest if that ever changes.
    await admin.from("claims").delete().eq("contractor_dbpr_sync_key", k);
    await admin.from("contractors").delete().eq("dbpr_sync_key", k);
  }
  for (const id of users) await admin.auth.admin.deleteUser(id);
  console.log(`removed ${keys.length} profiles, ${paths.length} objects, ${users.length} users`);
}
process.exit(fail === 0 ? 0 : 1);
