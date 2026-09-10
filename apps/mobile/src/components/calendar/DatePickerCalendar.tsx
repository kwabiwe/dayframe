import { useLayoutEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
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
  const activeMonth = useRef({ month, generation: 0 });
  if (activeMonth.current.month !== month) {
    activeMonth.current = {
      month,
      generation: activeMonth.current.generation + 1,
    };
  }
  const generation = activeMonth.current.generation;
  const [transition, setTransition] = useState({
    month,
    previous: null as string | null,
  });
  if (transition.month !== month) {
    setTransition({ month, previous: reduceMotion ? null : transition.month });
  }
  const progress = useSharedValue(1);
  const incomingStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const outgoingStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
  }));
  useLayoutEffect(() => {
    if (!transition.previous || reduceMotion) {
      progress.value = 1;
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, { duration: MOBILE_MOTION.control });
    const timer = setTimeout(
      () =>
        setTransition((value) =>
          value.month === month ? { month, previous: null } : value,
        ),
      MOBILE_MOTION.control + 32,
    );
    return () => clearTimeout(timer);
  }, [month, transition.previous, reduceMotion, progress]);
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
        {[
          ...(transition.previous && !reduceMotion
            ? [transition.previous]
            : []),
          month,
        ].map((visibleMonth) => {
          const outgoing = visibleMonth !== month;
          const cells = datePickerCells(
            visibleMonth,
            start,
            end,
            today,
            maxDate,
          );
          return (
            <Animated.View
              key={visibleMonth}
              testID={outgoing ? "calendar-outgoing" : "calendar-current"}
              pointerEvents={outgoing ? "none" : "auto"}
              accessibilityElementsHidden={outgoing}
              importantForAccessibility={
                outgoing ? "no-hide-descendants" : "auto"
              }
              style={[s.grid, outgoing ? outgoingStyle : incomingStyle]}
            >
              {Array.from({ length: 6 }, (_, week) => (
                <View
                  key={week}
                  testID={`calendar-${outgoing ? "outgoing-" : ""}week-${visibleMonth}-${week}`}
                  style={s.weekRow}
                >
                  {cells.slice(week * 7, week * 7 + 7).map((cell) => (
                    <Pressable
                      key={cell.key}
                      testID={`calendar-${outgoing ? "outgoing-" : ""}day-${cell.key}`}
                      accessibilityRole="button"
                      accessibilityLabel={`${cell.date.toLocaleDateString(undefined, { dateStyle: "full" })}${cell.meaning ? `, ${cell.meaning}` : ""}`}
                      accessibilityState={{
                        disabled: outgoing || cell.disabled,
                        selected: cell.selected,
                      }}
                      disabled={outgoing || cell.disabled}
                      onPress={
                        outgoing
                          ? undefined
                          : () => {
                              if (
                                activeMonth.current.generation === generation &&
                                activeMonth.current.month === visibleMonth &&
                                !cell.disabled
                              )
                                onSelect(cell.date);
                            }
                      }
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
                              borderBottomRightRadius:
                                cell.column === 6 ? 6 : 0,
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
                </View>
              ))}
            </Animated.View>
          );
        })}
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
  week: { flexDirection: "row", flexWrap: "nowrap", paddingVertical: 8 },
  weekday: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    textAlign: "center",
    fontSize: 11,
    fontWeight: "600",
  },
  frame: { height: 264 },
  grid: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  weekRow: { flexDirection: "row", flexWrap: "nowrap", height: 44 },
  cell: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
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
