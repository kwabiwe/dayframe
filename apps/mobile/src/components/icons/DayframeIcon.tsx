import { memo } from "react";
import Svg, { Circle, Ellipse, Line, Path, Polygon, Polyline, Rect } from "react-native-svg";
import {
  DAYFRAME_GLYPHS,
  resolveActivityIcon,
  type DayframeGlyph,
  type DayframeGlyphElement,
} from "@dayframe/shared";

const ELEMENTS: Record<DayframeGlyphElement, typeof Path> = {
  circle: Circle as unknown as typeof Path,
  ellipse: Ellipse as unknown as typeof Path,
  line: Line as unknown as typeof Path,
  path: Path,
  polygon: Polygon as unknown as typeof Path,
  polyline: Polyline as unknown as typeof Path,
  rect: Rect as unknown as typeof Path,
};

/**
 * One glyph from the shared Dayframe set (Lucide geometry: 24-point grid, 2-point round strokes).
 * Icons are decorative: they always sit beside a visible label, so they are hidden from VoiceOver.
 */
export const DayframeIcon = memo(function DayframeIcon({
  color,
  glyph,
  size = 20,
  strokeWidth = 2,
  testID,
}: {
  color: string;
  glyph: DayframeGlyph;
  size?: number;
  strokeWidth?: number;
  testID?: string;
}) {
  const nodes = DAYFRAME_GLYPHS[glyph];
  return (
    <Svg
      accessibilityElementsHidden
      accessible={false}
      fill="none"
      height={size}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      testID={testID}
      viewBox="0 0 24 24"
      width={size}
    >
      {nodes.map(([element, glyphAttributes], index) => {
        const attributes: Readonly<Record<string, string>> = glyphAttributes;
        const Element = ELEMENTS[element];
        // A few glyphs carry small filled dots ("currentColor"); draw them as given.
        const fill = attributes.fill === "currentColor" ? color : attributes.fill;
        return <Element key={index} {...attributes} fill={fill} />;
      })}
    </Svg>
  );
});

/** An activity's icon: its stored Dayframe key, else a name match, else the neutral dot. */
export function ActivityIcon({
  color,
  icon,
  name,
  size,
  testID,
}: {
  color: string;
  icon?: string | null;
  name?: string | null;
  size?: number;
  testID?: string;
}) {
  return <DayframeIcon color={color} glyph={resolveActivityIcon({ icon, name }).glyph} size={size} testID={testID} />;
}
