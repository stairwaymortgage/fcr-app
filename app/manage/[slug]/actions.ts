"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { getUser } from "@/lib/auth";
import {
  LOGO_BUCKET,
  LOGO_EXTENSIONS,
  LOGO_MAX_BYTES,
  LOGO_MIME_TYPES,
} from "@/lib/logo";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import type { EditableValues, SaveState } from "./save-state";

/**
 * Profile save.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THIS FILE MAY EXPORT ONLY ASYNC FUNCTIONS. NOTHING ELSE. EVER.
 *
 * "use server" turns every export into a server reference, and a value that is
 * not an async function cannot be one. Next refuses at runtime with
 *
 *   A "use server" file can only export async functions, found object.
 *
 * and — this is the part that costs a day — tsc, next lint and next build all
 * pass first. The check lives in the server runtime. It shipped once already:
 * EMPTY_SAVE_STATE was exported from here, the page rendered fine, and the
 * first thing to notice was a contractor pressing Save (digest 1753474867).
 *
 * Types are fine; they are erased before any of this applies. Anything with a
 * runtime value belongs in ./save-state.ts.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS FILE DOES NOT DECIDE WHO MAY WRITE. THE DATABASE DOES.
 *
 * Every value below reaches update_own_contractor_profile(), which re-checks
 * claimed_by_user_id = auth.uid() inside the transaction and only ever touches
 * five columns. The page's own ownership check and the middleware gate are both
 * upstream of this, and neither is the control — a Server Action is reachable
 * without the page ever rendering, and middleware does not run for Server
 * Actions at all.
 *
 * So p_dbpr_sync_key being attacker-supplied is fine by construction. Post a
 * different contractor's key and the RPC raises "You do not manage this
 * profile."
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FULL REPLACE, NOT A PATCH. All five values are sent every time, including the
 * empty ones, because that is the contract the RPC documents: a blank argument
 * clears its column. The form submits every field on every save, so clearing
 * the website box and pressing Save means exactly what it looks like.
 */

/**
 * SQLSTATEs raised deliberately by update_own_contractor_profile().
 *
 * Only these are shown to the contractor verbatim. They are sentences we wrote
 * for them to read ("Your About text is 1400 characters. The limit is 1200.").
 * Anything else — a connection failure, a constraint we did not anticipate —
 * gets a generic line and a server-side log, because an unplanned Postgres
 * error message is written for an operator and can name internals.
 */
const READABLE_CODES = new Set([
  "42501", // not signed in / not your profile
  "P0002", // no such profile
  "22001", // a length cap
  "22023", // a format check
]);

/** Slug shape, matching the one middleware anchors its claim-path regex on. */
const SLUG_SHAPE = /^[a-z0-9-]{1,200}$/;

export async function saveProfile(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const user = await getUser();
  if (!user) {
    return { ok: false, error: "Your session has expired. Sign in again to save." };
  }

  const syncKey = String(formData.get("dbpr_sync_key") ?? "");
  const slug = String(formData.get("slug") ?? "");

  const values: EditableValues = {
    about: String(formData.get("about") ?? ""),
    website: String(formData.get("website") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    serviceArea: String(formData.get("service_area") ?? ""),
  };

  const db = createClient();
  const { error } = await db.rpc("update_own_contractor_profile", {
    p_dbpr_sync_key: syncKey,
    p_about: values.about,
    p_website: values.website,
    p_email: values.email,
    p_phone: values.phone,
    p_service_area: values.serviceArea,
  });

  if (error) {
    console.warn("[manage] profile save refused", {
      syncKey,
      code: error.code,
      message: error.message,
    });
    return {
      ok: false,
      error: READABLE_CODES.has(error.code ?? "")
        ? error.message
        : "That didn't save. Please try again in a moment.",
      values,
    };
  }

  /**
   * The public profile is revalidated as well as this page — an edit that shows
   * in the editor but not on the page the contractor just published to would
   * read as the save having silently failed.
   *
   * The slug is checked for shape rather than trusted. It arrives in the form
   * and is used for nothing but these two paths, so the worst a forged value
   * could do is purge someone else's cache entry — a nuisance, not a breach,
   * but there is no reason to accept an arbitrary string into revalidatePath.
   */
  if (SLUG_SHAPE.test(slug)) {
    revalidatePath(`/contractor/${slug}`);
    revalidatePath(`/manage/${slug}`);
  }

  return { ok: true, error: null };
}


/**
 * ===========================================================================
 * THE LOGO
 *
 * THE FILE GOES BROWSER → STORAGE, NOT THROUGH A SERVER ACTION. Same route the
 * claim flow takes and for the same two reasons (ClaimForm.tsx:26-36): action
 * bodies are capped at 1 MB by default, and there is no value in streaming
 * image bytes through the app server on their way to a bucket.
 *
 *   1. createLogoUploadTarget() — the server checks ownership, builds the path
 *      from the profile's OWN slug, and mints a one-shot upload token.
 *   2. the browser PUTs the bytes to that URL.
 *   3. saveUploadedLogo() — records the path through the RPC and deletes the
 *      object it displaced.
 *
 * NO PART OF THE PATH IS CLIENT-SUPPLIED, which is stronger than validating a
 * path the client chose. Step 3 re-checks ownership inside the database anyway,
 * via assert_own_photo_path().
 *
 * ⚠ A SIGNED UPLOAD URL BYPASSES RLS — it is authorised by its token, not by
 * the caller's role. That is why there are no storage policies on this bucket
 * and why step 1 is the ownership boundary. See §3 of
 * db/migrations/20260804_contractor_logo.sql.
 * ===========================================================================
 */

/** What the uploader gets back. A failure is a sentence, never a raw error. */
type UploadTarget =
  | { ok: true; path: string; token: string }
  | { ok: false; error: string };

/**
 * Resolve a sync key to a profile this user actually manages.
 *
 * Returns the slug, because the slug is the storage folder and it must come
 * from the database rather than from the caller — a client-supplied slug is
 * exactly how a contractor would write into someone else's folder.
 */
async function ownedSlug(
  syncKey: string,
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Your session has expired. Sign in again." };

  const db = createClient();
  const { data, error } = await db
    .from("contractors")
    .select("slug, claimed_by_user_id")
    .eq("dbpr_sync_key", syncKey)
    .maybeSingle();

  if (error) {
    console.error("[manage] logo ownership lookup failed", error.message);
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  // One message for "no such profile" and "not yours", so this cannot be used
  // to probe which profiles exist or have owners. Same rule as the RPC's.
  if (!data || data.claimed_by_user_id !== user.id || !data.slug) {
    return { ok: false, error: "You do not manage this profile." };
  }

  return { ok: true, slug: data.slug };
}

export async function createLogoUploadTarget(input: {
  syncKey: string;
  mimeType: string;
  size: number;
}): Promise<UploadTarget> {
  const owned = await ownedSlug(input.syncKey);
  if (!owned.ok) return owned;

  /**
   * Re-checked here even though the uploader checked first and the bucket
   * checks last. This is the layer that decides the FILENAME's extension, so a
   * type it does not recognise must not reach the switch below and default to
   * something plausible.
   */
  if (!(LOGO_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    return { ok: false, error: "That file type isn't accepted. Use a JPG, PNG or WEBP image." };
  }
  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > LOGO_MAX_BYTES) {
    return { ok: false, error: "That image is larger than 2 MB." };
  }

  /**
   * A FRESH UUID EVERY TIME, never a fixed name like "logo.jpg".
   *
   * Two reasons, both load-bearing. The bucket is public and therefore
   * CDN-cached, so re-using a path would keep serving the OLD image after a
   * replacement — indistinguishable from "the upload didn't work". And there is
   * no UPDATE policy anywhere on this bucket, so a path that already holds an
   * object cannot be written again at all.
   */
  const ext = LOGO_EXTENSIONS[input.mimeType] ?? "jpg";
  const path = `${owned.slug}/logo-${randomUUID()}.${ext}`;

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(LOGO_BUCKET).createSignedUploadUrl(path);

  if (error || !data) {
    console.error("[manage] could not create logo upload URL", { message: error?.message });
    return { ok: false, error: "We couldn't start the upload. Please try again." };
  }

  return { ok: true, path, token: data.token };
}

/**
 * Record an uploaded logo, and remove the one it replaced.
 *
 * THE DELETE IS BEST-EFFORT AND THE SAVE IS NOT. If the object cannot be
 * removed, the contractor still has the logo they just uploaded and the profile
 * is correct; what is left behind is an unreferenced file in a bucket. Failing
 * the whole action over that would report a problem the contractor cannot act
 * on, about an outcome that already succeeded.
 */
export async function saveUploadedLogo(input: {
  syncKey: string;
  path: string;
}): Promise<{ ok: boolean; error: string | null }> {
  return writeLogoPath(input.syncKey, input.path);
}

/** Remove the logo entirely. A plain <form action> — no client JS required. */
export async function clearLogo(formData: FormData): Promise<void> {
  const syncKey = String(formData.get("dbpr_sync_key") ?? "");
  await writeLogoPath(syncKey, null);
}

/**
 * The one place either of the above writes.
 *
 * The RPC returns the PATH IT DISPLACED — Postgres cannot delete a storage
 * object, so without this the previous logo would sit in a public bucket
 * forever, still served at its old URL.
 */
async function writeLogoPath(
  syncKey: string,
  path: string | null,
): Promise<{ ok: boolean; error: string | null }> {
  const owned = await ownedSlug(syncKey);
  if (!owned.ok) return { ok: false, error: owned.error };

  const db = createClient();
  const { data: displaced, error } = await db.rpc("set_own_contractor_image", {
    p_dbpr_sync_key: syncKey,
    p_kind: "logo",
    p_path: path,
  });

  if (error) {
    console.warn("[manage] logo save refused", { code: error.code, message: error.message });
    return {
      ok: false,
      // The RPC's own messages are sentences written for a contractor to read
      // ("Your logo must be a JPG, PNG or WEBP file."). Anything else is
      // unplanned and gets a generic line — an unexpected Postgres error is
      // written for an operator and can name internals.
      error: READABLE_CODES.has(error.code ?? "")
        ? error.message
        : "That didn't save. Please try again in a moment.",
    };
  }

  if (typeof displaced === "string" && displaced.length > 0) {
    const admin = createAdminClient();
    const { error: removeError } = await admin.storage.from(LOGO_BUCKET).remove([displaced]);
    if (removeError) {
      // Loud, because the leak is invisible from the app: nothing references
      // this object any more, so nothing will ever surface it again.
      console.error("[manage] orphaned logo object — delete it by hand", {
        path: displaced,
        message: removeError.message,
      });
    }
  }

  revalidatePath(`/contractor/${owned.slug}`);
  revalidatePath(`/manage/${owned.slug}`);

  return { ok: true, error: null };
}
