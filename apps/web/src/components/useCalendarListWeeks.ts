"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";
import { clientFetch } from "@/lib/client-auth-fetch";
import { addCalendarDays, parseTimelineDateKey, toTimelineDateKey } from "@/lib/timeline-view";

/** Empty weeks in a row that end the List's way back. */
export const LIST_EMPTY_WEEKS_BEFORE_END = 8;

type WeekPage = { startKey: string; entries: TimeEntryRow[] };

type ListWeeksState = {
  /** The scope lifetime these weeks were read in: only that lifetime ever shows them. */
  generation: number;
  /** Weeks before the anchor's, newest first, and after it, oldest first. */
  earlier: WeekPage[];
  later: WeekPage[];
  emptyEarlierRun: number;
};

export type ListWeeksDirection = "earlier" | "later";

export type CalendarListWeeks = {
  /** Every loaded week's entries outside the anchor week (the anchor week comes from the shell's data). */
  entries: readonly TimeEntryRow[];
  /** The span the List shows: the anchor week widened by every loaded week. */
  rangeStart: Date;
  rangeEnd: Date;
  loading: ListWeeksDirection | null;
  error: ListWeeksDirection | null;
  /** No earlier blocks: LIST_EMPTY_WEEKS_BEFORE_END empty weeks in a row. */
  reachedEarliest: boolean;
  /** The anchor week, or the newest loaded one, is the current week. */
  reachedLatest: boolean;
  load: (direction: ListWeeksDirection) => void;
};

const NO_ENTRIES: readonly TimeEntryRow[] = [];

/** Empty weeks in a row at the far end of the earlier weeks (newest first). */
function trailingEmptyWeeks(earlier: readonly WeekPage[]) {
  let run = 0;
  for (let index = earlier.length - 1; index >= 0 && !earlier[index].entries.length; index -= 1) run += 1;
  return run;
}

/**
 * Calendar › List's continuous days (owner, 24 Oct 2026): the List shows the selected week (from the
 * shell's own data, which keeps it fresh) and loads whole weeks before and after it as it scrolls,
 * through the workspace-scoped bootstrap read.
 *
 * Weeks belong to one scope lifetime: every change of owner (workspace and user) or anchor week starts a
 * new one (a generation), which drops the stored weeks and every read still in flight, so even an
 * A → B → A round trip never brings back A's earlier weeks or answers. Each week's reads are numbered:
 * only its newest read commits, and a read that started before an edit (`refreshToken`) is read again.
 */
export function useCalendarListWeeks({
  anchorWeekStart,
  currentWeekStart,
  enabled,
  owner,
  refreshToken
}: {
  anchorWeekStart: Date;
  /** The viewer's current week, or null before hydration (no later weeks then). */
  currentWeekStart: Date | null;
  enabled: boolean;
  owner: string;
  refreshToken: number;
}): CalendarListWeeks {
  const anchorKey = toTimelineDateKey(anchorWeekStart);
  const scopeKey = `${owner}|${anchorKey}|${enabled ? "on" : "off"}`;
  // The scope lifetime: a new generation for every scope change, kept in state so the render that sees
  // the change already shows nothing of the scope left (a guarded render-phase update).
  const [scope, setScope] = useState({ key: scopeKey, generation: 0 });
  const [stored, setStored] = useState<ListWeeksState | null>(null);
  const [status, setStatus] = useState<{ generation: number; loading: ListWeeksDirection | null; error: ListWeeksDirection | null }>(
    { generation: 0, loading: null, error: null });
  let generation = scope.generation;
  if (scope.key !== scopeKey) {
    generation = scope.generation + 1;
    setScope({ key: scopeKey, generation });
  }
  const generationRef = useRef(generation);
  const refreshTokenRef = useRef(refreshToken);
  useLayoutEffect(() => {
    generationRef.current = generation;
    refreshTokenRef.current = refreshToken;
  }, [generation, refreshToken]);
  // The newest read of each week ("generation:startKey"), so an older answer never replaces a newer one.
  const readSeqRef = useRef(new Map<string, number>());
  const inFlightRef = useRef<{ generation: number; direction: ListWeeksDirection } | null>(null);

  const state: ListWeeksState = stored && stored.generation === generation
    ? stored
    : { generation, earlier: [], later: [], emptyEarlierRun: 0 };
  const shown = status.generation === generation ? status : { loading: null, error: null };

  const currentKey = currentWeekStart ? toTimelineDateKey(currentWeekStart) : null;
  const newestKey = state.later.length ? state.later[state.later.length - 1].startKey : anchorKey;
  const reachedLatest = currentKey === null || newestKey >= currentKey;
  const reachedEarliest = state.emptyEarlierRun >= LIST_EMPTY_WEEKS_BEFORE_END;

  /** Reads one week for this lifetime; commits only if it is still the week's newest read. */
  const readWeek = useCallback((startKey: string, forGeneration: number, commit: (entries: TimeEntryRow[]) => void) => {
    const read = (): Promise<boolean> => {
      const seqKey = `${forGeneration}:${startKey}`;
      const seq = (readSeqRef.current.get(seqKey) ?? 0) + 1;
      readSeqRef.current.set(seqKey, seq);
      const tokenAtStart = refreshTokenRef.current;
      return clientFetch(`/api/bootstrap?date=${startKey}`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Unable to load the week of ${startKey}: ${response.status}`);
          return (await response.json()) as BootstrapData;
        })
        .then((payload) => {
          if (generationRef.current !== forGeneration || readSeqRef.current.get(seqKey) !== seq) return false;
          if (`${payload.workspace.id}:${payload.user.id}` !== owner) return false;
          commit(payload.weekEntries);
          // An edit landed while this read was out: what it read may predate it, so read the week again.
          if (refreshTokenRef.current !== tokenAtStart) void read().catch(() => undefined);
          return true;
        });
    };
    return read();
  }, [owner]);

  const replaceWeek = useCallback((forGeneration: number, startKey: string) => (entries: TimeEntryRow[]) => {
    setStored((current) => {
      if (!current || current.generation !== forGeneration) return current;
      const earlier = current.earlier.map((page) => page.startKey === startKey ? { ...page, entries } : page);
      return {
        ...current,
        earlier,
        later: current.later.map((page) => page.startKey === startKey ? { ...page, entries } : page),
        // The way back ends only after that many empty weeks in a row, counted again with each copy.
        emptyEarlierRun: trailingEmptyWeeks(earlier)
      };
    });
  }, []);

  const load = useCallback((direction: ListWeeksDirection) => {
    if (!enabled || inFlightRef.current?.generation === generation) return;
    if (direction === "earlier" && reachedEarliest) return;
    if (direction === "later" && reachedLatest) return;
    const offsetWeeks = direction === "earlier" ? -(state.earlier.length + 1) : state.later.length + 1;
    const anchor = parseTimelineDateKey(anchorKey);
    if (!anchor) return;
    const startKey = toTimelineDateKey(addCalendarDays(anchor, offsetWeeks * 7));
    const ticket = { generation, direction };
    inFlightRef.current = ticket;
    setStatus({ generation, loading: direction, error: null });
    let added = false;
    void readWeek(startKey, generation, (entries) => {
      if (added) {
        replaceWeek(generation, startKey)(entries);
        return;
      }
      added = true;
      const page: WeekPage = { startKey, entries };
      setStored((current) => {
        const base = current && current.generation === generation
          ? current
          : { generation, earlier: [], later: [], emptyEarlierRun: 0 };
        if ([...base.earlier, ...base.later].some((week) => week.startKey === startKey)) return base;
        return direction === "earlier"
          ? { ...base, earlier: [...base.earlier, page], emptyEarlierRun: trailingEmptyWeeks([...base.earlier, page]) }
          : { ...base, later: [...base.later, page] };
      });
    }).then(() => {
      if (generationRef.current === generation) setStatus({ generation, loading: null, error: null });
    }).catch(() => {
      if (generationRef.current === generation) setStatus({ generation, loading: null, error: direction });
    }).finally(() => {
      if (inFlightRef.current === ticket) inFlightRef.current = null;
    });
  }, [anchorKey, enabled, generation, readWeek, reachedEarliest, reachedLatest, replaceWeek, state.earlier.length, state.later.length]);

  // An edit or a delete: read every loaded week again (a week still loading is read again when it
  // lands), keeping the shown copy until each newer answer arrives.
  const storedRef = useRef(stored);
  useLayoutEffect(() => {
    storedRef.current = stored;
  }, [stored]);
  const lastRefreshRef = useRef(refreshToken);
  useEffect(() => {
    if (lastRefreshRef.current === refreshToken) return;
    lastRefreshRef.current = refreshToken;
    const current = storedRef.current;
    if (!enabled || !current || current.generation !== generation) return;
    for (const week of [...current.earlier, ...current.later]) {
      void readWeek(week.startKey, generation, replaceWeek(generation, week.startKey)).catch(() => undefined);
    }
  }, [enabled, generation, readWeek, refreshToken, replaceWeek]);

  const entries = enabled && (state.earlier.length || state.later.length)
    ? [...state.earlier, ...state.later].flatMap((week) => week.entries)
    : NO_ENTRIES;
  return {
    entries,
    rangeStart: addCalendarDays(anchorWeekStart, -7 * (enabled ? state.earlier.length : 0)),
    rangeEnd: addCalendarDays(anchorWeekStart, 7 * (1 + (enabled ? state.later.length : 0))),
    loading: enabled ? shown.loading : null,
    error: enabled ? shown.error : null,
    reachedEarliest,
    reachedLatest,
    load
  };
}
