import { useCallback, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { stopLoggingTripsLike } from "./api";

export const TRIP_OPT_OUT_LABEL = "Don’t log trips like this";
export const TRIP_OPT_OUT_DONE = "Trips like this will wait in Review.";
export const TRIP_OPT_OUT_FAILED = "Couldn’t save that. Try again from a later trip.";

/**
 * "Don't log trips like this" (PRD D19, A4) on the toast after deleting one block a Move logged by
 * itself (mirrors the web's `useTripOptOut`): it stops that trip's pattern from the Move's event,
 * which outlives the block, and the toast's second row says so. Keyed by the toast's token, so a
 * newer toast starts fresh and a late answer for an older one changes nothing. The deletion and its
 * Undo are untouched; the outcome is announced to VoiceOver.
 */
export function useTripOptOut(eventId: string | null | undefined, token: number | null | undefined) {
  const [state, setState] = useState<{ token: number; busy: boolean; done: string | null } | null>(null);
  const current = state && state.token === token ? state : null;
  const onAction = useCallback(async () => {
    if (!eventId || token == null) return;
    setState({ token, busy: true, done: null });
    let done = TRIP_OPT_OUT_FAILED;
    try {
      await stopLoggingTripsLike(eventId);
      done = TRIP_OPT_OUT_DONE;
    } catch {
      // Offline, signed out or refused: the toast says so; nothing else changes.
    }
    setState((previous) => previous && previous.token === token ? { token, busy: false, done } : previous);
    AccessibilityInfo.announceForAccessibility(done);
  }, [eventId, token]);
  if (!eventId || token == null) return null;
  return { label: TRIP_OPT_OUT_LABEL, onAction: () => void onAction(), busy: current?.busy ?? false, done: current?.done ?? null };
}
