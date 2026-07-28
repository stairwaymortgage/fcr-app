/**
 * Shared focus-visible treatments.
 *
 * Extracted after the same class string appeared verbatim in four shipped
 * components — Header, Footer, AdminHeader, ContractorHeader — three times
 * each. Rule of Three, applied to a class string rather than a token value.
 *
 * TWO CONSTANTS, NOT ONE PARAMETERISED HELPER. A function that assembled the
 * string at runtime would be opaque to Tailwind's scanner unless every branch
 * were a literal, which is the same hazard that forces the literal Record maps
 * in StatsStrip and ListDetailLayout. Two literals are safe by construction.
 *
 * NAMED FOR THE SURFACE, NOT THE ACCENT COLOUR. The offset utility must match
 * the background behind the element; getting it wrong draws a mismatched halo
 * rather than failing outright, so the surface is the part a caller has to get
 * right.
 *
 * Pick by what the focusable element SITS ON:
 *   FOCUS_RING_PAPER — paper, paper-raised, gray-50, gray-100
 *   FOCUS_RING_NAVY  — navy-deep (portal headers, footer)
 *
 * A navy (#1a2845) surface has no constant yet; nothing focusable sits on one.
 * Add FOCUS_RING_NAVY_MID when something does — do not reuse the navy-deep
 * offset, the halo would be visibly wrong.
 *
 * KEEP PROSE CLEAR OF BARE UTILITY NAMES. Tailwind scans this file as plain
 * text, comments included, and emits any word that matches a real utility. An
 * earlier draft of this docblock used two such words in ordinary sentences and
 * shipped two dead rules to production CSS. Verified by diffing the compiled
 * stylesheet before and after.
 */

/** Focus treatment for light surfaces. Gold halo on a paper offset. */
export const FOCUS_RING_PAPER =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

/** Focus treatment for navy-deep surfaces. Lighter gold, so it reads on dark. */
export const FOCUS_RING_NAVY =
  "focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-gold-light focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-navy-deep";
