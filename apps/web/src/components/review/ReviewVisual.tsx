import type { ReviewPicture } from "@/lib/review-deck";

const SLEEP_BARS = [3, 2, 1, 2, 3, 2, 1, 1, 2, 3, 2, 1, 2, 2, 3, 2, 1, 2, 3, 3, 2, 1, 2, 3, 3, 2, 2, 1, 2, 3];

/**
 * The card's picture by kind (prototype `rvisual`): drawn shapes in the activity colour over a
 * neutral street pattern. Decorative only; it never shows a real place.
 */
export function ReviewVisual({ picture, startLabel, stopLabel }: { picture: ReviewPicture; startLabel?: string; stopLabel?: string }) {
  if (picture === "place" || picture === "suggestion") {
    return (
      <svg aria-hidden="true" preserveAspectRatio="xMidYMid slice" viewBox="0 0 640 260">
        <g className="df-rvis-street" strokeWidth="12" fill="none" strokeLinecap="round">
          <path d="M-10 190 C160 160 220 210 360 175 S560 140 660 160" />
          <path d="M180 -10 L220 280" />
          <path d="M470 -10 C455 80 500 150 485 280" />
        </g>
        <g className="df-rvis-lane" strokeWidth="5" fill="none">
          <path d="M-10 70 L660 95" />
          <path d="M60 -10 L90 280" />
          <path d="M330 -10 L340 280" />
          <path d="M590 -10 L575 280" />
        </g>
        <circle className="df-rvis-halo" cx="330" cy="125" r="78" strokeWidth="2" strokeDasharray="6 7" />
        <path className="df-rvis-fill" d="M330 82c-18 0-31 13-31 30 0 23 31 49 31 49s31-26 31-49c0-17-13-30-31-30z" />
        <circle className="df-rvis-hole" cx="330" cy="112" r="10" />
      </svg>
    );
  }
  if (picture === "workout") {
    return (
      <svg aria-hidden="true" preserveAspectRatio="xMidYMid slice" viewBox="0 0 640 260">
        <g className="df-rvis-lane" strokeWidth="6" fill="none">
          <path d="M-10 60 L660 85" />
          <path d="M120 -10 L150 280" />
          <path d="M500 -10 L470 280" />
        </g>
        <path
          className="df-rvis-stroke"
          d="M170 200 C200 110 270 180 310 120 S400 50 440 100 S490 190 420 210 S240 235 170 200Z"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="7"
        />
        <circle className="df-rvis-fill" cx="170" cy="200" r="11" />
        <circle className="df-rvis-hole" cx="170" cy="200" r="5" />
      </svg>
    );
  }
  if (picture === "sleep") {
    return (
      <svg aria-hidden="true" preserveAspectRatio="xMidYMid slice" viewBox="0 0 640 260">
        {SLEEP_BARS.map((bar, index) => (
          <rect
            className="df-rvis-fill"
            height={bar * 44}
            key={index}
            rx="5"
            style={{ fillOpacity: 0.4 + bar * 0.2 }}
            width="15"
            x={32 + index * 19.4}
            y={60 + (3 - bar) * 44}
          />
        ))}
        {startLabel ? <text className="df-rvis-label" x="32" y="44">{startLabel}</text> : null}
        {stopLabel ? <text className="df-rvis-label" textAnchor="end" x="608" y="44">{stopLabel}</text> : null}
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" preserveAspectRatio="xMidYMid slice" viewBox="0 0 640 260">
      <g className="df-rvis-lane" strokeWidth="6" fill="none">
        <path d="M-10 150 L660 125" />
        <path d="M220 -10 L240 280" />
        <path d="M430 -10 L420 280" />
      </g>
      <path className="df-rvis-stroke" d="M140 200 Q300 40 500 90" fill="none" strokeDasharray="2 14" strokeLinecap="round" strokeWidth="6" />
      <circle className="df-rvis-fill" cx="140" cy="200" r="15" />
      <text className="df-rvis-pin" textAnchor="middle" x="140" y="205">A</text>
      <circle className="df-rvis-fill" cx="500" cy="90" r="15" />
      <text className="df-rvis-pin" textAnchor="middle" x="500" y="95">B</text>
    </svg>
  );
}
