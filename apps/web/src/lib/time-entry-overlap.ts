import { analyzeTimeIntervals } from "@dayframe/shared";

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
  return analyzeTimeIntervals(
    [{ id: "entry", ...entry }],
    {
      range: { start: range.start, end: range.end },
      now: capturedNow
    }
  ).loggedSeconds;
}
