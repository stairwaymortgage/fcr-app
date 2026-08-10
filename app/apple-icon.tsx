import { ImageResponse } from "next/og";

/**
 * The iOS home-screen icon — /apple-icon
 *
 * Uses the Florida Contractor Registry logo (gold Florida silhouette on navy).
 */

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
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
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} alt="" width={180} height={180} style={{ objectFit: "cover" }} />
      </div>
    ),
    { ...size },
  );
}
