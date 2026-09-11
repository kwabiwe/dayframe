import { useEffect, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import Reanimated from "react-native-reanimated";
import {
  pressable,
  type MobileStyles,
  type MobileTheme,
} from "@/lib/mobileTheme";
import {
  localPresenceEntering,
  localPresenceExiting,
  useReduceMotionPreference,
} from "@/lib/motion";
import { DatePickerCalendar } from "@/components/calendar/DatePickerCalendar";
import { formatLocalDateKey, startOfLocalDay } from "@/lib/reportsRanges";
import { REPORT_TEXT_CAP } from "@/lib/reportsTypography";
import {
  DATE_PICKER_HORIZONTAL_INSET,
  DATE_PICKER_SHELL_MAX_WIDTH,
} from "@/lib/datePickerGeometry";

export function FloatingDatePicker({
  maxDate = null,
  onClose,
  onSelect,
  selectedDate,
  styles,
  theme,
  visible,
}: {
  maxDate?: Date | null;
  onClose: () => void;
  onSelect: (date: Date) => void;
  selectedDate: Date;
  styles: MobileStyles;
  theme: MobileTheme;
  visible: boolean;
}) {
  const reduceMotion = useReduceMotionPreference();
  const { width, height } = useWindowDimensions();
  const selectedDayKey = formatLocalDateKey(selectedDate);
  const [month, setMonth] = useState(() => `${selectedDayKey.slice(0, 7)}-01`);
  const today = startOfLocalDay(new Date());
  useEffect(() => {
    if (visible) setMonth(`${selectedDayKey.slice(0, 7)}-01`);
  }, [selectedDayKey, visible]);
  if (!visible) return null;
  return (
    <Reanimated.View
      accessibilityViewIsModal
      onAccessibilityEscape={onClose}
      entering={localPresenceEntering(reduceMotion)}
      exiting={localPresenceExiting(reduceMotion)}
      style={[
        styles.datePickerOverlay,
        {
          paddingHorizontal: 0,
          paddingTop: Math.min(118, Math.max(12, (height - 450) / 2)),
        },
      ]}
    >
      <Pressable
        accessibilityLabel="Close date picker"
        accessibilityRole="button"
        onPress={onClose}
        style={styles.sheetBackdrop}
      />
      <Reanimated.View
        accessibilityLabel="Choose a date"
        entering={localPresenceEntering(reduceMotion, "rise")}
        style={[
          styles.datePickerSheet,
          {
            width: Math.min(DATE_PICKER_SHELL_MAX_WIDTH, width),
            paddingHorizontal: DATE_PICKER_HORIZONTAL_INSET,
          },
        ]}
      >
        <DatePickerCalendar
          month={month}
          onMonthChange={setMonth}
          start={selectedDayKey}
          end={selectedDayKey}
          today={formatLocalDateKey(today)}
          maxDate={maxDate ? formatLocalDateKey(maxDate) : null}
          onSelect={onSelect}
          theme={theme}
          reduceMotion={reduceMotion}
        />
        <View style={styles.datePickerActions}>
          <Pressable
            accessibilityLabel="Select today"
            accessibilityRole="button"
            onPress={() => onSelect(today)}
            style={pressable(
              styles.datePickerTodayButton,
              styles.buttonPressed,
            )}
          >
            <Text
              maxFontSizeMultiplier={REPORT_TEXT_CAP.control}
              style={styles.datePickerTodayText}
            >
              Today
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Close date picker"
            accessibilityRole="button"
            onPress={onClose}
            style={pressable(styles.datePickerDoneButton, styles.buttonPressed)}
          >
            <Text
              maxFontSizeMultiplier={REPORT_TEXT_CAP.control}
              style={styles.datePickerDoneText}
            >
              Done
            </Text>
          </Pressable>
        </View>
      </Reanimated.View>
    </Reanimated.View>
  );
}
