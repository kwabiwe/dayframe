import { memo, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Reanimated, { ReduceMotion, cancelAnimation, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useAppForeground } from "../../lib/appForeground";
import { BLOCKS_SPRING } from "../../lib/blocksMotion";
import { MOBILE_DISPLAY_FONT, MOBILE_TEXT_CAP } from "../../lib/mobileTypography";

// Cell sizes in em, from the prototype's odometer (design/blocks/assets/blocks.css .odo-*).
export const ODOMETER_EM = { digitWidth: 0.62, separatorWidth: 0.3, height: 1.04 } as const;
/**
 * Bricolage's natural line height. iOS centres a glyph in its line only when the line is at least
 * this tall, so each digit is laid out on a 1.2 em line and lifted into its 1.04 em slot.
 */
const FONT_LINE_EM = 1.2;
const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export type OdometerCell = { key: string; kind: "digit" | "separator"; value: string };

/**
 * The clock rolls only for an ordinary tick: one or two seconds on (a tick can land late). Any other
 * change sets every digit at rest instead, so the clock never rolls through time it was not showing:
 * the return to the app after time away, a refresh that corrects the start, a tick after a long stall.
 */
export function odometerTickRolls(previousSeconds: number | undefined, seconds: number | undefined) {
  if (previousSeconds === undefined || seconds === undefined) return true;
  const step = seconds - previousSeconds;
  return step >= 1 && step <= 2;
}

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
 *
 * Returning to the app (investigation 2026-10-13, TestFlight 117) remounts the digits at rest from
 * the current time, so the first frame back is right whatever state a roll was left in while the
 * app was away, and a jump of more than two seconds never rolls (`odometerTickRolls`).
 */
export function LiveOdometer({
  baseSize = 58,
  color,
  label,
  reduceMotion,
  seconds,
}: {
  baseSize?: number;
  color: string;
  label: string;
  reduceMotion: boolean;
  /** The elapsed seconds the label shows; a change other than an ordinary tick sets the digits at rest. */
  seconds?: number;
}) {
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState<number | null>(null);
  const size = odometerFontSize({ baseSize, fontScale, label, width });
  const cellHeight = Math.round(size * ODOMETER_EM.height * 10) / 10;
  // The seconds of the last committed render (set after commit, so a discarded render never counts).
  const shownSeconds = useRef(seconds);
  const roll = odometerTickRolls(shownSeconds.current, seconds);
  useEffect(() => {
    shownSeconds.current = seconds;
  });
  const foreground = useAppForeground();
  const [restGeneration, setRestGeneration] = useState(0);
  const wasForeground = useRef(foreground);
  useEffect(() => {
    if (foreground && !wasForeground.current) setRestGeneration((generation) => generation + 1);
    wasForeground.current = foreground;
  }, [foreground]);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={styles.track}
      testID="today-live-odometer"
    >
      <View key={restGeneration} style={[styles.row, { height: cellHeight }]}>
        {odometerCells(label).map((cell) =>
          cell.kind === "digit" ? (
            <OdometerDigit
              cellHeight={cellHeight}
              color={color}
              digit={Number(cell.value)}
              key={cell.key}
              reduceMotion={reduceMotion}
              roll={roll}
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
  roll,
  size,
}: {
  cellHeight: number;
  color: string;
  digit: number;
  reduceMotion: boolean;
  /** False when the clock jumped rather than ticked: the digit is set at rest instead of rolling. */
  roll: boolean;
  size: number;
}) {
  const offset = useSharedValue(stripOffset(digit, cellHeight));
  const placed = useRef({ cellHeight, digit });

  useEffect(() => {
    const previous = placed.current;
    if (previous.digit === digit && previous.cellHeight === cellHeight) return;
    placed.current = { cellHeight, digit };
    const target = stripOffset(digit, cellHeight);
    // A new cell size (Dynamic Type, a narrower card) or a jump re-places the strip; it never rolls.
    if (reduceMotion || !roll || previous.cellHeight !== cellHeight) {
      cancelAnimation(offset);
      offset.value = target;
      return;
    }
    offset.value = withSpring(target, { ...BLOCKS_SPRING.roll, reduceMotion: ReduceMotion.Never });
    // `roll` only qualifies a change of digit; it is read with it, not watched on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellHeight, digit, offset, reduceMotion]);

  useEffect(() => () => cancelAnimation(offset), [offset]);

  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));
  const lineHeight = size * FONT_LINE_EM;
  const textStyle = [styles.digit, { color, fontSize: size, height: lineHeight, lineHeight, top: (cellHeight - lineHeight) / 2 }];

  return (
    <View style={[styles.digitCell, { height: cellHeight, width: size * ODOMETER_EM.digitWidth }]}>
      <Reanimated.View style={[styles.strip, stripStyle]}>
        {DIGITS.map((value) => (
          <View key={value} style={{ height: cellHeight }}>
            <Text allowFontScaling={false} style={textStyle}>
              {value}
            </Text>
          </View>
        ))}
      </Reanimated.View>
    </View>
  );
});

function OdometerSeparator({ color, size, value }: { color: string; size: number; value: string }) {
  const width = size * ODOMETER_EM.separatorWidth;
  if (value !== ":") {
    return (
      <Text allowFontScaling={false} style={[styles.digit, styles.separatorText, { color, fontSize: size, lineHeight: size * FONT_LINE_EM, width }]}>
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
