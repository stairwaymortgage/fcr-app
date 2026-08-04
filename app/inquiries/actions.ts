"use server";

import { redirect } from "next/navigation";

import { getUser } from "@/lib/auth";
import { parseTab, sanitizeSearch, type InquiryStatus } from "@/lib/inquiries";
import { createClient } from "@/lib/supabase/server";

/**
 * Inbox state changes — Archive, Mark as Replied, Move back to inbox.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THIS FILE MAY EXPORT ONLY ASYNC FUNCTIONS. NOTHING ELSE. EVER.
 *
 * "use server" turns every export into a server reference, and a value that is
 * not an async function cannot be one. Next refuses at runtime with
 *
 *   A "use server" file can only export async functions, found object.
 *
 * and tsc, next lint and next build all pass first — the check lives in the
 * server runtime. It has already shipped once in this codebase
 * (app/manage/[slug]/actions.ts, digest 1753474867). Types are fine; they are
 * erased. Anything with a runtime value belongs in lib/inquiries.ts.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS FILE DOES NOT DECIDE WHO MAY WRITE. THE DATABASE DOES.
 *
 * Every action below reaches set_own_inquiry_status(), which re-checks
 * contractors.claimed_by_user_id = auth.uid() inside the transaction and can
 * only touch status and replied_at. The page's own ownership filter and the
 * middleware gate are both upstream of this, and neither is the control — a
 * Server Action is a public HTTP endpoint reachable without the page ever
 * rendering, and middleware does not run for Server Actions at all.
 *
 * So the inquiry id arriving from a hidden form field is fine by construction.
 * Post somebody else's and the RPC raises "That inquiry was not sent to a
 * profile you manage."
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THREE NAMED ACTIONS, NOT ONE THAT TAKES A STATUS. A single
 * setStatus(id, status) would put the target state in the form body, where it is
 * caller-supplied. The RPC and the column's CHECK would both still refuse a
 * nonsense value, so this is not the security boundary — it is that each button
 * on the page means one thing, and an action per meaning is what lets the
 * redirect differ (archiving drops the selection; replying keeps it).
 */

/** Codes the page maps to sentences. Never the raw Postgres message. */
type ActionError = "notyours" | "gone" | "failed";

/**
 * Back to the inbox, carrying the tab and search the contractor was looking at.
 *
 * `keepSelected` is false for Archive: the row has just left the tab it was in,
 * so a ?id= pointing at it would render a detail pane for an inquiry that is no
 * longer in the list beside it.
 */
function backToInbox(
  form: FormData,
  opts: { keepSelected: boolean; error?: ActionError },
): never {
  const params = new URLSearchParams();

  const tab = parseTab(String(form.get("tab") ?? ""));
  if (tab !== "new") params.set("tab", tab);

  const q = sanitizeSearch(String(form.get("q") ?? ""));
  if (q) params.set("q", q);

  const id = String(form.get("inquiry_id") ?? "");
  if (opts.keepSelected && id) params.set("id", id);

  if (opts.error) params.set("e", opts.error);

  const query = params.toString();
  redirect(query ? `/inquiries?${query}` : "/inquiries");
}

/**
 * The one place any of these three actually writes.
 *
 * NO revalidatePath: every redirect above lands on /inquiries, which reads the
 * session on each request and is therefore never served from the cache there is
 * nothing to invalidate in.
 */
async function transition(
  form: FormData,
  status: Exclude<InquiryStatus, "unread">,
  keepSelected: boolean,
): Promise<never> {
  const user = await getUser();
  if (!user) redirect("/login?next=%2Finquiries");

  const id = String(form.get("inquiry_id") ?? "");
  // Shape-checked before it reaches the database. A malformed uuid would come
  // back as 22P02 "invalid input syntax for type uuid", which is an operator's
  // sentence, and there is no legitimate submission it can come from.
  if (!/^[0-9a-f-]{36}$/i.test(id)) backToInbox(form, { keepSelected: false, error: "gone" });

  const db = createClient();
  const { error } = await db.rpc("set_own_inquiry_status", {
    p_inquiry_id: id,
    p_status: status,
  });

  if (error) {
    // 42501 is the RPC's own "not yours" and its "you are not signed in";
    // P0002 is "no such inquiry". Anything else is unplanned, so it is logged
    // for us and generic for the contractor.
    const known: Record<string, ActionError> = { "42501": "notyours", P0002: "gone" };
    const mapped = known[error.code ?? ""];
    if (!mapped) {
      console.error("[inquiries] status change failed", {
        status,
        code: error.code,
        message: error.message,
      });
    }
    backToInbox(form, { keepSelected: false, error: mapped ?? "failed" });
  }

  backToInbox(form, { keepSelected });
}

/** Out of the working set. Keeps replied_at — see the migration's §1. */
export async function archiveInquiry(formData: FormData): Promise<void> {
  await transition(formData, "archived", false);
}

/**
 * "I have answered this." Sets replied_at the first time and never again, so the
 * timestamp records the first response rather than the last press of the button.
 *
 * IT IS THE CONTRACTOR'S CLAIM, NOT AN OBSERVATION. Reply leaves through a
 * mailto:, which this app cannot see, so nothing here can verify that a message
 * was sent. Any future "responds within N hours" figure derived from replied_at
 * is self-reported and must be labelled as such wherever it is shown.
 */
export async function markReplied(formData: FormData): Promise<void> {
  await transition(formData, "replied", true);
}

/**
 * Back into the inbox from the Archived tab.
 *
 * Lands on 'read', not on whatever it was before — status is one column, so
 * archiving already overwrote that, and there is nothing to restore it from.
 * 'read' is the honest floor: it has certainly been seen.
 */
export async function restoreInquiry(formData: FormData): Promise<void> {
  await transition(formData, "read", true);
}
