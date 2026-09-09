import { useState } from "react";
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
  addLocalDays,
  formatLocalDateKey,
  parseLocalDate,
  startOfLocalWeek,
  validateCustomRange,
} from "@/lib/reportsRanges";
import {
  reportSelectionIncludes,
  selectAllReportFilterDraft,
  toggleReportFilterDraftKey,
  type ReportCategoryOption,
  type ReportFilterDraft,
} from "@/lib/reportsSelection";

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
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onPress}
      style={[s.option, { borderBottomColor: theme.border }]}
    >
      {color ? <View style={[s.dot, { backgroundColor: color }]} /> : null}
      <Text style={[s.optionText, { color: theme.textPrimary }]}>{label}</Text>
      <View
        style={[
          s.checkbox,
          {
            backgroundColor: checked ? theme.accentSoft : theme.surfaceInset,
            borderColor: theme.borderStrong,
          },
        ]}
      >
        {checked ? (
          <View
            style={{
              height: checked === "mixed" ? 2 : 10,
              width: 10,
              borderRadius: 2,
              backgroundColor: theme.accentText,
            }}
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
  initial: { start: string; end: string } | null;
  nowMs: number;
  theme: MobileTheme;
  reduceMotion: boolean;
  onCancel: () => void;
  onApply: (range: { start: string; end: string }) => void;
}) {
  const today = formatLocalDateKey(new Date(nowMs));
  const [first, setFirst] = useState<string | null>(initial?.start ?? null);
  const [second, setSecond] = useState<string | null>(initial?.end ?? null);
  const [month, setMonth] = useState(() => {
    const date = parseLocalDate(initial?.start ?? today)!;
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const result =
    first && second ? validateCustomRange(first, second, nowMs) : null;
  const start = first && second ? (first < second ? first : second) : first;
  const end = first && second ? (first < second ? second : first) : first;
  const gridStart = startOfLocalWeek(month);
  const dayCount =
    Math.ceil(
      (new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate() +
        ((month.getDay() + 6) % 7)) /
        7,
    ) * 7;
  return (
    <ReportSheet
      title="Custom range"
      theme={theme}
      reduceMotion={reduceMotion}
      onCancel={onCancel}
      action="Done"
      disabled={!result?.value}
      onApply={() => {
        if (result?.value) onApply(result.value);
      }}
    >
      <Text style={{ color: theme.textSecondary }}>
        {first
          ? second
            ? `${start} – ${end}`
            : "Choose the end date"
          : "Choose the start date"}
      </Text>
      <View style={s.monthHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          onPress={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
          }
          style={s.action}
        >
          <Text style={{ color: theme.textPrimary }}>Previous</Text>
        </Pressable>
        <Text style={[s.monthTitle, { color: theme.textPrimary }]}>
          {month.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          disabled={
            month.getFullYear() === new Date(nowMs).getFullYear() &&
            month.getMonth() === new Date(nowMs).getMonth()
          }
          onPress={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
          }
          style={s.action}
        >
          <Text style={{ color: theme.textPrimary }}>Next</Text>
        </Pressable>
      </View>
      <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ flex: 1, minWidth: 308 }}>
          <View style={s.week}>
            {["M", "T", "W", "T", "F", "S", "S"].map((label, i) => (
              <Text key={i} style={[s.weekday, { color: theme.textSecondary }]}>
                {label}
              </Text>
            ))}
          </View>
          {Array.from({ length: dayCount / 7 }, (_, row) => (
            <View key={row} style={s.week}>
              {Array.from({ length: 7 }, (_, column) => {
                const day = addLocalDays(gridStart, row * 7 + column);
                const key = formatLocalDateKey(day);
                const selected = Boolean(
                  start && end && key >= start && key <= end,
                );
                const endpoint = key === first || key === second;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    accessibilityLabel={day.toLocaleDateString(undefined, {
                      dateStyle: "full",
                    })}
                    accessibilityState={{ disabled: key > today, selected }}
                    disabled={key > today}
                    onPress={() => {
                      if (!first || second) {
                        setFirst(key);
                        setSecond(null);
                      } else setSecond(key);
                    }}
                    style={[
                      s.day,
                      {
                        backgroundColor: endpoint
                          ? theme.accent
                          : selected
                            ? theme.accentSoft
                            : "transparent",
                        opacity: key > today ? 0.4 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        color: endpoint
                          ? theme.onAccent
                          : day.getMonth() === month.getMonth()
                            ? theme.textPrimary
                            : theme.textSecondary,
                      }}
                    >
                      {day.getDate()}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
      {result?.error ? (
        <Text accessibilityRole="alert" style={{ color: theme.warningText }}>
          {result.error}
        </Text>
      ) : null}
    </ReportSheet>
  );
}
function ReportSheet({
  title,
  theme,
  reduceMotion,
  onCancel,
  onApply,
  action,
  disabled = false,
  children,
}: {
  title: string;
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
          style={[
            s.sheet,
            {
              backgroundColor: theme.surfaceRaised,
              paddingBottom: Math.max(16, insets.bottom),
            },
          ]}
        >
          <View style={s.header}>
            <Text style={[s.title, { color: theme.textPrimary }]}>{title}</Text>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel={`Cancel ${title}`}
              style={s.action}
            >
              <Text style={{ color: theme.textSecondary }}>Cancel</Text>
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 8 }}
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
              style={{
                color: disabled ? theme.textSecondary : theme.onAccent,
                fontWeight: "600",
              }}
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
    maxHeight: "86%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 16,
    gap: 12,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { flex: 1, fontSize: 22, fontWeight: "600" },
  action: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  apply: {
    minHeight: 48,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  search: { minHeight: 48, padding: 12, borderRadius: 12, fontSize: 16 },
  option: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionText: { flex: 1, fontSize: 15 },
  dot: { height: 10, width: 10, borderRadius: 5 },
  checkbox: {
    height: 24,
    width: 24,
    borderWidth: 1,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  monthHeader: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  monthTitle: { flex: 1, textAlign: "center", fontWeight: "600" },
  week: { flexDirection: "row" },
  weekday: { flex: 1, minWidth: 44, textAlign: "center" },
  day: {
    flex: 1,
    minWidth: 44,
    minHeight: 44,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
});
