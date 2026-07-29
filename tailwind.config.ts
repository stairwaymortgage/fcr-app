import type { Config } from "tailwindcss";

/**
 * Florida Contractor Registry — design tokens
 * Source: Build Brief v1.3 §03 (Design System), §09 (Gotchas)
 *
 * The aesthetic is editorial-civic. Three non-negotiables live in this file:
 *   1. No pure black (#000) and no accidental pure white — always ink / paper.
 *   2. Border radius is 0 everywhere. `full` is retained ONLY for avatar
 *      circles and status dots.
 *   3. Three font families, each with a fixed role. Never substitute.
 *
 * `colors` is defined on `theme` (NOT `theme.extend`) so it REPLACES Tailwind's
 * default palette outright rather than merging into it. Consequences, all
 * intentional:
 *   - `text-black` / `bg-black` do not exist. Body text is always ink.
 *   - Tailwind's default grays (gray-600 #4b5563, gray-800 #1f2937,
 *     gray-900 #111827, gray-950 #030712) do not exist. Only the seven steps
 *     from Build Brief §03 are available.
 *   - No default palettes (red-500, blue-600, …). Any new color is a
 *     deliberate addition to this file, reviewed like any other design change.
 *
 * `fontFamily` and `borderRadius` stay under `extend` — there we want
 * Tailwind's defaults plus our overrides, not a replacement.
 */
const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    // REQUIRED. Shared class strings live here (lib/focus.ts). Tailwind scans
    // these globs as text — a class string is only emitted if it appears in a
    // scanned file. Moving FOCUS_RING out of components/ into an unscanned
    // lib/ silently purged all seven focus-visible rules with no build error;
    // the rings simply stopped rendering. Any future directory holding class
    // strings must be added here too.
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    colors: {
      /* Primitives — required by Tailwind internals ------------------- */
      transparent: "transparent",
      current: "currentColor",
      inherit: "inherit",

      /* Neutrals — explicit, so accidents are impossible -------------- */
      white: "#ffffff", // ONLY input fields and rgba() overlays. NOT card
      // surfaces — those use paper.raised. See the note below.
      paper: {
        DEFAULT: "#fdfbf6", // body background — the default surface
        // Raised card surface; sits above --paper, never #fff per §03/§09.
        //
        // The six stats_strip mockups all specify `background: white` on
        // .stat-card, but Build Brief §03 prohibits pure white three separate
        // times: "Warm off-white, NEVER pure white" (--paper), "No pure white
        // backgrounds. Always --paper (#fdfbf6). Pure white reads cheap.", and
        // §09 "Never #000 or #fff ... pure white will look broken."
        //
        // Resolution: the mockups' `background: white` is implementation
        // shorthand for "raised lighter card," not a considered override of a
        // rule stated three times. We honor the intent (a card that lifts off
        // the page) while obeying the rule (never #fff). Every card surface in
        // the app uses this token — stats cards, ListDetailLayout panes,
        // StatusBanner, admin tables.
        raised: "#fffdf8",
      },
      ink: "#181a1f", // body text — the default text color
      // NOTE: `black` is deliberately absent. Never #000. (Build Brief §09)

      /* Gray scale — the complete set, Build Brief §03 ----------------- */
      gray: {
        // Inset band inside a raised panel — list/detail headers, action bars.
        // Like paper.raised, this is absent from the Build Brief §03 palette
        // (which lists only gray-100/200/300/500/700) but is established in the
        // mockups: list_detail_layout.html uses it 4×, contractor_inquiries 4×,
        // admin_claim_review 3×, always for a band recessed within a card.
        50: "#fafbfc",
        100: "#f3f4f7", // admin page background, section dividers
        200: "#e8eaee", // card borders, dividers
        300: "#d4d6da", // input borders, table borders
        400: "#b5b8be",
        500: "#8a8d94", // tertiary text, labels, timestamps
        700: "#4a4d54", // secondary text, descriptions, meta
      },

      /* Brand primary -------------------------------------------------- */
      navy: {
        DEFAULT: "#1a2845", // headings, primary buttons, header strip
        deep: "#0f1a30", // footer background, navy-on-navy hover
      },

      /* Brand accent --------------------------------------------------- */
      gold: {
        DEFAULT: "#b8924a", // accent + CTA, underlines, eyebrow tags
        light: "#d4b176", // gold text on dark navy backgrounds
        pale: "#f5ecd9", // callout / banner backgrounds, hover highlight
      },

      /* Status — structured naming (PREFERRED in new components) -------
       *
       * THE WORD "warn" MEANS TWO DIFFERENT COLOURS IN THIS CODEBASE, and both
       * are correct against their own mockups. StatusBanner's `warn` variant is
       * amber (status.warn, #8d6e00) — "unusual, not broken". StatsStrip's
       * StatColor `warn` is RED (status.error, #c2415b) — "attention-negative",
       * e.g. a Pending Review count. Verified across six mockups each. Do not
       * reconcile them; see the cross-reference comments in both components.
       *
       * *Bg  = the pale fill behind a status surface.
       * *Edge = the muted 1px border on that surface. Distinct from the
       *         saturated base colour, which is reserved for the accent bar,
       *         icon square and text.
       */
      status: {
        success: "#2e7d32", // claimed, current license, paid
        successBg: "#e8f5e9",
        // StatusBanner's success fill in the mockup is #ecf6ed — 4/1/4 points
        // off successBg, imperceptible. successBg is reused rather than
        // minting a near-duplicate token, which keeps the *Bg family coherent
        // (warnBg and errorBg match their mockup fills exactly).
        successDeep: "#1b5e20", // success status tag; .btn-approve:hover
        successEdge: "#c6e0c8",
        warn: "#8d6e00", // pending, delinquent license
        warnBg: "#fff8e1",
        warnEdge: "#e8d490",
        error: "#c2415b", // danger zone, void license
        errorBg: "#fef2f4",
        errorEdge: "#e8c5cc",
      },

      /* Status — semantic aliases (mockup-HTML compatibility) ----------
       * Same hex values as status.* above. Kept so markup ported verbatim
       * from the mockups keeps working. Prefer status.* in new code. */
      "green-text": "#2e7d32",
      "green-bg": "#e8f5e9",
      "yellow-text": "#8d6e00",
      "yellow-bg": "#fff8e1",
      "red-text": "#c2415b",
      "red-bg": "#fef2f4",
    },

    extend: {
      maxWidth: {
        // Two container widths, split by audience. Both pair with `px-8`.
        //
        // The public page shell. Every public mockup wraps its content in
        // `max-width: 1240px; margin: 0 auto; padding: 0 32px` — header.html
        // (twice), footer.html, and 404.html (twice).
        shell: "1240px",
        // The authenticated app shell — admin and contractor portal. Wider,
        // because those pages carry data tables that need the room. Appears 17
        // times across the handoff: admin_header.html, contractor_header.html,
        // list_detail_layout.html, all five 08_admin/ pages (header + page
        // container), contractor_inquiries.html, manage_profile.html, and
        // claim_approved.html.
        app: "1480px",
      },

      /* Type scale — Rule of Three promotions ------------------------
       * Only sizes used 3+ times live here; 1–2 use values stay inline as
       * arbitrary values.
       *
       * COUNTING RULE, three clauses:
       *
       * 1. Temporary scaffolding never counts. app/preview/ is committed but
       *    marked for deletion, so its occurrences are excluded — only
       *    production code counts. It keeps appearing in grep results until
       *    it is deleted; ignore it.
       *
       * 2. Count DISTINCT FILES, not call sites. app/not-found.tsx uses
       *    text-[13.5px] on two elements; that is one file, not two. Before
       *    this promotion it stood at 2 files and 3 call sites, and stayed
       *    inline.
       *
       * 3. COUNT THE FILE YOU ARE WRITING. text-[10.5px] was reported as "2
       *    production uses" in dc5967b while that same commit added the third
       *    — the audit counted only pre-existing files and missed the one
       *    being authored. Run the count after writing, not before.
       *
       * Defined as plain strings, NOT [size, lineHeight]
       * tuples, so each emits font-size alone — exactly what the arbitrary
       * values they replace emitted. A tuple would silently add a
       * line-height and change rendering.
       *
       * Under `extend`, so Tailwind's built-in text-xs / text-sm / ... all
       * survive alongside these.
       */
      fontSize: {
        // Tag chips and count badges. 4 uses: AdminHeader and
        // ContractorHeader each render a portal tag chip and a nav badge.
        chip: "10px",
        // Uppercase mono labels. Single-role — all 4 files use it for exactly
        // that: Footer column headings, StatsStrip stat labels, StatusBanner
        // status tags, ContentPageLayout's nav tag. A use-name is honest here.
        // Note the tracking varies by context (eyebrow 0.14em vs label
        // 0.12em); only the size is shared, which is why this is a fontSize
        // entry and not a component class.
        label: "10.5px",
        // §03 names 11px as the eyebrow size ("gold uppercase mono tag
        // (e.g., 'FOR HOMEOWNERS'), 11px, 0.14em letter-spacing"), but it is
        // NOT eyebrow-only — StatsStrip uses it for the delta line. Named for
        // the scale step, not one role. 3 uses.
        micro: "11px",
        // Small interface text: nav links, footer links, list tabs, user
        // chips. 7 uses — the most repeated size in the app.
        ui: "13px",
        // Secondary body copy, below the 17px article body. 3 files:
        // StatusBanner detail, the 404's "why this happens" aside,
        // ContentPageLayout's rail module paragraph. Named for the text class
        // rather than one use — same principle as micro over eyebrow.
        note: "13.5px",
      },

      /* Letter-spacing — Rule of Three promotions --------------------- */
      letterSpacing: {
        // §03: "Eyebrow — gold uppercase mono tag ..., 0.14em letter-spacing".
        // All 3 uses are that treatment: the two portal tag chips and the
        // public Header's uppercase tagline.
        eyebrow: "0.14em",
        // The slightly tighter tracking on small-caps labels: Footer column
        // headings, StatsStrip stat labels, ListDetailLayout list label.
        // 3 uses.
        label: "0.12em",
        // Serif wordmarks only — Header, AdminHeader, ContractorHeader.
        // Single-role, so a use-name is honest here. 3 uses.
        wordmark: "-0.01em",
      },

      fontFamily: {
        // The var(--font-*) entries are supplied by next/font/google in
        // app/layout.tsx. The literal family name follows each variable as a
        // belt-and-braces fallback, then the system stack.
        //
        // Display: headings, page titles, profile names, kicker italics.
        serif: ["var(--font-serif)", "Fraunces", "Georgia", "serif"],
        // Body: paragraphs, navigation, form labels, buttons, all UI text.
        sans: [
          "var(--font-sans)",
          "Inter Tight",
          "-apple-system",
          "BlinkMacSystemFont",
          "system-ui",
          "sans-serif",
        ],
        // Data affordance: license numbers, dates, eyebrow tags, timestamps.
        mono: [
          "var(--font-mono)",
          "JetBrains Mono",
          "ui-monospace",
          "Cascadia Code",
          "monospace",
        ],
      },

      borderRadius: {
        // NON-NEGOTIABLE: 0 everywhere by design (Build Brief §09).
        DEFAULT: "0",
        none: "0",
        sm: "0",
        md: "0",
        lg: "0",
        xl: "0",
        "2xl": "0",
        "3xl": "0",
        // ONLY for shapes whose roundness IS the shape: avatar circles, status
        // dots, and count-badge pills. Never on cards, inputs, or buttons.
        full: "9999px",
      },
    },
  },
  plugins: [],
};

export default config;
