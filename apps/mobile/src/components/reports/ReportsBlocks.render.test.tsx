import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: "Text",
  View: "View",
}));
vi.mock("react-native-reanimated", () => ({
  default: { View: "AnimatedView" },
  ReduceMotion: { Never: "never" },
  useAnimatedStyle: (fn: () => unknown) => fn(),
  useSharedValue: (value: number) => ({ value }),
  withDelay: (_: number, value: unknown) => value,
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
}));
vi.mock("../icons/DayframeIcon", () => ({ DayframeIcon: "DayframeIcon" }));
vi.mock("../../lib/motion", () => ({ localPresenceEntering: () => "fade-in" }));
vi.mock("../../lib/mobileTypography", () => ({ MOBILE_DISPLAY_FONT: { extraBold: "X" }, mobileTextProps: () => ({}) }));

import {
  ReportGoalStreak,
  ReportHero,
  ReportMonthGrid,
  ReportRangeSwitch,
  ReportWeekColumns,
  type ReportDayStack,
} from "./ReportsBlocks";

const theme = {
  accent: "#FF6248",
  mode: "dark",
  success: "#20B978",
  surface: "#151B27",
  surfaceMuted: "#202838",
  textMuted: "#707B91",
  textPrimary: "#F7F8FB",
  textSecondary: "#8993A7",
} as never;

function day(date: number, seconds: number, segments: ReportDayStack["segments"] = []): ReportDayStack {
  const start = new Date(2026, 9, date);
  return { key: `2026-10-${String(date).padStart(2, "0")}`, start, seconds, segments };
}

describe("Blocks Reports pieces", () => {
  it("switches Week and Month and keeps the other ranges behind More", () => {
    const onChoose = vi.fn();
    const onMore = vi.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <ReportRangeSwitch
          choice="today"
          moreAccessibilityLabel="Choose report dates, Today"
          moreLabel="Today"
          onChoose={onChoose}
          onMore={onMore}
          reduceMotion
          theme={theme}
        />,
      );
    });
    const week = tree.root.findByProps({ testID: "reports-range-week" });
    const more = tree.root.findByProps({ testID: "reports-range-more" });
    expect(week.props.accessibilityState).toEqual({ selected: false });
    expect(more.props.accessibilityState).toEqual({ selected: true });
    expect(more.props.accessibilityLabel).toBe("Choose report dates, Today");
    expect(tree.root.findByProps({ testID: "reports-range-label" }).props.children).toBe("Today");
    // Every segment is a 44-point target.
    expect(week.props.style.minHeight).toBe(44);
    act(() => week.props.onPress());
    act(() => tree.root.findByProps({ testID: "reports-range-month" }).props.onPress());
    act(() => more.props.onPress());
    expect(onChoose.mock.calls).toEqual([["week"], ["month"]]);
    expect(onMore).toHaveBeenCalledOnce();
  });

  it("reads the hero total with its period and change, and a focused day without the change", () => {
    let tree!: ReturnType<typeof create>;
    const delta = { text: "+30m vs last week so far", spoken: "30 minutes more than last week so far" };
    act(() => {
      tree = create(<ReportHero delta={delta} focusLabel={null} period="this week" spokenTotal="1 hour" theme={theme} total="1h" />);
    });
    const hero = tree.root.findByProps({ testID: "reports-hero" });
    expect(hero.props.accessibilityLabel).toBe("1 hour framed this week. 30 minutes more than last week so far");
    expect(tree.root.findByProps({ testID: "reports-delta" }).props.children).toBe("+30m vs last week so far");
    act(() => {
      tree.update(<ReportHero delta={delta} focusLabel="Friday 9 October" period="this week" spokenTotal="2 hours" theme={theme} total="2h" />);
    });
    expect(tree.root.findByProps({ testID: "reports-hero" }).props.accessibilityLabel).toBe("2 hours on Friday 9 October");
    expect(tree.root.findAllByProps({ testID: "reports-delta" })).toHaveLength(0);
  });

  it("stacks each day's activities, dims the others when one is focused, and toggles focus", () => {
    const onFocus = vi.fn();
    const days = [
      day(5, 5400, [{ key: "a", seconds: 3600, color: "#3B82F6" }, { key: "b", seconds: 1800, color: "#EF4444" }]),
      ...[6, 7, 8, 9, 10, 11].map((date) => day(date, 0)),
    ];
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<ReportWeekColumns animate={false} days={days} focusedKey="2026-10-05" onFocus={onFocus} theme={theme} todayKey="2026-10-09" />);
    });
    const monday = tree.root.findByProps({ testID: "reports-week-day-2026-10-05" });
    expect(monday.props.accessibilityState).toEqual({ selected: true });
    expect(monday.props.accessibilityLabel).toContain("1 hour 30 minutes");
    const blocks = monday.findAll((node) => node.type === ("AnimatedView" as never));
    // 12 hours fill the 170-point column: 1 h = 14, 30 min = 7 (less the 3-point gap).
    expect(blocks.map((node) => node.props.style[1])).toEqual([
      { backgroundColor: "#3B82F6", height: 11 },
      { backgroundColor: "#EF4444", height: 4 },
    ]);
    const tuesday = tree.root.findByProps({ testID: "reports-week-day-2026-10-06" });
    expect(tuesday.props.accessibilityLabel).toContain("nothing framed");
    expect(tuesday.findAll((node) => node.props.style?.[1]?.opacity === 0.35)).toHaveLength(1);
    act(() => monday.props.onPress());
    act(() => tuesday.props.onPress());
    expect(onFocus.mock.calls).toEqual([[null], ["2026-10-06"]]);
  });

  it("lays the month out Monday first and rings today", () => {
    // October 2026 starts on a Thursday: three blanks.
    const days = Array.from({ length: 31 }, (_, index) => day(index + 1, index === 8 ? 3600 : 0, index === 8 ? [{ key: "a", seconds: 3600, color: "#3B82F6" }] : []));
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<ReportMonthGrid days={days} theme={theme} todayKey="2026-10-09" />);
    });
    const slots = tree.root.findAll((node) => node.type === ("View" as never) && node.props.style?.width === `${100 / 7}%`);
    expect(slots).toHaveLength(34);
    expect(slots.slice(0, 3).every((slot) => slot.children.length === 0)).toBe(true);
    expect(slots[3].children).toHaveLength(1);
    const today = tree.root.findAll((node) => node.props.accessible && node.props.accessibilityLabel?.includes("1 hour"));
    expect(today).toHaveLength(1);
    expect(today[0].props.style[2]).toEqual({ borderColor: "#FF6248", borderWidth: 1.5 });
  });

  it("counts days on goal", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<ReportGoalStreak days={[true, false, true]} goalLabel="6h" reduceMotion theme={theme} />);
    });
    const streak = tree.root.findByProps({ testID: "reports-goal-streak" });
    expect(streak.props.accessibilityLabel).toBe("2 of 3 days on goal. Within 15 percent of your 6h day.");
    const cells = tree.root.findAll((node) => node.props.style?.[0]?.width === 14);
    expect(cells.map((node) => node.props.style[1].backgroundColor)).toEqual(["#20B978", "rgba(112, 123, 145, 0.18)", "#20B978"]);
  });
});
