/**
 * Stairway Mortgage ad banner component.
 * Renders a fluid-width iframe that fills its container.
 * The banner HTML inside centres its fixed-size creative and
 * uses a transparent body so no dark border bleeds through.
 */

type AdSize = "970x250" | "320x100" | "340x420" | "300x250" | "300x600" | "400x400" | "728x90";

const aspects: Record<AdSize, string> = {
  "970x250": "970 / 250",
  "320x100": "320 / 100",
  "340x420": "340 / 420",
  "300x250": "300 / 250",
  "300x600": "300 / 600",
  "400x400": "1 / 1",
  "728x90":  "728 / 90",
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
        frameBorder="0"
        scrolling="no"
        style={{ border: 0, display: "block", aspectRatio: aspects[size], width: "100%" }}
        title="Stairway Mortgage"
        loading="lazy"
      />
    </div>
  );
}
