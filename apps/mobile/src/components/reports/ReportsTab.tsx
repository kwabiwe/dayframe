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
import { compactDuration } from "../today/todayBlocksLayout";
import { playHaptic } from "@/lib/haptics";
import { MOBILE_DISPLAY_FONT } from "../../lib/mobileTypography";
import {
  formatReportDelta,
  previousReportWindow,
  reportHeroPeriod,
  weekGoalDays,
} from "../../lib/reportsBlocks";
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
  reportSelectionIncludes,
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
import {
  ReportGoalStreak,
  ReportHero,
  ReportMonthGrid,
  ReportRangeSwitch,
  ReportWeekColumns,
  type ReportDayStack,
} from "./ReportsBlocks";
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
  initialChoice = "week",
  isFocused,
  nowMs,
  styles,
  theme,
}: {
  data: MobileBootstrap;
  /** Week, as in the prototype; tests start other ranges directly. */
  initialChoice?: ReportRangeChoice;
  isFocused: boolean;
  nowMs: number;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  const [choice, setChoice] = useState<ReportRangeChoice>(initialChoice);
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
  const [previousLoaded, setPreviousLoaded] = useState<{
    key: string;
    summary: ReportSummary;
  } | null>(null);
  const [focusedDayKey, setFocusedDayKey] = useState<string | null>(null);
  const blocksAnimated = useRef(false);
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
  // The same stretch of the previous period, for the hero's change pill (none for custom ranges).
  const previous = useMemo(
    () => previousReportWindow(choice, range, nowMs),
    // The window moves in five-minute steps, so its key changes rarely.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [choice, range, Math.floor(nowMs / 300_000)],
  );
  const previousKey = previous ? JSON.stringify(previous.request) : null;
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
        setPreviousLoaded(null);
        setFocusedDayKey(null);
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
    if (!isFocused || !foreground || !previous || !previousKey) return;
    const cached = cache.current.get(previousKey);
    if (cached) {
      setPreviousLoaded({ key: previousKey, summary: cached });
      return;
    }
    const current = generation.current;
    const controller = new AbortController();
    // Best effort: a failed comparison read only hides the pill.
    fetchReportSummary(
      previous.request,
      { userId: data.user.id, workspaceId: data.workspace.id },
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted || current !== generation.current) return;
        cache.current.put(previousKey, result);
        setPreviousLoaded({ key: previousKey, summary: result });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [previousKey, data.user.id, data.workspace.id, isFocused, foreground]);
  // A new range or filter shows the whole range again.
  useEffect(() => {
    setFocusedDayKey(null);
  }, [requestKey, selection]);
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
          name: "No activity",
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
                name: "Unavailable activity",
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
  const todayKey = formatLocalDateKey(new Date(nowMs));
  // Day stacks for the week columns and month grid: one per day bucket, with the selected activities.
  const days: ReportDayStack[] =
    report && range.bucketUnit === "day"
      ? report.buckets.map((bucket, index) => ({
          key: formatLocalDateKey(range.buckets[index].start),
          start: range.buckets[index].start,
          seconds: bucket.seconds,
          segments: bucket.segments,
        }))
      : [];
  const focusedDay = days.find((day) => day.key === focusedDayKey) ?? null;
  const heroSeconds = focusedDay
    ? focusedDay.seconds
    : (report?.selectedLoggedSeconds ?? 0);
  const previousSummary =
    previousKey && previousLoaded?.key === previousKey
      ? previousLoaded.summary
      : previousKey
        ? cache.current.get(previousKey)
        : undefined;
  const delta =
    report && previous && previousSummary && selection.mode !== "none"
      ? formatReportDelta(
          report.selectedLoggedSeconds -
            previousSummary.categories.reduce(
              (sum, category) =>
                sum +
                (reportSelectionIncludes(selection, category.key)
                  ? category.seconds
                  : 0),
              0,
            ),
          previous.comparison,
        )
      : null;
  const dailyGoalMinutes = data.user.dailyGoalMinutes;
  const goalDays =
    choice === "week" && selection.mode === "all" && report
      ? weekGoalDays(days, nowMs, dailyGoalMinutes)
      : [];
  const playBlocks = Boolean(report) && !blocksAnimated.current && !reduceMotion && resolved && isFocused;
  if (playBlocks && days.some((day) => day.segments.length)) blocksAnimated.current = true;
  const moreLabel =
    choice === "week" || choice === "month" ? "More" : rangeDisplayTitle;
  const openFilters = () => {
    setTooltipOutsidePress((value) => value + 1);
    const id = ++presentationSequence.current;
    const presentation = {
      id,
      draft: openReportFilterDraft(selection, universe),
    };
    activeFilterPresentation.current = presentation;
    setFilterPresentation(presentation);
  };
  const openRanges = () => {
    setTooltipOutsidePress((value) => value + 1);
    const id = ++presentationSequence.current;
    const presentation = { id, initial: choice };
    activeDatePresentation.current = presentation;
    setDatePresentation(presentation);
  };
  return (
    <View style={styles.tabScreenStack}>
      <View
        onLayout={(event) =>
          setContentWidth(Math.max(1, event.nativeEvent.layout.width - 32))
        }
        style={s.screen}
      >
        {measuredNumbers.probe}
        <View style={s.titleRow}>
          <Pressable
            accessible={false}
            onPress={() => setTooltipOutsidePress((value) => value + 1)}
            style={s.titlePress}
            testID="report-tooltip-outside-title"
          >
            <Text
              accessibilityRole="header"
              testID="reports-title"
              numberOfLines={1}
              maxFontSizeMultiplier={REPORT_TEXT_CAP.heading}
              style={[s.title, { color: theme.textPrimary }]}
            >
              Reports
            </Text>
          </Pressable>
          <Pressable
            ref={filterRef}
            accessibilityRole="button"
            accessibilityLabel={
              filterCount === null
                ? "Filter activities, all activities selected"
                : `Filter activities, ${filterCount} ${filterCount === 1 ? "activity" : "activities"} selected`
            }
            onPress={openFilters}
            style={[
              s.iconAction,
              {
                backgroundColor:
                  filterCount !== null ? theme.accentSoft : theme.surfaceMuted,
              },
            ]}
            testID="reports-filter-button"
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
        <ReportRangeSwitch
          choice={choice}
          moreAccessibilityLabel={`Choose report dates, ${range.title}`}
          moreLabel={moreLabel}
          moreRef={calendarRef}
          onChoose={(value) => {
            if (value === choice) return;
            playHaptic("tick");
            setTooltipOutsidePress((current) => current + 1);
            setChoice(value);
          }}
          onMore={openRanges}
          reduceMotion={reduceMotion}
          theme={theme}
        />
        {report ? (
          <ReportHero
            delta={delta}
            focusLabel={
              focusedDay
                ? focusedDay.start.toLocaleDateString(undefined, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })
                : null
            }
            period={reportHeroPeriod(choice, range)}
            spokenTotal={spokenReportDuration(heroSeconds)}
            theme={theme}
            total={compactDuration(heroSeconds)}
          />
        ) : null}
        {report && choice === "week" && days.length === 7 ? (
          <ReportWeekColumns
            animate={playBlocks}
            days={days}
            focusedKey={focusedDay?.key ?? null}
            onFocus={(key) => {
              playHaptic("tick");
              setFocusedDayKey(key);
            }}
            theme={theme}
            todayKey={todayKey}
          />
        ) : null}
        {report && choice === "month" && days.length ? (
          <ReportMonthGrid days={days} theme={theme} todayKey={todayKey} />
        ) : null}
        {goalDays.length && dailyGoalMinutes ? (
          <ReportGoalStreak
            days={goalDays}
            goalLabel={compactDuration(dailyGoalMinutes * 60)}
            reduceMotion={reduceMotion}
            theme={theme}
          />
        ) : null}
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
            style={[s.outsideDismissSurface, { backgroundColor: theme.surface }]}
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
                  ? "No activities selected"
                  : selection.mode === "include"
                    ? "No logged time for the selected activities."
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
        {report && choice !== "week" && choice !== "month" ? (
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
  screen: { gap: 14 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  titlePress: { flex: 1, minWidth: 0 },
  title: { fontFamily: MOBILE_DISPLAY_FONT.bold, fontSize: 30, lineHeight: 36 },
  outsideDismissSurface: { gap: 12, borderRadius: 22, padding: 16 },
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
