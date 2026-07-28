import type { ReactNode } from "react";

/**
 * StatusBanner — prominent operational-state banner for dashboard pages.
 * Source: _handoff/04_components/status_banner.html
 * Spec: Build Brief v1.3 §11 · COMPONENTS, StatusBanner entry (read
 *       2026-07-29), which specifies verbatim:
 *
 *         Source: status_banner.html · Operational banner. Three variants:
 *         success (green), warning (yellow), error (red). Includes icon,
 *         message, optional action button, optional dismiss.
 *         Used on: admin pages, primarily admin_sync_status (when sync failed
 *         or stale) and admin_claim_review (when claim is auto-approvable).
 *         Props
 *           variant: 'success' | 'warn' | 'error'
 *           message: string
 *           action?: { label: string, onClick: () => void }
 *           dismissible?: boolean
 *
 * Server component. Nothing here is interactive.
 *
 * §11 INACCURACY: it names admin_claim_review as a consumer "when claim is
 * auto-approvable". That file contains ZERO status-banner occurrences and no
 * banner-like class at all. admin_sync_status.html is the only real consumer.
 * Logged, not scoped for. (Second §11 inaccuracy found; the first is the
 * "40% / 60%" split in ListDetailLayout, which is really 380px/420px + 1fr.)
 *
 * DELIBERATELY UNIMPLEMENTED FROM §11, pending a real consumer:
 *   message      — cannot express the mockup's tag + italic headline + bolded
 *                  detail + timestamp + duration. Replaced by those fields.
 *   action       — no mockup has a button. `onClick: () => void` is a client
 *                  function reference, so implementing it would force
 *                  "use client" on an otherwise static component.
 *   dismissible  — no mockup has a dismiss control; it would need client state.
 * Flagged rather than dropped. Fourth prose-vs-mockup interactivity gap in this
 * handoff, after AdminHeader's user dropdown, StatsStrip's claimed 1-column
 * mobile breakpoint, and ListDetailLayout's back nav.
 *
 * SURFACE — §03 GRADIENT CONFLICT, RESOLVED BY FLATTENING. The mockup fills
 * each variant with `linear-gradient(90deg, ...)`, but §03 line 162 reads: "No
 * SaaS gradient backgrounds. Single solid navy, single solid gold. Gradients
 * only in two specific places: claim_approved hero banner, and the
 * featured-mention card on that same page." This banner would be a third.
 *
 * Each gradient is a ~7-point wash between two near-identical tints (success
 * #ecf6ed -> #f3fbf3), so flattening to the solid start colour is visually
 * imperceptible and satisfies §03. It also avoids minting six tokens for the
 * gradient end and border colours, which appear in exactly two files — this
 * component and its single consumer, i.e. no reuse at all.
 *
 * The muted 1px borders ARE kept as tokens, because dropping them for the
 * saturated base colour would harden every edge and change the look.
 *
 * ICONS ARE INLINE SVG, NOT THE MOCKUP'S TEXT GLYPHS. The mockup renders the
 * icon as a Fraunces character (✓, !, ×) and §03 sanctions typographic marks.
 * Deliberate deviation: those codepoints have inconsistent metrics across
 * platforms and can fall back to a colour-emoji face, which would break the
 * 48px square. Geometry is drawn instead. No glyphs, no icon font, no emoji.
 *
 * MOBILE: below 1200px the grid collapses to one column, per
 * admin_sync_status.html:462. That rule also sets `text-align: left`, which
 * exists only to undo the meta block's right alignment — so it lives on the
 * meta element here, not the container, where the child's text-right would
 * simply win.
 */

/**
 * §11's exact union.
 *
 * NOTE THE COLLISION: `warn` here is AMBER (status.warn, #8d6e00) — "unusual,
 * not broken". StatsStrip's StatColor also has a `warn` and it is RED
 * (status.error, #c2415b) — "attention-negative", e.g. a Pending Review count.
 * Both match their own mockups, verified across six files each. They are NOT
 * to be reconciled; see the matching note in StatsStrip.tsx.
 */
export type StatusVariant = "success" | "warn" | "error";

export interface StatusBannerProps {
  /** §11: variant: 'success' | 'warn' | 'error'. */
  variant: StatusVariant;

  /**
   * ADDITION beyond §11 — the uppercase mono eyebrow, e.g.
   * "Last Run · Successful". §11 has no slot for it; every mockup variant
   * renders one, and per the docs it is what communicates state independently
   * of colour.
   */
  tag: string;

  /**
   * ADDITION beyond §11, replacing its `message: string`.
   *
   * ReactNode because every mockup headline carries italic emphasis on the
   * closing phrase — "Sync completed <em>without errors.</em>" — which is
   * §03's editorial pattern and cannot be expressed as a plain string.
   */
  headline: ReactNode;

  /**
   * ADDITION beyond §11, also replacing `message`.
   * ReactNode because the mockup bolds figures inside it:
   * "<strong>847 changes applied</strong>".
   */
  detail: ReactNode;

  /**
   * ADDITION beyond §11 — the right-hand meta block. "Optional — omit if not
   * relevant" per docs line 332. ReactNode because the mockup breaks the date
   * across two lines with <br/>.
   */
  timestamp?: ReactNode;

  /** ADDITION beyond §11 — paired with timestamp, e.g. "Duration: 14m 22s". */
  duration?: string;
}

/** Geometry only — no glyphs. Colour comes from the square's text-white. */
const ICON_PATHS: Record<StatusVariant, readonly string[]> = {
  success: ["M4.5 12.75 9.75 18 19.5 6.75"],
  // Vertical stroke plus a zero-length path, which strokeLinecap="round"
  // renders as the dot of the exclamation mark.
  warn: ["M12 5.5v8", "M12 18.25h.01"],
  error: ["M6.75 6.75 17.25 17.25", "M17.25 6.75 6.75 17.25"],
};

function VariantIcon({ variant }: { variant: StatusVariant }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-6 w-6"
    >
      {ICON_PATHS[variant].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * Written out rather than composed — Tailwind's scanner only sees literal
 * class strings.
 *
 * `edge` is the muted all-sides border; `accent` is the saturated colour used
 * for the 6px left edge and the icon square. Both are set on the same element,
 * so the left-edge colour must be emitted after the all-sides colour in the
 * stylesheet — verified in the compiled CSS, not assumed.
 */
const VARIANT: Record<
  StatusVariant,
  {
    fill: string;
    edge: string;
    leftEdge: string;
    iconBg: string;
    tagColor: string;
    srLabel: string;
  }
> = {
  success: {
    fill: "bg-status-successBg",
    edge: "border-status-successEdge",
    leftEdge: "border-l-status-success",
    iconBg: "bg-status-success",
    tagColor: "text-status-successDeep",
    srLabel: "Success",
  },
  warn: {
    fill: "bg-status-warnBg",
    edge: "border-status-warnEdge",
    leftEdge: "border-l-status-warn",
    iconBg: "bg-status-warn",
    tagColor: "text-status-warn",
    srLabel: "Warning",
  },
  error: {
    fill: "bg-status-errorBg",
    edge: "border-status-errorEdge",
    leftEdge: "border-l-status-error",
    iconBg: "bg-status-error",
    tagColor: "text-status-error",
    srLabel: "Error",
  },
};

export default function StatusBanner({
  variant,
  tag,
  headline,
  detail,
  timestamp,
  duration,
}: StatusBannerProps) {
  const v = VARIANT[variant];

  return (
    /* role="alert" is assertive and reserved for the failed state; success and
       warn are polite. Both are no-ops on a server-rendered first paint — live
       regions announce changes, not initial content — but become correct once
       the sync page refreshes or polls, which is its eventual behaviour. */
    <div
      role={variant === "error" ? "alert" : "status"}
      className={`grid grid-cols-[auto_1fr_auto] items-center gap-6 border border-l-[6px] px-7 py-6 max-[1200px]:grid-cols-1 ${v.fill} ${v.edge} ${v.leftEdge}`}
    >
      <div
        className={`flex h-12 w-12 shrink-0 items-center justify-center text-white ${v.iconBg}`}
      >
        <VariantIcon variant={variant} />
      </div>

      <div className="min-w-0">
        {/* The docs are explicit that state must not rely on colour alone. The
            icon is geometry and the tag is caller copy, so the variant word is
            stated outright for screen readers rather than left to either. */}
        <p
          className={`mb-1 font-mono text-[10.5px] font-semibold uppercase tracking-eyebrow ${v.tagColor}`}
        >
          <span className="sr-only">{v.srLabel}: </span>
          {tag}
        </p>

        <h2 className="mb-1.5 font-serif text-[22px] font-semibold leading-[1.25] tracking-[-0.015em] text-ink">
          {headline}
        </h2>

        <div className="text-[13.5px] leading-[1.55] text-gray-700">
          {detail}
        </div>
      </div>

      {timestamp && (
        <div className="shrink-0 text-right font-mono text-micro tracking-[0.06em] text-gray-500 max-[1200px]:text-left">
          <div className="mb-1 text-ui font-semibold tracking-[0.02em] text-gray-700">
            {timestamp}
          </div>
          {duration && <div>{duration}</div>}
        </div>
      )}
    </div>
  );
}
