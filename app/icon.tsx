import { ImageResponse } from "next/og";

/**
 * The favicon — /icon
 *
 * Uses the Florida Contractor Registry logo (gold Florida silhouette on navy).
 */

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default async function Icon() {
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
        <img src={logoSrc} alt="" width={32} height={32} style={{ objectFit: "cover" }} />
      </div>
    ),
    { ...size },
  );
}
