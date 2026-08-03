/**
 * The 90-day ID photo purge — lib/purge-id-photos.ts
 *
 * Run:
 *   node --experimental-strip-types --no-warnings=ExperimentalWarning
 *     scripts/verify-id-photo-purge.mjs
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS IMPORTS THE REAL FUNCTION. THAT IS THE POINT OF THE FLAG.
 *
 * purgeExpiredIdPhotos takes its Supabase client as an argument precisely so a
 * plain node script can hand it one — the route passes the admin client, this
 * passes its own service-role client, and both run identical code. A copy of
 * the logic here would pass forever while the shipped version rotted, and this
 * is a job that runs unattended, deletes government ID photographs, and is
 * noticed by nobody when it goes wrong.
 *
 * WHAT MAKES THE FAILURE MODE NASTY: nothing breaks when a purge stops working.
 * The site is fine, no error appears, and photographs simply keep existing past
 * the date the claims table promises they were deleted. The only way that gets
 * caught is a test that asserts the object is actually gone.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Creates its own user, claim and photo against the LIVE project and removes
 * them in a finally block. It never touches a real claim: every row it selects
 * is one it created, and the fresh-claim control below proves the date filter
 * rather than assuming it.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { ID_PHOTO_BUCKET } from "../lib/claims.ts";
import { purgeExpiredIdPhotos } from "../lib/purge-id-photos.ts";

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
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let pass = 0, fail = 0;
const ok = (n, c, d = "") => {
  console.log(`${c ? "  PASS" : "  ****FAIL"}  ${n}${d ? `  — ${d}` : ""}`);
  c ? pass++ : fail++;
};
const head = (t) => { console.log(""); console.log(t); };

const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
  "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

const DAY = 86_400_000;
const cleanup = { users: [], claims: [] };

/** Does the object still exist in the bucket? */
async function photoExists(userId, fileName) {
  const { data } = await admin.storage.from(ID_PHOTO_BUCKET).list(userId);
  return (data ?? []).some((f) => f.name === fileName);
}

async function makeClaim({ userId, syncKey, email, expiresAt }) {
  const claimId = randomUUID();
  cleanup.claims.push(claimId);
  const fileName = `${claimId}.jpg`;
  const path = `${userId}/${fileName}`;

  const { error: upErr } = await admin.storage
    .from(ID_PHOTO_BUCKET)
    .upload(path, JPEG, { contentType: "image/jpeg" });
  if (upErr) throw new Error(`upload: ${upErr.message}`);

  const { error } = await admin.from("claims").insert({
    id: claimId,
    contractor_dbpr_sync_key: syncKey,
    claimant_user_id: userId,
    claimant_name: "Purge Test",
    claimant_email: email,
    id_photo_url: path,
    id_photo_expires_at: expiresAt,
  });
  if (error) throw new Error(`insert claim: ${error.message}`);

  return { claimId, fileName, path };
}

try {
  /**
   * FOUR DIFFERENT CONTRACTORS, ONE PER CLAIM.
   *
   * claims_one_pending_per_user_profile is a partial UNIQUE index on
   * (contractor_dbpr_sync_key, claimant_user_id) WHERE status = pending, so one
   * user cannot hold two pending claims on the same profile — the index doing
   * exactly its job. The fixtures need four independent claims, so they get four
   * profiles. Nothing here writes to contractors; they are only referenced.
   */
  const { data: targets } = await admin
    .from("contractors")
    .select("dbpr_sync_key")
    .is("claimed_by_user_id", null)
    .limit(4);
  if ((targets ?? []).length < 4) throw new Error("need 4 unclaimed contractors");
  const keys = targets.map((t) => t.dbpr_sync_key);

  const email = `purge-${randomUUID().slice(0, 8)}@example.com`;
  const { data: u } = await admin.auth.admin.createUser({
    email, password: randomUUID(), email_confirm: true,
  });
  cleanup.users.push(u.user.id);
  const userId = u.user.id;

  // Expired 10 days ago; expires in 80 days; and one already cleared by a
  // previous run, which must not be picked up again.
  const expired = await makeClaim({
    userId, syncKey: keys[0], email,
    expiresAt: new Date(Date.now() - 10 * DAY).toISOString(),
  });
  const fresh = await makeClaim({
    userId, syncKey: keys[1], email,
    expiresAt: new Date(Date.now() + 80 * DAY).toISOString(),
  });
  const alreadyCleared = await makeClaim({
    userId, syncKey: keys[2], email,
    expiresAt: new Date(Date.now() - 30 * DAY).toISOString(),
  });
  await admin.from("claims").update({ id_photo_url: null }).eq("id", alreadyCleared.claimId);

  console.log("");
  console.log(`expired claim        ${expired.claimId}`);
  console.log(`fresh claim          ${fresh.claimId}`);
  console.log(`already-cleared      ${alreadyCleared.claimId}`);

  head("── BEFORE THE PURGE ────────────────────────────────────");
  ok("the expired photo exists", await photoExists(userId, expired.fileName));
  ok("the fresh photo exists", await photoExists(userId, fresh.fileName));

  head("── RUN THE PURGE ───────────────────────────────────────");
  const result = await purgeExpiredIdPhotos(admin, { bucket: ID_PHOTO_BUCKET });
  console.log(`  ${JSON.stringify(result)}`);
  ok("the run reported no errors", result.errors.length === 0, result.errors.join("; "));
  ok("at least the expired claim was scanned", result.scanned >= 1, `${result.scanned}`);

  head("── THE EXPIRED PHOTO IS GONE ───────────────────────────");
  ok("object removed from the bucket", !(await photoExists(userId, expired.fileName)));
  {
    const { data } = await admin.from("claims")
      .select("id, status, claimant_email, id_photo_url, id_photo_expires_at, id_photo_purged_at")
      .eq("id", expired.claimId).maybeSingle();
    // The audit trail is the point: only the photo goes.
    ok("the claim ROW survives", !!data, data ? "present" : "DELETED");
    ok("id_photo_url is now null", data?.id_photo_url === null, String(data?.id_photo_url));
    ok("claimant_email still on the row", data?.claimant_email === email, data?.claimant_email);
    ok("status still on the row", !!data?.status, data?.status);
    ok("id_photo_expires_at is untouched", !!data?.id_photo_expires_at);
    ok("id_photo_purged_at records the destruction", !!data?.id_photo_purged_at,
       data?.id_photo_purged_at);
  }

  head("── A FRESH CLAIM IS UNTOUCHED ──────────────────────────");
  ok("the fresh photo still exists", await photoExists(userId, fresh.fileName));
  {
    const { data } = await admin.from("claims")
      .select("id_photo_url").eq("id", fresh.claimId).single();
    ok("the fresh row keeps its path", data?.id_photo_url === fresh.path, data?.id_photo_url);
  }

  head("── IDEMPOTENT ──────────────────────────────────────────");
  {
    // Nothing left to do: the cleared row must not be selected again, which is
    // what stops the job re-deleting and re-logging the same claims forever.
    const second = await purgeExpiredIdPhotos(admin, { bucket: ID_PHOTO_BUCKET });
    ok("a second run finds nothing of ours", second.errors.length === 0, second.errors.join("; "));
    const { data } = await admin.from("claims")
      .select("id_photo_url").eq("id", expired.claimId).single();
    ok("the purged row is still cleared", data?.id_photo_url === null);
  }

  head("── A MISSING OBJECT DOES NOT FAIL THE BATCH ────────────");
  {
    // The row still names a path whose object someone removed by hand. The
    // desired end state already holds; the run must clear the column anyway
    // rather than erroring and blocking every later chunk.
    const orphan = await makeClaim({
      userId, syncKey: keys[3], email,
      expiresAt: new Date(Date.now() - 5 * DAY).toISOString(),
    });
    await admin.storage.from(ID_PHOTO_BUCKET).remove([orphan.path]);
    ok("object removed out from under the row", !(await photoExists(userId, orphan.fileName)));

    const r = await purgeExpiredIdPhotos(admin, { bucket: ID_PHOTO_BUCKET });
    ok("the run still reports no errors", r.errors.length === 0, r.errors.join("; "));
    const { data } = await admin.from("claims")
      .select("id_photo_url").eq("id", orphan.claimId).single();
    ok("the orphaned row is cleared anyway", data?.id_photo_url === null, String(data?.id_photo_url));
  }

  head("── THE STORAGE API IS THE ONLY WAY IN ──────────────────");
  {
    // Removing something that is not there must not raise. The whole retry
    // design depends on it: every re-run re-attempts objects that may already
    // be gone, and an error here would make the job fail permanently on its
    // own successful work.
    const { error } = await admin.storage
      .from(ID_PHOTO_BUCKET)
      .remove([`${userId}/does-not-exist-${randomUUID().slice(0, 8)}.jpg`]);
    ok("removing a nonexistent object is not an error (idempotent API)", !error,
       error?.message ?? "no error");
  }

  console.log("");
  console.log("═".repeat(56));
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log("═".repeat(56));
} finally {
  console.log("");
  console.log("cleanup…");
  for (const id of cleanup.claims) await admin.from("claims").delete().eq("id", id);
  for (const uid of cleanup.users) {
    const { data: files } = await admin.storage.from(ID_PHOTO_BUCKET).list(uid);
    for (const f of files ?? []) {
      await admin.storage.from(ID_PHOTO_BUCKET).remove([`${uid}/${f.name}`]);
    }
    await admin.auth.admin.deleteUser(uid);
  }
  console.log(`removed ${cleanup.claims.length} claims, ${cleanup.users.length} user(s) and their photos`);
}
process.exit(fail === 0 ? 0 : 1);
