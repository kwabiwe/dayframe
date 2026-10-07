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
    expect(summary[0].props.accessibilityLabel).toBe("2 hours 30 minutes tracked. Daily goal 8 hours, 31 percent.");
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
