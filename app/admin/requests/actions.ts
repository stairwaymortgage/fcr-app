"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { getUser, isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Registry request decisions — /admin/requests.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A PLAIN UPDATE, NOT AN RPC, AND THAT IS THE DIFFERENCE FROM CLAIMS.
 *
 * approveClaim calls approve_claim() because approving a claim is TWO writes —
 * the claims row and contractors.claimed_by_user_id — and doing them separately
 * would leave a half-applied state where the claim reads approved and the
 * contractor still shows unclaimed.
 *
 * Deciding a registry request is one write to one row. There is no second table
 * to keep in step, because approving DOES NOT create a contractor: it records
 * that a human decided the listing should exist, and the listing is then made by
 * hand. See the migration for why auto-provisioning is deliberately not done
 * here. A function wrapping a single UPDATE would add a migration to run and a
 * definition to keep in step, and buy nothing.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ADMIN'S OWN SESSION, NOT THE SERVICE-ROLE KEY.
 *
 * Deliberately NOT lib/supabase/admin.ts. The row is protected by the "admin
 * only registry_requests" policy, which tests is_admin() against the caller's
 * JWT — so with the admin client every write would bypass RLS and the database
 * would have no say in who may decide. With the session client, the policy is
 * the enforcement and requireAdminOr404 below is only the courtesy 404.
 *
 * This is the same split the claim actions make and for the same reason: the
 * database is the last word, not a check in this file that a refactor could
 * drop.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Belt and braces: refuse here too, so a non-admin never reaches the UPDATE. */
async function requireAdminOr404() {
  const user = await getUser();
  if (!user || !isAdmin(user)) notFound();
  return user;
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function back(params: Record<string, string>): never {
  redirect(`/admin/requests?${new URLSearchParams(params).toString()}`);
}

async function decide(
  formData: FormData,
  status: "approved" | "rejected",
): Promise<void> {
  const user = await requireAdminOr404();

  const id = String(formData.get("request_id") ?? "");
  if (!UUID_SHAPE.test(id)) back({ error: "That request id was not valid." });

  const note = String(formData.get("review_note") ?? "").trim().slice(0, 2000);

  const db = createClient();

  /**
   * `.eq("status", "pending")` is a guard, not a filter.
   *
   * Two reviewers with the queue open in two tabs would otherwise both write a
   * decision, and the second would silently overwrite the first — including
   * flipping an approval to a rejection with no trace that the approval ever
   * happened. Matching on the pending status means the second write affects zero
   * rows and says so.
   */
  const { data, error } = await db
    .from("registry_requests")
    .update({
      status,
      review_note: note || null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");

  if (error) {
    console.error("[admin] registry request decision failed", {
      id,
      status,
      code: error.code,
      message: error.message,
    });
    back({ error: error.message });
  }

  if (!data || data.length === 0) {
    back({
      error:
        "That request is no longer pending — someone may have decided it already. Reload the queue.",
    });
  }

  revalidatePath("/admin/requests");
  back({ ok: status });
}

export async function approveRequest(formData: FormData): Promise<void> {
  await decide(formData, "approved");
}

export async function rejectRequest(formData: FormData): Promise<void> {
  await decide(formData, "rejected");
}
