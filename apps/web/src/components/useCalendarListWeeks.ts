"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";
import { clientFetch } from "@/lib/client-auth-fetch";
import { addCalendarDays, listRefreshWindow, parseTimelineDateKey, toTimelineDateKey, weekInListRefreshWindow } from "@/lib/timeline-view";

/** Empty weeks in a row that end the List's way back. */
export const LIST_EMPTY_WEEKS_BEFORE_END = 8;
/** Of the empty weeks that end the way back, at most this many are read again at once after an edit. */
export const LIST_EDGE_WEEKS_READ_ON_EDIT = 2;
/** Of the stale empty weeks the List's top day passes over, at most this many are read per move (nearest first). */
export const LIST_GAP_WEEKS_READ_ON_SCROLL = 2;
/** Of the edited blocks' own weeks outside the window, at most this many are read again at once. */
export const LIST_EDITED_WEEKS_READ_ON_EDIT = 4;
const NO_DATES: readonly string[] = [];

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
  /** Loaded weeks (start keys) whose newest read again failed: shown from their old copy, with a line saying so. */
  failedWeeks: readonly string[];
  /** Reads a week again now (its line's Try again). */
  retryWeek: (startKey: string) => void;
};

const NO_ENTRIES: readonly TimeEntryRow[] = [];

/** Days from one date key to another (positive when `to` is later). */
function dayDistance(from: string, to: string) {
  const [a, b] = [parseTimelineDateKey(from), parseTimelineDateKey(to)];
  return a && b ? Math.round((b.getTime() - a.getTime()) / 86_400_000) : 0;
}

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
 *
 * Request-storm fix (30 Oct 2026; an edit used to re-read every loaded week): an edit re-reads at once the loaded weeks
 * that overlap LIST_REFRESH_RADIUS_DAYS around the List's top day (`focusDate`, the anchor until the List reports one),
 * the edited blocks' own weeks (`affectedDates`) and at most LIST_EDGE_WEEKS_READ_ON_EDIT empty edge weeks. Every other
 * loaded week, and every loaded week after a bootstrap refresh (`staleKey`), is stale until the List's top day comes
 * near it; a failed read leaves it stale.
 */
export function useCalendarListWeeks({
  anchorWeekStart,
  currentWeekStart,
  affectedDates = NO_DATES,
  enabled,
  focusDate = null,
  owner,
  refreshToken,
  staleKey
}: {
  anchorWeekStart: Date;
  /** The viewer's current week, or null before hydration (no later weeks then). */
  currentWeekStart: Date | null;
  enabled: boolean;
  /** The days (date keys) the edit behind the newest `refreshToken` touched: their loaded weeks are read at once. */
  affectedDates?: readonly string[];
  /** The day at the top of the List (a date key), or null for the anchor week. */
  focusDate?: string | null;
  owner: string;
  refreshToken: number;
  /** Changes with each bootstrap refresh: every loaded week becomes stale (read again when visited). */
  staleKey?: unknown;
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
  const loadedDuringEditRef = useRef<(forGeneration: number, startKey: string) => void>(() => undefined);
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
      return clientFetch(`/api/bootstrap?date=${startKey}`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Unable to load the week of ${startKey}: ${response.status}`);
          return (await response.json()) as BootstrapData;
        })
        .then((payload) => {
          if (generationRef.current !== forGeneration || readSeqRef.current.get(seqKey) !== seq) return false;
          if (`${payload.workspace.id}:${payload.user.id}` !== owner) return false;
          commit(payload.weekEntries);
          // A read never re-reads itself after an edit (Codex r2 on #634: 20 delayed reads made 20 more): the edit marks
          // every loaded week stale, reads its own bounded set again, and leaves the rest to their visits.
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
    const tokenAtStart = refreshTokenRef.current;
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
    }).then((committed) => {
      if (generationRef.current === generation) setStatus({ generation, loading: null, error: null });
      // Loaded while an edit landed: what it read may predate the edit, so it is stale (read at once when it is in the
      // window the List's top day is in, as a week loading at the List's end usually is).
      if (committed && refreshTokenRef.current !== tokenAtStart) loadedDuringEditRef.current(generation, startKey);
    }).catch(() => {
      if (generationRef.current === generation) setStatus({ generation, loading: null, error: direction });
    }).finally(() => {
      if (inFlightRef.current === ticket) inFlightRef.current = null;
    });
  }, [anchorKey, enabled, generation, readWeek, reachedEarliest, reachedLatest, replaceWeek, state.earlier.length, state.later.length]);

  // An edit or a delete: the loaded weeks near the List's top day, the edited blocks' own weeks and a few of the empty
  // weeks that end the way back are read again at once, keeping the shown copy until each newer answer arrives. Every
  // other loaded week is stale, as is every loaded week after a bootstrap refresh (`staleKey`), and is read again when
  // the List's top day comes within LIST_REFRESH_RADIUS_DAYS of it.
  const storedRef = useRef(stored);
  useLayoutEffect(() => {
    storedRef.current = stored;
  }, [stored]);
  const refreshWindow = listRefreshWindow(focusDate ?? anchorKey);
  const windowKey = refreshWindow ? `${refreshWindow.from}..${refreshWindow.to}` : "";
  // Stale weeks, each with the mark it was given: a read clears it only when it started after that mark and committed,
  // so a failed (or older) read leaves the week stale and the next visit or trigger reads it again.
  const staleRef = useRef<{ generation: number; weeks: Map<string, number>; inFlight: Map<string, number>; mark: number }>(
    { generation, weeks: new Map(), inFlight: new Map(), mark: 0 });
  const staleFor = (forGeneration: number) => {
    if (staleRef.current.generation !== forGeneration) staleRef.current = { generation: forGeneration, weeks: new Map(), inFlight: new Map(), mark: 0 };
    return staleRef.current;
  };
  /** Reads a week again. An edit always reads (its newest read wins); a visit leaves a week already being read alone. */
  const revalidate = (forGeneration: number, startKey: string, edit = false) => {
    const stale = staleFor(forGeneration);
    if (!edit && stale.inFlight.has(startKey)) return;
    stale.inFlight.set(startKey, (stale.inFlight.get(startKey) ?? 0) + 1);
    const startedAt = stale.mark;
    void readWeek(startKey, forGeneration, replaceWeek(forGeneration, startKey))
      .then((committed) => {
        if (!committed) return;
        const mark = stale.weeks.get(startKey);
        if (mark !== undefined && mark <= startedAt) stale.weeks.delete(startKey);
        setFailed(forGeneration, startKey, false);
      })
      // The old copy stays, said to be out of date on the week's line until a read succeeds (visit, trigger or Try again).
      .catch(() => setFailed(forGeneration, startKey, true))
      .finally(() => {
        const left = (stale.inFlight.get(startKey) ?? 1) - 1;
        if (left > 0) stale.inFlight.set(startKey, left);
        else stale.inFlight.delete(startKey);
      });
  };
  // Weeks whose newest read again failed: their old copy shows with a quiet line saying so (Codex r2 on #634).
  const [failedWeeks, setFailedWeeks] = useState<{ generation: number; weeks: ReadonlySet<string> }>({ generation: 0, weeks: new Set() });
  const setFailed = (forGeneration: number, startKey: string, isFailed: boolean) => setFailedWeeks((current) => {
    const weeks = new Set(current.generation === forGeneration ? current.weeks : []);
    if (weeks.has(startKey) === isFailed && current.generation === forGeneration) return current;
    if (isFailed) weeks.add(startKey);
    else weeks.delete(startKey);
    return { generation: forGeneration, weeks };
  });
  const markStale = (forGeneration: number, weeks: readonly WeekPage[]) => {
    const stale = staleFor(forGeneration);
    stale.mark += 1;
    for (const week of weeks) stale.weeks.set(week.startKey, stale.mark);
  };
  const lastRefreshRef = useRef(refreshToken);
  useEffect(() => {
    if (lastRefreshRef.current === refreshToken) return;
    lastRefreshRef.current = refreshToken;
    const current = storedRef.current;
    if (!enabled || !current || current.generation !== generation) return;
    const loaded = [...current.earlier, ...current.later];
    markStale(generation, loaded);
    // The edited blocks' own weeks, before and after the edit, wherever they are (at most LIST_EDITED_WEEKS_READ_ON_EDIT;
    // a grouped edit across more leaves the rest stale).
    const edited = new Set(loaded.filter((week) => {
      const start = parseTimelineDateKey(week.startKey);
      const end = start ? toTimelineDateKey(addCalendarDays(start, 6)) : week.startKey;
      return affectedDates.some((date) => week.startKey <= date && date <= end);
    }).slice(0, LIST_EDITED_WEEKS_READ_ON_EDIT).map((week) => week.startKey));
    // The oldest of the empty weeks that end the way back, at most LIST_EDGE_WEEKS_READ_ON_EDIT of them (a block there
    // opens the way back again even when the List can't scroll down to it); the rest of the run stays stale.
    const edge = new Set(current.earlier.slice(current.earlier.length - Math.min(current.emptyEarlierRun, LIST_EDGE_WEEKS_READ_ON_EDIT))
      .map((week) => week.startKey));
    for (const week of loaded) {
      if (edited.has(week.startKey) || edge.has(week.startKey) || weekInListRefreshWindow(week.startKey, refreshWindow)) {
        revalidate(generation, week.startKey, true);
      }
    }
    // The window and the edited days are read from this render; the effect runs only for a new edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, generation, readWeek, refreshToken, replaceWeek]);
  // A bootstrap refresh (another device's change may be anywhere): every loaded week is stale, read when visited.
  const lastStaleKeyRef = useRef(staleKey);
  useEffect(() => {
    if (lastStaleKeyRef.current === staleKey) return;
    lastStaleKeyRef.current = staleKey;
    const current = storedRef.current;
    if (!enabled || !current || current.generation !== generation) return;
    markStale(generation, [...current.earlier, ...current.later]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, generation, staleKey]);
  // The stale weeks of the window the List's top day has come to (at most the three weeks that overlap it), and of the
  // stale empty weeks it passed over on the way, at most LIST_GAP_WEEKS_READ_ON_SCROLL nearest the destination: an empty
  // week has no heading, so the top day can never be in it, and a block added to it elsewhere would otherwise never show
  // (Codex r2 on #634). Other weeks passed over stay stale until visited.
  const focusKey = focusDate ?? anchorKey;
  const previousFocusRef = useRef(focusKey);
  useEffect(() => {
    const from = previousFocusRef.current;
    previousFocusRef.current = focusKey;
    if (!enabled) return;
    const stale = staleFor(generation);
    for (const startKey of [...stale.weeks.keys()]) {
      if (weekInListRefreshWindow(startKey, refreshWindow)) revalidate(generation, startKey);
    }
    const current = storedRef.current;
    if (!current || current.generation !== generation || from === focusKey) return;
    const passed = { from: from < focusKey ? from : focusKey, to: from < focusKey ? focusKey : from };
    const gaps = [...current.earlier, ...current.later]
      .filter((week) => !week.entries.length && stale.weeks.has(week.startKey) && !stale.inFlight.has(week.startKey) &&
        !weekInListRefreshWindow(week.startKey, refreshWindow) && weekInListRefreshWindow(week.startKey, passed))
      .sort((left, right) => Math.abs(dayDistance(left.startKey, focusKey)) - Math.abs(dayDistance(right.startKey, focusKey)))
      .slice(0, LIST_GAP_WEEKS_READ_ON_SCROLL);
    for (const week of gaps) revalidate(generation, week.startKey);
    // `windowKey` stands for the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, generation, readWeek, replaceWeek, windowKey]);
  const revalidateRef = useRef(revalidate);
  useLayoutEffect(() => {
    revalidateRef.current = revalidate;
    loadedDuringEditRef.current = (forGeneration, startKey) => {
      const stale = staleFor(forGeneration);
      stale.mark += 1;
      stale.weeks.set(startKey, stale.mark);
      if (weekInListRefreshWindow(startKey, refreshWindow)) revalidate(forGeneration, startKey, true);
    };
  });
  const retryWeek = useCallback((startKey: string) => {
    if (enabled) revalidateRef.current(generationRef.current, startKey, true);
  }, [enabled]);

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
    load,
    failedWeeks: enabled && failedWeeks.generation === generation ? [...failedWeeks.weeks] : NO_DATES,
    retryWeek
  };
}
