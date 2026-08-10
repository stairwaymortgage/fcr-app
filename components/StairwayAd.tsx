/**
 * Stairway Mortgage ad banner component.
 * Renders a fluid-width iframe that fills its container.
 * The banner HTML inside centres its fixed-size creative and
 * uses a transparent body so no dark border bleeds through.
 */

type AdSize = "970x250" | "320x100" | "340x420" | "300x250" | "300x600" | "728x90";

const heights: Record<AdSize, number> = {
  "970x250": 250,
  "320x100": 100,
  "340x420": 420,
  "300x250": 250,
  "300x600": 600,
  "728x90":  90,
};

export default function StairwayAd({
  size,
  className = "",
}: {
  size: AdSize;
  className?: string;
}) {
  return (
    <div className={className}>
      <iframe
        src={`/ads/stairway/stairway-${size}.html`}
        width="100%"
        height={heights[size]}
        frameBorder="0"
        scrolling="no"
        style={{ border: 0, display: "block" }}
        title="Stairway Mortgage"
        loading="lazy"
      />
    </div>
  );
}
