import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth";

/**
 * /admin — the admin index, which until 2026-08-06 was a 404.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TWO THINGS LINKED HERE AND BOTH WERE BROKEN.
 *
 * The known one was the dashboard's "Admin" link, carried forward for weeks.
 * The one nobody had reported is worse: AdminHeader's logo is wrapped in
 * <Link href="/admin"> on EVERY admin page, so the wordmark an admin would
 * naturally click to get "home" produced a 404 from inside the tool itself.
 *
 * Fixing it as a route rather than by rewriting the two hrefs is deliberate.
 * /admin is the URL a person types, and it is the one a bookmark, a browser
 * autocomplete or a future link will use. Pointing the links elsewhere would
 * have left the typed URL broken and the same bug free to reappear the next
 * time someone links to the obvious path.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE 404 FOR NON-ADMINS IS PRESERVED, and that is the whole reason this calls
 * requireAdmin() before redirecting. A bare redirect would answer "/admin
 * exists and sends you to /admin/claims" to anyone at all, which is exactly the
 * disclosure lib/auth.ts refuses: every non-admin gets notFound(), signed in or
 * not, so the route is indistinguishable from a path that was never built.
 * Redirecting first and gating at the destination would leak it in the hop.
 */
export default async function AdminIndexPage() {
  await requireAdmin();

  /**
   * Claims is the landing because it is the only admin page with a queue that
   * someone is expected to clear. Leads is a workflow, Contractors is a
   * reference browser, Sync and Settings are read-mostly — none of them is the
   * question "is there anything waiting for me". Same destination the post-login
   * redirect uses; see lib/landing.ts.
   */
  redirect("/admin/claims");
}
