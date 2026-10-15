import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppState } from "react-native";

/**
 * Drives the Dashboard's clock (investigation 2026-10-12, Instruments): only a running block, its open
 * sheet or a Calendar entry being edited needs whole seconds; otherwise Today, Calendar and Reports
 * change on the minute. In the background nothing ticks (location can keep the app alive for hours,
 * and every tick re-rendered all three tabs); returning to the foreground reads the time at once, in
 * the same render as the return itself, so no frame shows the time the app left at.
 *
 * Whole seconds re-render the Dashboard only while they are on screen (`secondsShown`): with Settings,
 * Review or Calendar in front, the second clock moves the Dashboard on the minute only. On the
 * iPhone 17 (13 Oct) each tick re-rendered all three tabs, about 150 ms of JS a second behind Settings.
 */
export function useDashboardClockTicks({
  foreground,
  needsSecondClock,
  secondsShown = true,
  secondAnchorMs,
  setNow,
}: {
  foreground: boolean;
  needsSecondClock: boolean;
  /**
   * A running block's start: second ticks land just after each of its whole elapsed seconds, so every
   * clock anchored to the same block (the live block, the Play orb's ring) changes its second together.
   */
  secondAnchorMs?: number;
  /** Whether whole seconds are on screen: a running block with Today or Reports in front, or its sheet. */
  secondsShown?: boolean;
  setNow: (now: number) => void;
}) {
  // Published from the committed render only (Codex r1 on #384: a discarded render must not change it).
  const secondsShownRef = useRef(secondsShown);
  useLayoutEffect(() => {
    secondsShownRef.current = secondsShown;
  }, [secondsShown]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setNow(Date.now());
    });
    return () => subscription.remove();
  }, [setNow]);
  useEffect(() => {
    if (!foreground) return undefined;
    setNow(Date.now());
    if (needsSecondClock) {
      let shownMinute = Math.floor(Date.now() / 60_000);
      const tick = () => {
        const now = Date.now();
        const minute = Math.floor(now / 60_000);
        if (!secondsShownRef.current && minute === shownMinute) return;
        shownMinute = minute;
        setNow(now);
      };
      if (secondAnchorMs !== undefined && Number.isFinite(secondAnchorMs)) {
        let timeout: ReturnType<typeof setTimeout>;
        const scheduleSecond = () => {
          timeout = setTimeout(() => {
            tick();
            scheduleSecond();
          }, nextAnchoredSecondDelayMs(secondAnchorMs, Date.now()));
        };
        scheduleSecond();
        return () => clearTimeout(timeout);
      }
      const interval = setInterval(tick, 1000);
      return () => clearInterval(interval);
    }
    let timeout: ReturnType<typeof setTimeout>;
    const scheduleMinute = () => {
      timeout = setTimeout(() => {
        setNow(Date.now());
        scheduleMinute();
      }, 60_000 - (Date.now() % 60_000) + 20);
    };
    scheduleMinute();
    return () => clearTimeout(timeout);
  }, [foreground, needsSecondClock, secondAnchorMs, setNow]);
}

/** Small enough to read as the same moment, large enough that the tick lands after the second turns. */
const ANCHORED_TICK_LATE_MS = 15;

/** Milliseconds until just after the next whole second elapsed since `anchorMs`. */
export function nextAnchoredSecondDelayMs(anchorMs: number, nowMs: number) {
  const intoSecond = (((nowMs - anchorMs) % 1000) + 1000) % 1000;
  return 1000 - intoSecond + ANCHORED_TICK_LATE_MS;
}

/**
 * Whether a tab that shows live seconds (Today, Reports) is in front. Coming back to one (from
 * Settings, Review or Calendar) reads the time in that same render, so the first frame back shows the
 * running block's true time: while it was covered the clock moved only on the minute (React's
 * "information from previous renders" pattern).
 */
export function useLiveTimeInFront(inFront: boolean, setNow: (now: number) => void) {
  const [wasInFront, setWasInFront] = useState(inFront);
  if (inFront !== wasInFront) {
    setWasInFront(inFront);
    if (inFront) setNow(Date.now());
  }
  return inFront;
}
