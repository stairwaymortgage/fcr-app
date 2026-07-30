import type { Metadata } from "next";
import { Fraunces, Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * Typography — Build Brief v1.3 §03.
 * Three families, each with a fixed role. Never substitute.
 *
 * All three are variable fonts, so the full weight range ships in one file —
 * every weight the design calls for (400/500/600/700) is covered, and asking
 * for more later costs nothing. Loaded via next/font/google so the files are
 * self-hosted at build time: no request to fonts.gstatic.com, no FOUT, and no
 * layout shift — which is what keeps us inside the LCP < 2.0s / CLS < 0.05
 * budgets in §09.
 */

// Display: headings, page titles, profile names, kicker italics.
// `italic` is NOT optional — editorial emphasis on the closing phrase
// ("Verify a *license.*") is the core heading pattern (§03, §09).
// `opsz` carries Fraunces' optical sizing axis, which the brief calls for.
const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  display: "swap",
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
export const metadata: Metadata = {
  title: "Florida Contractor Registry",
  description:
    "A searchable registry of Florida contractor records, sourced weekly from the Florida DBPR public extract.",
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
