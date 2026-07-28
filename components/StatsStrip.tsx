/**
 * StatsStrip — grid of metric cards for dashboard-style pages.
 * Source: _handoff/04_components/stats_strip.html
 * Spec: Build Brief v1.3 §11 · COMPONENTS, StatsStrip entry (read 2026-07-28),
 *       which specifies verbatim:
 *
 *         cards: Array<{ value: string, label: string, delta?: string,
 *                        deltaType?: 'up'|'flat', color?: 'gold'|'green'|'warn' }>
 *         columns: number — 3, 4, or 5
 *
 * Used on: contractor_inquiries, admin_claim_review, admin_leads,
 * admin_contractors, admin_sync_status.
 *
 * Server component: entirely static. No links, no hover states, no buttons —
 * verified across all five production mockups. Cards are inert.
 *
 * NO BACKGROUND OF ITS OWN. In every mockup the gray-100 behind the cards is
 * the page's `html, body` background showing through the 16px grid gaps; the
 * strip element itself is transparent. Painting gray-100 onto this wrapper
 * would draw a hard-edged band the moment the page behind it is any other
 * color, which is not what the mockups show. The admin/portal route-group
 * layout owns `bg-gray-100` — scoped to that layout, never globals.css.
 */

/**
 * Big-number color. Navy is the absence of a modifier, so it is not a value.
 *
 * NOTE THE COLLISION: `warn` here is RED (status.error, #c2415b) —
 * "attention-negative", e.g. a Pending Review count. StatusBanner's
 * StatusVariant also has a `warn` and it is AMBER (status.warn, #8d6e00) —
 * "unusual, not broken". Both match their own mockups, verified across six
 * files each. They are NOT to be reconciled; see the matching note in
 * StatusBanner.tsx.
 */
export type StatColor = "gold" | "green" | "warn";

/**
 * Delta color. §11 specifies 'up' | 'flat' only, and the mockups agree: across
 * every stats strip in the handoff there are 11 `up` and 4 `flat` deltas and
 * ZERO `down`. The reference CSS declares a `.stat-delta.down` rule and the
 * prose mentions a ↓ glyph, but neither is ever applied to a rendered card.
 */
export type StatDeltaType = "up" | "flat";

export interface StatCard {
  /**
   * Pre-formatted display string — format at the call site, not here.
   * Real values across the mockups span "266,312", "52 / 52", "7d", "1.4%",
   * "$847K", "$4,118", and "142 × $29/mo"; no single formatter produces that
   * set, so the component treats the value as opaque text.
   */
  value: string;

  /** Small uppercase caption, e.g. "Total Active Contractors". */
  label: string;

  /**
   * Optional trend line, rendered verbatim INCLUDING any arrow glyph.
   * The component never generates an arrow: the mockups use "↑ 132 since last
   * sync" and "+ 184 this week" under the same `up` type, so the glyph is copy,
   * not a function of deltaType. 8 of the 22 real cards omit the delta line.
   */
  delta?: string;

  /** Colors the delta line only. Defaults to "flat" when a delta is present. */
  deltaType?: StatDeltaType;

  /** Defaults to navy when absent. */
  color?: StatColor;
}

export interface StatsStripProps {
  /** 3–5 cards. The grid does not wrap; card count should match `columns`. */
  cards: readonly StatCard[];

  /** Defaults to 4. admin_contractors and admin_leads use 5. */
  columns?: 3 | 4 | 5;

  /**
   * Accessible name for the list, e.g. "Sync statistics".
   * An addition beyond §11's two props, not a divergence from them: the <dl>
   * benefits from a name when a page carries more than one strip.
   */
  ariaLabel?: string;
}

/**
 * Written out rather than interpolated — Tailwind's scanner only sees literal
 * class strings, so `grid-cols-${columns}` would be purged from the CSS.
 */
const COLUMN_CLASS: Record<3 | 4 | 5, string> = {
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
};

/** Navy is the default and therefore absent from this map. */
const VALUE_COLOR: Record<StatColor, string> = {
  gold: "text-gold",
  green: "text-status-success",
  warn: "text-status-error", // "warn" is red, despite the name
};

const DELTA_COLOR: Record<StatDeltaType, string> = {
  up: "text-status-success",
  flat: "text-gray-500",
};

export default function StatsStrip({
  cards,
  columns = 4,
  ariaLabel,
}: StatsStripProps) {
  return (
    /* 4 (or 3/5) columns collapsing to 2 below 1200px — the only breakpoint any
       mockup implements. stats_strip.html's prose claims a further collapse to
       1 column "on smaller mobile", but no CSS in the reference file or in any
       of the five production pages implements it. Following the CSS. */
    <dl
      aria-label={ariaLabel}
      className={`grid gap-4 max-[1200px]:grid-cols-2 ${COLUMN_CLASS[columns]}`}
    >
      {cards.map(({ value, label, delta, deltaType = "flat", color }, index) => (
        /* DOM order is dt → dd → dd so a screen reader reads
           "Total Active Contractors: 266,312, ↑ 132 since last sync".
           order-* restores the mockup's visual stacking (value, label, delta)
           without touching DOM order. Safe here because nothing is focusable. */
        <div
          key={`${index}-${label}`}
          className="flex flex-col border border-gray-200 bg-paper-raised px-[26px] py-[22px]"
        >
          <dt className="order-2 mt-1 font-mono text-[10.5px] uppercase tracking-label text-gray-500">
            {label}
          </dt>

          {/* 32px per stats_strip.html, admin_claim_review, admin_contractors,
              admin_leads and contractor_inquiries. admin_sync_status.html alone
              says 30px — treated as the outlier, not the spec. */}
          <dd
            className={`order-1 font-serif text-[32px] font-semibold leading-[1.1] tracking-[-0.015em] ${
              color ? VALUE_COLOR[color] : "text-navy"
            }`}
          >
            {value}
          </dd>

          {delta && (
            <dd
              className={`order-3 mt-2.5 font-mono text-micro tracking-[0.04em] ${DELTA_COLOR[deltaType]}`}
            >
              {delta}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}
