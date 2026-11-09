"use client";

import { useCallback, useState } from "react";
import { clientFetch } from "@/lib/client-auth-fetch";

const DONE = "Trips like this will be asked in Calendar.";
const FAILED = "Couldn’t save that. Trips like this can be stopped from a later one.";

/**
 * "Don't log trips like this" (PRD D19, A4) on the toast after deleting one block a Move logged by
 * itself: it stops that trip's pattern (the Move's event outlives the block) and the toast row says
 * so. Keyed by the toast's token, so a newer toast starts fresh and a late answer for an older one
 * changes nothing. The deletion and its Undo are untouched.
 */
export function useTripOptOut(eventId: string | null | undefined, token: number | string | null | undefined) {
  const [state, setState] = useState<{ token: number | string; busy: boolean; done: string | null } | null>(null);
  const current = state && state.token === token ? state : null;
  const onAction = useCallback(async () => {
    if (!eventId || token == null) return;
    setState({ token, busy: true, done: null });
    let done = FAILED;
    try {
      const response = await clientFetch("/api/location/name-patterns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop_trips", eventId })
      });
      if (response.ok) done = DONE;
    } catch {
      // Offline or refused: the toast says so; nothing else changes.
    }
    setState((previous) => previous && previous.token === token ? { token, busy: false, done } : previous);
  }, [eventId, token]);
  if (!eventId || token == null) return null;
  return { label: "Don’t log trips like this", onAction: () => void onAction(), busy: current?.busy ?? false, done: current?.done ?? null };
}
