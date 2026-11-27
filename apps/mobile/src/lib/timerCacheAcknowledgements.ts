import AsyncStorage from "@react-native-async-storage/async-storage";
import type { MobileTimeEntry, TimeEntryUpdatePatch } from "./api";
import type { MobileAccountOwner } from "./mobileAccount";

type StartedBlock = Pick<MobileTimeEntry, "id" | "projectId" | "categoryId" | "description" | "source" | "startedAt" | "tagNames">;

export type TimerCacheEffect =
  | { kind: "entry"; entry: MobileTimeEntry }
  | { kind: "start"; block: StartedBlock }
  | { kind: "stop"; entryId: string; stoppedAt: string }
  | { kind: "edit"; entryId: string; patch: TimeEntryUpdatePatch; expectedUpdatedAt?: string; updatedAt?: string }
  | { kind: "delete"; entryId: string; optimisticEntryId?: string };

export type TimerCacheAcknowledgement = { commandId: string; revision: number; effect: TimerCacheEffect };

export function timerCacheEntryEffect(entryId: string, value: unknown): TimerCacheEffect | undefined {
  if (value === null) return { kind: "delete", entryId };
  const entry = value as MobileTimeEntry | undefined;
  if (entry?.id === entryId && Number.isFinite(Date.parse(entry.startedAt)) &&
    (entry.stoppedAt === null || Number.isFinite(Date.parse(entry.stoppedAt))) && Array.isArray(entry.tagNames)) {
    return { kind: "entry", entry };
  }
  return undefined;
}

type Acknowledgements = {
  revision: number;
  cachedThrough: number;
  records: TimerCacheAcknowledgement[];
};

const MAX_RECORDS = 256;
const EMPTY: Acknowledgements = { revision: 0, cachedThrough: 0, records: [] };
let writeTail: Promise<unknown> = Promise.resolve();

function storageKey(owner: MobileAccountOwner) {
  return `dayframe.timerCacheAcknowledgements.v1:${encodeURIComponent(owner.workspaceId)}:${encodeURIComponent(owner.userId)}`;
}

function serialise<T>(work: () => Promise<T>) {
  const operation = writeTail.then(work, work);
  writeTail = operation.catch(() => undefined);
  return operation;
}

async function read(owner: MobileAccountOwner): Promise<Acknowledgements> {
  const raw = await AsyncStorage.getItem(storageKey(owner));
  if (!raw) return EMPTY;
  const value: Acknowledgements = JSON.parse(raw);
  if (!Number.isSafeInteger(value?.revision) || value.revision < 0 ||
    !Number.isSafeInteger(value.cachedThrough) || value.cachedThrough < 0 ||
    value.cachedThrough > value.revision || !Array.isArray(value.records)) {
    throw new Error("Dayframe couldn't read locally saved block changes.");
  }
  return value;
}

export async function readTimerCacheAcknowledgements(owner: MobileAccountOwner) {
  return (await read(owner)).records;
}

/** Capture before the Bootstrap request, so a late response cannot hide a newer local receipt. */
export async function readTimerCacheRevision(owner: MobileAccountOwner) {
  return (await read(owner)).revision;
}

/** Persist before dropping the delivery intent. If persistence fails the same command can replay. */
export function acknowledgeTimerCacheEffect(owner: MobileAccountOwner, commandId: string, effect: TimerCacheEffect) {
  return serialise(async () => {
    const current = await read(owner);
    if (current.records.some((record) => record.commandId === commandId)) return;
    await writeAcknowledgement(owner, current, commandId, effect);
  });
}

/** Replace an older receipt when replay confirms that its Start no longer owns a block. */
export function acknowledgeSupersededTimerStart(owner: MobileAccountOwner, localId: string, correlatedId?: string) {
  return serialise(async () => {
    const current = await read(owner);
    const previous = current.records.find((record) => record.commandId === localId)?.effect;
    if (previous?.kind === "delete" && previous.optimisticEntryId === localId) return previous.entryId;
    const previousId = previous?.kind === "entry" ? previous.entry.id :
      previous?.kind === "start" ? previous.block.id : previous?.kind === "delete" ? previous.entryId : undefined;
    const entryId = previousId ?? correlatedId ?? localId;
    await writeAcknowledgement(owner, current, localId, { kind: "delete", entryId, optimisticEntryId: localId });
    return entryId;
  });
}

async function writeAcknowledgement(owner: MobileAccountOwner, current: Acknowledgements, commandId: string, effect: TimerCacheEffect) {
  const revision = current.revision + 1;
  let records = current.records.filter((record) => record.commandId !== commandId);
  if (records.length >= MAX_RECORDS) {
    // Keep recent receipts for reads already in flight. Compact only records a durable cache has covered.
    const uncached = records.filter((record) => record.revision > current.cachedThrough);
    if (uncached.length >= MAX_RECORDS) throw new Error("Dayframe needs to refresh before confirming another block change.");
    records = records.slice(-(MAX_RECORDS - 1));
  }
  await AsyncStorage.setItem(storageKey(owner), JSON.stringify({
    revision, cachedThrough: current.cachedThrough, records: [...records, { commandId, revision, effect }]
  }));
}

/** A cache write proves that older receipts can be compacted without losing offline state. */
export function markTimerCacheSnapshotPersisted(owner: MobileAccountOwner, revision: number) {
  if (!revision) return Promise.resolve();
  return serialise(async () => {
    const current = await read(owner);
    if (revision > current.revision || revision <= current.cachedThrough) return;
    await AsyncStorage.setItem(storageKey(owner), JSON.stringify({ ...current, cachedThrough: revision }));
  });
}
