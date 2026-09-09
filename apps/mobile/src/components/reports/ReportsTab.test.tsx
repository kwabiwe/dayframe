import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
  callback(0);
  return 1;
});

vi.mock("react", async () => {
  // @ts-expect-error The workspace currently installs the renderer's peer React at the repository root.
  return import("../../../../../node_modules/react/index.js");
});

vi.mock("react-native", () => ({
  AccessibilityInfo: { setAccessibilityFocus: vi.fn() },
  AppState: { currentState: "active", addEventListener: () => ({ remove: vi.fn() }) },
  Modal: "Modal",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { absoluteFill: {}, create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  findNodeHandle: () => 1
}));

vi.mock("react-native-reanimated", () => ({
  default: { View: "AnimatedView" },
  FadeIn: { duration: () => ({}) },
  FadeOut: { duration: () => ({}) }
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }) }));

vi.mock("@/components/charts/DonutChart", () => ({ DonutChart: "DonutChart" }));
vi.mock("@/components/SegmentedPillControl", () => ({ SegmentedPillControl: "SegmentedPillControl" }));
vi.mock("@/lib/motion", () => ({ MOBILE_MOTION: { control: 140 }, useResolvedReduceMotionPreference: () => ({ reduceMotion: true, resolved: true }) }));
vi.mock("@/lib/reportsPresentation", async () => import("../../lib/reportsPresentation"));
vi.mock("@/lib/reportsSelection", async () => import("../../lib/reportsSelection"));
vi.mock("@/lib/review", async () => import("../../lib/review"));

import { ReportsTab } from "./ReportsTab";
import type { MobileBootstrap } from "@/lib/api";

const data: MobileBootstrap = {
  activeEntry: null,
  categories: [
    { id: "work", name: "Work", color: "blue", isPinned: false },
    { id: "health", name: "Health", color: "green", isPinned: false }
  ],
  entryCoverage: {
    capturedAt: "2026-09-08T12:00:00.000Z",
    dayEntries: { from: "2026-09-08T00:00:00.000Z", toExclusive: "2026-09-09T00:00:00.000Z", limit: 100, hasMore: false },
    weekEntries: { from: "2026-09-07T00:00:00.000Z", toExclusive: "2026-09-14T00:00:00.000Z", limit: 300, hasMore: false },
    historyEntries: { from: "2026-06-10T00:00:00.000Z", toExclusive: "2026-09-09T00:00:00.000Z", limit: 2000, hasMore: false }
  },
  entries: [{
    categoryColor: "blue", categoryId: "work", categoryName: "Work", clientName: null,
    confidence: "high", description: null, durationSeconds: 3600, id: "entry", placeName: null,
    projectColor: null, projectId: null, projectName: null, reviewStatus: "confirmed", source: "mobile_app",
    startedAt: "2026-09-08T09:00:00.000Z", stoppedAt: "2026-09-08T10:00:00.000Z"
  }],
  places: [], projects: [], reviewItems: [], user: { id: "user", email: "", name: "" }, workspace: { id: "workspace", name: "" }
};
const sharedStyles = { tabScreenStack: {}, panel: {}, reportScreenTitle: {}, lifecyclePanel: {}, sectionTitle: {}, reviewNote: {}, label: {} } as never;
const theme = {
  accent: "accent", accentSoft: "accent-soft", accentText: "accent-text", background: "background",
  border: "border", borderStrong: "border-strong", chartTrack: "track", danger: "danger", dangerText: "danger-text",
  disabled: "disabled", focus: "focus", info: "info", mode: "dark", onAccent: "on-accent", onDanger: "on-danger",
  overlay: "overlay", pressed: "pressed", shadow: "shadow", success: "success", surface: "surface",
  surfaceInset: "inset", surfaceMuted: "muted", surfaceRaised: "raised", textMuted: "text-muted",
  textPrimary: "text-primary", textSecondary: "text-secondary", warning: "warning", warningText: "warning-text"
} as never;

describe("ReportsTab", () => {
  it("uses the same category action for legend filtering and preserves the context denominator", () => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<ReportsTab data={data} isFocused nowMs={Date.parse("2026-09-08T12:00:00.000Z")} styles={sharedStyles} theme={theme} />); });
    const initialChart = tree.root.findByType("DonutChart" as never);
    expect(initialChart.props.centerValue).toBe("1h");
    expect(initialChart.props.segments).toHaveLength(1);
    const legend = tree.root.findAllByType("Pressable" as never).find((node) => String(node.props.accessibilityLabel).startsWith("Work, 1h"));
    expect(legend).toBeDefined();
    act(() => legend!.props.onPress());
    expect(tree.root.findByType("DonutChart" as never).props.segments[0]).toMatchObject({ id: "work", selected: true, value: 3_600_000 });
    act(() => legend!.props.onPress());
    expect(tree.root.findByType("DonutChart" as never).props.centerValue).toBe("1h");
  });

  it("opens a draft filter sheet and category bars expose no filtering button", () => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<ReportsTab data={data} isFocused nowMs={Date.parse("2026-09-08T12:00:00.000Z")} styles={sharedStyles} theme={theme} />); });
    act(() => tree.root.findByProps({ accessibilityLabel: "Filters" }).props.onPress());
    expect(tree.root.findByType("Modal" as never)).toBeDefined();
    const chartControl = tree.root.findAllByType("SegmentedPillControl" as never).find((node) => node.props.accessibilityLabel === "Category chart type")!;
    act(() => chartControl.props.onChange("bars"));
    const bar = tree.root.findAll((node) => node.props.accessibilityLabel === "Work, 1h").find((node) => String(node.type) === "View");
    expect(bar).toBeDefined();
    expect(bar!.props.onPress).toBeUndefined();
  });

  it("explains a zero-time category selection while retaining the dimmed context ring", () => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<ReportsTab data={data} isFocused nowMs={Date.parse("2026-09-08T12:00:00.000Z")} styles={sharedStyles} theme={theme} />); });
    act(() => tree.root.findByProps({ accessibilityLabel: "Filters" }).props.onPress());
    act(() => tree.root.findByProps({ accessibilityLabel: "Work" }).props.onPress());
    act(() => tree.root.findByProps({ accessibilityLabel: "Apply filters" }).props.onPress());

    const chart = tree.root.findByType("DonutChart" as never);
    expect(chart.props.centerValue).toBe("0m");
    expect(chart.props.segments).toEqual([
      expect.objectContaining({ id: "work", selected: false, value: 3_600_000 })
    ]);
    expect(tree.root.findAllByProps({ children: "No logged time for the selected categories." })).toHaveLength(1);
    expect(tree.root.findByProps({ accessibilityLabel: "Filters, 1 categories selected" })).toBeDefined();
  });

  it("replaces keyed chart owners when switching between Pie and Bars", () => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<ReportsTab data={data} isFocused nowMs={Date.parse("2026-09-08T12:00:00.000Z")} styles={sharedStyles} theme={theme} />); });
    const pie = tree.root.findByProps({ testID: "reports-pie-chart" });
    const chartControl = tree.root.findAllByType("SegmentedPillControl" as never).find((node) => node.props.accessibilityLabel === "Category chart type")!;
    act(() => chartControl.props.onChange("bars"));
    const bars = tree.root.findByProps({ testID: "reports-bars-chart" });
    expect(bars).not.toBe(pie);
  });

  it("uses the unfiltered empty-state copy in Bars when the report has no time", () => {
    const emptyData = { ...data, entries: [] };
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<ReportsTab data={emptyData} isFocused nowMs={Date.parse("2026-09-08T12:00:00.000Z")} styles={sharedStyles} theme={theme} />); });
    const chartControl = tree.root.findAllByType("SegmentedPillControl" as never).find((node) => node.props.accessibilityLabel === "Category chart type")!;
    act(() => chartControl.props.onChange("bars"));
    expect(tree.root.findAllByProps({ children: "No tracked time yet." })).toHaveLength(1);
    expect(tree.root.findAllByProps({ children: "No logged time for the selected categories." })).toHaveLength(0);
  });

  it("qualifies summary, chart context, and Daily independently when completeness is unknown", () => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<ReportsTab data={data} isFocused nowMs={Date.parse("2026-09-08T12:00:00.000Z")} styles={sharedStyles} theme={theme} />); });
    const dataWithoutCoverage = { ...data, entryCoverage: undefined };
    act(() => { tree.update(<ReportsTab data={dataWithoutCoverage} isFocused nowMs={Date.parse("2026-09-08T12:00:00.000Z")} styles={sharedStyles} theme={theme} />); });
    expect(tree.root.findAllByProps({ children: "Report completeness is unknown — based on available entries." })).toHaveLength(3);
  });

  it("closes an open filter draft on route blur while preserving applied selection", () => {
    const nowMs = Date.parse("2026-09-08T12:00:00.000Z");
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<ReportsTab data={data} isFocused nowMs={nowMs} styles={sharedStyles} theme={theme} />); });
    const legend = tree.root.findAllByType("Pressable" as never).find((node) => String(node.props.accessibilityLabel).startsWith("Work, 1h"));
    act(() => legend!.props.onPress());
    act(() => tree.root.findByProps({ accessibilityLabel: "Filters, 1 categories selected" }).props.onPress());
    expect(tree.root.findAllByType("Modal" as never)).toHaveLength(1);

    act(() => { tree.update(<ReportsTab data={data} isFocused={false} nowMs={nowMs + 60_000} styles={sharedStyles} theme={theme} />); });
    expect(tree.root.findAllByType("Modal" as never)).toHaveLength(0);

    act(() => { tree.update(<ReportsTab data={data} isFocused nowMs={nowMs + 120_000} styles={sharedStyles} theme={theme} />); });
    expect(tree.root.findByType("DonutChart" as never).props.segments[0]).toMatchObject({ id: "work", selected: true });
  });

  it("consumes the first populated presentation once without replaying on a clock tick or return", () => {
    const nowMs = Date.parse("2026-09-08T12:00:00.000Z");
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<ReportsTab data={data} isFocused nowMs={nowMs} styles={sharedStyles} theme={theme} />); });
    expect(tree.root.findByType("DonutChart" as never).props.animateEntrance).toBe(true);

    act(() => { tree.update(<ReportsTab data={data} isFocused nowMs={nowMs + 1000} styles={sharedStyles} theme={theme} />); });
    expect(tree.root.findByType("DonutChart" as never).props.animateEntrance).toBe(false);
    act(() => { tree.update(<ReportsTab data={data} isFocused={false} nowMs={nowMs + 2000} styles={sharedStyles} theme={theme} />); });
    act(() => { tree.update(<ReportsTab data={data} isFocused nowMs={nowMs + 3000} styles={sharedStyles} theme={theme} />); });
    expect(tree.root.findByType("DonutChart" as never).props.animateEntrance).toBe(false);
  });
});
