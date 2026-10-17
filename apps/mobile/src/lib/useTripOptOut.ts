import { useCallback, useEffect, useRef, useState } from "react";
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
 * toast, an Undo, an expiry or another account starts fresh. The outcome is announced from an effect,
 * so only when the toast it belongs to is the one rendered — never after Undo, expiry, an account
 * change or unmount, even when those land in the same batch as the answer (Codex r1/r2 on #464).
 */
export function useTripOptOut(eventId: string | null | undefined, token: number | null | undefined) {
  const [state, setState] = useState<{ key: string; busy: boolean; done: string | null; announced: boolean } | null>(null);
  const key = eventId && token != null ? `${currentMobileAccountEpoch()}:${token}` : null;
  const current = state && state.key === key ? state : null;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!current?.done || current.announced) return;
    AccessibilityInfo.announceForAccessibility(current.done);
    setState((previous) => previous && previous.key === current.key ? { ...previous, announced: true } : previous);
  }, [current]);
  const onAction = useCallback(async () => {
    if (!eventId || !key) return;
    const epoch = currentMobileAccountEpoch();
    setState({ key, busy: true, done: null, announced: false });
    let done = TRIP_OPT_OUT_FAILED;
    try {
      await stopLoggingTripsLike(eventId);
      done = TRIP_OPT_OUT_DONE;
    } catch {
      // Offline, signed out or refused: the toast says so; nothing else changes.
    }
    if (!mounted.current || epoch !== currentMobileAccountEpoch()) return;
    setState((previous) => previous && previous.key === key ? { ...previous, busy: false, done } : previous);
  }, [eventId, key]);
  if (!key) return null;
  return { label: TRIP_OPT_OUT_LABEL, onAction: () => void onAction(), busy: current?.busy ?? false, done: current?.done ?? null };
}
