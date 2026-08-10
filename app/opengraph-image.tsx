import { ImageResponse } from "next/og";

import { frauncesItalic } from "./_brand/font";

import { contractorCountLabel } from "@/lib/registry-stats";

/**
 * The default social card — /opengraph-image
 *
 * Uses the Florida Contractor Registry logo image alongside the wordmark.
 */

export const alt =
  "Florida Contractor Registry — a searchable registry of Florida contractor records";
export const runtime = "edge";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const NAVY_DEEP = "#0f1a30";
const GOLD = "#b8924a";
const GOLD_LIGHT = "#d4b176";
const PAPER = "#fdfbf6";

export default async function OpengraphImage() {
  const fraunces = await frauncesItalic();
  const logoData = await fetch(new URL("../public/logo.jpeg", import.meta.url)).then(
    (res) => res.arrayBuffer(),
  );
  const logoBase64 = Buffer.from(logoData).toString("base64");
  const logoSrc = `data:image/jpeg;base64,${logoBase64}`;

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
          borderTop: `10px solid ${GOLD}`,
        }}
      >
        {/* MARK + WORDMARK */}
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} alt="" width={108} height={108} style={{ objectFit: "cover" }} />
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
