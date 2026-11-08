import { splitBounds } from "@dayframe/shared";
import type { MobileBootstrap, MobileTimeEntry } from "./api";
import type { PendingCompletedEntryCopy } from "./timeEntryOutbox";
import {
  mobileTimeEntryById, optimisticDeleteTimeEntry, optimisticPatchTimeEntry, optimisticRestoreTimeEntries
} from "./timerPresentation";

const DAY_MS = 86_400_000;

export function projectCompletedEntryCopy(
  data: MobileBootstrap,
  entryId: string,
  copy: PendingCompletedEntryCopy,
  linkedSource?: MobileTimeEntry,
  removedOnServer = false
) {
  if (removedOnServer && mobileTimeEntryById(data, copy.copyId)) {
    data = optimisticDeleteTimeEntry(data, copy.copyId) ?? data;
  }
  if (removedOnServer && copy.action.kind === "duplicate") return data;
  if (removedOnServer) data = setPendingCompletedCopy(data, entryId, false);
  // A fresh bootstrap may already have the copy, or the original may have changed.
  // Duplicate advances the original's version as well, so a deleted copy stays deleted.
  const original = mobileTimeEntryById(data, entryId) ?? linkedSource;
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
    if (!removedOnServer) projected = setPendingCompletedCopy(projected, entryId, true);
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
    pendingCompletedCopy: true,
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
    return containsCopy && !removedOnServer ? insertCompletedEntry(shortened, entry) : shortened;
  }

  const dayStart = range ? Date.parse(range.dayStart) : undefined;
  const dayEnd = range ? Date.parse(range.dayEnd) : undefined;
  return {
    ...projected,
    entries: removedOnServer ? projected.entries : insertCompletedEntry(projected.entries, entry),
    historyEntries: inRange(projected.historyEntries, dayStart === undefined ? undefined : dayStart - 59 * DAY_MS, dayEnd),
    dayEntries: inRange(projected.dayEntries, dayStart, dayEnd),
    weekEntries: inRange(projected.weekEntries, range ? Date.parse(range.weekStart) : undefined, range ? Date.parse(range.weekEnd) : undefined)
  };
}

function setPendingCompletedCopy(data: MobileBootstrap, entryId: string, pending: boolean) {
  const entry = mobileTimeEntryById(data, entryId);
  if (!entry || Boolean(entry.pendingCompletedCopy) === pending) return data;
  const mark = (items: MobileTimeEntry[] | undefined) => items?.map((item) =>
    item.id === entryId ? { ...item, pendingCompletedCopy: pending ? true as const : undefined } : item
  );
  return {
    ...data,
    entries: mark(data.entries) ?? data.entries,
    historyEntries: mark(data.historyEntries),
    dayEntries: mark(data.dayEntries),
    weekEntries: mark(data.weekEntries)
  };
}

function insertCompletedEntry(entries: MobileTimeEntry[], entry: MobileTimeEntry) {
  if (entries.some((candidate) => candidate.id === entry.id)) return entries;
  const next = entries.findIndex((candidate) =>
    candidate.startedAt < entry.startedAt ||
    (candidate.startedAt === entry.startedAt && candidate.id < entry.id)
  );
  return next < 0 ? [...entries, entry] : [...entries.slice(0, next), entry, ...entries.slice(next)];
}

function restoreCompletedEntryRanges(data: MobileBootstrap, entry: MobileTimeEntry) {
  const range = data.dateRange;
  if (!range || !entry.stoppedAt) return data;
  const start = Date.parse(entry.startedAt);
  const end = Date.parse(entry.stoppedAt);
  const dayStart = Date.parse(range.dayStart);
  const dayEnd = Date.parse(range.dayEnd);
  const put = (items: MobileTimeEntry[] | undefined, from: number, until: number) =>
    items && start < until && end > from ? insertCompletedEntry(items, entry) : items;
  return {
    ...data,
    historyEntries: put(data.historyEntries, dayStart - 59 * DAY_MS, dayEnd),
    dayEntries: put(data.dayEntries, dayStart, dayEnd),
    weekEntries: put(data.weekEntries, Date.parse(range.weekStart), Date.parse(range.weekEnd))
  };
}

/** Roll back just this provisional copy and its split end, even when a fresh read is unavailable. */
export function rollbackRejectedCompletedCopy(
  data: MobileBootstrap,
  baseline: MobileBootstrap | null,
  entryId: string,
  copy: PendingCompletedEntryCopy,
  originalDeletedLocally: boolean
) {
  const provisional = mobileTimeEntryById(data, copy.copyId);
  const wasProvisional = provisional !== null && !provisional.updatedAt;
  let next = wasProvisional ? optimisticDeleteTimeEntry(data, copy.copyId) ?? data : data;
  if (copy.action.kind !== "split" || originalDeletedLocally) return next;
  const shown = mobileTimeEntryById(next, entryId);
  const matchesVersion = (entry: MobileTimeEntry) =>
    Date.parse(entry.updatedAt ?? "") === Date.parse(copy.expectedUpdatedAt);
  if (shown && (!matchesVersion(shown) || shown.stoppedAt !== copy.action.splitAt)) return next;
  if (!shown && !wasProvisional) return next;
  const scopedBaseline = baseline && data.user.id === baseline.user.id && data.workspace.id === baseline.workspace.id
    ? baseline : null;
  const saved = scopedBaseline ? mobileTimeEntryById(scopedBaseline, entryId) : null;
  const matchingSaved = saved && matchesVersion(saved) ? saved : null;
  const previousEnd = matchingSaved?.stoppedAt ?? copy.originalStoppedAt;
  if (!previousEnd) return next;
  next = optimisticPatchTimeEntry(next, entryId, { stoppedAt: previousEnd }) ?? next;
  next = setPendingCompletedCopy(next, entryId, false);
  if (scopedBaseline && matchingSaved && data.dateRange?.selectedDate === scopedBaseline.dateRange?.selectedDate) {
    // A split exactly at a day boundary can remove the first half from that day's collection.
    const restored = mobileTimeEntryById(next, entryId);
    const preserveNewDrafts = (items: MobileTimeEntry[] | undefined) =>
      items?.map((item) => item.id === entryId && restored ? restored : item);
    next = optimisticRestoreTimeEntries(next, {
      ...scopedBaseline,
      entries: preserveNewDrafts(scopedBaseline.entries) ?? scopedBaseline.entries,
      historyEntries: preserveNewDrafts(scopedBaseline.historyEntries),
      dayEntries: preserveNewDrafts(scopedBaseline.dayEntries),
      weekEntries: preserveNewDrafts(scopedBaseline.weekEntries)
    }, [entryId]) ?? next;
  } else {
    const restored = mobileTimeEntryById(next, entryId);
    if (restored) next = restoreCompletedEntryRanges(next, restored);
  }
  return next;
}
