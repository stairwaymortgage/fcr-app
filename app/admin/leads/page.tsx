import type { Metadata } from "next";
import Link from "next/link";

import AdminHeader from "@/components/AdminHeader";
import SubmitButton from "@/components/SubmitButton";
import StatsStrip from "@/components/StatsStrip";
import { requireAdmin } from "@/lib/auth";
import { FOCUS_RING_PAPER } from "@/lib/focus";
import {
  ACTIVE_STATUSES,
  absoluteTime,
  entityTag,
  formatValue,
  formatValueCompact,
  LEAD_SORT_LABEL,
  LEAD_SORTS,
  LEAD_STATUS_DOT,
  LEAD_STATUS_LABEL,
  LEAD_STATUS_PILL,
  LEAD_STATUSES,
  parseSort,
  parseStatusFilter,
  relativeTime,
  sanitizeSearch,
  STATUS_FILTERS,
  type LeadRow,
  type LeadSort,
  type LeadStatus,
  type StatusFilter,
} from "@/lib/leads";
import { PERSONAS } from "@/lib/personas";
import { createClient } from "@/lib/supabase/server";

import { saveLead, toggleLeadAssignment } from "./actions";

/**
 * Leads pipeline — /admin/leads
 * Source: _handoff/02_mockups_production/08_admin/admin_leads.html
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A TABLE, NOT A BOARD. The mockup is explicit and so is
 * ListDetailLayout.tsx's own docblock, which names this page as the one
 * consumer that must NOT use it: "admin_leads ... renders a flat
 * <table class='leads-table'> and contains none of this component's classes.
 * Do not scope this to cover it."
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE STATUS ON THIS PAGE IS OURS. GOHIGHLEVEL DOES NOT KNOW ABOUT IT.
 *
 * Every lead is pushed to GHL at capture and worked there. Nothing comes back —
 * no webhook, no polling, no reconciliation exists in this app. So this column
 * is a second record that CAN diverge from the stage the same lead sits in
 * inside GHL, and the page says so on screen rather than leaving it to be
 * discovered in three months by someone trying to work out which one is true.
 *
 * Two-way sync is a webhook endpoint, its auth, a stage mapping and a conflict
 * rule. Deliberately not started here. See lib/leads.ts.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * NOT BUILT FROM THE MOCKUP, EACH FOR A REASON:
 *
 *   · "Conversion to Call — 23%, 90-day rolling". There is no call tracking
 *     anywhere in this product, so the number could only be invented. Replaced
 *     with undelivered-to-GHL, which is real, currently non-zero, and
 *     actionable.
 *   · "Persona Match Score" as a sort. No such score exists; detectPersona()
 *     returns one persona, not a ranking.
 *   · Export CSV. A bulk export of names, emails and phone numbers deserves its
 *     own decision about who may run it and whether it is logged — not a button
 *     added in passing.
 *   · Add Manual Lead. 'manual_admin' is in the lead_source CHECK and has never
 *     had a writer. Its own build.
 *   · Pagination controls. Rendered only when there is more than one page; with
 *     nine leads the mockup's "1 2 3 … 71" would be furniture.
 */

export const metadata: Metadata = {
  title: "Leads · Admin",
  robots: { index: false, follow: false },
};

/**
 * Rows per page. The mockup shows 12 and pagination beneath; both are honoured,
 * but the controls only appear once they do something.
 */
const PAGE_SIZE = 12;

const LEAD_COLUMNS =
  "id, name, email, phone, zip, lead_source, referring_url, diagnostic_answers, " +
  "primary_persona, routed_entities, status, assigned_to_user_id, estimated_value, " +
  "closed_reason, sms_consent, sms_consent_text, sms_consent_timestamp, created_at, " +
  "first_contacted_at, closed_at, ghl_synced, ghl_contact_id, ghl_opportunity_id, " +
  "ghl_synced_at, ghl_last_error";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ?e= codes set by ./actions.ts. Never a raw Postgres message. */
const ERROR_TEXT: Record<string, string> = {
  status: "That isn’t a status this pipeline has. Nothing was saved.",
  value: "The estimated value needs to be a whole number of dollars. Nothing was saved.",
  gone: "That lead no longer exists.",
  failed: "Something went wrong on our side. Nothing was saved — try again.",
};

/** slug → display name, from the persona definitions the diagnostic writes. */
const PERSONA_NAME: Record<string, string> = Object.fromEntries(
  Object.values(PERSONAS).map((p) => [p.slug, p.name]),
);

export default async function AdminLeadsPage({
  searchParams,
}: {
  searchParams: {
    status?: string;
    q?: string;
    sort?: string;
    id?: string;
    page?: string;
    e?: string;
  };
}) {
  const user = await requireAdmin();

  /**
   * READ WITH THE ADMIN'S OWN SESSION, unlike /admin/claims which needs
   * service-role for signed URLs. "admin only leads" (FOR ALL, USING
   * is_admin()) is therefore doing real work on every query below —
   * requireAdmin() above is the first of two checks, not the only one.
   */
  const db = createClient();

  const status = parseStatusFilter(searchParams.status);
  const q = sanitizeSearch(searchParams.q);
  const sort = parseSort(searchParams.sort);
  const selectedId =
    searchParams.id && UUID_SHAPE.test(searchParams.id) ? searchParams.id : null;
  const page = Math.max(1, Number(searchParams.page) || 1);

  const base = () => {
    let query = db.from("leads").select(LEAD_COLUMNS, { count: "exact" });
    if (status !== "all") query = query.eq("status", status);
    if (q) {
      // q is allowlisted in sanitizeSearch() — this is PostgREST filter
      // grammar, not a value slot. See the docblock there.
      query = query.or(
        `name.ilike.*${q}*,email.ilike.*${q}*,phone.ilike.*${q}*,zip.ilike.*${q}*`,
      );
    }
    return query;
  };

  let listQuery = base();
  if (sort === "value") {
    // nullsFirst: false — an unvalued lead sorts last, because "highest value"
    // asked for the big ones at the top, not the blank ones.
    listQuery = listQuery.order("estimated_value", { ascending: false, nullsFirst: false });
  } else if (sort === "oldest_unanswered") {
    // The point of this sort is response time, so it reads oldest-first and
    // leaves the filter to the chips: "oldest unanswered" over a closed-won
    // filter is a legitimate question about how long those took to pick up.
    listQuery = listQuery.order("created_at", { ascending: true });
  } else {
    listQuery = listQuery.order("created_at", { ascending: false });
  }

  const from = (page - 1) * PAGE_SIZE;
  const [listResult, counts, selectedResult] = await Promise.all([
    listQuery.range(from, from + PAGE_SIZE - 1),
    loadCounts(db),
    selectedId
      ? db.from("leads").select(LEAD_COLUMNS).eq("id", selectedId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (listResult.error) {
    console.error("[admin/leads] list query failed", listResult.error.message);
  }

  // `as unknown as` for the reason /admin/claims needs it: the select list is
  // an assembled string, so supabase-js cannot infer a row type from it.
  const leads = (listResult.data ?? []) as unknown as LeadRow[];
  const selected = (selectedResult.data ?? null) as unknown as LeadRow | null;
  const total = listResult.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const displayName =
    (user.user_metadata?.full_name as string | undefined)?.trim() ||
    (user.email ?? "").split("@")[0] ||
    "Admin";

  return (
    <>
      <AdminHeader
        currentPath="/admin/leads"
        userName={displayName}
        userEmail={user.email}
        userInitials={initialsFor(displayName)}
        pendingClaims={counts.pendingClaims}
        pendingLeads={counts.byStatus.new}
      />

      <main id="main" className="min-h-screen bg-gray-100">
        <div className="mx-auto max-w-app px-8 py-8 max-[900px]:px-5">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="mb-1.5 font-serif text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] text-navy">
                Homeowner <em className="italic">leads</em>
              </h1>
              <p className="text-note text-gray-500">
                <strong className="font-medium text-gray-700">
                  {counts.total} total {counts.total === 1 ? "lead" : "leads"}
                </strong>{" "}
                · {counts.newThisWeek} new this week · routed to the concierge in
                GoHighLevel
              </p>
            </div>
            {/* Sign-out moved INTO AdminHeader on 2026-08-06. The note that
                stood here — "kept on the page rather than in AdminHeader, which
                the mockup renders as a static user chip with no menu" — was the
                reasoning that produced five copies of one control. The chip is
                still menu-less; the control is simply inline beside it. */}
          </div>

          {searchParams.e && ERROR_TEXT[searchParams.e] && (
            <p
              role="alert"
              className="mb-6 border-l-[3px] border-status-error bg-status-errorBg px-4 py-3 text-note text-status-error"
            >
              {ERROR_TEXT[searchParams.e]}
            </p>
          )}

          {/*
            THE GHL DIVERGENCE NOTE, ON SCREEN AND NOT ONLY IN THE CODE.
            Whoever uses this page needs to know that moving a status here does
            not move anything in GoHighLevel. Two records, one of them ours.
          */}
          <p className="mb-6 border-l-[3px] border-l-gold bg-gold-pale px-4 py-3 text-note leading-[1.6] text-gray-700">
            <strong className="font-semibold text-ink">These statuses are ours.</strong>{" "}
            Every lead is delivered to GoHighLevel at capture and worked there;
            nothing syncs back, so this pipeline is our own record and can differ
            from the stage the same lead sits in inside GHL.
          </p>

          <div className="mb-8">
            <StatsStrip
              ariaLabel="Lead pipeline statistics"
              columns={5}
              cards={[
                {
                  value: String(counts.newThisWeek),
                  label: "New This Week",
                  color: "gold",
                  delta: counts.weekDelta,
                  deltaType: counts.weekDeltaUp ? "up" : "flat",
                },
                { value: String(counts.total), label: "All-Time Leads" },
                {
                  value: String(counts.active),
                  label: "Active in Pipeline",
                  color: "green",
                },
                {
                  value: formatValueCompact(counts.pipelineValue),
                  label: "Pipeline Value (Est)",
                  color: "green",
                },
                {
                  /* Replaces the mockup's "Conversion to Call". Undelivered
                     leads are in GHL's queue for nobody — this is the only card
                     here that is ever an emergency. */
                  value: String(counts.undelivered),
                  label: "Undelivered to GHL",
                  color: counts.undelivered > 0 ? "warn" : undefined,
                  delta: counts.undelivered > 0 ? "needs a retry" : "all delivered",
                  deltaType: "flat",
                },
              ]}
            />
          </div>

          {/* TOOLBAR */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <form action="/admin/leads" method="get" role="search" className="relative">
                {status !== "all" && <input type="hidden" name="status" value={status} />}
                {sort !== "recent" && <input type="hidden" name="sort" value={sort} />}
                <label htmlFor="lead-search" className="sr-only">
                  Search leads
                </label>
                <input
                  id="lead-search"
                  name="q"
                  type="search"
                  defaultValue={q}
                  maxLength={60}
                  placeholder="Search by name, email, phone, or ZIP…"
                  className={`w-[320px] max-w-full border border-gray-300 bg-white px-3 py-2 text-ui text-ink placeholder:text-gray-500 focus:border-navy ${FOCUS_RING_PAPER}`}
                />
              </form>

              {STATUS_FILTERS.map((filter) => {
                const active = filter === status;
                const count =
                  filter === "all" ? counts.total : counts.byStatus[filter as LeadStatus];
                return (
                  <Link
                    key={filter}
                    href={leadsHref({ status: filter, q, sort })}
                    aria-current={active ? "page" : undefined}
                    className={`border px-3 py-1.5 text-ui font-medium transition-colors ${FOCUS_RING_PAPER} ${
                      active
                        ? "border-navy bg-navy text-paper"
                        : "border-gray-300 bg-white text-gray-700 hover:border-navy hover:text-navy"
                    }`}
                  >
                    {filter === "all" ? "All" : LEAD_STATUS_LABEL[filter as LeadStatus]}
                    <span
                      className={`ml-1.5 font-mono text-chip ${
                        active ? "text-gold-light" : "text-gray-500"
                      }`}
                    >
                      {count}
                    </span>
                  </Link>
                );
              })}
            </div>

            {/* Links, not a <select> — a select needs JS to navigate on change,
                and this page ships none. Three sorts fit on one line. */}
            <div className="flex items-center gap-3 font-mono text-label uppercase tracking-label text-gray-500">
              <span>Sort</span>
              {LEAD_SORTS.map((option) => (
                <Link
                  key={option}
                  href={leadsHref({ status, q, sort: option })}
                  aria-current={option === sort ? "page" : undefined}
                  className={`transition-colors ${FOCUS_RING_PAPER} ${
                    option === sort
                      ? "border-b-2 border-gold text-navy"
                      : "hover:text-navy"
                  }`}
                >
                  {LEAD_SORT_LABEL[option]}
                </Link>
              ))}
            </div>
          </div>

          {/* TABLE */}
          <div className="border border-gray-200 bg-white">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <Th>Lead</Th>
                  <Th>Persona</Th>
                  <Th>Suggested routing</Th>
                  <Th>Status</Th>
                  <Th>Received</Th>
                  <Th align="right">Est. value</Th>
                </tr>
              </thead>
              <tbody>
                {leads.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-note text-gray-600">
                      {q || status !== "all"
                        ? "No leads match that filter."
                        : "No leads yet. They arrive here from the diagnostic."}
                      {(q || status !== "all") && (
                        <>
                          {" "}
                          <Link
                            href="/admin/leads"
                            className={`text-navy underline decoration-gold underline-offset-2 ${FOCUS_RING_PAPER}`}
                          >
                            Clear filters
                          </Link>
                          .
                        </>
                      )}
                    </td>
                  </tr>
                )}

                {leads.map((lead) => {
                  const isSelected = lead.id === selected?.id;
                  const entities = Object.keys(lead.routed_entities ?? {});
                  return (
                    <tr
                      key={lead.id}
                      className={`border-b border-gray-100 transition-colors last:border-b-0 ${
                        isSelected ? "bg-gold-pale" : "hover:bg-gray-50"
                      } ${lead.status === "new" ? "border-l-[3px] border-l-gold" : ""}`}
                    >
                      <td className="px-5 py-3.5 align-top">
                        {/* The whole row's affordance is this one link. A row
                            of nested links is a keyboard trap and a screen
                            reader reads every one of them. */}
                        <Link
                          href={leadsHref({ status, q, sort, id: lead.id })}
                          className={`font-serif text-[15px] font-semibold leading-[1.25] text-ink underline decoration-transparent underline-offset-2 transition-colors hover:decoration-gold ${FOCUS_RING_PAPER}`}
                        >
                          {lead.name}
                        </Link>
                        <p className="mt-0.5 font-mono text-[11.5px] tracking-[0.02em] text-gray-500">
                          {lead.zip && (
                            <span className="font-semibold text-gold">{lead.zip}</span>
                          )}
                          {lead.zip && " · "}
                          {lead.phone}
                        </p>
                      </td>

                      <td className="px-5 py-3.5 align-top">
                        {lead.primary_persona ? (
                          <span className="inline-block bg-gray-100 px-2.5 py-1 text-[11.5px] font-medium text-gray-700">
                            {PERSONA_NAME[lead.primary_persona] ?? lead.primary_persona}
                          </span>
                        ) : (
                          <span className="text-note text-gray-500">—</span>
                        )}
                      </td>

                      <td className="px-5 py-3.5 align-top">
                        {entities.length > 0 ? (
                          <span className="flex flex-wrap items-center gap-1.5">
                            {entities.map((entity) => (
                              <span
                                key={entity}
                                title={entity}
                                className="bg-navy px-2 py-0.5 font-mono text-chip uppercase tracking-label text-gold-light"
                              >
                                {entityTag(entity)}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="text-note text-gray-500">Not routed</span>
                        )}
                      </td>

                      <td className="px-5 py-3.5 align-top">
                        <StatusPill status={lead.status} />
                      </td>

                      <td className="px-5 py-3.5 align-top">
                        <time
                          dateTime={lead.created_at}
                          title={absoluteTime(lead.created_at)}
                          className="whitespace-nowrap font-mono text-label tracking-[0.02em] text-gray-500"
                        >
                          {relativeTime(lead.created_at)}
                        </time>
                        {!lead.ghl_synced && (
                          <p className="mt-1 font-mono text-chip uppercase tracking-label text-status-error">
                            Not in GHL
                          </p>
                        )}
                      </td>

                      <td className="px-5 py-3.5 text-right align-top font-mono text-[13px] font-semibold text-navy">
                        {formatValue(lead.estimated_value)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {pageCount > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-5 py-3.5">
                <p className="font-mono text-label uppercase tracking-label text-gray-500">
                  Showing {from + 1}–{Math.min(from + PAGE_SIZE, total)} of {total}
                </p>
                <div className="flex items-center gap-2">
                  {page > 1 && (
                    <Link
                      href={leadsHref({ status, q, sort, page: page - 1 })}
                      className={`border border-gray-300 bg-white px-3 py-1.5 font-mono text-label uppercase tracking-label text-gray-700 hover:border-navy hover:text-navy ${FOCUS_RING_PAPER}`}
                    >
                      ← Prev
                    </Link>
                  )}
                  <span className="font-mono text-label uppercase tracking-label text-gray-500">
                    {page} / {pageCount}
                  </span>
                  {page < pageCount && (
                    <Link
                      href={leadsHref({ status, q, sort, page: page + 1 })}
                      className={`border border-gray-300 bg-white px-3 py-1.5 font-mono text-label uppercase tracking-label text-gray-700 hover:border-navy hover:text-navy ${FOCUS_RING_PAPER}`}
                    >
                      Next →
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>

          {selected && (
            <Detail
              lead={selected}
              statusTab={status}
              assignedToMe={selected.assigned_to_user_id === user.id}
            />
          )}
        </div>
      </main>
    </>
  );
}

/** "Jim Blackburn" -> "JB". Same helper as the contractor portal pages. */
function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0]}${parts[parts.length - 1][0]}`;
}

function leadsHref(params: {
  status: StatusFilter;
  q: string;
  sort: LeadSort;
  id?: string;
  page?: number;
}): string {
  const search = new URLSearchParams();
  if (params.status !== "all") search.set("status", params.status);
  if (params.q) search.set("q", params.q);
  if (params.sort !== "recent") search.set("sort", params.sort);
  if (params.id) search.set("id", params.id);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  const query = search.toString();
  return query ? `/admin/leads?${query}` : "/admin/leads";
}

/**
 * Every count on the page, in one place.
 *
 * COUNTED WITH head:true RATHER THAN OVER THE FETCHED ROWS, because the table
 * is paginated: counting the twelve rows on screen would make "All-Time Leads"
 * read 12 forever. The pipeline value is the one exception — it needs the
 * actual values, so it selects that single column across the matching rows.
 */
async function loadCounts(db: ReturnType<typeof createClient>) {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const twoWeeksAgo = new Date(Date.now() - 14 * 86_400_000).toISOString();

  /**
   * A fresh builder per count. Not a higher-order helper taking a callback —
   * that needed an `any` to type the builder it was handed, and an `any` in the
   * one function that produces every number on the page is a poor trade for
   * three saved lines.
   */
  const leadCount = () => db.from("leads").select("id", { count: "exact", head: true });

  const [
    total,
    thisWeek,
    priorWeek,
    undelivered,
    pendingClaims,
    values,
    ...statusCounts
  ] = await Promise.all([
    leadCount(),
    leadCount().gte("created_at", weekAgo),
    leadCount().gte("created_at", twoWeeksAgo).lt("created_at", weekAgo),
    leadCount().eq("ghl_synced", false),
    db.from("claims").select("id", { count: "exact", head: true }).eq("status", "pending"),
    db.from("leads").select("estimated_value").in("status", ACTIVE_STATUSES),
    ...LEAD_STATUSES.map((s) => leadCount().eq("status", s)),
  ]);

  const byStatus = Object.fromEntries(
    LEAD_STATUSES.map((s, i) => [s, statusCounts[i]?.count ?? 0]),
  ) as Record<LeadStatus, number>;

  const newThisWeek = thisWeek.count ?? 0;
  const priorCount = priorWeek.count ?? 0;
  const diff = newThisWeek - priorCount;

  return {
    total: total.count ?? 0,
    newThisWeek,
    /**
     * The mockup's "↑ 3 vs last week". Rendered verbatim including the arrow,
     * because StatsStrip treats the delta as copy rather than generating a
     * glyph from deltaType — see its docblock.
     */
    weekDelta:
      priorCount === 0 && newThisWeek === 0
        ? undefined
        : diff > 0
          ? `↑ ${diff} vs last week`
          : diff < 0
            ? `${diff} vs last week`
            : "level with last week",
    weekDeltaUp: diff > 0,
    byStatus,
    active: ACTIVE_STATUSES.reduce((sum, s) => sum + (byStatus[s] ?? 0), 0),
    pipelineValue: (values.data ?? []).reduce(
      (sum: number, r: { estimated_value: number | null }) => sum + (r.estimated_value ?? 0),
      0,
    ),
    undelivered: undelivered.count ?? 0,
    pendingClaims: pendingClaims.count ?? 0,
  };
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={`px-5 py-3 font-mono text-label font-semibold uppercase tracking-label text-gray-500 ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}

/** .status-pill from the mockup — a coloured chip with a matching dot. */
function StatusPill({ status }: { status: LeadStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-[11.5px] font-semibold ${LEAD_STATUS_PILL[status]}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${LEAD_STATUS_DOT[status]}`}
      />
      {LEAD_STATUS_LABEL[status]}
    </span>
  );
}

/**
 * The detail panel.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS IS THE PART THE MOCKUP DOES NOT HAVE, AND IT HAD TO EXIST.
 *
 * admin_leads.html renders status as a read-only pill and gives rows no
 * affordance at all — yet status, estimated value and assignment all have to be
 * set somewhere, and the diagnostic answers are the reason a concierge would
 * open a lead in the first place. A detail panel under the table is the
 * smallest addition that makes the page usable without redesigning it: the
 * table stays exactly as drawn, and ?id= reveals this beneath it.
 *
 * Under rather than beside, because the table is six columns wide and a
 * two-pane split would squeeze it to nothing. Not a modal, because a modal
 * needs client JS and a focus trap to be accessible.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function Detail({
  lead,
  statusTab,
  assignedToMe,
}: {
  lead: LeadRow;
  statusTab: StatusFilter;
  assignedToMe: boolean;
}) {
  const answers = lead.diagnostic_answers ?? {};
  const numbered = Object.keys(answers)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b));
  const named = Object.keys(answers).filter((k) => !/^\d+$/.test(k));
  const isClosed = lead.status === "closed_won" || lead.status === "closed_lost";

  return (
    <section className="mt-6 border border-gray-200 bg-white">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 bg-gray-50 px-7 py-5 max-[700px]:px-5">
        <div>
          <p className="mb-2 flex flex-wrap items-center gap-3 font-mono text-micro uppercase tracking-[0.06em] text-gray-500">
            <span className="font-semibold text-gray-700">Lead #{lead.id.slice(0, 8)}</span>
            <span aria-hidden="true" className="h-[3px] w-[3px] rounded-full bg-gray-400" />
            <span>Received {absoluteTime(lead.created_at)}</span>
          </p>
          <h2 className="font-serif text-[26px] font-semibold leading-[1.15] tracking-[-0.015em] text-navy">
            {lead.name}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-2.5 text-note text-gray-700">
            <a
              href={`mailto:${encodeURIComponent(lead.email)}`}
              className={`text-navy underline decoration-gold underline-offset-2 ${FOCUS_RING_PAPER}`}
            >
              {lead.email}
            </a>
            <span aria-hidden="true" className="h-[3px] w-[3px] rounded-full bg-gray-400" />
            <a
              href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}
              className={`text-navy underline decoration-gold underline-offset-2 ${FOCUS_RING_PAPER}`}
            >
              {lead.phone}
            </a>
            {lead.zip && (
              <>
                <span aria-hidden="true" className="h-[3px] w-[3px] rounded-full bg-gray-400" />
                <span>ZIP {lead.zip}</span>
              </>
            )}
          </p>
        </div>

        <form action={toggleLeadAssignment}>
          <input type="hidden" name="lead_id" value={lead.id} />
          <input type="hidden" name="status_tab" value={statusTab === "all" ? "" : statusTab} />
          <button
            type="submit"
            className={`border px-4 py-2.5 font-mono text-label font-semibold uppercase tracking-label transition-colors ${FOCUS_RING_PAPER} ${
              assignedToMe
                ? "border-navy bg-navy text-gold-light hover:bg-navy-deep"
                : "border-gray-300 bg-white text-gray-700 hover:border-navy hover:text-navy"
            }`}
          >
            {assignedToMe ? "Assigned to you — unassign" : "Assign to me"}
          </button>
        </form>
      </header>

      <div className="grid grid-cols-2 gap-7 px-7 py-6 max-[1200px]:grid-cols-1 max-[700px]:px-5">
        <div>
          <SectionHeading>What they told the diagnostic</SectionHeading>
          {numbered.length === 0 && named.length === 0 ? (
            <p className="text-note text-gray-500">
              No diagnostic answers on this lead — {lead.lead_source.replace(/_/g, " ")}.
            </p>
          ) : (
            <dl className="border border-gray-200">
              {numbered.map((key) => (
                <DetailRow key={key} term={`Q${key}`}>
                  {answers[key]}
                </DetailRow>
              ))}
              {named.map((key) => (
                <DetailRow key={key} term={key.replace(/_/g, " ")}>
                  {answers[key]}
                </DetailRow>
              ))}
            </dl>
          )}

          <SectionHeading className="mt-7">Suggested routing</SectionHeading>
          {Object.keys(lead.routed_entities ?? {}).length === 0 ? (
            <p className="text-note text-gray-500">Not routed to any entity.</p>
          ) : (
            <dl className="border border-gray-200">
              {Object.entries(lead.routed_entities ?? {}).map(([entity, reasons]) => (
                <DetailRow key={entity} term={entity}>
                  {/* The full entity name here, not the shortened tag — see
                      entityTag() in lib/leads.ts. */}
                  <ul className="flex flex-col gap-0.5">
                    {reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </DetailRow>
              ))}
            </dl>
          )}
        </div>

        <div>
          <SectionHeading>Concierge</SectionHeading>
          {/* The one form that writes. A single Save, so a partial write is not
              a state this UI can produce. */}
          <form action={saveLead} className="border border-gray-200 px-5 py-4">
            <input type="hidden" name="lead_id" value={lead.id} />
            <input type="hidden" name="status_tab" value={statusTab === "all" ? "" : statusTab} />

            <fieldset className="mb-4">
              <legend className="mb-2 font-mono text-label font-medium uppercase tracking-label text-gray-500">
                Status
              </legend>
              {/* Radios, not a select: five options, all visible, and the
                  current one readable without opening anything. */}
              <div className="flex flex-col gap-1.5">
                {LEAD_STATUSES.map((option) => (
                  <label key={option} className="flex items-center gap-2 text-note text-gray-700">
                    <input
                      type="radio"
                      name="status"
                      value={option}
                      defaultChecked={lead.status === option}
                      className={FOCUS_RING_PAPER}
                    />
                    {LEAD_STATUS_LABEL[option]}
                  </label>
                ))}
              </div>
            </fieldset>

            <label
              htmlFor="estimated-value"
              className="mb-1.5 block font-mono text-label font-medium uppercase tracking-label text-gray-500"
            >
              Estimated value
            </label>
            <input
              id="estimated-value"
              name="estimated_value"
              type="text"
              inputMode="numeric"
              defaultValue={lead.estimated_value ?? ""}
              placeholder="e.g. 1240"
              maxLength={12}
              className={`mb-4 w-full border border-gray-300 bg-white px-3 py-2 text-note text-ink ${FOCUS_RING_PAPER}`}
            />

            <label
              htmlFor="closed-reason"
              className="mb-1.5 block font-mono text-label font-medium uppercase tracking-label text-gray-500"
            >
              Closing reason
            </label>
            <textarea
              id="closed-reason"
              name="closed_reason"
              rows={2}
              maxLength={500}
              defaultValue={lead.closed_reason ?? ""}
              className={`mb-1.5 w-full border border-gray-300 bg-white px-3 py-2 text-note text-ink ${FOCUS_RING_PAPER}`}
            />
            <p className="mb-4 text-micro leading-[1.5] text-gray-500">
              {isClosed
                ? "Saved with the lead."
                : "Only kept on a closed lead — reopening one clears it."}
            </p>

            <SubmitButton
              pendingLabel="Saving…"
              className={`w-full bg-navy px-5 py-3 font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-paper transition-colors hover:bg-navy-deep ${FOCUS_RING_PAPER}`}
            >
              Save
            </SubmitButton>
          </form>

          <SectionHeading className="mt-7">Record</SectionHeading>
          <dl className="border border-gray-200">
            <DetailRow term="Source">{lead.lead_source.replace(/_/g, " ")}</DetailRow>
            <DetailRow term="First contacted">
              {lead.first_contacted_at ? absoluteTime(lead.first_contacted_at) : "Not yet"}
            </DetailRow>
            <DetailRow term="Closed">
              {lead.closed_at ? absoluteTime(lead.closed_at) : "Open"}
            </DetailRow>
            {lead.referring_url && (
              <DetailRow term="Came from">{lead.referring_url}</DetailRow>
            )}
            {/* TCPA: the stored consent text is the evidence that proves what
                the visitor actually saw — see lib/consent.ts. Shown in full
                rather than as a checkmark, because a checkmark proves nothing. */}
            <DetailRow term="SMS consent">
              {lead.sms_consent ? (
                <>
                  <span className="font-semibold text-status-success">Given</span>
                  {lead.sms_consent_timestamp && (
                    <span className="text-gray-500">
                      {" "}
                      · {absoluteTime(lead.sms_consent_timestamp)}
                    </span>
                  )}
                  {lead.sms_consent_text && (
                    <p className="mt-1.5 border-l-2 border-gray-200 pl-3 text-micro leading-[1.5] text-gray-500">
                      {lead.sms_consent_text}
                    </p>
                  )}
                </>
              ) : (
                <span className="text-gray-500">Not given — do not text this lead</span>
              )}
            </DetailRow>
            <DetailRow term="GoHighLevel">
              {lead.ghl_synced ? (
                <>
                  <span className="font-semibold text-status-success">Delivered</span>
                  {lead.ghl_synced_at && (
                    <span className="text-gray-500"> · {absoluteTime(lead.ghl_synced_at)}</span>
                  )}
                  {lead.ghl_contact_id && (
                    <p className="mt-1 font-mono text-micro text-gray-500">
                      contact {lead.ghl_contact_id}
                      {lead.ghl_opportunity_id && ` · opportunity ${lead.ghl_opportunity_id}`}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <span className="font-semibold text-status-error">Not delivered</span>
                  <p className="mt-1 text-micro leading-[1.5] text-gray-500">
                    This lead is in Postgres but never reached GoHighLevel, so
                    nobody is working it there.
                    {lead.ghl_last_error && (
                      <>
                        {" "}
                        Last error:{" "}
                        <span className="font-mono">{lead.ghl_last_error}</span>
                      </>
                    )}
                  </p>
                </>
              )}
            </DetailRow>
          </dl>
        </div>
      </div>
    </section>
  );
}

function SectionHeading({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={`mb-3 inline-flex items-center gap-2.5 font-mono text-label font-semibold uppercase tracking-eyebrow text-gold ${className}`}
    >
      <span aria-hidden="true" className="h-px w-4 bg-gold" />
      {children}
    </h3>
  );
}

function DetailRow({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_1fr] gap-4 border-b border-gray-100 px-4 py-2.5 last:border-b-0 max-[520px]:grid-cols-1 max-[520px]:gap-1">
      <dt className="font-mono text-label font-medium uppercase tracking-[0.06em] text-gray-500">
        {term}
      </dt>
      <dd className="text-note leading-[1.55] text-ink">{children}</dd>
    </div>
  );
}
