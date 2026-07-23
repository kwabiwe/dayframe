export type TimeEntryInterval = {
  startedAt: string;
  stoppedAt: string | null;
};

export type DateRange = {
  start: Date;
  end: Date;
};

export function entryOverlapsRange(
  entry: TimeEntryInterval,
  range: DateRange,
  capturedNow = new Date()
) {
  return entryOverlapSeconds(entry, range, capturedNow) > 0;
}

export function entryOverlapSeconds(
  entry: TimeEntryInterval,
  range: DateRange,
  capturedNow = new Date()
) {
  const startedAt = new Date(entry.startedAt).getTime();
  const stoppedAt = entry.stoppedAt
    ? new Date(entry.stoppedAt).getTime()
    : capturedNow.getTime();
  const rangeStart = range.start.getTime();
  const rangeEnd = range.end.getTime();

  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(stoppedAt) ||
    !Number.isFinite(rangeStart) ||
    !Number.isFinite(rangeEnd) ||
    rangeEnd <= rangeStart
  ) {
    return 0;
  }

  const overlapStart = Math.max(startedAt, rangeStart);
  const overlapEnd = Math.min(stoppedAt, rangeEnd);
  if (overlapEnd <= overlapStart) return 0;
  return Math.max(0, Math.round((overlapEnd - overlapStart) / 1000));
}
