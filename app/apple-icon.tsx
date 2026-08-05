import { ImageResponse } from "next/og";

import { frauncesItalic } from "./_brand/font";

/**
 * The iOS home-screen icon — /apple-icon
 *
 * 180x180, the size iOS asks for. Separate from app/icon.tsx because the
 * constraints genuinely differ rather than only the dimensions:
 *
 *   · iOS applies its own rounded-rect mask and drops any transparency onto
 *     white, so the artwork must bleed to the edges — a centred glyph on a
 *     transparent field would be cropped into a white tile.
 *   · At 180px the 4px inset rule from the full logo IS legible, so it comes
 *     back. app/icon.tsx drops it because at 32px it closes into a smudge.
 *
 * Same inversion as the favicon: gold field, navy glyph. It has to survive
 * against whatever wallpaper the reader has chosen.
 */

// Edge, not Node — see app/_brand/font.ts. The Node build of next/og
// fails to prerender on Windows.
export const runtime = "edge";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  const fraunces = await frauncesItalic();

  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#b8924a",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            right: 16,
            bottom: 16,
            border: "3px solid #0f1a30",
          }}
        />
        <div
          style={{
            fontFamily: "Fraunces",
            fontStyle: "italic",
            fontSize: 108,
            color: "#0f1a30",
            lineHeight: 1,
            paddingRight: 6,
          }}
        >
          F
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Fraunces", data: fraunces, style: "italic", weight: 600 }],
    },
  );
}
