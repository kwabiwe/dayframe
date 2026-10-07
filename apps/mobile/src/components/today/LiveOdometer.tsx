import { memo, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Reanimated, { ReduceMotion, cancelAnimation, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { BLOCKS_SPRING } from "../../lib/blocksMotion";
import { MOBILE_DISPLAY_FONT, MOBILE_TEXT_CAP } from "../../lib/mobileTypography";

// Cell sizes in em, from the prototype's odometer (design/blocks/assets/blocks.css .odo-*).
export const ODOMETER_EM = { digitWidth: 0.62, separatorWidth: 0.3, height: 1.04 } as const;
const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export type OdometerCell = { key: string; kind: "digit" | "separator"; value: string };

/**
 * Splits a clock label into fixed cells keyed from the right, so seconds stay seconds when the
 * hours gain a digit (9:59:59 → 10:00:00) and only the new leading digit mounts.
 */
export function odometerCells(label: string): OdometerCell[] {
  const chars = [...label];
  return chars.map((value, index) => ({
    key: `cell-${chars.length - 1 - index}`,
    kind: /\d/.test(value) ? "digit" : "separator",
    value,
  }));
}

/**
 * The timer's font size: the display size scaled with Dynamic Type up to the numeric cap, then
 * shrunk only as far as needed for the whole clock to fit the measured width (never clipped,
 * never wrapped).
 */
export function odometerFontSize({
  baseSize,
  fontScale,
  label,
  width,
}: {
  baseSize: number;
  fontScale: number;
  label: string;
  width: number | null;
}) {
  const scaled = baseSize * Math.min(Math.max(fontScale, 1), MOBILE_TEXT_CAP.numeric);
  if (!width) return scaled;
  const ems = odometerCells(label).reduce(
    (sum, cell) => sum + (cell.kind === "digit" ? ODOMETER_EM.digitWidth : ODOMETER_EM.separatorWidth),
    0
  );
  return ems > 0 ? Math.min(scaled, Math.floor((width / ems) * 10) / 10) : scaled;
}

/**
 * The live timer's rolling digits (Blocks `roll` spring). Each digit is a fixed cell holding a
 * 0–9 strip; only digits whose value changed move, on the UI thread, so the clock never jitters.
 * Reduce Motion sets each digit in place. VoiceOver reads the card's spoken duration instead.
 */
export function LiveOdometer({
  baseSize = 58,
  color,
  label,
  reduceMotion,
}: {
  baseSize?: number;
  color: string;
  label: string;
  reduceMotion: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState<number | null>(null);
  const size = odometerFontSize({ baseSize, fontScale, label, width });
  const cellHeight = Math.round(size * ODOMETER_EM.height * 10) / 10;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={styles.track}
      testID="today-live-odometer"
    >
      <View style={[styles.row, { height: cellHeight }]}>
        {odometerCells(label).map((cell) =>
          cell.kind === "digit" ? (
            <OdometerDigit
              cellHeight={cellHeight}
              color={color}
              digit={Number(cell.value)}
              key={cell.key}
              reduceMotion={reduceMotion}
              size={size}
            />
          ) : (
            <OdometerSeparator color={color} key={cell.key} size={size} value={cell.value} />
          )
        )}
      </View>
    </View>
  );
}

function stripOffset(digit: number, cellHeight: number) {
  return digit === 0 ? 0 : -digit * cellHeight;
}

const OdometerDigit = memo(function OdometerDigit({
  cellHeight,
  color,
  digit,
  reduceMotion,
  size,
}: {
  cellHeight: number;
  color: string;
  digit: number;
  reduceMotion: boolean;
  size: number;
}) {
  const offset = useSharedValue(stripOffset(digit, cellHeight));
  const placed = useRef({ cellHeight, digit });

  useEffect(() => {
    const previous = placed.current;
    if (previous.digit === digit && previous.cellHeight === cellHeight) return;
    placed.current = { cellHeight, digit };
    const target = stripOffset(digit, cellHeight);
    // A new cell size (Dynamic Type, a narrower card) re-places the strip; it never rolls.
    if (reduceMotion || previous.cellHeight !== cellHeight) {
      cancelAnimation(offset);
      offset.value = target;
      return;
    }
    offset.value = withSpring(target, { ...BLOCKS_SPRING.roll, reduceMotion: ReduceMotion.Never });
  }, [cellHeight, digit, offset, reduceMotion]);

  useEffect(() => () => cancelAnimation(offset), [offset]);

  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));
  const textStyle = [styles.digit, { color, fontSize: size, height: cellHeight, lineHeight: cellHeight }];

  return (
    <View style={[styles.digitCell, { height: cellHeight, width: size * ODOMETER_EM.digitWidth }]}>
      <Reanimated.View style={[styles.strip, stripStyle]}>
        {DIGITS.map((value) => (
          <Text allowFontScaling={false} key={value} style={textStyle}>
            {value}
          </Text>
        ))}
      </Reanimated.View>
    </View>
  );
});

function OdometerSeparator({ color, size, value }: { color: string; size: number; value: string }) {
  const width = size * ODOMETER_EM.separatorWidth;
  if (value !== ":") {
    return (
      <Text allowFontScaling={false} style={[styles.digit, styles.separatorText, { color, fontSize: size, width }]}>
        {value}
      </Text>
    );
  }
  const dot = size * 0.11;
  return (
    <View style={[styles.separator, { gap: size * 0.2, width }]}>
      <View style={{ backgroundColor: color, borderRadius: dot / 2, height: dot, width: dot }} />
      <View style={{ backgroundColor: color, borderRadius: dot / 2, height: dot, width: dot }} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { alignSelf: "stretch" },
  row: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row" },
  digitCell: { overflow: "hidden" },
  strip: { left: 0, position: "absolute", right: 0, top: 0 },
  digit: {
    fontFamily: MOBILE_DISPLAY_FONT.bold,
    fontVariant: ["tabular-nums"],
    includeFontPadding: false,
    textAlign: "center",
  },
  separatorText: { opacity: 0.5 },
  separator: { alignItems: "center", alignSelf: "stretch", justifyContent: "center", opacity: 0.5 },
});
