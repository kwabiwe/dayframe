import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { blockColorsFor, DAYFRAME_BLOCKS } from "@dayframe/shared";
import type { EarlierDay } from "../../lib/earlierThisWeek";
import { shortDuration } from "../../lib/earlierThisWeek";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
import { spokenDuration } from "./todayBlocksLayout";

/**
 * "Earlier this week" (Blocks prototype): one row per earlier day with a 24-hour mini ribbon and
 * the day's total. A day with open Review moments shows a small hatched count chip (14 Oct 2026).
 * Tapping a day opens it in Calendar. Re-renders only when the days or the counts change (the
 * Dashboard rebuilds them on the per-minute clock).
 */
export const EarlierThisWeek = memo(function EarlierThisWeek({
  days,
  onOpenDay,
  reviewCounts,
  theme,
}: {
  days: readonly EarlierDay[];
  onOpenDay: (dayKey: string) => void;
  /** Open Review moments per day (`earlierDayReviewCounts`); a day without any has no chip. */
  reviewCounts?: ReadonlyMap<string, number>;
  theme: MobileTheme;
}) {
  return (
    <View style={styles.section} testID="earlier-this-week">
      <View style={styles.head}>
        <Text {...mobileTextProps("sectionHeading")} accessibilityRole="header" style={[styles.heading, { color: theme.textPrimary }]}>
          Earlier this week
        </Text>
        <Text {...mobileTextProps("metadata")} style={[styles.caption, { color: theme.textMuted }]}>Tap a day</Text>
      </View>
      <View style={[styles.list, { backgroundColor: theme.surface }]}>
        {days.map((day) => {
          const reviewCount = reviewCounts?.get(day.dayKey) ?? 0;
          return (
          <Pressable
            accessibilityHint="Opens this day in Calendar"
            accessibilityLabel={[
              day.spokenDate,
              day.totalSeconds ? spokenDuration(day.totalSeconds) : "nothing framed",
              reviewCount ? `${reviewCount} ${reviewCount === 1 ? "moment" : "moments"} to review` : null,
            ].filter(Boolean).join(", ")}
            accessibilityRole="button"
            key={day.dayKey}
            onPress={() => onOpenDay(day.dayKey)}
            style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
            testID={`earlier-day-${day.dayKey}`}
          >
            <View style={styles.day}>
              <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={[styles.weekday, { color: theme.textPrimary }]}>{day.weekday}</Text>
              <Text {...mobileTextProps("metadata")} numberOfLines={1} style={[styles.date, { color: theme.textMuted }]}>{day.dateLabel}</Text>
            </View>
            <View style={[styles.ribbon, { backgroundColor: theme.surfaceMuted }]}>
              {day.segments.map((segment) => (
                <View
                  key={segment.key}
                  style={[
                    styles.segment,
                    {
                      backgroundColor: segment.color ? blockColorsFor(segment.color, theme.mode).fill : theme.textMuted,
                      left: `${segment.left * 100}%`,
                      width: `${segment.width * 100}%`,
                    },
                  ]}
                />
              ))}
            </View>
            {reviewCount ? (
              <View style={[styles.chip, { backgroundColor: theme.surfaceMuted }]} testID={`earlier-day-review-${day.dayKey}`}>
                <HatchGlyph color={theme.textSecondary} />
                <Text {...mobileTextProps("numeric")} numberOfLines={1} style={[styles.chipText, { color: theme.textPrimary }]}>
                  {reviewCount}
                </Text>
              </View>
            ) : null}
            <Text {...mobileTextProps("numeric")} numberOfLines={1} style={[styles.total, { color: theme.textSecondary }]}>
              {shortDuration(day.totalSeconds)}
            </Text>
          </Pressable>
          );
        })}
      </View>
    </View>
  );
});

/** A 10-point hatched square: the same "needs review" hatch as the ribbon and Calendar suggestions. */
function HatchGlyph({ color }: { color: string }) {
  return (
    <Svg height={10} viewBox="0 0 10 10" width={10}>
      <Rect fill="none" height={9} rx={2.5} stroke={color} strokeWidth={1} width={9} x={0.5} y={0.5} />
      <Path d="M-1 6 L4 11 M-1 1 L9 11 M3 -1 L11 7" stroke={color} strokeWidth={1.2} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  head: { alignItems: "baseline", flexDirection: "row", gap: 12, justifyContent: "space-between" },
  heading: { flexShrink: 1, fontSize: 17, fontWeight: "700", letterSpacing: -0.2 },
  caption: { fontSize: 13 },
  list: { borderRadius: DAYFRAME_BLOCKS.radius.phoneCard, gap: 2, overflow: "hidden", paddingVertical: 6 },
  row: { alignItems: "center", flexDirection: "row", gap: 12, minHeight: 44, paddingHorizontal: 16, paddingVertical: 6 },
  pressed: { opacity: 0.82 },
  day: { minWidth: 52 },
  weekday: { fontSize: 13, fontWeight: "700" },
  date: { fontSize: 11, fontWeight: "600" },
  ribbon: { borderRadius: 4, flex: 1, height: 12, overflow: "hidden" },
  segment: { borderRadius: 3, bottom: 0, minWidth: 2, position: "absolute", top: 0 },
  total: { fontSize: 13, fontVariant: ["tabular-nums"], fontWeight: "700", minWidth: 58, textAlign: "right" },
  chip: { alignItems: "center", borderRadius: DAYFRAME_BLOCKS.radius.pill, flexDirection: "row", gap: 4, height: 20, paddingHorizontal: 7 },
  chipText: { fontSize: 11, fontVariant: ["tabular-nums"], fontWeight: "700" },
});
