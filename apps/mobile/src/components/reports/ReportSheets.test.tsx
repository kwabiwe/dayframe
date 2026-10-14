import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportFilterDraft } from "../../lib/reportsSelection";
const mockLayout = vi.hoisted(() => ({
  safeAreaBottom: 0,
  windowHeight: 844,
}));
vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({
  Dimensions: {
    get: () => ({ width: 320, height: mockLayout.windowHeight }),
  },
  Keyboard: {
    addListener: () => ({ remove: vi.fn() }),
    dismiss: vi.fn(),
  },
  Modal: "Modal",
  Platform: { OS: "ios" },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  useWindowDimensions: () => ({
    width: 320,
    height: mockLayout.windowHeight,
  }),
  StyleSheet: { create: (s: unknown) => s, absoluteFill: {}, hairlineWidth: 1 },
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: mockLayout.safeAreaBottom }),
}));
vi.mock("react-native-screens", () => ({
  FullWindowOverlay: "FullWindowOverlay",
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
  "@/lib/datePickerGeometry",
  async () => import("../../lib/datePickerGeometry"),
);
vi.mock(
  "@/lib/editSheetKeyboard",
  async () => import("../../lib/editSheetKeyboard"),
);
vi.mock(
  "@/lib/datePickerCalendar",
  async () => import("../../lib/datePickerCalendar"),
);
vi.mock("@/lib/motion", () => ({ MOBILE_MOTION: { control: 140 } }));
vi.mock("@/components/DateSheet", async () => import("../DateSheet"));
vi.mock(
  "@/components/sheets/BottomSheetShell",
  async () => import("../sheets/BottomSheetShell"),
);
vi.mock(
  "@/lib/mobileTypography",
  async () => import("../../lib/mobileTypography"),
);
vi.mock("@/components/SwipeDismissSheet", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  const React = await import("../../../../../node_modules/react/index.js");
  const SwipeDismissSheet = React.forwardRef(
    (props: Record<string, any>, ref: React.ForwardedRef<unknown>) => {
      const dismiss = () => {
        if (props.disabled) return;
        if (props.onDismissStart?.(props.presentationId) === false) return;
        props.onDismiss(props.presentationId);
      };
      React.useImperativeHandle(ref, () => ({ dismiss }));
      return React.createElement(
        "SwipeDismissSheet",
        props,
        React.createElement("Pressable", {
          accessibilityLabel: props.backdropAccessibilityLabel,
          disabled: props.disabled,
          onPress: dismiss,
        }),
        props.handleAccessory,
        props.children,
      );
    },
  );
  return { SwipeDismissSheet };
});
vi.mock(
  "@/components/calendar/DatePickerCalendar",
  async () => import("../calendar/DatePickerCalendar"),
);
vi.mock("react-native-svg", () => ({ default: "Svg", Path: "Path" }));
vi.mock("../icons/DayframeIcon", () => ({ ActivityIcon: "ActivityIcon" }));
const haptic = vi.hoisted(() => vi.fn());
vi.mock("../../lib/haptics", () => ({ playHaptic: haptic }));
vi.mock("react-native-reanimated", () => ({
  default: { View: "AnimatedView" },
  FadeIn: { duration: () => ({}) },
  FadeOut: { duration: () => ({}) },
  useSharedValue: (value: number) => ({ value }),
  useAnimatedStyle: (factory: () => unknown) => factory(),
  withTiming: (value: number) => value,
}));
import { ReportDateSheet, ReportFiltersSheet } from "./ReportSheets";
import {
  BOTTOM_SHEET_NATIVE_TAB_OFFSET as REPORT_SHEET_NATIVE_TAB_OFFSET,
  bottomSheetGeometry as reportSheetBottomGeometry,
} from "../sheets/BottomSheetShell";
import { DatePickerCalendar } from "../calendar/DatePickerCalendar";
import { DAYFRAME_THEME } from "@dayframe/shared";
const theme = { borderStrong: "strong-handle" } as never;
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
  beforeEach(() => {
    mockLayout.safeAreaBottom = 0;
    mockLayout.windowHeight = 844;
  });
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
    "exposes the %s draft: All/None links, search, toggles, grouped rows and the Show N Apply",
    (mode) => {
      const onChange = vi.fn(),
        onApply = vi.fn(),
        onDismissed = vi.fn();
      const draft: ReportFilterDraft =
        mode === "include"
          ? { mode, keys: ["Work"], universe: ["Work", "Rest"] }
          : { mode, universe: ["Work", "Rest"] };
      const { tree, button, press } = mount(
        <ReportFiltersSheet
          {...{ draft, options, theme, onChange, onApply }}
          presentationId={1}
          onDismissed={onDismissed}
          reduceMotion
        />,
      );
      const apply =
        mode === "all" ? "Show all activities" : mode === "none" ? "Show none" : "Show 1 activity";
      expect(button("Work").props.accessibilityState.checked).toBe(mode !== "none");
      expect(button("Rest").props.accessibilityState.checked).toBe(mode === "all");
      expect(button(apply).props.disabled).toBe(false);
      press(apply);
      press(apply);
      expect(onApply).toHaveBeenCalledOnce();
      press("Select all activities");
      expect(onChange.mock.calls[0][0]).toEqual({ mode: "all", universe: ["Work", "Rest"] });
      press("Select no activities");
      expect(onChange.mock.calls[1][0]).toEqual({ mode: "none", universe: ["Work", "Rest"] });
      press("Work");
      expect(onChange).toHaveBeenCalledTimes(3);
      expect(haptic).toHaveBeenCalled();
      act(() =>
        tree.root.findByType("TextInput" as never).props.onChangeText("rest"),
      );
      expect(button("Work")).toBeUndefined();
      expect(button("Rest")).toBeDefined();
      expect(button("Select all activities")).toBeDefined();
      expect(button("Cancel Activities")).toBeUndefined();
      const scroll = tree.root.findByProps({
        testID: "report-filter-sheet-scroll",
      });
      expect(scroll.props.showsVerticalScrollIndicator).toBe(false);
      expect(scroll.findAllByType("TextInput" as never)).toHaveLength(0);
      expect(
        scroll.findAllByProps({ testID: "report-filter-sheet-action" }),
      ).toHaveLength(0);
      expect(
        scroll.findAllByProps({ accessibilityLabel: "Rest" }),
      ).toHaveLength(1);
      expect(tree.root.findAllByType("TextInput" as never)).toHaveLength(1);
      expect(tree.root.findByProps({ testID: "report-filter-search" })).toBe(
        tree.root.findByType("TextInput" as never),
      );
      expect(
        tree.root.findByProps({ testID: "report-filter-sheet-action" }),
      ).toBe(button(apply));
      expect(button(apply).props.style[1]).toMatchObject({
        alignSelf: "stretch",
        width: "100%",
      });
      press("Close Filter activities");
      expect(onDismissed).toHaveBeenCalledWith(1);
      expect(onApply).toHaveBeenCalledOnce();
      expect(tree.root.findByType("Modal" as never).props.animationType).toBe(
        "none",
      );
      expect(JSON.stringify(tree.toJSON())).not.toContain("Clear");
      act(() => tree.unmount());
    },
  );
  it("has no visible Cancel and routes backdrop dismissal through one coordinated release", () => {
    const onApply = vi.fn();
    const onDismissed = vi.fn();
    const { tree, press } = mount(
      <ReportFiltersSheet
        presentationId={7}
        draft={{ mode: "all", universe: ["Work", "Rest"] }}
        options={options}
        theme={theme}
        reduceMotion
        onChange={vi.fn()}
        onApply={onApply}
        onDismissed={onDismissed}
      />,
    );
    const sheet = tree.root.findByType("SwipeDismissSheet" as never);
    expect(sheet.props.handleAccessory).toBeUndefined();
    expect(sheet.props.handleStyle[1].backgroundColor).toBe("strong-handle");
    expect(
      tree.root
        .findAllByType("Text" as never)
        .some((node) => node.props.children === "Activities"),
    ).toBe(false);
    press("Close Filter activities");
    press("Close Filter activities");
    expect(onApply).not.toHaveBeenCalled();
    expect(onDismissed).toHaveBeenCalledOnce();
    expect(onDismissed).toHaveBeenCalledWith(7);
    act(() => tree.unmount());
  });
  it("applies the root native-tab and safe-area compensation exactly once", () => {
    mockLayout.safeAreaBottom = 34;
    const { tree } = mount(
      <ReportFiltersSheet
        rootHosted
        presentationId={9}
        draft={{ mode: "all", universe: ["Work", "Rest"] }}
        options={options}
        theme={theme}
        reduceMotion
        onChange={vi.fn()}
        onApply={vi.fn()}
        onDismissed={vi.fn()}
      />,
    );
    expect(tree.root.findAllByType("Modal" as never)).toHaveLength(0);
    expect(
      tree.root.findByType("FullWindowOverlay" as never).props
        .unstable_accessibilityContainerViewIsModal,
    ).toBe(true);
    const sheet = tree.root.findByType("SwipeDismissSheet" as never);
    const rootOffset = REPORT_SHEET_NATIVE_TAB_OFFSET + 34;
    expect(sheet.props.style[1]).toMatchObject({ maxHeight: "100%" });
    expect(sheet.props.translateYOffset).toBe(rootOffset);
    expect(sheet.props.backdropStyle[1].bottom).toBe(-rootOffset);
    const surfaceStyle = sheet.props.style.at(-1);
    expect(surfaceStyle.paddingBottom).toBe(34 + rootOffset);
    expect(surfaceStyle.paddingBottom - sheet.props.translateYOffset).toBe(34);
    act(() => tree.unmount());
  });
  it("omits root compensation for modal-hosted sheets", () => {
    expect(
      reportSheetBottomGeometry({
        rootHosted: false,
        safeAreaBottom: 34,
        keyboardInset: 0,
      }),
    ).toEqual({
      backdropBottom: 0,
      contentPaddingBottom: 34,
      nativeTabsBottomOffset: 0,
      surfaceTranslateY: 0,
    });
  });
  it("lets an earlier swipe discard win over a later Apply", () => {
    const onApply = vi.fn();
    const onDismissed = vi.fn();
    const { tree, press } = mount(
      <ReportFiltersSheet
        presentationId={8}
        draft={{ mode: "all", universe: ["Work", "Rest"] }}
        options={options}
        theme={theme}
        reduceMotion
        onChange={vi.fn()}
        onApply={onApply}
        onDismissed={onDismissed}
      />,
    );
    const sheet = tree.root.findByType("SwipeDismissSheet" as never);
    act(() => expect(sheet.props.onDismissStart(8)).toBe(true));
    press("Show all activities");
    expect(onApply).not.toHaveBeenCalled();
    act(() => sheet.props.onDismiss(7));
    expect(onDismissed).not.toHaveBeenCalled();
    act(() => sheet.props.onDismiss(8));
    expect(onDismissed).toHaveBeenCalledOnce();
    act(() => tree.unmount());
  });
  it("keeps an earlier Apply committed when a stale swipe callback arrives", () => {
    const onApply = vi.fn(() => true);
    const onDismissed = vi.fn();
    const { tree, press } = mount(
      <ReportFiltersSheet
        presentationId={11}
        draft={{ mode: "all", universe: ["Work", "Rest"] }}
        options={options}
        theme={theme}
        reduceMotion
        onChange={vi.fn()}
        onApply={onApply}
        onDismissed={onDismissed}
      />,
    );
    const sheet = tree.root.findByType("SwipeDismissSheet" as never);
    press("Show all activities");
    expect(onApply).toHaveBeenCalledOnce();
    expect(onDismissed).toHaveBeenCalledOnce();
    expect(onDismissed).toHaveBeenCalledWith(11);
    act(() => expect(sheet.props.onDismissStart(11)).toBe(true));
    press("Show all activities");
    expect(onApply).toHaveBeenCalledOnce();
    act(() => sheet.props.onDismiss(10));
    expect(onDismissed).toHaveBeenCalledOnce();
    act(() => tree.unmount());
  });
  it.each([1, 9])(
    "requires two taps and normalizes reverse/same-day ending %s",
    (endDay) => {
      const onApply = vi.fn(),
        onDismissed = vi.fn();
      const { tree, button, press } = mount(
        <ReportDateSheet
          initial="today"
          nowMs={+new Date(2026, 8, 9, 12)}
          {...{ theme, onApply }}
          presentationId={2}
          onDismissed={onDismissed}
          reduceMotion={false}
        />,
      );
      const day = (n: number) =>
        new Date(2026, 8, n).toLocaleDateString(undefined, {
          dateStyle: "full",
        });
      const sheet = tree.root.findByType("SwipeDismissSheet" as never);
      expect(sheet.props.gestureHandleOnly).toBe(true);
      expect(sheet.props.handleAccessory).toBeUndefined();
      expect(sheet.props.presentationId).toBe(2);
      expect(sheet.props.style[1].paddingHorizontal).toBe(6);
      expect(tree.root.findAllByType("ScrollView" as never)).toHaveLength(0);
      const dateBody = tree.root.findByProps({
        testID: "report-date-sheet-body",
      });
      expect(
        dateBody.findAll(
          (node) =>
            typeof node.props.testID === "string" &&
            /^calendar-week-2026-09-01-\d$/.test(node.props.testID),
        ),
      ).toHaveLength(6);
      expect(
        dateBody.findAllByProps({ testID: "report-date-sheet-action" }),
      ).toHaveLength(0);
      expect(
        tree.root.findByProps({ testID: "report-date-sheet-action" }),
      ).toBe(button("Done"));
      const calendar = tree.root
        .findAllByType("View" as never)
        .find((node) => node.props.style?.maxWidth === 349)!;
      expect(calendar.props.style).toMatchObject({
        width: "100%",
        maxWidth: 349,
      });
      const preset = button("Today");
      expect(preset.props.style).toMatchObject({
        flex: 1,
        minHeight: 44,
        minWidth: 0,
      });
      expect(preset.findByType("View" as never).props.style[0].height).toBe(34);
      expect(button("Done").props.disabled).toBe(false);
      // Full-width neutral Done (date-picker audit, 14 Oct 2026), not the old centred 160-point pill.
      expect(button("Done").props.style[0]).toMatchObject({ alignSelf: "stretch" });
      expect(button("Done").props.style[0].width).toBeUndefined();
      expect(button("Done").props.style[1]).toMatchObject({ marginTop: 16, marginHorizontal: 10 });
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
      press("Previous month");
      expect(button("Next month").props.disabled).toBe(false);
      press("Next month");
      expect(button("Next month").props.disabled).toBe(true);
      press("Done");
      expect(onApply).toHaveBeenCalledWith({
        start: `2026-09-0${endDay}`,
        end: "2026-09-09",
      });
      expect(onDismissed).toHaveBeenCalledWith(2);
      expect(tree.root.findByType("Modal" as never).props.animationType).toBe(
        "none",
      );
      act(() => tree.unmount());
    },
  );
  it("keeps all date controls visible in the compact non-scrolling layout", () => {
    mockLayout.windowHeight = 667;
    const { tree, button } = mount(
      <ReportDateSheet
        initial="today"
        nowMs={+new Date(2026, 8, 9, 12)}
        theme={theme}
        onApply={vi.fn()}
        presentationId={12}
        onDismissed={vi.fn()}
        reduceMotion
      />,
    );
    expect(tree.root.findAllByType("ScrollView" as never)).toHaveLength(0);
    for (const preset of ["Today", "Week", "Month", "Year"])
      expect(button(preset)).toBeDefined();
    expect(
      tree.root
        .findAllByType("Text" as never)
        .some((node) =>
          String(node.props.accessibilityLabel ?? "").includes("–"),
        ),
    ).toBe(true);
    expect(
      tree.root.findAll(
        (node) =>
          typeof node.props.testID === "string" &&
          /^calendar-week-2026-09-01-\d$/.test(node.props.testID),
      ),
    ).toHaveLength(6);
    expect(button("Done").props.style[2]).toMatchObject({ marginTop: 6 });
    act(() => tree.unmount());
  });
  it("rejects an over-366-day range selected across calendar navigation", () => {
    const onApply = vi.fn();
    const { tree, button, press } = mount(
      <ReportDateSheet
        initial="today"
        nowMs={+new Date(2026, 8, 9, 12)}
        theme={theme}
        onApply={onApply}
        presentationId={3}
        onDismissed={vi.fn()}
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

describe("Neutral selection in Reports sheets and the date picker (UIA-010/011/026)", () => {
  const dark = { ...DAYFRAME_THEME.dark, mode: "dark", pressed: "x" } as unknown as Record<string, string>;
  const styleOf = (node: { props: Record<string, unknown> }) =>
    Object.assign({}, ...([node.props.style].flat(3).filter(Boolean) as object[])) as Record<string, unknown>;

  it("fills the chosen day and range neutrally, keeps today as coral text and stops at maxDate", () => {
    const { tree } = mount(
      <DatePickerCalendar
        month="2026-09-01"
        onMonthChange={vi.fn()}
        start="2026-09-07"
        end="2026-09-09"
        today="2026-09-14"
        maxDate="2026-09-14"
        onSelect={vi.fn()}
        theme={dark as never}
        reduceMotion
      />,
    );
    const byId = (id: string) => tree.root.find((node) => node.props.testID === id);
    expect(styleOf(byId("calendar-circle-2026-09-07")).backgroundColor).toBe(dark.textPrimary);
    expect(styleOf(byId("calendar-band-2026-09-08")).backgroundColor).toBe(dark.surfaceMuted);
    const todayText = byId("calendar-circle-2026-09-14").findByType("Text" as never);
    expect(styleOf(todayText).color).toBe(dark.accentText);
    expect(styleOf(byId("calendar-circle-2026-09-14")).backgroundColor).toBe("transparent");
    expect(byId("calendar-day-2026-09-15").props.disabled).toBe(true);
    const json = JSON.stringify(tree.toJSON());
    expect(json).not.toContain(dark.accentSoft);
  });

  it("checks filter rows neutrally inside section cards", () => {
    const { tree } = mount(
      <ReportFiltersSheet
        presentationId={1}
        draft={{ mode: "all", universe: ["Work", "Rest"] } as ReportFilterDraft}
        options={options as never}
        theme={dark as never}
        reduceMotion
        onChange={vi.fn()}
        onApply={vi.fn()}
        onDismissed={vi.fn()}
      />,
    );
    const work = tree.root.findAll((node) => node.props.accessibilityRole === "checkbox" && node.props.accessibilityLabel === "Work")[0];
    const check = work.findAll((node) => (node.type as unknown) === "View").at(-1)!;
    expect(styleOf(check).backgroundColor).toBe(dark.textPrimary);
  });

  it("titles the date sheet and makes its presets and Done neutral", () => {
    const { tree, button } = mount(
      <ReportDateSheet
        presentationId={1}
        initial="week"
        nowMs={Date.parse("2026-09-16T12:00:00")}
        theme={dark as never}
        reduceMotion={false}
        onApply={vi.fn()}
        onDismissed={vi.fn()}
      />,
    );
    const texts = tree.root.findAllByType("Text" as never).map((node) => node.props.children);
    expect(texts).toContain("REPORTS");
    expect(texts).toContain("Choose dates");
    const week = button("Week").findByType("View" as never);
    expect(styleOf(week).backgroundColor).toBe(dark.textPrimary);
    expect(styleOf(button("Done")).backgroundColor).toBe(dark.textPrimary);
  });

  it("leaves the head out on the smallest phones so every date row and Done fit", () => {
    const previous = mockLayout.windowHeight;
    mockLayout.windowHeight = 568;
    try {
      const { tree } = mount(
        <ReportDateSheet
          presentationId={1}
          initial="week"
          nowMs={Date.parse("2026-09-16T12:00:00")}
          theme={dark as never}
          reduceMotion={false}
          onApply={vi.fn()}
          onDismissed={vi.fn()}
        />,
      );
      const texts = tree.root.findAllByType("Text" as never).map((node) => node.props.children);
      expect(texts).not.toContain("Choose dates");
    } finally {
      mockLayout.windowHeight = previous;
    }
  });
});

describe("Shared DateSheet (date-picker audit, 14 Oct 2026)", () => {
  const dark = { ...DAYFRAME_THEME.dark, mode: "dark", pressed: "x" } as unknown as Record<string, string>;
  const styleOf = (node: { props: Record<string, unknown> }) =>
    Object.assign({}, ...([node.props.style].flat(3).filter(Boolean) as object[])) as Record<string, unknown>;
  it("picks a single date as a draft with Today · Yesterday, and Done saves it once", async () => {
    const { DateSheet } = await import("../DateSheet");
    const onDone = vi.fn(() => true);
    const onDismissed = vi.fn();
    const onSelectDay = vi.fn();
    const segment = vi.fn();
    const { tree, button, press } = mount(
      <DateSheet
        presentationId={4}
        theme={dark as never}
        reduceMotion
        eyebrow="START"
        title="Choose a date"
        segments={[
          { key: "today", label: "Today", selected: false, onPress: segment },
          { key: "yesterday", label: "Yesterday", selected: true, onPress: segment },
        ]}
        caption="Tuesday 15 September 2026"
        month="2026-09-15"
        onMonthChange={vi.fn()}
        start="2026-09-15"
        end="2026-09-15"
        today="2026-09-16"
        maxDate="2026-09-16"
        onSelectDay={onSelectDay}
        onDone={onDone}
        onDismissed={onDismissed}
      />,
    );
    const texts = tree.root.findAllByType("Text" as never).map((node) => node.props.children);
    expect(texts).toEqual(expect.arrayContaining(["START", "Choose a date", "Tuesday 15 September 2026"]));
    expect(tree.root.findByProps({ testID: "date-sheet" })).toBeTruthy();
    // The selected segment and Done are neutral (textPrimary), never coral.
    expect(styleOf(button("Yesterday").findByType("View" as never)).backgroundColor).toBe(dark.textPrimary);
    expect(styleOf(button("Done")).backgroundColor).toBe(dark.textPrimary);
    expect(button("Done").props.style[0]).toMatchObject({ alignSelf: "stretch" });
    // A day past maxDate cannot be picked; a day before it only changes the draft.
    const day = (n: number) => new Date(2026, 8, n).toLocaleDateString(undefined, { dateStyle: "full" });
    expect(button(day(17)).props.disabled).toBe(true);
    press(day(14));
    expect(onSelectDay).toHaveBeenCalledOnce();
    expect(onDone).not.toHaveBeenCalled();
    press("Today");
    expect(segment).toHaveBeenCalledOnce();
    press("Done");
    press("Done");
    expect(onDone).toHaveBeenCalledOnce();
    expect(onDismissed).toHaveBeenCalledWith(4);
  });

  it("keeps the sheet when Done is refused and disables Done while the draft is invalid", async () => {
    const { DateSheet } = await import("../DateSheet");
    const onDone = vi.fn(() => false);
    const onDismissed = vi.fn();
    const props = {
      presentationId: 5,
      theme: dark as never,
      reduceMotion: true,
      eyebrow: "END",
      title: "Choose a date",
      caption: "Pick a day",
      month: "2026-09-15",
      onMonthChange: vi.fn(),
      start: null,
      end: null,
      today: "2026-09-16",
      onSelectDay: vi.fn(),
      onDone,
      onDismissed,
    };
    const disabled = mount(<DateSheet {...props} doneDisabled />);
    expect(disabled.button("Done").props.disabled).toBe(true);
    act(() => disabled.tree.unmount());
    const refused = mount(<DateSheet {...props} />);
    refused.press("Done");
    expect(onDone).toHaveBeenCalledOnce();
    expect(onDismissed).not.toHaveBeenCalled();
  });
});
