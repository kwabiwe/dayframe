import { InsetDivider } from "../InsetDivider";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Reanimated from "react-native-reanimated";
import { activityMarkerRadius, blockColorsFor } from "@dayframe/shared";
import { useIntrinsicTextMeasure } from "../accessibility/IntrinsicTextMeasure";
import type { MobileTheme } from "../../lib/mobileTheme";
import { localPresenceEntering, localPresenceExiting } from "../../lib/motion";
import { MOBILE_TEXT_CAP, mobileTextProps } from "../../lib/mobileTypography";
import {
  WHERE_WENT_SLOTS,
  whereWentEntranceAllowed,
  type TodayWhereWentModel,
  type WhereWentSegment,
} from "../../lib/todayWhereWent";

const BAR_HEIGHT = 12;
const BAR_RADIUS = 4;
const BAR_GAP = 2;
const MIN_SEGMENT = 3;
const LIVE_EDGE = 2;
const MARKER = 10;
/** Between the marker, the name and the duration. */
const ITEM_GAP = 8;
const COLUMN_GAP = 18;
/** Today's longest duration, measured once per text size so the legend never re-measures on the minute. */
const DURATION_SAMPLE = "23h 59m";
/** The least of a name a two-column legend keeps beside its duration before it drops to one column. */
const NAME_SAMPLE = "Mmmm";

/**
 * "Where today went" (PRD D15, option A): the bottom of the Today ribbon card, under one hairline.
 * A 12-point proportional bar of today's covered time per activity (largest first, solid display
 * colours, Other neutral and last) over a fixed four-slot legend, all one button that opens Reports
 * on Today. Memoised: its model changes on the per-minute clock, never on the 1 s tick. No motion
 * of its own beyond a presence fade when it appears or goes mid-session (motion.md).
 */
export const TodayWhereWent = memo(function TodayWhereWent({
  model,
  onOpen,
  quiet,
  reduceMotion,
  theme,
}: {
  model: TodayWhereWentModel | null;
  onOpen: () => void;
  /** The commit that brought this model came from a load (hydration, cached launch, refresh): no fade. */
  quiet: boolean;
  reduceMotion: boolean;
  theme: MobileTheme;
}) {
  // No entrance on first paint, a cached launch, hydration or a refresh; a strip that appears later
  // in the session fades in (90 ms under Reduce Motion) and fades out (70 ms) when the day empties.
  const painted = useRef(false);
  useEffect(() => {
    painted.current = true;
  }, []);
  const entering = useMemo(() => localPresenceEntering(reduceMotion), [reduceMotion]);
  const exiting = useMemo(() => localPresenceExiting(reduceMotion), [reduceMotion]);
  if (!model) return null;
  return (
    <Reanimated.View
      entering={whereWentEntranceAllowed({ painted: painted.current, quiet }) ? entering : undefined}
      exiting={exiting}
      testID="today-where-went-presence"
    >
      <WhereWentButton model={model} onOpen={onOpen} theme={theme} />
    </Reanimated.View>
  );
});

function WhereWentButton({ model, onOpen, theme }: { model: TodayWhereWentModel; onOpen: () => void; theme: MobileTheme }) {
  const [legendWidth, setLegendWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
  const duration = useIntrinsicTextMeasure([DURATION_SAMPLE], styles.duration, MOBILE_TEXT_CAP.numeric, "where-went-duration");
  const name = useIntrinsicTextMeasure([NAME_SAMPLE], styles.name, MOBILE_TEXT_CAP.itemTitle, "where-went-name");
  const durationWidth = duration.widths[DURATION_SAMPLE];
  const nameWidth = name.widths[NAME_SAMPLE];
  // Two columns while a marker, a few letters of the name and the longest duration fit in each;
  // until measured, the capped text scale decides. Durations never truncate; only names do.
  const columns = whereWentColumns({ durationWidth, fontScale, legendWidth, nameWidth });
  const slots: Array<WhereWentSegment | null> = Array.from({ length: WHERE_WENT_SLOTS }, (_, index) => model.segments[index] ?? null);
  const rows = columns === 2 ? [slots.slice(0, 2), slots.slice(2, 4)] : slots.map((slot) => [slot]);

  return (
    <Pressable
      accessibilityHint="Opens Reports for today"
      accessibilityLabel={model.accessibilityLabel}
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
      testID="today-where-went"
    >
      <View style={styles.head}>
        <Text {...mobileTextProps("sectionHeading")} style={[styles.heading, { color: theme.textPrimary }]}>
          Where today went
        </Text>
        <Text {...mobileTextProps("metadata")} style={[styles.link, { color: theme.textSecondary }]}>
          Reports ›
        </Text>
      </View>
      <View style={styles.bar} testID="today-where-went-bar">
        {model.segments.map((segment) => (
          <View
            key={segment.key}
            style={[
              styles.segment,
              { backgroundColor: segmentFill(segment, theme), flexGrow: segment.seconds },
              segment.live ? [styles.live, { borderRightColor: theme.accent }] : null,
            ]}
            testID={`today-where-went-segment-${segment.key}`}
          />
        ))}
      </View>
      <View onLayout={(event) => setLegendWidth(Math.floor(event.nativeEvent.layout.width))} style={styles.legend} testID="today-where-went-legend">
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.legendRow}>
            {row.map((segment, index) => (
              <LegendItem key={segment?.key ?? `empty-${rowIndex}-${index}`} segment={segment} theme={theme} />
            ))}
          </View>
        ))}
      </View>
      {duration.probe}
      {name.probe}
      <InsetDivider color={theme.border} edge="top" paddedBy="src/components/today/TodayRibbon.tsx:card" />
    </Pressable>
  );
}

/** One legend slot; an empty slot keeps its height so a re-ranking never resizes the card. */
function LegendItem({ segment, theme }: { segment: WhereWentSegment | null; theme: MobileTheme }) {
  return (
    <View style={[styles.item, segment ? null : styles.empty]} testID={segment ? `today-where-went-item-${segment.key}` : "today-where-went-item-empty"}>
      <View
        style={[
          styles.marker,
          { backgroundColor: segment ? segmentFill(segment, theme) : "transparent", borderRadius: activityMarkerRadius(MARKER) },
        ]}
      />
      <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={[styles.name, { color: theme.textSecondary }]}>
        {segment?.name ?? " "}
      </Text>
      <Text {...mobileTextProps("numeric")} style={[styles.duration, { color: theme.textPrimary }]}>
        {segment?.duration ?? " "}
      </Text>
    </View>
  );
}

function segmentFill(segment: WhereWentSegment, theme: MobileTheme) {
  // No activity and Other are neutral, as on the ribbon and web's "Other" bar.
  return segment.color ? blockColorsFor(segment.color, theme.mode).fill : theme.textMuted;
}

/**
 * The legend's columns: two while each half holds a marker, the name sample and the longest
 * duration; one otherwise. Before the native measurement lands, the capped text scale decides.
 */
export function whereWentColumns({
  durationWidth,
  fontScale,
  legendWidth,
  nameWidth,
}: {
  durationWidth?: number;
  fontScale: number;
  legendWidth: number;
  nameWidth?: number;
}): 1 | 2 {
  if (!legendWidth || !durationWidth || !nameWidth) return Math.min(fontScale, MOBILE_TEXT_CAP.itemTitle) >= 1.3 ? 1 : 2;
  const column = (legendWidth - COLUMN_GAP) / 2;
  return MARKER + ITEM_GAP + nameWidth + ITEM_GAP + durationWidth <= column ? 2 : 1;
}

const styles = StyleSheet.create({
  button: { marginTop: 8, minHeight: 44, paddingBottom: 4, paddingTop: 12 },
  pressed: { opacity: 0.72 },
  head: { alignItems: "baseline", columnGap: 10, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", minHeight: 22 },
  heading: { flexShrink: 1, fontSize: 15, fontWeight: "600" },
  link: { fontSize: 13 },
  bar: { columnGap: BAR_GAP, flexDirection: "row", height: BAR_HEIGHT, marginVertical: 10 },
  segment: { borderRadius: BAR_RADIUS, flexBasis: 0, minWidth: MIN_SEGMENT },
  live: { borderRightWidth: LIVE_EDGE },
  legend: { paddingBottom: 6, rowGap: 6 },
  legendRow: { columnGap: COLUMN_GAP, flexDirection: "row" },
  item: { alignItems: "center", columnGap: ITEM_GAP, flex: 1, flexDirection: "row", minHeight: 22, minWidth: 0 },
  empty: { opacity: 0 },
  marker: { height: MARKER, width: MARKER },
  name: { flex: 1, fontSize: 14, minWidth: 0 },
  duration: { flexShrink: 0, fontSize: 14, fontVariant: ["tabular-nums"], fontWeight: "600" },
});
