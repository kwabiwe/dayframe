import type { TimeEntryRow } from "@/lib/queries";
import { entryOverlapSeconds, entryOverlapsRange, type DateRange } from "@/lib/time-entry-overlap";

export function mergeTimelineEntries(
  ...collections: ReadonlyArray<ReadonlyArray<TimeEntryRow>>
) {
  const entries = new Map<string, TimeEntryRow>();
  for (const collection of collections) {
    for (const entry of collection) entries.set(entry.id, entry);
  }
  return [...entries.values()];
}

export function clipTimelineEntries(
  entries: ReadonlyArray<TimeEntryRow>,
  range: DateRange,
  capturedNow: Date
) {
  return entries
    .filter((entry) => entryOverlapsRange(entry, range, capturedNow))
    .map((entry) => ({
      ...entry,
      durationSeconds: entryOverlapSeconds(entry, range, capturedNow)
    }))
    .filter((entry) => entry.durationSeconds > 0)
    .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime());
}

export function timelineEntryDisplayInterval(
  entry: Pick<TimeEntryRow, "startedAt" | "stoppedAt">,
  displayRange: DateRange | undefined,
  capturedNow: Date
) {
  if (!displayRange) {
    return {
      startedAt: entry.startedAt,
      stoppedAt: entry.stoppedAt
    };
  }

  const entryStart = new Date(entry.startedAt);
  const entryEnd = entry.stoppedAt ? new Date(entry.stoppedAt) : capturedNow;
  const displayStart = new Date(Math.max(entryStart.getTime(), displayRange.start.getTime()));
  const displayEnd = new Date(Math.min(entryEnd.getTime(), displayRange.end.getTime()));
  const reachesCapturedNow = !entry.stoppedAt && displayEnd.getTime() >= capturedNow.getTime();

  return {
    startedAt: displayStart.toISOString(),
    stoppedAt: reachesCapturedNow ? null : displayEnd.toISOString()
  };
}
