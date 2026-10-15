import { act, create, type ReactTestInstance } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { DAYFRAME_THEME } from "@dayframe/shared";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
const mocks = vi.hoisted(() => ({ gestures: [] as any[], haptic: vi.fn(), reduceTransparency: false }));
vi.mock("expo-blur", () => ({ BlurView: "BlurView" }));
vi.mock("../../lib/motion", () => ({ useReduceTransparencyPreference: () => mocks.reduceTransparency }));
vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
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
vi.mock("react-native-svg", () => ({ Circle: "Circle", Path: "Path", default: "Svg" }));
vi.mock("../../lib/haptics", () => ({ playHaptic: mocks.haptic }));
vi.mock("../PrimaryTimerAction", () => ({ PrimaryTimerGlyph: ({ mode }: { mode: string }) => `glyph:${mode}` }));
vi.mock("../icons/DayframeIcon", () => ({ ActivityIcon: () => null }));

import { PLAY_ORB, bloomSpots, playOrbFrame } from "../../lib/playOrb";
import { activeTimerElapsedSeconds } from "../../lib/timerPresentation";
import { orbRingPath, orbRingProgress, PlayOrb } from "./PlayOrb";
import { useLiveBlockElapsed } from "./liveBlockClock";

const theme = { ...DAYFRAME_THEME.dark, mode: "dark" } as never;
const activities = ["work", "learn", "gym"].map((id) => ({ color: "blue", icon: null, id, name: id, pinned: true }));

function render(overrides: Record<string, unknown> = {}) {
  mocks.gestures.length = 0;
  mocks.haptic.mockClear();
  const props = { activities, hidden: false, onChoose: vi.fn(), onTap: vi.fn(), reduceMotion: false, running: false, theme, ...overrides };
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<PlayOrb {...props} />);
  });
  const hold = () => mocks.gestures.filter((g) => g.kind === "pan").at(-1);
  const tap = () => mocks.gestures.filter((g) => g.kind === "tap").at(-1);
  const bloom = () => tree.root.findAllByProps({ testID: "play-orb-bloom" })[0] as ReactTestInstance | undefined;
  return { bloom, hold, props, tap, tree };
}

describe("playOrbSupported", () => {
  it("offers the orb only on iPhone with iOS 26 or later", async () => {
    const { playOrbSupported } = await import("../../lib/playOrb");
    expect(playOrbSupported({ OS: "ios", Version: "26.5" })).toBe(true);
    expect(playOrbSupported({ OS: "ios", Version: "18.6" })).toBe(false);
    expect(playOrbSupported({ OS: "ios", Version: "26.0", isPad: true })).toBe(false);
    expect(playOrbSupported({ OS: "android", Version: 35 })).toBe(false);
  });
});

describe("playOrbFrame", () => {
  it("centres the orb on the tab bar's trailing slot", () => {
    expect(playOrbFrame({ bottomInset: 34, height: 874, width: 402 })).toEqual({ left: 402 - 52.5 - 32, top: 874 - 53 - 32 });
  });
});

describe("orbRingPath", () => {
  it("starts at 12 o'clock and runs clockwise through 6 o'clock back to the top", () => {
    // y grows downwards: the top is (c, c - r); sweep flag 1 is clockwise on screen.
    expect(orbRingPath(30, 26.5)).toBe("M30 3.5 A26.5 26.5 0 1 1 30 56.5 A26.5 26.5 0 1 1 30 3.5");
  });
});

describe("orbRingProgress", () => {
  it("is the block's elapsed seconds into its minute, over 60", () => {
    expect(orbRingProgress(0)).toBe(0);
    expect(orbRingProgress(45 * 60)).toBe(0);
    expect(orbRingProgress(45 * 60 + 15)).toBe(15 / 60);
    expect(orbRingProgress(59)).toBe(59 / 60);
    expect(orbRingProgress(60)).toBe(0);
    expect(orbRingProgress(125.9)).toBe(5 / 60);
  });
});

describe("PlayOrb", () => {
  it("taps to start or stop, and shows the seconds ring only while running", () => {
    const idle = render();
    expect(idle.tree.root.findAllByProps({ testID: "play-orb-ring" })).toHaveLength(0);
    act(() => idle.tap().handlers.onEnd({}, true));
    expect(idle.props.onTap).toHaveBeenCalledOnce();
    act(() => idle.tree.unmount());

    vi.useFakeTimers();
    // The block's seconds, not the wall clock's: started at :07, it is 45:08 in at 21:00:15.
    vi.setSystemTime(new Date("2026-10-07T21:00:15"));
    const running = render({ running: true, runningDurationSeconds: 0, runningStartedAt: new Date("2026-10-07T20:15:07").toISOString() });
    const ring = running.tree.root.findByProps({ testID: "play-orb-ring" });
    const circumference = 2 * Math.PI * (PLAY_ORB.size / 2 + 5 - 1.5);
    expect(ring.props.strokeDasharray).toBe(`${(8 / 60) * circumference} ${circumference}`);
    // The zero point is 12 o'clock in the path itself, with no transform for the renderer to apply.
    const radius = PLAY_ORB.size / 2 + 5 - 1.5;
    const center = PLAY_ORB.size / 2 + 5;
    expect(ring.props.d).toBe(orbRingPath(center, radius));
    expect(ring.props.d.startsWith(`M${center} ${center - radius} `)).toBe(true);
    expect(ring.props.rotation).toBeUndefined();
    expect(ring.props.origin).toBeUndefined();
    expect(ring.props.transform).toBeUndefined();
    act(() => running.tree.unmount());
    vi.useRealTimers();
  });

  it("is empty when the live block reads :00, whatever the wall clock's seconds (owner, TestFlight 121)", () => {
    vi.useFakeTimers();
    // Started 14:30:07; at 15:15:07 the live block reads 0:45:00.
    vi.setSystemTime(new Date("2026-10-15T15:15:07.000"));
    const startedAt = new Date("2026-10-15T14:30:07.000").toISOString();
    const running = render({ running: true, runningDurationSeconds: 0, runningStartedAt: startedAt });
    const circumference = 2 * Math.PI * (PLAY_ORB.size / 2 + 5 - 1.5);
    expect(running.tree.root.findByProps({ testID: "play-orb-ring" }).props.strokeDasharray).toBe(`0 ${circumference}`);
    act(() => running.tree.unmount());
    vi.useRealTimers();
  });

  it("steps with the block's own seconds: every tick shows (elapsed mod 60) / 60, one 1 s timer, no frame loop", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T15:15:07.400"));
    const startedAt = new Date("2026-10-15T14:30:07.000").toISOString();
    const running = render({ running: true, runningDurationSeconds: 0, runningStartedAt: startedAt });
    const circumference = 2 * Math.PI * (PLAY_ORB.size / 2 + 5 - 1.5);
    const shown = () => running.tree.root.findByProps({ testID: "play-orb-ring" }).props.strokeDasharray as string;
    const expected = () =>
      `${orbRingProgress(activeTimerElapsedSeconds({ durationSeconds: 0, startedAt }, Date.now())) * circumference} ${circumference}`;
    expect(shown()).toBe(expected());
    // The first tick lands just after the block's next whole second (:08 elapsed), then every second.
    act(() => {
        vi.advanceTimersByTime(600 + 15);
      });
    expect(shown()).toBe(`${(1 / 60) * circumference} ${circumference}`);
    for (let second = 0; second < 70; second += 1) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(shown()).toBe(expected());
    }
    expect(vi.getTimerCount()).toBe(1);
    act(() => running.tree.unmount());
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("agrees with the live block's seconds on every commit: uneven steps, a fresher Dashboard value, a clock set back (Codex r1 on #439)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T15:15:07.400"));
    const startedAt = new Date("2026-10-15T14:30:07.000").toISOString();
    const circumference = 2 * Math.PI * (PLAY_ORB.size / 2 + 5 - 1.5);
    const live: number[] = [];
    function LiveSeconds({ floor }: { floor: number }) {
      const elapsed = useLiveBlockElapsed({ durationSeconds: 0, elapsedLabel: "", elapsedSeconds: floor, hasLiveActiveTimer: true, startedAt });
      live.push(elapsed.seconds);
      return null;
    }
    // The Dashboard hands both the same presentation, as it does the live block and the orb.
    function Pair({ floor }: { floor: number }) {
      const props = { activities, hidden: false, onChoose: vi.fn(), onTap: vi.fn(), reduceMotion: false, running: true, runningDurationSeconds: 0, runningElapsedSeconds: floor, runningStartedAt: startedAt, theme };
      return (
        <>
          <LiveSeconds floor={floor} />
          <PlayOrb {...props} />
        </>
      );
    }
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Pair floor={0} />);
    });
    const ring = () => tree.root.findByProps({ testID: "play-orb-ring" }).props.strokeDasharray as string;
    const agrees = () => expect(ring()).toBe(`${orbRingProgress(live.at(-1)!) * circumference} ${circumference}`);
    for (const step of [333, 333, 334, 17, 983, 500, 499, 1, 2000, 250, 61_000]) {
      act(() => {
        vi.advanceTimersByTime(step);
      });
      agrees();
    }
    // A Dashboard refresh lands inside the 15 ms before the anchored tick, with the next second already in.
    act(() => {
      vi.advanceTimersByTime(1000 - (Date.now() - Date.parse(startedAt)) % 1000 + 5);
    });
    const fresher = Math.floor((Date.now() - Date.parse(startedAt)) / 1000);
    act(() => tree.update(<Pair floor={fresher} />));
    agrees();
    expect(live.at(-1)).toBe(fresher);
    // The clock is set back 30 s: both keep the Dashboard's later value.
    vi.setSystemTime(Date.now() - 30_000);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    agrees();
    act(() => tree.unmount());
    vi.useRealTimers();
  });

  it("holds the Stop flight ghost's time while Stop is saved, and counts on if the Stop is rolled back (Codex r1 on #439)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T15:15:07.400"));
    const startedAt = new Date("2026-10-15T14:30:07.000").toISOString();
    const circumference = 2 * Math.PI * (PLAY_ORB.size / 2 + 5 - 1.5);
    const base = { running: true, runningDurationSeconds: 0, runningElapsedSeconds: 0, runningStartedAt: startedAt };
    const orb = render({ ...base, runningHeldSeconds: 45 * 60 });
    const ring = () => orb.tree.root.findByProps({ testID: "play-orb-ring" }).props.strokeDasharray as string;
    for (let second = 0; second < 3; second += 1) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(ring()).toBe(`0 ${circumference}`);
    }
    // Rolled back: the flight clears and the ring shows the block's seconds again (now 45:03).
    act(() => orb.tree.update(<PlayOrb {...orb.props} {...base} runningHeldSeconds={undefined} />));
    expect(ring()).toBe(`${(3 / 60) * circumference} ${circumference}`);
    act(() => orb.tree.unmount());
    vi.useRealTimers();
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
    // Hit-testing is in window points, from the orb's centre on the tab bar's trailing slot.
    const frame = playOrbFrame({ bottomInset: 34, height: 874, width: 402 });
    const centerX = frame.left + PLAY_ORB.size / 2;
    const centerY = frame.top + PLAY_ORB.size / 2;
    act(() => hold().handlers.onUpdate({ absoluteX: centerX + first.dx, absoluteY: centerY + first.dy, translationX: first.dx, translationY: first.dy }));
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

  it("blurs what's behind the bloom, and falls back to a plain, darker scrim under Reduce Transparency (Trello 211)", () => {
    for (const reduceTransparency of [false, true]) {
      mocks.reduceTransparency = reduceTransparency;
      const { hold, tree } = render({ running: false });
      act(() => {
        hold().handlers.onStart({});
        hold().handlers.onEnd({}, true);
      });
      const blur = tree.root.findAll((node) => node.props.testID === "play-orb-blur");
      expect(blur).toHaveLength(reduceTransparency ? 0 : 1);
      if (!reduceTransparency) expect(blur[0].props).toMatchObject({ pointerEvents: "none", tint: expect.any(String) });
      const scrim = tree.root.findByProps({ testID: "play-orb-scrim" });
      const color = (scrim.props.style as Array<{ backgroundColor?: string }>)[1].backgroundColor;
      expect(color).toMatch(reduceTransparency ? /0\.(8|7)\)$/ : /0\.(66|55)\)$/);
      act(() => tree.unmount());
    }
    mocks.reduceTransparency = false;
  });

  it("closes without choosing when the finger slides away or the system cancels the hold", () => {
    const { bloom, hold, props, tree } = render();
    act(() => {
      hold().handlers.onStart({});
      hold().handlers.onUpdate({ absoluteX: 320, absoluteY: 800, translationX: -30, translationY: -20 });
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
