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
import type { MobileReviewItem, MobileTimeEntry } from "../src/lib/api";
import { HistoryDayCard } from "../src/components/DayframeDashboard";
import { TodayDateHeading } from "../src/components/accessibility/TodayDateHeading";
import { TodayLoggedSummary } from "../src/components/accessibility/TodayLoggedSummary";
import { TodayTimerSurface } from "../src/components/accessibility/TodayTimerSurface";
import { ReviewItemCard } from "../app/review";
import { SettingsMenuRow } from "../app/settings";
import { MobileThemeProvider, useMobileTheme } from "../src/lib/mobileTheme";
import { mobileTextProps } from "../src/lib/mobileTypography";
import { TagMetadata } from "../src/components/TagMetadata";

const frames: Record<string, unknown> = {};
const widths = [320, 375, 390, 430];
const reviewCounts = [0, 1, 2, 99, 999, 10_000];
const loggedStressValues = ["0m", "3h 37m", "11h 13m", "999h 59m", "100000h"];

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

const reviewFixture: MobileReviewItem = {
  id: "V01-synthetic-review",
  type: "activity_suggestion",
  title: "Synthetic detected activity with a deliberately long proposal title",
  eventSource: "healthkit",
  eventType: "workout_summary",
  categoryName: "Synthetic category",
  categoryColor: "#6B8E73",
  placeName: null,
  suggestedCategoryId: "qa-category",
  suggestedPlaceId: null,
  suggestedStartedAt: syntheticTime(12, 7, 0),
  suggestedStoppedAt: syntheticTime(12, 8, 25),
  confidence: "medium",
  status: "open",
  notes: "Synthetic review reason. This longer explanation verifies that policy and safety copy wraps rather than disappearing below a fixed line limit.",
  rawPayload: null,
  createdAt: syntheticTime(12, 8, 25),
};

function Probe() {
  const { styles, theme } = useMobileTheme();
  const { width: deviceWidth, height: deviceHeight } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [hostWidth, setHostWidth] = useState(() =>
    deviceWidth >= 390 ? 390 : deviceWidth >= 375 ? 375 : 320,
  );
  const [reviewCountIndex, setReviewCountIndex] = useState(3);
  const [loggedStressIndex, setLoggedStressIndex] = useState(0);
  const [boldText, setBoldText] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [showRunningTimer, setShowRunningTimer] = useState(false);
  const [actionResult, setActionResult] = useState("No probe action has run.");
  const reviewCount = reviewCounts[reviewCountIndex];
  const reviewNoticeVisible = reviewCount > 0;
  const reportWriterRef = useRef<() => void>(() => {});
  const reportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReportWrite = () => {
    if (reportTimerRef.current) clearTimeout(reportTimerRef.current);
    reportTimerRef.current = setTimeout(() => {
      reportTimerRef.current = null;
      reportWriterRef.current();
    }, 200);
  };
  const previousVisibility = useRef({ reviewNoticeVisible, showRunningTimer });
  if (previousVisibility.current.showRunningTimer !== showRunningTimer) {
    const hiddenTimerPrefix = showRunningTimer ? "today.timer.idle" : "today.timer.running";
    for (const key of Object.keys(frames)) {
      if (key === hiddenTimerPrefix || key.startsWith(`${hiddenTimerPrefix}.`)) delete frames[key];
    }
    if (showRunningTimer) delete frames["today.timer.composer.frame"];
  }
  if (previousVisibility.current.reviewNoticeVisible !== reviewNoticeVisible && !reviewNoticeVisible) {
    for (const key of Object.keys(frames)) {
      if (key.startsWith("review-notice.")) delete frames[key];
    }
  }
  previousVisibility.current = { reviewNoticeVisible, showRunningTimer };
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
        "today.heading",
        "today.heading.title.frame",
        "today.heading.title.text",
        "today.heading.date.frame",
        "today.heading.date.text",
        "history.card",
        "history.row.H01-cross-midnight",
        "history.title.H01-cross-midnight.frame",
        "history.title.H01-cross-midnight.text",
        "history.time.H01-cross-midnight.frame",
        "history.time.H01-cross-midnight.text",
        "history.replay.H01-cross-midnight",
        "history.count-text.H03-count-12-1.frame",
        "history.count-text.H03-count-12-1.text",
        "history.count-text.H03-count-123-1.frame",
        "history.count-text.H03-count-123-1.text",
        "logged.row",
        "logged.label.frame",
        "logged.label.text",
        "logged.value.frame",
        "logged.value.text",
        "logged.stress.row",
        "logged.stress.label.frame",
        "logged.stress.label.text",
        "logged.stress.value.frame",
        "logged.stress.value.text",
        "settings.row",
        "settings.icon",
        "settings.text-column",
        "settings.label.frame",
        "settings.label.text",
        "settings.value.frame",
        "settings.value.text",
        "settings.chevron",
        "review.card",
        "review.header",
        "review.badge",
        "review.title.frame",
        "review.title.text",
        "review.reason.frame",
        "review.reason.text",
      ];
      if (showRunningTimer) {
        requiredMeasurements.push("today.timer.running", "today.timer.title.frame", "today.timer.title.text", "today.timer.elapsed.frame", "today.timer.elapsed.text");
      } else {
        requiredMeasurements.push("today.timer.idle", "today.timer.composer.frame");
      }
      if (reviewCount > 0) {
        requiredMeasurements.push("review-notice.container", "review-notice.count.frame", "review-notice.count.text", "review-notice.action.frame", "review-notice.action.text");
      }
      if (frames["history.child-time.H03-group-1.0.frame"]) {
        for (const childIndex of [0, 1]) {
          requiredMeasurements.push(
            `history.child-time.H03-group-1.${childIndex}.frame`,
            `history.child-time.H03-group-1.${childIndex}.text`,
            `history.child-duration.H03-group-1.${childIndex}.frame`,
            `history.child-duration.H03-group-1.${childIndex}.text`,
          );
        }
      }
      for (const id of [
        "tags.removable",
        "tags.removable.group.0",
        "tags.removable.group.1",
        "tags.removable.remove.0",
        "tags.removable.remove.1",
        "tags.removable.text.0.frame",
        "tags.removable.text.0.text",
        "tags.removable.text.1.frame",
        "tags.removable.text.1.text",
      ]) requiredMeasurements.push(id);
      for (const id of ["H01-cross-midnight", "H02-long-title", "H03-group-1", "H03-count-12-1", "H03-count-123-1"]) {
        if (!frames[`history.duration.${id}.frame`] && !frames[`history.duration-stacked.${id}.frame`]) {
          requiredMeasurements.push(`history.duration-layout.${id}`);
        }
      }
      const missingMeasurementIds = [...new Set(requiredMeasurements)].filter((id) => !(id in frames));
      const removableTagTargetIds = ["tags.removable.remove.0", "tags.removable.remove.1"];
      const removableTagTargets = removableTagTargetIds.map((id) => frames[id] as {
        x: number; y: number; width: number; height: number;
      } | undefined);
      const removableTagAbsoluteTargets = removableTagTargets.map((frame, index) => {
        const tagRow = frames["tags.removable"] as { x: number; y: number } | undefined;
        const group = frames[`tags.removable.group.${index}`] as { x: number; y: number } | undefined;
        if (!frame || !tagRow || !group) return undefined;
        return {
          x: tagRow.x + group.x + frame.x,
          y: tagRow.y + group.y + frame.y,
          width: frame.width,
          height: frame.height,
        };
      });
      const removableTagTargetsMeasured = removableTagAbsoluteTargets.every(Boolean);
      const removableTagTargetsAtLeast44 = removableTagTargetsMeasured && removableTagTargets.every((frame) =>
        Boolean(frame && frame.width >= 44 && frame.height >= 44),
      );
      const removableTagTargetsDoNotOverlap = removableTagTargetsMeasured && (() => {
        const [first, second] = removableTagAbsoluteTargets;
        if (!first || !second) return false;
        return first.x + first.width <= second.x || second.x + second.width <= first.x ||
          first.y + first.height <= second.y || second.y + second.height <= first.y;
      })();
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
          reviewNotice: reviewCount > 0,
          loggedStressFixture: `L01-${loggedStressIndex}`,
          timer: showRunningTimer ? "running" : "idle",
        },
        platform: Platform.OS,
        osVersion: String(Platform.Version),
        reactNativeVersion: Platform.constants.reactNativeVersion,
        contentSizeCategory: process.env.EXPO_PUBLIC_MOBILE_ACCESSIBILITY_QA_CATEGORY ?? "record iOS Simulator category in investigation run log",
        ancestorRelationships: {
          "qa.host": "qa.scroll-viewport; synthetic component-width host",
          "qa.scroll-viewport": "qa.viewport; the only scroll owner for the diagnostic entry",
          "today.heading.title.frame": "today.heading",
          "today.heading.date.frame": "today.heading",
          "today.timer.title.frame": "today.timer.running",
          "today.timer.elapsed.frame": "today.timer.running",
          "history.card": "qa.host; todayEntryCard uses overflow:hidden, so children must remain within the measured rounded-card bounds",
          "history.row.*": "history.card",
          "history.main.*": "history.row.*",
          "history.title.*.frame": "history.main.*",
          "history.time.*.frame": "history.main.*",
          "history.actions.*": "history.row.*",
          "history.duration.*.frame": "history.actions.*",
          "history.replay.*": "history.actions.*",
          "settings.row": "qa.host; settingsGroupRows has rounded-corner overflow clipping and rows grow intrinsically",
          "settings.label.frame": "settings.text-column",
          "settings.value.frame": "settings.text-column",
          "review.card": "qa.host; review card has no fixed maximum height",
          "review.title.frame": "review.header",
          "review.reason.frame": "review.card",
          "logged.row": "history.card sibling",
          "logged.value.frame": "logged.row",
        },
        diagnosticComplete: missingMeasurementIds.length === 0,
        missingMeasurementIds,
        interactiveTargetAudit: {
          removableTagTargetsAtLeast44,
          removableTagTargetsDoNotOverlap,
          coordinateSpace: "tag targets translated through measured row and tag-group ancestors",
          targets: removableTagTargetIds.map((id, index) => ({
            id,
            localFrame: frames[id] ?? null,
            frame: removableTagAbsoluteTargets[index] ?? null,
          })),
        },
        report: "geometry contains fixture IDs and line metrics only; text values are omitted",
        frames,
      };
      new File(Paths.cache, "mobile-accessibility-qa.json").write(JSON.stringify(result));
  };
  reportWriterRef.current = writeReport;

  useEffect(() => {
    const timer = setTimeout(() => reportWriterRef.current(), 2_000);
    return () => clearTimeout(timer);
  }, [deviceWidth, deviceHeight, hostWidth, boldText, reduceMotion, theme.mode, reviewCount, loggedStressIndex, showRunningTimer]);

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
          <Pressable accessibilityLabel={`Advance synthetic Logged total to ${loggedStressValues[(loggedStressIndex + 1) % loggedStressValues.length]}`} accessibilityRole="button" onPress={() => setLoggedStressIndex((index) => (index + 1) % loggedStressValues.length)} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}>
            <Text {...mobileTextProps("control")} style={{ color: theme.textPrimary, fontSize: 12 }}>Logged total {loggedStressValues[loggedStressIndex]}</Text>
          </Pressable>
          <Pressable accessibilityLabel={`Advance synthetic Review count to ${reviewCounts[(reviewCountIndex + 1) % reviewCounts.length]}`} accessibilityRole="button" onPress={() => setReviewCountIndex((index) => (index + 1) % reviewCounts.length)} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}>
            <Text {...mobileTextProps("control")} style={{ color: theme.textPrimary, fontSize: 12 }}>Review count {reviewCount}</Text>
          </Pressable>
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
            <TodayDateHeading dateLabel="Saturday, 12 September 2026" styles={styles} diagnostic={diagnostic} />
            <TodayTimerSurface
              active={showRunningTimer ? {
                categoryColor: "#6B8E73",
                categoryLabel: "A long synthetic category label",
                elapsedLabel: "12:34:56",
                hasLiveActiveTimer: true,
                title: "A long synthetic timer title for layout testing",
                titleIsPlaceholder: false,
              } : null}
              diagnostic={diagnostic}
              onAddTime={() => setActionResult("Local Add time callback")}
              onOpenActiveTimer={() => setActionResult("Local active timer editor callback")}
              onStartBlank={() => setActionResult("Local blank timer callback")}
              onStartQuickAction={(action) => setActionResult(`Local quick action callback: ${action.key}`)}
              onStop={() => setActionResult("Local Stop callback")}
              quickActions={[
                { color: "moss", id: "qa-category", isUncategorized: false, key: "synthetic-quick-action", name: "Long synthetic category action", subtitle: "Synthetic" },
                { color: null, id: null, isUncategorized: true, key: "synthetic-uncategorized", name: "Uncategorized", subtitle: null },
              ]}
              styles={styles}
              theme={theme}
            />
            <HistoryDayCard
              activeTimerRunning={false}
              now={now}
              onDeleteEntries={(deleted) => setActionResult(`Local delete callback: ${deleted.length} synthetic entries`)}
              onOpenEntry={(opened) => setActionResult(`Local edit callback: ${opened.id}`)}
              onOpenReview={() => setActionResult("Local Review navigation callback")}
              onReplayEntry={(replayed) => setActionResult(`Local replay callback: ${replayed.id}`)}
              reviewCount={reviewCount}
              section={{
                date: new Date(2026, 8, 12),
                entries: fixtures,
                isToday: true,
                key: "synthetic-2026-09-12",
                totalSeconds: fixtures.reduce((sum, item) => sum + item.overlapSeconds, 0),
              }}
              styles={styles}
              theme={theme}
              diagnostic={diagnostic}
            />
            <View style={{ width: hostWidth, gap: 6 }}>
              <Text {...mobileTextProps("counter")} style={styles.quickCategoryHint}>L01 LOGGED TOTAL STRESS</Text>
              <TodayLoggedSummary
                value={loggedStressValues[loggedStressIndex]}
                coveredValue="6h 34m covered"
                styles={styles}
                diagnostic={diagnostic}
                diagnosticPrefix="logged.stress"
              />
            </View>
            <View style={{ width: hostWidth }}>
              <Text {...mobileTextProps("counter")} style={styles.quickCategoryHint}>H05 REMOVABLE TAGS</Text>
              <TagMetadata
                active
                diagnostic={diagnostic}
                diagnosticPrefix="tags.removable"
                onPressTag={(tagName) => setActionResult(`Local remove-tag callback: ${tagName}`)}
                styles={styles}
                tagNames={["synthetic-remove-one", "synthetic-remove-long-tag-name"]}
                theme={theme}
              />
            </View>
            <View style={{ gap: 8 }}>
              <Text {...mobileTextProps("sectionHeading")} style={styles.sectionTitle}>Settings</Text>
              <SettingsMenuRow
                icon="appearance"
                label="Places & Location"
                value="Always"
                onPress={() => setActionResult("Local Settings row callback")}
                styles={styles}
                theme={theme}
                diagnostic={diagnostic}
              />
            </View>
            <ReviewItemCard
              item={reviewFixture}
              menuOpen={false}
              now={now}
              onConfirm={() => setActionResult("Local Review confirm callback")}
              onToggleMenu={() => setActionResult("Local Review menu callback")}
              onViewEvidence={() => setActionResult("Local evidence callback")}
              overlapCount={0}
              syncState={null}
              styles={styles}
              theme={theme}
              diagnostic={diagnostic}
            />
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
