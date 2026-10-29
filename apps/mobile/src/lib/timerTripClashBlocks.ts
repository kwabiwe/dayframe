import { isTimerTripClashItem, timerTripClashAsksOnBlock, timerTripClashQuestion, type TimerTripClashEntry } from "@dayframe/shared";
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
 * Whether a "?" still asks where it is answered (location v4 design §7). Anything that is not a block that ran into a
 * trip: true. A clash asks only when it can be put on its block (its payload names it: the bootstrap's, or a
 * presentation record's `timerTripClash` past the bootstrap's cap, #621; one with none or a malformed one is never
 * counted without a surface to answer it, Codex r1 on #618), and only
 * while that block, as this iPhone has it now (queued edits, Stop and End it applied), still runs into the trip. A
 * block not loaded here keeps asking (the server's question stands); one deleted on this iPhone (`deletedIds`: held
 * for Undo or queued) stops at once.
 */
export function clashStillAsksHere(item: MobileReviewItem, data: MobileBootstrap | null | undefined, now: number,
  blocks: ReadonlyMap<string, MobileTimeEntry> = bootstrapBlocksById(data), deletedIds: ReadonlySet<string> = new Set()) {
  if (!isTimerTripClashItem(item)) return true;
  const question = timerTripClashQuestion(item);
  if (!question || !data) return false;
  if (deletedIds.has(question.timeEntryId)) return timerTripClashAsksOnBlock(question, null, now);
  const entry = blocks.get(question.timeEntryId);
  return timerTripClashAsksOnBlock(question, entry ? clashEntryOf(entry, data) : undefined, now);
}

/** The blocks deleted on this iPhone and not yet gone from the server: held for Undo, or a queued delete. */
export function locallyDeletedBlockIds(
  heldIds: readonly string[],
  commands: readonly { operation: string; targetEntryId?: string; optimisticEntryId?: string; failureKind?: string }[]
) {
  const ids = new Set(heldIds);
  for (const command of commands) {
    if (command.operation !== "delete" || command.failureKind === "permanent") continue;
    if (command.targetEntryId) ids.add(command.targetEntryId);
    if (command.optimisticEntryId) ids.add(command.optimisticEntryId);
  }
  return ids;
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

/**
 * The block every Start guard treats as running (Codex r2 on #618): the canonical running block, unless it is being
 * deleted (held for Undo) or End it has ended it on this iPhone (held or queued). Then nothing is running here: the
 * orb's tap starts a bare block (never opens its editor), a quick start never says "Already recording" for it, and
 * a matching activity starts a new block. Persistence and mutations keep reading the canonical data.
 */
export function runningForStart<T extends { id: string }>(canonical: T | null | undefined,
  options: { pendingDeletion?: boolean; clashEndedId?: string | null }) {
  if (!canonical || options.pendingDeletion) return null;
  return options.clashEndedId && canonical.id === options.clashEndedId ? null : canonical;
}

type DeleteCommand = { operation: string; targetEntryId?: string; optimisticEntryId?: string; failureKind?: string };

const commandBlockIds = (command: DeleteCommand) => [command.targetEntryId, command.optimisticEntryId].filter((id): id is string => Boolean(id));

/**
 * What this iPhone knows it deleted (Codex r2 and r3 on #618), for one account (the Dashboard makes a new one on an
 * account switch): blocks with a queued delete, and blocks whose delete the server acknowledged (`delivered`) until
 * server data read after that is applied. A delete cancelled before delivery (Undo, Discard) is no tombstone at
 * all: it leaves with its command. A delete the server refused for good is none either: its block is restored.
 */
export function createDeleteTombstones() {
  let queued = new Set<string>();
  const delivered = new Map<string, number>();
  return {
    /** The outbox's commands as read now: a delete gone from them without `delivered` was cancelled. */
    observe(commands: readonly DeleteCommand[]) {
      queued = locallyDeletedBlockIds([], commands);
      for (const command of commands) {
        if (command.operation === "delete" && command.failureKind === "permanent") for (const id of commandBlockIds(command)) delivered.delete(id);
      }
    },
    /** The server acknowledged this delete (the outbox says so before it removes the command). */
    delivered(command: DeleteCommand, nowMs: number) {
      for (const id of commandBlockIds(command)) delivered.set(id, nowMs);
    },
    /**
     * A server bootstrap read that started at `startedAtMs` was applied (accepted by the refresh guard and published):
     * the deletes delivered before that read started are now the server's to show. A read discarded by the guard, or
     * one that failed, is never reported.
     */
    applied(startedAtMs: number) {
      let changed = false;
      for (const [id, deliveredAt] of delivered) {
        if (startedAtMs >= deliveredAt) {
          delivered.delete(id);
          changed = true;
        }
      }
      return changed;
    },
    ids(): ReadonlySet<string> {
      return new Set([...queued, ...delivered.keys()]);
    }
  };
}

type AcknowledgedEnd = { clientMutationId: string; timeEntryId: string; tripStartedAt: string; acknowledged: boolean };

/** Whether applied server data shows End it's end: the block no longer running, and ended by the trip's start. */
function endShownIn(data: MobileBootstrap, end: Pick<AcknowledgedEnd, "timeEntryId" | "tripStartedAt">) {
  if (data.activeEntry?.id === end.timeEntryId) return false;
  const entry = bootstrapBlocksById(data).get(end.timeEntryId);
  if (!entry) return true;
  return entry.stoppedAt != null && Date.parse(entry.stoppedAt) <= Date.parse(end.tripStartedAt) + 1_000;
}

/**
 * Acknowledged End it answers still shown on this iPhone (Codex r3 and r4 on #618), for one account. The ledger keeps
 * each acknowledged end itself, apart from the outbox record (which a presentation handover may delete), and it keeps
 * showing until server data that confirms it is applied — a bootstrap whose read started after the
 * acknowledgement was seen, or one that already shows the block ended (`endShownIn`). Never on a mere change of the
 * data the Dashboard holds (a local edit, a failed refresh).
 */
export function createAcknowledgedEndLedger() {
  const seen = new Map<string, AcknowledgedEnd & { seenAt: number }>();
  const retired = new Set<string>();
  return {
    /** The outbox's End it answers as read now. */
    observe(ends: readonly AcknowledgedEnd[], nowMs: number) {
      for (const end of ends) if (end.acknowledged && !seen.has(end.clientMutationId)) seen.set(end.clientMutationId, { ...end, seenAt: nowMs });
    },
    /**
     * The ends to show: the outbox's waiting ones, and every acknowledged one this ledger holds and applied server data
     * has not confirmed yet — whether or not the outbox still has its record (a presentation handover deletes it;
     * Codex r4 on #618).
     */
    live(ends: readonly AcknowledgedEnd[]): AcknowledgedEnd[] {
      const held = [...seen.values()].filter((end) => !retired.has(end.clientMutationId))
        .map(({ clientMutationId, timeEntryId, tripStartedAt }) => ({ clientMutationId, timeEntryId, tripStartedAt, acknowledged: true }));
      const heldIds = new Set(held.map((end) => end.clientMutationId));
      return [...ends.filter((end) => !end.acknowledged && !heldIds.has(end.clientMutationId)), ...held];
    },
    /** Applied server data (a bootstrap read that started at `startedAtMs`): whether it confirmed any end. */
    applied(startedAtMs: number, data: MobileBootstrap) {
      let changed = false;
      for (const [id, end] of seen) {
        if (retired.has(id) || !(startedAtMs >= end.seenAt || endShownIn(data, end))) continue;
        retired.add(id);
        changed = true;
      }
      return changed;
    }
  };
}
