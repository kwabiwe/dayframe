import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileBootstrap } from "@/lib/api";
import type { ReportSummary, ReportSummaryRequest } from "@dayframe/shared";
vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  fontScale: 1,
  subscriber: null as null | (() => void),
}));
vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
  callback();
  return 1;
});
vi.mock("react-native", () => ({
  AccessibilityInfo: { setAccessibilityFocus: vi.fn() },
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove: vi.fn() }),
  },
  Modal: "Modal",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { absoluteFill: {}, create: (s: unknown) => s, hairlineWidth: 1 },
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  findNodeHandle: () => 1,
  useWindowDimensions: () => ({
    fontScale: mocks.fontScale,
    width: 390,
    height: 844,
  }),
}));
vi.mock("react-native-reanimated", () => ({
  default: { View: "AnimatedView" },
  FadeIn: { duration: () => ({}) },
  FadeOut: { duration: () => ({}) },
  LinearTransition: { duration: () => ({}) },
}));
vi.mock("react-native-svg", () => ({ default: "Svg", Path: "Path" }));
vi.mock("@/components/charts/DonutChart", () => ({ DonutChart: "DonutChart" }));
vi.mock("./ReportActivityChart", () => ({
  ReportActivityChart: "ReportActivityChart",
}));
vi.mock("./ReportSheets", () => ({
  ReportDateSheet: "ReportDateSheet",
  ReportFiltersSheet: "ReportFiltersSheet",
}));
vi.mock("@/lib/motion", () => ({
  MOBILE_MOTION: { control: 140, layout: 220 },
  useResolvedReduceMotionPreference: () => ({
    reduceMotion: true,
    resolved: true,
  }),
}));
vi.mock(
  "@/lib/reportsPresentation",
  async () => import("../../lib/reportsPresentation"),
);
vi.mock("@/lib/reportsRanges", async () => import("../../lib/reportsRanges"));
vi.mock(
  "@/lib/reportsSelection",
  async () => import("../../lib/reportsSelection"),
);
vi.mock("@/lib/secure-session", () => ({
  subscribeAuthenticatedSession: (fn: () => void) => {
    mocks.subscriber = fn;
    return () => undefined;
  },
}));
vi.mock("@/lib/reportsClient", () => ({
  fetchReportSummary: mocks.fetch,
  ReportRangeCache: class {
    values = new Map();
    get(key: string) {
      return this.values.get(key);
    }
    put(key: string, value: unknown) {
      this.values.set(key, value);
    }
    clear() {
      this.values.clear();
    }
  },
}));
vi.mock(
  "@/lib/reportsTypography",
  async () => import("../../lib/reportsTypography"),
);
vi.mock("@/components/calendar/DatePickerCalendar", () => ({
  CalendarGlyph: "CalendarGlyph",
}));
import { ReportsTab } from "./ReportsTab";
const data = {
  activeEntry: null,
  categories: [{ id: "a", name: "Work", color: "blue" }],
  user: { id: "u" },
  workspace: { id: "w" },
  entries: [],
} as unknown as MobileBootstrap;
const nowMs = +new Date(2026, 8, 9, 12);
function result(input: ReportSummaryRequest): ReportSummary {
  return {
    capturedNow: new Date(nowMs).toISOString(),
    range: input,
    totalSeconds: 3600,
    categories: [
      { key: "a", categoryId: "a", name: "Work", color: "blue", seconds: 3600 },
    ],
    buckets: input.buckets.map((b, i) => ({
      key: b.key,
      seconds: i === 0 ? 3600 : 0,
      byCategory: i === 0 ? [{ key: "a", seconds: 3600 }] : [],
    })),
    active: null,
  };
}
const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <ReportsTab
        data={data}
        isFocused
        nowMs={nowMs}
        styles={{} as never}
        theme={{ mode: "dark" } as never}
      />,
    );
  });
  return tree;
};
async function chooseRange(tree: ReturnType<typeof create>, choice: string) {
  await act(async () =>
    tree.root
      .findAllByType("Pressable" as never)
      .find((n) =>
        n.props.accessibilityLabel?.startsWith("Choose report dates"),
      )!
      .props.onPress(),
  );
  const sheet = tree.root.findByType("ReportDateSheet" as never);
  await act(async () => sheet.props.onApply(choice));
  expect(tree.root.findAllByType("ReportDateSheet" as never)).toHaveLength(1);
  await act(async () => sheet.props.onDismissed(sheet.props.presentationId));
}
describe("Revision 3 Reports owner", () => {
  it("preserves seconds after Stop while replacing a cached active contribution", async () => {
    const startedAt = new Date(nowMs - 3600000).toISOString();
    mocks.fetch.mockImplementationOnce(async (input: ReportSummaryRequest) => ({
      ...result(input),
      active: {
        id: "timer",
        categoryId: "a",
        startedAt,
        buckets: [{ key: input.buckets[0].key, seconds: 3600 }],
      },
    }));
    const tree = await render();
    mocks.fetch.mockImplementation(() => new Promise(() => undefined));
    const stoppedNow = nowMs + 45000;
    const stopped = {
      id: "timer",
      categoryId: "a",
      startedAt,
      stoppedAt: new Date(stoppedNow).toISOString(),
      reviewStatus: "confirmed",
    };
    await act(async () =>
      tree.update(
        <ReportsTab
          data={{ ...data, entries: [stopped] } as MobileBootstrap}
          isFocused
          nowMs={stoppedNow}
          styles={{} as never}
          theme={{ mode: "dark" } as never}
        />,
      ),
    );
    const buckets = tree.root.findByType("ReportActivityChart" as never).props
      .buckets;
    expect(
      buckets.reduce(
        (sum: number, b: { seconds: number }) => sum + b.seconds,
        0,
      ),
    ).toBe(3645);
    act(() => tree.unmount());
  });
  it("coalesces same-range refreshes without starving a slow response", async () => {
    let finish!: (value: ReportSummary) => void;
    let requested!: ReportSummaryRequest;
    mocks.fetch.mockImplementationOnce((input: ReportSummaryRequest) => {
      requested = input;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const tree = await render();
    const signal = mocks.fetch.mock.calls[0][2] as AbortSignal;
    await act(async () =>
      tree.update(
        <ReportsTab
          data={{ ...data }}
          isFocused
          nowMs={nowMs}
          styles={{} as never}
          theme={{ mode: "dark" } as never}
        />,
      ),
    );
    expect(signal.aborted).toBe(false);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await act(async () => finish(result(requested)));
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(tree.root.findByType("DonutChart" as never).props.centerValue).toBe(
      "01:00:00",
    );
    act(() => tree.unmount());
  });
  beforeEach(() => {
    mocks.fetch
      .mockReset()
      .mockImplementation(async (input: ReportSummaryRequest) => result(input));
    mocks.fontScale = 1;
  });
  it("renders selected-only slices and preserves all/some/none recovery", async () => {
    const tree = await render();
    expect(JSON.stringify(tree.toJSON())).not.toMatch(
      /Time covered|Total logged|Daily bars|Category chart type/,
    );
    const chart = () => tree.root.findByType("DonutChart" as never);
    expect(chart().props.centerLabel).toBe("Total");
    expect(chart().props.centerValue).toBe("01:00:00");
    expect(chart().props.onSegmentPress).toBeUndefined();
    const row = tree.root
      .findAllByProps({ accessibilityRole: "text" })
      .find((node) => node.props.accessibilityLabel.startsWith("Work,"))!;
    expect(row.props.onPress).toBeUndefined();
    expect(row.props.accessibilityHint).toBeUndefined();
    expect(row.props.style[0]).toMatchObject({
      minHeight: 38,
      paddingVertical: 5,
    });
    expect(
      tree.root
        .findAllByType("View" as never)
        .some((node) => node.props.style?.gap === 0),
    ).toBe(true);
    await act(async () =>
      tree.root
        .findByProps({
          accessibilityLabel: "Filter categories, all categories selected",
        })
        .props.onPress(),
    );
    await act(async () =>
      tree.root
        .findByType("ReportFiltersSheet" as never)
        .props.onChange({
          mode: "include",
          keys: ["uncategorized"],
          universe: ["a", "uncategorized"],
        }),
    );
    let sheet = tree.root.findByType("ReportFiltersSheet" as never);
    await act(async () => sheet.props.onApply());
    expect(tree.root.findAllByType("ReportFiltersSheet" as never)).toHaveLength(
      1,
    );
    await act(async () => sheet.props.onDismissed(sheet.props.presentationId));
    expect(chart().props.centerValue).toBe("00:00:00");
    expect(chart().props.segments).toHaveLength(0);
    expect(JSON.stringify(tree.toJSON())).toContain(
      "No logged time for the selected categories.",
    );
    await act(async () =>
      tree.root
        .findByProps({
          accessibilityLabel: "Filter categories, 1 categories selected",
        })
        .props.onPress(),
    );
    await act(async () =>
      tree.root
        .findByType("ReportFiltersSheet" as never)
        .props.onChange({ mode: "none", universe: ["a", "uncategorized"] }),
    );
    sheet = tree.root.findByType("ReportFiltersSheet" as never);
    await act(async () => sheet.props.onApply());
    await act(async () => sheet.props.onDismissed(sheet.props.presentationId));
    expect(JSON.stringify(tree.toJSON())).toContain("No categories selected");
    expect(
      tree.root
        .findByType("ReportActivityChart" as never)
        .props.buckets.every((b: { seconds: number }) => b.seconds === 0),
    ).toBe(true);
    act(() => tree.unmount());
  });
  it("ignores late Year after Month and never reuses numbers for uncached failed range", async () => {
    const tree = await render();
    let resolveYear!: (value: ReportSummary) => void;
    let year!: ReportSummaryRequest;
    mocks.fetch.mockImplementation((input: ReportSummaryRequest) => {
      if (input.buckets.length === 12) {
        year = input;
        return new Promise((resolve) => {
          resolveYear = resolve;
        });
      }
      return Promise.resolve(result(input));
    });
    await chooseRange(tree, "year");
    expect(tree.root.findAllByType("DonutChart" as never)).toHaveLength(0);
    await chooseRange(tree, "month");
    await act(async () =>
      resolveYear({ ...result(year), totalSeconds: 999999 }),
    );
    expect(
      tree.root.findByType("ReportActivityChart" as never).props.buckets,
    ).toHaveLength(30);
    mocks.fetch.mockRejectedValue(new Error("offline"));
    await chooseRange(tree, "week");
    expect(tree.root.findAllByType("DonutChart" as never)).toHaveLength(0);
    expect(JSON.stringify(tree.toJSON())).toContain(
      "Connect to load this report range",
    );
    act(() => tree.unmount());
  });
  it("clears account results and rejects late responses after session change", async () => {
    const tree = await render();
    await act(async () => mocks.subscriber?.());
    expect(tree.root.findAllByType("DonutChart" as never)).toHaveLength(0);
    act(() => tree.unmount());
  });
  it("ignores a stale sheet completion and releases only the current presentation", async () => {
    const tree = await render();
    await act(async () =>
      tree.root
        .findByProps({
          accessibilityLabel: "Filter categories, all categories selected",
        })
        .props.onPress(),
    );
    const sheet = tree.root.findByType("ReportFiltersSheet" as never);
    expect(sheet.props.presentationId).toBeGreaterThan(0);
    await act(async () => sheet.props.onDismissed(sheet.props.presentationId - 1));
    expect(tree.root.findAllByType("ReportFiltersSheet" as never)).toHaveLength(1);
    await act(async () => sheet.props.onDismissed(sheet.props.presentationId));
    expect(tree.root.findAllByType("ReportFiltersSheet" as never)).toHaveLength(0);
    act(() => tree.unmount());
  });
  it("feeds the same exact-duration order to the donut and summary list", async () => {
    mocks.fetch.mockImplementationOnce(async (input: ReportSummaryRequest) => ({
      ...result(input),
      totalSeconds: 10_800,
      categories: [
        { key: "a", categoryId: "a", name: "Work", color: "blue", seconds: 3600 },
        { key: "b", categoryId: "b", name: "Rest", color: "red", seconds: 7200 },
      ],
      buckets: input.buckets.map((bucket, index) => ({
        key: bucket.key,
        seconds: index === 0 ? 10_800 : 0,
        byCategory:
          index === 0
            ? [
                { key: "a", seconds: 3600 },
                { key: "b", seconds: 7200 },
              ]
            : [],
      })),
    }));
    const tree = await render();
    expect(
      tree.root
        .findByType("DonutChart" as never)
        .props.segments.map((segment: { id: string }) => segment.id),
    ).toEqual(["b", "a"]);
    expect(
      tree.root
        .findAllByProps({ accessibilityRole: "text" })
        .map((node) => node.props.accessibilityLabel.split(",")[0]),
    ).toEqual(["Rest", "Work"]);
    act(() => tree.unmount());
  });
});
