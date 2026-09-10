import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
  useWindowDimensions,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
} from "react-native-reanimated";
import { CalendarGlyph } from "@/components/calendar/DatePickerCalendar";
import { REPORT_TEXT_CAP, reportNumericColumns } from "@/lib/reportsTypography";
import { paletteColorFor, type ReportSummary } from "@dayframe/shared";
import { DonutChart } from "@/components/charts/DonutChart";
import type { MobileBootstrap } from "@/lib/api";
import type { MobileStyles, MobileTheme } from "@/lib/mobileTheme";
import { MOBILE_MOTION, useResolvedReduceMotionPreference } from "@/lib/motion";
import {
  buildReportsPresentation,
  formatReportDuration,
  formatReportPercent,
  spokenReportDuration,
} from "@/lib/reportsPresentation";
import {
  buildReportRange,
  formatLocalDateKey,
  type ReportRangeChoice,
} from "@/lib/reportsRanges";
import {
  applyReportFilterDraft,
  openReportFilterDraft,
  refreshReportFilterDraft,
  toggleReportCategory,
  type ReportCategorySelection,
  type ReportFilterDraft,
} from "@/lib/reportsSelection";
import { fetchReportSummary, ReportRangeCache } from "@/lib/reportsClient";
import { subscribeAuthenticatedSession } from "@/lib/secure-session";
import { ReportActivityChart } from "./ReportActivityChart";
import { ReportDateSheet, ReportFiltersSheet } from "./ReportSheets";

export function ReportsTab({
  data,
  isFocused,
  nowMs,
  styles,
  theme,
}: {
  data: MobileBootstrap;
  isFocused: boolean;
  nowMs: number;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  const [choice, setChoice] = useState<ReportRangeChoice>("today");
  const [selection, setSelection] = useState<ReportCategorySelection>({
    mode: "all",
  });
  const [draft, setDraft] = useState<ReportFilterDraft | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  const [loaded, setLoaded] = useState<{
    key: string;
    summary: ReportSummary;
  } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [outsideRevision, setOutsideRevision] = useState(0);
  const [contentWidth, setContentWidth] = useState(256);
  const refreshRequest = useRef<(() => void) | null>(null);
  const refreshInput = useRef({ data, reload });
  const cache = useRef(new ReportRangeCache());
  const generation = useRef(0);
  const presented = useRef(false);
  const stableOrder = useRef<string[]>([]);
  const filterRef = useRef<View>(null);
  const calendarRef = useRef<View>(null);
  const { fontScale } = useWindowDimensions();
  const { reduceMotion, resolved } = useResolvedReduceMotionPreference();
  const focusedNow = useRef(nowMs);
  const day = formatLocalDateKey(new Date(nowMs));
  const range = useMemo(() => buildReportRange(choice, nowMs), [choice, day]);
  const requestKey = JSON.stringify(range.request);
  const summary =
    loaded?.key === requestKey ? loaded.summary : cache.current.get(requestKey);
  // A cached running contribution can still need replacement after an optimistic Stop.
  // Keep its exact clock until the aggregate catches up, not just while activeEntry exists.
  if (isFocused && foreground)
    focusedNow.current =
      data.activeEntry || summary?.active
        ? nowMs
        : Math.floor(nowMs / 60_000) * 60_000;
  const reportNow = focusedNow.current;
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  useEffect(
    () =>
      subscribeAuthenticatedSession(() => {
        generation.current++;
        cache.current.clear();
        setLoaded(null);
        setSelection({ mode: "all" });
        setDraft(null);
        setCalendarOpen(false);
      }),
    [],
  );
  useEffect(() => {
    if (!isFocused || !foreground) return;
    const current = ++generation.current;
    const controller = new AbortController();
    let running = false;
    let queued = false;
    const load = async () => {
      if (controller.signal.aborted || current !== generation.current) return;
      if (running) {
        queued = true;
        return;
      }
      running = true;
      setFailedKey(null);
      try {
        const result = await fetchReportSummary(
          range.request,
          { userId: data.user.id, workspaceId: data.workspace.id },
          controller.signal,
        );
        if (!controller.signal.aborted && current === generation.current) {
          cache.current.put(requestKey, result);
          setLoaded({ key: requestKey, summary: result });
        }
      } catch {
        if (!controller.signal.aborted && current === generation.current)
          setFailedKey(requestKey);
      } finally {
        running = false;
        if (queued) {
          queued = false;
          void load();
        }
      }
    };
    // Coalesce bootstrap refreshes instead of repeatedly aborting a slow, valid
    // same-range read. Range/account/focus changes still invalidate immediately.
    refreshInput.current = { data, reload };
    refreshRequest.current = () => {
      void load();
    };
    void load();
    return () => {
      controller.abort();
      generation.current++;
      refreshRequest.current = null;
    };
  }, [requestKey, data.user.id, data.workspace.id, isFocused, foreground]);
  useEffect(() => {
    if (
      refreshInput.current.data !== data ||
      refreshInput.current.reload !== reload
    ) {
      refreshInput.current = { data, reload };
      refreshRequest.current?.();
    }
  }, [data, reload]);
  useEffect(() => {
    if (!isFocused) {
      setDraft(null);
      setCalendarOpen(false);
    }
  }, [isFocused]);
  const report = useMemo(
    () =>
      summary
        ? buildReportsPresentation({
            data,
            summary,
            range,
            nowMs: reportNow,
            selection,
            themeMode: theme.mode,
          })
        : null,
    [data, summary, range, reportNow, selection, theme.mode],
  );
  const segments = useMemo(() => {
    if (!report) return [];
    for (const segment of report.allCategorySegments)
      if (!stableOrder.current.includes(segment.key))
        stableOrder.current.push(segment.key);
    return [...report.visibleCategorySegments].sort(
      (a, b) =>
        stableOrder.current.indexOf(a.key) - stableOrder.current.indexOf(b.key),
    );
  }, [report]);
  const entrance =
    isFocused &&
    foreground &&
    resolved &&
    Boolean(report?.selectedDurationMs) &&
    !presented.current;
  useEffect(() => {
    if (entrance) presented.current = true;
  }, [entrance]);
  const filterOptions = report?.filterOptions ?? [
    ...(loaded?.summary.categories ?? [])
      .filter(
        (c) =>
          !(data.categories ?? []).some((known) => known.id === c.key) &&
          c.key !== "uncategorized",
      )
      .map((c) => ({
        key: c.key,
        name: c.name,
        color: paletteColorFor(c.color ?? c.key, c.name, theme.mode),
        isUncategorized: false,
        isUnavailable: false,
      })),
    ...(data.categories ?? []).map((c) => ({
      key: c.id,
      name: c.name,
      color: paletteColorFor(c.color ?? c.id, c.name, theme.mode),
      isUncategorized: false,
      isUnavailable: false,
    })),
    {
      key: "uncategorized",
      name: "Uncategorized",
      color: theme.textSecondary,
      isUncategorized: true,
      isUnavailable: false,
    },
    ...(selection.mode === "include"
      ? selection.keys
          .filter(
            (key) =>
              key !== "uncategorized" &&
              !(data.categories ?? []).some((c) => c.id === key) &&
              !(loaded?.summary.categories ?? []).some((c) => c.key === key),
          )
          .map((key) => ({
            key,
            name: "Unavailable category",
            color: theme.textSecondary,
            isUncategorized: false,
            isUnavailable: true,
          }))
      : []),
  ];
  const universe = filterOptions.map((option) => option.key);
  const columns = reportNumericColumns(
    contentWidth,
    fontScale,
    segments.map((s) => formatReportDuration(s.durationMs / 1000)),
  );
  const universeKey = JSON.stringify(universe);
  useEffect(() => {
    setDraft((current) =>
      current ? refreshReportFilterDraft(current, universe) : null,
    );
  }, [universeKey]);
  const toggle = (key: string) => {
    setSelection((current) => toggleReportCategory(current, key, universe));
    requestAnimationFrame(() => {
      const node = findNodeHandle(filterRef.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    });
  };
  const close = (calendar: boolean) => {
    setDraft(null);
    setCalendarOpen(false);
    requestAnimationFrame(() => {
      const node = findNodeHandle((calendar ? calendarRef : filterRef).current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    });
  };
  const filterCount =
    selection.mode === "none"
      ? 0
      : selection.mode === "include"
        ? selection.keys.length
        : null;
  return (
    <View
      style={styles.tabScreenStack}
      onTouchEnd={() => setOutsideRevision((value) => value + 1)}
    >
      <View
        onLayout={(event) =>
          setContentWidth(Math.max(1, event.nativeEvent.layout.width - 32))
        }
        style={[s.surface, { backgroundColor: theme.surfaceRaised }]}
      >
        <Text
          maxFontSizeMultiplier={REPORT_TEXT_CAP.heading}
          style={styles.reportScreenTitle}
        >
          Reports
        </Text>
        <View style={s.row}>
          <Pressable
            ref={calendarRef}
            accessibilityRole="button"
            accessibilityLabel={`Choose report dates, ${range.title}`}
            onPress={() => setCalendarOpen(true)}
            style={[s.rangeAction, { backgroundColor: theme.surfaceMuted }]}
          >
            <CalendarGlyph kind="calendar" color={theme.textPrimary} />
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              maxFontSizeMultiplier={REPORT_TEXT_CAP.control}
              style={[s.rangeLabel, { color: theme.textPrimary }]}
            >
              {range.title}
            </Text>
          </Pressable>
          <Pressable
            ref={filterRef}
            accessibilityRole="button"
            accessibilityLabel={
              filterCount === null
                ? "Filter categories, all categories selected"
                : `Filter categories, ${filterCount} categories selected`
            }
            onPress={() => setDraft(openReportFilterDraft(selection, universe))}
            style={[
              s.iconAction,
              {
                backgroundColor:
                  filterCount !== null ? theme.accentSoft : theme.surfaceMuted,
              },
            ]}
          >
            <CalendarGlyph kind="funnel" color={theme.textPrimary} />
            {filterCount !== null ? (
              <Text
                maxFontSizeMultiplier={REPORT_TEXT_CAP.small}
                style={[
                  s.badge,
                  {
                    color: theme.textPrimary,
                    backgroundColor: theme.surfaceInset,
                  },
                ]}
              >
                {filterCount}
              </Text>
            ) : null}
          </Pressable>
        </View>
        {!report ? (
          <View style={s.unavailable}>
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: theme.textSecondary }}
            >
              {failedKey === requestKey
                ? "Connect to load this report range"
                : "Loading report range…"}
            </Text>
            {failedKey === requestKey ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setReload((value) => value + 1)}
                style={s.retry}
              >
                <Text style={{ color: theme.textPrimary }}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <>
            {failedKey === requestKey ? (
              <Text style={{ color: theme.textSecondary }}>
                Saved report for this range. Connect to refresh.
              </Text>
            ) : null}
            <View style={s.chart}>
              <DonutChart
                animateEntrance={entrance}
                centerLabel="Total"
                spokenValue={spokenReportDuration(report.selectedLoggedSeconds)}
                centerValue={formatReportDuration(report.selectedLoggedSeconds)}
                onSegmentPress={toggle}
                reduceMotion={reduceMotion}
                settleImmediately={!isFocused || !foreground}
                segments={segments.map((segment) => ({
                  id: segment.key,
                  value: segment.durationMs,
                  color: segment.color,
                  selected: segment.selected,
                  isUncategorized: segment.isUncategorized,
                }))}
                theme={theme}
              />
            </View>
            {selection.mode === "none" || report.selectedLoggedSeconds === 0 ? (
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: theme.textSecondary }}
              >
                {selection.mode === "none"
                  ? "No categories selected"
                  : selection.mode === "include"
                    ? "No logged time for the selected categories."
                    : "No tracked time yet."}
              </Text>
            ) : null}
            {segments.map((segment) => (
              <Animated.View
                key={segment.key}
                entering={FadeIn.duration(
                  reduceMotion ? 0 : MOBILE_MOTION.control,
                )}
                exiting={FadeOut.duration(
                  reduceMotion ? 0 : MOBILE_MOTION.control,
                )}
                layout={
                  reduceMotion
                    ? undefined
                    : LinearTransition.duration(MOBILE_MOTION.layout)
                }
              >
                <Pressable
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={`${segment.categoryName}, ${formatReportPercent(segment.durationMs, report.selectedDurationMs)} of selected time, ${spokenReportDuration(segment.durationMs / 1000)}`}
                  accessibilityHint="Removes this category. Restore it in Filters."
                  onPress={() => toggle(segment.key)}
                  style={[
                    s.category,
                    { borderBottomColor: theme.border, gap: columns.gap },
                  ]}
                >
                  <View style={[s.dot, { backgroundColor: segment.color }]} />
                  <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    maxFontSizeMultiplier={REPORT_TEXT_CAP.name}
                    style={[s.name, { color: theme.textPrimary }]}
                  >
                    {segment.categoryName}
                  </Text>
                  <View style={[s.numbers, { gap: columns.gap }]}>
                    <Text
                      numberOfLines={1}
                      maxFontSizeMultiplier={REPORT_TEXT_CAP.numeric}
                      style={[
                        s.number,
                        {
                          color: theme.textSecondary,
                          width: columns.percentWidth,
                          fontSize: columns.fontSize,
                        },
                      ]}
                    >
                      {formatReportPercent(
                        segment.durationMs,
                        report.selectedDurationMs,
                      )}
                    </Text>
                    <Text
                      numberOfLines={1}
                      maxFontSizeMultiplier={REPORT_TEXT_CAP.numeric}
                      style={[
                        s.number,
                        {
                          color: theme.textPrimary,
                          width: columns.durationWidth,
                          fontSize: columns.fontSize,
                        },
                      ]}
                    >
                      {formatReportDuration(segment.durationMs / 1000)}
                    </Text>
                  </View>
                </Pressable>
              </Animated.View>
            ))}
            <ReportActivityChart
              buckets={report.buckets}
              theme={theme}
              reduceMotion={reduceMotion || !isFocused || !foreground}
              contextKey={`${requestKey}:${JSON.stringify(selection)}:${outsideRevision}:${isFocused}:${foreground}:${calendarOpen}:${Boolean(draft)}`}
            />
          </>
        )}
        {draft ? (
          <ReportFiltersSheet
            draft={draft}
            options={filterOptions}
            theme={theme}
            reduceMotion={reduceMotion}
            onChange={setDraft}
            onCancel={() => close(false)}
            onApply={() => {
              setSelection(applyReportFilterDraft(draft));
              close(false);
            }}
          />
        ) : null}
        {calendarOpen ? (
          <ReportDateSheet
            initial={choice}
            nowMs={nowMs}
            theme={theme}
            reduceMotion={reduceMotion}
            onCancel={() => close(true)}
            onApply={(value) => {
              setChoice(value);
              close(true);
            }}
          />
        ) : null}
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  surface: { padding: 16, borderRadius: 20, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  rangeAction: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  rangeLabel: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: "600" },
  iconAction: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    right: -2,
    top: -2,
    borderRadius: 10,
    paddingHorizontal: 4,
    fontSize: 10,
  },
  pill: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  chart: { alignItems: "center", paddingVertical: 8 },
  category: {
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    minHeight: 44,
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: { height: 10, width: 10, borderRadius: 5 },
  name: { flex: 1, minWidth: 0, fontSize: 14 },
  numbers: { flexDirection: "row", flexWrap: "nowrap", flexShrink: 0 },
  number: { textAlign: "right", fontVariant: ["tabular-nums"], flexShrink: 0 },
  unavailable: { paddingVertical: 24, gap: 12 },
  retry: { minHeight: 44, justifyContent: "center" },
});
