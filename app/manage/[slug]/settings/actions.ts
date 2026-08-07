"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { revalidateListings } from "@/lib/revalidate";

import { getUser } from "@/lib/auth";
import { LOGO_BUCKET } from "@/lib/logo";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Releasing a claimed profile.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THIS FILE MAY EXPORT ONLY ASYNC FUNCTIONS. NOTHING ELSE. EVER.
 *
 * "use server" turns every export into a server reference. tsc, next lint and
 * next build all pass on a violation; the runtime does not. It has shipped once
 * in this codebase already — see the docblock in ../actions.ts.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TWO CHECKS, AND ONLY ONE OF THEM IS A SECURITY CONTROL.
 *
 * release_own_contractor_profile() re-checks claimed_by_user_id = auth.uid()
 * inside the transaction. That is what stops someone releasing a profile that
 * is not theirs, and it holds whether this file is reached through the form,
 * through curl, or not at all.
 *
 * The typed confirmation is NOT that. It is a deliberateness check — the only
 * thing standing between a stray click and an hour of re-verification — and it
 * is enforced here rather than in the browser because a Server Action is a
 * public HTTP endpoint and `required` on an input means nothing to a POST that
 * never rendered the form.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Codes the settings page maps to sentences. Never a raw Postgres message. */
type ReleaseError = "confirm" | "notyours" | "gone" | "failed";

/**
 * Both sides of the confirmation go through this before comparison.
 *
 * DELIBERATELY FORGIVING. The phrase is a licence number or a business name
 * read off the screen and retyped, so case, runs of whitespace and punctuation
 * are noise — "ACECA CONSTRUCTION, LLC" and "aceca construction llc" are the
 * same intent, and refusing the second would teach a contractor that the button
 * is broken rather than that they mistyped. It is a confirmation, not a
 * password: the security question was already answered by the session.
 */
function normalize(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function back(slug: string, error: ReleaseError): never {
  redirect(`/manage/${slug}/settings?e=${error}`);
}

export async function releaseProfile(formData: FormData): Promise<void> {
  const user = await getUser();
  const slugRaw = String(formData.get("slug") ?? "");
  // Shape-checked before it reaches any redirect — this value ends up in a
  // Location header. Same rule as submitInquiry's.
  const slug = /^[a-z0-9-]{1,200}$/.test(slugRaw) ? slugRaw : null;
  if (!slug) redirect("/dashboard");
  if (!user) redirect(`/login?next=${encodeURIComponent(`/manage/${slug}/settings`)}`);

  const syncKey = String(formData.get("dbpr_sync_key") ?? "");
  const typed = String(formData.get("confirm") ?? "");
  const expected = String(formData.get("confirm_expected") ?? "");

  /**
   * ⚠ confirm_expected COMES FROM THE FORM, so a caller can set both sides and
   * satisfy this check trivially. That is fine and worth being explicit about:
   * the phrase is not a secret and never was — it is printed on the page next
   * to the box. Anyone crafting a POST has already demonstrated the
   * deliberateness this check exists to require. The ownership boundary is the
   * RPC's, and it cannot be posted around.
   *
   * The alternative — re-reading the licence number server-side — would be one
   * more query to make a non-control marginally harder to bypass.
   */
  if (!expected || normalize(typed) !== normalize(expected)) {
    back(slug, "confirm");
  }

  const db = createClient();
  const { data, error } = await db.rpc("release_own_contractor_profile", {
    p_dbpr_sync_key: syncKey,
  });

  if (error) {
    console.warn("[settings] release refused", { code: error.code, message: error.message });
    const known: Record<string, ReleaseError> = { "42501": "notyours", P0002: "gone" };
    back(slug, known[error.code ?? ""] ?? "failed");
  }

  /**
   * The RPC hands back the storage paths it cleared, because Postgres cannot
   * delete a storage object. THE LOGO MUST ACTUALLY GO: it lives in a public
   * bucket, so unlike the custom text — which the public page hides the moment
   * isClaimed() turns false — it stays fetchable by URL to anyone who has it
   * until the object itself is removed.
   *
   * A failure here is logged loudly rather than surfaced. The release has
   * already happened and is the outcome the contractor asked for; what is left
   * is an orphaned file only we can see, and only we can fix.
   */
  const rows = (data ?? []) as { logo_path: string | null; owner_photo_path: string | null }[];
  const paths = rows
    .flatMap((r) => [r.logo_path, r.owner_photo_path])
    .filter((p): p is string => typeof p === "string" && p.length > 0);

  if (paths.length > 0) {
    const admin = createAdminClient();
    const { error: removeError } = await admin.storage.from(LOGO_BUCKET).remove(paths);
    if (removeError) {
      console.error("[settings] released profile left orphaned image objects", {
        paths,
        message: removeError.message,
      });
    }
  }

  // The public profile reverts to its unclaimed state, and /manage/[slug] will
  // now 404 for this user — both must be rebuilt rather than served stale.
  revalidatePath(`/contractor/${slug}`);
  revalidatePath(`/manage/${slug}`);
  /**
   * A release clears claim_tier back to 'unclaimed', which the listing pages
   * render as a badge. They are statically cached for 24 hours as of
   * 2026-08-07, so without this the profile would show as unclaimed while every
   * listing still showed it claimed, for up to a day.
   */
  revalidateListings();

  redirect(`/dashboard?released=${encodeURIComponent(slug)}`);
}
