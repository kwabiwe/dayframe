import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { datePickerCells } from "@/lib/datePickerCalendar";
import { formatLocalDateKey, parseLocalDate } from "@/lib/reportsRanges";
import { REPORT_TEXT_CAP } from "@/lib/reportsTypography";
import { MOBILE_MOTION } from "@/lib/motion";
import type { MobileTheme } from "@/lib/mobileTheme";

export function CalendarGlyph({
  kind,
  color,
}: {
  kind: "calendar" | "funnel" | "tick" | "mixed" | "left" | "right";
  color: string;
}) {
  const path = {
    calendar:
      "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01",
    funnel: "M3 4h18l-7 8v7l-4 2v-9Z",
    tick: "m5 12 4 4L19 6",
    mixed: "M6 12h12",
    left: "m15 18-6-6 6-6",
    right: "m9 18 6-6-6-6",
  }[kind];
  return (
    <Svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      accessible={false}
      accessibilityElementsHidden
    >
      <Path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Presentation only: wrappers retain single-date versus draft/Done ownership. */
export function DatePickerCalendar({
  month,
  onMonthChange,
  start,
  end,
  today,
  maxDate,
  onSelect,
  theme,
  reduceMotion,
}: {
  month: string;
  onMonthChange: (month: string) => void;
  start: string | null;
  end: string | null;
  today: string;
  maxDate?: string | null;
  onSelect: (date: Date) => void;
  theme: MobileTheme;
  reduceMotion: boolean;
}) {
  const current = parseLocalDate(month)!;
  const move = (offset: number) =>
    formatLocalDateKey(
      new Date(current.getFullYear(), current.getMonth() + offset, 1),
    );
  const nextDisabled = Boolean(
    maxDate && move(1) > `${maxDate.slice(0, 7)}-01`,
  );
  const cells = datePickerCells(month, start, end, today, maxDate);
  return (
    <View testID="date-picker-calendar">
      <View style={s.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          onPress={() => onMonthChange(move(-1))}
          style={[s.nav, { backgroundColor: theme.surfaceMuted }]}
        >
          <CalendarGlyph kind="left" color={theme.textPrimary} />
        </Pressable>
        <Text
          maxFontSizeMultiplier={REPORT_TEXT_CAP.control}
          numberOfLines={1}
          style={[s.month, { color: theme.textPrimary }]}
        >
          {current.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          accessibilityState={{ disabled: nextDisabled }}
          disabled={nextDisabled}
          onPress={() => onMonthChange(move(1))}
          style={[s.nav, { backgroundColor: theme.surfaceMuted }]}
        >
          <CalendarGlyph
            kind="right"
            color={nextDisabled ? theme.textSecondary : theme.textPrimary}
          />
        </Pressable>
      </View>
      <View style={s.week}>
        {["M", "T", "W", "T", "F", "S", "S"].map((label, i) => (
          <Text
            key={i}
            maxFontSizeMultiplier={REPORT_TEXT_CAP.calendar}
            style={[s.weekday, { color: theme.textSecondary }]}
          >
            {label}
          </Text>
        ))}
      </View>
      <View style={s.frame}>
        <Animated.View
          key={month}
          entering={FadeIn.duration(reduceMotion ? 0 : MOBILE_MOTION.control)}
          exiting={FadeOut.duration(reduceMotion ? 0 : MOBILE_MOTION.control)}
          style={s.grid}
        >
          {cells.map((cell) => (
            <Pressable
              key={cell.key}
              testID={`calendar-day-${cell.key}`}
              accessibilityRole="button"
              accessibilityLabel={`${cell.date.toLocaleDateString(undefined, { dateStyle: "full" })}${cell.meaning ? `, ${cell.meaning}` : ""}`}
              accessibilityState={{
                disabled: cell.disabled,
                selected: cell.selected,
              }}
              disabled={cell.disabled}
              onPress={() => onSelect(cell.date)}
              style={s.cell}
            >
              {cell.band !== "none" ? (
                <View
                  pointerEvents="none"
                  testID={`calendar-band-${cell.key}`}
                  style={[
                    s.band,
                    {
                      backgroundColor: theme.accentSoft,
                      left: cell.band === "start" ? "50%" : 0,
                      right: cell.band === "end" ? "50%" : 0,
                      borderTopLeftRadius: cell.column === 0 ? 6 : 0,
                      borderBottomLeftRadius: cell.column === 0 ? 6 : 0,
                      borderTopRightRadius: cell.column === 6 ? 6 : 0,
                      borderBottomRightRadius: cell.column === 6 ? 6 : 0,
                    },
                  ]}
                />
              ) : null}
              <View
                pointerEvents="none"
                testID={`calendar-circle-${cell.key}`}
                style={[
                  s.circle,
                  {
                    backgroundColor: cell.endpoint
                      ? theme.accent
                      : cell.today && !cell.selected
                        ? theme.surfaceMuted
                        : "transparent",
                  },
                ]}
              >
                <Text
                  maxFontSizeMultiplier={REPORT_TEXT_CAP.calendar}
                  numberOfLines={1}
                  style={[
                    s.day,
                    {
                      color: cell.endpoint
                        ? theme.onAccent
                        : cell.disabled || !cell.inMonth
                          ? theme.textSecondary
                          : theme.textPrimary,
                    },
                  ]}
                >
                  {cell.date.getDate()}
                </Text>
              </View>
            </Pressable>
          ))}
        </Animated.View>
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", minHeight: 44, gap: 4 },
  nav: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  month: {
    flex: 1,
    minWidth: 0,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "600",
  },
  week: { flexDirection: "row", paddingVertical: 8 },
  weekday: { flex: 1, textAlign: "center", fontSize: 11, fontWeight: "600" },
  frame: { height: 264 },
  grid: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: `${100 / 7}%`,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  circle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  band: { position: "absolute", top: 4, height: 36 },
  day: { fontSize: 14, fontWeight: "500", fontVariant: ["tabular-nums"] },
});
