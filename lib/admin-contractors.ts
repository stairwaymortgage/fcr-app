/**
 * Admin contractors browser — shared vocabulary.
 *
 * Imported only by app/admin/contractors/page.tsx today. It exists as its own
 * module for the same reason lib/leads.ts does: the filter and sort names are
 * URL contract, and a page that parses its own query strings inline grows a
 * second, slightly different parser the first time anything else links to it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * READ-ONLY. THERE IS NO WRITE PATH TO contractors FROM THIS PAGE, AND THAT IS
 * NOT AN OMISSION.
 *
 * After 20260803_contractor_profile_lockdown.sql and 20260804_grant_hygiene.sql,
 * `authenticated` holds SELECT and REFERENCES on contractors and nothing else —
 * an admin acting through their own session cannot UPDATE, INSERT or DELETE a
 * row. Every write in the product goes through a named function instead:
 * update_own_contractor_profile(), approve_claim(), reject_claim(),
 * release_own_contractor_profile(), set_own_contractor_image(), plus the
 * service-role DBPR importer.
 *
 * The mockup's row-level "Edit" link is href="#" in every row and no edit
 * screen exists anywhere in the handoff, so there was nothing to build against
 * even if there had been a path. 156b will add the two admin actions that are
 * genuinely needed — releasing a claim on the owner's behalf, and taking down
 * contractor-supplied content — each as its own RPC with an audit row, which is
 * what the lockdown migration §4 deferred in as many words:
 *
 *   "If an admin edit screen is ever built, give it its own RPC rather than
 *    granting UPDATE back here."
 *
 * DO NOT SHORTCUT THAT BY GRANTING UPDATE. The lockdown exists because an RLS
 * policy cannot restrict columns, and a table-wide UPDATE grant is how the
 * DBPR fields, the slug, claim_tier and stripe_subscription_id all became
 * writable last time.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The filter chips, in the mockup's order (admin_contractors.html:471-475).
 *
 * ⚠ FOUR OF THESE FIVE READ ZERO TODAY. Measured against the live project on
 * 2026-08-05: 266,305 contractors, 0 claimed, 0 featured, 0 pending claims.
 * They are built anyway because they are the shape of the data rather than a
 * guess about it, and because a chip that appears the day the first claim
 * lands is better than a chip nobody remembered to add.
 */
export const CLAIM_FILTERS = ["all", "unclaimed", "claimed", "featured", "pending"] as const;

export type ClaimFilter = (typeof CLAIM_FILTERS)[number];

export const CLAIM_FILTER_LABEL: Record<ClaimFilter, string> = {
  all: "All",
  unclaimed: "Unclaimed",
  claimed: "Claimed",
  featured: "Featured",
  pending: "Pending claims",
};

export function parseClaimFilter(value: string | undefined): ClaimFilter {
  return (CLAIM_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as ClaimFilter)
    : "all";
}

/**
 * Sorts.
 *
 * ⚠ "MOST INQUIRIES" IS CUT, AND THE RECON SAID IT WOULD BE AVAILABLE. It
 * cannot be, cheaply: ordering 266,305 contractors by their inquiry count needs
 * an aggregate over the whole inquiries table joined back to every row, on
 * every page load. The count still appears in the table — computed for the ~25
 * rows on screen, which is a different and much smaller question. Sorting by it
 * needs a materialised count column and the migration to maintain it.
 *
 * Alphabetical is the default rather than the mockup's "Most Inquiries" for the
 * same reason.
 */
export const CONTRACTOR_SORTS = [
  "alpha",
  "recently_claimed",
  "recently_added",
  "expiring",
] as const;

export type ContractorSort = (typeof CONTRACTOR_SORTS)[number];

export const CONTRACTOR_SORT_LABEL: Record<ContractorSort, string> = {
  alpha: "Alphabetical",
  recently_claimed: "Recently claimed",
  recently_added: "Recently added",
  expiring: "Expiring soon",
};

export function parseContractorSort(value: string | undefined): ContractorSort {
  return (CONTRACTOR_SORTS as readonly string[]).includes(value ?? "")
    ? (value as ContractorSort)
    : "alpha";
}

/**
 * Rows per page.
 *
 * 25 over 266,305 rows. NEVER issue an unbounded select against this table —
 * lib/search.ts carries the same rule for the public search and the same hard
 * cap, for the same reason.
 */
export const PAGE_SIZE = 25;

/**
 * How far the pager will go.
 *
 * 266,305 rows at 25 a page is 10,653 pages, and PostgREST's range offset makes
 * the last of them a full scan. The page caps navigation and says so: past this
 * point the answer is to search, not to keep pressing Next. Nobody paginates to
 * page 400 looking for a contractor.
 */
export const MAX_PAGE = 200;

export interface AdminContractorRow {
  dbpr_sync_key: string;
  slug: string;
  business_name: string | null;
  qualifying_agent_name: string;
  license_number: string | null;
  license_type: string;
  license_status: string;
  license_status_secondary: string | null;
  expiration_date: string | null;
  city: string | null;
  county_code: string | null;
  claimed_by_user_id: string | null;
  claimed_at: string | null;
  claim_tier: string;
}

/**
 * Licence status pill colour.
 *
 * Only three values exist in the live table — Current (265,804), Suspended
 * (270) and Probation (231), measured 2026-08-05 — but this maps by meaning
 * rather than by that list, because the next DBPR extract may carry "Null and
 * Void" or "Delinquent" and an unmapped status must still render.
 */
export function licenseStatusTone(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("current") || s.includes("active")) {
    return "bg-status-successBg text-status-success";
  }
  if (s.includes("probation") || s.includes("delinquent")) {
    return "bg-status-warnBg text-status-warn";
  }
  return "bg-status-errorBg text-status-error";
}

/** Claim-state pill. claim_tier is the column approve_claim() maintains. */
export function claimTone(tier: string): string {
  if (tier === "featured") return "bg-gold-pale text-gold";
  if (tier === "claimed") return "bg-status-successBg text-status-success";
  return "bg-gray-100 text-gray-500";
}

export function claimLabel(tier: string): string {
  if (tier === "featured") return "Featured";
  if (tier === "claimed") return "Claimed";
  return "Unclaimed";
}
