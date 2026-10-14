import { useEffect, useRef } from "react";
import { subscribeShortcutStopRequests, takeShortcutStopRequest } from "../lib/shortcutStopRequests";

/**
 * Carries out a `dayframe://action/stop` request (`shortcutStopRequests.ts`) once the Dashboard is ready:
 * authenticated with timer state loaded. `stop` is the Dashboard's own Stop for the block it shows as
 * running (the button's targeted outbox), read through a ref so the latest one runs.
 */
export function useShortcutStopHandoff(ready: boolean, stop: () => Promise<boolean>) {
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    if (!ready) return undefined;
    const take = () => {
      if (takeShortcutStopRequest()) void stopRef.current();
    };
    take();
    return subscribeShortcutStopRequests(take);
  }, [ready]);
}
