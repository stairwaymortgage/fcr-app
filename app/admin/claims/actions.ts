"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { getUser, isAdmin } from "@/lib/auth";
import { oneRelation } from "@/lib/claims";
import { formatBusinessName } from "@/lib/contractor-profile";
import { sendClaimDecisionEmail, type ClaimDecision } from "@/lib/email";
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

/**
 * Tell the contractor what was decided.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * BEST EFFORT, AND CALLED ONLY AFTER THE RPC HAS SUCCEEDED.
 *
 * The decision is already committed by the time this runs — approve_claim()
 * linked contractors.claimed_by_user_id inside its transaction, so the
 * contractor HAS their profile whether or not this email lands. The database is
 * the source of truth; this is a courtesy on top of it.
 *
 * So nothing in here is allowed to escape. sendClaimDecisionEmail never throws
 * by contract, and the read-back is wrapped anyway: a failure to notify must not
 * turn a completed approval into an error on the reviewer's screen, because the
 * obvious response to that error is to approve again — and the second call
 * raises "claim is not pending", which reads like the first one failed too.
 *
 * Every skipped or failed send is a console.warn carrying the claim id, so an
 * undelivered decision is recoverable from the logs rather than invisible.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Awaited rather than fired and forgotten: serverless kills the process once the
 * response is sent, so an un-awaited fetch here would be cancelled mid-flight
 * often enough to look like flaky delivery.
 */
async function notifyDecision(
  db: ReturnType<typeof createClient>,
  claimId: string,
  decision: ClaimDecision,
): Promise<void> {
  try {
    /**
     * Read back rather than trusting the form: rejection_reason is normalised by
     * reject_claim() (trimmed, blanked to NULL), and the contractor's name and
     * licence live on contractors. Reading after the RPC also means the email
     * can only ever describe a decision the database actually recorded.
     */
    const { data: claim, error } = await db
      .from("claims")
      .select("claimant_email, rejection_reason, contractors(business_name, license_number)")
      .eq("id", claimId)
      .single();

    if (error || !claim) {
      console.warn("[admin] decision email skipped - could not read the claim back", {
        claimId,
        decision,
        message: error?.message,
      });
      return;
    }

    const contractor = oneRelation<{
      business_name: string | null;
      license_number: string | null;
    }>(claim.contractors);

    // Same fallbacks the two pages use, so the email and the page it links to
    // never disagree about what the business is called.
    const fallback = decision === "approved" ? "your business" : "that profile";

    const result = await sendClaimDecisionEmail({
      to: claim.claimant_email,
      decision,
      contractorName: contractor?.business_name
        ? formatBusinessName(contractor.business_name)
        : fallback,
      licenseNumber: contractor?.license_number ?? null,
      rejectionReason: claim.rejection_reason,
    });

    if (!result.ok) {
      console.warn("[admin] decision email not sent", { claimId, decision, error: result.error });
    }
  } catch (cause) {
    console.warn("[admin] decision email threw", {
      claimId,
      decision,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
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

  // After the RPC, never before: the contractor must not be told a claim was
  // approved by a call that then failed.
  await notifyDecision(db, claimId, "approved");

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

  await notifyDecision(db, claimId, "rejected");

  revalidatePath("/admin/claims");
  back({ ok: "rejected" });
}
