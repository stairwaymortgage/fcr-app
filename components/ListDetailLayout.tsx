import type { ReactNode } from "react";

/**
 * ListDetailLayout — two-pane inbox container for review queues.
 * Source: _handoff/04_components/list_detail_layout.html
 * Spec: Build Brief v1.3 §11 · COMPONENTS, ListDetailLayout entry (read
 *       2026-07-28), which specifies verbatim:
 *
 *         Source: list_detail_layout.html · Two-pane container. Master list on
 *         left (40% width), detail view on right (60%). Mobile collapses to
 *         single column with back nav.
 *         Used on: contractor_inquiries, admin_claim_review. The pattern is
 *         also visible in admin_leads but it uses a flatter table view instead.
 *         Props
 *           listItems: ReactNode[] — the rows in the master list
 *           selectedDetail: ReactNode — the currently-selected detail view
 *           listLabel: string — header above the list (e.g., "7 PENDING CLAIMS")
 *
 * Used on: admin_claim_review (claims queue), contractor_inquiries (inbox).
 * NOT used on admin_leads — that page renders a flat <table class="leads-table">
 * and contains none of this component's classes. Do not scope this to cover it.
 *
 * Server component. Tabs, search and row selection are all URL-driven — the
 * reference docs put selected item in ?id=, active tab in ?tab=, and search in
 * ?q=, with the server filtering and re-rendering. Callers pass <Link>s and a
 * GET <form>; nothing here needs client state.
 *
 * §11 SAYS 40%/60%. THE MOCKUPS DO NOT. Every consumer uses a fixed pixel
 * column plus a flexible one: 380px in list_detail_layout.html and
 * contractor_inquiries.html, 420px in admin_claim_review.html, gap 24px
 * throughout. §11's percentages describe the look, not the implementation, and
 * omit that the width varies by consumer. Logged as a spec inaccuracy; the
 * mockups are followed. See `listWidth`.
 *
 * MOBILE: single-column collapse only, and it is pure CSS —
 * `@media (max-width: 1200px) { grid-template-columns: 1fr }` in both
 * consumers. The "back nav" named in §11 and in the reference docs (line 655)
 * DOES NOT EXIST anywhere in the handoff: a search for back-to-list / back-nav
 * / "← Back" across every mockup returns hits only in the diagnostic flow and
 * the login pages, never in a list-detail context. Building it would require
 * client state for which pane is showing, so it is deliberately out of v1
 * rather than invented. Below 1200px the panes stack, list above detail.
 *
 * SURFACES: both panels are `background: white` in the mockups, rendered here
 * as bg-paper-raised per the §03 pure-white prohibition (see tailwind.config.ts
 * for the full resolution). Inset bands — list header, detail header, action
 * bar — are gray-50. The gray-100 behind the panes belongs to the admin/portal
 * route-group layout, not to this component.
 *
 * The detail body is deliberately NOT painted. Only the reference file gives it
 * `background: var(--paper)`, and only because it holds a centered placeholder;
 * neither production consumer sets a background there, so the body inherits the
 * panel's raised surface.
 */

export interface ListDetailLayoutProps {
  /**
   * §11. Section heading above the list.
   * Real values are short nouns — "Claim Queue", "Inbox", "Queue". §11's
   * example ("7 PENDING CLAIMS") matches no mockup; counts live in the tab
   * badges, not the title.
   */
  listLabel: string;

  /**
   * §11. Rows of the master list.
   *
   * Opaque by design: the caller owns row markup including its own padding,
   * bottom border, and selected / unread styling. The layout never needs row
   * data — selection is a URL param the server reads, and the two consumers'
   * rows are structurally different (claim review carries a license number,
   * inquiries carries a 2-line clamped snippet), so no shared row type exists.
   *
   * KEYS: rows are keyed by array index, because an opaque ReactNode carries no
   * stable id and a key the caller sets on its own node lands on a child of the
   * <li>, not on the array element React reconciles. Correct as long as the
   * list is server-rendered and never reordered in place — rows hold no state,
   * so there is nothing for a mismatched key to corrupt.
   *
   * REVISIT IF a consumer filters or reorders the list client-side. That is
   * expected at the Week 5 inquiries inbox (archive / filter). The fix is to
   * change this prop to `{ id: string; node: ReactNode }[]`, which diverges
   * from §11's `listItems: ReactNode[]` — a deliberate deviation to be taken
   * then, not pre-emptively now.
   */
  listItems: readonly ReactNode[];

  /**
   * §11. The entire contents of the detail panel — header, body, and action
   * bar together.
   *
   * Kept whole rather than split into separate slots because the action bar's
   * structure forks between consumers: contractor_inquiries renders it as a
   * panel-level footer with a gray-50 band, while admin_claim_review renders it
   * as a grid child of the body with no background at all. One prop cannot
   * serve both without a mode flag, and a flag would paper over a structural
   * difference rather than express it.
   *
   * This container is a flex column, so a caller's body can take `flex-1` to
   * push its action bar to the bottom.
   *
   * Heading level inside this node is the caller's decision — the layout owns
   * only listLabel. Callers should render the detail name consistently across
   * pages (the mockups style it as serif 26px, semantic level unspecified).
   */
  selectedDetail: ReactNode;

  /**
   * ADDITION beyond §11 — not part of its three props.
   *
   * Both consumers render filter tabs directly under the list title, and §11
   * has no slot for them: claim review has Pending / Flagged / Approved /
   * Rejected, inquiries has New / All / Archived. Markup and active state are
   * caller-owned so the count badges and hrefs stay page-specific.
   */
  listTabs?: ReactNode;

  /**
   * ADDITION beyond §11 — not part of its three props.
   *
   * Conditional across consumers: contractor_inquiries has a search input,
   * admin_claim_review has none (zero occurrences of .list-search). Omit to
   * render no search band at all. The magnifying-glass icon belongs to the
   * caller's input, not to this layout.
   */
  listSearch?: ReactNode;

  /**
   * ADDITION beyond §11 — not part of its three props.
   *
   * 380 matches list_detail_layout.html and contractor_inquiries.html;
   * 420 matches admin_claim_review.html, whose rows carry an extra license
   * line. Only these two widths occur.
   */
  listWidth?: 380 | 420;
}

/**
 * Written out rather than interpolated — Tailwind's scanner only sees literal
 * class strings, so `grid-cols-[${listWidth}px_1fr]` would be purged.
 */
const COLUMN_CLASS: Record<380 | 420, string> = {
  380: "grid-cols-[380px_1fr]",
  420: "grid-cols-[420px_1fr]",
};

export default function ListDetailLayout({
  listLabel,
  listItems,
  selectedDetail,
  listTabs,
  listSearch,
  listWidth = 380,
}: ListDetailLayoutProps) {
  return (
    <div
      className={`grid gap-6 max-[1200px]:grid-cols-1 ${COLUMN_CLASS[listWidth]}`}
    >
      {/* LEFT — list panel */}
      <section className="border border-gray-200 bg-paper-raised">
        <div className="border-b border-gray-200 bg-gray-50 px-5 py-[18px]">
          {/* Mockup uses a <div>; rendered as <h2> so the queue has a real
              heading in the document outline. Styling is unchanged. */}
          <h2 className="mb-3 font-mono text-micro font-semibold uppercase tracking-label text-navy">
            {listLabel}
          </h2>

          {listTabs && (
            <div className="flex gap-[18px] text-ui font-medium">
              {listTabs}
            </div>
          )}
        </div>

        {listSearch && (
          <div className="border-b border-gray-200 px-5 py-3">{listSearch}</div>
        )}

        {/* <ul>/<li> is an accessibility upgrade over the mockup's flat divs —
            it announces "list, N items" and enables browse-mode navigation.
            The <li> carries no styling of its own: padding, bottom border and
            selected state all live on the caller's row markup. */}
        <ul className="max-h-[720px] overflow-y-auto">
          {listItems.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </section>

      {/* RIGHT — detail panel. Contents are entirely caller-supplied. */}
      <section className="flex min-h-[720px] flex-col border border-gray-200 bg-paper-raised">
        {selectedDetail}
      </section>
    </div>
  );
}
