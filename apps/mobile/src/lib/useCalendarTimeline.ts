import { useEffect, useState } from "react";
import type { LocationTimeline } from "@dayframe/shared";

// Give the initial place read a short chance to settle before showing the complete day.
const CALENDAR_PRESENTATION_WAIT_MS = 800;

type Stored = { owner: string; dayKey: string; timeline: LocationTimeline | null; requestedAt: number };

/**
 * Calendar › List's places and trips (location v4 step 9): the selected day's timeline for the signed-in
 * account, read again when `refreshKey` changes. A result is kept only with the account and day it was
 * read for, so another account or day never sees it (Codex r1 on #570); a read that was superseded or
 * cancelled never lands, even if it finishes later. A failed read leaves the List's blocks on their own.
 */
export function useCalendarTimeline(input: Parameters<typeof useCalendarTimelineSnapshot>[0]): LocationTimeline | null {
  return useCalendarTimelineSnapshot(input).timeline;
}

/**
 * The same, with when the shown timeline was asked for (`requestedAt`, epoch ms): a correction the server
 * acknowledged after that is not in it yet (step 12).
 */
export function useCalendarTimelineSnapshot({
  dayKey,
  enabled,
  fetchTimeline,
  owner,
  refreshKey
}: {
  dayKey: string;
  enabled: boolean;
  fetchTimeline: (dayKey: string, options: { signal: AbortSignal }) => Promise<LocationTimeline>;
  /** The signed-in workspace and user; null when signed out. */
  owner: string | null;
  refreshKey: unknown;
}) {
  const [stored, setStored] = useState<Stored | null>(null);
  const [waitedFor, setWaitedFor] = useState<{ owner: string; dayKey: string } | null>(null);
  const selected = stored?.owner === owner && stored.dayKey === dayKey ? stored : null;
  const waiting = enabled && owner !== null && !selected
    && (waitedFor?.owner !== owner || waitedFor.dayKey !== dayKey);

  useEffect(() => {
    if (!waiting || owner === null) return;
    const timeout = setTimeout(() => setWaitedFor({ owner, dayKey }), CALENDAR_PRESENTATION_WAIT_MS);
    return () => clearTimeout(timeout);
  }, [dayKey, owner, waiting]);

  // Signing out, or another account, drops the last account's places at once.
  if (stored && stored.owner !== owner) setStored(null);
  if (waitedFor && (waitedFor.owner !== owner || waitedFor.dayKey !== dayKey)) setWaitedFor(null);
  useEffect(() => {
    if (!enabled || !owner) return;
    const controller = new AbortController();
    const requestedAt = Date.now();
    const land = (timeline: LocationTimeline | null) => {
      if (!controller.signal.aborted) setStored({ owner, dayKey, timeline, requestedAt });
    };
    fetchTimeline(dayKey, { signal: controller.signal }).then(land, () => land(null));
    return () => controller.abort();
  }, [dayKey, enabled, fetchTimeline, owner, refreshKey]);
  const current = selected?.timeline?.date === dayKey ? selected : null;
  return {
    timeline: current?.timeline ?? null,
    requestedAt: current?.requestedAt ?? null,
    loading: waiting
  };
}
