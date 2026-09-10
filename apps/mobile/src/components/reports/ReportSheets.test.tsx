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
}));
import { ReportDateSheet, ReportFiltersSheet } from "./ReportSheets";
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
      const body = tree.root.findAllByType("ScrollView" as never).find(n => !n.props.horizontal)!;
      // At 320pt: 288pt sheet content + 20pt viewport expansion = 308 / 7 = 44.
      expect(body.props.style.marginHorizontal).toBe(-10);
      expect(body.props.contentContainerStyle.paddingHorizontal).toBe(10);
      expect(button("Done").props.disabled).toBe(false);
      expect(button("Next month").props.disabled).toBe(true);
      expect(button(day(10)).props.disabled).toBe(true);
      expect(button(day(9)).props.style).toMatchObject({
        height: 44,
        width: `${100 / 7}%`,
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
