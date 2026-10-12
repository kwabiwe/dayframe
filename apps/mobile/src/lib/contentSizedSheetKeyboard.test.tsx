import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../node_modules/react/index.js");
});

type Listener = (event: { duration?: number; endCoordinates: { height: number; screenY: number } }) => void;
const keyboard = vi.hoisted(() => ({ listeners: new Map<string, Set<Listener>>() }));
vi.mock("react-native", () => ({
  Dimensions: { get: () => ({ height: 844, width: 390 }) },
  Keyboard: {
    addListener: (name: string, listener: Listener) => {
      const set = keyboard.listeners.get(name) ?? new Set<Listener>();
      set.add(listener);
      keyboard.listeners.set(name, set);
      return { remove: () => set.delete(listener) };
    }
  },
  Platform: { OS: "ios" }
}));
type Timing = { callback?: (finished: boolean) => void; to: number };
const timings = vi.hoisted(() => [] as Timing[]);
const space = vi.hoisted(() => ({ shared: null as null | { value: unknown } }));
vi.mock("react-native-reanimated", () => ({
  Easing: { bezier: () => "keyboard-curve" },
  cancelAnimation: vi.fn(),
  runOnJS: (fn: (...args: unknown[]) => void) => fn,
  useAnimatedStyle: (factory: () => unknown) => factory(),
  useSharedValue: (initial: unknown) => {
    if (!space.shared) space.shared = { value: initial };
    return space.shared;
  },
  withTiming: (to: number, _config: unknown, callback?: (finished: boolean) => void) => {
    const timing = { callback, to };
    timings.push(timing);
    return timing;
  }
}));

const { useContentSizedSheetKeyboard } = await import("./contentSizedSheetKeyboard");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let frames: Array<() => void> = [];
beforeEach(() => {
  frames = [];
  timings.length = 0;
  space.shared = null;
  keyboard.listeners.clear();
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    frames.push(callback);
    return frames.length;
  });
});
afterEach(() => vi.unstubAllGlobals());

function flushFrames() {
  for (let i = 0; i < 4 && frames.length; i += 1) {
    const pending = frames;
    frames = [];
    act(() => pending.forEach((frame) => frame()));
  }
}

function emit(name: string, inset: number, duration = 250) {
  act(() => {
    for (const listener of keyboard.listeners.get(name) ?? []) {
      listener({ duration, endCoordinates: { height: inset, screenY: 844 - inset } });
    }
  });
}

function mount(reduceMotion = false) {
  const onReveal = vi.fn();
  const seen = {} as ReturnType<typeof useContentSizedSheetKeyboard>;
  function Probe() {
    Object.assign(seen, useContentSizedSheetKeyboard({ bottomInset: 34, onReveal, reduceMotion, windowHeight: 844 }));
    return null;
  }
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<Probe />); });
  return { onReveal, seen, tree };
}

function finishTiming(index = timings.length - 1) {
  act(() => timings[index].callback?.(true));
}

describe("content-sized sheet keyboard (Apple Health type sheet; Codex r1–r2 on #355)", () => {
  it("engages the sheet's hand-off on the first keyboard frame and reveals Name when the space settles", () => {
    const { onReveal, seen, tree } = mount();
    expect(seen.keyboardInset).toBe(0);
    emit("keyboardWillChangeFrame", 336);
    expect(seen.keyboardInset).toBe(336);
    expect(timings.at(-1)?.to).toBe(310);
    expect(onReveal).not.toHaveBeenCalled();
    finishTiming();
    expect(onReveal).toHaveBeenCalledTimes(1);
    tree.unmount();
  });

  it("keeps the hand-off engaged until the keyboard has gone and the space has settled (space first)", () => {
    const { seen, tree } = mount();
    emit("keyboardWillChangeFrame", 336);
    finishTiming();
    emit("keyboardWillHide", 0);
    expect(timings.at(-1)?.to).toBe(0);
    expect(seen.keyboardInset).toBe(336);
    finishTiming();
    expect(seen.keyboardInset).toBe(336);
    emit("keyboardDidHide", 0);
    expect(seen.keyboardInset).toBe(0);
    tree.unmount();
  });

  it("keeps the hand-off engaged until the space has settled when the keyboard goes first", () => {
    const { seen, tree } = mount();
    emit("keyboardWillChangeFrame", 336);
    finishTiming();
    emit("keyboardWillHide", 0);
    emit("keyboardDidHide", 0);
    expect(seen.keyboardInset).toBe(336);
    finishTiming();
    expect(seen.keyboardInset).toBe(0);
    tree.unmount();
  });

  it("re-engages when the keyboard comes back while it was leaving; a cancelled shrink never releases", () => {
    const { seen, tree } = mount();
    emit("keyboardWillChangeFrame", 336);
    finishTiming();
    emit("keyboardWillHide", 0);
    const shrink = timings.length - 1;
    emit("keyboardWillChangeFrame", 336);
    act(() => timings[shrink].callback?.(false));
    expect(seen.keyboardInset).toBe(336);
    expect(timings.at(-1)?.to).toBe(310);
    tree.unmount();
  });

  it("under Reduce Motion moves the space at once, reveals Name after the layout, and still waits for didHide", () => {
    const { onReveal, seen, tree } = mount(true);
    // A didShow-only keyboard (no frame change first).
    emit("keyboardDidShow", 336);
    expect(space.shared?.value).toBe(310);
    expect(timings).toHaveLength(0);
    expect(onReveal).not.toHaveBeenCalled();
    act(() => seen.onScrollLayout());
    expect(onReveal).toHaveBeenCalledTimes(1);
    flushFrames();
    expect(onReveal).toHaveBeenCalledTimes(2);
    emit("keyboardWillHide", 0);
    expect(space.shared?.value).toBe(0);
    expect(seen.keyboardInset).toBe(336);
    emit("keyboardDidHide", 0);
    expect(seen.keyboardInset).toBe(0);
    tree.unmount();
  });

  it("reveals Name after an immediate (zero-duration) keyboard frame too", () => {
    const { onReveal, tree } = mount();
    emit("keyboardDidShow", 336, 0);
    expect(timings).toHaveLength(0);
    expect(space.shared?.value).toBe(310);
    flushFrames();
    expect(onReveal).toHaveBeenCalledTimes(1);
    tree.unmount();
  });

  it("reveals again when the keyboard settles where the space already is, and never with the keyboard down", () => {
    const { onReveal, seen, tree } = mount();
    emit("keyboardWillChangeFrame", 336);
    finishTiming();
    expect(onReveal).toHaveBeenCalledTimes(1);
    emit("keyboardDidShow", 336);
    flushFrames();
    expect(onReveal).toHaveBeenCalledTimes(2);
    emit("keyboardWillHide", 0);
    act(() => seen.revealWhenSettled());
    act(() => seen.onScrollLayout());
    flushFrames();
    expect(onReveal).toHaveBeenCalledTimes(2);
    tree.unmount();
  });

  it("ignores a stale didHide that lands after the keyboard came back, and a stale didShow after a newer hide (Codex r3)", () => {
    const { onReveal, seen, tree } = mount();
    emit("keyboardWillChangeFrame", 336);
    finishTiming();
    emit("keyboardDidShow", 336);
    emit("keyboardWillHide", 0);
    // The keyboard is restored before the hide completes; the earlier hide's didHide lands late.
    emit("keyboardWillChangeFrame", 336);
    const grow = timings.length - 1;
    emit("keyboardDidHide", 0);
    expect(timings).toHaveLength(grow + 1);
    expect(timings.at(-1)?.to).toBe(310);
    expect(seen.keyboardInset).toBe(336);
    const reveals = onReveal.mock.calls.length;
    finishTiming(grow);
    expect(onReveal).toHaveBeenCalledTimes(reveals + 1);
    // Now hide for real; a didShow from the earlier show lands late and is ignored.
    emit("keyboardWillHide", 0);
    emit("keyboardDidShow", 336);
    expect(timings.at(-1)?.to).toBe(0);
    finishTiming();
    emit("keyboardDidHide", 0);
    expect(seen.keyboardInset).toBe(0);
    tree.unmount();
  });
});
