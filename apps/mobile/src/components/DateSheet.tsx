import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { DatePickerCalendar } from "@/components/calendar/DatePickerCalendar";
import { BottomSheetShell } from "@/components/sheets/BottomSheetShell";
import { DATE_PICKER_CALENDAR_MAX_WIDTH } from "@/lib/datePickerGeometry";
import type { MobileTheme } from "@/lib/mobileTheme";
import { MOBILE_DISPLAY_FONT } from "@/lib/mobileTypography";
import { REPORT_TEXT_CAP } from "@/lib/reportsTypography";

/** From a 667-point screen up the head fits; the smallest phones keep every date row and Done. */
export const DATE_SHEET_HEAD_MIN_HEIGHT = 667;

export type DateSheetSegment = {
  key: string;
  label: string;
  selected: boolean;
  onPress: () => void;
};

/**
 * The one iPhone date sheet (date-picker audit, 14 Oct 2026): grabber, eyebrow and title, optional
 * quick-pick segments, a caption saying the draft in words, the shared Monday-first
 * `DatePickerCalendar`, a notice slot and a full-width neutral Done pinned at the bottom.
 *
 * It is controlled: the caller owns the draft (a single date is `start === end`, a range spans
 * them) and its rules. Taps only change the draft; Done saves it (`onDone` returning false keeps
 * the sheet). A swipe on the handle, the backdrop or escape throws the draft away. No Cancel.
 */
export function DateSheet({
  rootHosted = false,
  presentationId,
  theme,
  reduceMotion,
  eyebrow,
  title,
  accessibilityTitle,
  segments,
  caption,
  month,
  onMonthChange,
  start,
  end,
  today,
  maxDate,
  onSelectDay,
  notice,
  doneLabel = "Done",
  doneDisabled = false,
  onDone,
  onDismissed,
  testID = "date-sheet",
}: {
  rootHosted?: boolean;
  presentationId: number;
  theme: MobileTheme;
  reduceMotion: boolean;
  eyebrow: string;
  title: string;
  /** The sheet's spoken name (and "Close …" for its backdrop); defaults to the title. */
  accessibilityTitle?: string;
  segments?: readonly DateSheetSegment[];
  caption: string;
  /** The month on screen, as a `YYYY-MM-DD` key of any day in it. */
  month: string;
  onMonthChange: (month: string) => void;
  start: string | null;
  end: string | null;
  today: string;
  maxDate?: string | null;
  onSelectDay: (date: Date) => void;
  notice?: string | null;
  doneLabel?: string;
  doneDisabled?: boolean;
  onDone: () => boolean | void;
  onDismissed: (presentationId: number) => void;
  testID?: string;
}) {
  const showHead = useWindowDimensions().height >= DATE_SHEET_HEAD_MIN_HEIGHT;
  return (
    <BottomSheetShell
      rootHosted={rootHosted}
      title={accessibilityTitle ?? title}
      calendarLayout
      presentationId={presentationId}
      theme={theme}
      reduceMotion={reduceMotion}
      action={doneLabel}
      disabled={doneDisabled}
      onDismissed={onDismissed}
      onApply={onDone}
      testID={testID}
    >
      {/* Blocks head (UIA-026). */}
      {showHead ? (
        <View style={s.head}>
          <Text maxFontSizeMultiplier={REPORT_TEXT_CAP.small} style={[s.eyebrow, { color: theme.textSecondary }]}>
            {eyebrow}
          </Text>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={REPORT_TEXT_CAP.heading}
            style={[s.title, { color: theme.textPrimary }]}
          >
            {title}
          </Text>
        </View>
      ) : null}
      {segments?.length ? (
        <View style={s.segments}>
          {segments.map((segment) => (
            <Pressable
              key={segment.key}
              accessibilityRole="button"
              accessibilityLabel={segment.label}
              accessibilityState={{ selected: segment.selected }}
              onPress={segment.onPress}
              style={s.segmentTarget}
            >
              <View
                style={[
                  s.segmentFill,
                  { backgroundColor: segment.selected ? theme.textPrimary : theme.surfaceMuted },
                ]}
              >
                <Text
                  numberOfLines={1}
                  maxFontSizeMultiplier={REPORT_TEXT_CAP.control}
                  style={[s.segmentText, { color: segment.selected ? theme.background : theme.textPrimary }]}
                >
                  {segment.label}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Text
        accessibilityLabel={caption}
        numberOfLines={1}
        maxFontSizeMultiplier={REPORT_TEXT_CAP.control}
        style={[s.caption, { color: theme.textSecondary }]}
      >
        {caption}
      </Text>
      <View style={s.calendar}>
        <DatePickerCalendar
          month={month}
          onMonthChange={onMonthChange}
          start={start}
          end={end}
          today={today}
          maxDate={maxDate}
          onSelect={onSelectDay}
          theme={theme}
          reduceMotion={reduceMotion}
        />
      </View>
      {notice ? (
        <Text accessibilityRole="alert" style={{ color: theme.warningText }}>
          {notice}
        </Text>
      ) : null}
    </BottomSheetShell>
  );
}

const s = StyleSheet.create({
  head: { gap: 2, marginHorizontal: 10, marginBottom: 6 },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 0.7 },
  title: { fontFamily: MOBILE_DISPLAY_FONT.bold, fontSize: 20 },
  segments: { flexDirection: "row", gap: 6, marginHorizontal: 10 },
  segmentTarget: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: "center" },
  segmentFill: {
    height: 34,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  segmentText: { fontSize: 14, fontWeight: "600" },
  caption: { minHeight: 24, marginHorizontal: 10, fontSize: 14 },
  calendar: { alignSelf: "center", width: "100%", maxWidth: DATE_PICKER_CALENDAR_MAX_WIDTH },
});
