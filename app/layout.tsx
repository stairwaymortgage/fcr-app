import type { Metadata } from "next";
import { Fraunces, Inter_Tight, JetBrains_Mono } from "next/font/google";

import { isIndexable, siteOrigin } from "@/lib/site-url";

import "./globals.css";

/**
 * Typography — Build Brief v1.3 §03.
 * Three families, each with a fixed role. Never substitute.
 *
 * All three are variable fonts, so the full weight range ships in one file —
 * every weight the design calls for (400/500/600/700) is covered, and asking
 * for more later costs nothing. Loaded via next/font/google so the files are
 * self-hosted at build time: no request to fonts.gstatic.com.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ AN EARLIER VERSION OF THIS COMMENT CLAIMED "no FOUT, and no layout shift —
 * which is what keeps us inside the LCP < 2.0s / CLS < 0.05 budgets in §09".
 * THAT WAS MEASURABLY FALSE, and it was the reason nobody looked.
 *
 * Lighthouse 12 against a production build, 2026-08-05: the homepage scored
 * CLS 0.1303 — 2.6x the §09 budget — reproducible to four decimal places
 * across four runs, with the `layout-shifts` audit attributing ONE HUNDRED
 * PERCENT of it to the swap of these font files.
 *
 * Self-hosting removes the network request; it does not remove the swap.
 * next/font also generates a metric-adjusted fallback, which SHRINKS the
 * reflow rather than eliminating it — and Fraunces is a variable optical-size
 * serif whose metrics diverge far enough from any system fallback that the
 * residue was still visible. The homepage was worst because its hero is the
 * largest serif text on the site.
 *
 * Every other page already passed (profile 0.001, type 0.009, search 0.010,
 * county 0.015), which is exactly why a site-wide claim was believable.
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Display: headings, page titles, profile names, kicker italics.
// `italic` is NOT optional — editorial emphasis on the closing phrase
// ("Verify a *license.*") is the core heading pattern (§03, §09).
// `opsz` carries Fraunces' optical sizing axis, which the brief calls for.
const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  /**
   * "optional", NOT "swap" — this is the CLS fix.
   *
   * `optional` gives the font ~100ms to arrive; if it misses that window the
   * fallback is kept FOR THAT PAGE VIEW and no swap ever happens, so the shift
   * cannot occur. The font is still cached for every subsequent navigation, so
   * a real visitor sees Fraunces from their second page onwards and usually on
   * the first — it is self-hosted and preloaded from our own origin.
   *
   * The trade is deliberate and it is a trade: a cold first paint on a slow
   * connection renders the heading in the fallback serif. §09 makes CLS a
   * budget and typography a preference, and a heading that reflows under the
   * reader's eye is more damaging than one that is briefly Georgia.
   *
   * ONLY FRAUNCES. Inter Tight and JetBrains Mono keep `swap`: they measured
   * as no meaningful part of the shift, and `optional` on body text risks a
   * whole page of fallback for a problem it does not have.
   */
  display: "optional",
  variable: "--font-serif",
});

// Body: paragraphs, navigation, form labels, buttons, all interface text.
const interTight = Inter_Tight({
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-sans",
});

// Data affordance: license numbers, dates, eyebrow tags, technical labels.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

/**
 * "records", not "active licenses". This is the site-wide default description
 * and it made the same false claim the homepage hero did — see
 * lib/registry-stats.ts. It is the string search engines quote, so it is the
 * last place the error should survive.
 */
const DESCRIPTION =
  "A searchable registry of Florida contractor records, sourced weekly from the Florida DBPR public extract.";

export const metadata: Metadata = {
  /**
   * ⚠ metadataBase WAS MISSING ENTIRELY UNTIL TASK 179.
   *
   * Without it Next resolves relative Open Graph and canonical URLs against
   * localhost:3000 and logs a build warning — so every `alternates.canonical`
   * already declared across the content pages was resolving to a canonical tag
   * pointing at a developer's machine, and the OG image below would never have
   * loaded for any scraper.
   *
   * Driven by NEXT_PUBLIC_SITE_URL through lib/site-url.ts, so it moves to the
   * apex with everything else at DNS cutover. Until then it is the Vercel host
   * — which is correct: a canonical tag must name the URL actually being
   * served, and robots.txt is what stops that host being indexed.
   */
  metadataBase: new URL(siteOrigin()),
  /**
   * A PLAIN STRING, NOT A title.template — and that is load-bearing.
   *
   * The obvious move here is `template: "%s · Florida Contractor Registry"`, so
   * pages can set a bare title. It was tried and reverted: every existing page
   * already spells the site name out in full ("Data sources · Florida
   * Contractor Registry", "Privacy Policy · Florida Contractor Registry", and
   * thirty more). A template would have appended it a second time to all of
   * them, publishing "… · Florida Contractor Registry · Florida Contractor
   * Registry" as the string search engines display.
   *
   * Converting thirty-plus pages to bare titles to enable the template is a
   * defensible refactor; doing it silently as a side effect of adding
   * metadataBase is not. New pages follow the existing convention and write the
   * suffix out.
   */
  title: "Florida Contractor Registry",
  description: DESCRIPTION,
  applicationName: "Florida Contractor Registry",
  /**
   * The default social card for every page that does not set its own.
   *
   * `images` is deliberately absent here: app/opengraph-image.tsx is a
   * file-convention route, so Next discovers it and injects the correct
   * absolute URL, dimensions and type automatically. Listing it by hand would
   * be a second source of truth that goes stale the moment the file moves.
   */
  openGraph: {
    type: "website",
    siteName: "Florida Contractor Registry",
    title: "Florida Contractor Registry",
    description: DESCRIPTION,
    locale: "en_US",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Florida Contractor Registry",
    description: DESCRIPTION,
  },
  /**
   * Belt and braces with robots.txt, and they must agree. app/robots.ts blocks
   * crawling off the apex; this blocks INDEXING of anything that is fetched
   * anyway — a page linked from elsewhere can be indexed without ever being
   * crawled, which robots.txt alone does not prevent.
   */
  robots: isIndexable()
    ? { index: true, follow: true }
    : { index: false, follow: false },

  /**
   * Google Search Console site verification.
   *
   * Next emits <meta name="google-site-verification" content="…"> from this.
   * Written through the metadata API rather than as a hand-placed tag in the
   * <head> below, so it sits with the rest of the head content and cannot drift
   * out of sync with it.
   *
   * ⚠ IT IS EMITTED ON EVERY ENVIRONMENT, INCLUDING PREVIEWS — deliberately,
   * and NOT gated behind isIndexable() like `robots` above. The two look like
   * they should agree and they should not: a verification token proves to
   * Google that whoever holds it controls this property, which is a claim about
   * ownership rather than an invitation to crawl. Gating it would break
   * verification on exactly the deployment you might be asked to verify, while
   * the noindex directive above continues to do the actual keep-out work.
   *
   * The token is public by design — it ships in the HTML of every page and is
   * meant to be read by a crawler. It is not a credential and does not belong
   * in an environment variable.
   */
  verification: {
    google: "dQW9d9skbyfRlU3igycnet2erkgu0SOPOe-RQ5-gY_Q",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${interTight.variable} ${jetbrainsMono.variable}`}
    >
      <body className="bg-paper font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
