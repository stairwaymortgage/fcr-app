import type { Metadata } from "next";
import Link from "next/link";

import AdminHeader from "@/components/AdminHeader";
import StatsStrip from "@/components/StatsStrip";
import {
  AdminContractorRow,
  CLAIM_FILTER_LABEL,
  CLAIM_FILTERS,
  claimLabel,
  claimTone,
  CONTRACTOR_SORT_LABEL,
  CONTRACTOR_SORTS,
  licenseStatusTone,
  MAX_PAGE,
  PAGE_SIZE,
  parseClaimFilter,
  parseContractorSort,
  type ClaimFilter,
  type ContractorSort,
} from "@/lib/admin-contractors";
import { requireAdmin } from "@/lib/auth";
import { formatBusinessName, formatPersonName } from "@/lib/contractor-profile";
import { sanitizeSearch } from "@/lib/filter-text";
import { FOCUS_RING_PAPER } from "@/lib/focus";
import { createClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/time";

/**
 * Contractor browser — /admin/contractors
 * Source: _handoff/02_mockups_production/08_admin/admin_contractors.html
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 156a: READ-ONLY. Search, filter, sort, page — nothing writes.
 *
 * The mockup's row-level "Edit" is href="#" in every row and no edit screen
 * exists anywhere in the handoff. It is also impossible today: `authenticated`
 * holds SELECT and REFERENCES on contractors and nothing else, so an admin's
 * own session cannot write to this table at all. The two admin actions that are
 * genuinely needed — releasing a claim on an owner's behalf, and taking down
 * contractor-supplied content — are 156b, each as its own RPC with an audit
 * row. See lib/admin-contractors.ts for why that must not become a grant.
 *
 * So the Actions column offers View and nothing else, and the page does not
 * pretend otherwise.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * NOT BUILT FROM THE MOCKUP, EACH FOR A REASON:
 *
 *   · Add Contractor. Actively harmful: contractors come from the DBPR extract,
 *     and a hand-added row is invisible to the next sync and unverifiable
 *     against the state register — which is the one thing this directory sells.
 *   · Bulk Actions. No mockup defines what they are.
 *   · Export Filtered. Same call as the leads CSV: a bulk export deserves its
 *     own decision rather than a button added in passing.
 *   · "MRR (Featured) — $4,118 · 142 × $29/mo". The formula breaks on the first
 *     discount or annual plan, Stripe is week 6, and the real figure is $0.
 *     Replaced with licences not in good standing, which is real and non-zero.
 *   · "Most Inquiries" as a sort. See lib/admin-contractors.ts — it needs an
 *     aggregate over the whole inquiries table on every page load.
 *
 * ⚠ "ACTIVE LICENSES" IS NOT A LABEL THIS PRODUCT USES. The mockup's first stat
 * card says "266,312 Active Licenses" and both halves are wrong: the table
 * holds 266,305 rows (seven duplicate sync keys were deduped before upsert),
 * and lib/registry-stats.ts records the settled ruling that these are RECORDS,
 * never "active licences" — 119,330 would be the figure for that word, and only
 * via a live query. Copy that pairs the total with "active" is a factual error,
 * not a wording preference.
 */

export const metadata: Metadata = {
  title: "Contractors · Admin",
  robots: { index: false, follow: false },
};

const ROW_COLUMNS =
  "dbpr_sync_key, slug, business_name, qualifying_agent_name, license_number, " +
  "license_type, license_status, license_status_secondary, expiration_date, city, " +
  "county_code, claimed_by_user_id, claimed_at, claim_tier";

export default async function AdminContractorsPage({
  searchParams,
}: {
  searchParams: {
    claim?: string;
    q?: string;
    sort?: string;
    type?: string;
    county?: string;
    page?: string;
  };
}) {
  const user = await requireAdmin();

  /**
   * The ANON-KEY SESSION CLIENT, not service-role. Every row on this page is
   * public directory data — "public read contractors" serves all 266,305 of
   * them to signed-out visitors — so there is nothing here that needs elevated
   * access, and reaching for the service role to read public data would make
   * the page's privileges impossible to reason about later.
   */
  const db = createClient();

  const claim = parseClaimFilter(searchParams.claim);
  const q = sanitizeSearch(searchParams.q);
  const sort = parseContractorSort(searchParams.sort);
  const type = (searchParams.type ?? "").slice(0, 12).replace(/[^A-Za-z0-9]/g, "");
  const county = (searchParams.county ?? "").slice(0, 8).replace(/[^A-Za-z0-9]/g, "");
  const page = Math.min(MAX_PAGE, Math.max(1, Number(searchParams.page) || 1));

  /**
   * The "pending claims" chip needs contractor keys from another table. Read
   * once, up front, and reused as an `.in()` filter — with zero pending claims
   * today and seven at the busiest moment the mockup imagines, this set is tiny.
   * If it ever is not, this becomes a join rather than a round trip.
   */
  const { data: pendingRows } = await db
    .from("claims")
    .select("contractor_dbpr_sync_key")
    .eq("status", "pending");
  const pendingKeys = Array.from(
    new Set((pendingRows ?? []).map((r) => r.contractor_dbpr_sync_key)),
  );

  /**
   * Filters applied by reassignment rather than through a helper. A generic
   * `applyFilters(query)` needed the builder's type as a parameter, and every
   * shape that typechecked either widened to `any` or lost the method list —
   * supabase-js returns `this` from each filter method precisely so that
   * chaining keeps the type, and a wrapper throws that away.
   */
  let listQuery = db.from("contractors").select(ROW_COLUMNS, { count: "exact" });

  if (claim === "unclaimed") listQuery = listQuery.is("claimed_by_user_id", null);
  if (claim === "claimed") listQuery = listQuery.not("claimed_by_user_id", "is", null);
  if (claim === "featured") listQuery = listQuery.eq("claim_tier", "featured");
  if (claim === "pending") {
    // An empty `.in()` list matches nothing, which is the correct answer when
    // no claim is pending — hence the placeholder rather than a guard that
    // would silently drop the filter and show everything.
    // ⚠ A PLAIN, VISIBLE SENTINEL. An earlier draft used a unicode NUL escape here,
    // which python wrote as a literal NUL byte — git immediately classified this
    // file as binary and the character was invisible in the editor. The same
    // mistake is recorded in app/contractor/[slug]/actions.ts, which is where
    // the lesson came from the first time.
    listQuery = listQuery.in(
      "dbpr_sync_key",
      pendingKeys.length > 0 ? pendingKeys : ["__no_pending_claims__"],
    );
  }
  if (type) listQuery = listQuery.eq("license_type", type);
  if (county) listQuery = listQuery.eq("county_code", county);
  if (q) {
    // q is allowlisted in sanitizeSearch() — PostgREST filter grammar, not a
    // value slot. Every column here carries a trigram index (see
    // 20260730_search_indexes.sql), which is what makes ilike affordable
    // across 266,305 rows.
    listQuery = listQuery.or(
      `business_name.ilike.*${q}*,qualifying_agent_name.ilike.*${q}*,` +
        `license_number.ilike.*${q}*,city.ilike.*${q}*`,
    );
  }

  if (sort === "recently_claimed") {
    listQuery = listQuery.order("claimed_at", { ascending: false, nullsFirst: false });
  } else if (sort === "recently_added") {
    listQuery = listQuery.order("first_seen_at", { ascending: false, nullsFirst: false });
  } else if (sort === "expiring") {
    listQuery = listQuery.order("expiration_date", { ascending: true, nullsFirst: false });
  } else {
    // Alphabetical by what the row is actually called. business_name is null on
    // individual licensees, so the agent's name is the fallback ordering key —
    // matching displayName() on the public profile.
    listQuery = listQuery
      .order("business_name", { ascending: true, nullsFirst: false })
      .order("qualifying_agent_name", { ascending: true });
  }

  const from = (page - 1) * PAGE_SIZE;

  const [listResult, stats, types, counties, pendingClaimCount] = await Promise.all([
    listQuery.range(from, from + PAGE_SIZE - 1),
    loadStats(db),
    db.from("reference_license_types").select("type_code, type_name").order("type_code"),
    db.from("reference_counties").select("county_code, county_name").order("county_name"),
    db.from("claims").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);

  if (listResult.error) {
    console.error("[admin/contractors] list query failed", listResult.error.message);
  }

  const rows = (listResult.data ?? []) as unknown as AdminContractorRow[];
  const total = listResult.count ?? 0;
  const pageCount = Math.min(MAX_PAGE, Math.max(1, Math.ceil(total / PAGE_SIZE)));

  /**
   * Inquiry counts for the rows on screen ONLY. Two numbers per row — 30 days
   * and lifetime — from one query over the visible keys. Never across the
   * table: that is the aggregate that made "Most Inquiries" unsortable.
   */
  const visibleKeys = rows.map((r) => r.dbpr_sync_key);
  const inquiryTally = new Map<string, { recent: number; lifetime: number }>();
  if (visibleKeys.length > 0) {
    const { data: inquiryRows } = await db
      .from("inquiries")
      .select("contractor_dbpr_sync_key, created_at")
      .in("contractor_dbpr_sync_key", visibleKeys);
    const cutoff = Date.now() - 30 * 86_400_000;
    for (const row of inquiryRows ?? []) {
      const entry = inquiryTally.get(row.contractor_dbpr_sync_key) ?? { recent: 0, lifetime: 0 };
      entry.lifetime += 1;
      if (new Date(row.created_at).getTime() >= cutoff) entry.recent += 1;
      inquiryTally.set(row.contractor_dbpr_sync_key, entry);
    }
  }

  const displayName =
    (user.user_metadata?.full_name as string | undefined)?.trim() ||
    (user.email ?? "").split("@")[0] ||
    "Admin";

  const countyName = new Map(
    (counties.data ?? []).map((c) => [c.county_code, c.county_name]),
  );

  return (
    <>
      <AdminHeader
        currentPath="/admin/contractors"
        userName={displayName}
        userInitials={initialsFor(displayName)}
        pendingClaims={pendingClaimCount.count ?? 0}
        pendingLeads={stats.newLeads}
      />

      <main id="main" className="min-h-screen bg-gray-100">
        <div className="mx-auto max-w-app px-8 py-8 max-[900px]:px-5">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="mb-1.5 font-serif text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] text-navy">
                Contractor <em className="italic">records</em>
              </h1>
              <p className="text-note text-gray-500">
                <strong className="font-medium text-gray-700">
                  {stats.total.toLocaleString("en-US")} records
                </strong>{" "}
                · {stats.claimed.toLocaleString("en-US")} claimed ·{" "}
                {stats.featured.toLocaleString("en-US")} featured
                {stats.lastSync && <> · DBPR synced {relativeTime(stats.lastSync)}</>}
              </p>
            </div>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className={`text-note font-medium text-gray-600 underline hover:text-navy ${FOCUS_RING_PAPER}`}
              >
                Sign out
              </button>
            </form>
          </div>

          <div className="mb-8">
            <StatsStrip
              ariaLabel="Registry statistics"
              columns={5}
              cards={[
                {
                  /* "Records", never "active licences" — see the docblock. */
                  value: stats.total.toLocaleString("en-US"),
                  label: "Total Records",
                },
                {
                  value: stats.claimed.toLocaleString("en-US"),
                  label: "Claimed Profiles",
                  color: "green",
                },
                {
                  value: stats.featured.toLocaleString("en-US"),
                  label: "Featured Tier",
                  color: "gold",
                },
                {
                  value: `${((stats.claimed / Math.max(stats.total, 1)) * 100).toFixed(1)}%`,
                  label: "Claim Rate",
                  delta: "claimed ÷ records",
                  deltaType: "flat",
                },
                {
                  /* Replaces the mockup's MRR card. Suspended and probation
                     licences are the rows where the registry is saying
                     something a homeowner needs to hear. */
                  value: stats.notCurrent.toLocaleString("en-US"),
                  label: "Not In Good Standing",
                  color: stats.notCurrent > 0 ? "warn" : undefined,
                  delta: "suspended or probation",
                  deltaType: "flat",
                },
              ]}
            />
          </div>

          {/* TOOLBAR */}
          <div className="mb-5 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <form action="/admin/contractors" method="get" role="search">
                <HiddenState claim={claim} sort={sort} type={type} county={county} skip="q" />
                <label htmlFor="contractor-search" className="sr-only">
                  Search contractors
                </label>
                <input
                  id="contractor-search"
                  name="q"
                  type="search"
                  defaultValue={q}
                  maxLength={60}
                  placeholder="Name, license #, city, qualifying agent…"
                  className={`w-[340px] max-w-full border border-gray-300 bg-white px-3 py-2 text-ui text-ink placeholder:text-gray-500 focus:border-navy ${FOCUS_RING_PAPER}`}
                />
              </form>

              {CLAIM_FILTERS.map((filter) => {
                const active = filter === claim;
                return (
                  <Link
                    key={filter}
                    href={href({ claim: filter, q, sort, type, county })}
                    aria-current={active ? "page" : undefined}
                    className={`border px-3 py-1.5 text-ui font-medium transition-colors ${FOCUS_RING_PAPER} ${
                      active
                        ? "border-navy bg-navy text-paper"
                        : "border-gray-300 bg-white text-gray-700 hover:border-navy hover:text-navy"
                    }`}
                  >
                    {CLAIM_FILTER_LABEL[filter]}
                    <span
                      className={`ml-1.5 font-mono text-chip ${
                        active ? "text-gold-light" : "text-gray-500"
                      }`}
                    >
                      {filter === "all"
                        ? stats.total.toLocaleString("en-US")
                        : filter === "unclaimed"
                          ? (stats.total - stats.claimed).toLocaleString("en-US")
                          : filter === "claimed"
                            ? stats.claimed.toLocaleString("en-US")
                            : filter === "featured"
                              ? stats.featured
                              : pendingKeys.length}
                    </span>
                  </Link>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-4">
              {/* GET forms with a submit button rather than onChange selects —
                  a select that navigates on change needs client JS, and this
                  page ships none. */}
              <form action="/admin/contractors" method="get" className="flex items-center gap-2">
                <HiddenState claim={claim} sort={sort} type={type} county={county} skip="type" />
                <label
                  htmlFor="type-filter"
                  className="font-mono text-label uppercase tracking-label text-gray-500"
                >
                  Type
                </label>
                <select
                  id="type-filter"
                  name="type"
                  defaultValue={type}
                  className={`border border-gray-300 bg-white px-2 py-1.5 text-ui text-ink ${FOCUS_RING_PAPER}`}
                >
                  <option value="">All types</option>
                  {(types.data ?? []).map((t) => (
                    <option key={t.type_code} value={t.type_code}>
                      {t.type_code} — {t.type_name}
                    </option>
                  ))}
                </select>
                <SubmitChip>Apply</SubmitChip>
              </form>

              <form action="/admin/contractors" method="get" className="flex items-center gap-2">
                <HiddenState claim={claim} sort={sort} type={type} county={county} skip="county" />
                <label
                  htmlFor="county-filter"
                  className="font-mono text-label uppercase tracking-label text-gray-500"
                >
                  County
                </label>
                <select
                  id="county-filter"
                  name="county"
                  defaultValue={county}
                  className={`border border-gray-300 bg-white px-2 py-1.5 text-ui text-ink ${FOCUS_RING_PAPER}`}
                >
                  <option value="">All counties</option>
                  {(counties.data ?? []).map((c) => (
                    <option key={c.county_code} value={c.county_code}>
                      {c.county_name}
                    </option>
                  ))}
                </select>
                <SubmitChip>Apply</SubmitChip>
              </form>

              <div className="flex items-center gap-3 font-mono text-label uppercase tracking-label text-gray-500">
                <span>Sort</span>
                {CONTRACTOR_SORTS.map((option) => (
                  <Link
                    key={option}
                    href={href({ claim, q, sort: option, type, county })}
                    aria-current={option === sort ? "page" : undefined}
                    className={`transition-colors ${FOCUS_RING_PAPER} ${
                      option === sort ? "border-b-2 border-gold text-navy" : "hover:text-navy"
                    }`}
                  >
                    {CONTRACTOR_SORT_LABEL[option]}
                  </Link>
                ))}
              </div>

              {(q || type || county || claim !== "all" || sort !== "alpha") && (
                <Link
                  href="/admin/contractors"
                  className={`font-mono text-label uppercase tracking-label text-gold hover:text-navy ${FOCUS_RING_PAPER}`}
                >
                  Reset
                </Link>
              )}
            </div>
          </div>

          {/* TABLE */}
          <div className="border border-gray-200 bg-white">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <Th>Business / Qualifying agent</Th>
                  <Th>License</Th>
                  <Th>Status</Th>
                  <Th>Claim</Th>
                  <Th align="right">Inquiries (30d / life)</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-note text-gray-600">
                      Nothing matches those filters.{" "}
                      <Link
                        href="/admin/contractors"
                        className={`text-navy underline decoration-gold underline-offset-2 ${FOCUS_RING_PAPER}`}
                      >
                        Reset
                      </Link>
                      .
                    </td>
                  </tr>
                )}

                {rows.map((row) => {
                  const name = row.business_name
                    ? formatBusinessName(row.business_name)
                    : formatPersonName(row.qualifying_agent_name);
                  const agent = formatPersonName(row.qualifying_agent_name);
                  const tally = inquiryTally.get(row.dbpr_sync_key);
                  const featured = row.claim_tier === "featured";
                  return (
                    <tr
                      key={row.dbpr_sync_key}
                      className={`border-b border-gray-100 transition-colors last:border-b-0 hover:bg-gray-50 ${
                        featured ? "border-l-[3px] border-l-gold" : ""
                      }`}
                    >
                      <td className="px-5 py-3.5 align-top">
                        <span className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/contractor/${row.slug}`}
                            className={`font-serif text-[15px] font-semibold leading-[1.25] text-ink underline decoration-transparent underline-offset-2 transition-colors hover:decoration-gold ${FOCUS_RING_PAPER}`}
                          >
                            {name}
                          </Link>
                          {featured && (
                            <span className="bg-gold px-1.5 py-0.5 font-mono text-chip font-bold uppercase tracking-label text-navy-deep">
                              Featured
                            </span>
                          )}
                        </span>
                        <p className="mt-0.5 text-[11.5px] text-gray-500">
                          {/* The agent line is skipped when it would repeat the
                              name — an individual licensee has no business
                              name, so the two are the same string. */}
                          {row.business_name && <>{agent} · </>}
                          {row.city && (
                            <span className="font-semibold text-gold">
                              {formatBusinessName(row.city)}
                            </span>
                          )}
                          {row.county_code && countyName.get(row.county_code) && (
                            <> · {countyName.get(row.county_code)} Co.</>
                          )}
                        </p>
                      </td>

                      <td className="px-5 py-3.5 align-top">
                        <p className="font-mono text-[13px] font-semibold text-navy">
                          {row.license_number ?? "—"}
                        </p>
                        <p className="mt-0.5 text-[11.5px] text-gray-500">{row.license_type}</p>
                      </td>

                      <td className="px-5 py-3.5 align-top">
                        <span
                          className={`inline-block whitespace-nowrap px-2.5 py-1 text-[11.5px] font-semibold ${licenseStatusTone(row.license_status)}`}
                        >
                          {row.license_status}
                        </span>
                        {row.license_status_secondary && (
                          <p className="mt-1 text-[11.5px] text-gray-500">
                            {row.license_status_secondary}
                          </p>
                        )}
                      </td>

                      <td className="px-5 py-3.5 align-top">
                        <span
                          className={`inline-block whitespace-nowrap px-2.5 py-1 text-[11.5px] font-semibold ${claimTone(row.claim_tier)}`}
                        >
                          {claimLabel(row.claim_tier)}
                        </span>
                        {row.claimed_at && (
                          <p className="mt-1 whitespace-nowrap font-mono text-micro text-gray-500">
                            {relativeTime(row.claimed_at)}
                          </p>
                        )}
                      </td>

                      <td className="px-5 py-3.5 text-right align-top">
                        <p className="font-mono text-[13px] font-semibold text-navy">
                          {tally?.recent ?? 0}
                        </p>
                        <p className="mt-0.5 font-mono text-micro text-gray-500">
                          {tally?.lifetime ?? 0} lifetime
                        </p>
                      </td>

                      <td className="px-5 py-3.5 text-right align-top">
                        {/* View only. "Edit" is 156b and has no write path
                            today — see the docblock at the top. */}
                        <Link
                          href={`/contractor/${row.slug}`}
                          className={`inline-block border border-gray-300 px-3 py-1.5 font-mono text-label uppercase tracking-label text-gray-700 transition-colors hover:border-navy hover:bg-gold-pale ${FOCUS_RING_PAPER}`}
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-5 py-3.5">
              <p className="font-mono text-label uppercase tracking-label text-gray-500">
                {total === 0
                  ? "No matches"
                  : `Showing ${(from + 1).toLocaleString("en-US")}–${Math.min(from + PAGE_SIZE, total).toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`}
              </p>
              {pageCount > 1 && (
                <div className="flex items-center gap-2">
                  {page > 1 && (
                    <Link
                      href={href({ claim, q, sort, type, county, page: page - 1 })}
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
                      href={href({ claim, q, sort, type, county, page: page + 1 })}
                      className={`border border-gray-300 bg-white px-3 py-1.5 font-mono text-label uppercase tracking-label text-gray-700 hover:border-navy hover:text-navy ${FOCUS_RING_PAPER}`}
                    >
                      Next →
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>

          {pageCount >= MAX_PAGE && (
            <p className="mt-4 font-mono text-label uppercase tracking-label text-gray-500">
              Paging stops at {MAX_PAGE}. Past here, search — the offset costs
              more than the answer is worth.
            </p>
          )}
        </div>
      </main>
    </>
  );
}

/** "Jim Blackburn" -> "JB". Same helper as every other portal page. */
function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0]}${parts[parts.length - 1][0]}`;
}

function href(params: {
  claim: ClaimFilter;
  q: string;
  sort: ContractorSort;
  type: string;
  county: string;
  page?: number;
}): string {
  const search = new URLSearchParams();
  if (params.claim !== "all") search.set("claim", params.claim);
  if (params.q) search.set("q", params.q);
  if (params.sort !== "alpha") search.set("sort", params.sort);
  if (params.type) search.set("type", params.type);
  if (params.county) search.set("county", params.county);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  const query = search.toString();
  return query ? `/admin/contractors?${query}` : "/admin/contractors";
}

/**
 * The current view, carried through a GET form so that submitting one control
 * does not silently reset the others. `skip` omits the field the form owns —
 * otherwise the hidden input and the real one both submit and the browser sends
 * two values for the same name.
 */
function HiddenState({
  claim,
  sort,
  type,
  county,
  skip,
}: {
  claim: ClaimFilter;
  sort: ContractorSort;
  type: string;
  county: string;
  skip: "q" | "type" | "county";
}) {
  return (
    <>
      {claim !== "all" && <input type="hidden" name="claim" value={claim} />}
      {sort !== "alpha" && <input type="hidden" name="sort" value={sort} />}
      {skip !== "type" && type && <input type="hidden" name="type" value={type} />}
      {skip !== "county" && county && <input type="hidden" name="county" value={county} />}
    </>
  );
}

function SubmitChip({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="submit"
      className={`border border-gray-300 bg-white px-2.5 py-1.5 font-mono text-label uppercase tracking-label text-gray-700 transition-colors hover:border-navy hover:text-navy ${FOCUS_RING_PAPER}`}
    >
      {children}
    </button>
  );
}

/**
 * The five stat cards plus the header line, in one place.
 *
 * COUNTED WITH head:true, never over fetched rows — the table is paginated and
 * counting 25 rows would make "Total Records" read 25 forever. An exact count
 * over 266,305 rows is the same thing lib/search.ts already does for the public
 * search, and on a table this size it is a few tens of milliseconds.
 */
async function loadStats(db: ReturnType<typeof createClient>) {
  const contractorCount = () =>
    db.from("contractors").select("dbpr_sync_key", { count: "exact", head: true });

  const [total, claimed, featured, notCurrent, newLeads, lastSyncRow] = await Promise.all([
    contractorCount(),
    contractorCount().not("claimed_by_user_id", "is", null),
    contractorCount().eq("claim_tier", "featured"),
    contractorCount().neq("license_status", "Current"),
    db.from("leads").select("id", { count: "exact", head: true }).eq("status", "new"),
    db
      .from("contractors")
      .select("last_dbpr_sync_at")
      .not("last_dbpr_sync_at", "is", null)
      .order("last_dbpr_sync_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    total: total.count ?? 0,
    claimed: claimed.count ?? 0,
    featured: featured.count ?? 0,
    notCurrent: notCurrent.count ?? 0,
    newLeads: newLeads.count ?? 0,
    lastSync: (lastSyncRow.data?.last_dbpr_sync_at as string | undefined) ?? null,
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
