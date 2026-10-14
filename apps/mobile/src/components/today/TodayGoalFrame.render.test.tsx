import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({
  StyleSheet: { create: <T,>(styles: T) => styles, flatten: (style: unknown) => style },
  Text: "Text",
  View: "View",
}));
vi.mock("../../lib/mobileTypography", () => ({
  MOBILE_DISPLAY_FONT: { extraBold: "Display-ExtraBold" },
  mobileTextProps: () => ({ allowFontScaling: true }),
}));

import { buildTodayGoalFrame } from "../../lib/todayGoalFrame";
import { TodayGoalFrame } from "./TodayGoalFrame";

const theme = {
  accent: "#FF6248",
  mode: "dark",
  surfaceMuted: "#202838",
  textMuted: "#707B91",
  textPrimary: "#FFFFFF",
  textSecondary: "#8993A7",
} as never;
const day = new Date(2026, 9, 7).getTime();
const at = (h: number, m = 0) => new Date(day + (h * 60 + m) * 60_000).toISOString();

function render(frame: ReturnType<typeof buildTodayGoalFrame>, frames: string[] = []) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(
      <TodayGoalFrame
        dateLabel="Wednesday 7 October"
        diagnostic={{ onLayout: (id) => frames.push(id) }}
        theme={theme}
        {...frame}
      />,
    );
  });
  return tree;
}

describe("TodayGoalFrame", () => {
  it("reads as one heading and one summary, with the prototype's wording", () => {
    const tree = render(buildTodayGoalFrame({
      entries: [{ id: "a", startedAt: at(8), stoppedAt: at(10, 30), categoryColor: "blue" }],
      goalMinutes: 480,
      nowMs: day + 12 * 3_600_000,
    }));
    const texts = tree.root.findAllByType("Text" as never);
    expect(texts.map((text) => text.props.children)).toEqual([
      "WEDNESDAY 7 OCTOBER",
      "2h 30m",
      ["framed of ", "8h"],
      [31, "%"],
    ]);
    expect(texts[0].props).toMatchObject({ accessibilityLabel: "Today, Wednesday 7 October", accessibilityRole: "header" });
    const summary = tree.root.findAll((node) => node.props.accessible === true && typeof node.props.accessibilityLabel === "string");
    expect(summary).toHaveLength(1);
    expect(summary[0].props.accessibilityLabel).toBe("2 hours 30 minutes framed. Daily goal 8 hours, 31 percent.");
  });

  it("says how much fills the goal when an activity doesn't count (UIA-043)", () => {
    const tree = render(buildTodayGoalFrame({
      categories: [{ id: "sleep", countsTowardGoal: false }],
      entries: [
        { id: "s", startedAt: at(0), stoppedAt: at(7), categoryId: "sleep", categoryColor: "blue" },
        { id: "w", startedAt: at(8), stoppedAt: at(10), categoryId: "work", categoryColor: "lime" },
      ],
      goalMinutes: 480,
      nowMs: day + 12 * 3_600_000,
    }));
    const texts = tree.root.findAllByType("Text" as never);
    expect(texts.map((text) => text.props.children)).toEqual([
      "WEDNESDAY 7 OCTOBER",
      "9h",
      ["framed · 2h toward ", "8h"],
      [25, "%"],
    ]);
    const summary = tree.root.findAll((node) => node.props.accessible === true && typeof node.props.accessibilityLabel === "string");
    expect(summary[0].props.accessibilityLabel).toBe("9 hours framed, 2 hours toward your daily goal of 8 hours, 25 percent.");
  });

  it("reads the covered total with no \"toward\" line when only overlaps separate logged from covered time (D14)", () => {
    const tree = render(buildTodayGoalFrame({
      entries: [
        { id: "a", startedAt: at(9), stoppedAt: at(11), categoryId: "focus", categoryColor: "blue" },
        { id: "b", startedAt: at(10), stoppedAt: at(12), categoryId: "admin", categoryColor: "lime" },
      ],
      goalMinutes: 480,
      nowMs: day + 13 * 3_600_000,
    }));
    const texts = tree.root.findAllByType("Text" as never);
    // 4h logged, 3h covered: the hero is the covered 3h and the goal line no longer splits.
    expect(texts.map((text) => text.props.children)).toEqual([
      "WEDNESDAY 7 OCTOBER",
      "3h",
      ["framed of ", "8h"],
      [38, "%"],
    ]);
    const summary = tree.root.findAll((node) => node.props.accessible === true && typeof node.props.accessibilityLabel === "string");
    expect(summary[0].props.accessibilityLabel).toBe("3 hours framed. Daily goal 8 hours, 38 percent.");
  });

  it("draws goals over 14 hours with tighter gaps and corners, and 14 or fewer unchanged", () => {
    const cellsFor = (goalHours: number) => {
      const tree = render(buildTodayGoalFrame({ entries: [], goalMinutes: goalHours * 60, nowMs: day + 12 * 3_600_000 }));
      const frame = tree.root.findByProps({ testID: "today-goal-frame" });
      const row = frame.findAll((node) => node.type === ("View" as never) && Array.isArray(node.props.style) && node.props.style[0]?.height === 18)[0];
      const cells = frame.findAll((node) => node.type === ("View" as never) && Array.isArray(node.props.style) && node.props.style[0]?.flex === 1);
      return { cells, row };
    };
    const flat = (style: unknown[]) => Object.assign({}, ...style.filter(Boolean)) as Record<string, unknown>;
    for (const [hours, dense] of [[14, false], [15, true], [24, true]] as const) {
      const { cells, row } = cellsFor(hours);
      expect(cells).toHaveLength(hours);
      expect(flat(row.props.style).columnGap).toBe(dense ? 2 : 4);
      expect(flat(cells[0].props.style).borderRadius).toBe(dense ? 3 : 5);
    }
  });

  it("draws one cell per goal hour and marks the live slice with the recording colour", () => {
    const tree = render(buildTodayGoalFrame({
      entries: [{ id: "live", startedAt: at(9), stoppedAt: null, categoryColor: "lime" }],
      goalMinutes: 360,
      nowMs: day + (10 * 60 + 30) * 60_000,
    }));
    const cells = tree.root.findByProps({ testID: "today-goal-frame" })
      .findAll((node) => node.type === ("View" as never) && Array.isArray(node.props.style) && node.props.style[0]?.flex === 1);
    expect(cells).toHaveLength(6);
    const liveSlices = tree.root.findAll((node) =>
      node.type === ("View" as never) && Array.isArray(node.props.style) && JSON.stringify(node.props.style).includes("#FF6248"));
    expect(liveSlices).toHaveLength(2);
  });

  it("reports every measured part to the accessibility probe", () => {
    const frames: string[] = [];
    const tree = render(buildTodayGoalFrame({ entries: [], goalMinutes: 480, nowMs: day }), frames);
    const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 20 } } };
    act(() => {
      for (const node of tree.root.findAll((candidate) => typeof candidate.props.onLayout === "function")) {
        node.props.onLayout(layout);
      }
    });
    expect(new Set(frames)).toEqual(new Set([
      "today.goal",
      "today.goal.date.frame",
      "today.goal.total.frame",
      "today.goal.of.frame",
      "today.goal.cells",
    ]));
  });
});
