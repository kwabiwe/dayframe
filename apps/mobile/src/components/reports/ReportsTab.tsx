import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
  useWindowDimensions,
} from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import type { ReportSummary } from "@dayframe/shared";
import { DonutChart } from "@/components/charts/DonutChart";
import type { MobileBootstrap } from "@/lib/api";
import type { MobileStyles, MobileTheme } from "@/lib/mobileTheme";
import { MOBILE_MOTION, useResolvedReduceMotionPreference } from "@/lib/motion";
import {
  buildReportsPresentation,
  formatReportDuration,
  formatReportPercent,
} from "@/lib/reportsPresentation";
import {
  buildReportRange,
  formatLocalDateKey,
  type ReportRangeChoice,
  type ReportPreset,
} from "@/lib/reportsRanges";
import {
  applyReportFilterDraft,
  openReportFilterDraft,
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
  const [lastCustom, setLastCustom] = useState<{
    start: string;
    end: string;
  } | null>(null);
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  const [loaded, setLoaded] = useState<{
    key: string;
    summary: ReportSummary;
  } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const cache = useRef(new ReportRangeCache());
  const generation = useRef(0);
  const presented = useRef(false);
  const stableOrder = useRef<string[]>([]);
  const filterRef = useRef<View>(null);
  const calendarRef = useRef<View>(null);
  const { fontScale } = useWindowDimensions();
  const { reduceMotion, resolved } = useResolvedReduceMotionPreference();
  const day = formatLocalDateKey(new Date(nowMs));
  const range = useMemo(() => buildReportRange(choice, nowMs), [choice, day]);
  const requestKey = JSON.stringify(range.request);
  const summary =
    loaded?.key === requestKey ? loaded.summary : cache.current.get(requestKey);
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
    setFailedKey(null);
    void fetchReportSummary(
      range.request,
      { userId: data.user.id, workspaceId: data.workspace.id },
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted || current !== generation.current) return;
        cache.current.put(requestKey, result);
        setLoaded({ key: requestKey, summary: result });
      })
      .catch(() => {
        if (!controller.signal.aborted && current === generation.current)
          setFailedKey(requestKey);
      });
    return () => {
      controller.abort();
      generation.current++;
    };
  }, [requestKey, data, isFocused, foreground, reload]);
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
            nowMs,
            selection,
            themeMode: theme.mode,
          })
        : null,
    [data, summary, range, nowMs, selection, theme.mode],
  );
  const segments = useMemo(() => {
    if (!report) return [];
    for (const segment of report.allCategorySegments)
      if (!stableOrder.current.includes(segment.key))
        stableOrder.current.push(segment.key);
    return [...report.allCategorySegments].sort(
      (a, b) =>
        stableOrder.current.indexOf(a.key) - stableOrder.current.indexOf(b.key),
    );
  }, [report]);
  const entrance =
    isFocused &&
    foreground &&
    resolved &&
    Boolean(report?.contextDurationMs) &&
    !presented.current;
  useEffect(() => {
    if (entrance) presented.current = true;
  }, [entrance]);
  const universe = report?.filterOptions.map((option) => option.key) ?? [];
  const toggle = (key: string) =>
    setSelection((current) => toggleReportCategory(current, key, universe));
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
    <View style={styles.tabScreenStack}>
      <View style={[s.surface, { backgroundColor: theme.surfaceRaised }]}>
        <Text style={styles.reportScreenTitle}>Reports</Text>
        <View style={s.row}>
          <ReportPresets
            choice={choice}
            onChange={setChoice}
            theme={theme}
            reduceMotion={reduceMotion}
          />
          <Pressable
            ref={calendarRef}
            accessibilityRole="button"
            accessibilityLabel="Choose custom report range"
            accessibilityState={{ selected: typeof choice !== "string" }}
            onPress={() => setCalendarOpen(true)}
            style={[
              s.iconAction,
              {
                backgroundColor:
                  typeof choice !== "string"
                    ? theme.accentSoft
                    : theme.surfaceMuted,
              },
            ]}
          >
            <ReportIcon calendar color={theme.textPrimary} />
          </Pressable>
        </View>
        <View style={s.row}>
          <Text style={[s.heading, { color: theme.textPrimary }]}>
            {range.title}
          </Text>
          <Pressable
            ref={filterRef}
            accessibilityRole="button"
            accessibilityLabel={
              filterCount === null
                ? "Filter categories, all categories selected"
                : `Filter categories, ${filterCount} categories selected`
            }
            onPress={() => setDraft(openReportFilterDraft(selection, universe))}
            style={[s.iconAction, { backgroundColor: theme.surfaceMuted }]}
          >
            <ReportIcon color={theme.textPrimary} />
            {filterCount !== null ? (
              <Text
                maxFontSizeMultiplier={1.3}
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
                layout={
                  reduceMotion
                    ? undefined
                    : LinearTransition.duration(MOBILE_MOTION.layout)
                }
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: segment.selected }}
                  accessibilityLabel={`${segment.categoryName}, ${formatReportPercent(segment.durationMs, report.contextDurationMs)} of all time, ${formatReportDuration(segment.durationMs / 1000)}, ${segment.selected ? "included" : "not included"}`}
                  onPress={() => toggle(segment.key)}
                  style={[s.category, { borderBottomColor: theme.border }]}
                >
                  <View
                    style={[
                      s.dot,
                      {
                        backgroundColor: segment.color,
                        opacity: segment.selected ? 1 : 0.35,
                      },
                    ]}
                  />
                  <View style={[s.categoryBody, fontScale > 1.3 && s.stacked]}>
                    <Text
                      style={[
                        s.name,
                        {
                          color: segment.selected
                            ? theme.textPrimary
                            : theme.textSecondary,
                        },
                      ]}
                    >
                      {segment.categoryName}
                    </Text>
                    <View style={s.numbers}>
                      <Text
                        style={{
                          color: theme.textSecondary,
                          fontVariant: ["tabular-nums"],
                        }}
                      >
                        {formatReportPercent(
                          segment.durationMs,
                          report.contextDurationMs,
                        )}
                      </Text>
                      <Text
                        style={{
                          color: segment.selected
                            ? theme.textPrimary
                            : theme.textSecondary,
                          fontVariant: ["tabular-nums"],
                        }}
                      >
                        {formatReportDuration(segment.durationMs / 1000)}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              </Animated.View>
            ))}
            <ReportActivityChart
              buckets={report.buckets}
              theme={theme}
              reduceMotion={reduceMotion}
              contextKey={`${requestKey}:${JSON.stringify(selection)}`}
            />
          </>
        )}
        {draft ? (
          <ReportFiltersSheet
            draft={draft}
            options={report?.filterOptions ?? []}
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
            initial={typeof choice === "string" ? lastCustom : choice}
            nowMs={nowMs}
            theme={theme}
            reduceMotion={reduceMotion}
            onCancel={() => close(true)}
            onApply={(value) => {
              setLastCustom(value);
              setChoice(value);
              close(true);
            }}
          />
        ) : null}
      </View>
    </View>
  );
}
function ReportPresets({
  choice,
  onChange,
  theme,
  reduceMotion,
}: {
  choice: ReportRangeChoice;
  onChange: (choice: ReportPreset) => void;
  theme: MobileTheme;
  reduceMotion: boolean;
}) {
  const scroll = useRef<ScrollView>(null);
  const frames = useRef(new Map<string, { x: number; width: number }>());
  const viewport = useRef(0);
  const reveal = () => {
    const frame =
      typeof choice === "string" ? frames.current.get(choice) : null;
    if (frame)
      scroll.current?.scrollTo({
        x: Math.max(0, frame.x + frame.width - viewport.current),
        animated: !reduceMotion,
      });
  };
  useEffect(reveal, [choice, reduceMotion]);
  return (
    <ScrollView
      horizontal
      ref={scroll}
      onLayout={(event) => {
        viewport.current = event.nativeEvent.layout.width;
        reveal();
      }}
      showsHorizontalScrollIndicator={false}
      style={{ flex: 1 }}
      contentContainerStyle={{ gap: 4 }}
    >
      {(["today", "week", "month", "year"] as const).map((preset) => (
        <Pressable
          key={preset}
          accessibilityRole="button"
          accessibilityLabel={`Show ${preset} reports`}
          accessibilityState={{ selected: choice === preset }}
          onLayout={(event) => {
            frames.current.set(preset, event.nativeEvent.layout);
            reveal();
          }}
          onPress={() => onChange(preset)}
          style={[
            s.pill,
            {
              backgroundColor:
                choice === preset ? theme.accentSoft : theme.surfaceMuted,
            },
          ]}
        >
          <Text
            style={{
              color: choice === preset ? theme.accentText : theme.textSecondary,
              fontWeight: "600",
            }}
          >
            {preset[0].toUpperCase() + preset.slice(1)}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
function ReportIcon({
  calendar = false,
  color,
}: {
  calendar?: boolean;
  color: string;
}) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path
        d={
          calendar
            ? "M5 5h14v15H5zM8 3v4m8-4v4M5 10h14"
            : "M4 7h6m4 0h6M4 17h10m4 0h2M10 4v6m4 4v6"
        }
        fill="none"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
const s = StyleSheet.create({
  surface: { padding: 16, borderRadius: 20, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  heading: { flex: 1, fontSize: 20, fontWeight: "600" },
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
    alignItems: "center",
    minHeight: 44,
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: { height: 10, width: 10, borderRadius: 5 },
  categoryBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stacked: { flexDirection: "column", alignItems: "stretch" },
  name: { flex: 1, fontSize: 14 },
  numbers: { flexDirection: "row", gap: 16, justifyContent: "space-between" },
  unavailable: { paddingVertical: 24, gap: 12 },
  retry: { minHeight: 44, justifyContent: "center" },
});
