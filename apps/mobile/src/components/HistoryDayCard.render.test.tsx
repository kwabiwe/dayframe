import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileBootstrap } from "@/lib/api";
import type { HistoryDaySection } from "@/lib/historyPresentation";
import type { MobileStyles, MobileTheme } from "@/lib/mobileTheme";

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const mocks = vi.hoisted(() => ({
  fontScale: 1,
  windowWidth: 390,
  inertModule: () => new Proxy({}, {
    get: (_target, key) => key === "then" ? undefined : vi.fn(),
    has: () => true,
  }),
}));

vi.mock("react-native", () => ({
  AccessibilityInfo: {
    addEventListener: () => ({ remove: vi.fn() }),
    isBoldTextEnabled: () => new Promise<boolean>(() => undefined),
  },
  Alert: { alert: vi.fn() },
  Animated: {},
  AppState: { currentState: "active", addEventListener: () => ({ remove: vi.fn() }) },
  Easing: {},
  Linking: { openURL: vi.fn() },
  Pressable: "Pressable",
  RefreshControl: "RefreshControl",
  ScrollView: "ScrollView",
  StyleSheet: { absoluteFill: {}, create: (styles: unknown) => styles, flatten: (style: unknown) => style, hairlineWidth: 1 },
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  findNodeHandle: () => 1,
  useWindowDimensions: () => ({ fontScale: mocks.fontScale, width: mocks.windowWidth, height: 844 }),
}));
vi.mock("react-native-gesture-handler/ReanimatedSwipeable", () => ({ default: "ReanimatedSwipeable" }));
vi.mock("react-native-reanimated", () => ({
  default: { View: "AnimatedView" },
  Extrapolation: { CLAMP: "clamp" },
  interpolate: vi.fn(),
  useAnimatedStyle: vi.fn(() => ({})),
}));
vi.mock("react-native-svg", () => ({ default: "Svg", Circle: "Circle", Path: "Path" }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() }, useFocusEffect: vi.fn(), useIsFocused: () => true }));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView" }));

vi.mock("../../modules/dayframe-calendar", () => ({ DayframeCalendarView: () => null }));
vi.mock("@/components/ActiveTimerEditSheet", () => ({ ActiveTimerEditSheet: () => null }));
vi.mock("@/components/ConnectivityStatusStrip", () => ({ ConnectivityStatusIndicator: () => null }));
vi.mock("@/components/TagMetadata", () => ({ TagMetadata: () => null }));
vi.mock("@/components/accessibility/IntrinsicTextMeasure", async () => import("./accessibility/IntrinsicTextMeasure"));
vi.mock("@/components/accessibility/TodayDateHeading", () => ({ TodayDateHeading: () => null }));
vi.mock("@/components/accessibility/TodayLoggedSummary", async () => import("./accessibility/TodayLoggedSummary"));
vi.mock("@/components/accessibility/diagnostics", () => ({ recordMobileLayout: vi.fn(), recordMobileTextLayout: vi.fn() }));
vi.mock("@/components/reports/ReportsTab", () => ({ ReportsTab: () => null }));
vi.mock("@/components/brand", () => ({ DayframeBrand: () => null }));
vi.mock("@/components/PrimaryTimerAction", () => ({
  CompactReplayPlayGlyph: () => null,
  PrimaryTimerAction: () => null,
  PlusGlyph: () => null,
}));
vi.mock("@/components/accessibility/TodayTimerSurface", () => ({ TodayTimerSurface: () => null }));

vi.mock("@/lib/mobileTheme", () => ({ pressable: vi.fn(), useMobileTheme: vi.fn() }));
vi.mock("../lib/mobileTheme", () => ({ pressable: vi.fn(), useMobileTheme: vi.fn() }));
vi.mock("@/lib/historyPresentation", async () => import("../lib/historyPresentation"));
vi.mock("@/lib/mobileAccessibilityLayout", async () => import("../lib/mobileAccessibilityLayout"));
vi.mock("@/lib/mobileTypography", async () => import("../lib/mobileTypography"));
vi.mock("@/lib/api", () => mocks.inertModule());
vi.mock("@/lib/deepLinks", () => mocks.inertModule());
vi.mock("@/lib/backendIdentity", () => mocks.inertModule());
vi.mock("@/lib/calendarManualEntry", () => mocks.inertModule());
vi.mock("@/lib/config", () => mocks.inertModule());
vi.mock("@/lib/connectivity", () => mocks.inertModule());
vi.mock("@/lib/connectivityMonitor", () => mocks.inertModule());
vi.mock("@/lib/connectivityRecovery", () => mocks.inertModule());
vi.mock("@/lib/dashboardRefresh", () => mocks.inertModule());
vi.mock("@/lib/dashboardBootstrapChannel", () => mocks.inertModule());
vi.mock("@/lib/geofence", () => mocks.inertModule());
vi.mock("@/lib/location/runtime", () => mocks.inertModule());
vi.mock("@/lib/location/store", () => mocks.inertModule());
vi.mock("@/lib/mobileTags", () => mocks.inertModule());
vi.mock("@/lib/mobile-network", () => mocks.inertModule());
vi.mock("@/lib/mobileAccount", () => mocks.inertModule());
vi.mock("@/lib/durableLocalProjection", () => mocks.inertModule());
vi.mock("@/lib/durableLocalWork", () => mocks.inertModule());
vi.mock("@/lib/secure-session", () => mocks.inertModule());
vi.mock("@/lib/mobileLifecycle", () => mocks.inertModule());
vi.mock("@/lib/reviewSyncStore", () => mocks.inertModule());
vi.mock("@/lib/health", () => mocks.inertModule());
vi.mock("@/lib/liveActivity", () => mocks.inertModule());
vi.mock("@/lib/timerStopOutbox", () => mocks.inertModule());
vi.mock("@/lib/timerStopSync", () => mocks.inertModule());
vi.mock("@/lib/timerBackgroundExecution", () => mocks.inertModule());
vi.mock("@/lib/timeEntryOutbox", () => mocks.inertModule());
vi.mock("@/lib/timeEntrySheetPresentation", () => mocks.inertModule());
vi.mock("@/lib/historyDeletion", () => mocks.inertModule());
vi.mock("@/lib/mobileSessionTransition", () => mocks.inertModule());
vi.mock("@/lib/nativeCalendarPresentation", () => mocks.inertModule());
vi.mock("@/lib/review", () => mocks.inertModule());
vi.mock("@/lib/shortcuts", () => mocks.inertModule());
vi.mock("@/lib/timerPresentation", () => ({
  ...mocks.inertModule(),
  displayTimerDescription: () => null,
}));
vi.mock("@/lib/motion", () => ({
  MOBILE_MOTION: { control: 140, layout: 220 },
  localLayoutTransition: () => undefined,
  localPresenceEntering: () => undefined,
  localPresenceExiting: () => undefined,
  useReduceMotionPreference: () => false,
  useResolvedReduceMotionPreference: () => ({ reduceMotion: false, resolved: true }),
  useReduceTransparencyPreference: () => false,
}));

import { HistoryDayCard } from "./DayframeDashboard";

type TimeEntry = MobileBootstrap["entries"][number];

const now = new Date(2026, 8, 12, 12, 0, 0);
const nowMs = now.getTime();
const styles = new Proxy({}, { get: (_target, key) => String(key) }) as MobileStyles;
const theme = {
  accentText: "#ff775f",
  danger: "#c83d44",
  mode: "dark",
  onDanger: "#ffffff",
  textPrimary: "#ffffff",
  textSecondary: "#b7bec8",
  warningText: "#ffd078",
} as unknown as MobileTheme;

function makeEntry({
  id,
  seconds,
  stopped = true,
  stopOffsetSeconds = 60,
}: {
  id: string;
  seconds: number;
  stopped?: boolean;
  stopOffsetSeconds?: number;
}): TimeEntry {
  const stoppedAtMs = nowMs - stopOffsetSeconds * 1000;
  const startedAtMs = stoppedAtMs - seconds * 1000;
  return {
    categoryColor: "blue",
    categoryId: "work",
    categoryName: "Focus",
    clientName: null,
    confidence: "high",
    description: "Deep work",
    durationSeconds: seconds,
    id,
    placeName: null,
    projectColor: null,
    projectId: null,
    projectName: null,
    reviewStatus: "confirmed",
    source: "manual_app",
    startedAt: new Date(startedAtMs).toISOString(),
    stoppedAt: stopped ? new Date(stoppedAtMs).toISOString() : null,
    tagNames: [],
    tags: [],
  } as TimeEntry;
}

function makeSection(entries: TimeEntry[]): HistoryDaySection {
  return {
    date: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    entries: entries.map((entry) => ({
      entry,
      overlapSeconds: entry.stoppedAt
        ? entry.durationSeconds
        : Math.max(0, Math.floor((nowMs - Date.parse(entry.startedAt)) / 1000)),
    })),
    isToday: true,
    key: "2026-09-12",
    totalSeconds: entries.reduce((sum, entry) => sum + entry.durationSeconds, 0),
  };
}

function renderCard(section: HistoryDaySection) {
  const onDeleteEntries = vi.fn();
  const onOpenEntry = vi.fn();
  const onOpenReview = vi.fn();
  const onReplayEntry = vi.fn();
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(
      <HistoryDayCard
        activeTimerRunning={false}
        now={nowMs}
        onDeleteEntries={onDeleteEntries}
        onOpenEntry={onOpenEntry}
        onOpenReview={onOpenReview}
        onReplayEntry={onReplayEntry}
        reviewCount={0}
        section={section}
        styles={styles}
        theme={theme}
      />,
    );
  });
  return { tree, onDeleteEntries, onOpenEntry, onOpenReview, onReplayEntry };
}

function setCardWidth(tree: ReturnType<typeof create>, width: number) {
  const card = tree.root.findAllByType("View" as never).find(
    (node) => node.props.style === "todayEntryCard",
  );
  if (!card) throw new Error("HistoryDayCard did not render its entry card");
  act(() => card.props.onLayout({ nativeEvent: { layout: { width, height: 300, x: 0, y: 0 } } }));
}

function measureProbe(tree: ReturnType<typeof create>, prefix: string, width: number) {
  const probe = tree.root.findAllByType("Text" as never).find(
    (node) => String(node.props.testID ?? "").startsWith(`${prefix}-`),
  );
  if (!probe) throw new Error(`Missing text probe for ${prefix}`);
  act(() => probe.props.onTextLayout({ nativeEvent: { lines: [{ width, height: 18 }] } }));
  return probe;
}

function row(tree: ReturnType<typeof create>) {
  const result = tree.root.findAllByType("View" as never).find((node) =>
    Array.isArray(node.props.style) && node.props.style.includes("todayEntryRow"),
  );
  if (!result) throw new Error("HistoryDayCard did not render an entry row");
  return result;
}

function hasStyle(style: unknown, name: string) {
  return Array.isArray(style) ? style.includes(name) : style === name;
}

function visibleText(tree: ReturnType<typeof create>, styleName: string) {
  return tree.root.findAllByType("Text" as never)
    .filter((node) => node.props.testID === undefined && node.props.style === styleName)
    .map((node) => node.props.children);
}

function deleteAction(tree: ReturnType<typeof create>, labelPrefix: string) {
  const action = tree.root.findAllByType("Pressable" as never).find((node) =>
    String(node.props.accessibilityLabel ?? "").startsWith(labelPrefix) &&
    node.props.accessibilityActions?.some((item: { name: string }) => item.name === "delete"),
  );
  if (!action) throw new Error(`Missing accessible delete action: ${labelPrefix}`);
  return action;
}

beforeEach(() => {
  mocks.fontScale = 1;
  mocks.windowWidth = 390;
});

describe("rendered Today history card", () => {
  it("routes VoiceOver Delete to the completed group or exact child and blocks a running entry", () => {
    const entries = [
      makeEntry({ id: "first", seconds: 600, stopOffsetSeconds: 120 }),
      makeEntry({ id: "second", seconds: 600, stopOffsetSeconds: 720 }),
    ];
    const rendered = renderCard(makeSection(entries));
    const swipeables = rendered.tree.root.findAllByType("ReanimatedSwipeable" as never);
    expect(swipeables[0].props.enabled).toBe(true);
    expect(deleteAction(rendered.tree, "Expand 2 Focus entries").props.accessibilityActions).toEqual([
      { name: "delete", label: "Delete 2 Focus entries" },
    ]);

    const groupAction = deleteAction(rendered.tree, "Expand 2 Focus entries");
    act(() => groupAction.props.onAccessibilityAction({ nativeEvent: { actionName: "delete" } }));
    expect(rendered.onDeleteEntries).toHaveBeenLastCalledWith(entries);

    act(() => groupAction.props.onPress());
    const childAction = deleteAction(rendered.tree, "Edit Focus");
    act(() => childAction.props.onAccessibilityAction({ nativeEvent: { actionName: "delete" } }));
    expect(rendered.onDeleteEntries).toHaveBeenLastCalledWith([entries[0]]);

    const running = makeEntry({ id: "running", seconds: 0, stopped: false });
    const runningCard = renderCard(makeSection([running]));
    const runningMain = runningCard.tree.root.findAllByType("Pressable" as never).find(
      (node) => String(node.props.accessibilityLabel ?? "").startsWith("Edit Focus"),
    );
    expect(runningMain).toBeDefined();
    expect(runningMain!.props.accessibilityActions).toBeUndefined();
    expect(runningCard.tree.root.findByType("ReanimatedSwipeable" as never).props.enabled).toBe(false);
    act(() => runningMain!.props.onAccessibilityAction({ nativeEvent: { actionName: "delete" } }));
    expect(runningCard.onDeleteEntries).not.toHaveBeenCalled();
  });

  it("reflows a single entry from stacked to inline using measured duration and current row width", () => {
    const entry = makeEntry({ id: "single", seconds: 90 * 60 });
    const rendered = renderCard(makeSection([entry]));
    setCardWidth(rendered.tree, 320);
    expect(hasStyle(row(rendered.tree).props.style, "historyEntryStackedRow")).toBe(true);

    measureProbe(rendered.tree, "history-duration-measure", 125);
    expect(hasStyle(row(rendered.tree).props.style, "historyEntryStackedRow")).toBe(true);
    measureProbe(rendered.tree, "history-duration-measure", 40);
    expect(hasStyle(row(rendered.tree).props.style, "historyEntryStackedRow")).toBe(false);
    expect(visibleText(rendered.tree, "todayEntryMeta")).toContain("10:29-11:59");
    expect(visibleText(rendered.tree, "todayEntryDuration")).toContain("1h 30m");
    expect(visibleText(rendered.tree, "todayTrackedLabel")).toContain("Logged");
    expect(visibleText(rendered.tree, "todayTrackedValue")).toContain("1h 30m");

    setCardWidth(rendered.tree, 230);
    expect(hasStyle(row(rendered.tree).props.style, "historyEntryStackedRow")).toBe(true);
    setCardWidth(rendered.tree, 390);
    expect(hasStyle(row(rendered.tree).props.style, "historyEntryStackedRow")).toBe(false);
    expect(visibleText(rendered.tree, "todayEntryDuration")).toContain("1h 30m");
  });

  it("reserves a measured multi-digit group count, renders expanded children, and rejects stale duration probes", () => {
    const grouped = Array.from({ length: 12 }, (_, index) => makeEntry({
      id: `group-${index}`,
      seconds: 60,
      stopOffsetSeconds: (index + 1) * 120,
    }));
    const rendered = renderCard(makeSection(grouped));
    setCardWidth(rendered.tree, 320);
    const countProbe = treeProbe(rendered.tree, "history-group-count-measure");
    const durationProbe = treeProbe(rendered.tree, "history-duration-measure");
    expect(countProbe.props.children).toBe("88");

    measureProbe(rendered.tree, "history-group-count-measure", 30);
    measureProbe(rendered.tree, "history-duration-measure", 70);
    expect(hasStyle(row(rendered.tree).props.style, "historyEntryStackedRow")).toBe(true);
    measureProbe(rendered.tree, "history-group-count-measure", 12);
    expect(hasStyle(row(rendered.tree).props.style, "historyEntryStackedRow")).toBe(false);
    expect(visibleText(rendered.tree, "historyGroupCountText")).toContain(12);

    act(() => deleteAction(rendered.tree, "Expand 12 Focus entries").props.onPress());
    expect(rendered.tree.root.findAllByType("ReanimatedSwipeable" as never)).toHaveLength(13);
    expect(visibleText(rendered.tree, "historyGroupChildTime")).toHaveLength(12);
    expect(visibleText(rendered.tree, "todayEntryDuration")).toContain("12m");

    const staleDurationCallback = durationProbe.props.onTextLayout;
    const replacement = makeEntry({ id: "replacement", seconds: 60 * 60 });
    act(() => rendered.tree.update(
      <HistoryDayCard
        activeTimerRunning={false}
        now={nowMs}
        onDeleteEntries={rendered.onDeleteEntries}
        onOpenEntry={rendered.onOpenEntry}
        onOpenReview={rendered.onOpenReview}
        onReplayEntry={rendered.onReplayEntry}
        reviewCount={0}
        section={makeSection([replacement])}
        styles={styles}
        theme={theme}
      />,
    ));
    expect(hasStyle(row(rendered.tree).props.style, "historyEntryStackedRow")).toBe(true);
    act(() => staleDurationCallback({ nativeEvent: { lines: [{ width: 500, height: 18 }] } }));
    expect(hasStyle(row(rendered.tree).props.style, "historyEntryStackedRow")).toBe(true);
    measureProbe(rendered.tree, "history-duration-measure", 40);
    expect(hasStyle(row(rendered.tree).props.style, "historyEntryStackedRow")).toBe(false);
  });
});

function treeProbe(tree: ReturnType<typeof create>, prefix: string) {
  const probe = tree.root.findAllByType("Text" as never).find(
    (node) => String(node.props.testID ?? "").startsWith(`${prefix}-`),
  );
  if (!probe) {
    const ids = tree.root.findAllByType("Text" as never).map((node) => node.props.testID).filter(Boolean);
    throw new Error(`Missing text probe for ${prefix}; rendered probes: ${ids.join(", ")}`);
  }
  return probe;
}
