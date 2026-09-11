import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dimensions,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardEvent,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  SwipeDismissSheet,
  type SwipeDismissSheetHandle,
} from "@/components/SwipeDismissSheet";
import {
  CalendarGlyph,
  DatePickerCalendar,
} from "@/components/calendar/DatePickerCalendar";
import { DATE_PICKER_CALENDAR_MAX_WIDTH } from "@/lib/datePickerGeometry";
import { keyboardInsetFromScreenY } from "@/lib/editSheetKeyboard";
import type { MobileTheme } from "@/lib/mobileTheme";
import {
  openReportDateDraft,
  reportDraftHighlight,
  reportDraftResult,
  selectReportDraftDay,
} from "@/lib/reportDateDraft";
import {
  formatLocalDateKey,
  parseLocalDate,
  type ReportRangeChoice,
  type ReportPreset,
} from "@/lib/reportsRanges";
import {
  reportSelectionIncludes,
  selectAllReportFilterDraft,
  toggleReportFilterDraftKey,
  type ReportCategoryOption,
  type ReportFilterDraft,
} from "@/lib/reportsSelection";
import { REPORT_TEXT_CAP } from "@/lib/reportsTypography";

export function ReportFiltersSheet({
  presentationId,
  draft,
  options,
  theme,
  reduceMotion,
  onChange,
  onApply,
  onDismissed,
}: {
  presentationId: number;
  draft: ReportFilterDraft;
  options: ReportCategoryOption[];
  theme: MobileTheme;
  reduceMotion: boolean;
  onChange: (draft: ReportFilterDraft) => void;
  onApply: () => boolean | void;
  onDismissed: (presentationId: number) => void;
}) {
  const [search, setSearch] = useState("");
  return (
    <ReportSheet
      title="Categories"
      presentationId={presentationId}
      theme={theme}
      reduceMotion={reduceMotion}
      action="Apply"
      onApply={onApply}
      onDismissed={onDismissed}
    >
      <TextInput
        maxFontSizeMultiplier={REPORT_TEXT_CAP.control}
        accessibilityLabel="Search categories"
        value={search}
        onChangeText={setSearch}
        placeholder="Search categories"
        placeholderTextColor={theme.textMuted}
        style={[
          s.search,
          { backgroundColor: theme.surfaceInset, color: theme.textPrimary },
        ]}
      />
      <Option
        label="All categories"
        checked={
          draft.mode === "all" ? true : draft.mode === "none" ? false : "mixed"
        }
        theme={theme}
        onPress={() => onChange(selectAllReportFilterDraft(draft))}
      />
      {options
        .filter((option) =>
          option.name
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase()),
        )
        .map((option) => (
          <Option
            key={option.key}
            label={
              option.isUnavailable
                ? `${option.name} (not currently available)`
                : option.name
            }
            checked={reportSelectionIncludes(draft, option.key)}
            theme={theme}
            color={option.color}
            onPress={() =>
              onChange(toggleReportFilterDraftKey(draft, option.key))
            }
          />
        ))}
    </ReportSheet>
  );
}

function Option({
  label,
  checked,
  theme,
  color,
  onPress,
}: {
  label: string;
  checked: boolean | "mixed";
  theme: MobileTheme;
  color?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessible
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onPress}
      style={[s.option, { borderBottomColor: theme.border }]}
    >
      {color ? <View style={[s.dot, { backgroundColor: color }]} /> : null}
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        maxFontSizeMultiplier={REPORT_TEXT_CAP.name}
        style={[s.optionText, { color: theme.textPrimary }]}
      >
        {label}
      </Text>
      <View style={s.glyphSlot}>
        {checked ? (
          <CalendarGlyph
            kind={checked === "mixed" ? "mixed" : "tick"}
            color={theme.accentText}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

export function ReportDateSheet({
  presentationId,
  initial,
  nowMs,
  theme,
  reduceMotion,
  onApply,
  onDismissed,
}: {
  presentationId: number;
  initial: ReportRangeChoice;
  nowMs: number;
  theme: MobileTheme;
  reduceMotion: boolean;
  onApply: (range: ReportRangeChoice) => boolean | void;
  onDismissed: (presentationId: number) => void;
}) {
  const [draft, setDraft] = useState(() => openReportDateDraft(initial, nowMs));
  const result = reportDraftResult(draft, nowMs);
  const highlight = reportDraftHighlight(draft, nowMs);
  const readable = (key: string) =>
    parseLocalDate(key)!.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  const rangeCaption =
    draft.choice && highlight.start && highlight.end
      ? `${readable(highlight.start)} – ${readable(highlight.end)}`
      : "Choose the end date";
  return (
    <ReportSheet
      title="Choose report dates"
      hideTitle
      calendarLayout
      presentationId={presentationId}
      theme={theme}
      reduceMotion={reduceMotion}
      action="Done"
      disabled={!result.value}
      onDismissed={onDismissed}
      onApply={() => {
        const current = reportDraftResult(draft, nowMs);
        if (!current.value) return false;
        if (onApply(current.value) === false) return false;
        return true;
      }}
    >
      <View style={s.presets}>
        {(["today", "week", "month", "year"] as ReportPreset[]).map(
          (preset) => {
            const selected = draft.choice === preset;
            const label = preset[0].toUpperCase() + preset.slice(1);
            return (
              <Pressable
                key={preset}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected }}
                onPress={() => setDraft(openReportDateDraft(preset, nowMs))}
                style={s.presetTarget}
              >
                <View
                  style={[
                    s.presetFill,
                    {
                      backgroundColor: selected
                        ? theme.accentSoft
                        : theme.surfaceMuted,
                    },
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={REPORT_TEXT_CAP.control}
                    style={[
                      s.actionText,
                      {
                        color: selected
                          ? theme.accentText
                          : theme.textPrimary,
                      },
                    ]}
                  >
                    {label}
                  </Text>
                </View>
              </Pressable>
            );
          },
        )}
      </View>
      <Text
        accessibilityLabel={rangeCaption}
        numberOfLines={1}
        maxFontSizeMultiplier={REPORT_TEXT_CAP.control}
        style={[s.rangeCaption, { color: theme.textSecondary }]}
      >
        {rangeCaption}
      </Text>
      <View style={s.calendar}>
        <DatePickerCalendar
          month={draft.displayedMonth}
          onMonthChange={(displayedMonth) =>
            setDraft((current) => ({ ...current, displayedMonth }))
          }
          start={highlight.start}
          end={highlight.end}
          today={formatLocalDateKey(new Date(nowMs))}
          maxDate={formatLocalDateKey(new Date(nowMs))}
          onSelect={(date) =>
            setDraft((current) =>
              selectReportDraftDay(
                current,
                formatLocalDateKey(date),
                nowMs,
              ),
            )
          }
          theme={theme}
          reduceMotion={reduceMotion}
        />
      </View>
      {draft.choice && result.error ? (
        <Text accessibilityRole="alert" style={{ color: theme.warningText }}>
          {result.error}
        </Text>
      ) : null}
    </ReportSheet>
  );
}

type ReportSheetOutcome = "commit" | "discard";

function ReportSheet({
  title,
  hideTitle = false,
  calendarLayout = false,
  presentationId,
  theme,
  reduceMotion,
  onApply,
  onDismissed,
  action,
  disabled = false,
  children,
}: {
  title: string;
  hideTitle?: boolean;
  calendarLayout?: boolean;
  presentationId: number;
  theme: MobileTheme;
  reduceMotion: boolean;
  onApply: () => boolean | void;
  onDismissed: (presentationId: number) => void;
  action: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const sheetRef = useRef<SwipeDismissSheetHandle>(null);
  const outcome = useRef<{
    presentationId: number;
    value: ReportSheetOutcome;
  } | null>(null);
  const [closing, setClosing] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    outcome.current = null;
    setClosing(false);
  }, [presentationId]);

  useEffect(() => {
    const update = (event: KeyboardEvent) => {
      Keyboard.scheduleLayoutAnimation(event);
      setKeyboardInset(
        keyboardInsetFromScreenY({
          keyboardScreenY: event.endCoordinates.screenY,
          screenHeight: Dimensions.get("screen").height,
          windowHeight,
        }),
      );
    };
    const change = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow",
      update,
    );
    const show =
      Platform.OS === "ios"
        ? Keyboard.addListener("keyboardDidShow", update)
        : null;
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      (event) => {
        Keyboard.scheduleLayoutAnimation(event);
        setKeyboardInset(0);
      },
    );
    const didHide =
      Platform.OS === "ios"
        ? Keyboard.addListener("keyboardDidHide", () => setKeyboardInset(0))
        : null;
    return () => {
      change.remove();
      show?.remove();
      hide.remove();
      didHide?.remove();
    };
  }, [windowHeight]);

  const claimDiscard = useCallback(() => {
    if (outcome.current?.presentationId !== presentationId)
      outcome.current = null;
    if (outcome.current) return outcome.current.value === "discard";
    outcome.current = { presentationId, value: "discard" };
    setClosing(true);
    return true;
  }, [presentationId]);

  const requestCommit = () => {
    if (outcome.current?.presentationId !== presentationId)
      outcome.current = null;
    if (disabled || outcome.current) return;
    if (onApply() === false) return;
    outcome.current = { presentationId, value: "commit" };
    setClosing(true);
    sheetRef.current?.dismiss();
  };

  const requestDiscard = () => sheetRef.current?.dismiss();

  return (
    <Modal
      transparent
      animationType="none"
      onRequestClose={requestDiscard}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      visible
    >
      <View style={s.modal}>
        <SwipeDismissSheet
          ref={sheetRef}
          accessibilityLabel={title}
          backdropAccessibilityLabel={`Close ${title}`}
          backdropStyle={[
            StyleSheet.absoluteFill,
            { backgroundColor: theme.overlay },
          ]}
          disabled={closing}
          gestureHandleOnly
          handleAccessory={
            <Pressable
              onPress={requestDiscard}
              accessibilityRole="button"
              accessibilityLabel={`Cancel ${title}`}
              disabled={closing}
              style={s.action}
            >
              <Text
                maxFontSizeMultiplier={REPORT_TEXT_CAP.control}
                style={[s.actionText, { color: theme.textSecondary }]}
              >
                Cancel
              </Text>
            </Pressable>
          }
          handleStyle={[s.handle, { backgroundColor: theme.textMuted }]}
          keyboardInset={keyboardInset}
          onDismiss={(dismissedPresentationId) => {
            if (dismissedPresentationId !== presentationId) return;
            onDismissed(dismissedPresentationId);
          }}
          onDismissStart={(dismissedPresentationId) => {
            if (dismissedPresentationId !== presentationId) return false;
            return outcome.current?.presentationId === presentationId
              ? true
              : claimDiscard();
          }}
          onGestureStart={() => Keyboard.dismiss()}
          presentationId={presentationId}
          reduceMotion={reduceMotion}
          style={[
            s.sheet,
            calendarLayout ? s.dateSheet : null,
            {
              backgroundColor: theme.surfaceRaised,
              paddingBottom: Math.max(
                16,
                insets.bottom,
                keyboardInset + 16,
              ),
            },
          ]}
          testID={calendarLayout ? "report-date-sheet" : "report-filter-sheet"}
          visible
        >
          <View
            accessibilityElementsHidden={closing}
            importantForAccessibility={closing ? "no-hide-descendants" : "auto"}
            pointerEvents={closing ? "none" : "auto"}
            style={s.sheetContent}
          >
            {!hideTitle ? (
              <Text
                maxFontSizeMultiplier={REPORT_TEXT_CAP.heading}
                style={[s.title, { color: theme.textPrimary }]}
              >
                {title}
              </Text>
            ) : null}
            <ScrollView
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={s.body}
              style={s.scroll}
            >
              {children}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={action}
              accessibilityState={{ disabled: disabled || closing }}
              disabled={disabled || closing}
              onPress={requestCommit}
              style={[
                s.apply,
                calendarLayout ? s.dateInset : null,
                {
                  backgroundColor:
                    disabled || closing ? theme.surfaceMuted : theme.accent,
                },
              ]}
            >
              <Text
                maxFontSizeMultiplier={REPORT_TEXT_CAP.control}
                style={[
                  s.actionText,
                  {
                    color:
                      disabled || closing
                        ? theme.textSecondary
                        : theme.onAccent,
                  },
                ]}
              >
                {action}
              </Text>
            </Pressable>
          </View>
        </SwipeDismissSheet>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  modal: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    maxHeight: "90%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  dateSheet: { paddingHorizontal: 6 },
  sheetContent: { flexShrink: 1, gap: 8 },
  handle: { width: 42, height: 5, borderRadius: 3 },
  title: {
    paddingRight: 84,
    fontSize: 20,
    fontWeight: "600",
  },
  action: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  actionText: { fontSize: 14, fontWeight: "600" },
  scroll: { flexShrink: 1 },
  body: { gap: 4 },
  apply: {
    minHeight: 48,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  dateInset: { marginHorizontal: 10 },
  search: { minHeight: 44, padding: 10, borderRadius: 12, fontSize: 15 },
  option: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionText: { flex: 1, minWidth: 0, fontSize: 14 },
  dot: { height: 10, width: 10, borderRadius: 5 },
  glyphSlot: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  presets: {
    flexDirection: "row",
    gap: 6,
    marginHorizontal: 10,
  },
  presetTarget: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    justifyContent: "center",
  },
  presetFill: {
    height: 34,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  rangeCaption: {
    minHeight: 24,
    marginHorizontal: 10,
    fontSize: 14,
  },
  calendar: {
    alignSelf: "center",
    width: "100%",
    maxWidth: DATE_PICKER_CALENDAR_MAX_WIDTH,
  },
});
