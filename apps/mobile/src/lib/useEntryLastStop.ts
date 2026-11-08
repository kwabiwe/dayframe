import { useEffect, useMemo, useState } from "react";
import { fetchEntryLastStops, type EntryLastStopPage, type MobileTimeEntry } from "./api";
import { readDurableLocalWork } from "./durableLocalWork";
import { eligibleLocalLastStops, entryLastStopDay, lastStopProjectionIds, latestEntryLastStop } from "./entryLastStop";
import type { MobileAccountOwner } from "./mobileAccount";

const NARROW_READ_SETTLE_MS = 400;
const EMPTY_IDS: ReadonlySet<string> = new Set();

type LastStopRead = { key: string; page: EntryLastStopPage | null; projectedIds: ReadonlySet<string> };

export function useEntryLastStop(input: {
  owner: MobileAccountOwner | undefined;
  visible: boolean;
  presentationId: number;
  entryId: string | undefined;
  startMs: number | null;
  cutoffMs: number | null;
  endMs: number;
  entries: readonly MobileTimeEntry[];
  deletedIds?: ReadonlySet<string>;
}) {
  const { owner, visible, presentationId, entryId, startMs, cutoffMs, endMs, entries, deletedIds = EMPTY_IDS } = input;
  const { fromMs = null, throughMs = null } = entryLastStopDay(startMs) ?? {};
  const userId = owner?.userId;
  const workspaceId = owner?.workspaceId;
  const key = visible && userId && workspaceId && fromMs !== null
    ? JSON.stringify([presentationId, workspaceId, userId, entryId, fromMs, throughMs]) : null;
  const [dayRead, setDayRead] = useState<LastStopRead | null>(null);
  const [narrowRead, setNarrowRead] = useState<LastStopRead | null>(null);
  useEffect(() => {
    if (!key || !userId || !workspaceId || fromMs === null || throughMs === null) return;
    const controller = new AbortController();
    const sessionOwner = { userId, workspaceId };
    void Promise.all([
      fetchEntryLastStops({ owner: sessionOwner, fromMs, throughMs, excludeId: entryId, signal: controller.signal }).catch(() => null),
      readDurableLocalWork(sessionOwner).catch(() => null)
    ]).then(([page, work]) => {
      if (!controller.signal.aborted) setDayRead({ key, page, projectedIds: lastStopProjectionIds(work) });
    });
    return () => controller.abort();
  }, [entryId, fromMs, key, throughMs, userId, workspaceId]);

  const day = dayRead?.key === key ? dayRead : null;
  const localRows = useMemo(() => eligibleLocalLastStops(entries), [entries]);
  const excludedIds = new Set(deletedIds);
  if (entryId) excludedIds.add(entryId);
  const window = fromMs === null || cutoffMs === null || !Number.isFinite(endMs) ? null : { fromMs, throughMs: cutoffMs, endMs, excludedIds };
  const local = window ? latestEntryLastStop(localRows, window) : null;
  const projectedIds = day?.projectedIds ?? EMPTY_IDS;
  const projectedRows = localRows.filter((row) => projectedIds.has(row.id));
  const combined = (page: EntryLastStopPage | null | undefined) => window && page
    ? latestEntryLastStop([...page.rows.filter((row) => !projectedIds.has(row.id)), ...projectedRows], window) : null;
  const fromDay = combined(day?.page);
  const covered = (page: EntryLastStopPage, candidate: ReturnType<typeof combined>) => {
    if (!page.truncated) return true;
    const oldest = page.rows.at(-1);
    return Boolean(oldest && candidate && Date.parse(candidate.stoppedAt) >= Date.parse(oldest.stoppedAt));
  };
  const narrowedThrough = cutoffMs !== null && throughMs !== null ? Math.min(cutoffMs, throughMs) : null;
  // A capped page is enough if its oldest stop is no later than the best visible eligible one.
  // Otherwise fetch a smaller range, once the person stops moving the dial or spinning the wheel.
  const needsNarrow = Boolean(day?.page && !covered(day.page, fromDay));
  const narrowKey = key && needsNarrow && narrowedThrough !== null && fromMs !== null && narrowedThrough >= fromMs && narrowedThrough < (throughMs ?? 0)
    ? JSON.stringify([key, narrowedThrough]) : null;
  useEffect(() => {
    if (!narrowKey || !userId || !workspaceId || fromMs === null || narrowedThrough === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetchEntryLastStops({ owner: { userId, workspaceId }, fromMs, throughMs: narrowedThrough, excludeId: entryId, signal: controller.signal })
        .catch(() => null)
        .then((page) => {
          if (!controller.signal.aborted) setNarrowRead({ key: narrowKey, page, projectedIds: EMPTY_IDS });
        });
    }, NARROW_READ_SETTLE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [entryId, fromMs, narrowedThrough, narrowKey, userId, workspaceId]);

  if (!window) return { candidate: null, status: "unavailable" as const };
  if (narrowKey) {
    const narrow = narrowRead?.key === narrowKey ? narrowRead : null;
    const candidate = combined(narrow?.page);
    if (narrow?.page && covered(narrow.page, candidate)) return { candidate, status: "ready" as const };
    return { candidate: local, status: narrow ? "unavailable" as const : "loading" as const };
  }
  if (day?.page && !needsNarrow) return { candidate: fromDay, status: "ready" as const };
  return { candidate: local, status: key && !day ? "loading" as const : "unavailable" as const };
}
