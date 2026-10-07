import { StyleSheet, Text, View } from "react-native";
import { blockColorsFor } from "@dayframe/shared";
import { recordMobileLayout, recordMobileTextLayout, type MobileAccessibilityDiagnostic } from "../accessibility/diagnostics";
import type { MobileTheme } from "../../lib/mobileTheme";
import { MOBILE_DISPLAY_FONT, mobileTextProps } from "../../lib/mobileTypography";
import type { GoalFrameSlice } from "../../lib/todayGoalFrame";
import { compactDuration, spokenDuration } from "./todayBlocksLayout";

function goalLabel(hours: number) {
  return Number.isInteger(hours) ? `${hours}h` : compactDuration(hours * 3600);
}

function spokenGoal(hours: number) {
  return spokenDuration(hours * 3600);
}

/**
 * The top of Today (Blocks prototype): the date as an eyebrow, then the day's tracked total against
 * the daily goal with one cell per goal hour. Read by VoiceOver as one heading and one summary.
 */
export function TodayGoalFrame({
  cells,
  dateLabel,
  diagnostic,
  goalHours,
  percent,
  theme,
  totalSeconds,
}: {
  cells: GoalFrameSlice[][];
  dateLabel: string;
  diagnostic?: MobileAccessibilityDiagnostic;
  goalHours: number;
  percent: number;
  theme: MobileTheme;
  totalSeconds: number;
}) {
  return (
    <View
      onLayout={(event) => recordMobileLayout(diagnostic, "today.goal", event)}
      style={styles.section}
      testID="today-goal-frame"
    >
      <Text
        {...mobileTextProps("metadata")}
        accessibilityLabel={`Today, ${dateLabel}`}
        accessibilityRole="header"
        onLayout={(event) => recordMobileLayout(diagnostic, "today.goal.date.frame", event)}
        onTextLayout={(event) => recordMobileTextLayout(diagnostic, "today.goal.date", event, "metadata", styles.eyebrow)}
        style={[styles.eyebrow, { color: theme.textMuted }]}
      >
        {dateLabel.toUpperCase()}
      </Text>
      <View
        accessibilityLabel={`${spokenDuration(totalSeconds)} tracked. Daily goal ${spokenGoal(goalHours)}, ${percent} percent.`}
        accessible
        style={styles.goal}
      >
        <View style={styles.head}>
          <Text
            {...mobileTextProps("numeric")}
            onLayout={(event) => recordMobileLayout(diagnostic, "today.goal.total.frame", event)}
            onTextLayout={(event) => recordMobileTextLayout(diagnostic, "today.goal.total", event, "numeric", styles.total)}
            style={[styles.total, { color: theme.textPrimary }]}
          >
            {compactDuration(totalSeconds)}
          </Text>
          <Text
            {...mobileTextProps("metadata")}
            onLayout={(event) => recordMobileLayout(diagnostic, "today.goal.of.frame", event)}
            onTextLayout={(event) => recordMobileTextLayout(diagnostic, "today.goal.of", event, "metadata", styles.of)}
            style={[styles.of, { color: theme.textSecondary }]}
          >
            framed of {goalLabel(goalHours)}
          </Text>
          <Text {...mobileTextProps("metadata")} style={[styles.percent, { color: theme.textSecondary }]}>
            {percent}%
          </Text>
        </View>
        <View
          onLayout={(event) => recordMobileLayout(diagnostic, "today.goal.cells", event)}
          style={styles.cells}
        >
          {cells.map((cell, index) => (
            <View key={index} style={[styles.cell, { backgroundColor: theme.surfaceMuted }]}>
              {cell.map((slice) => (
                <View
                  key={slice.key}
                  style={[
                    { backgroundColor: blockColorsFor(slice.color, theme.mode).fill, flexGrow: slice.fraction, flexBasis: 0 },
                    slice.live ? [styles.live, { borderRightColor: theme.accent }] : null,
                  ]}
                />
              ))}
              {cell.length ? <View style={{ flexBasis: 0, flexGrow: Math.max(0, 1 - cell.reduce((sum, slice) => sum + slice.fraction, 0)) }} /> : null}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 6 },
  eyebrow: { fontSize: 11, fontWeight: "600", letterSpacing: 0.9 },
  goal: { gap: 10 },
  head: { alignItems: "baseline", columnGap: 8, flexDirection: "row", flexWrap: "wrap" },
  total: { fontFamily: MOBILE_DISPLAY_FONT.extraBold, fontSize: 30, fontVariant: ["tabular-nums"], letterSpacing: -0.9, lineHeight: 34 },
  of: { flexShrink: 1, fontSize: 14 },
  percent: { fontSize: 13, fontWeight: "600", marginLeft: "auto" },
  cells: { columnGap: 4, flexDirection: "row", height: 18 },
  cell: { borderRadius: 5, flex: 1, flexDirection: "row", overflow: "hidden" },
  live: { borderRightWidth: 2 },
});
