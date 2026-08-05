import { ImageResponse } from "next/og";

import { frauncesItalic } from "./_brand/font";

/**
 * The favicon — /icon
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THIS REPLACES THE create-next-app DEFAULT, WHICH WAS STILL SHIPPING.
 *
 * app/favicon.ico was 25,931 bytes with the same mtime as .eslintrc.json and
 * next.config.mjs — the untouched scaffold file. Every tab, bookmark and search
 * result for this site was showing the Next.js logo.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The mark is the header's, reduced to what survives at 32px: the gold field
 * and the italic serif F. The 4px inset rule that the full logo carries is
 * DROPPED — at this size it closes up into a muddy border and costs more
 * legibility than the detail is worth. The wordmark is gone for the same
 * reason.
 *
 * INVERTED RELATIVE TO THE HEADER — gold field, navy glyph, rather than navy
 * field with a gold glyph. A favicon sits on a browser chrome background that
 * is white or near-black depending on the user's theme; a navy square vanishes
 * into a dark tab strip, while gold holds against both.
 *
 * NOTE ON /favicon.ico: removing the scaffold file means that legacy path now
 * 404s. Next emits <link rel="icon" href="/icon…"> which every browser released
 * this decade honours; the bare /favicon.ico request is a fallback for much
 * older clients and some crawlers. If that matters later, add a real
 * app/favicon.ico — it cannot be generated here, because ImageResponse emits
 * PNG and .ico is a different container.
 */

// Edge, not Node — see app/_brand/font.ts. The Node build of next/og
// fails to prerender on Windows.
export const runtime = "edge";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default async function Icon() {
  const fraunces = await frauncesItalic();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#b8924a",
          color: "#0f1a30",
          fontFamily: "Fraunces",
          fontStyle: "italic",
          // Optically centred: the italic F leans right, so it is nudged left
          // and sized to sit on the square rather than inside it.
          fontSize: 26,
          lineHeight: 1,
          paddingRight: 2,
        }}
      >
        F
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Fraunces", data: fraunces, style: "italic", weight: 600 }],
    },
  );
}
