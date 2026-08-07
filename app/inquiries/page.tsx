import type { Metadata } from "next";
import Link from "next/link";

import ContractorHeader from "@/components/ContractorHeader";
import ListDetailLayout from "@/components/ListDetailLayout";
import StatsStrip from "@/components/StatsStrip";
import { requireUser } from "@/lib/auth";
import { formatBusinessName, formatPersonName } from "@/lib/contractor-profile";
import { FOCUS_RING_PAPER } from "@/lib/focus";
import {
  absoluteTime,
  INQUIRY_TABS,
  parseTab,
  relativeTime,
  replyMailto,
  sanitizeSearch,
  snippet,
  TAB_LABEL,
  TAB_STATUSES,
  telHref,
  type InquiryRow,
  type InquiryTab,
} from "@/lib/inquiries";
import { createClient } from "@/lib/supabase/server";

import { archiveInquiry, markReplied, restoreInquiry } from "./actions";

/**
 * Contractor inquiries inbox — /inquiries
 * Source: _handoff/02_mockups_production/04_contractor_facing/contractor_inquiries.html
 *
 * The first consumer of ListDetailLayout, which was written for this page.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT A CONTRACTOR SEES IS DECIDED THREE TIMES.
 *
 *   1. middleware.ts bounces a signed-out visitor to /login. Not a boundary —
 *      it does not run for Server Actions.
 *   2. This page reads contractors WHERE claimed_by_user_id = auth.uid() and
 *      filters every inquiry query to those sync keys.
 *   3. RLS refuses at the database: "contractor reads own inquiries" is the
 *      only SELECT path, and after
 *      db/migrations/20260804_inquiry_status_lockdown.sql there is no
 *      contractor-facing write path except set_own_inquiry_status().
 *
 * Layer 2 looks redundant next to layer 3 and is not: it is what makes the
 * COUNTS correct. RLS filters rows; it does not stop this page asking for a
 * count across the whole table and rendering whatever number comes back.
 *
 * NO SLUG IN THE URL, unlike /manage/[slug]. A contractor may hold several
 * licences — Aceca holds three — and this is one inbox across all of them,
 * which is also why the route is flat in the mockup's nav and in middleware's
 * gate list. When more than one profile is claimed, each row says which one it
 * came to; with one profile that line would be noise, so it is omitted.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * OMITTED FROM THE MOCKUP, DELIBERATELY:
 *
 *   · "Profile Views (30 days) · ↑ 38%" — there is no view tracking anywhere in
 *     this product. A number under that label would be invented, and the
 *     contractor would price a $29/mo upgrade against it.
 *   · The "Project Details" pane — budget, timeline, financing, decision style.
 *     Real data, but it belongs to the diagnostic flow and lands in `leads`,
 *     not in `inquiries`; an inquiry is nine columns from a contact form. The
 *     mockup shows one screen for two different objects.
 *   · The Featured upsell strip. Stripe is week 6, and /manage/[slug] left the
 *     matching $29 toggle out for the same reason.
 *   · "You typically respond within 4 hours". replied_at is self-reported —
 *     replying happens in the contractor's own mail client, which this app
 *     cannot observe — so the figure would be a claim dressed as a measurement.
 *   · The Copy button beside the phone number. It needs a client component and
 *     the clipboard API to do what the tel: and mailto: links already do.
 */

export const metadata: Metadata = {
  title: "Inquiries · Florida Contractor Registry",
  robots: { index: false, follow: false },
};

/**
 * Rows fetched for the list. The inbox is small by nature — a contractor gets
 * tens of these, not thousands — and the mockup's list panel scrolls rather than
 * paginating, so a cap plus an honest note beats building pagination for a case
 * nobody has hit. If someone does hit it, the note says so rather than the list
 * silently ending.
 */
const LIST_LIMIT = 100;

const INQUIRY_COLUMNS =
  "id, contractor_dbpr_sync_key, from_name, from_email, from_phone, message, " +
  "status, replied_at, created_at";

/** ?id= arrives from the URL. A malformed uuid would 400 the query. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ?e= codes set by ./actions.ts. Never a raw Postgres message. */
const ERROR_TEXT: Record<string, string> = {
  notyours: "That inquiry wasn’t sent to a profile you manage.",
  gone: "That inquiry no longer exists.",
  failed: "Something went wrong on our side. Nothing was changed — try again.",
};

interface OwnedProfile {
  dbpr_sync_key: string;
  slug: string;
  business_name: string | null;
  qualifying_agent_name: string;
  city: string | null;
}

export default async function InquiriesPage({
  searchParams,
}: {
  searchParams: { tab?: string; id?: string; q?: string; e?: string };
}) {
  const user = await requireUser("/inquiries");
  const db = createClient();

  const { data: profileData, error: profileError } = await db
    .from("contractors")
    .select("dbpr_sync_key, slug, business_name, qualifying_agent_name, city")
    .eq("claimed_by_user_id", user.id)
    .order("claimed_at", { ascending: true });

  if (profileError) {
    console.error("[inquiries] could not load claimed profiles", profileError.message);
  }

  const profiles = (profileData ?? []) as OwnedProfile[];

  // Signed in, but nothing claimed yet — a pending claimant, or a homeowner who
  // followed a portal link. NOT a 404: unlike /manage/[slug], this route holds
  // nothing about anyone else, so there is no existence to conceal, and 404ing a
  // contractor whose claim is still in review would read as "we lost you".
  if (profiles.length === 0) return <NoClaimedProfile />;

  const byKey = new Map(profiles.map((p) => [p.dbpr_sync_key, p]));
  const keys = profiles.map((p) => p.dbpr_sync_key);
  const primary = profiles[0];
  const showsProfileName = profiles.length > 1;

  const tab = parseTab(searchParams.tab);
  const q = sanitizeSearch(searchParams.q);
  const selectedId =
    searchParams.id && UUID_SHAPE.test(searchParams.id) ? searchParams.id : null;

  /**
   * The selected inquiry is fetched on its own rather than found in the list,
   * so that it renders even when it is not in the current tab — which is the
   * normal case one click after opening something from Archived, and the case
   * mark-as-read creates below.
   */
  let selected: InquiryRow | null = null;
  if (selectedId) {
    const { data } = await db
      .from("inquiries")
      .select(INQUIRY_COLUMNS)
      .eq("id", selectedId)
      .in("contractor_dbpr_sync_key", keys)
      .maybeSingle();
    selected = (data as InquiryRow | null) ?? null;
  }

  /**
   * ═════════════════════════════════════════════════════════════════════════
   * MARK-AS-READ ON OPEN — A WRITE DURING A GET, AND THE ONE GUARD IT NEEDS.
   *
   * Opening an inquiry is a navigation to ?id=…, so the only place the read can
   * be recorded without a second click is here, in the render. That is fine for
   * a real click and dangerous for a PREFETCHED one: Next prefetches <Link>s on
   * hover and in the viewport, and a prefetch that reached this line would mark
   * an inquiry read because the cursor passed over it.
   *
   * The list rows therefore carry prefetch={false}, and that prop is the guard —
   * not a performance tweak. Do not remove it. It is paired with this write, and
   * the failure it prevents is silent: the badge count drops and nobody can say
   * why.
   *
   * Ordered before the counts and the list on purpose, so both reflect the read
   * that just happened instead of showing a stale unread badge for one render.
   * ═════════════════════════════════════════════════════════════════════════
   */
  if (selected?.status === "unread") {
    const { error } = await db.rpc("set_own_inquiry_status", {
      p_inquiry_id: selected.id,
      p_status: "read",
    });
    if (error) {
      // Not fatal and not surfaced: the contractor is reading the inquiry right
      // now, which is what they came for. A failed bookkeeping write must not
      // turn into an error page over the top of it.
      console.error("[inquiries] mark-as-read failed", {
        code: error.code,
        message: error.message,
      });
    } else {
      selected = { ...selected, status: "read" };
    }
  }

  const inbox = () =>
    db.from("inquiries").select("*", { count: "exact", head: true }).in("contractor_dbpr_sync_key", keys);

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  let list = db
    .from("inquiries")
    .select(INQUIRY_COLUMNS)
    .in("contractor_dbpr_sync_key", keys)
    .in("status", TAB_STATUSES[tab])
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);

  if (q) {
    // q is allowlisted in sanitizeSearch() — this is a PostgREST filter
    // grammar, not a value slot. See the docblock there.
    list = list.or(
      `from_name.ilike.*${q}*,from_email.ilike.*${q}*,message.ilike.*${q}*`,
    );
  }

  const [newCount, allCount, monthCount, totalCount, listResult] = await Promise.all([
    inbox().in("status", TAB_STATUSES.new),
    inbox().in("status", TAB_STATUSES.all),
    inbox().gte("created_at", startOfMonth.toISOString()),
    inbox(),
    list,
  ]);

  if (listResult.error) {
    console.error("[inquiries] list query failed", listResult.error.message);
  }

  // `as unknown as` for the same reason /admin/claims needs it: the select list
  // is an assembled string, so supabase-js cannot infer a row type from it and
  // falls back to a shape that does not overlap this one.
  let rows = (listResult.data ?? []) as unknown as InquiryRow[];

  /**
   * Keep the open inquiry in the list it was opened from.
   *
   * Without this, clicking an unread row in the New tab makes it vanish from
   * under the cursor — mark-as-read moves it out of that tab in the same render
   * that opens it. The row stays, now styled as read, and leaves on the next
   * navigation. Search is the one case where it does not: a row that does not
   * match the query has no business being in the results.
   */
  if (selected && !q && !rows.some((r) => r.id === selected!.id)) {
    rows = [...rows, selected].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  const displayName =
    (user.user_metadata?.full_name as string | undefined)?.trim() ||
    (user.email ?? "").split("@")[0] ||
    "Your account";

  const primaryName = primary.business_name
    ? formatBusinessName(primary.business_name)
    : formatPersonName(primary.qualifying_agent_name);

  return (
    <>
      <ContractorHeader
        currentPath="/inquiries"
        contractorSlug={primary.slug}
        userName={displayName}
        userEmail={user.email}
        userInitials={initialsFor(displayName)}
        unreadInquiries={newCount.count ?? 0}
      />

      <main id="main" className="min-h-screen bg-gray-100">
        <div className="mx-auto max-w-app px-8 py-8 max-[900px]:px-5">
          <div className="mb-7">
            <h1 className="mb-1.5 font-serif text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] text-navy">
              Homeowner <em className="italic">inquiries</em>
            </h1>
            <p className="text-note text-gray-500">
              {showsProfileName ? (
                <>
                  Inquiries that came through your{" "}
                  <strong className="font-medium text-gray-700">
                    {profiles.length} claimed profiles
                  </strong>
                </>
              ) : (
                <>
                  Inquiries that came through your{" "}
                  <strong className="font-medium text-gray-700">{primaryName}</strong>{" "}
                  profile
                </>
              )}
            </p>
          </div>

          {/*
            ⚠ THE INBOX IS HISTORY AS OF 2026-08-07 AND SAYS SO.

            The inquiry form was removed from public contractor profiles that
            day, so nothing new arrives here. The table, this page, the actions
            and the RLS are all deliberately intact — the messages below are real
            and still belong to the contractors who received them.

            The notice exists because the alternative is worse than an empty
            inbox: a contractor who claimed their profile on the strength of
            "read homeowner inquiries" would otherwise sit in front of a screen
            that never updates and conclude the product is broken, or that
            homeowners are not interested. Neither is true.
          */}
          <div className="mb-7 border-l-[3px] border-l-gold bg-gray-50 px-5 py-4">
            <p className="mb-1.5 font-mono text-label font-semibold uppercase tracking-label text-navy">
              This inbox is now a record, not a feed.
            </p>
            <p className="text-note leading-[1.6] text-gray-700">
              We&rsquo;ve replaced the message box on public profiles with a
              short questionnaire, and homeowners who complete it are called back
              by our advisory team instead. Everything you received before that
              change is still here and still yours &mdash; nothing new will
              arrive.
            </p>
          </div>

          {searchParams.e && ERROR_TEXT[searchParams.e] && (
            <p
              role="alert"
              className="mb-6 border-l-[3px] border-status-error bg-status-errorBg px-4 py-3 text-note text-status-error"
            >
              {ERROR_TEXT[searchParams.e]}
            </p>
          )}

          <div className="mb-8">
            <StatsStrip
              ariaLabel="Inquiry statistics"
              columns={3}
              cards={[
                {
                  value: String(newCount.count ?? 0),
                  label: "New Inquiries",
                  color: "gold",
                },
                { value: String(monthCount.count ?? 0), label: "This Month" },
                { value: String(totalCount.count ?? 0), label: "All Time" },
              ]}
            />
          </div>

          <ListDetailLayout
            listLabel="Inbox"
            listWidth={380}
            listTabs={
              <Tabs
                active={tab}
                q={q}
                counts={{ new: newCount.count ?? 0, all: allCount.count ?? 0 }}
              />
            }
            listSearch={<SearchBox tab={tab} q={q} />}
            listItems={
              rows.length > 0
                ? rows.map((row) => (
                    <Row
                      key={row.id}
                      row={row}
                      tab={tab}
                      q={q}
                      selected={row.id === selected?.id}
                      profileName={
                        showsProfileName
                          ? profileLabel(byKey.get(row.contractor_dbpr_sync_key))
                          : null
                      }
                    />
                  ))
                : [<EmptyList key="empty" tab={tab} q={q} />]
            }
            selectedDetail={
              selected ? (
                <Detail
                  inquiry={selected}
                  profile={byKey.get(selected.contractor_dbpr_sync_key)}
                  tab={tab}
                  q={q}
                />
              ) : (
                <NoSelection hasRows={rows.length > 0} />
              )
            }
          />

          {rows.length === LIST_LIMIT && (
            <p className="mt-4 font-mono text-label uppercase tracking-label text-gray-500">
              Showing the {LIST_LIMIT} most recent — older inquiries are still in
              the counts above.
            </p>
          )}
        </div>
      </main>
    </>
  );
}

/** "Cristian Acero" -> "CA". Same helper as /manage/[slug]; see the note there
 *  on why initials are not derived inside ContractorHeader. */
function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0]}${parts[parts.length - 1][0]}`;
}

function profileLabel(profile: OwnedProfile | undefined): string | null {
  if (!profile) return null;
  return profile.business_name
    ? formatBusinessName(profile.business_name)
    : formatPersonName(profile.qualifying_agent_name);
}

/** Every internal link on this page carries the whole view: tab, search, and
 *  which inquiry is open. Selection is URL state — nothing here holds any. */
function inboxHref(params: { tab: InquiryTab; q: string; id?: string }): string {
  const search = new URLSearchParams();
  if (params.tab !== "new") search.set("tab", params.tab);
  if (params.q) search.set("q", params.q);
  if (params.id) search.set("id", params.id);
  const query = search.toString();
  return query ? `/inquiries?${query}` : "/inquiries";
}

/**
 * New / All / Archived.
 *
 * Links, not buttons — the mockup renders <button>s, which would need client
 * state to do anything. Archived carries no count, matching the mockup, and it
 * is the right call regardless: an archive is not a queue, so a number on it
 * would invite clearing it.
 */
function Tabs({
  active,
  q,
  counts,
}: {
  active: InquiryTab;
  q: string;
  counts: { new: number; all: number };
}) {
  return (
    <>
      {INQUIRY_TABS.map((tab) => {
        const isActive = tab === active;
        const count = tab === "archived" ? null : counts[tab];
        return (
          <Link
            key={tab}
            href={inboxHref({ tab, q })}
            aria-current={isActive ? "page" : undefined}
            className={`pb-1.5 transition-colors ${FOCUS_RING_PAPER} ${
              isActive
                ? "border-b-2 border-gold font-semibold text-navy"
                : "text-gray-500 hover:text-navy"
            }`}
          >
            {TAB_LABEL[tab]}
            {count !== null && (
              <span
                className={`ml-1.5 inline-block rounded-full px-1.5 py-0.5 font-mono text-chip ${
                  isActive ? "bg-navy text-gold-light" : "bg-gray-200 text-gray-700"
                }`}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </>
  );
}

/**
 * A plain GET form. Submitting navigates to ?q=…, the server filters, and the
 * URL is shareable and back-buttonable — none of which a client-side filter
 * would give. `tab` rides along hidden so searching does not silently move the
 * contractor to a different tab.
 */
function SearchBox({ tab, q }: { tab: InquiryTab; q: string }) {
  return (
    <form action="/inquiries" method="get" role="search" className="relative">
      {tab !== "new" && <input type="hidden" name="tab" value={tab} />}
      <label htmlFor="inquiry-search" className="sr-only">
        Search inquiries
      </label>
      {/* Decorative: the input has a real label above. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        id="inquiry-search"
        name="q"
        type="search"
        defaultValue={q}
        maxLength={60}
        placeholder="Search inquiries…"
        className={`w-full border border-gray-300 bg-paper py-2 pl-9 pr-3 text-ui text-ink placeholder:text-gray-500 focus:border-navy ${FOCUS_RING_PAPER}`}
      />
    </form>
  );
}

/**
 * One row of the master list.
 *
 * prefetch={false} IS LOAD-BEARING — see the mark-as-read block in the page
 * body. A prefetched navigation would run that write on hover.
 */
function Row({
  row,
  tab,
  q,
  selected,
  profileName,
}: {
  row: InquiryRow;
  tab: InquiryTab;
  q: string;
  selected: boolean;
  profileName: string | null;
}) {
  const unread = row.status === "unread";

  return (
    <Link
      href={inboxHref({ tab, q, id: row.id })}
      prefetch={false}
      aria-current={selected ? "true" : undefined}
      className={`relative block border-b border-gray-100 py-4 transition-colors ${FOCUS_RING_PAPER} ${
        selected
          ? "border-l-[3px] border-l-gold bg-gold-pale pl-[17px] pr-5"
          : `px-5 hover:bg-gray-50 ${
              unread
                ? "bg-gradient-to-r from-gold-pale via-transparent via-30% to-transparent before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-gold before:content-['']"
                : ""
            }`
      }`}
    >
      <div className="mb-1 flex items-start justify-between gap-2.5">
        <span className="flex items-center gap-2 font-serif text-[15px] font-semibold leading-[1.25] tracking-[-0.005em] text-ink">
          {unread && (
            <>
              <span
                aria-hidden="true"
                className="h-[7px] w-[7px] shrink-0 rounded-full bg-gold"
              />
              <span className="sr-only">Unread. </span>
            </>
          )}
          {row.from_name}
        </span>
        <time
          dateTime={row.created_at}
          title={absoluteTime(row.created_at)}
          className="mt-0.5 whitespace-nowrap font-mono text-label tracking-[0.02em] text-gray-500"
        >
          {relativeTime(row.created_at)}
        </time>
      </div>

      <p className="mb-1.5 line-clamp-2 text-[12.5px] leading-[1.45] text-gray-700">
        {snippet(row.message)}
      </p>

      <p className="flex items-center gap-2 font-mono text-[11.5px] tracking-[0.04em] text-gray-500">
        <span className="truncate">{row.from_email}</span>
        {profileName && (
          <>
            <Dot />
            <span className="truncate font-semibold text-gold">{profileName}</span>
          </>
        )}
        {row.replied_at && (
          <>
            <Dot />
            <span className="whitespace-nowrap text-status-success">Replied</span>
          </>
        )}
      </p>
    </Link>
  );
}

/** The 3px separator dot the mockup uses between meta fields. */
function Dot() {
  return (
    <span
      aria-hidden="true"
      className="h-[3px] w-[3px] shrink-0 rounded-full bg-gray-400"
    />
  );
}

function EmptyList({ tab, q }: { tab: InquiryTab; q: string }) {
  const text = q
    ? "Nothing matches that search."
    : tab === "new"
      ? "No new inquiries. Homeowners who contact you through your profile land here."
      : tab === "archived"
        ? "Nothing archived yet."
        : "No inquiries yet. They arrive here the moment a homeowner uses the contact form on your profile.";

  return (
    <p className="px-5 py-10 text-center text-note leading-[1.6] text-gray-600">
      {text}
      {q && (
        <>
          {" "}
          <Link
            href={inboxHref({ tab, q: "" })}
            className={`text-navy underline decoration-gold underline-offset-2 ${FOCUS_RING_PAPER}`}
          >
            Clear the search
          </Link>
          .
        </>
      )}
    </p>
  );
}

/**
 * The detail pane with nothing selected.
 *
 * NO ROW IS SELECTED BY DEFAULT, and the mockup does select its first one. That
 * would mark the newest unread inquiry as read every time the inbox is merely
 * opened — the contractor's unread badge would empty itself and the one thing an
 * inbox has to be right about is which mail has been read. The cost is this
 * placeholder; the reference layout (list_detail_layout.html) has one.
 */
function NoSelection({ hasRows }: { hasRows: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center px-10 py-16">
      <p className="max-w-[320px] text-center text-note leading-[1.7] text-gray-500">
        {hasRows
          ? "Pick an inquiry on the left to read it in full and get the homeowner’s contact details."
          : "When a homeowner contacts you through your public profile, their message appears here with a way to reach them."}
      </p>
    </div>
  );
}

function Detail({
  inquiry,
  profile,
  tab,
  q,
}: {
  inquiry: InquiryRow;
  profile: OwnedProfile | undefined;
  tab: InquiryTab;
  q: string;
}) {
  const business = profileLabel(profile) ?? "your profile";
  const firstName = inquiry.from_name.split(/\s+/)[0] || inquiry.from_name;
  const archived = inquiry.status === "archived";

  return (
    <>
      <header className="border-b border-gray-200 bg-gray-50 px-9 pb-6 pt-7 max-[700px]:px-5">
        <p className="mb-3.5 flex flex-wrap items-center gap-3 font-mono text-micro font-medium uppercase tracking-[0.06em] text-gray-500">
          {/* The mockup's "INQUIRY #INQ-2026-1847" is a sequence this table does
              not have. The uuid's first block is what /admin/claims shows for
              the same purpose: enough to quote in an email, not a guessable id. */}
          <span className="font-semibold text-gray-700">
            Inquiry #{inquiry.id.slice(0, 8)}
          </span>
          <Dot />
          <span>Received {absoluteTime(inquiry.created_at)}</span>
          {inquiry.replied_at && (
            <>
              <Dot />
              <span className="text-status-success">
                Replied {absoluteTime(inquiry.replied_at)}
              </span>
            </>
          )}
          {archived && (
            <>
              <Dot />
              <span className="bg-gray-200 px-2 py-0.5 font-semibold tracking-eyebrow text-gray-700">
                Archived
              </span>
            </>
          )}
        </p>

        <h3 className="mb-1.5 font-serif text-[26px] font-semibold leading-[1.15] tracking-[-0.015em] text-navy">
          {inquiry.from_name}
        </h3>

        <p className="flex flex-wrap items-center gap-2.5 text-note text-gray-700">
          <span>{relativeTime(inquiry.created_at)}</span>
          <Dot />
          <span>Sent to {business}</span>
        </p>
      </header>

      <div className="flex-1 px-9 py-8 max-[700px]:px-5">
        <section className="mb-9">
          <SectionHeading>Contact information</SectionHeading>
          <div className="border border-gray-200 bg-paper px-6 py-5">
            <dl className="grid grid-cols-2 gap-x-9 gap-y-5 max-[1200px]:grid-cols-1 max-[1200px]:gap-4">
              <Field label="Email">
                <a
                  href={replyMailto(inquiry, business)}
                  className={`inline-block border-b border-gold pb-px text-navy ${FOCUS_RING_PAPER}`}
                >
                  {inquiry.from_email}
                </a>
              </Field>
              <Field label="Phone">
                {inquiry.from_phone ? (
                  <a
                    href={telHref(inquiry.from_phone)}
                    className={`inline-block border-b border-gold pb-px text-navy ${FOCUS_RING_PAPER}`}
                  >
                    {inquiry.from_phone}
                  </a>
                ) : (
                  <span className="text-gray-500">Not provided — email only</span>
                )}
              </Field>
              <Field label="Received">{absoluteTime(inquiry.created_at)}</Field>
              <Field label="Profile contacted">
                {profile ? (
                  <Link
                    href={`/contractor/${profile.slug}`}
                    className={`inline-block border-b border-gold pb-px text-navy ${FOCUS_RING_PAPER}`}
                  >
                    {business}
                  </Link>
                ) : (
                  business
                )}
              </Field>
            </dl>
          </div>
        </section>

        <section>
          <SectionHeading>What they wrote</SectionHeading>
          <div className="border border-gray-200 bg-paper-raised px-7 py-6">
            {/* whitespace-pre-line, so the paragraph breaks a homeowner typed
                survive. The submit action collapses runs of whitespace, so this
                cannot become a wall of blank lines. */}
            <p className="whitespace-pre-line font-serif text-[15px] italic leading-[1.7] text-gray-700">
              {inquiry.message}
            </p>
          </div>
        </section>
      </div>

      {/*
        ACTION BAR. Three forms and up to two links, no client JS.

        REPLY LEAVES THIS APP, BY DESIGN. There is no in-app messaging and this
        is not a placeholder for it — see lib/inquiries.ts:replyMailto. Marking
        replied is therefore the contractor's own assertion, which is why the
        button says "Mark as replied" rather than "Replied".
      */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-gray-200 bg-gray-50 px-9 py-5 max-[700px]:px-5">
        <p className="font-mono text-[12.5px] tracking-[0.02em] text-gray-500">
          {inquiry.replied_at ? (
            <>
              You marked this <strong className="font-semibold text-gray-700">replied</strong>{" "}
              {relativeTime(inquiry.replied_at)}
            </>
          ) : (
            <>
              Received{" "}
              <strong className="font-semibold text-gray-700">
                {relativeTime(inquiry.created_at)}
              </strong>{" "}
              · not yet marked replied
            </>
          )}
        </p>

        <div className="flex flex-wrap items-center gap-2.5">
          <form action={archived ? restoreInquiry : archiveInquiry}>
            <ActionFields id={inquiry.id} tab={tab} q={q} />
            <button type="submit" className={`${BUTTON_BASE} ${BUTTON_SECONDARY}`}>
              {archived ? "Move back to inbox" : "Archive"}
            </button>
          </form>

          {!inquiry.replied_at && (
            <form action={markReplied}>
              <ActionFields id={inquiry.id} tab={tab} q={q} />
              <button type="submit" className={`${BUTTON_BASE} ${BUTTON_SECONDARY}`}>
                Mark as replied
              </button>
            </form>
          )}

          {inquiry.from_phone && (
            <a
              href={telHref(inquiry.from_phone)}
              className={`${BUTTON_BASE} ${BUTTON_SECONDARY}`}
            >
              Call {firstName}
            </a>
          )}

          <a
            href={replyMailto(inquiry, business)}
            className={`${BUTTON_BASE} ${BUTTON_PRIMARY}`}
          >
            Email {firstName} →
          </a>
        </div>
      </div>
    </>
  );
}

/**
 * The view the contractor was looking at, carried through the action so the
 * redirect can put them back on the same tab and search.
 */
function ActionFields({ id, tab, q }: { id: string; tab: InquiryTab; q: string }) {
  return (
    <>
      <input type="hidden" name="inquiry_id" value={id} />
      <input type="hidden" name="tab" value={tab} />
      <input type="hidden" name="q" value={q} />
    </>
  );
}

/** Gold rule + uppercase mono caption. The mockup's .section-h3. */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-4 inline-flex items-center gap-2.5 font-mono text-label font-semibold uppercase tracking-eyebrow text-gold">
      <span aria-hidden="true" className="h-px w-4 bg-gold" />
      {children}
    </h4>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="mb-1 font-mono text-label font-medium uppercase tracking-[0.06em] text-gray-500">
        {label}
      </dt>
      <dd className="text-[14.5px] font-medium text-ink">{children}</dd>
    </div>
  );
}

const BUTTON_BASE =
  "inline-block px-[22px] py-2.5 text-center font-sans text-[12.5px] font-semibold uppercase tracking-[0.04em] transition-colors " +
  FOCUS_RING_PAPER;

const BUTTON_SECONDARY =
  "border border-gray-300 bg-paper-raised text-gray-700 hover:border-navy hover:text-navy";

const BUTTON_PRIMARY =
  "border border-navy bg-navy text-gold-light hover:bg-navy-deep hover:text-white";

/**
 * Signed in, nothing claimed.
 *
 * NO ContractorHeader HERE — every link in it is slug-scoped and there is no
 * slug. A header pointing at /manage/undefined would be worse than none.
 */
function NoClaimedProfile() {
  return (
    <main id="main" className="min-h-screen bg-paper">
      <div className="mx-auto max-w-[640px] px-6 py-20 text-center">
        <p className="mb-3 font-mono text-micro font-semibold uppercase tracking-eyebrow text-gold">
          Contractor portal
        </p>
        <h1 className="mb-4 font-serif text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] text-navy">
          No inquiries yet
        </h1>
        <p className="mb-8 text-[15px] leading-[1.7] text-gray-700">
          This inbox fills up once a profile is verified as yours. If you have
          already sent us your ID, your claim is with us for review and we will
          email you the moment it is approved — nothing else is needed from you.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/search"
            className={`${BUTTON_BASE} ${BUTTON_PRIMARY}`}
          >
            Find your profile →
          </Link>
          <Link href="/dashboard" className={`${BUTTON_BASE} ${BUTTON_SECONDARY}`}>
            Your account
          </Link>
        </div>
      </div>
    </main>
  );
}
