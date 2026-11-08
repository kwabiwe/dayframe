import { splitBounds } from "@dayframe/shared";
import type { MobileBootstrap, MobileTimeEntry } from "./api";
import type { PendingCompletedEntryCopy } from "./timeEntryOutbox";
import { mobileTimeEntryById, optimisticPatchTimeEntry } from "./timerPresentation";

const DAY_MS = 86_400_000;

export function projectCompletedEntryCopy(
  data: MobileBootstrap,
  entryId: string,
  copy: PendingCompletedEntryCopy
) {
  // A fresh bootstrap may already have the copy, or the original may have changed.
  // Duplicate advances the original's version as well, so a deleted copy stays deleted.
  const original = mobileTimeEntryById(data, entryId);
  if (!original?.stoppedAt || !original.updatedAt ||
      Date.parse(original.updatedAt) !== Date.parse(copy.expectedUpdatedAt) ||
      mobileTimeEntryById(data, copy.copyId)) {
    return data;
  }

  const startMs = Date.parse(original.startedAt);
  const endMs = Date.parse(original.stoppedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return data;
  let copyStart = endMs;
  let copyEnd = endMs + (endMs - startMs);
  let projected = data;
  if (copy.action.kind === "split") {
    copyStart = Date.parse(copy.action.splitAt);
    const bounds = splitBounds(original);
    if (!bounds || !Number.isFinite(copyStart) || copyStart < bounds.minMs || copyStart > bounds.maxMs) return data;
    copyEnd = endMs;
    projected = optimisticPatchTimeEntry(data, entryId, { stoppedAt: copy.action.splitAt }) ?? data;
  }

  const entry: MobileTimeEntry = {
    ...original,
    id: copy.copyId,
    startedAt: new Date(copyStart).toISOString(),
    stoppedAt: new Date(copyEnd).toISOString(),
    durationSeconds: Math.round((copyEnd - copyStart) / 1000),
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    updatedAt: undefined,
    confirmedInReview: undefined,
    ownerAuthoredInReview: undefined,
    locationGroup: undefined,
    automaticMoveEventId: undefined
  };
  const range = projected.dateRange;
  function inRange(entries: MobileTimeEntry[] | undefined, from?: number, until?: number) {
    if (!entries) return entries;
    const containsCopy = from !== undefined && until !== undefined
      ? copyStart < until && copyEnd > from
      : entries.some((candidate) => candidate.id === entryId);
    const shortened = copy.action.kind === "split" && from !== undefined && copyStart <= from
      ? entries.filter((candidate) => candidate.id !== entryId)
      : entries;
    return containsCopy ? insertByStart(shortened) : shortened;
  }

  function insertByStart(entries: MobileTimeEntry[]) {
    const next = entries.findIndex((candidate) =>
      candidate.startedAt < entry.startedAt ||
      (candidate.startedAt === entry.startedAt && candidate.id < entry.id)
    );
    return next < 0 ? [...entries, entry] : [...entries.slice(0, next), entry, ...entries.slice(next)];
  }

  const dayStart = range ? Date.parse(range.dayStart) : undefined;
  const dayEnd = range ? Date.parse(range.dayEnd) : undefined;
  return {
    ...projected,
    entries: insertByStart(projected.entries),
    historyEntries: inRange(projected.historyEntries, dayStart === undefined ? undefined : dayStart - 59 * DAY_MS, dayEnd),
    dayEntries: inRange(projected.dayEntries, dayStart, dayEnd),
    weekEntries: inRange(projected.weekEntries, range ? Date.parse(range.weekStart) : undefined, range ? Date.parse(range.weekEnd) : undefined)
  };
}
