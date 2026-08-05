import { ImageResponse } from "next/og";

import { frauncesItalic } from "./_brand/font";

import { contractorCountLabel } from "@/lib/registry-stats";

/**
 * The default social card — /opengraph-image
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * GENERATED, NOT DESIGNED IN A FILE. _handoff contains ZERO image assets — no
 * logo, no wordmark, not one PNG or SVG. The mark has only ever existed as
 * markup: a navy square, a gold rule inset 4px, an italic serif "F". So this
 * rebuilds it from the same design tokens the site renders, which means the
 * card cannot drift from the header the way an exported PNG would.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Rendered at build time by Next's file convention, so there is no per-request
 * cost and no runtime dependency on this succeeding. Pages that want their own
 * card add their own opengraph-image; everything else inherits this.
 *
 * The colours are the literal hex values from tailwind.config.ts rather than
 * Tailwind classes — satori resolves inline styles only, and has no access to
 * the Tailwind build. If the palette moves, these move with it BY HAND, which
 * is the cost of rendering outside the CSS pipeline.
 */

export const alt =
  "Florida Contractor Registry — a searchable registry of Florida contractor records";
// Edge, not Node — see app/_brand/font.ts. The Node build of next/og
// fails to prerender on Windows.
export const runtime = "edge";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const NAVY_DEEP = "#0f1a30";
const GOLD = "#b8924a";
const GOLD_LIGHT = "#d4b176";
const PAPER = "#fdfbf6";

export default async function OpengraphImage() {
  const fraunces = await frauncesItalic();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: NAVY_DEEP,
          padding: 72,
          // The gold hairline that edges every navy surface on the site.
          borderTop: `10px solid ${GOLD}`,
        }}
      >
        {/* MARK + WORDMARK — the header's logo group, rebuilt at 3x scale. */}
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div
            style={{
              position: "relative",
              display: "flex",
              width: 108,
              height: 108,
              alignItems: "center",
              justifyContent: "center",
              background: GOLD,
            }}
          >
            {/* .logo-mark::after — the rule inset inside the square. */}
            <div
              style={{
                position: "absolute",
                top: 10,
                left: 10,
                right: 10,
                bottom: 10,
                border: `2px solid ${NAVY_DEEP}`,
              }}
            />
            <div
              style={{
                fontFamily: "Fraunces",
                fontSize: 64,
                fontStyle: "italic",
                color: NAVY_DEEP,
                lineHeight: 1,
              }}
            >
              F
            </div>
          </div>

          <div
            style={{
              fontFamily: "Fraunces",
              fontSize: 52,
              fontStyle: "italic",
              color: PAPER,
              letterSpacing: "-0.01em",
            }}
          >
            Florida Contractor Registry
          </div>
        </div>

        {/* THE CLAIM. "records", never "active licenses" — the ruling in
            lib/registry-stats.ts applies to the card search engines and social
            previews quote, which is the last place the error should survive. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              fontFamily: "Fraunces",
              fontStyle: "italic",
              fontSize: 68,
              color: PAPER,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
            }}
          >
            Look up any licensed contractor in Florida.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 40, height: 3, background: GOLD }} />
            {/* ONE text child, built as a template literal rather than
                interpolation next to a string. Satori requires any element
                with more than one child to declare display:flex, and
                `{expr} literal text` is two children in JSX — which fails at
                render time with an error the type system cannot see. */}
            <div style={{ fontSize: 28, color: GOLD_LIGHT, letterSpacing: "0.02em" }}>
              {`${contractorCountLabel()} contractor records · sourced from Florida DBPR`}
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Fraunces",
          data: fraunces,
          style: "italic",
          weight: 600,
        },
      ],
    },
  );
}
