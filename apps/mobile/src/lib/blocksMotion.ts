import { useEffect, useRef, useState } from "react";
import { Animated, Easing as NativeEasing } from "react-native";
import {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type LayoutAnimationsValues,
} from "react-native-reanimated";
import { useAppForeground } from "./appForeground";
import { MOBILE_MOTION } from "./motion";

// Dayframe Blocks springs (.codex/reference/motion.md). Starting values from the prototype; tune on a physical iPhone.
export const BLOCKS_SPRING = {
  /** Start, stop, log, restore and delete: one small overshoot. */
  land: { stiffness: 320, damping: 21, mass: 1 },
  /** Controls and thumbs settle without visible overshoot. */
  control: { stiffness: 560, damping: 38, mass: 1 },
  /** Sheets and panels settle without visible overshoot. */
  sheet: { stiffness: 340, damping: 34, mass: 1 },
  /** Small celebratory pops: a row block or icon confirming a change. */
  pop: { stiffness: 420, damping: 18, mass: 1 },
  /** Odometer digits on the live timer. */
  roll: { stiffness: 260, damping: 26, mass: 1 },
} as const;

/**
 * The Undo toast (prototype DF.toast): it pops in from 16 points below at 96 % with the bouncy
 * `pop` spring and leaves in 160 ms (down 10 points, 98 %). Reduce Motion: opacity only, 90 ms in
 * and 70 ms out. Reanimated layout animations, so the toast's own mount and unmount own the motion.
 */
export const TOAST_MOTION = {
  enterFrom: { translateY: 16, scale: 0.96 },
  enterOpacityMs: 120,
  exitMs: 160,
  exitTo: { translateY: 10, scale: 0.98 },
  reducedEnterMs: 90,
  reducedExitMs: 70,
} as const;

/**
 * Where this toast's entrance is: a shared value owned by the toast (see BlocksToast). "fading" is
 * a Reduce Motion entrance, which animates opacity only, so it has no live transform to carry.
 */
export type ToastPhase = { value: "entering" | "fading" | "settled" };

/** Where the toast rests once its entrance has finished: the exit's start when nothing is running. */
const TOAST_REST = { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] };

export function blocksToastEntering(reduceMotion: boolean, phase: ToastPhase) {
  const callback = (finished: boolean) => {
    "worklet";
    if (finished) phase.value = "settled";
  };
  if (reduceMotion) {
    return () => {
      "worklet";
      phase.value = "fading";
      return {
        initialValues: { opacity: 0 },
        animations: { opacity: withTiming(1, { duration: TOAST_MOTION.reducedEnterMs, reduceMotion: ReduceMotion.Never }) },
        callback,
      };
    };
  }
  return () => {
    "worklet";
    phase.value = "entering";
    const spring = { ...BLOCKS_SPRING.pop, reduceMotion: ReduceMotion.Never };
    return {
      initialValues: {
        opacity: 0,
        transform: [{ translateY: TOAST_MOTION.enterFrom.translateY }, { scale: TOAST_MOTION.enterFrom.scale }],
      },
      animations: {
        opacity: withTiming(1, { duration: TOAST_MOTION.enterOpacityMs, reduceMotion: ReduceMotion.Never }),
        transform: [{ translateY: withSpring(0, spring) }, { scale: withSpring(1, spring) }],
      },
      callback,
    };
  };
}

/**
 * The exit's starting values. While the entrance is still running, Reanimated carries its current
 * values into the exit, so a toast replaced or undone mid-entrance never jumps back to rest first:
 * none are given for what the entrance animates. Everything else starts at rest: once the entrance
 * has finished Reanimated has dropped its values, and a Reduce Motion entrance (opacity only) has
 * no transform to carry if the setting changes before the exit. An empty start animates from nothing.
 */
export function toastExitStart(phase: ToastPhase) {
  "worklet";
  const transform = TOAST_REST.transform.map((track) => ({ ...track }));
  if (phase.value === "entering") return {};
  if (phase.value === "fading") return { transform };
  return { opacity: TOAST_REST.opacity, transform };
}

/**
 * The exit replaces the entrance's animations, so nothing from the entrance keeps running.
 * Reduce Motion settles the transform at once and fades.
 */
export function blocksToastExiting(reduceMotion: boolean, phase: ToastPhase) {
  if (reduceMotion) {
    return () => {
      "worklet";
      const settle = { duration: 0, reduceMotion: ReduceMotion.Never };
      return {
        initialValues: toastExitStart(phase),
        animations: {
          opacity: withTiming(0, { duration: TOAST_MOTION.reducedExitMs, reduceMotion: ReduceMotion.Never }),
          transform: [{ translateY: withTiming(0, settle) }, { scale: withTiming(1, settle) }],
        },
      };
    };
  }
  return () => {
    "worklet";
    const timing = { duration: TOAST_MOTION.exitMs, easing: Easing.in(Easing.quad), reduceMotion: ReduceMotion.Never };
    return {
      initialValues: toastExitStart(phase),
      animations: {
        opacity: withTiming(0, timing),
        transform: [{ translateY: withTiming(TOAST_MOTION.exitTo.translateY, timing) }, { scale: withTiming(TOAST_MOTION.exitTo.scale, timing) }],
      },
    };
  };
}

/**
 * The toast's own layout transition, for a content update while it stays mounted (a group delete's
 * "Deleted 2 blocks" becoming one block's name, maybe one line taller): its frame moves to the new
 * size in MOBILE_MOTION.layout from its anchored edge. It animates the frame only, never opacity or
 * the transform, which stay the entrance's and the exit's.
 *
 * Reanimated runs one animation per view: a layout change during the entrance merges into it and
 * replaces its completion, so the entrance's callback never reports `finished` (Codex r4 on #532).
 * When this merged animation finishes Reanimated forgets the toast's values all the same, so this
 * callback settles the phase too, and a later exit (timeout, Undo, replacement, unmount) starts from
 * rest rather than from values that no longer exist. Interrupted (`finished` false: an exit took
 * over), it leaves the phase alone, so the exit carries the live values as it does mid-entrance.
 *
 * Reduce Motion has no layout transition at all: the size settles at once and nothing can replace
 * the entrance's own completion.
 */
export function blocksToastLayout(reduceMotion: boolean, phase: ToastPhase) {
  if (reduceMotion) return undefined;
  return (values: LayoutAnimationsValues) => {
    "worklet";
    const timing = { duration: MOBILE_MOTION.layout, reduceMotion: ReduceMotion.Never };
    return {
      initialValues: {
        originX: values.currentOriginX,
        originY: values.currentOriginY,
        width: values.currentWidth,
        height: values.currentHeight,
      },
      animations: {
        originX: withTiming(values.targetOriginX, timing),
        originY: withTiming(values.targetOriginY, timing),
        width: withTiming(values.targetWidth, timing),
        height: withTiming(values.targetHeight, timing),
      },
      callback: (finished: boolean) => {
        "worklet";
        if (finished) phase.value = "settled";
      },
    };
  };
}

/** The live block's breathing ring: one opacity cycle of about 2.4 s. Nothing else loops. */
export const BREATHING_RING = { cycleMs: 2400, minOpacity: 0.14, maxOpacity: 0.5, reducedOpacity: 0.32 } as const;

/** How long a landing request stays valid; a request older than this is never replayed by a later mount. */
export const LANDING_REQUEST_TTL_MS = 1200;

export type LandingRequest = {
  /** Present when the landing belongs to Today rows (a stopped or restored entry); absent for the live block. */
  entryIds?: readonly string[];
  requestedAt: number;
  token: number;
};

/**
 * Plays the Blocks landing once per committed action. The token comes from the action handler
 * (Start, Stop), never from a refresh, so hydration, reconciliation and remounts do not replay it.
 */
export function useBlockLanding({
  delayMs = 0,
  distance,
  entryId,
  reduceMotion,
  request,
}: {
  delayMs?: number;
  distance: number;
  entryId?: string;
  reduceMotion: boolean;
  request: LandingRequest | null;
}) {
  // A request that is already due when this node mounts starts from its offset on the very first
  // frame, so the content never paints at rest and then jumps before the landing plays.
  const dueAtMount = useRef(landingIsDue(request, entryId)).current;
  // The token the mount decision used stays due in the effect even if the TTL lapses in between,
  // so the content can never be left parked at its offset.
  const mountToken = useRef(dueAtMount ? request?.token ?? null : null);
  const translateY = useSharedValue(dueAtMount && !reduceMotion ? distance : 0);
  const opacity = useSharedValue(dueAtMount && reduceMotion ? 0 : 1);
  const playedToken = useRef<number | null>(null);

  useEffect(() => {
    if (!request || playedToken.current === request.token) return;
    if (mountToken.current !== request.token && !landingIsDue(request, entryId)) return;
    playedToken.current = request.token;
    if (reduceMotion) {
      // Reduce Motion keeps the same state change with opacity only.
      translateY.value = 0;
      opacity.value = 0;
      opacity.value = withDelay(delayMs, withTiming(1, { duration: MOBILE_MOTION.control, reduceMotion: ReduceMotion.Never }));
      return;
    }
    opacity.value = 1;
    translateY.value = distance;
    translateY.value = withDelay(delayMs, withSpring(0, { ...BLOCKS_SPRING.land, reduceMotion: ReduceMotion.Never }));
  }, [delayMs, distance, entryId, opacity, reduceMotion, request, translateY]);

  useEffect(() => () => {
    cancelAnimation(translateY);
    cancelAnimation(opacity);
  }, [opacity, translateY]);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));
}

function landingIsDue(request: LandingRequest | null, entryId: string | undefined): request is LandingRequest {
  if (!request) return false;
  if (request.entryIds ? !entryId || !request.entryIds.includes(entryId) : entryId !== undefined) return false;
  return Date.now() - request.requestedAt <= LANDING_REQUEST_TTL_MS;
}

/**
 * Opacity-only breathing for the single live block; static under Reduce Motion, when not live, in the
 * background and while Today is covered (`paused`): every frame of the loop commits the view tree.
 */
export function useBreathingRing({
  live,
  paused = false,
  reduceMotion,
}: {
  live: boolean;
  paused?: boolean;
  reduceMotion: boolean;
}) {
  // React Native's native driver runs the loop on the UI thread, with no per-frame JS and no view-tree
  // commit (Reanimated committed the whole tree on every frame of this loop: iPhone 17, 13 Oct). The
  // result is the opacity for a React Native Animated.View.
  const [opacity] = useState(() => new Animated.Value(BREATHING_RING.reducedOpacity));
  // The loop breathes only while it can be seen; in the background it holds still (it otherwise
  // kept the display link running for as long as location kept the app alive).
  const foreground = useAppForeground();

  useEffect(() => {
    opacity.stopAnimation();
    if (!live) {
      const fade = Animated.timing(opacity, { duration: MOBILE_MOTION.control, toValue: 0, useNativeDriver: true });
      fade.start();
      return () => fade.stop();
    }
    if (reduceMotion || !foreground || paused) {
      opacity.setValue(BREATHING_RING.reducedOpacity);
      return undefined;
    }
    const half = BREATHING_RING.cycleMs / 2;
    const easing = NativeEasing.inOut(NativeEasing.sin);
    const to = (toValue: number) => Animated.timing(opacity, { duration: half, easing, toValue, useNativeDriver: true });
    // The first rise starts from wherever the ring held (its reduced opacity, or part-way through a
    // fade), so breathing resumes without a step down. The cycle after it starts and ends at the
    // maximum, and the loop does not reset the value between cycles (by default it would snap it back
    // to where the value began).
    const breathing = Animated.sequence([
      to(BREATHING_RING.maxOpacity),
      Animated.loop(Animated.sequence([to(BREATHING_RING.minOpacity), to(BREATHING_RING.maxOpacity)]), {
        iterations: -1,
        resetBeforeIteration: false,
      }),
    ]);
    breathing.start();
    return () => breathing.stop();
  }, [foreground, live, opacity, paused, reduceMotion]);

  return opacity;
}

/** How long a pop request stays valid; like a landing, it is never replayed by a later mount. */
export const POP_REQUEST_TTL_MS = 1200;
/** A popped block starts this much larger and springs back with `pop`. */
export const POP_FROM_SCALE = 1.5;

/**
 * Pops a Today row block once when the Stop flight lands on it (Blocks `pop` spring). The request
 * comes from the flight's completion, never from a refresh, so remounts and reconciliation never
 * replay it. Not used under Reduce Motion (the flight does not run).
 */
export function useBlockPop({ entryId, request }: { entryId: string; request: LandingRequest | null }) {
  const scale = useSharedValue(1);
  const playedToken = useRef<number | null>(null);

  useEffect(() => {
    if (!request || playedToken.current === request.token) return;
    if (!request.entryIds?.includes(entryId) || Date.now() - request.requestedAt > POP_REQUEST_TTL_MS) return;
    playedToken.current = request.token;
    scale.value = POP_FROM_SCALE;
    scale.value = withSpring(1, { ...BLOCKS_SPRING.pop, reduceMotion: ReduceMotion.Never });
  }, [entryId, request, scale]);

  useEffect(() => () => cancelAnimation(scale), [scale]);

  return useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
}

/** The first-paint drop-in (Blocks prototype): tiles fall 18 points from 92 % with a short stagger. */
export const DROP_IN = { distance: 18, fromScale: 0.92, firstDelayMs: 80, staggerMs: 45, fadeMs: 160 } as const;
/** After its delay, a drop-in is forced to rest this long later whether or not its frames ran. */
export const DROP_IN_SETTLE_MS = 900;

/**
 * Settles a tile at rest whenever `settle` changes after mount (the mosaic bumps it on every return to
 * the foreground, every time Today regains focus and every re-layout after first paint), so a tile's
 * visibility never depends on its animation or its timer surviving (Trello 210 recurred with the
 * timer in place). `restDueAt` is when the tile should have been at rest anyway: a tile still not at
 * rest after that is reported through `onFoundHidden`; one settled earlier was only interrupted.
 */
function useSettleOnRevision(settle: number, restDueAt: number, atRest: () => boolean, settleAtRest: () => void, onFoundHidden?: () => void) {
  const settledRevision = useRef(settle);
  useEffect(() => {
    if (settledRevision.current === settle) return;
    settledRevision.current = settle;
    if (!atRest() && Date.now() >= restDueAt) onFoundHidden?.();
    settleAtRest();
    // Runs when the revision changes; the shared values behind atRest/settleAtRest never change.
  }, [onFoundHidden, settle]);
}

/**
 * A tile that arrives after first paint (a newly pinned activity) fades in over the control
 * duration (90 ms under Reduce Motion), owned here rather than by a Reanimated entering animation,
 * so the same safety net applies: it is forced to full opacity shortly after, frames or not, and at
 * once on the next `settle` revision.
 */
export function useTileFadeIn({
  onFoundHidden,
  play,
  reduceMotion,
  settle = 0,
}: {
  onFoundHidden?: () => void;
  play: boolean;
  reduceMotion: boolean;
  settle?: number;
}) {
  const playing = useRef(play).current;
  const duration = reduceMotion ? 90 : MOBILE_MOTION.control;
  const restDueAt = useRef(playing ? Date.now() + duration + DROP_IN_SETTLE_MS : 0).current;
  const opacity = useSharedValue(playing ? 0 : 1);
  const settleAtRest = () => {
    cancelAnimation(opacity);
    opacity.value = 1;
  };
  useSettleOnRevision(settle, restDueAt, () => opacity.value === 1, settleAtRest, onFoundHidden);
  useEffect(() => {
    if (!playing) return undefined;
    opacity.value = withTiming(1, { duration, reduceMotion: ReduceMotion.Never });
    const fallback = setTimeout(settleAtRest, duration + DROP_IN_SETTLE_MS);
    return () => {
      clearTimeout(fallback);
      settleAtRest();
    };
    // Plays once per mount.
  }, []);
  return useAnimatedStyle(() => ({ opacity: opacity.value }));
}

/**
 * Drops one tile into place once, staggered by its order. `play` is decided by the caller when the
 * tile mounts (first paint of the process only), so refreshes, hydration and remounts never replay
 * it; a new `settle` revision puts the tile at rest at once.
 */
export function useDropIn({ index, onFoundHidden, play, settle = 0 }: { index: number; onFoundHidden?: () => void; play: boolean; settle?: number }) {
  const playing = useRef(play).current;
  const delay = DROP_IN.firstDelayMs + index * DROP_IN.staggerMs;
  const restDueAt = useRef(playing ? Date.now() + delay + DROP_IN_SETTLE_MS : 0).current;
  const translateY = useSharedValue(playing ? DROP_IN.distance : 0);
  const scale = useSharedValue(playing ? DROP_IN.fromScale : 1);
  const opacity = useSharedValue(playing ? 0 : 1);
  // An interrupted drop-in settles at rest rather than leaving a tile hidden.
  const settleAtRest = () => {
    cancelAnimation(translateY);
    cancelAnimation(scale);
    cancelAnimation(opacity);
    translateY.value = 0;
    scale.value = 1;
    opacity.value = 1;
  };
  useSettleOnRevision(
    settle,
    restDueAt,
    () => opacity.value === 1 && translateY.value === 0 && scale.value === 1,
    settleAtRest,
    onFoundHidden
  );

  useEffect(() => {
    if (!playing) return undefined;
    const spring = { ...BLOCKS_SPRING.land, reduceMotion: ReduceMotion.Never };
    translateY.value = withDelay(delay, withSpring(0, spring));
    scale.value = withDelay(delay, withSpring(1, spring));
    opacity.value = withDelay(delay, withTiming(1, { duration: DROP_IN.fadeMs, reduceMotion: ReduceMotion.Never }));
    // Safety net (Trello 210, the "Switch to" tiles once stayed invisible): if the frames never
    // run — the app was drawn in the background or the phone dropped frames — the tile is at rest
    // shortly after the drop-in should have ended, so it can never stay hidden.
    const fallback = setTimeout(settleAtRest, delay + DROP_IN_SETTLE_MS);
    return () => {
      clearTimeout(fallback);
      settleAtRest();
    };
    // Plays once per mount; the index is fixed at that moment.
  }, []);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));
}
