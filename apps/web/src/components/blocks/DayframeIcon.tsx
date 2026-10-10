import { DAYFRAME_GLYPHS, type DayframeGlyph } from "@dayframe/shared";

/**
 * One glyph from the shared Dayframe set (Lucide geometry: 24-unit grid, 2-unit round strokes),
 * drawn in the current text colour. Icons sit beside a visible label, so they are hidden from
 * assistive technology.
 */
export function DayframeIcon({
  className,
  glyph,
  size = 20,
  strokeWidth = 2
}: {
  className?: string;
  glyph: DayframeGlyph;
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      data-glyph={glyph}
      fill="none"
      focusable="false"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={size}
    >
      {DAYFRAME_GLYPHS[glyph].map(([Element, attributes], index) => (
        <Element key={index} {...attributes} />
      ))}
    </svg>
  );
}
