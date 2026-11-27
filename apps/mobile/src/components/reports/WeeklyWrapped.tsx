import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { buildWeeklyWrapped } from "@dayframe/shared";
import type { MobileTheme } from "@/lib/mobileTheme";
import { MOBILE_DISPLAY_FONT } from "../../lib/mobileTypography";
import type { ReportRange } from "@/lib/reportsRanges";
import { spokenReportDuration } from "../../lib/reportsPresentation";
import { REPORT_TEXT_CAP } from "../../lib/reportsTypography";
import { compactDuration } from "../today/todayBlocksLayout";
import type { ReportDayStack } from "./ReportsBlocks";

export function WeeklyWrapped({ days, activities, range, todayKey, theme, reduceMotion }: {
  days: readonly ReportDayStack[];
  activities: ReadonlyArray<{ key: string; categoryName: string; color: string }>;
  range: ReportRange;
  todayKey: string;
  theme: MobileTheme;
  reduceMotion: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const week = useMemo(() => expanded ? buildWeeklyWrapped(days.map((day, index) => ({
    key: day.key,
    label: range.buckets[index].fullLabel,
    shortLabel: range.buckets[index].label,
    future: day.key > todayKey,
    activities: day.segments.map((part) => ({ id: part.key, seconds: part.seconds }))
  })), activities.map((part) => ({ id: part.key, name: part.categoryName, color: part.color }))) : null,
  [expanded, days, range.buckets, todayKey, activities]);
  const { fontScale } = useWindowDimensions();
  const showDayList = fontScale >= 1.5;
  const text = { color: theme.textPrimary };
  const secondary = { color: theme.textSecondary };
  return (
    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)} style={styles.control}>
        <Text maxFontSizeMultiplier={REPORT_TEXT_CAP.heading} style={[styles.heading, text]}>Weekly Wrapped</Text>
        <Text accessible={false} maxFontSizeMultiplier={REPORT_TEXT_CAP.control} style={secondary}>{expanded ? "Hide" : "Show"}</Text>
      </Pressable>
      {week ? (
        <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(180)} style={styles.body}>
          <Text maxFontSizeMultiplier={REPORT_TEXT_CAP.small} style={secondary}>{range.title}</Text>
          <Text accessibilityRole="header" maxFontSizeMultiplier={REPORT_TEXT_CAP.numeric} style={[styles.total, text]}>
            {week.totalSeconds ? `${compactDuration(week.totalSeconds)} logged` : "A quiet week"}
          </Text>
          <Text maxFontSizeMultiplier={REPORT_TEXT_CAP.small} style={secondary}>Tracked on {week.trackedDays} of {week.columns.length} days</Text>
          {!showDayList ? (
            <View style={styles.columns}>
              {week.columns.map((day, index) => (
                <View accessible key={day.key} style={[
                  styles.column,
                  day.key === week.busiest?.key && styles.busiest
                ]} accessibilityLabel={`${day.label}, ${day.future ? "upcoming" : spokenReportDuration(day.seconds)}`}>
                  <View accessible={false} style={[styles.track, { backgroundColor: theme.surfaceInset }]}>
                    <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(200).delay(index * 35)}
                      style={[styles.stack, { height: `${week.peakSeconds ? day.seconds / week.peakSeconds * 100 : 0}%` }]}>
                      {day.segments.map((part) => <View key={part.id} style={{
                        flex: part.seconds, backgroundColor: part.color ?? theme.textSecondary
                      }} />)}
                    </Animated.View>
                  </View>
                  <Text maxFontSizeMultiplier={REPORT_TEXT_CAP.calendar} style={[styles.day, text]}>{day.shortLabel}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.body}>
              {week.columns.map((day) => <Text key={day.key} maxFontSizeMultiplier={REPORT_TEXT_CAP.calendar} style={[styles.dayDetail, text]}>
                {day.label} · {day.future ? "Upcoming" : compactDuration(day.seconds)}
              </Text>)}
            </View>
          )}
          {week.busiest ? <View style={[styles.lead, { backgroundColor: theme.surfaceMuted }]}>
            <Text maxFontSizeMultiplier={REPORT_TEXT_CAP.small} style={secondary}>Busiest day</Text>
            <Text maxFontSizeMultiplier={REPORT_TEXT_CAP.heading} style={[styles.heading, text]}>
              {week.busiest.label} · {compactDuration(week.busiest.seconds)}
            </Text>
          </View> : null}
          {week.activities.map((activity) => (
            <View key={activity.id} style={styles.ledgerRow}>
              <Text maxFontSizeMultiplier={REPORT_TEXT_CAP.name} style={[styles.activity, text]}>{activity.name}</Text>
              <Text maxFontSizeMultiplier={REPORT_TEXT_CAP.numeric} style={secondary}>
                {compactDuration(activity.seconds)} · {Math.round(activity.share * 100)}%
              </Text>
            </View>
          ))}
          {week.totalSeconds === 0 ? <Text style={secondary}>Time appears here as you log blocks.</Text> : null}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 16 },
  control: { minHeight: 44, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 },
  heading: { fontFamily: MOBILE_DISPLAY_FONT.bold, fontSize: 20, lineHeight: 26, flexShrink: 1 },
  body: { gap: 10 },
  total: { fontFamily: MOBILE_DISPLAY_FONT.extraBold, fontSize: 42, lineHeight: 52 },
  columns: { flexDirection: "row", gap: 6, marginVertical: 8 },
  column: { flex: 1, minWidth: 0, gap: 6 },
  busiest: { flex: 1.5 },
  track: { height: 120, borderRadius: 8, overflow: "hidden", justifyContent: "flex-end" },
  stack: { flexDirection: "column-reverse", overflow: "hidden" },
  day: { textAlign: "center", fontSize: 12 },
  dayDetail: { fontSize: 16, lineHeight: 22 },
  lead: { padding: 12, gap: 4, borderRadius: 12 },
  ledgerRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  activity: { flex: 1 }
});
