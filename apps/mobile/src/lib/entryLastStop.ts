import type { EntryLastStop, MobileTimeEntry } from "./api";
import type { DurableLocalWork } from "./durableLocalProjection";
import { isWaitingLockScreenStop } from "./durableLocalProjection";
import { TIME_ENTRY_DIAL_MAX_DURATION_MS, TIME_ENTRY_DIAL_MIN_DURATION_MS } from "./timeEntryDurationDial";

export function entryLastStopDay(startMs: number | null) {
  if (startMs === null || !Number.isFinite(startMs)) return null;
  const from = new Date(startMs);
  from.setHours(0, 0, 0, 0);
  const next = new Date(from);
  next.setDate(next.getDate() + 1);
  return { fromMs: from.getTime(), throughMs: next.getTime() - 1 };
}

export function eligibleLocalLastStops(entries: readonly MobileTimeEntry[]): EntryLastStop[] {
  return entries.flatMap((entry) => entry.stoppedAt && (entry.reviewStatus === "confirmed" || entry.reviewStatus === "accepted")
    ? [{ id: entry.id, stoppedAt: entry.stoppedAt }] : []);
}

export function latestEntryLastStop(candidates: readonly EntryLastStop[], input: {
  fromMs: number;
  throughMs: number;
  endMs: number;
  excludedIds: ReadonlySet<string>;
}) {
  if (![input.fromMs, input.throughMs, input.endMs].every(Number.isFinite)) return null;
  const earliest = Math.max(input.fromMs, input.endMs - TIME_ENTRY_DIAL_MAX_DURATION_MS);
  const latest = Math.min(input.throughMs, input.endMs - TIME_ENTRY_DIAL_MIN_DURATION_MS);
  let chosen: EntryLastStop | null = null;
  let chosenMs = -Infinity;
  for (const candidate of candidates) {
    const stop = Date.parse(candidate.stoppedAt);
    if (!Number.isFinite(stop) || stop < earliest || stop > latest || stop <= chosenMs || input.excludedIds.has(candidate.id)) continue;
    chosen = candidate;
    chosenMs = stop;
  }
  return chosen;
}

/** IDs whose published local projection should replace any older candidate from the server. */
export function lastStopProjectionIds(work: DurableLocalWork | null): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!work) return ids;
  const add = (id: string | undefined) => {
    if (!id) return;
    ids.add(id);
    const canonical = work.correlations.get(id);
    if (canonical) ids.add(canonical);
  };
  for (const command of work.timeEntryCommands) {
    if (command.failureKind === "permanent") continue;
    add(command.targetEntryId ?? command.optimisticEntryId);
    add(command.copy?.copyId);
  }
  for (const stop of work.timerStops) {
    if (stop.failureKind !== "permanent") add(stop.targetEntryId ?? stop.optimisticEntryId);
  }
  for (const event of work.activityEvents) {
    if (event.failureKind === "permanent") continue;
    if (event.type === "timer_start") add(event.localId);
    else if (isWaitingLockScreenStop(event)) add(event.rawPayload?.targetEntryId as string);
  }
  return ids;
}
