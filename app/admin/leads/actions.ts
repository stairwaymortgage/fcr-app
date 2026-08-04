"use server";

import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth";
import { LEAD_STATUSES } from "@/lib/leads";
import { createClient } from "@/lib/supabase/server";

/**
 * Lead pipeline writes.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THIS FILE MAY EXPORT ONLY ASYNC FUNCTIONS. NOTHING ELSE. EVER.
 * "use server" makes every export a server reference; tsc, lint and build all
 * pass on a violation and the runtime does not. See app/manage/[slug]/actions.ts.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WRITTEN WITH THE ADMIN'S OWN SESSION, NOT THE SERVICE ROLE.
 *
 * /admin/claims reads with createAdminClient() because it needs service-role
 * for signed URLs anyway. Nothing here does, so these writes go through the
 * session and "admin only leads" (FOR ALL, USING is_admin(), WITH CHECK
 * is_admin()) refuses them at the database if the caller is not an admin.
 * requireAdmin() above is the first of the two, not the only one.
 *
 * That is also why 20260804_grant_hygiene.sql kept UPDATE on leads for
 * `authenticated` while stripping it from `anon`: this is the path that needs
 * it, and RLS is what makes it safe.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ THE STATUS → TIMESTAMP COUPLING LIVES HERE, IN TYPESCRIPT, AND THAT IS A
 * DELIBERATE TRADEOFF RATHER THAN AN OVERSIGHT.
 *
 * first_contacted_at and closed_at are consequences of a transition, not fields
 * anyone types. set_own_inquiry_status() made exactly this coupling a database
 * function so a hand-crafted PostgREST call could not set one without the
 * other — and the reason that mattered was that CONTRACTORS are not trusted
 * with their own inquiry rows.
 *
 * Admins are. An admin who posts a bare status update at PostgREST can already
 * write anything on this table, including both timestamps, so an RPC would move
 * the coupling without protecting anything. If leads ever become writable by
 * someone less trusted — a concierge account that is not a full admin, say —
 * this becomes an RPC that day, and this paragraph is the note explaining what
 * changed.
 */

/** Codes the page maps to sentences. Never a raw Postgres message. */
type LeadError = "status" | "value" | "gone" | "failed";

function back(id: string, tab: string, error?: LeadError): never {
  const params = new URLSearchParams();
  if (tab) params.set("status", tab);
  params.set("id", id);
  if (error) params.set("e", error);
  redirect(`/admin/leads?${params.toString()}`);
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Save the concierge fields on one lead.
 *
 * ONE ACTION FOR THE WHOLE FORM rather than one per field. The detail panel is
 * a single form with a single Save, so a partial write is not a state the UI
 * can produce — and three actions would each need their own redirect, their own
 * error code and their own ownership check for no gain.
 */
export async function saveLead(formData: FormData): Promise<void> {
  await requireAdmin();

  const id = String(formData.get("lead_id") ?? "");
  const tab = String(formData.get("status_tab") ?? "");
  // Shape-checked before it reaches the database: a malformed uuid comes back
  // as 22P02, which is an operator's sentence, and no legitimate submission
  // produces one.
  if (!UUID_SHAPE.test(id)) redirect("/admin/leads");

  const status = String(formData.get("status") ?? "");
  if (!(LEAD_STATUSES as readonly string[]).includes(status)) back(id, tab, "status");

  /**
   * estimated_value is an integer column of whole dollars. The input is text
   * rather than number so that "$1,240" and "1240" both work — a concierge
   * typing a dollar amount will include the symbol about half the time — and
   * the parse below is what makes that safe rather than the browser's.
   */
  const rawValue = String(formData.get("estimated_value") ?? "").trim();
  let estimatedValue: number | null = null;
  if (rawValue !== "") {
    const digits = rawValue.replace(/[$,\s]/g, "");
    const parsed = Number(digits);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100_000_000) {
      back(id, tab, "value");
    }
    estimatedValue = parsed;
  }

  const closedReason = String(formData.get("closed_reason") ?? "").trim().slice(0, 500) || null;

  const db = createClient();

  /**
   * Read the current row first, because two of the writes below depend on what
   * it already says. Selected through the session, so RLS answers "does this
   * lead exist" with the same voice it answers everything else — a non-admin
   * gets no row rather than a different error.
   */
  const { data: current, error: readError } = await db
    .from("leads")
    .select("status, first_contacted_at, closed_at")
    .eq("id", id)
    .maybeSingle();

  if (readError) {
    console.error("[admin/leads] could not read lead before save", readError.message);
    back(id, tab, "failed");
  }
  if (!current) back(id, tab, "gone");

  const isClosed = status === "closed_won" || status === "closed_lost";

  const patch: Record<string, unknown> = {
    status,
    estimated_value: estimatedValue,
    // Only meaningful on a closed lead. Cleared on reopen so a won lead cannot
    // carry the reason it was once lost.
    closed_reason: isClosed ? closedReason : null,
    updated_at: new Date().toISOString(),
  };

  /**
   * SET ONCE, NEVER MOVED. first_contacted_at answers "how fast did we respond"
   * — the number this pipeline will be judged on — so it records the FIRST time
   * a lead left 'new', not the most recent time somebody touched the form.
   * Same rule as replied_at on inquiries.
   */
  if (status !== "new" && !current.first_contacted_at) {
    patch.first_contacted_at = new Date().toISOString();
  }

  /**
   * closed_at DOES move, and that asymmetry is the point: a lead that is
   * reopened and closed again was genuinely closed on the second date, whereas
   * it was genuinely first contacted on the first. Reopening clears it, so
   * "closed" and "has a closing date" never disagree.
   */
  if (isClosed && !current.closed_at) {
    patch.closed_at = new Date().toISOString();
  } else if (!isClosed) {
    patch.closed_at = null;
  }

  const { error } = await db.from("leads").update(patch).eq("id", id);

  if (error) {
    console.error("[admin/leads] save failed", { code: error.code, message: error.message });
    back(id, tab, "failed");
  }

  back(id, tab);
}

/**
 * Assignment, such as it is.
 *
 * ASSIGN TO ME / UNASSIGN, AND NO PICKER. leads.assigned_to_user_id references
 * auth.users, and there is no roster to choose from: admins are identified by a
 * role claim in app_metadata, and enumerating auth users into an admin page is
 * a bigger decision than this build (it means listing every account on the
 * platform, homeowners included, through the service role).
 *
 * With one admin today a picker would be theatre. When there is a concierge
 * team there will be a team table to populate it from, and this becomes a
 * select — the column already supports it.
 */
export async function toggleLeadAssignment(formData: FormData): Promise<void> {
  const user = await requireAdmin();

  const id = String(formData.get("lead_id") ?? "");
  const tab = String(formData.get("status_tab") ?? "");
  if (!UUID_SHAPE.test(id)) redirect("/admin/leads");

  const db = createClient();
  const { data: current, error: readError } = await db
    .from("leads")
    .select("assigned_to_user_id")
    .eq("id", id)
    .maybeSingle();

  if (readError) {
    console.error("[admin/leads] could not read assignment", readError.message);
    back(id, tab, "failed");
  }
  if (!current) back(id, tab, "gone");

  // Toggle against the caller, not against whatever the form said — a form
  // rendered before someone else claimed the lead would otherwise unassign them.
  const next = current.assigned_to_user_id === user.id ? null : user.id;

  const { error } = await db
    .from("leads")
    .update({ assigned_to_user_id: next, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("[admin/leads] assignment failed", { code: error.code, message: error.message });
    back(id, tab, "failed");
  }

  back(id, tab);
}
