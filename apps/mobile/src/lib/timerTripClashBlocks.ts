import { timerTripClashAsksOnBlock, timerTripClashQuestion, type TimerTripClashEntry } from "@dayframe/shared";
import type { MobileBootstrap, MobileReviewItem, MobileTimeEntry } from "./api";

/**
 * "A block ran into your trip" on the iPhone (location v4 design §7): the question asks on the block its payload
 * names, never on a row of its own. These are the pure parts the Dashboard composes: which blocks ask, and the
 * Calendar's data with an End it the server has not shown yet already applied.
 */

/** Every block the bootstrap carries, the running one included, by id. */
export function bootstrapBlocksById(data: MobileBootstrap | null | undefined) {
  const blocks = new Map<string, MobileTimeEntry>();
  if (!data) return blocks;
  for (const entry of [...(data.historyEntries ?? []), ...(data.entries ?? []), ...(data.weekEntries ?? []), ...(data.dayEntries ?? [])]) {
    blocks.set(entry.id, entry);
  }
  if (data.activeEntry) blocks.set(data.activeEntry.id, data.activeEntry);
  return blocks;
}

/** A block as the shared clash rule reads it (its activity's starter key from the bootstrap's activities). */
function clashEntryOf(entry: MobileTimeEntry, data: MobileBootstrap): TimerTripClashEntry {
  const starterKey = entry.categoryId ? data.categories.find((category) => category.id === entry.categoryId)?.starterKey ?? null : null;
  return {
    id: entry.id, startedAt: entry.startedAt, stoppedAt: entry.stoppedAt, source: entry.source, eventType: null,
    reviewStatus: entry.reviewStatus, categoryStarterKey: starterKey
  };
}

/**
 * Whether a clash item still asks, from the block as this iPhone has it now (queued edits, Stop and an End it
 * applied): a block not loaded here keeps asking (the server's question stands); one that no longer runs into the
 * trip stops at once. Items that are not clashes are not this rule's: true.
 */
export function clashStillAsksHere(item: MobileReviewItem, data: MobileBootstrap | null | undefined, now: number,
  blocks: ReadonlyMap<string, MobileTimeEntry> = bootstrapBlocksById(data)) {
  const question = timerTripClashQuestion(item);
  if (!question || !data) return true;
  const entry = blocks.get(question.timeEntryId);
  return timerTripClashAsksOnBlock(question, entry ? clashEntryOf(entry, data) : undefined, now);
}

/** The blocks with a "?" on them: block id → its clash item id (the first by id, if a block had two). */
export function clashChecksByBlock(items: readonly Pick<MobileReviewItem, "id" | "type" | "eventType" | "rawPayload">[]) {
  const byBlock = new Map<string, string>();
  for (const item of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
    const question = timerTripClashQuestion(item);
    if (question && !byBlock.has(question.timeEntryId)) byBlock.set(question.timeEntryId, item.id);
  }
  return byBlock;
}

/** Where End it ends each block it was answered for: the items answered yes here, and the outbox's own ends. */
export function clashEndsFor(
  items: readonly MobileReviewItem[],
  answeredYesIds: ReadonlySet<string>,
  pending: readonly { timeEntryId: string; tripStartedAt: string }[]
) {
  const ends = new Map<string, string>();
  for (const end of pending) ends.set(end.timeEntryId, end.tripStartedAt);
  for (const item of items) {
    if (!answeredYesIds.has(item.id)) continue;
    const question = timerTripClashQuestion(item);
    if (question) ends.set(question.timeEntryId, question.tripStartedAt);
  }
  return ends;
}

function endedAt(entry: MobileTimeEntry, at: string): MobileTimeEntry {
  const startMs = Date.parse(entry.startedAt), endMs = Date.parse(at);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return entry;
  // Only ever shortens: a block that already ends at or before the trip's start is as it is.
  if (entry.stoppedAt && Date.parse(entry.stoppedAt) <= endMs) return entry;
  return { ...entry, stoppedAt: new Date(endMs).toISOString(), durationSeconds: Math.round((endMs - startMs) / 1_000) };
}

/**
 * The Calendar's data with End it applied before the server shows it (held for Undo, saving, or waiting offline):
 * the block ends where the trip started, and a running block is no longer running there. Undo, or a refused answer,
 * drops it from `ends`, so the block is as it was. The same data when nothing applies.
 */
export function projectTimerTripClashEnds(data: MobileBootstrap | null, ends: ReadonlyMap<string, string>): MobileBootstrap | null {
  if (!data || !ends.size) return data;
  let changed = false;
  const apply = <T extends MobileTimeEntry[] | undefined>(entries: T): T => {
    if (!entries) return entries;
    let any = false;
    const next = entries.map((entry) => {
      const at = ends.get(entry.id);
      const projected = at ? endedAt(entry, at) : entry;
      if (projected !== entry) any = true;
      return projected;
    });
    if (any) changed = true;
    return (any ? next : entries) as T;
  };
  const at = data.activeEntry ? ends.get(data.activeEntry.id) : undefined;
  const running = data.activeEntry && at ? endedAt(data.activeEntry, at) : data.activeEntry;
  const stopped = Boolean(data.activeEntry && running !== data.activeEntry);
  const entries = apply(data.entries) ?? [];
  const projected: MobileBootstrap = {
    ...data,
    entries: stopped && running && !entries.some((entry) => entry.id === running.id) ? [running, ...entries] : entries,
    historyEntries: apply(data.historyEntries),
    weekEntries: apply(data.weekEntries),
    dayEntries: apply(data.dayEntries),
    activeEntry: stopped ? null : data.activeEntry
  };
  return changed || stopped ? projected : data;
}
