import type { BootstrapData, TimeEntryRow } from "@/lib/queries";

/** The shell's data with these blocks ended where End it ends them: a running one leaves `activeEntry`. */
export function projectBlockEnds(data: BootstrapData | null, ends: ReadonlyMap<string, string>): BootstrapData | null {
  if (!data || !ends.size) return data;
  const end = <T extends TimeEntryRow>(entry: T): T => {
    const endsAt = ends.get(entry.id);
    if (!endsAt || (entry.stoppedAt !== null && Date.parse(entry.stoppedAt) <= Date.parse(endsAt))) return entry;
    return { ...entry, stoppedAt: endsAt, durationSeconds: Math.max(0, Math.round((Date.parse(endsAt) - Date.parse(entry.startedAt)) / 1000)) };
  };
  const ended = data.activeEntry && ends.has(data.activeEntry.id) ? end(data.activeEntry) : null;
  const withEnded = (entries: TimeEntryRow[]) => {
    const list = entries.map(end);
    return ended && !list.some((entry) => entry.id === ended.id) ? [ended, ...list] : list;
  };
  return {
    ...data,
    activeEntry: ended ? null : data.activeEntry,
    entries: withEnded(data.entries),
    dayEntries: data.dayEntries.map(end),
    weekEntries: data.weekEntries.map(end),
    historyEntries: data.historyEntries.map(end)
  };
}
