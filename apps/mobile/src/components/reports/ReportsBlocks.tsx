import { memo, useEffect, useState, type Ref } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Reanimated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type EntryAnimationsValues,
} from "react-native-reanimated";
import { DayframeIcon } from "../icons/DayframeIcon";
import { colorWithAlpha, spokenDuration } from "../today/todayBlocksLayout";
import { BLOCKS_SPRING } from "../../lib/blocksMotion";
import type { MobileTheme } from "../../lib/mobileTheme";
import { localPresenceEntering } from "../../lib/motion";
import { MOBILE_DISPLAY_FONT, mobileTextProps } from "../../lib/mobileTypography";
import { monthGridLeadingBlanks, reportStackHeights } from "../../lib/reportsBlocks";
import type { ReportRangeChoice } from "../../lib/reportsRanges";

// Blocks Reports (design/blocks/ios.html, renderReports): range switch, hero total, week columns,
// month grid and goal streak. ReportsTab owns data, ranges, sheets and the focused day.

export type ReportDayStack = {
  key: string;
  start: Date;
  seconds: number;
  segments: readonly { key: string; seconds: number; color: string }[];
};

const WEEK_COLUMN_HEIGHT = 170;
// Leaves the top 15 points of a 44-point cell to the date number.
const MONTH_STACK_HEIGHT = 24;

/** Week · Month, with "More" for Today, Year and custom ranges (owner decision D9). */
export function ReportRangeSwitch({
  choice,
  moreAccessibilityLabel,
  moreLabel,
  moreRef,
  onChoose,
  onMore,
  reduceMotion,
  theme,
}: {
  choice: ReportRangeChoice;
  /** The full range ("Choose report dates, 1 Oct 2026 – 5 Oct 2026") when More holds the range. */
  moreAccessibilityLabel: string;
  moreLabel: string;
  moreRef?: Ref<View>;
  onChoose: (value: "week" | "month") => void;
  onMore: () => void;
  reduceMotion: boolean;
  theme: MobileTheme;
}) {
  const selected = choice === "week" ? 0 : choice === "month" ? 1 : 2;
  const [frames, setFrames] = useState<Array<{ x: number; width: number } | undefined>>([]);
  const x = useSharedValue(0);
  const width = useSharedValue(0);
  const frame = frames[selected];
  useEffect(() => {
    if (!frame) return;
    // The first measurement places the thumb; later choices slide it (Reduce Motion: in place).
    if (width.value === 0 || reduceMotion) {
      x.value = frame.x;
      width.value = frame.width;
      return;
    }
    const spring = { ...BLOCKS_SPRING.control, reduceMotion: ReduceMotion.Never };
    x.value = withSpring(frame.x, spring);
    width.value = withSpring(frame.width, spring);
  }, [frame?.x, frame?.width, reduceMotion]);
  const thumb = useAnimatedStyle(() => ({ opacity: width.value ? 1 : 0, transform: [{ translateX: x.value }], width: width.value }));
  const measure = (index: number) => (event: LayoutChangeEvent) => {
    const { x: left, width: measured } = event.nativeEvent.layout;
    setFrames((current) => {
      if (current[index]?.x === left && current[index]?.width === measured) return current;
      const next = [...current];
      next[index] = { x: left, width: measured };
      return next;
    });
  };
  const segment = (index: number, label: string, onPress: () => void, accessibilityLabel: string, ref?: Ref<View>) => (
    <Pressable
      ref={ref}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ selected: selected === index }}
      onLayout={measure(index)}
      onPress={onPress}
      style={styles.segment}
      testID={`reports-range-${index === 0 ? "week" : index === 1 ? "month" : "more"}`}
    >
      <Text
        {...mobileTextProps("control")}
        ellipsizeMode="tail"
        numberOfLines={1}
        testID={index === 2 ? "reports-range-label" : undefined}
        style={[styles.segmentLabel, { color: selected === index ? theme.textPrimary : theme.textSecondary }]}
      >
        {label}
      </Text>
    </Pressable>
  );
  return (
    // Prototype .seg: an inset track with a lighter thumb in both themes.
    <View style={[styles.switch, { backgroundColor: theme.mode === "dark" ? theme.surfaceInset : theme.surfaceMuted }]}>
      <Reanimated.View
        pointerEvents="none"
        style={[styles.thumb, { backgroundColor: theme.mode === "dark" ? theme.surfaceMuted : theme.surface }, thumb]}
      />
      {segment(0, "Week", () => onChoose("week"), "This week")}
      {segment(1, "Month", () => onChoose("month"), "This month")}
      {segment(2, moreLabel, onMore, selected === 2 ? moreAccessibilityLabel : "More ranges: today, year or chosen dates", moreRef)}
    </View>
  );
}

/** The big total with "framed this week" and the change against the same stretch last time. */
export function ReportHero({
  delta,
  focusLabel,
  period,
  spokenTotal,
  theme,
  total,
}: {
  delta: { text: string; spoken: string } | null;
  focusLabel: string | null;
  period: string;
  spokenTotal: string;
  theme: MobileTheme;
  total: string;
}) {
  const words = focusLabel ? `on ${focusLabel}` : `framed ${period}`;
  return (
    <View
      accessible
      accessibilityLabel={`${spokenTotal} ${words}${delta && !focusLabel ? `. ${delta.spoken}` : ""}`}
      accessibilityLiveRegion="polite"
      style={styles.hero}
      testID="reports-hero"
    >
      <Text
        {...mobileTextProps("counter")}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        numberOfLines={1}
        style={[styles.heroNumber, { color: theme.textPrimary }]}
        testID="reports-hero-total"
      >
        {total}
      </Text>
      <View style={styles.heroLine}>
        <Text {...mobileTextProps("metadata")} style={[styles.heroWords, { color: theme.textSecondary }]}>
          {words}
        </Text>
        {delta && !focusLabel ? (
          <Text
            {...mobileTextProps("metadata")}
            style={[styles.delta, { backgroundColor: theme.surfaceMuted, color: theme.textPrimary }]}
            testID="reports-delta"
          >
            {delta.text}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** First paint only: each block grows from the bottom with the landing spring, 14 ms apart. */
function growEntering(delay: number) {
  return (values: EntryAnimationsValues) => {
    "worklet";
    const spring = { ...BLOCKS_SPRING.land, reduceMotion: ReduceMotion.Never };
    return {
      initialValues: { opacity: 0, transform: [{ translateY: values.targetHeight / 2 }, { scaleY: 0 }] },
      animations: {
        opacity: withDelay(delay, withTiming(1, { duration: 120, reduceMotion: ReduceMotion.Never })),
        transform: [
          { translateY: withDelay(delay, withSpring(0, spring)) },
          { scaleY: withDelay(delay, withSpring(1, spring)) },
        ],
      },
    };
  };
}

/** This week as seven columns of stacked activity blocks; tap a day to focus the total on it. */
export const ReportWeekColumns = memo(function ReportWeekColumns({
  animate,
  days,
  focusedKey,
  onFocus,
  theme,
  todayKey,
}: {
  animate: boolean;
  days: readonly ReportDayStack[];
  focusedKey: string | null;
  onFocus: (key: string | null) => void;
  theme: MobileTheme;
  todayKey: string;
}) {
  const busiest = Math.max(0, ...days.map((day) => day.seconds));
  let order = 0;
  return (
    <View
      accessibilityLabel="This week in blocks"
      style={[styles.weekCard, { backgroundColor: theme.surface }]}
      testID="reports-week-columns"
    >
      {days.map((day) => {
        const focused = focusedKey === day.key;
        const dimmed = focusedKey !== null && !focused;
        const heights = reportStackHeights(day.segments.map((s) => s.seconds), busiest, WEEK_COLUMN_HEIGHT, 6);
        const name = day.start.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
        return (
          <Pressable
            key={day.key}
            accessibilityHint={focused ? "Shows the whole range again" : "Shows this day's total"}
            accessibilityLabel={`${name}, ${day.seconds >= 60 ? spokenDuration(day.seconds) : "nothing framed"}`}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            onPress={() => onFocus(focused ? null : day.key)}
            style={styles.weekColumn}
            testID={`reports-week-day-${day.key}`}
          >
            <View style={[styles.weekStack, { opacity: dimmed ? 0.35 : 1 }]}>
              {day.segments.map((segment, index) => {
                const delay = order++ * 14;
                return (
                  <Reanimated.View
                    key={segment.key}
                    entering={animate ? growEntering(delay) : undefined}
                    style={[styles.weekBlock, { backgroundColor: segment.color, height: Math.max(3, heights[index] - 3) }]}
                  />
                );
              })}
            </View>
            <Text
              {...mobileTextProps("metadata")}
              style={[
                styles.weekLabel,
                { color: focused ? theme.textPrimary : day.key === todayKey ? theme.accent : theme.textMuted },
              ]}
            >
              {day.start.toLocaleDateString(undefined, { weekday: "narrow" })}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
});

/** The month as a Monday-first grid of days, each with its activities stacked from the bottom. */
export const ReportMonthGrid = memo(function ReportMonthGrid({
  days,
  theme,
  todayKey,
}: {
  days: readonly ReportDayStack[];
  theme: MobileTheme;
  todayKey: string;
}) {
  const first = days[0]?.start;
  if (!first) return null;
  const busiest = Math.max(0, ...days.map((day) => day.seconds));
  const blanks = monthGridLeadingBlanks(first);
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    new Date(2026, 0, 5 + index).toLocaleDateString(undefined, { weekday: "narrow" }),
  );
  return (
    <View
      accessibilityLabel={`${first.toLocaleDateString(undefined, { month: "long" })} in blocks`}
      style={[styles.monthCard, { backgroundColor: theme.surface }]}
      testID="reports-month-grid"
    >
      <View style={styles.monthRow}>
        {weekdays.map((label, index) => (
          <Text
            key={index}
            {...mobileTextProps("metadata")}
            accessible={false}
            style={[styles.monthDow, { color: theme.textMuted }]}
          >
            {label}
          </Text>
        ))}
      </View>
      <View style={styles.monthCells}>
        {Array.from({ length: blanks }, (_, index) => (
          <View key={`blank-${index}`} style={styles.monthCellSlot} />
        ))}
        {days.map((day) => {
          const heights = reportStackHeights(day.segments.map((s) => s.seconds), busiest, MONTH_STACK_HEIGHT, 2);
          return (
            <View key={day.key} style={styles.monthCellSlot}>
              <View
                accessible
                accessibilityLabel={`${day.start.toLocaleDateString(undefined, { day: "numeric", month: "long" })}, ${day.seconds >= 60 ? spokenDuration(day.seconds) : "nothing framed"}`}
                style={[
                  styles.monthCell,
                  { backgroundColor: theme.surfaceMuted },
                  day.key === todayKey ? { borderColor: theme.accent, borderWidth: 1.5 } : null,
                ]}
              >
                {day.segments.map((segment, index) => (
                  <View key={segment.key} style={[styles.monthBlock, { backgroundColor: segment.color, height: heights[index] }]} />
                ))}
                <Text
                  {...mobileTextProps("metadata")}
                  accessible={false}
                  maxFontSizeMultiplier={1.2}
                  style={[styles.monthDate, { color: theme.textMuted }]}
                >
                  {day.start.getDate()}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
});

/** This week's days on goal: framed time within 15 % of the daily goal. */
export function ReportGoalStreak({
  days,
  goalLabel,
  reduceMotion,
  theme,
}: {
  days: readonly boolean[];
  goalLabel: string;
  reduceMotion: boolean;
  theme: MobileTheme;
}) {
  const met = days.filter(Boolean).length;
  return (
    <Reanimated.View
      accessible
      accessibilityLabel={`${met} of ${days.length} ${days.length === 1 ? "day" : "days"} on goal. Within 15 percent of your ${goalLabel} day.`}
      entering={localPresenceEntering(reduceMotion)}
      style={[styles.streak, { backgroundColor: theme.surface }]}
      testID="reports-goal-streak"
    >
      <DayframeIcon color={theme.accent} glyph="flame" size={22} />
      <View style={styles.streakText}>
        <Text {...mobileTextProps("itemTitle")} style={[styles.streakTitle, { color: theme.textPrimary }]}>
          {met} of {days.length} {days.length === 1 ? "day" : "days"} on goal
        </Text>
        <Text {...mobileTextProps("metadata")} style={{ color: theme.textSecondary, fontSize: 12.5 }}>
          Within 15% of your {goalLabel} day
        </Text>
      </View>
      <View style={styles.streakCells}>
        {days.map((on, index) => (
          <View
            key={index}
            style={[styles.streakCell, { backgroundColor: on ? theme.success : colorWithAlpha(theme.textMuted, 0.18) }]}
          />
        ))}
      </View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  switch: { alignSelf: "flex-start", maxWidth: "100%", flexDirection: "row", borderRadius: 999, padding: 3 },
  thumb: { position: "absolute", top: 3, bottom: 3, left: 0, borderRadius: 999, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.18, shadowRadius: 2 },
  segment: { flexShrink: 1, minHeight: 44, minWidth: 54, justifyContent: "center", alignItems: "center", paddingHorizontal: 12, borderRadius: 999 },
  segmentLabel: { fontSize: 14, fontWeight: "700" },
  hero: { gap: 6 },
  heroNumber: { fontFamily: MOBILE_DISPLAY_FONT.extraBold, fontSize: 52, fontVariant: ["tabular-nums"], letterSpacing: -2, lineHeight: 56 },
  heroLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  heroWords: { fontSize: 14 },
  delta: { overflow: "hidden", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, fontSize: 12.5, fontWeight: "700", fontVariant: ["tabular-nums"] },
  weekCard: { flexDirection: "row", gap: 7, height: 236, borderRadius: 22, paddingHorizontal: 14, paddingTop: 16, paddingBottom: 12 },
  weekColumn: { flex: 1, minHeight: 44, gap: 8, justifyContent: "flex-end" },
  weekStack: { flex: 1, flexDirection: "column-reverse", gap: 3 },
  weekBlock: { borderRadius: 6 },
  weekLabel: { fontSize: 11, fontWeight: "700", textAlign: "center" },
  monthCard: { borderRadius: 22, padding: 14, gap: 6 },
  monthRow: { flexDirection: "row" },
  monthDow: { flex: 1, fontSize: 10.5, fontWeight: "700", textAlign: "center" },
  monthCells: { flexDirection: "row", flexWrap: "wrap", rowGap: 6 },
  monthCellSlot: { width: `${100 / 7}%`, paddingHorizontal: 3 },
  monthCell: { height: 44, borderRadius: 9, padding: 3, overflow: "hidden", flexDirection: "column-reverse", gap: 2 },
  monthBlock: { borderRadius: 3 },
  monthDate: { position: "absolute", top: 3, left: 5, fontSize: 10, fontWeight: "700" },
  streak: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 14 },
  streakText: { flex: 1, minWidth: 0, gap: 2 },
  streakTitle: { fontSize: 15, fontWeight: "700" },
  streakCells: { flexDirection: "row", gap: 4 },
  streakCell: { width: 14, height: 22, borderRadius: 5 },
});
