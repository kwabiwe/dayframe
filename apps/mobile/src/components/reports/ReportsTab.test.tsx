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
describe("Revision 2 Reports owner", () => {
  it("coalesces same-range refreshes without starving a slow response", async () => {
    let finish!: (value: ReportSummary) => void;
    let requested!: ReportSummaryRequest;
    mocks.fetch.mockImplementationOnce((input: ReportSummaryRequest) => {
      requested = input;
      return new Promise((resolve) => { finish = resolve; });
    });
    const tree = await render();
    const signal = mocks.fetch.mock.calls[0][2] as AbortSignal;
    await act(async () => tree.update(<ReportsTab data={{ ...data }} isFocused nowMs={nowMs} styles={{} as never} theme={{ mode: "dark" } as never} />));
    expect(signal.aborted).toBe(false);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await act(async () => finish(result(requested)));
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(tree.root.findByType("DonutChart" as never).props.centerValue).toBe("1h");
    act(() => tree.unmount());
  });
  beforeEach(() => {
    mocks.fetch
      .mockReset()
      .mockImplementation(async (input: ReportSummaryRequest) => result(input));
    mocks.fontScale = 1;
  });
  it("renders only new design and all/some/none keeps context slices", async () => {
    const tree = await render();
    expect(JSON.stringify(tree.toJSON())).not.toMatch(
      /Time covered|Total logged|Daily bars|Category chart type/,
    );
    const chart = () => tree.root.findByType("DonutChart" as never);
    expect(chart().props.centerLabel).toBe("Total");
    expect(chart().props.centerValue).toBe("1h");
    await act(async () => chart().props.onSegmentPress("a"));
    expect(chart().props.centerValue).toBe("0m");
    expect(chart().props.segments[0]).toMatchObject({
      selected: false,
      value: 3600000,
    });
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
    await act(async () =>
      tree.root.findByType("ReportFiltersSheet" as never).props.onApply(),
    );
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
    await act(async () =>
      tree.root
        .findByProps({ accessibilityLabel: "Show year reports" })
        .props.onPress(),
    );
    expect(tree.root.findAllByType("DonutChart" as never)).toHaveLength(0);
    await act(async () =>
      tree.root
        .findByProps({ accessibilityLabel: "Show month reports" })
        .props.onPress(),
    );
    await act(async () =>
      resolveYear({ ...result(year), totalSeconds: 999999 }),
    );
    expect(
      tree.root.findByType("ReportActivityChart" as never).props.buckets,
    ).toHaveLength(30);
    mocks.fetch.mockRejectedValue(new Error("offline"));
    await act(async () =>
      tree.root
        .findByProps({ accessibilityLabel: "Show week reports" })
        .props.onPress(),
    );
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
});
