import { useEffect, useState } from "react";
import { act, create, type ReactTestInstance } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The toast's whole presence as Reanimated 4.3 runs it on one view (Codex r4 on #532): the
 * `entering`, `layout` and `exiting` functions BlocksToast actually renders, played through a port
 * of `layoutReanimation/animationsManager.ts` and `withStyleAnimation`'s start values. What matters
 * is reproduced exactly: one animation per view; a new one merges the running one's tracks into it
 * (`{ ...previous, ...next }`) and replaces its completion (the old one only hears `false`); a
 * track with no start value continues from the running animation's live value, if there is one;
 * and once the view's animation finishes the manager forgets its values, so a later animation
 * starts from its own initial values alone (a missing one is undefined, so its frames are NaN).
 */

vi.mock("react", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  return import("../../../../../node_modules/react/index.js");
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("react-native", () => ({
  AccessibilityInfo: { announceForAccessibility: () => undefined },
  Animated: {},
  Easing: {},
  Pressable: "Pressable",
  StyleSheet: { create: <T,>(value: T) => value },
  Text: "Text",
  View: "View"
}));
// Animations are plain tracks ({ to, duration }); the manager below plays them. A shared value
// keeps its identity across renders, as Reanimated's does.
vi.mock("react-native-reanimated", async () => {
  // @ts-expect-error The renderer peer React is installed at the repository root.
  const React = (await import("../../../../../node_modules/react/index.js")) as typeof import("react");
  return {
    default: { View: "ReanimatedView" },
    Easing: { in: (curve: unknown) => curve, quad: "quad" },
    ReduceMotion: { Always: "always", Never: "never", System: "system" },
    cancelAnimation: () => undefined,
    useAnimatedStyle: () => ({}),
    useSharedValue: (value: unknown) => React.useState(() => ({ value }))[0],
    withDelay: (_delay: number, animation: unknown) => animation,
    withRepeat: (animation: unknown) => animation,
    withSequence: (...animations: unknown[]) => animations[0],
    withSpring: (to: number) => ({ duration: 400, to }),
    withTiming: (to: number, config?: { duration?: number }) => ({ duration: config?.duration ?? 300, to })
  };
});
vi.mock("../../lib/appForeground", () => ({ useAppForeground: () => true }));
vi.mock("../../lib/motion", () => ({
  MOBILE_MOTION: { control: 140, layout: 220 },
  // What `LinearTransition.duration(220)` builds without `.withCallback` (the toast's layout
  // before r4), so this file also runs against that version of BlocksToast.
  localLayoutTransition: (reduceMotion: boolean) => (values: Record<string, number>) => ({
    initialValues: { originX: values.currentOriginX, originY: values.currentOriginY, width: values.currentWidth, height: values.currentHeight },
    animations: {
      originX: { duration: reduceMotion ? 0 : 220, to: values.targetOriginX },
      originY: { duration: reduceMotion ? 0 : 220, to: values.targetOriginY },
      width: { duration: reduceMotion ? 0 : 220, to: values.targetWidth },
      height: { duration: reduceMotion ? 0 : 220, to: values.targetHeight }
    },
    callback: undefined
  }),
  localPresenceEntering: () => ({ kind: "contentFade" })
}));
vi.mock("../../lib/mobileTypography", () => ({ MOBILE_TEXT_CAP: { control: 1.3 }, mobileTextProps: () => ({}) }));

const { BLOCKS_TOAST_DURATION_MS, BlocksToast } = await import("./BlocksToast");
const motion = await import("../../lib/motion");
const { blocksToastEntering, blocksToastExiting } = await import("../../lib/blocksMotion");

type Track = { duration: number; to: number };
type Style = { initialValues: Record<string, unknown>; animations: Record<string, unknown>; callback?: (finished: boolean) => void };
type Config = (values: Record<string, number>) => Style;
type Running = { from: number | undefined; to: number; duration: number; elapsed: number };

/** Leaf paths of a style object: `opacity`, `transform.0.translateY`, … */
function leaves(value: unknown, path = ""): Array<[string, unknown]> {
  if (Array.isArray(value)) return value.flatMap((item, index) => leaves(item, `${path}${index}.`));
  if (value && typeof value === "object" && !("to" in value)) {
    return Object.entries(value).flatMap(([key, item]) => leaves(item, `${path}${key}.`));
  }
  return [[path.slice(0, -1), value]];
}

const liveValue = (track: Running) =>
  track.elapsed >= track.duration ? track.to : (track.from as number) + (track.to - (track.from as number)) * (track.elapsed / track.duration);

/** One view's layout animations, as Reanimated's manager keeps them for its tag. */
class ViewAnimations {
  private running: { top: Record<string, unknown>; tracks: Map<string, Running>; callback?: (finished: boolean) => void } | null = null;

  /** Starts an animation and returns each track's starting value. */
  start(config: Config, values: Record<string, number>) {
    const style = config(values);
    const previous = this.running;
    const top = previous ? { ...previous.top, ...style.animations } : style.animations;
    const initial = new Map(leaves(style.initialValues));
    const tracks = new Map<string, Running>();
    for (const [path, track] of leaves(top) as Array<[string, Track]>) {
      let from = initial.get(path) as number | undefined;
      const previousTrack = previous?.tracks.get(path);
      if (previousTrack && !from) from = liveValue(previousTrack);
      tracks.set(path, { duration: track.duration, elapsed: 0, from, to: track.to });
    }
    this.running = { callback: style.callback, top, tracks };
    // The replaced animation is cancelled: its completion hears `false`.
    previous?.callback?.(false);
    return Object.fromEntries([...tracks].map(([path, track]) => [path, track.from]));
  }

  advance(ms: number) {
    const running = this.running;
    if (!running) return;
    for (const track of running.tracks.values()) track.elapsed += ms;
    if ([...running.tracks.values()].every((track) => track.elapsed >= track.duration)) {
      // Finished: the manager forgets the view's values, then reports completion.
      this.running = null;
      running.callback?.(true);
    }
  }

  values() {
    return Object.fromEntries([...(this.running?.tracks ?? [])].map(([path, track]) => [path, liveValue(track)]));
  }
}

const frame = (height: number, targetHeight = height) => ({
  currentHeight: height, currentOriginX: 20, currentOriginY: 700 - height, currentWidth: 335,
  targetHeight, targetOriginX: 20, targetOriginY: 700 - targetHeight, targetWidth: 335
});

/** The Today delete toast's owner, reduced: 5 s, Undo, the words changing under the same key. */
function Owner({ message, reduceMotion }: { message: string; reduceMotion: boolean }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setOpen(false), BLOCKS_TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!open) return null;
  return (
    <BlocksToast actionLabel="Undo" actionTestID="toast-undo" key="delete-1" message={message}
      onAction={() => setOpen(false)} reduceMotion={reduceMotion} testID="toast" theme={theme} />
  );
}

const theme = { background: "#050914", shadow: "shadow", textMuted: "muted", textPrimary: "#F7F8FB" } as never;

let tree: ReturnType<typeof create> | undefined;
afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
  vi.useRealTimers();
});

const pill = () => tree!.root.findAll((node: ReactTestInstance) => (node.type as unknown) === "ReanimatedView")[0];
const mounted = () => tree!.root.findAll((node: ReactTestInstance) => (node.type as unknown) === "ReanimatedView").length > 0;

type Exit = "timeout" | "undo";

/**
 * Mounts the toast, plays its entrance for `beforeUpdateMs`, changes its words to a taller,
 * wrapping title (52 → 69 points at a large text size), plays `afterUpdateMs` more, then ends it
 * by the timeout or by Undo. Returns the exit's starting values.
 */
function play({ afterUpdateMs, beforeUpdateMs = 40, exit, reduceMotion }: { afterUpdateMs: number; beforeUpdateMs?: number; exit: Exit; reduceMotion: boolean }) {
  vi.useFakeTimers();
  const view = new ViewAnimations();
  act(() => { tree = create(<Owner message="Deleted 2 blocks" reduceMotion={reduceMotion} />); });
  view.start(pill().props.entering as Config, frame(52));
  view.advance(beforeUpdateMs);
  act(() => tree!.update(<Owner message="Deleted Deep work, the long morning planning block" reduceMotion={reduceMotion} />));
  const layout = pill().props.layout as Config | undefined;
  // Native layout reports the new frame; Reanimated starts the view's layout transition, if any.
  if (layout) view.start(layout, frame(52, 69));
  view.advance(afterUpdateMs);
  const live = view.values();
  const exiting = pill().props.exiting as Config;
  if (exit === "timeout") act(() => { vi.advanceTimersByTime(BLOCKS_TOAST_DURATION_MS); });
  else act(() => pill().findByProps({ testID: "toast-undo" }).props.onPress());
  expect(mounted()).toBe(false);
  const start = view.start(exiting, frame(69));
  return { live, start };
}

const finite = (start: Record<string, unknown>) =>
  Object.entries(start).filter(([, value]) => !Number.isFinite(value)).map(([path]) => path);

describe("BlocksToast's presence through a content update (Codex r4 on #532)", () => {
  it("the simulated manager reproduces the reported fault: a layout transition with no settling completion strands the exit", () => {
    // The pre-r4 toast: entering + `localLayoutTransition` on the pill.
    const phase = { value: "entering" as "entering" | "fading" | "settled" };
    const view = new ViewAnimations();
    view.start(blocksToastEntering(false, phase) as unknown as Config, frame(52));
    view.advance(40);
    view.start(motion.localLayoutTransition(false) as unknown as Config, frame(52, 69));
    view.advance(1_000);
    expect(phase.value).toBe("entering");
    const start = view.start(blocksToastExiting(false, phase) as unknown as Config, frame(69));
    expect(finite(start).sort()).toEqual(["opacity", "transform.0.translateY", "transform.1.scale"]);
  });

  for (const reduceMotion of [false, true]) {
    const mode = reduceMotion ? "under Reduce Motion" : "with motion";
    for (const exit of ["timeout", "undo"] as const) {
      it(`${mode}: words changed mid-entrance, then the ${exit} exit starts from rest once everything has settled`, () => {
        const { start } = play({ afterUpdateMs: 1_000, exit, reduceMotion });
        expect(finite(start)).toEqual([]);
        expect(start.opacity).toBe(1);
        expect(start["transform.0.translateY"]).toBe(0);
        expect(start["transform.1.scale"]).toBe(1);
      });

      it(`${mode}: words changed mid-entrance, then the ${exit} exit mid-way carries the live values`, () => {
        const { live, start } = play({ afterUpdateMs: 30, exit, reduceMotion });
        expect(finite(start)).toEqual([]);
        // Nothing jumps: the exit picks up the opacity where the entrance had got to.
        expect(start.opacity).toBe(live.opacity);
        expect(start.opacity as number).toBeLessThan(1);
      });
    }
  }

  it("a layout change after the entrance has settled leaves every exit start defined", () => {
    for (const afterUpdateMs of [100, 1_000]) {
      const { start } = play({ afterUpdateMs, beforeUpdateMs: 1_000, exit: "timeout", reduceMotion: false });
      expect(finite(start)).toEqual([]);
      expect(start.opacity).toBe(1);
      if (tree) act(() => tree!.unmount());
      tree = undefined;
      vi.useRealTimers();
    }
  });
});
