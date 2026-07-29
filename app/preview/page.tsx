import ListDetailLayout from "@/components/ListDetailLayout";
import StatsStrip, { type StatCard } from "@/components/StatsStrip";

/**
 * TEMPORARY PREVIEW ROUTE — delete before launch. Mock data only.
 * Tracked in project sheet.
 *
 * Composed admin page: AdminHeader (in layout.tsx) → StatsStrip →
 * ListDetailLayout, modelled on admin_claim_review.html.
 *
 * MOCK DATA IS DELIBERATELY FAKE. The mockup's records name a real contractor
 * whose showcase approval is still an open task (Build Brief §10, task O8), so
 * no real name or licence number appears here. Placeholder names and
 * CGC0000000-style licence numbers render the layout identically. The real
 * record gets used at the Week 2 contractor-profile task, after approval.
 *
 * Row and detail markup is written inline rather than extracted, because in the
 * real architecture it IS page-owned — ListDetailLayout takes opaque nodes and
 * StatsStrip takes pre-formatted strings. Writing it here is part of the test:
 * it checks a caller can build mockup-faithful markup against those APIs
 * without fighting them.
 *
 * What this page is meant to exercise:
 *   1. gray-100 ground showing through the 24px grid gap and 16px stats gap
 *   2. paper-raised panels against gray-50 inset bands on that ground —
 *      three near-whites in one viewport, the first honest test of the stack
 *   3. max-w-app consistent across header and content
 *   4. listWidth={420}, the non-default column width
 *   5. the omitted-search branch (claim review has no search input)
 *   6. StatsStrip's no-delta branch (this variant carries no delta lines)
 *   7. the six promoted type tokens at real size
 */

/** Four cards, no deltas — matching admin_claim_review.html's variant. */
const CLAIM_STATS: readonly StatCard[] = [
  { value: "7", label: "Pending Review", color: "warn" },
  { value: "2", label: "Flagged for Concern" },
  { value: "48", label: "Approved This Month" },
  { value: "3", label: "Rejected This Month" },
];

type ClaimRow = {
  name: string;
  license: string;
  company: string;
  city: string;
  time: string;
};

const CLAIM_ROWS: readonly ClaimRow[] = [
  {
    name: "Sample Claimant One",
    license: "CGC0000000",
    company: "Example Construction LLC",
    city: "Davie, FL",
    time: "14 min ago",
  },
  {
    name: "Sample Claimant Two",
    license: "CCC0000001",
    company: "Placeholder Roofing Co",
    city: "Plantation, FL",
    time: "42 min ago",
  },
  {
    name: "Sample Claimant Three",
    license: "CFC0000002",
    company: "Testcase Plumbing Inc",
    city: "Weston, FL",
    time: "2 hr ago",
  },
  {
    name: "Sample Claimant Four",
    license: "CGC0000003",
    company: "Demo Builders Group",
    city: "Cooper City, FL",
    time: "Yesterday",
  },
];

/** 3px dot separator. Decorative — one of the sanctioned rounded-full uses. */
function Dot() {
  return (
    <span
      aria-hidden="true"
      className="h-[3px] w-[3px] rounded-full bg-gray-400"
    />
  );
}

/**
 * One queue row. Padding, bottom border and selected state all live here
 * rather than on the layout's <li>, which is exactly the contract:
 * ListDetailLayout wraps opaque nodes and styles none of this.
 */
function ClaimListItem({
  row,
  selected = false,
}: {
  row: ClaimRow;
  selected?: boolean;
}) {
  return (
    <div
      className={`border-b border-gray-100 px-5 py-4 transition-colors ${
        selected
          ? "border-l-[3px] border-l-gold bg-gold-pale pl-[17px]"
          : "hover:bg-gray-50"
      }`}
    >
      <div className="mb-1 flex items-start justify-between gap-2.5">
        <p className="font-serif text-[15px] font-semibold leading-[1.25] tracking-[-0.005em] text-ink">
          {row.name}
        </p>
        <p className="mt-0.5 whitespace-nowrap font-mono text-label tracking-[0.02em] text-gray-500">
          {row.time}
        </p>
      </div>

      <p className="mb-1.5 font-mono text-[11.5px] font-semibold tracking-[0.04em] text-gold">
        {row.license}
      </p>

      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span>{row.company}</span>
        <Dot />
        <span>{row.city}</span>
      </div>
    </div>
  );
}

/** Filter tabs. Hrefs are inert here; the real page drives them via ?tab=. */
function QueueTabs() {
  const tabs = [
    { label: "Pending", count: 7, active: true },
    { label: "Flagged", count: 2, active: false },
    { label: "Approved", active: false },
    { label: "Rejected", active: false },
  ];

  return (
    <>
      {tabs.map(({ label, count, active }) => (
        <span
          key={label}
          className={`pb-1.5 ${
            active
              ? "border-b-2 border-gold font-semibold text-navy"
              : "text-gray-500"
          }`}
        >
          {label}
          {count !== undefined && (
            <span
              className={`ml-1.5 inline-block rounded-lg px-1.5 py-0.5 font-mono text-chip tracking-[0.02em] ${
                active ? "bg-navy text-gold-light" : "bg-gray-200 text-gray-700"
              }`}
            >
              {count}
            </span>
          )}
        </span>
      ))}
    </>
  );
}

/**
 * The detail pane, whole — header band, two-column body, and an action bar that
 * is a grid child of the body rather than a panel footer. That is
 * admin_claim_review's structure, and the reason selectedDetail is one prop
 * instead of three.
 */
function ClaimDetail({ row }: { row: ClaimRow }) {
  return (
    <>
      <div className="border-b border-gray-200 bg-gray-50 px-8 pb-6 pt-7">
        <div className="mb-3.5 flex items-center gap-3 font-mono text-micro uppercase tracking-[0.08em] text-gray-500">
          <span className="font-semibold text-gray-700">REF #CLM-0000-0000</span>
          <Dot />
          <span>Submitted 14 minutes ago</span>
        </div>

        <h3 className="mb-2 font-serif text-[28px] font-semibold leading-[1.15] tracking-[-0.015em] text-navy">
          {row.name}
        </h3>

        <div className="flex items-center gap-2.5 text-sm text-gray-700">
          <span>{row.company}</span>
          <Dot />
          <span>{row.city}</span>
        </div>
      </div>

      {/* flex-1 fills the panel — depends on ListDetailLayout's flex column. */}
      <div className="grid flex-1 grid-cols-2 gap-10 p-8 max-[1200px]:grid-cols-1">
        <section>
          <h4 className="mb-3 font-mono text-micro font-semibold uppercase tracking-label text-navy">
            Claimant
          </h4>
          <dl className="text-sm text-gray-700">
            <div className="flex justify-between border-b border-gray-200 py-2">
              <dt className="text-gray-500">Name</dt>
              <dd>{row.name}</dd>
            </div>
            <div className="flex justify-between border-b border-gray-200 py-2">
              <dt className="text-gray-500">Email</dt>
              <dd>sample@example.invalid</dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-gray-500">Phone</dt>
              <dd className="font-mono text-[13px]">(000) 000-0000</dd>
            </div>
          </dl>
        </section>

        <section>
          <h4 className="mb-3 font-mono text-micro font-semibold uppercase tracking-label text-navy">
            Licence Record
          </h4>
          <dl className="text-sm text-gray-700">
            <div className="flex justify-between border-b border-gray-200 py-2">
              <dt className="text-gray-500">Number</dt>
              <dd className="font-mono text-[13px] font-semibold text-gold">
                {row.license}
              </dd>
            </div>
            <div className="flex justify-between border-b border-gray-200 py-2">
              <dt className="text-gray-500">Status</dt>
              <dd className="font-semibold text-status-success">Active</dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-gray-500">County</dt>
              <dd>Broward</dd>
            </div>
          </dl>
        </section>

        <div className="col-span-full mt-6 flex items-center justify-between gap-4 border-t border-gray-200 pt-5 max-[1200px]:col-span-1">
          <p className="font-mono text-[12.5px] tracking-[0.02em] text-gray-500">
            Auto-match confidence: 94%
          </p>

          {/* Mockup gives the two outline buttons `background: white`. Rendered
              as paper-raised for the same reason the panels are — §03 bars
              pure white. See tailwind.config.ts. */}
          <div className="flex gap-3">
            <span className="border border-status-error bg-paper-raised px-6 py-3 text-ui font-semibold uppercase tracking-[0.04em] text-status-error">
              Reject
            </span>
            <span className="border border-status-warn bg-paper-raised px-6 py-3 text-ui font-semibold uppercase tracking-[0.04em] text-status-warn">
              Flag
            </span>
            <span className="bg-status-success px-6 py-3 text-ui font-semibold uppercase tracking-[0.04em] text-white">
              Approve
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

export default function PreviewPage() {
  return (
    <div className="flex flex-col gap-8">
      <StatsStrip
        cards={CLAIM_STATS}
        columns={4}
        ariaLabel="Claim review statistics"
      />

      <ListDetailLayout
        listLabel="Claim Queue"
        listWidth={420}
        listTabs={<QueueTabs />}
        listItems={CLAIM_ROWS.map((row, i) => (
          <ClaimListItem key={row.license} row={row} selected={i === 0} />
        ))}
        selectedDetail={<ClaimDetail row={CLAIM_ROWS[0]} />}
      />
    </div>
  );
}
