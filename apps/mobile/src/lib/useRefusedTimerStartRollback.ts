import { useEffect, useRef } from "react";
import { subscribeRefusedTimerStarts, type RefusedTimerStart } from "./api";
import {
  refusedTimerStartPresentation,
  type RefusedTimerStartPresentationInput
} from "./refusedTimerStartPresentation";

export type RefusedTimerStartRollback = {
  /** What Today shows of the refused block right now (read when the refusal arrives). */
  describe: (start: RefusedTimerStart) => RefusedTimerStartPresentationInput;
  /** Rolls the block back; never from the Start's own (possibly hours-old) snapshot. */
  reject: (localId: string, error: Error, alert: boolean) => void;
  /** Closes the Calendar editor open on the block through its own exit. */
  dismissCalendarEditor: () => void;
  /** Refreshes Today from the server. */
  refresh: () => void;
};

/**
 * The Dashboard's answer to a queued Start the server refused (stability audit 22 Oct 2026,
 * iphone-timer-sync-3; Codex r3 on #532 moved it out of the Dashboard so it is tested by behaviour).
 * Subscribes once for the component's life and always calls the latest callbacks.
 */
export function useRefusedTimerStartRollback(rollback: RefusedTimerStartRollback) {
  const latest = useRef(rollback);
  latest.current = rollback;
  useEffect(() => subscribeRefusedTimerStarts((start) => {
    const current = latest.current;
    const decision = refusedTimerStartPresentation(current.describe(start));
    if (!decision.run) return;
    if (decision.dismissCalendarEditor) current.dismissCalendarEditor();
    current.reject(start.localId, new Error(start.message), decision.alert);
    current.refresh();
  }), []);
}
