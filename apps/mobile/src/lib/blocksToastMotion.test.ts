import { describe, expect, it, vi } from "vitest";

// Reanimated's builders, recorded so the toast's motion can be read without a native runtime.
vi.mock("./appForeground", () => ({ useAppForeground: () => true }));
vi.mock("react-native-reanimated", () => ({
  Easing: { in: (curve: unknown) => ({ in: curve }), quad: "quad" },
  ReduceMotion: { Never: "never" },
  cancelAnimation: () => undefined,
  useAnimatedStyle: () => ({}),
  useSharedValue: (value: unknown) => ({ value }),
  withDelay: (_delay: number, animation: unknown) => animation,
  withRepeat: (animation: unknown) => animation,
  withSequence: (...animations: unknown[]) => animations,
  withSpring: (to: number, config: unknown) => ({ spring: to, config }),
  withTiming: (to: number, config: unknown) => ({ timing: to, config })
}));

vi.mock("./motion", () => ({ MOBILE_MOTION: { control: 160, layout: 220 } }));
// blocksMotion's breathing ring uses React Native's Animated; the toast does not.
vi.mock("react-native", () => ({ Animated: {}, Easing: {} }));
vi.mock("react", () => ({ useEffect: () => undefined, useRef: (value: unknown) => ({ current: value }) }));

const { BLOCKS_SPRING, TOAST_MOTION, blocksToastEntering, blocksToastExiting } = await import("./blocksMotion");

type Config = { initialValues: Record<string, unknown>; animations: Record<string, unknown>; callback?: (finished: boolean) => void };
const settledValue = () => ({ value: "entering" as "entering" | "fading" | "settled" });

/**
 * Reanimated 4's layout-animation manager, reduced to what decides an exit's starting values: a
 * view whose entrance is still running keeps its live values (the exit's empty start merges into
 * them); once the entrance finishes the manager forgets them and the exit starts from its own
 * initial values alone.
 */
function playToast(reduceMotion: boolean, entranceFinishedBeforeExit: boolean, exitReduceMotion = reduceMotion) {
  const settled = settledValue();
  const enter = (blocksToastEntering(reduceMotion, settled) as unknown as () => Config)();
  const live: Record<string, unknown> = { ...enter.initialValues };
  if (entranceFinishedBeforeExit) {
    enter.callback?.(true);
    for (const key of Object.keys(live)) delete live[key];
  } else {
    enter.callback?.(false);
  }
  const exit = (blocksToastExiting(exitReduceMotion, settled) as unknown as () => Config)();
  const start = { ...live, ...exit.initialValues };
  return { exit, start };
}

describe("the Undo toast's motion (X4)", () => {
  it("pops in from below with the prototype's bouncy spring", () => {
    const enter = (blocksToastEntering(false, settledValue()) as unknown as () => { initialValues: unknown; animations: { transform: Array<Record<string, { spring: number; config: Record<string, unknown> }>> } })();
    expect(enter.initialValues).toEqual({ opacity: 0, transform: [{ translateY: 16 }, { scale: 0.96 }] });
    const [translate, scale] = enter.animations.transform;
    expect(translate.translateY.spring).toBe(0);
    expect(scale.scale.spring).toBe(1);
    expect(translate.translateY.config).toMatchObject({ stiffness: BLOCKS_SPRING.pop.stiffness, damping: BLOCKS_SPRING.pop.damping });
  });

  it("exits from wherever the toast is mid-entrance, replacing the entrance springs (Codex r1)", () => {
    const { exit, start } = playToast(false, false);
    expect(exit.initialValues).toEqual({});
    // The live entrance values carry into the exit: nothing jumps back to rest.
    expect(start.opacity).toBe(0);
    expect(Object.keys(exit.animations).sort()).toEqual(["opacity", "transform"]);
    // A Reduce Motion entrance carries its live opacity; the transform it never had starts at rest.
    const fading = playToast(true, false);
    expect(fading.exit.initialValues).toEqual({ transform: [{ translateY: 0 }, { scale: 1 }] });
    expect(fading.start.opacity).toBe(0);
    const reduced = (blocksToastExiting(true, settledValue()) as unknown as () => { animations: { transform: Array<Record<string, { timing: number; config: { duration: number } }>> } })();
    // The transform settles at once; only opacity animates.
    expect(reduced.animations.transform.map((track) => Object.values(track)[0].config.duration)).toEqual([0, 0]);
  });

  it("exits from rest after the entrance has finished, every animated value defined (Codex r2)", () => {
    for (const reduceMotion of [false, true]) {
      const { exit, start } = playToast(reduceMotion, true);
      expect(start).toEqual({ opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] });
      for (const key of Object.keys(exit.animations)) expect(start[key]).toBeDefined();
      const tracks = (start.transform as Array<Record<string, number>>).map((track) => Object.values(track)[0]);
      expect(tracks.every(Number.isFinite)).toBe(true);
    }
  });

  it("starts every exit track defined when Reduce Motion changes mid-entrance, either way (Codex r3)", () => {
    for (const [enter, exit] of [[true, false], [false, true]] as const) {
      const { exit: config, start } = playToast(enter, false, exit);
      for (const key of Object.keys(config.animations)) expect(start[key]).toBeDefined();
      const tracks = (start.transform as Array<Record<string, number>>).map((track) => Object.values(track)[0]);
      expect(tracks.every(Number.isFinite)).toBe(true);
    }
  });

  it("a new entrance forgets that an earlier one finished", () => {
    const settled = settledValue();
    const first = (blocksToastEntering(false, settled) as unknown as () => Config)();
    first.callback?.(true);
    expect(settled.value).toBe("settled");
    (blocksToastEntering(false, settled) as unknown as () => Config)();
    expect(settled.value).toBe("entering");
    (blocksToastEntering(true, settled) as unknown as () => Config)();
    expect(settled.value).toBe("fading");
  });

  it("drops away in 160 ms", () => {
    const exit = (blocksToastExiting(false, settledValue()) as unknown as () => { animations: { opacity: { timing: number; config: { duration: number } } } })();
    expect(exit.animations.opacity).toMatchObject({ timing: 0, config: { duration: TOAST_MOTION.exitMs } });
  });

  it("only fades under Reduce Motion", () => {
    const enter = (blocksToastEntering(true, settledValue()) as unknown as () => { initialValues: Record<string, unknown>; animations: Record<string, unknown> })();
    expect(Object.keys(enter.initialValues)).toEqual(["opacity"]);
    expect(Object.keys(enter.animations)).toEqual(["opacity"]);
  });
});
