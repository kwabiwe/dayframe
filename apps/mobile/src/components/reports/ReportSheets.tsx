import { useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { MobileTheme } from "@/lib/mobileTheme";
import {
  formatLocalDateKey,
  parseLocalDate,
  type ReportRangeChoice,
  type ReportPreset,
} from "@/lib/reportsRanges";
import {
  openReportDateDraft,
  reportDraftHighlight,
  reportDraftResult,
  selectReportDraftDay,
} from "@/lib/reportDateDraft";
import { REPORT_TEXT_CAP } from "@/lib/reportsTypography";
import {
  reportSelectionIncludes,
  selectAllReportFilterDraft,
  toggleReportFilterDraftKey,
  type ReportCategoryOption,
  type ReportFilterDraft,
} from "@/lib/reportsSelection";
import {
  CalendarGlyph,
  DatePickerCalendar,
} from "@/components/calendar/DatePickerCalendar";

export function ReportFiltersSheet({
  draft,
  options,
  theme,
  reduceMotion,
  onChange,
  onCancel,
  onApply,
}: {
  draft: ReportFilterDraft;
  options: ReportCategoryOption[];
  theme: MobileTheme;
  reduceMotion: boolean;
  onChange: (draft: ReportFilterDraft) => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const [search, setSearch] = useState("");
  return (
    <ReportSheet
      title="Categories"
      theme={theme}
      reduceMotion={reduceMotion}
      onCancel={onCancel}
      action="Apply"
      onApply={onApply}
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
        .filter((o) =>
          o.name
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
  initial,
  nowMs,
  theme,
  reduceMotion,
  onCancel,
  onApply,
}: {
  initial: ReportRangeChoice;
  nowMs: number;
  theme: MobileTheme;
  reduceMotion: boolean;
  onCancel: () => void;
  onApply: (range: ReportRangeChoice) => void;
}) {
  const [draft, setDraft] = useState(() => openReportDateDraft(initial, nowMs));
  const applied = useRef(false);
  const result = reportDraftResult(draft, nowMs);
  const highlight = reportDraftHighlight(draft, nowMs);
  const readable = (key: string) =>
    parseLocalDate(key)!.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  return (
    <ReportSheet
      title="Choose report dates"
      hideTitle
      theme={theme}
      reduceMotion={reduceMotion}
      onCancel={onCancel}
      action="Done"
      disabled={!result.value}
      onApply={() => {
        const current = reportDraftResult(draft, nowMs);
        if (current.value && !applied.current) {
          applied.current = true;
          onApply(current.value);
        }
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.presets}
      >
        {(["today", "week", "month", "year"] as ReportPreset[]).map(
          (preset) => (
            <Pressable
              key={preset}
              accessibilityRole="button"
              accessibilityLabel={preset[0].toUpperCase() + preset.slice(1)}
              accessibilityState={{ selected: draft.choice === preset }}
              onPress={() => setDraft(openReportDateDraft(preset, nowMs))}
              style={[
                s.preset,
                {
                  backgroundColor:
                    draft.choice === preset
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
                    color:
                      draft.choice === preset
                        ? theme.accentText
                        : theme.textPrimary,
                  },
                ]}
              >
                {preset[0].toUpperCase() + preset.slice(1)}
              </Text>
            </Pressable>
          ),
        )}
      </ScrollView>
      <Text style={{ color: theme.textSecondary }}>
        {draft.choice && highlight.start && highlight.end
          ? `${readable(highlight.start)} – ${readable(highlight.end)}`
          : "Choose the end date"}
      </Text>
      <View style={s.calendar}>
        <DatePickerCalendar
          month={draft.displayedMonth}
          onMonthChange={(displayedMonth) =>
            setDraft((d) => ({ ...d, displayedMonth }))
          }
          start={highlight.start}
          end={highlight.end}
          today={formatLocalDateKey(new Date(nowMs))}
          maxDate={formatLocalDateKey(new Date(nowMs))}
          onSelect={(date) =>
            setDraft((d) =>
              selectReportDraftDay(d, formatLocalDateKey(date), nowMs),
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
function ReportSheet({
  title,
  hideTitle = false,
  theme,
  reduceMotion,
  onCancel,
  onApply,
  action,
  disabled = false,
  children,
}: {
  title: string;
  hideTitle?: boolean;
  theme: MobileTheme;
  reduceMotion: boolean;
  onCancel: () => void;
  onApply: () => void;
  action: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      transparent
      animationType={reduceMotion ? "none" : "fade"}
      onRequestClose={onCancel}
      visible
    >
      <View style={s.modal}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]}
          accessibilityRole="button"
          accessibilityLabel={`Close ${title}`}
          onPress={onCancel}
        />
        <View
          accessibilityViewIsModal
          accessibilityLabel={title}
          onAccessibilityEscape={onCancel}
          style={[
            s.sheet,
            {
              backgroundColor: theme.surfaceRaised,
              paddingBottom: Math.max(16, insets.bottom),
            },
          ]}
        >
          <View style={s.header}>
            {!hideTitle ? (
              <Text
                maxFontSizeMultiplier={REPORT_TEXT_CAP.heading}
                style={[s.title, { color: theme.textPrimary }]}
              >
                {title}
              </Text>
            ) : null}
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel={`Cancel ${title}`}
              style={s.action}
            >
              <Text
                maxFontSizeMultiplier={REPORT_TEXT_CAP.control}
                style={[s.actionText, { color: theme.textSecondary }]}
              >
                Cancel
              </Text>
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={{ gap: 4 }}
          >
            {children}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onApply}
            style={[
              s.apply,
              { backgroundColor: disabled ? theme.surfaceMuted : theme.accent },
            ]}
          >
            <Text
              maxFontSizeMultiplier={REPORT_TEXT_CAP.control}
              style={[
                s.actionText,
                { color: disabled ? theme.textSecondary : theme.onAccent },
              ]}
            >
              {action}
            </Text>
          </Pressable>
        </View>
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
    padding: 16,
    gap: 8,
  },
  header: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 12,
  },
  title: { flex: 1, fontSize: 20, fontWeight: "600" },
  action: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  actionText: { fontSize: 14, fontWeight: "600" },
  apply: {
    minHeight: 48,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
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
  presets: { gap: 6 },
  preset: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  calendar: { marginHorizontal: -10 },
});
