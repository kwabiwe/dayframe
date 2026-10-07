import { useEffect, useRef } from "react";
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
} from "react-native-reanimated";
import { MOBILE_MOTION } from "./motion";

// Dayframe Blocks springs (.codex/reference/motion.md). Starting values from the prototype; tune on a physical iPhone.
export const BLOCKS_SPRING = {
  /** Start, stop, log, restore and delete: one small overshoot. */
  land: { stiffness: 320, damping: 21, mass: 1 },
  /** Controls and thumbs settle without visible overshoot. */
  control: { stiffness: 560, damping: 38, mass: 1 },
  /** Sheets and panels settle without visible overshoot. */
  sheet: { stiffness: 340, damping: 34, mass: 1 },
} as const;

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

/** Opacity-only breathing for the single live block; static under Reduce Motion or when not live. */
export function useBreathingRing({ live, reduceMotion }: { live: boolean; reduceMotion: boolean }) {
  const opacity = useSharedValue<number>(BREATHING_RING.reducedOpacity);

  useEffect(() => {
    cancelAnimation(opacity);
    if (!live) {
      opacity.value = withTiming(0, { duration: MOBILE_MOTION.control, reduceMotion: ReduceMotion.Never });
      return undefined;
    }
    if (reduceMotion) {
      opacity.value = BREATHING_RING.reducedOpacity;
      return undefined;
    }
    const half = BREATHING_RING.cycleMs / 2;
    const ease = Easing.inOut(Easing.sin);
    opacity.value = BREATHING_RING.minOpacity;
    opacity.value = withRepeat(
      withSequence(
        withTiming(BREATHING_RING.maxOpacity, { duration: half, easing: ease, reduceMotion: ReduceMotion.Never }),
        withTiming(BREATHING_RING.minOpacity, { duration: half, easing: ease, reduceMotion: ReduceMotion.Never })
      ),
      -1,
      false,
      undefined,
      ReduceMotion.Never
    );
    return () => cancelAnimation(opacity);
  }, [live, opacity, reduceMotion]);

  return useAnimatedStyle(() => ({ opacity: opacity.value }));
}
