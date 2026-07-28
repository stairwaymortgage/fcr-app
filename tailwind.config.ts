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

      /* Status — structured naming (PREFERRED in new components) ------- */
      status: {
        success: "#2e7d32", // claimed, current license, paid
        successBg: "#e8f5e9",
        warn: "#8d6e00", // pending, delinquent license
        warnBg: "#fff8e1",
        error: "#c2415b", // danger zone, void license
        errorBg: "#fef2f4",
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
