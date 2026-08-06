import type { Metadata } from "next";
import Link from "next/link";

import AdminHeader from "@/components/AdminHeader";
import { requireAdmin } from "@/lib/auth";
import { dataAsOf } from "@/lib/data-as-of";
import { FOCUS_RING_PAPER } from "@/lib/focus";
import { checkReferenceCounts, VERIFY_COMMAND } from "@/lib/reference-counts";
import { createClient } from "@/lib/supabase/server";
import { configState, cronJobs } from "@/lib/system-state";

/**
 * System state — /admin/settings
 * Source: _handoff/02_mockups_production/08_admin/admin_settings.html, §04 only
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS IS NOT A SETTINGS PAGE. IT SETS NOTHING, AND THE TITLE SAYS SO.
 *
 * The route keeps the mockup's /admin/settings path because that is the nav
 * slot, but five of the mockup's six sections cannot be built honestly today —
 * not because they are hard, but because the systems they would configure do
 * not exist. A page of controls for absent systems is the purest form of the
 * thing this codebase keeps refusing to ship.
 *
 * WHAT IS ABSENT, AND WHY (recon 159, 2026-08-05):
 *
 *   §01 Your Profile — "Password · last changed 47 days ago", "Two-Factor Auth
 *       Enabled · via authenticator app". Authentication here is magic-link
 *       OTP: there IS no password to change, and Supabase MFA is not enabled.
 *       Both controls describe an auth system this product does not have.
 *
 *   §02 Notifications — six toggles: new lead, new claim, sync failure, sync
 *       success, featured signup, weekly digest. THERE ARE NO ADMIN
 *       NOTIFICATIONS TO TOGGLE. The only email this codebase sends is
 *       sendClaimDecisionEmail(), and it goes to the CONTRACTOR. Lead alerts
 *       are a GoHighLevel workflow living in GHL's own UI, unreachable from
 *       here; the purge cron notifies nobody. Every switch would be dead on
 *       arrival, or would require first building an alerting system.
 *
 *   §03 DBPR Sync — schedule, source URL, stale threshold, "Run Sync Now".
 *       The manual trigger already exists on /admin/sync as the refresh queue.
 *       The schedule is unsettable: there is no sync cron, and the source sits
 *       behind a Cloudflare challenge (docs/dbpr-source.md). The stale
 *       threshold has no alerting to feed — and the one threshold that matters
 *       is already implemented as the 14-day warning on /admin/sync.
 *
 *   §05 Team Members — invite, Owner vs Admin roles. No role hierarchy exists;
 *       is_admin() is one boolean read from app_metadata. Listing admins means
 *       enumerating auth.users through the service role, and promoting one
 *       means a Server Action that writes role claims — the most dangerous
 *       write in the product, which would recreate the vulnerability
 *       20260801_fix_is_admin.sql fixed if it were wrong. DEFERRED on purpose
 *       until there is a second admin; then it is a security build with an
 *       audit table, not a settings toggle.
 *
 *   §06 Business Info — entity name and address, "changes propagate site-wide".
 *       Those strings live in six attorney-reviewed legal pages. Making them
 *       database-driven means a typo in a form silently rewrites the terms of
 *       service. Actively worse than hard-coding them.
 *
 * §04 Integrations is the one section with something true to say, and it is
 * reduced: presence, not health. See lib/system-state.ts.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const metadata: Metadata = {
  title: "System state · Admin",
  robots: { index: false, follow: false },
};

export default async function AdminSettingsPage() {
  const user = await requireAdmin();
  const db = createClient();

  const config = configState();
  const crons = cronJobs();

  const [counts, asOf, referenceCounts] = await Promise.all([
    loadCounts(db),
    dataAsOf(),
    checkReferenceCounts(db),
  ]);

  const missingRequired = config.filter((c) => c.required && !c.present);

  const displayName =
    (user.user_metadata?.full_name as string | undefined)?.trim() ||
    (user.email ?? "").split("@")[0] ||
    "Admin";

  return (
    <>
      <AdminHeader
        currentPath="/admin/settings"
        userName={displayName}
        userEmail={user.email}
        userInitials={initialsFor(displayName)}
        pendingClaims={counts.pendingClaims}
        pendingLeads={counts.newLeads}
      />

      <main id="main" className="min-h-screen bg-gray-100">
        <div className="mx-auto max-w-app px-8 py-8 max-[900px]:px-5">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="mb-1.5 font-serif text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] text-navy">
                System <em className="italic">state</em>
              </h1>
              <p className="text-note text-gray-500">
                Read-only. Nothing on this page changes anything — it reports what
                is configured, scheduled and stored.
              </p>
            </div>
            {/* Sign-out moved to AdminHeader on 2026-08-06. */}
          </div>

          {missingRequired.length > 0 && (
            <p
              role="alert"
              className="mb-6 border-l-[3px] border-status-error bg-status-errorBg px-4 py-3 text-note leading-[1.6] text-status-error"
            >
              <strong className="font-semibold">
                {missingRequired.length} required{" "}
                {missingRequired.length === 1 ? "variable is" : "variables are"} not
                set.
              </strong>{" "}
              If you are reading this, the page rendered anyway — but the parts of
              the app that need{" "}
              {missingRequired.map((c) => c.name).join(", ")} are broken.
            </p>
          )}

          <div className="mb-8 grid grid-cols-2 gap-6 max-[1100px]:grid-cols-1">
            {/* ── CONFIGURATION ───────────────────────────────────────── */}
            <Panel title="Configuration" meta="presence only">
              {/*
                THE DISTINCTION IS THE FIRST THING ON THE PANEL, not a footnote.
                Someone glancing at a column of green ticks will conclude the
                integrations are working. They are not being told that — and
                the difference matters most exactly when something is broken.
              */}
              <p className="mb-4 border-l-[3px] border-l-gold bg-gold-pale px-4 py-3 text-note leading-[1.6] text-gray-700">
                <strong className="font-semibold text-ink">
                  Configured is not connected.
                </strong>{" "}
                This shows whether a variable is set, not whether the key behind
                it still works. A revoked Resend key reads exactly like a live
                one. Nothing here is probed — live health checks would mean
                calling six third parties on every page load, and would turn
                their outage into ours.
              </p>

              <dl className="grid grid-cols-[1fr_auto] gap-x-4 border border-gray-200">
                {config.map((item) => (
                  <div
                    key={item.name}
                    className="col-span-2 grid grid-cols-[1fr_auto] items-start gap-4 border-b border-gray-100 px-4 py-3 last:border-b-0"
                  >
                    <div>
                      <dt className="break-all font-mono text-[12.5px] font-medium text-ink">
                        {item.name}
                      </dt>
                      <dd className="mt-0.5 text-micro leading-[1.5] text-gray-500">
                        {item.purpose}
                        {!item.required && " · optional"}
                      </dd>
                    </div>
                    <dd>
                      <span
                        className={`inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-[11.5px] font-semibold ${
                          item.present
                            ? "bg-status-successBg text-status-success"
                            : item.required
                              ? "bg-status-errorBg text-status-error"
                              : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`h-1.5 w-1.5 rounded-full ${
                            item.present
                              ? "bg-status-success"
                              : item.required
                                ? "bg-status-error"
                                : "bg-gray-400"
                          }`}
                        />
                        {item.present ? "Key present" : "Not set"}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>

              <p className="mt-4 text-micro leading-[1.5] text-gray-500">
                Values are never rendered, logged or returned to the browser —
                only the names above and a boolean. A settings page that shows
                you half a service-role key has published it.
              </p>
            </Panel>

            {/* ── SCHEDULE + STORED ───────────────────────────────────── */}
            <div className="flex flex-col gap-6">
              <Panel title="Scheduled jobs" meta="from vercel.json">
                {crons.length === 0 ? (
                  <p className="text-note leading-[1.6] text-gray-600">
                    No cron jobs are registered.
                  </p>
                ) : (
                  <dl className="grid grid-cols-[1fr_auto] gap-x-4 border border-gray-200">
                    {crons.map((job) => (
                      <div
                        key={job.path}
                        className="col-span-2 grid grid-cols-[1fr_auto] items-start gap-4 border-b border-gray-100 px-4 py-3 last:border-b-0"
                      >
                        <div>
                          <dt className="break-all font-mono text-[12.5px] font-medium text-ink">
                            {job.path}
                          </dt>
                          <dd className="mt-0.5 font-mono text-micro text-gray-500">
                            {job.schedule}
                          </dd>
                        </div>
                        <dd className="whitespace-nowrap text-note text-gray-700">
                          {job.description}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p className="mt-4 text-micro leading-[1.5] text-gray-500">
                  Read from the deployed <code className="font-mono">vercel.json</code>{" "}
                  rather than restated here, so this cannot drift from what Vercel
                  actually runs.{" "}
                  <strong className="font-medium text-gray-600">
                    There is no DBPR sync job
                  </strong>{" "}
                  — refreshes are queued on{" "}
                  <Link
                    href="/admin/sync"
                    className={`text-navy underline decoration-gold underline-offset-2 ${FOCUS_RING_PAPER}`}
                  >
                    DBPR Sync
                  </Link>{" "}
                  and run by a person.
                </p>
              </Panel>

              <Panel title="Stored data" meta={`as of ${asOf}`}>
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 border border-gray-200">
                  <StatRow term="Contractor records" value={counts.contractors} />
                  <StatRow term="Leads" value={counts.leads} />
                  <StatRow
                    term="Undelivered to GHL"
                    value={counts.undelivered}
                    tone={counts.undelivered > 0 ? "error" : undefined}
                  />
                  <StatRow term="Claims pending" value={counts.pendingClaims} />
                  <StatRow term="Inquiries" value={counts.inquiries} />
                  <StatRow term="Recorded sync runs" value={counts.syncRuns} />
                </dl>
                <p className="mt-4 text-micro leading-[1.5] text-gray-500">
                  “As of” is the newest{" "}
                  <code className="font-mono">last_dbpr_sync_at</code> — when our
                  copy was refreshed, not when DBPR published.
                </p>
              </Panel>
            </div>
          </div>

          {/* ── REFERENCE COUNTS ──────────────────────────────────────── */}
          <Panel
            title="Reference counts"
            meta={referenceCounts.ok ? "in agreement" : "repair needed"}
          >
            <p className="text-note leading-[1.6] text-gray-700">
              {referenceCounts.error || !referenceCounts.counties ? (
                <>The drift check could not run, so this is unknown rather than fine.</>
              ) : referenceCounts.ok ? (
                <>
                  The pre-computed counts behind /counties and /types agree with
                  the contractors table.
                </>
              ) : (
                <>
                  <strong className="font-semibold text-status-error">
                    /counties and /types are serving stale figures.
                  </strong>{" "}
                  A refresh has landed without the repair being re-run.
                </>
              )}{" "}
              The full breakdown and the command to fix it are on{" "}
              <Link
                href="/admin/sync"
                className={`text-navy underline decoration-gold underline-offset-2 ${FOCUS_RING_PAPER}`}
              >
                DBPR Sync
              </Link>
              , next to the runs that cause the drift. Exact per-row check:{" "}
              <code className="font-mono text-[12px]">{VERIFY_COMMAND}</code>.
            </p>
          </Panel>

          {/* THE ABSENT SECTIONS, ON THE PAGE AND NOT ONLY IN THE DOCBLOCK.
              Whoever opens this expecting the mockup's six sections should find
              out here why there is one, rather than assuming it is unfinished. */}
          <div className="mt-8 border border-gray-200 bg-white px-6 py-5">
            <h2 className="mb-3 inline-flex items-center gap-2.5 font-mono text-label font-semibold uppercase tracking-eyebrow text-navy">
              <span aria-hidden="true" className="h-px w-4 bg-gold" />
              Not on this page
            </h2>
            <p className="mb-4 text-note leading-[1.6] text-gray-700">
              The mockup for this route has six sections. Five configure systems
              that do not exist yet, so they are absent rather than rendered
              inert.
            </p>
            <dl className="grid grid-cols-[190px_1fr] gap-x-4 border border-gray-200">
              <AbsentRow term="Your profile">
                Sign-in is a magic link. There is no password to change, and
                two-factor is not enabled on the auth provider.
              </AbsentRow>
              <AbsentRow term="Notifications">
                Nothing to switch on or off: the only email this app sends goes to
                a contractor when their claim is decided. Lead alerts are a
                GoHighLevel workflow, configured inside GoHighLevel.
              </AbsentRow>
              <AbsentRow term="DBPR sync settings">
                The manual trigger is on DBPR Sync. There is no schedule to set,
                and the 14-day staleness warning is already applied there.
              </AbsentRow>
              <AbsentRow term="Team members">
                Deferred deliberately. Adding and removing admins means writing
                role claims with the service role — the most security-sensitive
                write in the product — and there is one admin today. It becomes
                worth building with a second person, as an audited action rather
                than a settings toggle.
              </AbsentRow>
              <AbsentRow term="Business info">
                The operating entity appears in six attorney-reviewed legal
                pages. Editing it from a form means a typo can silently rewrite
                the terms of service.
              </AbsentRow>
            </dl>
          </div>
        </div>
      </main>
    </>
  );
}

/** "Jim Blackburn" -> "JB". Same helper as the other admin pages. */
function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0]}${parts[parts.length - 1][0]}`;
}

/** Every number on the page, counted with head:true rather than fetched. */
async function loadCounts(db: ReturnType<typeof createClient>) {
  const count = (table: string) =>
    db.from(table).select("id", { count: "exact", head: true });

  const [contractors, leads, newLeads, undelivered, pendingClaims, inquiries, syncRuns] =
    await Promise.all([
      db.from("contractors").select("dbpr_sync_key", { count: "exact", head: true }),
      count("leads"),
      // Feeds AdminHeader's gold badge, not the panel — same query as
      // /admin/leads and /admin/sync use, so the three headers agree.
      count("leads").eq("status", "new"),
      count("leads").eq("ghl_synced", false),
      count("claims").eq("status", "pending"),
      count("inquiries"),
      count("sync_runs"),
    ]);

  return {
    contractors: contractors.count ?? 0,
    leads: leads.count ?? 0,
    newLeads: newLeads.count ?? 0,
    undelivered: undelivered.count ?? 0,
    pendingClaims: pendingClaims.count ?? 0,
    inquiries: inquiries.count ?? 0,
    syncRuns: syncRuns.count ?? 0,
  };
}

function Panel({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-gray-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-6 py-4">
        <h2 className="inline-flex items-center gap-2.5 font-mono text-label font-semibold uppercase tracking-eyebrow text-navy">
          <span aria-hidden="true" className="h-px w-4 bg-gold" />
          {title}
        </h2>
        {meta && (
          <p className="font-mono text-micro uppercase tracking-label text-gray-500">
            {meta}
          </p>
        )}
      </header>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

function StatRow({
  term,
  value,
  tone,
}: {
  term: string;
  value: number;
  tone?: "error";
}) {
  return (
    <div className="col-span-2 grid grid-cols-[1fr_auto] items-baseline gap-4 border-b border-gray-100 px-4 py-2.5 last:border-b-0">
      <dt className="text-note text-gray-700">{term}</dt>
      <dd
        className={`font-mono text-[13px] font-semibold ${
          tone === "error" && value > 0 ? "text-status-error" : "text-navy"
        }`}
      >
        {value.toLocaleString("en-US")}
      </dd>
    </div>
  );
}

function AbsentRow({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="col-span-2 grid grid-cols-[190px_1fr] gap-4 border-b border-gray-100 px-4 py-3 last:border-b-0 max-[640px]:grid-cols-1 max-[640px]:gap-1">
      <dt className="font-mono text-label font-medium uppercase tracking-[0.06em] text-gray-500">
        {term}
      </dt>
      <dd className="text-note leading-[1.55] text-gray-700">{children}</dd>
    </div>
  );
}
