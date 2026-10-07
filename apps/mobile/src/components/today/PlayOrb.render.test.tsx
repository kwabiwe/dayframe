import { act, create, type ReactTestInstance } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { DAYFRAME_THEME } from "@dayframe/shared";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const mocks = vi.hoisted(() => ({ gestures: [] as any[], haptic: vi.fn() }));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { absoluteFill: { position: "absolute" }, create: <T,>(styles: T) => styles },
  Text: "Text",
  View: "View",
  useWindowDimensions: () => ({ fontScale: 1, height: 874, scale: 3, width: 402 }),
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 34, left: 0, right: 0, top: 62 }) }));
vi.mock("react-native-gesture-handler", () => {
  function gesture(kind: string) {
    const g: any = { handlers: {}, kind };
    for (const method of ["activateAfterLongPress", "maxDuration"]) g[method] = () => g;
    for (const name of ["onBegin", "onStart", "onUpdate", "onEnd", "onFinalize"]) g[name] = (fn: unknown) => { g.handlers[name] = fn; return g; };
    mocks.gestures.push(g);
    return g;
  }
  return {
    Gesture: { Exclusive: (...list: unknown[]) => ({ list }), Pan: () => gesture("pan"), Tap: () => gesture("tap") },
    GestureDetector: ({ children }: { children: unknown }) => children,
  };
});
vi.mock("react-native-reanimated", async () => {
  const React = await import("react");
  const builder = () => {
    const b: any = { duration: () => b, reduceMotion: () => b };
    return b;
  };
  return {
    default: { View: "ReanimatedView" },
    FadeIn: builder(),
    FadeOut: builder(),
    ReduceMotion: { Never: "never" },
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useSharedValue: (initial: unknown) => {
      const ref = React.useRef<{ value: unknown } | null>(null);
      if (!ref.current) ref.current = { value: initial };
      return ref.current;
    },
    withDelay: (_delay: number, value: unknown) => value,
    withSpring: (value: unknown) => value,
    withTiming: (value: unknown) => value,
  };
});
vi.mock("react-native-svg", () => ({ Circle: "Circle", default: "Svg" }));
vi.mock("../../lib/haptics", () => ({ playHaptic: mocks.haptic }));
vi.mock("../PrimaryTimerAction", () => ({ PrimaryTimerGlyph: ({ mode }: { mode: string }) => `glyph:${mode}` }));
vi.mock("../icons/DayframeIcon", () => ({ ActivityIcon: () => null }));

import { PLAY_ORB, bloomSpots, playOrbFrame } from "../../lib/playOrb";
import { PlayOrb } from "./PlayOrb";

const theme = { ...DAYFRAME_THEME.dark, mode: "dark" } as never;
const activities = ["work", "learn", "gym"].map((id) => ({ color: "blue", icon: null, id, name: id, pinned: true }));

function render(overrides: Record<string, unknown> = {}) {
  mocks.gestures.length = 0;
  mocks.haptic.mockClear();
  const props = { activities, hidden: false, nowMs: Date.parse("2026-10-07T21:00:15"), onChoose: vi.fn(), onTap: vi.fn(), reduceMotion: false, running: false, theme, ...overrides };
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<PlayOrb {...props} />);
  });
  const hold = () => mocks.gestures.filter((g) => g.kind === "pan").at(-1);
  const tap = () => mocks.gestures.filter((g) => g.kind === "tap").at(-1);
  const bloom = () => tree.root.findAllByProps({ testID: "play-orb-bloom" })[0] as ReactTestInstance | undefined;
  return { bloom, hold, props, tap, tree };
}

describe("playOrbFrame", () => {
  it("centres the orb on the tab bar's trailing slot", () => {
    expect(playOrbFrame({ bottomInset: 34, height: 874, width: 402 })).toEqual({ left: 402 - 52.5 - 32, top: 874 - 53 - 32 });
  });
});

describe("PlayOrb", () => {
  it("taps to start or stop, and shows the seconds ring only while running", () => {
    const idle = render();
    expect(idle.tree.root.findAllByProps({ testID: "play-orb-ring" })).toHaveLength(0);
    act(() => idle.tap().handlers.onEnd({}, true));
    expect(idle.props.onTap).toHaveBeenCalledOnce();
    act(() => idle.tree.unmount());

    const running = render({ running: true });
    const ring = running.tree.root.findByProps({ testID: "play-orb-ring" });
    const circumference = 2 * Math.PI * (PLAY_ORB.size / 2 + 5 - 1.5);
    expect(ring.props.strokeDasharray).toBe(`${(15 / 60) * circumference} ${circumference}`);
    act(() => running.tree.unmount());
  });

  it("opens the bloom after the hold and starts the activity the finger is released on", () => {
    const { bloom, hold, props, tree } = render();
    act(() => {
      hold().handlers.onBegin({});
      hold().handlers.onStart({});
    });
    expect(bloom()).toBeDefined();
    expect(mocks.haptic).toHaveBeenCalledWith("start");
    const [first] = bloomSpots(activities);
    const center = PLAY_ORB.size / 2;
    act(() => hold().handlers.onUpdate({ translationX: first.dx, translationY: first.dy, x: center + first.dx, y: center + first.dy }));
    expect(mocks.haptic).toHaveBeenLastCalledWith("tick");
    expect(tree.root.findAllByType("Text" as never).map((node) => node.children.join(""))).toContain("work");
    act(() => {
      hold().handlers.onEnd({}, true);
      hold().handlers.onFinalize({}, true);
    });
    expect(props.onChoose).toHaveBeenCalledWith("work");
    expect(bloom()).toBeUndefined();
    act(() => tree.unmount());
  });

  it("stays open to tap when let go without moving, and closes from outside", () => {
    const { bloom, hold, props, tree } = render({ running: true });
    act(() => {
      hold().handlers.onStart({});
      hold().handlers.onEnd({}, true);
    });
    expect(bloom()!.props.pointerEvents).toBe("auto");
    const texts = tree.root.findAllByType("Text" as never).map((node) => node.children.join(""));
    expect(texts).toEqual(expect.arrayContaining(["SWITCH TO", "Slide to a block", "Tap one to switch · tap outside to cancel"]));
    act(() => tree.root.findByProps({ testID: "play-orb-bubble-gym" }).props.onPress());
    expect(props.onChoose).toHaveBeenCalledWith("gym");
    act(() => {
      hold().handlers.onStart({});
      hold().handlers.onEnd({}, true);
    });
    act(() => tree.root.findByProps({ testID: "play-orb-scrim" }).props.onPress());
    expect(bloom()).toBeUndefined();
    expect(props.onChoose).toHaveBeenCalledOnce();
    act(() => tree.unmount());
  });

  it("closes without choosing when the finger slides away or the system cancels the hold", () => {
    const { bloom, hold, props, tree } = render();
    act(() => {
      hold().handlers.onStart({});
      hold().handlers.onUpdate({ translationX: -30, translationY: -20, x: 2, y: 12 });
      hold().handlers.onEnd({}, true);
    });
    expect(bloom()).toBeUndefined();
    act(() => {
      hold().handlers.onStart({});
      hold().handlers.onFinalize({}, false);
    });
    expect(bloom()).toBeUndefined();
    expect(props.onChoose).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("hides with the tab bar and is hidden from VoiceOver (the native item carries it)", () => {
    const shown = render();
    expect(shown.tree.root.findByProps({ testID: "play-orb" }).props.accessibilityElementsHidden).toBe(true);
    act(() => shown.tree.unmount());
    const hidden = render({ hidden: true });
    expect(hidden.tree.toJSON()).toBeNull();
    act(() => hidden.tree.unmount());
  });
});
