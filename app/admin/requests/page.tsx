import type { Metadata } from "next";
import Link from "next/link";

import AdminHeader from "@/components/AdminHeader";
import SubmitButton from "@/components/SubmitButton";
import { requireAdmin } from "@/lib/auth";
import { tradeLabel } from "@/lib/registry-requests";
import { createAdminClient } from "@/lib/supabase/admin";

import { approveRequest, rejectRequest } from "./actions";

/**
 * Registry request queue — /admin/requests
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ITS OWN ROUTE RATHER THAN A TAB ON /admin/claims.
 *
 * The two queues look similar and are not the same job. A claim is an identity
 * decision about an EXISTING profile, made against an ID photo, and approving it
 * grants someone control of a live page — approve_claim() writes two tables
 * inside a transaction. A registry request is a research task about a business
 * that has NO record here, decided against DBPR, and approving it grants nothing
 * and writes one column.
 *
 * Folding them into one screen would mean one page holding two different
 * definitions of "approve", with the more dangerous one a tab-click away from
 * the more routine one. They also empty at different rates and are worked at
 * different times.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ APPROVING DOES NOT CREATE A LISTING. It records a decision; the contractors
 * row is then created by hand. The panel below says so on screen, because a
 * button labelled "Approve" that silently does nothing visible is exactly how a
 * reviewer ends up believing a business was added when it was not. See
 * db/migrations/20260807_registry_requests.sql for why auto-provisioning is
 * deliberately out of scope for this pass.
 *
 * ADMIN ONLY, AND A NON-ADMIN GETS 404 — requireAdmin() calls notFound() rather
 * than returning 403, so /admin/* never confirms it exists to a signed-in
 * contractor who guessed the URL. Middleware rewrites the path as a first pass;
 * this is the enforcement, since middleware does not run for Server Actions.
 */

export const metadata: Metadata = {
  title: "Registry requests · Admin",
  robots: { index: false, follow: false },
};

type RequestRow = {
  id: string;
  created_at: string;
  business_name: string;
  email: string;
  license_number: string | null;
  trade: string | null;
  county: string | null;
  contact_name: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  status: string;
  reviewed_at: string | null;
  review_note: string | null;
};

const COLUMNS =
  "id, created_at, business_name, email, license_number, trade, county, " +
  "contact_name, phone, website, notes, status, reviewed_at, review_note";

/** Decided rows kept on screen, newest first, as the audit trail. */
const DECIDED_SHOWN = 25;

export default async function AdminRequestsPage({
  searchParams,
}: {
  searchParams: { error?: string; ok?: string };
}) {
  const user = await requireAdmin();

  /**
   * Read with the ADMIN client. The RLS policy would let an admin session read
   * these anyway; service-role is used so the page cannot half-render if the
   * policy is ever tightened, and so the queue and its count come from one
   * client that cannot disagree with itself.
   *
   * The DECISIONS still go through the admin's own session — see ./actions.ts.
   * Reading with service-role and writing with it are very different things.
   */
  const admin = createAdminClient();

  const { data: pendingData, error: pendingError } = await admin
    .from("registry_requests")
    .select(COLUMNS)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  const { data: decidedData, error: decidedError } = await admin
    .from("registry_requests")
    .select(COLUMNS)
    .neq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(DECIDED_SHOWN);

  if (pendingError || decidedError) {
    console.error("[admin] could not load registry requests", {
      pending: pendingError?.message,
      decided: decidedError?.message,
      hint:
        pendingError?.code === "PGRST205"
          ? "db/migrations/20260807_registry_requests.sql has not been run."
          : undefined,
    });
  }

  const pending = (pendingData ?? []) as unknown as RequestRow[];
  const decided = (decidedData ?? []) as unknown as RequestRow[];

  const displayName =
    (user.user_metadata?.full_name as string | undefined)?.trim() ||
    (user.email ?? "").split("@")[0] ||
    "Admin";

  return (
    <>
      <AdminHeader
        currentPath="/admin/requests"
        userName={displayName}
        userEmail={user.email}
        userInitials={initialsFor(displayName)}
        pendingRequests={pending.length}
      />

      <main id="main" className="min-h-screen bg-paper">
        <div className="mx-auto max-w-[1100px] px-6 py-10 max-[700px]:px-4">
          <div className="mb-8 flex items-end justify-between gap-4 border-b border-gray-200 pb-5">
            <div>
              <p className="mb-2 font-mono text-micro font-semibold uppercase tracking-eyebrow text-gold">
                Admin
              </p>
              <h1 className="font-serif text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] text-navy">
                Registry requests
              </h1>
            </div>
            <p className="font-mono text-[28px] font-semibold text-navy">
              {pending.length}
              <span className="ml-2 align-middle font-mono text-label uppercase tracking-label text-gray-500">
                pending
              </span>
            </p>
          </div>

          <div className="mb-8 border-l-[3px] border-l-gold bg-gray-50 px-5 py-4">
            <p className="mb-2 font-mono text-label font-semibold uppercase tracking-label text-navy">
              Approving does not create the listing.
            </p>
            <p className="text-note leading-[1.6] text-gray-700">
              These come from <Link href="/join">/join</Link>, from businesses
              with no DBPR match in our data. A decision here records what you
              found; the contractor record is still added by hand afterwards.
              Nothing is emailed to the requester either way &mdash; they were
              told a person would reply, so reply from your own inbox.
            </p>
          </div>

          {searchParams.ok && (
            <p
              role="status"
              className="mb-6 border-l-[3px] border-status-success bg-status-successBg px-4 py-3 text-note text-status-success"
            >
              Request {searchParams.ok}.
            </p>
          )}
          {searchParams.error && (
            <p
              role="alert"
              className="mb-6 border-l-[3px] border-status-error bg-status-errorBg px-4 py-3 text-note text-status-error"
            >
              {searchParams.error}
            </p>
          )}

          {pending.length === 0 ? (
            <p className="border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center text-note text-gray-600">
              Nothing waiting. New requests appear here as they&rsquo;re
              submitted.
            </p>
          ) : (
            <div className="flex flex-col gap-8">
              {pending.map((row) => (
                <RequestCard key={row.id} row={row} />
              ))}
            </div>
          )}

          {decided.length > 0 && (
            <section className="mt-14">
              <h2 className="mb-4 border-b border-gray-200 pb-3 font-serif text-[22px] font-semibold text-navy">
                Recently decided
              </h2>
              <ul className="flex flex-col gap-2">
                {decided.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-baseline justify-between gap-3 border border-gray-200 bg-paper-raised px-5 py-3"
                  >
                    <span className="text-note font-semibold text-navy">
                      {row.business_name}
                    </span>
                    <span className="font-mono text-label uppercase tracking-label text-gray-500">
                      {row.status}
                      {row.reviewed_at
                        ? ` · ${new Date(row.reviewed_at).toLocaleDateString("en-US", {
                            dateStyle: "medium",
                          })}`
                        : ""}
                    </span>
                    {row.review_note && (
                      <span className="w-full text-note leading-[1.55] text-gray-600">
                        {row.review_note}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>
    </>
  );
}

function Detail({ term, children }: { term: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div>
      <dt className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
        {term}
      </dt>
      <dd className="mt-0.5 text-note leading-[1.55] text-ink">{children}</dd>
    </div>
  );
}

function RequestCard({ row }: { row: RequestRow }) {
  return (
    <article className="border border-gray-200 bg-paper-raised">
      <header className="border-b border-gray-200 px-6 py-4 max-[700px]:px-4">
        <p className="font-mono text-micro uppercase tracking-label text-gray-500">
          Request {row.id.slice(0, 8)} · submitted{" "}
          {new Date(row.created_at).toLocaleString("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
        <h2 className="mt-1 font-serif text-[21px] font-semibold text-navy">
          {row.business_name}
        </h2>
      </header>

      <div className="px-6 py-5 max-[700px]:px-4">
        <dl className="grid grid-cols-3 gap-x-6 gap-y-4 max-[700px]:grid-cols-2">
          <Detail term="License">{row.license_number ?? "—"}</Detail>
          <Detail term="Trade">{tradeLabel(row.trade) ?? "—"}</Detail>
          <Detail term="County">{row.county ?? "—"}</Detail>
          <Detail term="Contact">{row.contact_name ?? "—"}</Detail>
          <Detail term="Email">
            <a href={`mailto:${row.email}`} className="underline underline-offset-2">
              {row.email}
            </a>
          </Detail>
          <Detail term="Phone">{row.phone ?? "—"}</Detail>
        </dl>

        {row.website && (
          <div className="mt-4">
            <p className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
              Website
            </p>
            {/*
              noreferrer AND nofollow: this URL is typed by a stranger and the
              reviewer is a signed-in admin, so neither our referrer nor any
              ranking signal should follow them out.
            */}
            <a
              href={row.website}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="mt-0.5 block text-note text-navy underline underline-offset-2"
            >
              {row.website}
            </a>
          </div>
        )}

        {row.notes && (
          <div className="mt-4 border-l-[3px] border-gray-300 bg-gray-50 px-4 py-3">
            <p className="mb-1 font-mono text-label font-semibold uppercase tracking-label text-gray-500">
              Their notes
            </p>
            {/* whitespace-pre-line: they typed line breaks and losing them turns
                a structured note into a wall. React escapes the content. */}
            <p className="whitespace-pre-line text-note leading-[1.6] text-gray-700">
              {row.notes}
            </p>
          </div>
        )}

        <p className="mt-5 font-mono text-label uppercase tracking-label text-gray-500">
          Check against DBPR before deciding
        </p>
        <a
          href="https://www.myfloridalicense.com/wl11.asp"
          target="_blank"
          rel="noopener noreferrer"
          className="text-note text-navy underline underline-offset-2"
        >
          myfloridalicense.com licensee search
        </a>
      </div>

      <div className="grid grid-cols-2 gap-6 border-t border-gray-200 px-6 py-5 max-[700px]:grid-cols-1 max-[700px]:px-4">
        {/*
          TWO SEPARATE FORMS, NOT ONE WITH TWO SUBMIT BUTTONS. Each carries its
          own note field, so the reviewer's reasoning is attached to the decision
          they actually made — and a stray Enter keypress in the reject note
          cannot submit the approve action.
        */}
        <form action={approveRequest} className="flex flex-col gap-2">
          <input type="hidden" name="request_id" value={row.id} />
          <label className="flex flex-col gap-1">
            <span className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
              Note (internal, optional)
            </span>
            <textarea
              name="review_note"
              rows={2}
              maxLength={2000}
              placeholder="e.g. matched CGC1520921 — listing added"
              className="resize-y border border-gray-300 bg-white px-3 py-2 text-note text-ink focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/10"
            />
          </label>
          <SubmitButton
            pendingLabel="Approving…"
            className="self-start bg-navy px-5 py-2.5 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-paper transition-colors hover:bg-navy-light"
          >
            Approve
          </SubmitButton>
        </form>

        <form action={rejectRequest} className="flex flex-col gap-2">
          <input type="hidden" name="request_id" value={row.id} />
          <label className="flex flex-col gap-1">
            <span className="font-mono text-label font-semibold uppercase tracking-label text-gray-500">
              Reason (internal, optional)
            </span>
            <textarea
              name="review_note"
              rows={2}
              maxLength={2000}
              placeholder="e.g. no DBPR licence found under this name"
              className="resize-y border border-gray-300 bg-white px-3 py-2 text-note text-ink focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/10"
            />
          </label>
          <SubmitButton
            pendingLabel="Rejecting…"
            className="self-start border border-status-error px-5 py-2.5 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-status-error transition-colors hover:bg-status-errorBg"
          >
            Reject
          </SubmitButton>
        </form>
      </div>
    </article>
  );
}

/** Two letters for the header chip. Same helper the other admin pages carry. */
function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "A";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
