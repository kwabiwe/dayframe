import { describe, expect, it, vi } from "vitest";

// Reanimated's builders, recorded so the toast's motion can be read without a native runtime.
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
vi.mock("react", () => ({ useEffect: () => undefined, useRef: (value: unknown) => ({ current: value }) }));

const { BLOCKS_SPRING, TOAST_MOTION, blocksToastEntering, blocksToastExiting } = await import("./blocksMotion");

describe("the Undo toast's motion (X4)", () => {
  it("pops in from below with the prototype's bouncy spring", () => {
    const enter = (blocksToastEntering(false) as unknown as () => { initialValues: unknown; animations: { transform: Array<Record<string, { spring: number; config: Record<string, unknown> }>> } })();
    expect(enter.initialValues).toEqual({ opacity: 0, transform: [{ translateY: 16 }, { scale: 0.96 }] });
    const [translate, scale] = enter.animations.transform;
    expect(translate.translateY.spring).toBe(0);
    expect(scale.scale.spring).toBe(1);
    expect(translate.translateY.config).toMatchObject({ stiffness: BLOCKS_SPRING.pop.stiffness, damping: BLOCKS_SPRING.pop.damping });
  });

  it("drops away in 160 ms", () => {
    const exit = (blocksToastExiting(false) as unknown as () => { animations: { opacity: { timing: number; config: { duration: number } } } })();
    expect(exit.animations.opacity).toMatchObject({ timing: 0, config: { duration: TOAST_MOTION.exitMs } });
  });

  it("only fades under Reduce Motion", () => {
    const enter = (blocksToastEntering(true) as unknown as () => { initialValues: Record<string, unknown>; animations: Record<string, unknown> })();
    const exit = (blocksToastExiting(true) as unknown as () => { initialValues: Record<string, unknown>; animations: Record<string, unknown> })();
    expect(Object.keys(enter.initialValues)).toEqual(["opacity"]);
    expect(Object.keys(enter.animations)).toEqual(["opacity"]);
    expect(Object.keys(exit.animations)).toEqual(["opacity"]);
  });
});
