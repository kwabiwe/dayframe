import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const mocks = vi.hoisted(() => ({ pans: [] as any[], haptic: vi.fn() }));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 0.5, flatten: (style: unknown) => style },
  Text: "Text",
  View: "View",
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
}));
vi.mock("react-native-gesture-handler", () => {
  function Pan() {
    const pan: any = { handlers: {} };
    for (const method of ["activeOffsetX", "failOffsetY"]) pan[method] = () => pan;
    for (const name of ["onStart", "onUpdate", "onEnd", "onFinalize"]) pan[name] = (fn: unknown) => { pan.handlers[name] = fn; return pan; };
    mocks.pans.push(pan);
    return pan;
  }
  return { Gesture: { Pan }, GestureDetector: ({ children }: { children: unknown }) => children };
});
vi.mock("react-native-reanimated", () => ({
  default: { View: "AnimatedView" },
  Easing: { in: (value: unknown) => value, quad: "quad" },
  runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
  useAnimatedStyle: () => ({}),
  useSharedValue: (value: unknown) => ({ value }),
  withDelay: (_delay: number, value: unknown) => value,
  withSequence: (...values: unknown[]) => values[values.length - 1],
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
}));
vi.mock("../../lib/blocksMotion", () => ({ BLOCKS_SPRING: { land: {} } }));
vi.mock("../../lib/haptics", () => ({ playHaptic: mocks.haptic }));
vi.mock("../../lib/motion", () => ({
  localLayoutTransition: () => "layout",
  localPresenceEntering: () => "entering",
  localPresenceExiting: () => "exiting",
}));
vi.mock("../../lib/mobileTypography", () => ({ mobileTextProps: () => ({}) }));
vi.mock("../icons/DayframeIcon", () => ({ DayframeIcon: () => null }));
vi.mock("./ActivityBlockMark", () => ({ ActivityBlockMark: () => null }));

import type { HistoryEntryGroup } from "../../lib/historyPresentation";
import { TodayBlockRows } from "./TodayBlockRows";

const theme = {
  accent: "#FF6248", border: "#2A3345", danger: "#FF6B6B", mode: "dark", onAccent: "#050914", onDanger: "#050914",
  surface: "#151B26", surfaceMuted: "#202838", textMuted: "#707B91", textPrimary: "#FFFFFF", textSecondary: "#8993A7",
} as never;
const day = new Date(2026, 9, 7).getTime();
const at = (h: number, m = 0) => new Date(day + (h * 60 + m) * 60_000).toISOString();

function entry(id: string, start: string, stop: string | null, extra: Record<string, unknown> = {}) {
  return { id, startedAt: start, stoppedAt: stop, description: "Deep work", categoryId: "focus", categoryName: "Focus", categoryColor: "blue", ...extra } as never;
}
function group(...entries: any[]): HistoryEntryGroup {
  const items = entries.map((value) => ({ entry: value, overlapSeconds: 3600 }));
  return { entries: items, key: entries[0].id, representative: items[0], totalSeconds: items.length * 3600 };
}

function render(groups: HistoryEntryGroup[], overrides: Record<string, unknown> = {}) {
  const props = {
    activeTimerRunning: false,
    activityIconFor: () => null,
    groups,
    nowMs: day + 12 * 3_600_000,
    onDeleteEntries: vi.fn(),
    onOpenEntry: vi.fn(),
    onReplayEntry: vi.fn(),
    reduceMotion: false,
    rowLanding: null,
    theme,
    ...overrides,
  };
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<TodayBlockRows {...(props as any)} />);
  });
  return { tree, props };
}

function swipe(index: number, ...path: number[]) {
  const pan = mocks.pans[index];
  act(() => {
    pan.handlers.onStart?.({});
    for (const translationX of path) pan.handlers.onUpdate({ translationX });
    pan.handlers.onEnd({}, true);
    pan.handlers.onFinalize?.({});
  });
}

function cancel(index: number, translationX: number) {
  const pan = mocks.pans[index];
  act(() => {
    pan.handlers.onStart?.({});
    pan.handlers.onUpdate({ translationX });
    pan.handlers.onEnd({}, false);
    pan.handlers.onFinalize?.({});
  });
}

beforeEach(() => {
  mocks.pans = [];
  mocks.haptic.mockReset();
});

describe("TodayBlockRows", () => {
  it("shows the prototype's heading, caption and empty state", () => {
    const empty = render([]).tree;
    const texts = empty.root.findAllByType("Text" as never).map((node) => node.props.children);
    expect(texts).toEqual(["Today's blocks", "No blocks yet", "Start one above"]);

    const filled = render([group(entry("a", at(8, 13), at(10))), group(entry("b", at(6, 39), at(7)), entry("c", at(7, 30), at(8, 13)))]).tree;
    const head = filled.root.findAllByType("Text" as never).slice(0, 2).map((node) => node.props.children);
    expect(head).toEqual(["Today's blocks", "3 · swipe a row"]);
  });

  it("reads each row as one button with its time, duration and swipe actions", () => {
    const { tree } = render([group(entry("a", at(8, 13), at(10)))]);
    const row = tree.root.findByProps({ testID: "today-block-row-a" });
    expect(row.props.accessibilityLabel).toBe("Deep work, 08:13 to 10:00, Focus, 1 hour");
    expect(row.props.accessibilityActions.map((action: { name: string }) => action.name)).toEqual(["startAgain", "delete"]);
  });

  it("starts the block again past the right threshold and springs back short of it", () => {
    const { props } = render([group(entry("a", at(8), at(9)))]);
    swipe(0, 60);
    expect(props.onReplayEntry).not.toHaveBeenCalled();
    swipe(0, 120);
    expect(props.onReplayEntry).toHaveBeenCalledTimes(1);
    expect(mocks.haptic).toHaveBeenCalledWith("tick");
  });

  it("commits nothing when the finger pulls back under the threshold, ticking once per arming", () => {
    const { props } = render([group(entry("a", at(8), at(9)))]);
    swipe(0, 120, 60);
    swipe(0, -120, -60);
    expect(props.onReplayEntry).not.toHaveBeenCalled();
    expect(props.onDeleteEntries).not.toHaveBeenCalled();
    expect(mocks.haptic.mock.calls.filter(([kind]) => kind === "tick")).toHaveLength(2);
  });

  it("needs a full swipe per commit even when grabbed mid-spring", () => {
    const { props } = render([group(entry("a", at(8), at(9)))]);
    // A gesture interrupted before release leaves the row out at +90 (as if still springing home).
    act(() => {
      mocks.pans[0].handlers.onStart({});
      mocks.pans[0].handlers.onUpdate({ translationX: 90 });
      mocks.pans[0].handlers.onFinalize({});
    });
    swipe(0, 30);
    expect(props.onReplayEntry).not.toHaveBeenCalled();
    swipe(0, 120);
    expect(props.onReplayEntry).toHaveBeenCalledTimes(1);
  });

  it("never commits a reversed re-grab while the row is shown near centre", () => {
    const { props } = render([group(entry("a", at(8), at(9)))]);
    // Left out at -90 (springing home), then swiped right 100: the row shows +10 only.
    act(() => {
      mocks.pans[0].handlers.onStart({});
      mocks.pans[0].handlers.onUpdate({ translationX: -90 });
      mocks.pans[0].handlers.onFinalize({});
    });
    swipe(0, 100);
    expect(props.onReplayEntry).not.toHaveBeenCalled();
    // Right out at +100, then swiped left 100: the row shows -10 only.
    act(() => {
      mocks.pans[0].handlers.onStart({});
      mocks.pans[0].handlers.onUpdate({ translationX: 100 });
      mocks.pans[0].handlers.onFinalize({});
    });
    swipe(0, -100);
    expect(props.onDeleteEntries).not.toHaveBeenCalled();
  });

  it("says a group's count once to VoiceOver", () => {
    const { tree } = render([group(entry("a", at(8), at(9)), entry("b", at(10), at(11)))]);
    const label = tree.root.findByProps({ testID: "today-block-row-a" }).props.accessibilityLabel as string;
    expect(label).toBe("Expand 2 Deep work entries. Deep work, 08:00 to 09:00, Focus, 2 hours");
  });

  it("commits nothing when the system cancels an armed swipe", () => {
    const { props } = render([group(entry("a", at(8), at(9)))]);
    cancel(0, -150);
    cancel(0, 150);
    expect(props.onDeleteEntries).not.toHaveBeenCalled();
    expect(props.onReplayEntry).not.toHaveBeenCalled();
  });

  it("deletes only the swiped child inside an open group", () => {
    const first = entry("a", at(8), at(9));
    const second = entry("b", at(10), at(11));
    const { props, tree } = render([group(first, second)]);
    act(() => tree.root.findByProps({ testID: "today-block-row-a" }).props.onPress());
    const childIndex = mocks.pans.length - 1;
    swipe(childIndex, -150);
    expect(props.onDeleteEntries).toHaveBeenCalledWith([second]);
  });

  it("offers no Start again for a blank row with no activity", () => {
    const { tree } = render([group(entry("blank", at(8), at(9), { categoryId: null, categoryName: null, description: null }))]);
    const row = tree.root.findByProps({ testID: "today-block-row-blank" });
    expect(row.props.accessibilityActions.map((action: { name: string }) => action.name)).toEqual(["delete"]);
  });

  it("forgets an open group once it no longer holds repeats", () => {
    const first = entry("a", at(8), at(9));
    const second = entry("b", at(10), at(11));
    const { props, tree } = render([group(first, second)]);
    act(() => tree.root.findByProps({ testID: "today-block-row-a" }).props.onPress());
    act(() => tree.update(<TodayBlockRows {...(props as any)} groups={[group(first)]} />));
    act(() => tree.update(<TodayBlockRows {...(props as any)} groups={[group(first, second)]} />));
    expect(tree.root.findByProps({ testID: "today-block-row-a" }).props.accessibilityState).toEqual({ expanded: false });
  });

  it("deletes a whole group past the left threshold", () => {
    const first = entry("a", at(8), at(9));
    const second = entry("b", at(10), at(11));
    const { props } = render([group(first, second)]);
    swipe(0, -120);
    expect(props.onDeleteEntries).toHaveBeenCalledWith([first, second]);
    expect(mocks.haptic).not.toHaveBeenCalledWith("delete");
  });

  it("never starts again or deletes a running entry; it only resists", () => {
    const { props, tree } = render([group(entry("live", at(11), null))]);
    swipe(0, 300);
    swipe(0, -300);
    expect(props.onReplayEntry).not.toHaveBeenCalled();
    expect(props.onDeleteEntries).not.toHaveBeenCalled();
    expect(mocks.haptic).not.toHaveBeenCalled();
    const row = tree.root.findByProps({ testID: "today-block-row-live" });
    expect(row.props.accessibilityActions).toBeUndefined();
    expect(row.props.accessibilityLabel).toContain("11:00 to now");
  });

  it("opens a group of repeats in place and edits a single row", () => {
    const single = entry("solo", at(13), at(14));
    const { props, tree } = render([group(entry("a", at(8), at(9)), entry("b", at(10), at(11))), group(single)]);
    const groupRow = tree.root.findByProps({ testID: "today-block-row-a" });
    expect(groupRow.props.accessibilityState).toEqual({ expanded: false });
    act(() => groupRow.props.onPress());
    expect(tree.root.findByProps({ testID: "today-block-children-a" })).toBeTruthy();
    expect(tree.root.findByProps({ testID: "today-block-row-a" }).props.accessibilityState).toEqual({ expanded: true });
    act(() => tree.root.findByProps({ testID: "today-block-row-solo" }).props.onPress());
    expect(props.onOpenEntry).toHaveBeenCalledWith(single);
  });

  it("offers VoiceOver Start again and Delete, and Switch while a timer runs", () => {
    const solo = entry("a", at(8), at(9));
    const { props, tree } = render([group(solo)], { activeTimerRunning: true });
    const row = tree.root.findByProps({ testID: "today-block-row-a" });
    expect(row.props.accessibilityActions[0].label).toBe("Switch to Deep work");
    act(() => row.props.onAccessibilityAction({ nativeEvent: { actionName: "startAgain" } }));
    act(() => row.props.onAccessibilityAction({ nativeEvent: { actionName: "delete" } }));
    expect(props.onReplayEntry).toHaveBeenCalledWith(solo);
    expect(props.onDeleteEntries).toHaveBeenCalledWith([solo]);
  });
});
