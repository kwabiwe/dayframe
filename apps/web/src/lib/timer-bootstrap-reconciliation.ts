import type { BootstrapData, TimeEntryRow } from "@/lib/queries";

export type BootstrapCommitSource = "cache" | "canonical" | "hydrate" | "optimistic";

/**
 * Keeps stale RSC/cache payloads from replacing a newer active-entry version.
 * Canonical fetches may change the active id or stop the timer; passive sources
 * retain the shell's current active owner until the canonical refresh arrives.
 */
export function reconcileTimerBootstrap(
  current: BootstrapData | null,
  incoming: BootstrapData,
  source: BootstrapCommitSource
): BootstrapData {
  if (!current || source === "optimistic" || current.workspace.id !== incoming.workspace.id) {
    return incoming;
  }

  const currentActive = current.activeEntry;
  const incomingActive = incoming.activeEntry;

  if (currentActive && incomingActive?.id === currentActive.id) {
    return isNewer(currentActive, incomingActive)
      ? withEntry(incoming, currentActive, true)
      : incoming;
  }

  if (incomingActive && !currentActive) {
    const completed = currentEntryById(current, incomingActive.id);
    if (completed?.stoppedAt && !isNewer(incomingActive, completed)) {
      return withEntry(incoming, completed, false);
    }
  }

  if ((source === "hydrate" || source === "cache") && currentActive) {
    return withEntry(incoming, currentActive, true);
  }

  return incoming;
}

function isNewer(left: TimeEntryRow, right: TimeEntryRow) {
  return Date.parse(left.updatedAt) > Date.parse(right.updatedAt);
}

function currentEntryById(data: BootstrapData, id: string) {
  return [data.activeEntry, ...data.entries, ...data.dayEntries, ...data.weekEntries]
    .find((entry): entry is TimeEntryRow => entry?.id === id);
}

function withEntry(data: BootstrapData, entry: TimeEntryRow, active: boolean): BootstrapData {
  return {
    ...data,
    activeEntry: active ? entry : null,
    entries: replaceEntry(data.entries, entry),
    historyEntries: replaceEntry(data.historyEntries, entry),
    dayEntries: replaceEntry(data.dayEntries, entry),
    weekEntries: replaceEntry(data.weekEntries, entry)
  };
}

function replaceEntry(entries: TimeEntryRow[], entry: TimeEntryRow) {
  const index = entries.findIndex((candidate) => candidate.id === entry.id);
  if (index < 0) return entries;
  return entries.map((candidate, candidateIndex) => candidateIndex === index ? entry : candidate);
}
