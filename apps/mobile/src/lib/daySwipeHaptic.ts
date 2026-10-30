import { playHaptic } from "./haptics";

/** Very fast swipes are thinned to this (the Grid's native gate, `DayframeCalendarDaySwipeTickGate`, uses the same). */
export const DAY_SWIPE_TICK_MIN_INTERVAL_MS = 120;

let lastTickMs: number | null = null;

/**
 * One light tick for a day changed by a swipe in Calendar › List, from the gesture that changed it, so the Today pill,
 * the "to check" chip and links never tick. `playHaptic` follows the Dayframe switch; iOS follows System Haptics.
 */
export function playDaySwipeTick(now = Date.now()) {
  if (lastTickMs !== null && now >= lastTickMs && now - lastTickMs < DAY_SWIPE_TICK_MIN_INTERVAL_MS) return false;
  lastTickMs = now;
  playHaptic("tick");
  return true;
}

export function __resetDaySwipeTickForTests() {
  lastTickMs = null;
}
