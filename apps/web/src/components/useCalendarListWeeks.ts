"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";
import { clientFetch } from "@/lib/client-auth-fetch";
import { addCalendarDays, toTimelineDateKey } from "@/lib/timeline-view";

/** Weeks loaded at a time, and how many empty weeks in a row end the List's way back. */
export const LIST_EMPTY_WEEKS_BEFORE_END = 8;

type WeekPage = { startKey: string; entries: TimeEntryRow[] };

type ListWeeksState = {
  /** Whose weeks these are (`workspace:user`) and around which week: anything else is never shown. */
  owner: string;
  anchorKey: string;
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
  /** Weeks prepended at the top (later weeks), so the List can keep what was in view in place. */
  laterCount: number;
  load: (direction: ListWeeksDirection) => void;
};

const NO_ENTRIES: readonly TimeEntryRow[] = [];

/**
 * Calendar › List's continuous days (owner, 24 Oct 2026): the List shows the selected week (from the
 * shell's own data, which keeps it fresh) and loads whole weeks before and after it as it scrolls,
 * through the workspace-scoped bootstrap read. Weeks belong to their owner and anchor: a workspace or
 * account switch, or another anchor week, drops them at once (never shown), and an answer that
 * arrives after such a change is discarded. `refreshToken` re-reads every loaded week (after an edit or
 * a delete), keeping the shown copy until each answer arrives.
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
  const [stored, setStored] = useState<ListWeeksState | null>(null);
  const [loading, setLoading] = useState<{ key: string; direction: ListWeeksDirection } | null>(null);
  const [error, setError] = useState<{ key: string; direction: ListWeeksDirection } | null>(null);
  const scopeKey = `${owner}|${anchorKey}`;
  const scopeRef = useRef(scopeKey);
  useEffect(() => {
    scopeRef.current = scopeKey;
  }, [scopeKey]);
  const inFlightRef = useRef<{ key: string; direction: ListWeeksDirection } | null>(null);

  // Weeks for another owner or anchor are never shown, even for the render before they are dropped.
  const state: ListWeeksState = stored && stored.owner === owner && stored.anchorKey === anchorKey
    ? stored
    : { owner, anchorKey, earlier: [], later: [], emptyEarlierRun: 0 };
  const shownLoading = enabled && loading?.key === scopeKey ? loading.direction : null;
  const shownError = enabled && error?.key === scopeKey ? error.direction : null;

  const currentKey = currentWeekStart ? toTimelineDateKey(currentWeekStart) : null;
  const newestKey = state.later.length ? state.later[state.later.length - 1].startKey : anchorKey;
  const reachedLatest = currentKey === null || newestKey >= currentKey;
  const reachedEarliest = state.emptyEarlierRun >= LIST_EMPTY_WEEKS_BEFORE_END;

  const readWeek = useCallback(async (startKey: string) => {
    const response = await clientFetch(`/api/bootstrap?date=${startKey}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to load the week of ${startKey}: ${response.status}`);
    const payload = (await response.json()) as BootstrapData;
    return payload;
  }, []);

  const load = useCallback((direction: ListWeeksDirection) => {
    if (!enabled || inFlightRef.current?.key === scopeKey) return;
    if (direction === "earlier" && reachedEarliest) return;
    if (direction === "later" && reachedLatest) return;
    const offsetWeeks = direction === "earlier" ? -(state.earlier.length + 1) : state.later.length + 1;
    const startKey = toTimelineDateKey(addCalendarDays(anchorWeekStart, offsetWeeks * 7));
    const ticket = { key: scopeKey, direction };
    inFlightRef.current = ticket;
    setLoading(ticket);
    setError(null);
    void readWeek(startKey).then((payload) => {
      // The workspace or the anchor changed while this loaded: its week is not this List's.
      if (scopeRef.current !== ticket.key || `${payload.workspace.id}:${payload.user.id}` !== owner) return;
      const page: WeekPage = { startKey, entries: payload.weekEntries };
      setStored((current) => {
        const base = current && current.owner === owner && current.anchorKey === anchorKey
          ? current
          : { owner, anchorKey, earlier: [], later: [], emptyEarlierRun: 0 };
        if (direction === "earlier") {
          if (base.earlier.some((week) => week.startKey === startKey)) return base;
          return { ...base, earlier: [...base.earlier, page], emptyEarlierRun: page.entries.length ? 0 : base.emptyEarlierRun + 1 };
        }
        if (base.later.some((week) => week.startKey === startKey)) return base;
        return { ...base, later: [...base.later, page] };
      });
    }).catch(() => {
      if (scopeRef.current === ticket.key) setError(ticket);
    }).finally(() => {
      if (inFlightRef.current === ticket) inFlightRef.current = null;
      setLoading((current) => (current === ticket ? null : current));
    });
  }, [anchorKey, anchorWeekStart, enabled, owner, readWeek, reachedEarliest, reachedLatest, scopeKey, state.earlier.length, state.later.length]);

  // An edit or a delete: read every loaded week again, keeping the shown copy until each answer lands.
  const lastRefreshRef = useRef(refreshToken);
  useEffect(() => {
    if (lastRefreshRef.current === refreshToken) return;
    lastRefreshRef.current = refreshToken;
    if (!enabled || !stored || stored.owner !== owner || stored.anchorKey !== anchorKey) return;
    const key = scopeKey;
    for (const week of [...stored.earlier, ...stored.later]) {
      void readWeek(week.startKey).then((payload) => {
        if (scopeRef.current !== key || `${payload.workspace.id}:${payload.user.id}` !== owner) return;
        setStored((current) => current && current.owner === owner && current.anchorKey === anchorKey ? {
          ...current,
          earlier: current.earlier.map((page) => page.startKey === week.startKey ? { ...page, entries: payload.weekEntries } : page),
          later: current.later.map((page) => page.startKey === week.startKey ? { ...page, entries: payload.weekEntries } : page)
        } : current);
      }).catch(() => undefined);
    }
  }, [anchorKey, enabled, owner, readWeek, refreshToken, scopeKey, stored]);

  const entries = enabled && (state.earlier.length || state.later.length)
    ? [...state.earlier, ...state.later].flatMap((week) => week.entries)
    : NO_ENTRIES;
  return {
    entries,
    rangeStart: addCalendarDays(anchorWeekStart, -7 * (enabled ? state.earlier.length : 0)),
    rangeEnd: addCalendarDays(anchorWeekStart, 7 * (1 + (enabled ? state.later.length : 0))),
    loading: shownLoading,
    error: shownError,
    reachedEarliest,
    reachedLatest,
    laterCount: enabled ? state.later.length : 0,
    load
  };
}
