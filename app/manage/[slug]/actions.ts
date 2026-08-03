"use server";

import { revalidatePath } from "next/cache";

import { getUser } from "@/lib/auth";
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
