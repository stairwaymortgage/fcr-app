/**
 * Stairway Mortgage ad banner component.
 * Renders an iframe that shows at native size on desktop (centred)
 * and scales down to fill width on mobile via the ad's internal script.
 */

type AdSize = "970x250" | "320x100" | "340x420" | "300x250" | "300x600" | "400x400" | "728x90";

const dims: Record<AdSize, { w: number; h: number }> = {
  "970x250": { w: 970, h: 250 },
  "320x100": { w: 320, h: 100 },
  "340x420": { w: 340, h: 420 },
  "300x250": { w: 300, h: 250 },
  "300x600": { w: 300, h: 600 },
  "400x400": { w: 400, h: 400 },
  "728x90":  { w: 728, h: 90 },
};

export default function StairwayAd({
  size,
  className = "",
}: {
  size: AdSize;
  className?: string;
}) {
  const { w, h } = dims[size];

  return (
    <div className={className} style={{ maxWidth: w, margin: "0 auto" }}>
      <iframe
        src={`/ads/stairway/stairway-${size}.html`}
        width="100%"
        height={h}
        frameBorder="0"
        scrolling="no"
        style={{ border: 0, display: "block", maxWidth: "100%" }}
        title="Stairway Mortgage"
        loading="lazy"
      />
    </div>
  );
}
