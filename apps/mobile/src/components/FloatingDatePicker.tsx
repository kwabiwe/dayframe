import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { pressable, type MobileStyles, type MobileTheme } from "@/lib/mobileTheme";

export function FloatingDatePicker({
  maxDate = new Date(),
  onClose,
  onSelect,
  selectedDate,
  styles,
  theme,
  visible
}: {
  maxDate?: Date;
  onClose: () => void;
  onSelect: (date: Date) => void;
  selectedDate: Date;
  styles: MobileStyles;
  theme: MobileTheme;
  visible: boolean;
}) {
  const [month, setMonth] = useState(() => startOfMonth(selectedDate));
  const selectedDayKey = formatDateKey(selectedDate);
  const maxDay = startOfDay(maxDate);
  const maxDayKey = formatDateKey(maxDay);

  useEffect(() => {
    if (visible) setMonth(startOfMonth(selectedDate));
  }, [selectedDayKey, visible]);

  const days = useMemo(() => monthGridDays(month), [month]);
  const nextMonthDisabled = addMonths(month, 1).getTime() > startOfMonth(maxDay).getTime();

  if (!visible) return null;

  return (
    <View accessibilityViewIsModal style={styles.datePickerOverlay}>
      <Pressable
        accessibilityLabel="Close date picker"
        accessibilityRole="button"
        onPress={onClose}
        style={styles.sheetBackdrop}
      />
      <View accessibilityLabel="Choose a date" style={styles.datePickerSheet}>
          <View style={styles.datePickerHeader}>
            <Pressable
              accessibilityLabel="Previous month"
              accessibilityRole="button"
              onPress={() => setMonth((current) => addMonths(current, -1))}
              style={pressable(styles.datePickerNavButton, styles.buttonPressed)}
            >
              <CalendarChevronGlyph color={theme.textPrimary} direction="left" />
            </Pressable>
            <Text style={styles.datePickerMonth}>
              {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </Text>
            <Pressable
              accessibilityLabel="Next month"
              accessibilityRole="button"
              accessibilityState={{ disabled: nextMonthDisabled }}
              disabled={nextMonthDisabled}
              onPress={() => setMonth((current) => addMonths(current, 1))}
              style={({ pressed }) => [
                styles.datePickerNavButton,
                nextMonthDisabled ? styles.buttonDisabled : null,
                pressed && !nextMonthDisabled ? styles.buttonPressed : null
              ]}
            >
              <CalendarChevronGlyph color={theme.textPrimary} direction="right" />
            </Pressable>
          </View>
          <View style={styles.datePickerWeekdays}>
            {["M", "T", "W", "T", "F", "S", "S"].map((label, index) => (
              <Text key={`${label}-${index}`} style={styles.datePickerWeekday}>{label}</Text>
            ))}
          </View>
          <View style={styles.datePickerGrid}>
            {days.map((date) => {
              const dayKey = formatDateKey(date);
              const selected = dayKey === selectedDayKey;
              const isToday = dayKey === maxDayKey;
              const inMonth = date.getMonth() === month.getMonth();
              const disabled = startOfDay(date).getTime() > maxDay.getTime();
              return (
                <Pressable
                  key={dayKey}
                  accessibilityLabel={date.toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "long",
                    weekday: "long",
                    year: "numeric"
                  })}
                  accessibilityRole="button"
                  accessibilityState={{ disabled, selected }}
                  disabled={disabled}
                  onPress={() => onSelect(date)}
                  style={({ pressed }) => [
                    styles.datePickerDay,
                    isToday ? styles.datePickerDayToday : null,
                    selected ? styles.datePickerDaySelected : null,
                    disabled ? styles.buttonDisabled : null,
                    pressed && !disabled ? styles.buttonPressed : null
                  ]}
                >
                  <Text style={[
                    styles.datePickerDayText,
                    !inMonth || disabled ? styles.datePickerDayTextOutside : null,
                    selected ? styles.datePickerDayTextSelected : null
                  ]}>
                    {date.getDate()}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.datePickerActions}>
            <Pressable
              accessibilityLabel="Select today"
              accessibilityRole="button"
              onPress={() => onSelect(maxDay)}
              style={pressable(styles.datePickerTodayButton, styles.buttonPressed)}
            >
              <Text style={styles.datePickerTodayText}>Today</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Close date picker"
              accessibilityRole="button"
              onPress={onClose}
              style={pressable(styles.datePickerDoneButton, styles.buttonPressed)}
            >
              <Text style={styles.datePickerDoneText}>Done</Text>
            </Pressable>
          </View>
      </View>
    </View>
  );
}

function CalendarChevronGlyph({ color, direction }: { color: string; direction: "left" | "right" }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        d={direction === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"}
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </Svg>
  );
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function startOfMonth(date: Date) {
  const copy = startOfDay(date);
  copy.setDate(1);
  return copy;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function addMonths(date: Date, months: number) {
  const copy = startOfMonth(date);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

function monthGridDays(month: Date) {
  const firstDay = startOfMonth(month);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const gridStart = addDays(firstDay, -mondayOffset);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

function formatDateKey(date: Date) {
  return [date.getFullYear(), pad2(date.getMonth() + 1), pad2(date.getDate())].join("-");
}

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}
