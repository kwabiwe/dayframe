import { useCallback, useEffect, useRef, useState } from "react";
import { reviewLinkLookupable } from "../../lib/reviewLinks";

/** The account a link is answered for; `backendId` is null in a build without a backend identity (no lookup then). */
export type CheckLinkOwner = { workspaceId: string; userId: string; backendId: string | null };

/** What the server says about the item a link names: when it starts, and whether it still asks. */
export type CheckLinkItem = { startedAt: string | null; asks: boolean };

type Request = { check: string; request: number };
/** A named "?" that still asks on the server, waiting on its day for the loaded data to bring it. */
type Waiting = { check: string; dayKey: string; request: number; ownerKey: string; loadsLeft: number; until: number };

/** How many completed loads (a bootstrap, the shown day's places) a named "?" waits through, and for how long at most. */
export const CHECK_LINK_WAIT_LOADS = 2;
export const CHECK_LINK_WAIT_MS = 15_000;

/**
 * Old Review links in Calendar › List (location v4 step 15; Codex r1, r2 and r4 on #615). A link is held until the app
 * is signed in and its bootstrap is in (`ready`), then answered once, for the account then signed in:
 * - `first`: today's first "?" with today selected (`openTodayFirst`), even one that started yesterday;
 * - a "?" the List asks (`openCheck` returns true): its own #610 check request, its question or sheet open;
 * - anything else: one owner-scoped read of the item (`lookupItem`; decided, or beyond the bootstrap's 100 open
 *   items), keeping its id. If by then the List asks it, its own check request opens on its day. Otherwise the List
 *   opens on its day with nothing selected (`openDay`, never the day's first "?"), and when the server says it still
 *   asks, the named request stays waiting on that day: the next loads (up to `CHECK_LINK_WAIT_LOADS`, within
 *   `CHECK_LINK_WAIT_MS`) open it the moment the List has it. Another day selected, another link, another account or
 *   signing out ends the wait. A failed or empty read, or a non-UUID id, opens today's List unselected; an account
 *   change while reading opens today's List; a newer link wins over an older read; nothing opens once signed out.
 * Every callback is read at the moment it is used, so a read finishing later uses the current List.
 */
export function useCheckLinks(input: {
  ready: boolean;
  owner: CheckLinkOwner | null;
  todayKey: string;
  /** The day Calendar shows: a named "?" waits only while its day is the one shown. */
  selectedDayKey: string;
  /** How many Calendar data loads have completed (`useCompletedLoadCount`): only a completed load counts. */
  loads: number;
  /** Opens a "?" the List asks by its id (its #610 check request), on `dayKey` when given; false when it doesn't. */
  openCheck: (reviewItemId: string, dayKey?: string) => boolean;
  /** Calendar › List on a day, nothing selected. */
  openDay: (dayKey: string) => void;
  openTodayFirst: () => void;
  lookupItem: (owner: CheckLinkOwner, reviewItemId: string) => Promise<CheckLinkItem | null>;
  dayKeyOf: (instant: string) => string | null;
  now?: () => number;
}) {
  const [pending, setPending] = useState<Request | null>(null);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const requests = useRef(0);
  const latest = useRef(input);
  latest.current = input;
  const ownerKey = input.owner ? `${input.owner.backendId}:${input.owner.workspaceId}:${input.owner.userId}` : null;
  const ownerKeyRef = useRef(ownerKey);
  ownerKeyRef.current = ownerKey;
  const clock = () => (latest.current.now ?? Date.now)();

  const openCheckLink = useCallback((check: string) => {
    requests.current += 1;
    setWaiting(null);
    setPending({ check, request: requests.current });
  }, []);

  useEffect(() => {
    const owner = input.owner;
    if (!pending || !input.ready || !owner) return;
    setPending(null);
    const { check, request } = pending;
    const now = latest.current;
    if (check === "first") {
      now.openTodayFirst();
      return;
    }
    if (now.openCheck(check)) return;
    if (!reviewLinkLookupable(check)) {
      now.openDay(now.todayKey);
      return;
    }
    const readFor = ownerKey;
    void now.lookupItem(owner, check).catch(() => null).then((item) => {
      if (request !== requests.current) return;
      const current = latest.current;
      if (!ownerKeyRef.current) return;
      if (ownerKeyRef.current !== readFor || !readFor) {
        current.openDay(current.todayKey);
        return;
      }
      const dayKey = item?.startedAt ? current.dayKeyOf(item.startedAt) : null;
      if (current.openCheck(check, dayKey ?? undefined)) return;
      current.openDay(dayKey ?? current.todayKey);
      if (item?.asks && dayKey) {
        setWaiting({ check, dayKey, request, ownerKey: readFor, loadsLeft: CHECK_LINK_WAIT_LOADS, until: clock() + CHECK_LINK_WAIT_MS });
      }
    });
    // Answered once per request; the account and readiness only gate when.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, input.ready, input.owner, ownerKey]);

  // A waiting named "?": every load tries it again, until it opens, its loads or time run out, or something else
  // takes over (another day shown, another link, another account, signed out).
  useEffect(() => {
    if (!waiting) return;
    const current = latest.current;
    if (waiting.request !== requests.current || ownerKey !== waiting.ownerKey || current.selectedDayKey !== waiting.dayKey
      || clock() > waiting.until) {
      setWaiting(null);
      return;
    }
    if (current.openCheck(waiting.check, waiting.dayKey)) {
      setWaiting(null);
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, input.loads, input.selectedDayKey, ownerKey]);
  // Each completed load after it began counts against its bound (Codex r5 on #615).
  const lastLoads = useRef(input.loads);
  useEffect(() => {
    if (lastLoads.current === input.loads) return;
    lastLoads.current = input.loads;
    setWaiting((current) => {
      if (!current) return current;
      return current.loadsLeft <= 1 ? null : { ...current, loadsLeft: current.loadsLeft - 1 };
    });
  }, [input.loads]);

  return openCheckLink;
}

/**
 * Completed Calendar data loads, counted for a named "?" waiting on its day (Codex r5 and r6 on #615): server
 * bootstraps that landed (`bootstrapCompletions`, bumped only where a bootstrap fetch resolves, never by a timer update
 * or another local publication) and a places response for the day shown (`timelineRequestedAt`, null while a day is
 * still loading). The null a day switch shows first is no load.
 */
export function useCompletedLoadCount(bootstrapCompletions: number, timelineRequestedAt: number | null) {
  const [timelineLoads, setTimelineLoads] = useState(0);
  useEffect(() => {
    if (timelineRequestedAt != null) setTimelineLoads((current) => current + 1);
  }, [timelineRequestedAt]);
  return bootstrapCompletions + timelineLoads;
}
