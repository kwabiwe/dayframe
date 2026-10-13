import { useEffect } from "react";
import { AppState } from "react-native";

/**
 * Drives the Dashboard's clock (investigation 2026-10-12, Instruments): only a running block, its open
 * sheet or a Calendar entry being edited needs whole seconds; otherwise Today, Calendar and Reports
 * change on the minute. In the background nothing ticks (location can keep the app alive for hours,
 * and every tick re-rendered all three tabs); returning to the foreground reads the time at once, in
 * the same render as the return itself, so no frame shows the time the app left at.
 */
export function useDashboardClockTicks({
  foreground,
  needsSecondClock,
  setNow,
}: {
  foreground: boolean;
  needsSecondClock: boolean;
  setNow: (now: number) => void;
}) {
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
      const interval = setInterval(() => setNow(Date.now()), 1000);
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
  }, [foreground, needsSecondClock, setNow]);
}
