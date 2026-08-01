"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { getUser, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Claim decisions.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THESE CALL RPCs, NOT UPDATEs, AND THAT IS THE POINT.
 *
 * Approving means two writes — the claims row and
 * contractors.claimed_by_user_id — and only the second grants anything. Doing
 * them as two statements from here would leave the same half-applied state the
 * runbook had to warn about, just moved into TypeScript: an error or a redeploy
 * between the two and the claim reads approved while the contractor still sees
 * an unclaimed profile.
 *
 * approve_claim() does both inside one transaction. There is no longer a code
 * path that can do the first without the second.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ADMIN'S OWN SESSION, NOT THE SERVICE-ROLE KEY.
 *
 * Deliberately NOT lib/supabase/admin.ts. The RPC checks is_admin() against the
 * caller's JWT, and it records auth.uid() as reviewed_by_user_id. Called with
 * service-role there is no role claim to check and no reviewer to record — the
 * function would refuse, and if it didn't, every decision would be attributed
 * to nobody.
 *
 * So the database is the last word on whether this caller may decide, rather
 * than a check in this file that a future refactor could drop.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Belt and braces: refuse here too, so a non-admin never reaches the RPC. */
async function requireAdminOr404() {
  const user = await getUser();
  if (!user || !isAdmin(user)) notFound();
  return user;
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function back(params: Record<string, string>): never {
  redirect(`/admin/claims?${new URLSearchParams(params).toString()}`);
}

export async function approveClaim(formData: FormData): Promise<void> {
  await requireAdminOr404();

  const claimId = String(formData.get("claim_id") ?? "");
  if (!UUID_SHAPE.test(claimId)) back({ error: "That claim id was not valid." });

  const notes = String(formData.get("admin_notes") ?? "").trim().slice(0, 2000);

  const db = createClient();
  const { error } = await db.rpc("approve_claim", {
    p_claim_id: claimId,
    p_notes: notes || null,
  });

  if (error) {
    console.error("[admin] approve_claim failed", { claimId, code: error.code, message: error.message });
    // The function raises readable sentences ("claim ... is not pending",
    // "profile is already claimed by another user"), so the reviewer gets the
    // actual reason rather than a generic failure.
    back({ error: error.message });
  }

  revalidatePath("/admin/claims");
  back({ ok: "approved" });
}

export async function rejectClaim(formData: FormData): Promise<void> {
  await requireAdminOr404();

  const claimId = String(formData.get("claim_id") ?? "");
  if (!UUID_SHAPE.test(claimId)) back({ error: "That claim id was not valid." });

  /**
   * Shown VERBATIM to the contractor on /claim/rejected. Capped, and trimmed to
   * null when blank so the page falls back to its generic wording rather than
   * rendering an empty "what the reviewer said" box.
   */
  const reason = String(formData.get("rejection_reason") ?? "").trim().slice(0, 1000);
  const notes = String(formData.get("admin_notes") ?? "").trim().slice(0, 2000);

  const db = createClient();
  const { error } = await db.rpc("reject_claim", {
    p_claim_id: claimId,
    p_reason: reason || null,
    p_notes: notes || null,
  });

  if (error) {
    console.error("[admin] reject_claim failed", { claimId, code: error.code, message: error.message });
    back({ error: error.message });
  }

  revalidatePath("/admin/claims");
  back({ ok: "rejected" });
}
