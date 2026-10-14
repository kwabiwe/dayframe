import { useState } from "react";
import { act, create, type ReactTestInstance } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const mocks = vi.hoisted(() => ({ fontScale: 1, measureCalls: 0 }));
// Counts the strip's renders: each render of its button measures its two text samples.
vi.mock("../accessibility/IntrinsicTextMeasure", () => ({
  useIntrinsicTextMeasure: () => {
    mocks.measureCalls += 1;
    return { probe: null, widths: {} };
  },
}));
vi.mock("react-native", () => ({
  AccessibilityInfo: {
    addEventListener: () => ({ remove: () => undefined }),
    isBoldTextEnabled: () => Promise.resolve(false),
  },
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 0.5 },
  Text: "Text",
  View: "View",
  useWindowDimensions: () => ({ fontScale: mocks.fontScale, height: 874, scale: 3, width: 402 }),
}));
vi.mock("react-native-reanimated", () => ({ default: { View: "ReanimatedView" } }));
vi.mock("../../lib/motion", () => ({
  localPresenceEntering: (reduceMotion: boolean) => ({ kind: "fadeIn", ms: reduceMotion ? 90 : 140 }),
  localPresenceExiting: (reduceMotion: boolean) => ({ kind: "fadeOut", ms: reduceMotion ? 70 : 140 }),
}));

import { buildTodayWhereWent, type TodayWhereWentModel } from "../../lib/todayWhereWent";
import { TodayWhereWent, whereWentColumns } from "./TodayWhereWent";

const theme = {
  accent: "#FF6248",
  border: "#2A3345",
  mode: "dark",
  textMuted: "#707B91",
  textPrimary: "#F7F8FB",
  textSecondary: "#8993A7",
} as never;
const day = new Date(2026, 9, 14).getTime();
const at = (h: number, m = 0) => new Date(day + (h * 60 + m) * 60_000).toISOString();
const entry = (id: string, start: string, stop: string | null, activity: string, color: string) => ({
  id,
  startedAt: start,
  stoppedAt: stop,
  categoryId: `cat-${activity}`,
  categoryName: activity[0].toUpperCase() + activity.slice(1),
  categoryColor: color,
});

const busyDay = buildTodayWhereWent({
  entries: [
    entry("w", at(8), at(10), "work", "blue"),
    entry("c", at(10), at(11), "coding", "violet"),
    entry("m", at(12), at(12, 30), "meals", "orange"),
    entry("a", at(13), at(13, 20), "admin", "steel"),
    entry("l", at(14), null, "learning", "amber"),
  ],
  nowMs: day + (14 * 60 + 10) * 60_000,
})!;
const twoActivities = buildTodayWhereWent({
  entries: [entry("w", at(9), null, "work", "blue"), entry("c", at(9), at(10), "coding", "violet")],
  nowMs: day + 11 * 3_600_000,
})!;

function render(model: TodayWhereWentModel | null, { onOpen = () => undefined, quiet = false } = {}) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<TodayWhereWent model={model} onOpen={onOpen} quiet={quiet} reduceMotion={false} theme={theme} />);
  });
  return tree;
}
const flat = (style: unknown): Record<string, unknown> =>
  Array.isArray(style) ? Object.assign({}, ...style.flat(3).filter(Boolean).map(flat)) : ((style ?? {}) as Record<string, unknown>);
const byTestID = (tree: ReturnType<typeof create>, id: string) => tree.root.findAll((node) => node.props.testID === id && typeof node.type === "string");
const texts = (node: ReactTestInstance) => node.findAllByType("Text" as never).map((text) => text.props.children);

describe("TodayWhereWent", () => {
  it("is one 44-point button that VoiceOver reads as one sentence and that opens Reports for today", () => {
    const onOpen = vi.fn();
    const tree = render(twoActivities, { onOpen });
    const buttons = tree.root.findAll((node) => node.props.accessibilityRole === "button");
    expect(buttons).toHaveLength(1);
    const [button] = buttons;
    expect(button.props.accessibilityLabel).toBe(
      "Where today went. Work, 1 hour 30 minutes, recording. Coding, 30 minutes. 2 hours in all."
    );
    expect(button.props.accessibilityHint).toBe("Opens Reports for today");
    expect(flat(button.props.style({ pressed: false })).minHeight).toBe(44);
    // One hairline divider at the top: the strip folds into the ribbon card, no card of its own.
    expect(flat(button.props.style({ pressed: false }))).toMatchObject({ borderTopColor: "#2A3345", borderTopWidth: 0.5 });
    expect(flat(button.props.style({ pressed: false })).backgroundColor).toBeUndefined();
    // Nothing inside is a separate accessibility element.
    expect(tree.root.findAll((node) => node !== button && node.props.accessible === true && typeof node.type === "string")).toHaveLength(0);
    act(() => button.props.onPress());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("draws a 12-point proportional bar, largest first, with the coral edge only on the running segment", () => {
    const tree = render(twoActivities);
    const bar = byTestID(tree, "today-where-went-bar")[0];
    expect(flat(bar.props.style)).toMatchObject({ columnGap: 2, flexDirection: "row", height: 12 });
    const segments = bar.children as ReactTestInstance[];
    expect(segments.map((segment) => segment.props.testID)).toEqual(["today-where-went-segment-cat-work", "today-where-went-segment-cat-coding"]);
    const [work, coding] = segments.map((segment) => flat(segment.props.style));
    expect(work).toMatchObject({ borderRadius: 4, flexBasis: 0, flexGrow: 5400, minWidth: 3, borderRightWidth: 2, borderRightColor: "#FF6248" });
    expect(coding).toMatchObject({ borderRadius: 4, flexGrow: 1800, minWidth: 3 });
    expect(coding.borderRightWidth).toBeUndefined();
    // The only coral in the strip is the running edge.
    expect(JSON.stringify(tree.toJSON()).match(/#FF6248/g)).toHaveLength(1);
  });

  it("shows the top three and a neutral Other in a fixed 2×2 legend, durations in full", () => {
    const tree = render(busyDay);
    const legend = byTestID(tree, "today-where-went-legend")[0];
    const rows = legend.children as ReactTestInstance[];
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => texts(row))).toEqual([
      ["Work", "2h", "Coding", "1h"],
      ["Meals", "30m", "Other", "30m"],
    ]);
    const other = byTestID(tree, "today-where-went-segment-__other")[0];
    // Other is neutral and holds the running block (Learning), so it carries the edge.
    expect(flat(other.props.style)).toMatchObject({ backgroundColor: "#707B91", borderRightColor: "#FF6248" });
    // Names truncate to one line; durations never do.
    const item = byTestID(tree, "today-where-went-item-cat-work")[0];
    const [name, duration] = item.findAllByType("Text" as never);
    expect(name.props.numberOfLines).toBe(1);
    expect(duration.props.numberOfLines).toBeUndefined();
    expect(flat(duration.props.style).flexShrink).toBe(0);
    // Role caps: heading 1.5, names 1.35, durations 1.2.
    const heading = tree.root.findAllByType("Text" as never).find((text) => text.props.children === "Where today went")!;
    expect(heading.props.maxFontSizeMultiplier).toBe(1.5);
    expect(name.props.maxFontSizeMultiplier).toBe(1.35);
    expect(duration.props.maxFontSizeMultiplier).toBe(1.2);
  });

  it("keeps four legend slots whatever the day holds, so a re-ranking never resizes the card", () => {
    const tree = render(twoActivities);
    const legend = byTestID(tree, "today-where-went-legend")[0];
    expect((legend.children as ReactTestInstance[]).flatMap((row) => row.children)).toHaveLength(4);
    const empty = byTestID(tree, "today-where-went-item-empty");
    expect(empty).toHaveLength(2);
    expect(flat(empty[0].props.style).opacity).toBe(0);
  });

  it("drops the legend to one column when large text no longer fits two, never truncating a duration", () => {
    mocks.fontScale = 3;
    try {
      const tree = render(busyDay);
      const rows = byTestID(tree, "today-where-went-legend")[0].children as ReactTestInstance[];
      expect(rows).toHaveLength(4);
      expect(rows.map((row) => texts(row))).toEqual([["Work", "2h"], ["Coding", "1h"], ["Meals", "30m"], ["Other", "30m"]]);
    } finally {
      mocks.fontScale = 1;
    }
    // Measured: two columns while marker, name sample and the longest duration fit each half.
    expect(whereWentColumns({ durationWidth: 60, fontScale: 1, legendWidth: 343, nameWidth: 40 })).toBe(2);
    expect(whereWentColumns({ durationWidth: 90, fontScale: 1.35, legendWidth: 300, nameWidth: 60 })).toBe(1);
    // Before the native measurement lands the capped scale decides.
    expect(whereWentColumns({ fontScale: 1, legendWidth: 343 })).toBe(2);
    expect(whereWentColumns({ fontScale: 2, legendWidth: 343 })).toBe(1);
  });

  it("renders nothing on an empty day", () => {
    const tree = render(null);
    expect(tree.toJSON()).toBeNull();
  });

  it("has no entrance on first paint or a quiet (loaded) commit, and fades when it appears mid-session", () => {
    // First paint with a model (a cached launch): no entrance.
    let tree = render(twoActivities);
    expect(byTestID(tree, "today-where-went-presence")[0].props.entering).toBeUndefined();
    expect(byTestID(tree, "today-where-went-presence")[0].props.exiting).toEqual({ kind: "fadeOut", ms: 140 });

    // Mounted empty, then a load brings the day (hydration or a refresh): no entrance.
    tree = render(null);
    act(() => tree.update(<TodayWhereWent model={twoActivities} onOpen={() => undefined} quiet reduceMotion={false} theme={theme} />));
    expect(byTestID(tree, "today-where-went-presence")[0].props.entering).toBeUndefined();

    // Mounted empty, then the day's first minute arrives mid-session: fade in (90 ms under Reduce Motion).
    tree = render(null);
    act(() => tree.update(<TodayWhereWent model={twoActivities} onOpen={() => undefined} quiet={false} reduceMotion theme={theme} />));
    expect(byTestID(tree, "today-where-went-presence")[0].props.entering).toEqual({ kind: "fadeIn", ms: 90 });
    expect(byTestID(tree, "today-where-went-presence")[0].props.exiting).toEqual({ kind: "fadeOut", ms: 70 });
  });
});

describe("TodayWhereWent minute-clock contract", () => {
  it("never re-renders on the 1 s tick: only a new per-minute model renders it", () => {
    let tick!: (seconds: number) => void;
    const entries = [entry("w", at(9), null, "work", "blue")];
    const models = new Map<number, TodayWhereWentModel | null>();
    // The Dashboard memoises the model on the minute clock (`minuteNow`).
    const minuteModel = (minute: number) => {
      if (!models.has(minute)) models.set(minute, buildTodayWhereWent({ entries, nowMs: minute }));
      return models.get(minute)!;
    };
    const onOpen = () => undefined;
    let hostRenders = 0;
    function Host() {
      const [now, setNow] = useState(day + 10 * 3_600_000);
      tick = (seconds) => setNow((current) => current + seconds * 1000);
      hostRenders += 1;
      return <TodayWhereWent model={minuteModel(Math.floor(now / 60_000) * 60_000)} onOpen={onOpen} quiet={false} reduceMotion={false} theme={theme} />;
    }
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Host />);
    });
    const stripRenders = () => mocks.measureCalls / 2;
    const before = stripRenders();
    // Two minutes of 1 s ticks: the host renders every second, the strip once per new minute.
    for (let second = 0; second < 120; second += 1) act(() => tick(1));
    expect(hostRenders).toBe(121);
    expect(stripRenders() - before).toBe(2);
    expect(texts(tree.root)).toContain("1h 2m");
    act(() => tree.unmount());
  });
});
