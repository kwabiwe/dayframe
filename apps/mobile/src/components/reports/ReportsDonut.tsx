import { memo, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { compactDuration, spokenDuration } from "../today/todayBlocksLayout";
import { playHaptic } from "../../lib/haptics";
import type { MobileTheme } from "../../lib/mobileTheme";
import { MOBILE_DISPLAY_FONT, mobileTextProps } from "../../lib/mobileTypography";

// Blocks Reports donut and activity rows (design/blocks/ios.html, donut-card / cat-rows / wireDonut).
// The ring and the rows share one highlighted ("hot") activity: slide a finger around the ring, tap a
// row, or step through with VoiceOver. Nothing here filters; the filter sheet stays the only filter.

export type ReportDonutSegment = {
  key: string;
  name: string;
  seconds: number;
  color: string;
};

const SIZE = 168;
const STROKE = 24;
const HOT_STROKE = 30;
const GAP = 2.2;
// Leaves room for the thicker highlighted arc inside the drawing.
const RADIUS = (SIZE - HOT_STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Which segment lies under an angle measured clockwise from 12 o'clock (0–1 of a turn). */
export function donutSegmentAt(segments: readonly ReportDonutSegment[], turn: number) {
  const total = segments.reduce((sum, segment) => sum + segment.seconds, 0);
  if (total <= 0) return null;
  let accumulated = 0;
  for (const segment of segments) {
    accumulated += segment.seconds / total;
    if (turn <= accumulated + 1e-9) return segment.key;
  }
  return segments[segments.length - 1]?.key ?? null;
}

/** The turn (0–1, clockwise from 12 o'clock) of a point relative to the ring's centre. */
export function donutTurn(x: number, y: number, size = SIZE) {
  let angle = Math.atan2(y - size / 2, x - size / 2) + Math.PI / 2;
  if (angle < 0) angle += 2 * Math.PI;
  return angle / (2 * Math.PI);
}

export function reportPercent(seconds: number, total: number) {
  const percent = total > 0 ? (seconds / total) * 100 : 0;
  return percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}

export const ReportDonutCard = memo(function ReportDonutCard({
  empty,
  numberWidths,
  periodLabel,
  segments,
  theme,
  totalSeconds,
}: {
  /** Shown instead of the rows when nothing is selected or nothing was framed. */
  empty: string | null;
  numberWidths: { duration: number; percent: number; fontSize: number; gap: number };
  periodLabel: string;
  segments: readonly ReportDonutSegment[];
  theme: MobileTheme;
  totalSeconds: number;
}) {
  const [hot, setHot] = useState<string | null>(null);
  const hotRef = useRef<string | null>(null);
  const segmentKeys = segments.map((segment) => segment.key).join("|");
  // A range or filter change that removes the highlighted activity clears the highlight.
  useEffect(() => {
    if (hotRef.current && !segments.some((segment) => segment.key === hotRef.current)) {
      hotRef.current = null;
      setHot(null);
    }
  }, [segmentKeys]);
  const choose = (key: string | null) => {
    if (key === hotRef.current) return;
    hotRef.current = key;
    setHot(key);
    if (key) playHaptic("tick");
  };
  const scrub = (event: GestureResponderEvent) => {
    const { locationX, locationY } = event.nativeEvent;
    choose(donutSegmentAt(segments, donutTurn(locationX, locationY)));
  };
  const hotSegment = segments.find((segment) => segment.key === hot) ?? null;
  const total = segments.reduce((sum, segment) => sum + segment.seconds, 0);
  let offset = 0;
  const arcs = segments.map((segment) => {
    const length = total > 0 ? (segment.seconds / total) * CIRCUMFERENCE : 0;
    const visible = Math.max(0.01, length - (segments.length > 1 ? GAP : 0));
    const arc = { segment, visible, offset };
    offset += length;
    return arc;
  });
  const centerValue = compactDuration(hotSegment ? hotSegment.seconds : totalSeconds);
  const centerLabel = hotSegment ? `${hotSegment.name} · ${reportPercent(hotSegment.seconds, total)}` : periodLabel;
  const step = (direction: 1 | -1) => {
    if (!segments.length) return;
    const index = segments.findIndex((segment) => segment.key === hotRef.current);
    const next = index < 0 ? (direction > 0 ? 0 : segments.length - 1) : index + direction;
    choose(next < 0 || next >= segments.length ? null : segments[next].key);
  };
  return (
    <>
    <View style={[styles.card, { backgroundColor: theme.surface }]} testID="reports-donut-card">
      <View style={styles.donutRow}>
        <View
          accessible
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          accessibilityHint="Swipe up or down to read each activity."
          accessibilityLabel="Activity breakdown"
          accessibilityRole="adjustable"
          accessibilityValue={{
            text: hotSegment
              ? `${hotSegment.name}, ${spokenDuration(hotSegment.seconds)}, ${reportPercent(hotSegment.seconds, total)}`
              : `${periodLabel}, ${spokenDuration(totalSeconds)}, ${segments.length} ${segments.length === 1 ? "activity" : "activities"}`,
          }}
          onAccessibilityAction={(event) => step(event.nativeEvent.actionName === "increment" ? 1 : -1)}
          onMoveShouldSetResponder={() => segments.length > 0}
          onResponderGrant={scrub}
          onResponderMove={scrub}
          onResponderTerminationRequest={() => false}
          onStartShouldSetResponder={() => segments.length > 0}
          style={styles.donut}
          testID="reports-donut"
        >
          <Svg height={SIZE} pointerEvents="none" viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE}>
            <Circle cx={SIZE / 2} cy={SIZE / 2} fill="none" r={RADIUS} stroke={theme.surfaceMuted} strokeWidth={STROKE} />
            {arcs.map(({ segment, visible, offset: start }) => {
              const isHot = segment.key === hot;
              return (
                <Circle
                  key={segment.key}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  fill="none"
                  opacity={hot && !isHot ? 0.35 : 1}
                  r={RADIUS}
                  stroke={segment.color}
                  strokeDasharray={`${visible} ${CIRCUMFERENCE - visible}`}
                  strokeDashoffset={-start}
                  strokeWidth={isHot ? HOT_STROKE : STROKE}
                  transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                />
              );
            })}
          </Svg>
          <View pointerEvents="none" style={styles.center}>
            <Text
              {...mobileTextProps("counter")}
              adjustsFontSizeToFit
              numberOfLines={1}
              style={[styles.centerValue, { color: theme.textPrimary }]}
              testID="reports-donut-value"
            >
              {centerValue}
            </Text>
            <Text
              {...mobileTextProps("metadata")}
              numberOfLines={1}
              style={[styles.centerLabel, { color: theme.textSecondary }]}
              testID="reports-donut-label"
            >
              {centerLabel}
            </Text>
          </View>
        </View>
        <Text {...mobileTextProps("metadata")} style={[styles.hint, { color: theme.textSecondary }]}>
          Slide your finger around the ring to read each activity.
        </Text>
      </View>
      {empty ? (
        <Text {...mobileTextProps("metadata")} style={{ color: theme.textSecondary }}>
          {empty}
        </Text>
      ) : null}
    </View>
      {segments.length ? (
        <View style={[styles.rows, { backgroundColor: theme.surface }]} testID="reports-activity-rows">
          {segments.map((segment, index) => {
            const isHot = segment.key === hot;
            const percent = reportPercent(segment.seconds, total);
            return (
              <Pressable
                key={segment.key}
                accessibilityHint={isHot ? "Shows the total again" : "Highlights it in the ring"}
                accessibilityLabel={`${segment.name}, ${percent} of selected time, ${spokenDuration(segment.seconds)}`}
                accessibilityRole="button"
                accessibilityState={{ selected: isHot }}
                onPress={() => choose(isHot ? null : segment.key)}
                style={[
                  styles.row,
                  { gap: numberWidths.gap },
                  index ? { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth } : null,
                  isHot ? { backgroundColor: theme.surfaceMuted } : null,
                ]}
                testID={`reports-activity-${segment.key}`}
              >
                <View style={[styles.swatch, { backgroundColor: segment.color }]} />
                <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={[styles.rowName, { color: theme.textPrimary }]}>
                  {segment.name}
                </Text>
                <Text
                  {...mobileTextProps("numeric")}
                  numberOfLines={1}
                  style={[styles.rowNumber, { color: theme.textPrimary, fontSize: numberWidths.fontSize, width: numberWidths.duration }]}
                >
                  {compactDuration(segment.seconds)}
                </Text>
                <Text
                  {...mobileTextProps("numeric")}
                  numberOfLines={1}
                  style={[styles.rowNumber, { color: theme.textMuted, fontSize: numberWidths.fontSize - 1.5, width: numberWidths.percent }]}
                >
                  {percent}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </>
  );
});

const styles = StyleSheet.create({
  card: { borderRadius: 22, padding: 16, gap: 14 },
  donutRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 16 },
  donut: { width: SIZE, height: SIZE },
  center: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", paddingHorizontal: 34 },
  centerValue: { fontFamily: MOBILE_DISPLAY_FONT.extraBold, fontSize: 24, fontVariant: ["tabular-nums"], letterSpacing: -0.5 },
  centerLabel: { fontSize: 11.5, fontWeight: "600", maxWidth: 96 },
  hint: { flex: 1, minWidth: 120, fontSize: 13 },
  rows: { borderRadius: 22, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", minHeight: 44, paddingHorizontal: 16, paddingVertical: 6 },
  swatch: { width: 14, height: 14, borderRadius: 4 },
  rowName: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: "600" },
  rowNumber: { flexShrink: 0, textAlign: "right", fontVariant: ["tabular-nums"], fontWeight: "600" },
});
