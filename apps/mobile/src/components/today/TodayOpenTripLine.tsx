import { StyleSheet, Text, View } from "react-native";
import { DAYFRAME_APP_ICONS, formatClockTime, type ClockFormat } from "@dayframe/shared";
import { DayframeIcon } from "../icons/DayframeIcon";
import type { MobileOpenTrip } from "../../lib/api";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";

/** How long after its latest observation a journey still shows as in progress (the engine's continuity limit). */
export const OPEN_TRIP_FRESH_MS = 12 * 60_000;

/** The journey to show on Today, or null when there is none or the phone has not been heard from since. */
export function freshOpenTrip(openTrip: MobileOpenTrip | null | undefined, nowMs: number): MobileOpenTrip | null {
  if (!openTrip) return null;
  const lastObservedMs = Date.parse(openTrip.lastObservedAt);
  return Number.isFinite(lastObservedMs) && nowMs - lastObservedMs <= OPEN_TRIP_FRESH_MS ? openTrip : null;
}

/**
 * One quiet line under the live block while a journey is in progress (location v4 §9): it is never a
 * block and never logged; the finished trip replaces it when the next place is reached. Not a button.
 */
export function TodayOpenTripLine({
  clockFormat,
  openTrip,
  theme,
}: {
  clockFormat: ClockFormat;
  openTrip: MobileOpenTrip;
  theme: MobileTheme;
}) {
  const since = formatClockTime(new Date(openTrip.startedAt), clockFormat);
  return (
    <View
      accessible
      accessibilityLabel={`Travelling since ${since}. Logs when you arrive.`}
      style={styles.row}
      testID="today-open-trip"
    >
      <DayframeIcon color={theme.textMuted} glyph={DAYFRAME_APP_ICONS.openTrip} size={16} />
      <Text {...mobileTextProps("metadata")} style={[styles.text, { color: theme.textMuted }]}>
        <Text style={[styles.lead, { color: theme.textSecondary }]}>Travelling since {since}</Text>
        {" · logs when you arrive"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4, minHeight: 24 },
  text: { flexShrink: 1, fontSize: 14, lineHeight: 19 },
  lead: { fontWeight: "600" },
});
