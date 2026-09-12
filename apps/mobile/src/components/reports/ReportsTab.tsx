import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  reportRangeDisplayTitle,
  type ReportRangeChoice,
} from "@/lib/reportsRanges";
import {
  applyReportFilterDraft,
  openReportFilterDraft,
  refreshReportFilterDraft,
  type ReportCategorySelection,
  type ReportFilterDraft,
} from "@/lib/reportsSelection";
import { fetchReportSummary, ReportRangeCache } from "@/lib/reportsClient";
import { subscribeAuthenticatedSession } from "@/lib/secure-session";
import { ReportActivityChart } from "./ReportActivityChart";
import { ReportDateSheet, ReportFiltersSheet } from "./ReportSheets";
import { ReportsSheetPortalContext } from "./ReportsSheetPortal";
import { useReportTextMeasure } from "./ReportTextMeasure";

type FilterPresentation = {
  id: number;
  draft: ReportFilterDraft;
};

type DatePresentation = {
  id: number;
  initial: ReportRangeChoice;
};

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
  const sheetPortal = useContext(ReportsSheetPortalContext);
  const onSheetPortalChange = sheetPortal?.present;
  const [selection, setSelection] = useState<ReportCategorySelection>({
    mode: "all",
  });
  const [filterPresentation, setFilterPresentation] =
    useState<FilterPresentation | null>(null);
  const [datePresentation, setDatePresentation] =
    useState<DatePresentation | null>(null);
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  const [loaded, setLoaded] = useState<{
    key: string;
    summary: ReportSummary;
  } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [tooltipOutsidePress, setTooltipOutsidePress] = useState(0);
  const [contentWidth, setContentWidth] = useState(256);
  const refreshRequest = useRef<(() => void) | null>(null);
  const refreshInput = useRef({ data, reload });
  const cache = useRef(new ReportRangeCache());
  const generation = useRef(0);
  const presentationSequence = useRef(0);
  const activeFilterPresentation = useRef(filterPresentation);
  const activeDatePresentation = useRef(datePresentation);
  const reportsOwnerActive = useRef(isFocused && foreground);
  const presented = useRef(false);
  const filterRef = useRef<View>(null);
  const calendarRef = useRef<View>(null);
  const { fontScale } = useWindowDimensions();
  const { reduceMotion, resolved } = useResolvedReduceMotionPreference();
  const focusedNow = useRef(nowMs);
  activeFilterPresentation.current = filterPresentation;
  activeDatePresentation.current = datePresentation;
  reportsOwnerActive.current = isFocused && foreground;
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
    const subscription = AppState.addEventListener("change", (state) => {
      const active = state === "active";
      setForeground(active);
      if (!active) {
        activeFilterPresentation.current = null;
        activeDatePresentation.current = null;
        setFilterPresentation(null);
        setDatePresentation(null);
      }
    });
    return () => subscription.remove();
  }, []);
  useEffect(
    () =>
      subscribeAuthenticatedSession(() => {
        generation.current++;
        cache.current.clear();
        activeFilterPresentation.current = null;
        activeDatePresentation.current = null;
        setLoaded(null);
        setSelection({ mode: "all" });
        setFilterPresentation(null);
        setDatePresentation(null);
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
      activeFilterPresentation.current = null;
      activeDatePresentation.current = null;
      setFilterPresentation(null);
      setDatePresentation(null);
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
  const segments = report?.visibleCategorySegments ?? [];
  const entrance =
    isFocused &&
    foreground &&
    resolved &&
    Boolean(report?.selectedDurationMs) &&
    !presented.current;
  useEffect(() => {
    if (entrance) presented.current = true;
  }, [entrance]);
  const filterOptions = useMemo(
    () =>
      report?.filterOptions ?? [
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
                  !(loaded?.summary.categories ?? []).some(
                    (c) => c.key === key,
                  ),
              )
              .map((key) => ({
                key,
                name: "Unavailable category",
                color: theme.textSecondary,
                isUncategorized: false,
                isUnavailable: true,
              }))
          : []),
      ],
    [
      data.categories,
      loaded?.summary.categories,
      report?.filterOptions,
      selection,
      theme.mode,
      theme.textSecondary,
    ],
  );
  const universe = filterOptions.map((option) => option.key);
  const columns = reportNumericColumns(
    contentWidth,
    fontScale,
    segments.map((s) => formatReportDuration(s.durationMs / 1000)),
  );
  const measuredNumbers = useReportTextMeasure(
    ["100%", "<1%", columns.durationSample],
    { fontSize: columns.fontSize, fontVariant: ["tabular-nums"] },
    REPORT_TEXT_CAP.numeric,
  );
  columns.percentWidth = Math.max(
    measuredNumbers.widths["100%"] ?? columns.percentWidth,
    measuredNumbers.widths["<1%"] ?? 0,
  );
  columns.durationWidth =
    measuredNumbers.widths[columns.durationSample] ?? columns.durationWidth;
  const universeKey = JSON.stringify(universe);
  useEffect(() => {
    setFilterPresentation((current) =>
      current
        ? {
            ...current,
            draft: refreshReportFilterDraft(current.draft, universe),
          }
        : null,
    );
  }, [universeKey]);

  const restoreTriggerFocus = useCallback((calendar: boolean) => {
    requestAnimationFrame(() => {
      const node = findNodeHandle((calendar ? calendarRef : filterRef).current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    });
  }, []);
  const releaseFilterPresentation = useCallback((presentationId: number) => {
    if (activeFilterPresentation.current?.id !== presentationId) return;
    activeFilterPresentation.current = null;
    setFilterPresentation(null);
    if (reportsOwnerActive.current) restoreTriggerFocus(false);
  }, [restoreTriggerFocus]);
  const releaseDatePresentation = useCallback((presentationId: number) => {
    if (activeDatePresentation.current?.id !== presentationId) return;
    activeDatePresentation.current = null;
    setDatePresentation(null);
    if (reportsOwnerActive.current) restoreTriggerFocus(true);
  }, [restoreTriggerFocus]);
  const filterSheet = useMemo(
    () =>
      filterPresentation ? (
        <ReportFiltersSheet
          rootHosted={Boolean(onSheetPortalChange)}
          presentationId={filterPresentation.id}
          draft={filterPresentation.draft}
          options={filterOptions}
          theme={theme}
          reduceMotion={reduceMotion}
          onChange={(nextDraft) =>
            setFilterPresentation((current) =>
              current?.id === filterPresentation.id
                ? { ...current, draft: nextDraft }
                : current,
            )
          }
          onApply={() => {
            const current = activeFilterPresentation.current;
            if (current?.id !== filterPresentation.id) return false;
            setSelection(applyReportFilterDraft(current.draft));
            return true;
          }}
          onDismissed={releaseFilterPresentation}
        />
      ) : null,
    [
      filterOptions,
      filterPresentation,
      reduceMotion,
      releaseFilterPresentation,
      theme,
    ],
  );
  const dateSheet = useMemo(
    () =>
      datePresentation ? (
        <ReportDateSheet
          rootHosted={Boolean(onSheetPortalChange)}
          presentationId={datePresentation.id}
          initial={datePresentation.initial}
          nowMs={nowMs}
          theme={theme}
          reduceMotion={reduceMotion}
          onApply={(value) => {
            if (activeDatePresentation.current?.id !== datePresentation.id)
              return false;
            setChoice(value);
            return true;
          }}
          onDismissed={releaseDatePresentation}
        />
      ) : null,
    [
      datePresentation,
      nowMs,
      reduceMotion,
      releaseDatePresentation,
      theme,
    ],
  );
  const presentedSheet = filterSheet ?? dateSheet;
  useEffect(() => {
    if (!onSheetPortalChange) return;
    onSheetPortalChange(presentedSheet);
  }, [onSheetPortalChange, presentedSheet]);
  useEffect(
    () => () => {
      onSheetPortalChange?.(null);
    },
    [onSheetPortalChange],
  );
  const filterCount =
    selection.mode === "none"
      ? 0
      : selection.mode === "include"
        ? selection.keys.length
        : null;
  const rangeDisplayTitle = reportRangeDisplayTitle(range, choice);
  return (
    <View style={styles.tabScreenStack}>
      <View
        onLayout={(event) =>
          setContentWidth(Math.max(1, event.nativeEvent.layout.width - 32))
        }
        style={[s.surface, { backgroundColor: theme.surfaceRaised }]}
      >
        {measuredNumbers.probe}
        <Pressable
          accessible={false}
          onPress={() => setTooltipOutsidePress((value) => value + 1)}
          testID="report-tooltip-outside-title"
        >
          <Text
            testID="reports-title"
            numberOfLines={1}
            maxFontSizeMultiplier={REPORT_TEXT_CAP.heading}
            style={styles.reportScreenTitle}
          >
            Reports
          </Text>
        </Pressable>
        <View style={s.row}>
          <Pressable
            testID="reports-range-control"
            ref={calendarRef}
            accessibilityRole="button"
            accessibilityLabel={`Choose report dates, ${range.title}`}
            onPress={() => {
              setTooltipOutsidePress((value) => value + 1);
              const id = ++presentationSequence.current;
              const presentation = { id, initial: choice };
              activeDatePresentation.current = presentation;
              setDatePresentation(presentation);
            }}
            style={[s.rangeAction, { backgroundColor: theme.surfaceMuted }]}
          >
            <CalendarGlyph kind="calendar" color={theme.textPrimary} />
            <Text
              testID="reports-range-label"
              numberOfLines={1}
              ellipsizeMode="tail"
              maxFontSizeMultiplier={REPORT_TEXT_CAP.control}
              style={[s.rangeLabel, { color: theme.textPrimary }]}
            >
              {rangeDisplayTitle}
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
            onPress={() => {
              setTooltipOutsidePress((value) => value + 1);
              const id = ++presentationSequence.current;
              const presentation = {
                id,
                draft: openReportFilterDraft(selection, universe),
              };
              activeFilterPresentation.current = presentation;
              setFilterPresentation(presentation);
            }}
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
          <Pressable
            accessible={false}
            onPress={() => setTooltipOutsidePress((value) => value + 1)}
            style={s.outsideDismissSurface}
            testID="report-tooltip-outside-summary"
          >
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
            {segments.length ? (
              <View style={s.categoryList}>
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
                    <View
                      accessible
                      accessibilityRole="text"
                      accessibilityLabel={`${segment.categoryName}, ${formatReportPercent(segment.durationMs, report.selectedDurationMs)} of selected time, ${spokenReportDuration(segment.durationMs / 1000)}`}
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
                    </View>
                  </Animated.View>
                ))}
              </View>
            ) : null}
          </Pressable>
        )}
        {report ? (
          <ReportActivityChart
            buckets={report.buckets}
            axisLayout={range.axisLayout}
            theme={theme}
            reduceMotion={reduceMotion || !isFocused || !foreground}
            semanticContextKey={`${requestKey}:${JSON.stringify(selection)}:${isFocused}:${foreground}:${Boolean(datePresentation)}:${Boolean(filterPresentation)}`}
            outsidePressDismissal={tooltipOutsidePress}
          />
        ) : null}
        {onSheetPortalChange ? null : presentedSheet}
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  surface: { padding: 16, borderRadius: 20, gap: 12 },
  outsideDismissSurface: { gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  rangeAction: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 10,
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
  categoryList: { gap: 0 },
  category: {
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    minHeight: 38,
    paddingVertical: 5,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: { height: 10, width: 10, borderRadius: 5 },
  name: { flex: 1, minWidth: 0, fontSize: 14 },
  numbers: {
    flexDirection: "row",
    flexWrap: "nowrap",
    flexShrink: 0,
    alignItems: "baseline",
  },
  number: { textAlign: "right", fontVariant: ["tabular-nums"], flexShrink: 0 },
  unavailable: { paddingVertical: 24, gap: 12 },
  retry: { minHeight: 44, justifyContent: "center" },
});
