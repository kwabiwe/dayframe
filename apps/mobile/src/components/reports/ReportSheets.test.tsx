import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { ReportFilterDraft } from "../../lib/reportsSelection";
vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({
  Modal: "Modal",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  StyleSheet: { create: (s: unknown) => s, absoluteFill: {}, hairlineWidth: 1 },
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));
vi.mock("@/lib/reportsRanges", async () => import("../../lib/reportsRanges"));
vi.mock(
  "@/lib/reportsSelection",
  async () => import("../../lib/reportsSelection"),
);
vi.mock(
  "@/lib/reportDateDraft",
  async () => import("../../lib/reportDateDraft"),
);
vi.mock(
  "@/lib/reportsTypography",
  async () => import("../../lib/reportsTypography"),
);
vi.mock(
  "@/lib/datePickerCalendar",
  async () => import("../../lib/datePickerCalendar"),
);
vi.mock("@/lib/motion", () => ({ MOBILE_MOTION: { control: 140 } }));
vi.mock(
  "@/components/calendar/DatePickerCalendar",
  async () => import("../calendar/DatePickerCalendar"),
);
vi.mock("react-native-svg", () => ({ default: "Svg", Path: "Path" }));
vi.mock("react-native-reanimated", () => ({
  default: { View: "AnimatedView" },
  FadeIn: { duration: () => ({}) },
  FadeOut: { duration: () => ({}) },
  useSharedValue: (value: number) => ({ value }),
  useAnimatedStyle: (factory: () => unknown) => factory(),
  withTiming: (value: number) => value,
}));
import { ReportDateSheet, ReportFiltersSheet } from "./ReportSheets";
import { DatePickerCalendar } from "../calendar/DatePickerCalendar";
const theme = {} as never;
const options = ["Work", "Rest"].map((name) => ({
  key: name,
  name,
  color: "blue",
  isUnavailable: false,
  isUncategorized: false,
}));
function mount(element: React.ReactElement) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(element);
  });
  const button = (label: string) =>
    tree.root
      .findAllByType("Pressable" as never)
      .find(
        (node) =>
          node.props.accessibilityLabel === label ||
          node.props.accessibilityLabel?.startsWith(`${label},`),
      )!;
  const press = (label: string) =>
    act(() => {
      const node = button(label);
      if (!node.props.disabled) node.props.onPress();
    });
  return { tree, button, press };
}
describe("Reports sheet interactions", () => {
  it("makes outgoing months inert immediately and rejects stale taps, including an A–B–A replacement", () => {
    const onSelect = vi.fn();
    const renderMonth = (month: string) => (
      <DatePickerCalendar
        month={month}
        onMonthChange={vi.fn()}
        start={null}
        end={null}
        today="2026-09-10"
        onSelect={onSelect}
        theme={theme}
        reduceMotion={false}
      />
    );
    const { tree } = mount(renderMonth("2026-09-01"));
    const staleTap = tree.root.findByProps({
      testID: "calendar-day-2026-09-06",
    }).props.onPress;
    act(() => tree.update(renderMonth("2026-08-01")));
    const outgoing = tree.root.findByProps({ testID: "calendar-outgoing" });
    expect(outgoing.props.pointerEvents).toBe("none");
    expect(outgoing.props.accessibilityElementsHidden).toBe(true);
    expect(
      outgoing
        .findAllByType("Pressable" as never)
        .every(
          (node) => node.props.disabled && node.props.onPress === undefined,
        ),
    ).toBe(true);
    act(() => staleTap());
    act(() => tree.update(renderMonth("2026-09-01")));
    act(() => staleTap());
    expect(onSelect).not.toHaveBeenCalled();
    act(() =>
      tree.root
        .findByProps({ testID: "calendar-day-2026-09-06" })
        .props.onPress(),
    );
    expect(onSelect).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });
  it("renders September as six explicit Monday–Sunday rows with matching tap dates", () => {
    const onSelect = vi.fn();
    const { tree } = mount(
      <DatePickerCalendar
        month="2026-09-01"
        onMonthChange={vi.fn()}
        start="2026-09-07"
        end="2026-09-13"
        today="2026-09-10"
        maxDate="2026-09-10"
        onSelect={onSelect}
        theme={theme}
        reduceMotion
      />,
    );
    const rows = tree.root.findAll((n) =>
      /^calendar-week-2026-09-01-\d$/.test(n.props.testID ?? ""),
    );
    expect(rows).toHaveLength(6);
    expect(
      rows.map((row) =>
        row
          .findAllByType("Pressable" as never)
          .map((cell) => cell.props.testID),
      ),
    ).toEqual(
      [
        [
          "2026-08-31",
          "2026-09-01",
          "2026-09-02",
          "2026-09-03",
          "2026-09-04",
          "2026-09-05",
          "2026-09-06",
        ],
        [
          "2026-09-07",
          "2026-09-08",
          "2026-09-09",
          "2026-09-10",
          "2026-09-11",
          "2026-09-12",
          "2026-09-13",
        ],
        [
          "2026-09-14",
          "2026-09-15",
          "2026-09-16",
          "2026-09-17",
          "2026-09-18",
          "2026-09-19",
          "2026-09-20",
        ],
        [
          "2026-09-21",
          "2026-09-22",
          "2026-09-23",
          "2026-09-24",
          "2026-09-25",
          "2026-09-26",
          "2026-09-27",
        ],
        [
          "2026-09-28",
          "2026-09-29",
          "2026-09-30",
          "2026-10-01",
          "2026-10-02",
          "2026-10-03",
          "2026-10-04",
        ],
        [
          "2026-10-05",
          "2026-10-06",
          "2026-10-07",
          "2026-10-08",
          "2026-10-09",
          "2026-10-10",
          "2026-10-11",
        ],
      ].map((row) => row.map((date) => `calendar-day-${date}`)),
    );
    for (const date of ["2026-09-06", "2026-09-10"])
      act(() =>
        tree.root
          .findByProps({ testID: `calendar-day-${date}` })
          .props.onPress(),
      );
    expect(onSelect.mock.calls.map(([date]) => date.getDate())).toEqual([
      6, 10,
    ]);
    act(() => tree.unmount());
  });
  it.each(["all", "include", "none"] as const)(
    "exposes %s tri-state, search, toggles and zero-result Apply",
    (mode) => {
      const onChange = vi.fn(),
        onApply = vi.fn(),
        onCancel = vi.fn();
      const draft: ReportFilterDraft =
        mode === "include"
          ? { mode, keys: ["Work"], universe: ["Work", "Rest"] }
          : { mode, universe: ["Work", "Rest"] };
      const { tree, button, press } = mount(
        <ReportFiltersSheet
          {...{ draft, options, theme, onChange, onApply, onCancel }}
          reduceMotion
        />,
      );
      expect(button("All categories").props.accessibilityState.checked).toBe(
        mode === "all" ? true : mode === "none" ? false : "mixed",
      );
      expect(button("Apply").props.disabled).toBe(false);
      press("Apply");
      expect(onApply).toHaveBeenCalledOnce();
      press("All categories");
      expect(onChange.mock.calls[0][0].mode).toBe(
        mode === "all" ? "none" : "all",
      );
      press("Work");
      expect(onChange).toHaveBeenCalledTimes(2);
      act(() =>
        tree.root.findByType("TextInput" as never).props.onChangeText("rest"),
      );
      expect(button("Work")).toBeUndefined();
      expect(button("Rest")).toBeDefined();
      expect(button("All categories")).toBeDefined();
      press("Cancel Categories");
      press("Close Categories");
      act(() => tree.root.findByType("Modal" as never).props.onRequestClose());
      expect(onCancel).toHaveBeenCalledTimes(3);
      expect(onApply).toHaveBeenCalledOnce();
      expect(tree.root.findByType("Modal" as never).props.animationType).toBe(
        "none",
      );
      act(() => tree.unmount());
    },
  );
  it.each([1, 9])(
    "requires two taps and normalizes reverse/same-day ending %s",
    (endDay) => {
      const onApply = vi.fn(),
        onCancel = vi.fn();
      const { tree, button, press } = mount(
        <ReportDateSheet
          initial="today"
          nowMs={+new Date(2026, 8, 9, 12)}
          {...{ theme, onApply, onCancel }}
          reduceMotion={false}
        />,
      );
      const day = (n: number) =>
        new Date(2026, 8, n).toLocaleDateString(undefined, {
          dateStyle: "full",
        });
      const body = tree.root
        .findAllByType("ScrollView" as never)
        .find((n) => !n.props.horizontal)!;
      // At 320pt: 288pt sheet content + 20pt viewport expansion = 308 / 7 = 44.
      expect(body.props.style.marginHorizontal).toBe(-10);
      expect(body.props.contentContainerStyle.paddingHorizontal).toBe(10);
      expect(button("Done").props.disabled).toBe(false);
      expect(button("Next month").props.disabled).toBe(true);
      expect(button(day(10)).props.disabled).toBe(true);
      expect(button(day(9)).props.style).toMatchObject({
        height: 44,
        flexBasis: 0,
        flexGrow: 1,
        flexShrink: 1,
      });
      press(day(9));
      expect(button("Done").props.disabled).toBe(true);
      press(day(endDay));
      expect(button("Done").props.disabled).toBe(false);
      press("Done");
      expect(onApply).toHaveBeenCalledWith({
        start: `2026-09-0${endDay}`,
        end: "2026-09-09",
      });
      press("Previous month");
      expect(button("Next month").props.disabled).toBe(false);
      press("Next month");
      expect(button("Next month").props.disabled).toBe(true);
      press("Cancel Choose report dates");
      expect(onCancel).toHaveBeenCalledOnce();
      expect(tree.root.findByType("Modal" as never).props.animationType).toBe(
        "fade",
      );
      act(() => tree.unmount());
    },
  );
  it("rejects an over-366-day range selected across calendar navigation", () => {
    const onApply = vi.fn();
    const { tree, button, press } = mount(
      <ReportDateSheet
        initial="today"
        nowMs={+new Date(2026, 8, 9, 12)}
        theme={theme}
        onApply={onApply}
        onCancel={vi.fn()}
        reduceMotion
      />,
    );
    const dateLabel = (date: Date) =>
      date.toLocaleDateString(undefined, { dateStyle: "full" });
    press(dateLabel(new Date(2026, 8, 9)));
    for (let i = 0; i < 12; i++) press("Previous month");
    press(dateLabel(new Date(2025, 8, 1)));
    expect(button("Done").props.disabled).toBe(true);
    expect(
      tree.root
        .findAllByType("Text" as never)
        .find((n) => n.props.accessibilityRole === "alert")?.props.children,
    ).toContain("366");
    press("Done");
    expect(onApply).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
