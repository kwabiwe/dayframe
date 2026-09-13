import { act, create } from "react-test-renderer";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { TodayActivity, TodayDonutSegment } from "@/lib/todayReviewPresentation";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
  useWindowDimensions: () => ({ fontScale: 1 })
}));
vi.mock("react-native-svg", () => ({ default: "Svg", Path: "Path" }));
vi.mock("../../lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));
vi.mock("../accessibility/IntrinsicTextMeasure", () => ({
  useIntrinsicTextMeasure: (samples: string[]) => ({
    widths: Object.fromEntries(samples.map((sample) => [sample, 72])),
    probe: null
  })
}));
vi.mock("../charts/DonutChart", () => ({
  DonutChart: (props: object) => createElement("View", { testID: "today-donut-chart", ...props })
}));

import { TodayReviewDonut } from "./TodayReviewDonut";

const theme = {
  borderStrong: "border",
  mode: "dark",
  textPrimary: "primary",
  textSecondary: "secondary"
} as never;

describe("TodayReviewDonut", () => {
  it("keeps a mixed-hour duration together on the second line", () => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<TodayReviewDonut activities={[]} animateEntrance={false} completedLoggedMs={26_460_000} isFocused onOpenActivity={vi.fn()} reduceMotion segments={[{ ...segments()[0], title: "Sleep", valueMs: 26_460_000 }]} theme={theme} />); });
    act(() => tree.root.findByProps({ testID: "today-review-donut" }).props.onLayout({ nativeEvent: { layout: { width: 390 } } }));
    expect(tree.root.findByProps({ testID: "today-donut-label-title" }).props.children).toBe("Sleep");
    const duration = tree.root.findByProps({ testID: "today-donut-label-duration" });
    expect(duration.props.children).toBe("7h 21m");
    expect(duration.props.numberOfLines).toBe(1);
    expect(duration.props.maxFontSizeMultiplier).toBe(1.3);
  });
  it("activates only the exact pending source; completed category arcs stay inert", () => {
    const onOpenActivity = vi.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <TodayReviewDonut
          activities={[activity()]}
          animateEntrance
          completedLoggedMs={3_600_000}
          isFocused
          onOpenActivity={onOpenActivity}
          reduceMotion={false}
          segments={segments()}
          theme={theme}
        />
      );
    });
    const root = tree.root.findByProps({ testID: "today-review-donut" });
    act(() => root.props.onLayout({ nativeEvent: { layout: { width: 390 } } }));
    const chart = tree.root.findByProps({ testID: "today-donut-chart" });
    const titles = tree.root.findAllByProps({ testID: "today-donut-label-title" });
    const durations = tree.root.findAllByProps({ testID: "today-donut-label-duration" });
    expect(titles).toHaveLength(2);
    expect(durations).toHaveLength(2);
    expect(titles.every((label) => label.props.numberOfLines === 1 && label.props.ellipsizeMode === "tail")).toBe(true);
    expect(durations.every((label) => label.props.numberOfLines === 1)).toBe(true);
    expect(durations.map((label) => label.props.children)).toEqual(expect.arrayContaining(["1h", "30m"]));
    expect(tree.root.findAllByType("Path" as never)).toHaveLength(2);
    const chartSegments = chart.props.segments as Array<{ id: string; interactive?: boolean; provisional?: boolean }>;
    expect(chartSegments.find((segment) => segment.id === "category:work")).toMatchObject({ interactive: false, provisional: false });
    expect(chartSegments.find((segment) => segment.id === "review:10000000-0000-4000-8000-000000000001")).toMatchObject({ interactive: true, provisional: true });

    act(() => chart.props.onPressSegment(chartSegments.find((segment) => segment.id === "category:work")));
    expect(onOpenActivity).not.toHaveBeenCalled();
    act(() => chart.props.onPressSegment(chartSegments.find((segment) => segment.id.startsWith("review:"))));
    expect(onOpenActivity).toHaveBeenCalledWith(activity());

    const labels = tree.root.findAllByType("Pressable" as never);
    expect(labels).toHaveLength(1);
    act(() => labels[0].props.onPress());
    expect(onOpenActivity).toHaveBeenCalledTimes(2);
  });
});

function segments(): TodayDonutSegment[] {
  return [
    {
      id: "category:work",
      kind: "completed",
      valueMs: 3_600_000,
      category: { id: "work", name: "Work", color: "coral" },
      title: "Work",
      source: null,
      provisional: false
    },
    {
      id: "review:10000000-0000-4000-8000-000000000001",
      kind: "pending",
      valueMs: 1_800_000,
      category: { id: "health", name: "Health", color: "moss" },
      title: "Synthetic walk",
      source: { kind: "review", reviewItemId: "10000000-0000-4000-8000-000000000001" },
      provisional: true
    }
  ];
}

function activity(): TodayActivity {
  return {
    presentationKey: "owner:review:10000000-0000-4000-8000-000000000001:2026-09-12",
    ownerKey: "owner",
    source: { kind: "review", reviewItemId: "10000000-0000-4000-8000-000000000001" },
    state: "needs_review",
    canonicalEntryIds: [],
    interval: { startMs: Date.parse("2026-09-12T09:00:00.000Z"), endMs: Date.parse("2026-09-12T09:30:00.000Z") },
    clippedInterval: { startMs: Date.parse("2026-09-12T09:00:00.000Z"), endMs: Date.parse("2026-09-12T09:30:00.000Z") },
    detectedAtMs: Date.parse("2026-09-12T09:00:00.000Z"),
    reviewSourceKind: "generic",
    title: "Synthetic walk",
    category: { id: "health", name: "Health", color: "moss" },
    placeLabel: null,
    awaitingDecision: true,
    countsAsLogged: false,
    quickConfirm: { eligible: false, reason: "Test" },
    resolution: "none"
  };
}
