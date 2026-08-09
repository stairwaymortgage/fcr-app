/**
 * Stairway Mortgage ad banner component.
 * Renders a responsive iframe pointing to the self-contained HTML creative
 * hosted at /ads/stairway/stairway-{size}.html.
 */

type AdSize = "970x250" | "320x100" | "340x420" | "300x250" | "300x600" | "728x90";

const dimensions: Record<AdSize, { w: number; h: number }> = {
  "970x250": { w: 970, h: 250 },
  "320x100": { w: 320, h: 100 },
  "340x420": { w: 340, h: 420 },
  "300x250": { w: 300, h: 250 },
  "300x600": { w: 300, h: 600 },
  "728x90":  { w: 728, h: 90  },
};

export default function StairwayAd({
  size,
  className = "",
}: {
  size: AdSize;
  className?: string;
}) {
  const { w, h } = dimensions[size];
  return (
    <div className={`flex justify-center ${className}`}>
      <iframe
        src={`/ads/stairway/stairway-${size}.html`}
        width={w}
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
