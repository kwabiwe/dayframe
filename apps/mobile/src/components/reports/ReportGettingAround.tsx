import { Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { DAYFRAME_BLOCKS, DAYFRAME_LEG_MODE_ICONS, LEG_MODE_LABEL, type DayframeGlyph, type ReportSummary } from "@dayframe/shared";
import { DayframeIcon } from "../icons/DayframeIcon";
import { compactDuration } from "../today/todayBlocksLayout";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
import { localPresenceEntering } from "../../lib/motion";
import { spokenReportDuration } from "../../lib/reportsPresentation";

type GettingAround = NonNullable<ReportSummary["gettingAround"]>;

/**
 * Reports › Getting around on the iPhone (location v4 step 18, mock-up #ios-reports): the time inside
 * Getting around and Commute blocks by leg mode, each trip counted once. Times only, no distances.
 * It fades in with the report (local presence; at once with Reduce Motion).
 */
export function ReportGettingAround({ reduceMotion, summary, theme }: { reduceMotion: boolean; summary: GettingAround; theme: MobileTheme }) {
  const rows = [
    ...summary.byMode.map((row) => ({
      key: row.mode,
      label: row.mode === "unknown" ? "Mode not known" : LEG_MODE_LABEL[row.mode],
      glyph: (row.mode === "unknown" ? "route" : DAYFRAME_LEG_MODE_ICONS[row.mode]) as DayframeGlyph,
      seconds: row.seconds
    })),
    ...(summary.stopsSeconds > 0 ? [{ key: "stops", label: "Stops and changes", glyph: "timer" as DayframeGlyph, seconds: summary.stopsSeconds }] : [])
  ].sort((a, b) => b.seconds - a.seconds);
  const total = Math.max(1, summary.totalSeconds);
  const trips = `${summary.tripCount} ${summary.tripCount === 1 ? "trip" : "trips"}, each counted once`;
  const shades = [theme.textPrimary, theme.textSecondary, theme.textMuted];
  return (
    <Reanimated.View entering={localPresenceEntering(reduceMotion)} style={[styles.card, { backgroundColor: theme.surface }]} testID="reports-getting-around">
      <Text {...mobileTextProps("sectionHeading")} accessibilityRole="header" style={[styles.heading, { color: theme.textPrimary }]}>Getting around</Text>
      <View accessible accessibilityLabel={`${spokenReportDuration(summary.totalSeconds)} getting around, ${trips}.`} style={styles.total}>
        <Text {...mobileTextProps("numeric")} style={[styles.totalValue, { color: theme.textPrimary }]}>{compactDuration(summary.totalSeconds)}</Text>
        <Text {...mobileTextProps("metadata")} style={{ color: theme.textSecondary }}>{trips}</Text>
      </View>
      <View style={[styles.bar, { backgroundColor: theme.surfaceMuted }]}>
        {rows.map((row, index) => (
          <View key={row.key} style={{ width: `${(row.seconds / total) * 100}%`,
            backgroundColor: row.key === "stops" ? theme.border : shades[Math.min(index, shades.length - 1)] }} />
        ))}
      </View>
      {rows.map((row, index) => (
        <View accessible accessibilityLabel={`${row.label}, ${spokenReportDuration(row.seconds)}`} key={row.key}
          style={[styles.row, index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border } : null]}>
          <View style={[styles.icon, { backgroundColor: theme.surfaceMuted }]}>
            <DayframeIcon color={theme.textSecondary} glyph={row.glyph} size={16} />
          </View>
          <Text {...mobileTextProps("itemTitle")} style={[styles.label, { color: theme.textPrimary }]}>{row.label}</Text>
          <Text {...mobileTextProps("numeric")} style={{ color: theme.textPrimary }}>{compactDuration(row.seconds)}</Text>
        </View>
      ))}
      <Text {...mobileTextProps("metadata")} style={[styles.note, { color: theme.textMuted }]}>
        Time by leg inside your Getting around and Commute blocks.
      </Text>
    </Reanimated.View>
  );
}

/** "Not logged" under the total: time at places you haven't named, never part of activities or goals. */
export function ReportNotLogged({ onCheck, seconds, theme }: { onCheck: () => void; seconds: number; theme: MobileTheme }) {
  if (seconds < 60) return null;
  return (
    <View style={styles.notLogged} testID="reports-not-logged">
      <Text {...mobileTextProps("metadata")} style={{ color: theme.textSecondary, flexShrink: 1 }}>
        Not logged: <Text style={{ color: theme.textPrimary, fontWeight: "700" }}>{compactDuration(seconds)}</Text> at places you haven't named.
        Not counted above or in goals.
      </Text>
      <Pressable accessibilityHint="Opens Calendar's List, where they are" accessibilityRole="button" hitSlop={6} onPress={onCheck}
        style={({ pressed }) => [styles.check, { backgroundColor: theme.surfaceMuted, opacity: pressed ? 0.8 : 1 }]}>
        <Text {...mobileTextProps("control")} style={{ color: theme.textPrimary, fontWeight: "700" }}>Check them</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: DAYFRAME_BLOCKS.radius.phoneCard, paddingHorizontal: 16, paddingVertical: 14, gap: 6 },
  heading: { fontSize: 17, fontWeight: "700" },
  total: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: 10 },
  totalValue: { fontSize: 30, fontWeight: "800" },
  bar: { flexDirection: "row", height: 10, borderRadius: DAYFRAME_BLOCKS.radius.pill, overflow: "hidden", marginVertical: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  icon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  label: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: "600" },
  note: { fontSize: 12 },
  notLogged: { flexDirection: "row", alignItems: "center", gap: 10 },
  check: { minHeight: 44, borderRadius: DAYFRAME_BLOCKS.radius.pill, paddingHorizontal: 14, justifyContent: "center" }
});
