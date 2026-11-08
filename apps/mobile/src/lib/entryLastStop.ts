import type { EntryLastStop, MobileTimeEntry } from "./api";
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

/** Actual timing changes from the last raw bootstrap to the current, locally projected view. */
export function projectedLastStopIds(
  canonical: readonly MobileTimeEntry[],
  visible: readonly MobileTimeEntry[]
): ReadonlySet<string> {
  const before = new Map(eligibleLocalLastStops(canonical).map((row) => [row.id, Date.parse(row.stoppedAt)]));
  const after = new Map(eligibleLocalLastStops(visible).map((row) => [row.id, Date.parse(row.stoppedAt)]));
  const changed = new Set<string>();
  for (const [id, stop] of before) {
    if (after.get(id) !== stop) changed.add(id);
  }
  for (const [id, stop] of after) {
    if (before.get(id) !== stop) changed.add(id);
  }
  return changed;
}
