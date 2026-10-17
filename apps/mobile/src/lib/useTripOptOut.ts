import { useCallback, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { stopLoggingTripsLike } from "./api";
import { currentMobileAccountEpoch } from "./mobileAccount";

export const TRIP_OPT_OUT_LABEL = "Don’t log trips like this";
export const TRIP_OPT_OUT_DONE = "Trips like this will wait in Review.";
export const TRIP_OPT_OUT_FAILED = "Couldn’t save that. Try again from a later trip.";

/**
 * "Don't log trips like this" (PRD D19, A4) on the toast after deleting one block a Move logged by
 * itself (mirrors the web's `useTripOptOut`): it stops that trip's pattern from the Move's event,
 * which outlives the block, and the toast's second row says so. Its state belongs to one deletion in
 * one account lifetime (the deletion token with the account epoch, which restarts tokens): a newer
 * toast, an Undo, an expiry or another account starts fresh, and a late answer for any of those is
 * neither shown nor announced (Codex r1 on #464). The deletion and its Undo are untouched.
 */
export function useTripOptOut(eventId: string | null | undefined, token: number | null | undefined) {
  const [state, setState] = useState<{ key: string; busy: boolean; done: string | null } | null>(null);
  const key = eventId && token != null ? `${currentMobileAccountEpoch()}:${token}` : null;
  const liveKey = useRef<string | null>(key);
  liveKey.current = key;
  const current = state && state.key === key ? state : null;
  const onAction = useCallback(async () => {
    if (!eventId || !key || liveKey.current !== key) return;
    setState({ key, busy: true, done: null });
    let done = TRIP_OPT_OUT_FAILED;
    try {
      await stopLoggingTripsLike(eventId);
      done = TRIP_OPT_OUT_DONE;
    } catch {
      // Offline, signed out or refused: the toast says so; nothing else changes.
    }
    if (liveKey.current !== key) return;
    setState((previous) => previous && previous.key === key ? { key, busy: false, done } : previous);
    AccessibilityInfo.announceForAccessibility(done);
  }, [eventId, key]);
  if (!key) return null;
  return { label: TRIP_OPT_OUT_LABEL, onAction: () => void onAction(), busy: current?.busy ?? false, done: current?.done ?? null };
}
