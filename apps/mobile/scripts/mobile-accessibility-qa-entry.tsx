/**
 * Synthetic native accessibility layout probe. It is only bundled explicitly
 * with expo export:embed; this entry is not part of expo-router or normal app
 * startup. All actions below update local probe copy and make no app mutation.
 */
import React, { useEffect, useRef, useState } from "react";
import { recordMobileLayout, type MobileAccessibilityDiagnostic } from "../src/components/accessibility/diagnostics";
import {
  AccessibilityInfo,
  AppRegistry,
  PixelRatio,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { File, Paths } from "expo-file-system";
import type { MobileTimeEntry } from "../src/lib/api";
import { TodayTimerSurface } from "../src/components/accessibility/TodayTimerSurface";
import { TodayGoalFrame } from "../src/components/today/TodayGoalFrame";
import { TodayBlockRows } from "../src/components/today/TodayBlockRows";
import { groupHistoryDayEntries } from "../src/lib/historyPresentation";
import { layoutQuickStartMosaic } from "../src/lib/quickStartMosaic";
import { buildTodayGoalFrame } from "../src/lib/todayGoalFrame";
import { SettingsBlockGroup, SettingsBlockRow } from "../src/components/settings/SettingsBlocks";
import { MobileThemeProvider, useMobileTheme } from "../src/lib/mobileTheme";
import { mobileTextProps } from "../src/lib/mobileTypography";

const frames: Record<string, unknown> = {};
const widths = [320, 375, 390, 430];

function syntheticTime(day: number, hour: number, minute: number) {
  return new Date(2026, 8, day, hour, minute).toISOString();
}

function entry(
  id: string,
  description: string,
  startedAt: string,
  stoppedAt: string,
  categoryName = "Synthetic category with a deliberately longer label",
  tags: string[] = [],
): MobileTimeEntry {
  return {
    id,
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: "qa-category",
    categoryName,
    categoryColor: "#6B8E73",
    placeName: "Synthetic place context",
    placeKind: "saved",
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description,
    startedAt,
    stoppedAt,
    durationSeconds: Math.max(0, Math.floor((Date.parse(stoppedAt) - Date.parse(startedAt)) / 1000)),
    tagNames: tags,
  };
}

const fixtures = [
  {
    entry: entry(
      "H01-cross-midnight",
      "Sleep — recovery across a long synthetic weekend",
      syntheticTime(11, 22, 30),
      syntheticTime(12, 2, 7),
      "Health recovery",
      ["rest-and-recovery", "synthetic-tag-with-a-long-name"],
    ),
    overlapSeconds: 7_620,
  },
  {
    entry: entry(
      "H02-long-title",
      "A synthetic activity title with many words to exercise safe truncation",
      syntheticTime(12, 8, 15),
      syntheticTime(12, 9, 42),
      "A long optional category name that must not steal the essential time range",
      ["synthetic-tag-one", "synthetic-tag-two"],
    ),
    overlapSeconds: 5_220,
  },
  {
    entry: entry("H03-group-1", "Synthetic planning block", syntheticTime(12, 10, 0), syntheticTime(12, 11, 0), "Planning"),
    overlapSeconds: 3_600,
  },
  {
    entry: entry("H03-group-2", "Synthetic planning block", syntheticTime(12, 13, 0), syntheticTime(12, 14, 30), "Planning"),
    overlapSeconds: 5_400,
  },
  ...repeatedGroup(12, "H03-count-12", "Planning twelve"),
  ...repeatedGroup(123, "H03-count-123", "Planning one hundred twenty three"),
];

function repeatedGroup(count: number, prefix: string, categoryName: string) {
  return Array.from({ length: count }, (_, index) => ({
    entry: entry(
      `${prefix}-${index + 1}`,
      `${categoryName} repeated synthetic fixture`,
      syntheticTime(12, 14, 0),
      syntheticTime(12, 15, 0),
      categoryName,
    ),
    overlapSeconds: 3_600,
  }));
}

function Probe() {
  const { styles, theme } = useMobileTheme();
  const { width: deviceWidth, height: deviceHeight } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [hostWidth, setHostWidth] = useState(() =>
    deviceWidth >= 390 ? 390 : deviceWidth >= 375 ? 375 : 320,
  );
  const [boldText, setBoldText] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [showRunningTimer, setShowRunningTimer] = useState(false);
  const [actionResult, setActionResult] = useState("No probe action has run.");
  const reportWriterRef = useRef<() => void>(() => {});
  const reportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReportWrite = () => {
    if (reportTimerRef.current) clearTimeout(reportTimerRef.current);
    reportTimerRef.current = setTimeout(() => {
      reportTimerRef.current = null;
      reportWriterRef.current();
    }, 200);
  };
  const previousVisibility = useRef({ showRunningTimer });
  if (previousVisibility.current.showRunningTimer !== showRunningTimer) {
    const hiddenTimerPrefix = showRunningTimer ? "today.timer.idle" : "today.timer.running";
    for (const key of Object.keys(frames)) {
      if (key === hiddenTimerPrefix || key.startsWith(`${hiddenTimerPrefix}.`)) delete frames[key];
    }
    if (showRunningTimer) delete frames["today.timer.composer.frame"];
  }
  previousVisibility.current = { showRunningTimer };
  useEffect(() => {
    void AccessibilityInfo.isBoldTextEnabled().then(setBoldText);
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener("boldTextChanged", setBoldText);
    const reduceMotionSubscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      subscription.remove();
      reduceMotionSubscription.remove();
    };
  }, []);

  const diagnostic: MobileAccessibilityDiagnostic = {
    onLayout(id, frame) {
      frames[id] = frame;
      scheduleReportWrite();
    },
    onTextLayout(id, lines, metrics) {
      frames[`${id}.text`] = { lines, metrics };
      scheduleReportWrite();
    },
    onRemove(id) {
      delete frames[id];
      scheduleReportWrite();
    },
  };

  const writeReport = () => {
      const requiredMeasurements = [
        "qa.viewport",
        "qa.scroll-viewport",
        "qa.host",
        "today.goal",
        "today.goal.date.frame",
        "today.goal.date.text",
        "today.goal.total.frame",
        "today.goal.total.text",
        "today.goal.of.frame",
        "today.goal.of.text",
        "today.goal.cells",
        "today-blocks.card",
        "today-blocks.row.H01-cross-midnight",
        "today-blocks.title.H01-cross-midnight.frame",
        "today-blocks.title.H01-cross-midnight.text",
        "today-blocks.meta.H01-cross-midnight.frame",
        "today-blocks.meta.H01-cross-midnight.text",
        "today-blocks.duration.H01-cross-midnight.frame",
        "today-blocks.duration.H01-cross-midnight.text",
        "today-blocks.count.H03-count-12-1.frame",
        "today-blocks.count.H03-count-12-1.text",
        "today-blocks.count.H03-count-123-1.frame",
        "today-blocks.count.H03-count-123-1.text",
        "settings.row",
        "settings.text-column",
        "settings.label.frame",
        "settings.label.text",
        "settings.value.frame",
        "settings.value.text",
        "settings.chevron",
      ];
      if (showRunningTimer) {
        requiredMeasurements.push("today.timer.running", "today.timer.title.frame", "today.timer.title.text", "today.timer.elapsed.frame");
      } else {
        requiredMeasurements.push("today.timer.idle", "today.timer.composer.frame");
      }
      const missingMeasurementIds = [...new Set(requiredMeasurements)].filter((id) => !(id in frames));
      const result = {
        source: "synthetic native accessibility probe",
        viewport: { width: deviceWidth, height: deviceHeight },
        orientation: deviceWidth > deviceHeight ? "landscape" : "portrait",
        diagnosticHostWidth: hostWidth,
        pixelRatio: PixelRatio.get(),
        fontScale: PixelRatio.getFontScale(),
        boldText,
        reduceMotion,
        appearance: theme.mode,
        visibleState: {
          timer: showRunningTimer ? "running" : "idle",
        },
        platform: Platform.OS,
        osVersion: String(Platform.Version),
        reactNativeVersion: Platform.constants.reactNativeVersion,
        contentSizeCategory: process.env.EXPO_PUBLIC_MOBILE_ACCESSIBILITY_QA_CATEGORY ?? "record iOS Simulator category in investigation run log",
        ancestorRelationships: {
          "qa.host": "qa.scroll-viewport; synthetic component-width host",
          "qa.scroll-viewport": "qa.viewport; the only scroll owner for the diagnostic entry",
          "today.goal.date.frame": "today.goal",
          "today.goal.total.frame": "today.goal",
          "today.goal.of.frame": "today.goal",
          "today.goal.cells": "today.goal",
          "today.timer.title.frame": "today.timer.running",
          "today.timer.elapsed.frame": "today.timer.running",
          "today-blocks.card": "qa.host; the card clips rows (overflow hidden), so rows must stay within it",
          "today-blocks.row.*": "today-blocks.card",
          "today-blocks.title.*.frame": "today-blocks.row.*",
          "today-blocks.meta.*.frame": "today-blocks.row.*",
          "today-blocks.duration.*.frame": "today-blocks.row.*",
          "settings.row": "qa.host; settingsGroupRows has rounded-corner overflow clipping and rows grow intrinsically",
          "settings.label.frame": "settings.text-column",
          "settings.value.frame": "settings.text-column",
        },
        diagnosticComplete: missingMeasurementIds.length === 0,
        missingMeasurementIds,
        report: "geometry contains fixture IDs and line metrics only; text values are omitted",
        frames,
      };
      new File(Paths.cache, "mobile-accessibility-qa.json").write(JSON.stringify(result));
  };
  reportWriterRef.current = writeReport;

  useEffect(() => {
    const timer = setTimeout(() => reportWriterRef.current(), 2_000);
    return () => clearTimeout(timer);
  }, [deviceWidth, deviceHeight, hostWidth, boldText, reduceMotion, theme.mode, showRunningTimer]);

  useEffect(() => () => {
    if (reportTimerRef.current) clearTimeout(reportTimerRef.current);
  }, []);

  const now = new Date(2026, 8, 12, 16).getTime();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: 42 }} onLayout={(event) => recordMobileLayout(diagnostic, "qa.viewport", event)}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 12, paddingBottom: 8 }}>
          {widths.map((width) => (
          <Pressable key={width} accessibilityLabel={`Set diagnostic width to ${width} points`} accessibilityRole="button" accessibilityState={{ selected: hostWidth === width, disabled: width > deviceWidth }} disabled={width > deviceWidth} onPress={() => setHostWidth(width)} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}>
              <Text {...mobileTextProps("control")} style={{ color: theme.textPrimary, fontSize: 12 }}>{width} pt</Text>
            </Pressable>
          ))}
          <Pressable accessibilityLabel={showRunningTimer ? "Show idle timer fixture" : "Show running timer fixture"} accessibilityRole="button" accessibilityState={{ selected: showRunningTimer }} onPress={() => setShowRunningTimer((current) => !current)} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}>
            <Text {...mobileTextProps("control")} style={{ color: theme.textPrimary, fontSize: 12 }}>{showRunningTimer ? "Running timer" : "Idle timer"}</Text>
          </Pressable>
          <Pressable accessibilityLabel="Show Today summary and Settings fixtures" accessibilityRole="button" onPress={() => scrollRef.current?.scrollTo({ y: 800, animated: false })} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}>
            <Text {...mobileTextProps("control")} style={{ color: theme.textPrimary, fontSize: 12 }}>Lower fixtures</Text>
          </Pressable>
          <Pressable accessibilityLabel="Show Review detail fixture" accessibilityRole="button" onPress={() => scrollRef.current?.scrollToEnd({ animated: false })} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}>
            <Text {...mobileTextProps("control")} style={{ color: theme.textPrimary, fontSize: 12 }}>Review detail</Text>
          </Pressable>
        </View>
        <ScrollView
          ref={scrollRef}
          onLayout={(event) => recordMobileLayout(diagnostic, "qa.scroll-viewport", event)}
          style={{ flex: 1, width: "100%" }}
          contentContainerStyle={{ alignItems: "center", gap: 14, paddingBottom: 120 }}
        >
          <View style={{ width: hostWidth, gap: 14 }} onLayout={(event) => recordMobileLayout(diagnostic, "qa.host", event)}>
            <TodayGoalFrame
              dateLabel="Saturday 12 September"
              diagnostic={diagnostic}
              theme={theme}
              {...buildTodayGoalFrame({ entries: fixtures.map((item) => item.entry), goalMinutes: 480, nowMs: now })}
            />
            <TodayTimerSurface
              active={showRunningTimer ? {
                categoryColor: "moss",
                categoryIcon: "work",
                categoryLabel: "A long synthetic activity label",
                elapsedLabel: "12:34:56",
                elapsedSeconds: 45296,
                hasLiveActiveTimer: true,
                startedLabel: "Started 09:12",
                title: "A long synthetic timer title for layout testing",
                titleIsPlaceholder: false,
              } : null}
              diagnostic={diagnostic}
              liveLanding={null}
              onAddTime={() => setActionResult("Local Add time callback")}
              onOpenActiveTimer={() => setActionResult("Local active timer editor callback")}
              onStartActivity={(activityId) => setActionResult(`Local quick start callback: ${activityId}`)}
              onStartBlank={() => setActionResult("Local blank timer callback")}
              onSwitch={() => undefined}
              onStop={() => setActionResult("Local Stop callback")}
              quickStartColumns={layoutQuickStartMosaic([
                { color: "moss", icon: "work", id: "qa-activity", name: "Long synthetic activity name", weekSeconds: 7200 },
                { color: "blue", icon: null, id: "qa-activity-2", name: "Second synthetic activity", weekSeconds: 1800 },
                { color: "amber", icon: "learning", id: "qa-activity-3", name: "Third", weekSeconds: 600 },
              ])}
              reduceMotion={false}
              runningActivityId={showRunningTimer ? "qa-activity" : null}
              theme={theme}
            />
            <TodayBlockRows
              activeTimerRunning={showRunningTimer}
              activityIconFor={() => null}
              diagnostic={diagnostic}
              groups={groupHistoryDayEntries(fixtures)}
              nowMs={now}
              onDeleteEntries={(deleted) => setActionResult(`Local delete callback: ${deleted.length} synthetic entries`)}
              onOpenEntry={(opened) => setActionResult(`Local edit callback: ${opened.id}`)}
              onReplayEntry={(replayed) => setActionResult(`Local replay callback: ${replayed.id}`)}
              reduceMotion={reduceMotion}
              rowLanding={null}
              theme={theme}
            />
            <View style={{ gap: 8 }}>
              <Text {...mobileTextProps("sectionHeading")} style={styles.sectionTitle}>Settings</Text>
              <SettingsBlockGroup theme={theme} title="Automatic tracking">
                <SettingsBlockRow
                  diagnostic={diagnostic}
                  divider={false}
                  onPress={() => setActionResult("Local Settings row callback")}
                  subtitle="Always"
                  theme={theme}
                  title="Location"
                />
              </SettingsBlockGroup>
            </View>
            <Text {...mobileTextProps("body")} style={{ color: theme.textSecondary, fontSize: 12 }}>{actionResult}</Text>
          </View>
        </ScrollView>
      </View>
    </GestureHandlerRootView>
  );
}

AppRegistry.registerComponent("main", () => function AccessibilityLayoutQa() {
  return <MobileThemeProvider><Probe /></MobileThemeProvider>;
});
