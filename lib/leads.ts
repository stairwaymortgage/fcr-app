/**
 * Leads pipeline — shared definitions.
 *
 * Imported by app/admin/leads/page.tsx and its actions, so the two cannot
 * disagree about what a status is called. Free of "server-only" and of any
 * Supabase import, matching lib/claims.ts and lib/inquiries.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS STATUS IS OURS, NOT GOHIGHLEVEL'S.
 *
 * Every lead is pushed to GHL on creation (lib/ghl.ts) and worked there by the
 * concierge. Nothing comes back: there is no webhook, no polling, and no
 * reconciliation anywhere in this app — the only route under app/api/ is the
 * ID-photo purge cron. 20260731_leads_ghl_sync.sql states the division outright:
 * "The leads table is the source of truth; GoHighLevel is delivery."
 *
 * So leads.status is OUR record of where a lead stands, and it can drift from
 * whatever stage the same lead sits in inside GHL. That is a real cost of
 * shipping this page without two-way sync, and the page says so on screen
 * rather than leaving it to be discovered. Do not quietly relabel this as "the"
 * pipeline stage — if the two ever need to agree, that is a webhook, a stage
 * mapping and a conflict rule, not a rename.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Mirrors the CHECK constraint on leads.status, and the mockup's pills. */
export const LEAD_STATUSES = [
  "new",
  "contacted",
  "in_progress",
  "closed_won",
  "closed_lost",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  in_progress: "In progress",
  closed_won: "Closed won",
  closed_lost: "Closed lost",
};

/**
 * Pill colours, taken from .status-pill in admin_leads.html:298-307.
 *
 * `contacted` is the only one whose mockup colour has no token: it uses
 * #e0eaf5, a pale blue that appears nowhere else in the design system. Rendered
 * here as navy on gray-100 rather than minting a one-use colour — the pill
 * still reads as "a state that is not new and not closed", which is the job it
 * does in a column of five.
 */
export const LEAD_STATUS_PILL: Record<LeadStatus, string> = {
  new: "bg-gold-pale text-gold",
  contacted: "bg-gray-100 text-navy",
  in_progress: "bg-status-warnBg text-status-warn",
  closed_won: "bg-status-successBg text-status-success",
  closed_lost: "bg-gray-100 text-gray-500",
};

/** The dot inside the pill. Same source. */
export const LEAD_STATUS_DOT: Record<LeadStatus, string> = {
  new: "bg-gold",
  contacted: "bg-navy",
  in_progress: "bg-status-warn",
  closed_won: "bg-status-success",
  closed_lost: "bg-gray-500",
};

/**
 * Which statuses count as live work.
 *
 * The mockup's "Active in Pipeline" card has no definition attached to it. This
 * is the only reading that makes the five cards add up: everything that has
 * been picked up but not finished.
 */
export const ACTIVE_STATUSES: readonly LeadStatus[] = ["contacted", "in_progress"];

/** The filter chips, in the mockup's order. "All" is the absence of a filter. */
export const STATUS_FILTERS = ["all", ...LEAD_STATUSES] as const;

export type StatusFilter = (typeof STATUS_FILTERS)[number];

export function parseStatusFilter(value: string | undefined): StatusFilter {
  return (STATUS_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as StatusFilter)
    : "all";
}

export const LEAD_SORTS = ["recent", "value", "oldest_unanswered"] as const;

export type LeadSort = (typeof LEAD_SORTS)[number];

export const LEAD_SORT_LABEL: Record<LeadSort, string> = {
  recent: "Most recent",
  value: "Highest value",
  oldest_unanswered: "Oldest unanswered",
};

export function parseSort(value: string | undefined): LeadSort {
  return (LEAD_SORTS as readonly string[]).includes(value ?? "")
    ? (value as LeadSort)
    : "recent";
}

export interface LeadRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  zip: string | null;
  lead_source: string;
  referring_url: string | null;
  diagnostic_answers: Record<string, string> | null;
  primary_persona: string | null;
  routed_entities: Record<string, string[]> | null;
  status: LeadStatus;
  assigned_to_user_id: string | null;
  estimated_value: number | null;
  closed_reason: string | null;
  sms_consent: boolean;
  sms_consent_text: string | null;
  sms_consent_timestamp: string | null;
  created_at: string;
  first_contacted_at: string | null;
  closed_at: string | null;
  ghl_synced: boolean;
  ghl_contact_id: string | null;
  ghl_opportunity_id: string | null;
  ghl_synced_at: string | null;
  ghl_last_error: string | null;
}

/**
 * ?q= is interpolated into a PostgREST `.or()` filter, which is a string
 * grammar — commas separate filters and parentheses group them. So this is an
 * allowlist, not an escape function; the reasoning is written out in full in
 * lib/inquiries.ts:sanitizeSearch.
 *
 * `+` survives here and does not there, because these rows carry E.164 phone
 * numbers and a search for "+1305" is a thing a person would type.
 */
export function sanitizeSearch(value: string | undefined): string {
  return (value ?? "")
    .replace(/[^a-zA-Z0-9 @.'+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/** "$1,240". Whole dollars — estimated_value is an integer column. */
export function formatValue(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `$${value.toLocaleString("en-US")}`;
}

/**
 * "$847K" for the stats strip, matching the mockup's compact form.
 * Below 1,000 it stays exact, because "$0K" for a real $420 would be a lie in
 * the one place the number is supposed to be a summary.
 */
export function formatValueCompact(total: number): string {
  if (total >= 1_000_000) return `$${(total / 1_000_000).toFixed(1)}M`;
  if (total >= 1_000) return `$${Math.round(total / 1_000)}K`;
  return `$${total.toLocaleString("en-US")}`;
}

/**
 * "9 min ago" / "2 hr ago" / "Yesterday" / "3 days ago" / "May 18".
 *
 * Duplicated from lib/inquiries.ts rather than shared. TWO CALLERS IS NOT THREE
 * — and the two are not obviously the same function: this one labels an admin
 * queue where "oldest unanswered" is the point, and that one labels a
 * contractor's mail. If a third appears, extract then, and the extraction will
 * have three real call sites to be shaped by.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const days = Math.round((startOfToday.getTime() - startOfThen.getTime()) / 86_400_000);

  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;

  return then.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(then.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

export function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" });
}

/**
 * The mockup renders "Suggested Routing" as an entity tag plus a phrase like
 * "HELOC pre-approval, $45K kitchen reno". No such phrase is stored — that is
 * mockup prose. routed_entities is a map of entity → reasons, written by
 * lib/lead-routing.ts, so the reasons are what gets rendered.
 *
 * Entity names are shortened for the tag only. The full name stays in the
 * detail panel, because "BBC" beside "Capital" in a table is exactly the kind
 * of abbreviation that stops meaning anything six months later.
 */
export function entityTag(entity: string): string {
  return entity
    .replace(/^Blackburn\s+/, "")
    .replace(/\s+Group$/, "")
    .replace(/\s+Mortgage$/, "");
}
