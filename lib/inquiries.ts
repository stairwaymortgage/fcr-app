/**
 * Inquiries inbox — shared definitions.
 *
 * Imported by app/inquiries/page.tsx and app/inquiries/actions.ts, so the two
 * cannot disagree about what a tab is called or which statuses belong to it.
 * Deliberately free of "server-only" and of any Supabase import: it holds
 * vocabulary and pure functions, nothing privileged.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE COLUMN CARRIES THE WHOLE FLOW.
 *
 * inquiries.status is a single text column — 'unread' | 'read' | 'replied' |
 * 'archived' — with a CHECK constraint and no companion timestamps. There is no
 * read_at and no archived_at; only replied_at exists.
 *
 * THE CONSEQUENCE, AND IT IS NOT A BUG TO BE ROUTED AROUND: archiving a replied
 * inquiry overwrites 'replied', so the tabs cannot show "replied" and "archived"
 * as independent facts. replied_at survives (set_own_inquiry_status() never
 * clears it), which is why the detail pane reads the reply state from
 * replied_at rather than from status.
 *
 * Adding read_at / archived_at would be a schema change, and the task is
 * explicitly "read/archive flow per schema". If a future build wants the two
 * axes separately, that is the migration to write — not a second status column
 * and not a JSON blob.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Mirrors the CHECK constraint on inquiries.status. */
export const INQUIRY_STATUSES = ["unread", "read", "replied", "archived"] as const;

export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export interface InquiryRow {
  id: string;
  contractor_dbpr_sync_key: string;
  from_name: string;
  from_email: string;
  from_phone: string | null;
  message: string;
  status: InquiryStatus;
  replied_at: string | null;
  created_at: string;
}

/**
 * The three tabs, in the mockup's order: New / All / Archived
 * (contractor_inquiries.html:657-661).
 *
 * "ALL" MEANS "EVERYTHING NOT ARCHIVED", not literally everything. That reads
 * like a contradiction and is the standard mail-client meaning — archiving is
 * how a contractor takes something out of the working set, so a tab that put it
 * straight back would make the Archive button do nothing visible. The mockup
 * agrees numerically: it shows New 3 / All 14 with an Archived tab carrying no
 * count, so its All is not a superset of Archived.
 */
export const INQUIRY_TABS = ["new", "all", "archived"] as const;

export type InquiryTab = (typeof INQUIRY_TABS)[number];

/** Statuses each tab lists. The list query filters with `.in()` on these. */
export const TAB_STATUSES: Record<InquiryTab, readonly InquiryStatus[]> = {
  new: ["unread"],
  all: ["unread", "read", "replied"],
  archived: ["archived"],
};

export const TAB_LABEL: Record<InquiryTab, string> = {
  new: "New",
  all: "All",
  archived: "Archived",
};

/** ?tab= arrives from the URL, so it is a string until proven otherwise. */
export function parseTab(value: string | undefined): InquiryTab {
  return (INQUIRY_TABS as readonly string[]).includes(value ?? "")
    ? (value as InquiryTab)
    : "new";
}

/**
 * sanitizeSearch, relativeTime and absoluteTime USED TO LIVE HERE.
 *
 * All three moved when /admin/contractors became their third call site —
 * lib/filter-text.ts and lib/time.ts, each with the reasoning that was in these
 * docblocks. Re-exported rather than re-imported at every call site, matching
 * how lib/contractor-profile.ts republishes the name formatters: this module
 * stays the one import an inbox page needs.
 */
export { sanitizeSearch } from "@/lib/filter-text";
export { relativeTime, absoluteTime } from "@/lib/time";

/**
 * The two-line snippet under a name in the list.
 *
 * Clamped in CSS as well (line-clamp-2). Both are needed: the CSS decides what
 * is VISIBLE, this decides what is SENT — without it a 2,000-character message
 * ships in full inside every row of the HTML, which is the whole inbox's worth
 * of body text for two lines of display.
 */
export function snippet(message: string, max = 160): string {
  const oneLine = message.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

/**
 * The mailto: the Reply button opens.
 *
 * REPLY IS THE CONTRACTOR'S OWN MAIL CLIENT, DELIBERATELY. There is no in-app
 * messaging: it would need a thread model, a delivery path, a moderation story
 * and a way for a homeowner with no account to answer. A mailto: puts the
 * contractor's real address in front of the homeowner, which is what both sides
 * want, and it is the same decision the profile page made when it chose a
 * contact form over an account.
 *
 * The subject is prefilled and the body is not. A prefilled body would be a
 * templated greeting the contractor did not write, sent under their name to a
 * homeowner who is choosing between contractors partly on how they write.
 */
export function replyMailto(inquiry: Pick<InquiryRow, "from_email" | "from_name">, businessName: string): string {
  const subject = `Re: your inquiry to ${businessName}`;
  return `mailto:${encodeURIComponent(inquiry.from_email)}?subject=${encodeURIComponent(subject)}`;
}

/**
 * tel: for the phone button. Strips everything a dialler cannot use — the
 * stored value is free text from the contact form ("(954) 555-0287"), and
 * spaces and parentheses in a tel: URI are legal but not universally handled.
 */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
