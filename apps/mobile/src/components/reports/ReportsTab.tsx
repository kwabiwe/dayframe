import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  AppState,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  findNodeHandle,
  type AppStateStatus
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DonutChart } from "@/components/charts/DonutChart";
import { SegmentedPillControl } from "@/components/SegmentedPillControl";
import type { MobileBootstrap } from "@/lib/api";
import type { MobileStyles, MobileTheme } from "@/lib/mobileTheme";
import { MOBILE_MOTION, useResolvedReduceMotionPreference } from "@/lib/motion";
import { buildReportsPresentation, type ReportCategoryDuration } from "@/lib/reportsPresentation";
import {
  applyReportFilterDraft,
  openReportFilterDraft,
  refreshReportFilterDraft,
  selectAllReportFilterDraft,
  toggleReportCategory,
  toggleReportFilterDraftKey,
  type ReportCategorySelection,
  type ReportFilterDraft
} from "@/lib/reportsSelection";
import { REVIEW_COPY } from "@/lib/review";

type ReportRange = "today" | "week";
type ReportChartView = "pie" | "bars";

export function ReportsTab({
  data,
  isFocused,
  nowMs,
  styles: sharedStyles,
  theme
}: {
  data: MobileBootstrap;
  isFocused: boolean;
  nowMs: number;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  const [range, setRange] = useState<ReportRange>("today");
  const [chartView, setChartView] = useState<ReportChartView>("pie");
  const [selection, setSelection] = useState<ReportCategorySelection>({ mode: "all" });
  const [filterDraft, setFilterDraft] = useState<ReportFilterDraft | null>(null);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const hasPresentedDonut = useRef(false);
  const filterButtonRef = useRef<View>(null);
  const stableCategoryOrder = useRef<string[]>([]);
  const focusedNowRef = useRef(nowMs);
  const liveReportNowMs = data.activeEntry ? nowMs : Math.floor(nowMs / 60_000) * 60_000;
  if (isFocused) focusedNowRef.current = liveReportNowMs;
  const reportNowMs = isFocused ? liveReportNowMs : focusedNowRef.current;
  const { reduceMotion, resolved: reduceMotionResolved } = useResolvedReduceMotionPreference();

  const report = useMemo(
    () => buildReportsPresentation({ data, nowMs: reportNowMs, period: range, selection, themeMode: theme.mode }),
    [data, reportNowMs, range, selection, theme.mode]
  );
  const segments = useMemo(() => {
    stableCategoryOrder.current = [
      ...stableCategoryOrder.current,
      ...report.allCategorySegments.map((segment) => segment.key).filter(
        (key) => !stableCategoryOrder.current.includes(key)
      )
    ];
    const order = new Map(stableCategoryOrder.current.map((key, index) => [key, index]));
    return [...report.allCategorySegments].sort(
      (left, right) => (order.get(left.key) ?? 0) - (order.get(right.key) ?? 0)
    );
  }, [report.allCategorySegments]);
  const shouldAnimateEntrance =
    isFocused && appState === "active" && chartView === "pie" && report.contextDurationMs > 0 &&
    reduceMotionResolved && !hasPresentedDonut.current;

  useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (shouldAnimateEntrance) hasPresentedDonut.current = true;
  }, [shouldAnimateEntrance]);

  useEffect(() => {
    if (!isFocused) setFilterDraft(null);
  }, [isFocused]);

  useEffect(() => {
    if (!filterDraft) return;
    setFilterDraft((draft) => draft
      ? refreshReportFilterDraft(draft, report.filterOptions.map((option) => option.key))
      : null);
  }, [report.filterOptions]);

  const closeFilters = (restoreFocus: boolean) => {
    setFilterDraft(null);
    if (restoreFocus) {
      requestAnimationFrame(() => {
        const node = findNodeHandle(filterButtonRef.current);
        if (node) AccessibilityInfo.setAccessibilityFocus(node);
      });
    }
  };
  const filteredCount = selection.mode === "include" ? selection.keys.length : 0;
  const partialSelected = report.dataQuality.selectedPeriod !== "complete";
  const partialWeek = report.dataQuality.currentWeek !== "complete";
  const selectedCategoriesHaveNoTime =
    selection.mode === "include" && report.selectedLoggedSeconds === 0;

  return (
    <View style={sharedStyles.tabScreenStack}>
      <View style={sharedStyles.panel}>
        <Text style={sharedStyles.reportScreenTitle}>Reports</Text>
        <SegmentedPillControl
          accessibilityLabel="Report period"
          onChange={setRange}
          options={[
            { label: "Today", value: "today", accessibilityLabel: "Show today reports" },
            { label: "Week", value: "week", accessibilityLabel: "Show this week reports" }
          ]}
          theme={theme}
          value={range}
        />
        <View style={localStyles.totalRow}>
          <SummaryCard label="Total logged" theme={theme} value={formatDuration(report.selectedLoggedSeconds)} />
          <SummaryCard label="Time covered" theme={theme} value={formatDuration(report.selectedCoveredSeconds)} />
        </View>
        <Text style={[localStyles.supportingCopy, { color: theme.textSecondary }]}>
          {overlapCopy(report.selectedAdditionalOverlapSeconds)}
        </Text>
        {partialSelected ? <DataQualityNotice quality={report.dataQuality.selectedPeriod} theme={theme} /> : null}
      </View>

      <View style={sharedStyles.lifecyclePanel}>
        <View style={localStyles.chartHeader}>
          <Text style={sharedStyles.sectionTitle}>{range === "today" ? "Today" : "This week"}</Text>
          <SegmentedPillControl
            accessibilityLabel="Category chart type"
            onChange={setChartView}
            options={[{ label: "Pie", value: "pie" }, { label: "Bars", value: "bars" }]}
            theme={theme}
            value={chartView}
          />
        </View>
        {partialSelected ? <DataQualityNotice quality={report.dataQuality.selectedPeriod} theme={theme} /> : null}
        <View style={localStyles.filterRow}>
          {selection.mode === "include" ? (
            <Pressable accessibilityRole="button" onPress={() => setSelection({ mode: "all" })} style={localStyles.textAction}>
              <Text style={[localStyles.textActionLabel, { color: theme.textSecondary }]}>Clear</Text>
            </Pressable>
          ) : <View />}
          <Pressable
            ref={filterButtonRef}
            accessibilityLabel={filteredCount > 0 ? `Filters, ${filteredCount} categories selected` : "Filters"}
            accessibilityRole="button"
            onPress={() => setFilterDraft(openReportFilterDraft(selection, report.filterOptions.map((option) => option.key)))}
            style={({ pressed }) => [localStyles.filterButton, { backgroundColor: theme.surfaceMuted }, pressed && localStyles.pressed]}
          >
            <Text style={[localStyles.filterButtonLabel, { color: theme.textPrimary }]}>
              {filteredCount > 0 ? `Filters (${filteredCount})` : "Filters"}
            </Text>
          </Pressable>
        </View>
        {report.hasSuggestedActivity ? <Text style={sharedStyles.reviewNote}>{REVIEW_COPY.suggestedNote}</Text> : null}
        {selection.mode === "include" ? (
          <Text style={[localStyles.contextCopy, { color: theme.textSecondary }]}>Slices show all categories; totals show selected categories. Percentages are of all time.</Text>
        ) : null}
        {selectedCategoriesHaveNoTime ? (
          <Text accessibilityLiveRegion="polite" style={[localStyles.emptySelection, { color: theme.textSecondary }]}>{partialSelected ? "No selected entries are available in this report data." : "No logged time for the selected categories."}</Text>
        ) : null}

        {chartView === "pie" ? (
          <Animated.View key="pie" testID="reports-pie-chart" entering={FadeIn.duration(reduceMotion ? 0 : MOBILE_MOTION.control)} exiting={FadeOut.duration(reduceMotion ? 0 : MOBILE_MOTION.control)}>
            <View style={localStyles.chartWrap}>
              <DonutChart
                animateEntrance={shouldAnimateEntrance}
                centerLabel="Total logged"
                centerValue={formatDuration(report.selectedLoggedSeconds)}
                onSegmentPress={(key) => setSelection((current) => toggleReportCategory(current, key))}
                reduceMotion={reduceMotion}
                segments={segments.map((segment) => ({
                  id: segment.key,
                  value: segment.durationMs,
                  color: segment.color,
                  selected: segment.selected,
                  isUncategorized: segment.isUncategorized
                }))}
                settleImmediately={!isFocused || appState !== "active"}
                theme={theme}
              />
            </View>
            {segments.length === 0 && !selectedCategoriesHaveNoTime ? (
              <EmptyReportCopy partial={partialSelected} selected={selection.mode === "include"} theme={theme} />
            ) : segments.length > 0 ? (
              <CategoryLegend
                contextDurationMs={report.contextDurationMs}
                onToggle={(key) => setSelection((current) => toggleReportCategory(current, key))}
                segments={segments}
                theme={theme}
              />
            ) : null}
          </Animated.View>
        ) : (
          <Animated.View key="bars" testID="reports-bars-chart" entering={FadeIn.duration(reduceMotion ? 0 : MOBILE_MOTION.control)} exiting={FadeOut.duration(reduceMotion ? 0 : MOBILE_MOTION.control)}>
            {selectedCategoriesHaveNoTime ? null : segments.length === 0 ? (
              <EmptyReportCopy partial={partialSelected} selected={false} theme={theme} />
            ) : (
              <CategoryBars segments={segments.filter((segment) => segment.selected)} theme={theme} />
            )}
          </Animated.View>
        )}
      </View>

      <View style={sharedStyles.panel}>
        <Text style={sharedStyles.label}>Daily bars</Text>
        <Text style={sharedStyles.sectionTitle}>Current week</Text>
        {partialWeek ? <DataQualityNotice quality={report.dataQuality.currentWeek} theme={theme} /> : null}
        <DailyBars bars={report.selectedWeekDailyBars} theme={theme} />
      </View>

      <ReportFiltersSheet
        draft={filterDraft}
        onApply={(draft) => {
          const applied = applyReportFilterDraft(draft);
          if (!applied) return;
          setSelection(applied);
          closeFilters(true);
        }}
        onCancel={() => closeFilters(true)}
        onChange={setFilterDraft}
        options={report.filterOptions}
        theme={theme}
      />
    </View>
  );
}

function SummaryCard({ label, theme, value }: { label: string; theme: MobileTheme; value: string }) {
  return <View style={[localStyles.totalCard, { backgroundColor: theme.surfaceMuted }]}><Text style={[localStyles.cardLabel, { color: theme.textSecondary }]}>{label}</Text><Text style={[localStyles.cardValue, { color: theme.textPrimary }]}>{value}</Text></View>;
}

function DataQualityNotice({ quality, theme }: { quality: "complete" | "partial" | "unknown"; theme: MobileTheme }) {
  return <Text accessibilityLiveRegion="polite" style={[localStyles.quality, { color: theme.warningText }]}>{quality === "partial" ? "Partial report — based on available entries." : "Report completeness is unknown — based on available entries."}</Text>;
}

function EmptyReportCopy({ partial, selected, theme }: { partial: boolean; selected: boolean; theme: MobileTheme }) {
  const copy = partial ? "No entries are available for this report window." : selected ? "No logged time for the selected categories." : "No tracked time yet.";
  return <Text style={[localStyles.empty, { color: theme.textSecondary }]}>{copy}</Text>;
}

function CategoryLegend({ contextDurationMs, onToggle, segments, theme }: { contextDurationMs: number; onToggle: (key: string) => void; segments: ReportCategoryDuration[]; theme: MobileTheme }) {
  return <View style={localStyles.legendList}>{segments.map((segment) => <Pressable key={segment.key} accessibilityLabel={`${segment.categoryName}, ${formatDuration(segment.durationMs / 1000)}, ${formatPercent(segment.durationMs, contextDurationMs)} of all time, ${segment.selected ? "included" : "not included"}`} accessibilityRole="button" accessibilityState={{ selected: segment.selected }} onPress={() => onToggle(segment.key)} style={({ pressed }) => [localStyles.legendRow, pressed && localStyles.pressed]}><CategorySwatch segment={segment} theme={theme} /><View style={localStyles.legendText}><Text style={[localStyles.legendName, { color: theme.textPrimary }]}>{segment.categoryName}</Text><Text style={[localStyles.legendState, { color: theme.textSecondary }]}>{segment.selected ? "Included" : "Not included"}</Text></View><View style={localStyles.legendNumbers}><Text style={[localStyles.legendDuration, { color: theme.textPrimary }]}>{formatDuration(segment.durationMs / 1000)}</Text><Text style={[localStyles.legendPercent, { color: theme.textSecondary }]}>{formatPercent(segment.durationMs, contextDurationMs)}</Text></View></Pressable>)}</View>;
}

function CategorySwatch({ segment, theme }: { segment: ReportCategoryDuration; theme: MobileTheme }) {
  return <View style={[localStyles.swatch, { backgroundColor: segment.color, borderColor: segment.isUncategorized ? theme.borderStrong : segment.color, opacity: segment.selected ? 1 : 0.35 }]} />;
}

function CategoryBars({ segments, theme }: { segments: ReportCategoryDuration[]; theme: MobileTheme }) {
  const max = Math.max(...segments.map((segment) => segment.durationMs));
  return <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={localStyles.categoryBars} directionalLockEnabled>{segments.map((segment) => <View key={segment.key} accessible accessibilityLabel={`${segment.categoryName}, ${formatDuration(segment.durationMs / 1000)}`} style={localStyles.categoryBarColumn}><Text style={[localStyles.barDuration, { color: theme.textPrimary }]}>{formatDuration(segment.durationMs / 1000)}</Text><View style={[localStyles.categoryBarTrack, { backgroundColor: theme.chartTrack }]}><View style={[localStyles.categoryBarFill, { backgroundColor: segment.color, height: `${(segment.durationMs / max) * 100}%` }]} /></View><Text style={[localStyles.barName, { color: theme.textSecondary }]}>{segment.categoryName}</Text></View>)}</ScrollView>;
}

function DailyBars({ bars, theme }: { bars: Array<{ key: string; label: string; durationMs: number }>; theme: MobileTheme }) {
  const max = Math.max(0, ...bars.map((bar) => bar.durationMs));
  return <View style={localStyles.dailyChart}>{bars.map((bar) => <View key={bar.key} accessible accessibilityLabel={`${bar.label}: ${formatDuration(bar.durationMs / 1000)}`} style={localStyles.dailySlot}><View style={[localStyles.dailyTrack, { backgroundColor: theme.chartTrack }]}>{bar.durationMs > 0 && max > 0 ? <View style={[localStyles.dailyFill, { backgroundColor: theme.accent, height: `${(bar.durationMs / max) * 100}%` }]} /> : null}</View><Text style={[localStyles.dailyLabel, { color: theme.textSecondary }]}>{bar.label}</Text></View>)}</View>;
}

function ReportFiltersSheet({ draft, onApply, onCancel, onChange, options, theme }: { draft: ReportFilterDraft | null; onApply: (draft: ReportFilterDraft) => void; onCancel: () => void; onChange: (draft: ReportFilterDraft | null) => void; options: Array<{ key: string; name: string; color: string; isUnavailable: boolean }>; theme: MobileTheme }) {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  useEffect(() => { if (!draft) setSearch(""); }, [draft]);
  if (!draft) return null;
  const visibleOptions = options.filter((option) => option.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const applyDisabled = draft.mode === "include" && draft.keys.length === 0;
  return <Modal animationType="fade" onRequestClose={onCancel} transparent visible><View style={localStyles.modalRoot}><Pressable accessibilityLabel="Close filters" accessibilityRole="button" onPress={onCancel} style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]} /><View accessibilityViewIsModal style={[localStyles.sheet, { backgroundColor: theme.surfaceRaised, paddingBottom: Math.max(24, insets.bottom + 12) }]}><View style={localStyles.sheetHeader}><View><Text style={[localStyles.sheetTitle, { color: theme.textPrimary }]}>Filters</Text><Text style={[localStyles.sheetSection, { color: theme.textSecondary }]}>Categories</Text></View><Pressable accessibilityLabel="Cancel filters" accessibilityRole="button" onPress={onCancel} style={localStyles.sheetAction}><Text style={[localStyles.sheetActionText, { color: theme.textSecondary }]}>Cancel</Text></Pressable></View><TextInput accessibilityLabel="Search categories" onChangeText={setSearch} placeholder="Search categories" placeholderTextColor={theme.textMuted} style={[localStyles.search, { backgroundColor: theme.surfaceInset, color: theme.textPrimary }]} value={search} /><ScrollView keyboardShouldPersistTaps="handled" style={localStyles.optionScroller}><FilterOption checked={draft.mode === "all"} color={theme.accent} label="All categories" onPress={() => onChange(selectAllReportFilterDraft(draft))} theme={theme} />{visibleOptions.map((option) => <FilterOption key={option.key} checked={draft.mode === "all" || draft.keys.includes(option.key)} color={option.color} label={option.isUnavailable ? `${option.name} (not currently available)` : option.name} onPress={() => onChange(toggleReportFilterDraftKey(draft, option.key))} theme={theme} />)}</ScrollView>{applyDisabled ? <Text style={[localStyles.validation, { color: theme.warningText }]}>Choose at least one category, or select All categories.</Text> : null}<Pressable accessibilityLabel="Apply filters" accessibilityRole="button" accessibilityState={{ disabled: applyDisabled }} disabled={applyDisabled} onPress={() => onApply(draft)} style={[localStyles.applyButton, { backgroundColor: applyDisabled ? theme.surfaceMuted : theme.accent }]}><Text style={[localStyles.applyText, { color: applyDisabled ? theme.disabled : theme.onAccent }]}>Apply</Text></Pressable></View></View></Modal>;
}

function FilterOption({ checked, color, label, onPress, theme }: { checked: boolean; color: string; label: string; onPress: () => void; theme: MobileTheme }) {
  return <Pressable accessibilityLabel={label} accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={onPress} style={({ pressed }) => [localStyles.optionRow, { borderBottomColor: theme.border }, pressed && localStyles.pressed]}><View style={[localStyles.optionSwatch, { backgroundColor: color }]} /><Text style={[localStyles.optionLabel, { color: theme.textPrimary }]}>{label}</Text><View style={[localStyles.check, { backgroundColor: checked ? theme.accentSoft : theme.surfaceInset, borderColor: checked ? theme.accent : theme.borderStrong }]}>{checked ? <View style={[localStyles.checkMark, { backgroundColor: theme.accentText }]} /> : null}</View></Pressable>;
}

function overlapCopy(seconds: number) {
  if (seconds <= 0) return "No additional overlapping time is counted in this selection. Total logged and Time covered are the same.";
  return `${formatCompactOverlap(seconds)} overlaps another activity. Total logged counts every entry; Time covered counts overlapping time once.`;
}

function formatCompactOverlap(seconds: number) { return seconds < 60 ? "<1m" : formatDuration(seconds); }
function formatDuration(seconds: number) { const safe = Math.max(0, Math.floor(seconds)); if (safe > 0 && safe < 60) return "<1m"; const hours = Math.floor(safe / 3600); const minutes = Math.floor((safe % 3600) / 60); if (hours === 0) return `${minutes}m`; return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`; }
function formatPercent(value: number, total: number) { if (value <= 0 || total <= 0) return "0%"; const percent = (value / total) * 100; return percent < 1 ? "<1%" : `${Math.round(percent)}%`; }

const localStyles = StyleSheet.create({
  applyButton: { alignItems: "center", borderRadius: 999, justifyContent: "center", minHeight: 48 },
  applyText: { fontFamily: "System", fontSize: 15, fontWeight: "700" },
  barDuration: { fontFamily: "System", fontSize: 11, fontVariant: ["tabular-nums"], fontWeight: "600" },
  barName: { fontFamily: "System", fontSize: 11, lineHeight: 14, minHeight: 28, textAlign: "center" },
  cardLabel: { fontFamily: "System", fontSize: 12, fontWeight: "600", lineHeight: 16 },
  cardValue: { fontFamily: "System", fontSize: 22, fontVariant: ["tabular-nums"], fontWeight: "700", lineHeight: 27 },
  categoryBarColumn: { alignItems: "center", gap: 6, width: 72 },
  categoryBarFill: { borderTopLeftRadius: 8, borderTopRightRadius: 8, width: "100%" },
  categoryBarTrack: { height: 132, justifyContent: "flex-end", overflow: "hidden", width: 34 },
  categoryBars: { alignItems: "flex-end", gap: 12, paddingBottom: 4, paddingTop: 12, paddingRight: 8 },
  chartHeader: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "space-between" },
  chartWrap: { alignItems: "center", paddingVertical: 12 },
  check: { alignItems: "center", borderRadius: 7, borderWidth: 1, height: 24, justifyContent: "center", width: 24 },
  checkMark: { borderRadius: 999, height: 10, width: 10 },
  contextCopy: { fontFamily: "System", fontSize: 12, lineHeight: 17 },
  dailyChart: { alignItems: "flex-end", flexDirection: "row", gap: 8, height: 150, paddingTop: 12 },
  dailyFill: { borderTopLeftRadius: 999, borderTopRightRadius: 999, width: "100%" },
  dailyLabel: { fontFamily: "System", fontSize: 11, fontWeight: "600" },
  dailySlot: { alignItems: "center", flex: 1, gap: 8, height: "100%" },
  dailyTrack: { flex: 1, justifyContent: "flex-end", overflow: "hidden", width: "100%" },
  empty: { fontFamily: "System", fontSize: 14, lineHeight: 20, paddingVertical: 18 },
  emptySelection: { fontFamily: "System", fontSize: 14, lineHeight: 20, paddingTop: 10 },
  filterButton: { alignItems: "center", borderRadius: 999, justifyContent: "center", minHeight: 44, paddingHorizontal: 14 },
  filterButtonLabel: { fontFamily: "System", fontSize: 13, fontWeight: "600" },
  filterRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 44 },
  legendDuration: { fontFamily: "System", fontSize: 13, fontVariant: ["tabular-nums"], fontWeight: "600" },
  legendList: { gap: 0 },
  legendName: { fontFamily: "System", fontSize: 14, fontWeight: "600", lineHeight: 19 },
  legendNumbers: { alignItems: "flex-end", gap: 2 },
  legendPercent: { fontFamily: "System", fontSize: 12, fontVariant: ["tabular-nums"] },
  legendRow: { alignItems: "center", flexDirection: "row", gap: 10, minHeight: 52, paddingVertical: 6 },
  legendState: { fontFamily: "System", fontSize: 11, lineHeight: 15 },
  legendText: { flex: 1, minWidth: 0 },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  optionLabel: { flex: 1, fontFamily: "System", fontSize: 14, lineHeight: 20 },
  optionRow: { alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 12, minHeight: 52, paddingVertical: 6 },
  optionScroller: { maxHeight: 360 },
  optionSwatch: { borderRadius: 999, height: 12, width: 12 },
  pressed: { opacity: 0.7 },
  quality: { fontFamily: "System", fontSize: 12, fontWeight: "600", lineHeight: 17 },
  search: { borderRadius: 14, fontFamily: "System", fontSize: 16, minHeight: 48, paddingHorizontal: 14 },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: 12, maxHeight: "86%", paddingBottom: 24, paddingHorizontal: 16, paddingTop: 18 },
  sheetAction: { alignItems: "center", justifyContent: "center", minHeight: 44, minWidth: 60 },
  sheetActionText: { fontFamily: "System", fontSize: 14, fontWeight: "600" },
  sheetHeader: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  sheetSection: { fontFamily: "System", fontSize: 12, fontWeight: "600", lineHeight: 17 },
  sheetTitle: { fontFamily: "System", fontSize: 22, fontWeight: "700", lineHeight: 28 },
  supportingCopy: { fontFamily: "System", fontSize: 12, lineHeight: 17 },
  swatch: { borderRadius: 999, borderWidth: 1, height: 32, width: 12 },
  textAction: { alignItems: "center", justifyContent: "center", minHeight: 44, paddingHorizontal: 8 },
  textActionLabel: { fontFamily: "System", fontSize: 13, fontWeight: "600" },
  totalCard: { flex: 1, gap: 3, justifyContent: "center", minHeight: 62, paddingHorizontal: 12, paddingVertical: 8 },
  totalRow: { flexDirection: "row", gap: 10 },
  validation: { fontFamily: "System", fontSize: 12, lineHeight: 17 }
});
