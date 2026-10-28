import AsyncStorage from "@react-native-async-storage/async-storage";
import { mobileAccountOwnersEqual, type MobileAccountOwner } from "./mobileAccount";
import type { ReviewAnswerVenue } from "./reviewAnswer";

/**
 * Answers waiting for corrections (owner, 28 Oct 2026; Codex r2 on #610): a "?" answered from its sheet while the
 * sheet had changes of its own. One tap keeps the changes (the timeline correction outbox, shown at once in the
 * List) and the answer; the answer is held here, on the phone, until the server has acknowledged every one of
 * those corrections, and only then goes into the Review outbox (the deck's own path). So the answer can never
 * reach the server before its corrections: it is in no queue that sends until they are acknowledged.
 *
 * - Each record waits for its corrections by `clientCorrectionId`. The correction outbox marks an id acknowledged
 *   here before it lets go of its own copy (`noteTimelineCorrectionAcknowledged`), so an id that has left the
 *   outbox without being marked was refused or discarded: the answer is dropped and the "?" stays.
 * - A refusal marks the record (`noteTimelineCorrectionRefused`); the List says "That change wasn't saved." as it
 *   does for every refused correction.
 * - A record is kept `held` before its corrections are queued, while the 4.8 s Undo runs; Undo removes it, the
 *   end of Undo commits it. A held record from an earlier run of the app (killed during Undo) is dropped, as a
 *   held answer is.
 * - Owner-scoped; logout clears this account's records with its corrections.
 *
 * Holds review item ids, correction ids, an answer and a venue's name; never coordinates.
 */

const KEY = "dayframe.reviewAnswersAfterCorrections.v1";

export type AnswerAfterCorrections = MobileAccountOwner & {
  /** The Review mutation's own id, so a release repeated after a crash is answered once. */
  id: string;
  /** The "?" it answers ("" for a Logs as without one). */
  reviewItemId: string;
  logged: boolean;
  venue?: ReviewAnswerVenue | null;
  /**
   * A Logs as instead of an answer (Codex r4 on #610): `log_place` for this place with this activity, queued only
   * once the sheet's corrections are acknowledged; its `id` is the log's own `clientCorrectionId`.
   */
  log?: { itemId: string; categoryId: string };
  /** The corrections it waits for, and those the server has acknowledged. */
  waitsFor: string[];
  acknowledged: string[];
  refused?: boolean;
  /** Still in its Undo window, in the run of the app `run` names. */
  held?: { run: string };
  createdAt: string;
};

/** This run of the app: a held record from another run lost its Undo window with it. */
let run = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const listeners = new Set<() => void>();
let tail: Promise<void> = Promise.resolve();
function serialised<T>(work: () => Promise<T>): Promise<T> {
  const next = tail.then(work, work);
  tail = next.then(() => undefined, () => undefined);
  return next;
}
function notify() {
  for (const listener of listeners) listener();
}

export function subscribeAnswersAfterCorrections(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function parse(value: unknown): AnswerAfterCorrections | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const strings = (list: unknown) => Array.isArray(list) && list.every((each) => typeof each === "string") ? list as string[] : null;
  const waitsFor = strings(item.waitsFor);
  const acknowledged = strings(item.acknowledged);
  if (typeof item.userId !== "string" || typeof item.workspaceId !== "string" || typeof item.id !== "string"
    || typeof item.reviewItemId !== "string" || typeof item.logged !== "boolean" || !waitsFor || !waitsFor.length || !acknowledged
    || typeof item.createdAt !== "string") return null;
  const venue = item.venue && typeof item.venue === "object" && typeof (item.venue as { name?: unknown }).name === "string"
    ? item.venue as ReviewAnswerVenue : null;
  const held = item.held && typeof item.held === "object" && typeof (item.held as { run?: unknown }).run === "string"
    ? { run: (item.held as { run: string }).run } : undefined;
  const rawLog = item.log as { itemId?: unknown; categoryId?: unknown } | undefined;
  const log = rawLog && typeof rawLog === "object" && typeof rawLog.itemId === "string" && typeof rawLog.categoryId === "string"
    ? { itemId: rawLog.itemId, categoryId: rawLog.categoryId } : undefined;
  return {
    userId: item.userId, workspaceId: item.workspaceId, id: item.id, reviewItemId: item.reviewItemId, logged: item.logged,
    ...(venue ? { venue } : {}), ...(log ? { log } : {}), waitsFor, acknowledged, ...(item.refused === true ? { refused: true } : {}),
    ...(held ? { held } : {}), createdAt: item.createdAt
  };
}

async function readAll(): Promise<AnswerAfterCorrections[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.flatMap((each) => parse(each) ?? []) : [];
  } catch {
    return [];
  }
}

async function writeAll(items: readonly AnswerAfterCorrections[]) {
  if (items.length) await AsyncStorage.setItem(KEY, JSON.stringify(items));
  else await AsyncStorage.removeItem(KEY);
}

/** Writes (and tells listeners) only when something changed, so the correction outbox's notes cost nothing idle. */
async function update(change: (items: AnswerAfterCorrections[]) => AnswerAfterCorrections[]) {
  const changed = await serialised(async () => {
    const items = await readAll();
    const next = change(items);
    if (JSON.stringify(next) === JSON.stringify(items)) return false;
    await writeAll(next);
    return true;
  });
  if (changed) notify();
}

/** This owner's waiting answers. */
export async function readAnswersAfterCorrections(owner: MobileAccountOwner) {
  return (await serialised(readAll)).filter((item) => mobileAccountOwnersEqual(item, owner));
}

/**
 * Keeps an answer that waits for `waitsFor`, held for Undo. Called before those corrections are queued, so their
 * acknowledgement always finds it.
 */
export async function holdAnswerAfterCorrections(owner: MobileAccountOwner,
  answer: { id: string; reviewItemId: string; logged: boolean; venue?: ReviewAnswerVenue | null; log?: { itemId: string; categoryId: string };
    waitsFor: readonly string[] }, now = new Date()) {
  if (!answer.waitsFor.length) throw new Error("An answer after corrections needs its corrections.");
  const record: AnswerAfterCorrections = {
    userId: owner.userId, workspaceId: owner.workspaceId, id: answer.id, reviewItemId: answer.reviewItemId, logged: answer.logged,
    ...(answer.venue ? { venue: answer.venue } : {}), ...(answer.log ? { log: answer.log } : {}), waitsFor: [...answer.waitsFor],
    acknowledged: [], held: { run },
    createdAt: now.toISOString()
  };
  await update((items) => [...items.filter((item) => item.id !== record.id), record]);
  return record;
}

/** The correction queue as a waiting record reads it (its stored copy, and its memory of recent acknowledgements). */
export type AfterCorrectionsQueue = {
  readPending: (owner: MobileAccountOwner) => Promise<ReadonlyArray<{ clientCorrectionId: string; failureKind?: string;
    request: { kind: string; itemId: string } }>>;
  readAcknowledged: (owner: MobileAccountOwner) => ReadonlyArray<{ clientCorrectionId: string }>;
};

/**
 * Registers an answer or a Logs as that waits for corrections (Codex r6 on #610): this sheet's new ones (`newIds`,
 * about to be queued) and every correction still queued for its items (`itemIds`: the place's or trip's own, from an
 * earlier Done too). In one step of the store's own chain it reads the queue, takes as acknowledged any it already
 * has, and writes the record once, before anyone is told; an acknowledgement arriving meanwhile waits for that write
 * and then finds it. Held for Undo. Null when there is nothing to wait for (answer or log at once).
 */
export async function registerAfterCorrections(owner: MobileAccountOwner,
  answer: { id: string; reviewItemId: string; logged: boolean; venue?: ReviewAnswerVenue | null; log?: { itemId: string; categoryId: string };
    newIds: readonly string[]; itemIds: readonly string[] },
  queue: AfterCorrectionsQueue, now = new Date()) {
  const record = await serialised(async () => {
    const pending = await queue.readPending(owner);
    const earlier = pending
      .filter((item) => answer.itemIds.includes(item.request.itemId) && item.request.kind !== "log_place")
      .map((item) => item.clientCorrectionId);
    const waitsFor = [...new Set([...answer.newIds, ...earlier])];
    if (!waitsFor.length) return null;
    const acknowledgedNow = new Set(queue.readAcknowledged(owner).map((item) => item.clientCorrectionId));
    const next: AnswerAfterCorrections = {
      userId: owner.userId, workspaceId: owner.workspaceId, id: answer.id, reviewItemId: answer.reviewItemId, logged: answer.logged,
      ...(answer.venue ? { venue: answer.venue } : {}), ...(answer.log ? { log: answer.log } : {}), waitsFor,
      acknowledged: waitsFor.filter((id) => acknowledgedNow.has(id)), held: { run }, createdAt: now.toISOString()
    };
    const items = await readAll();
    await writeAll([...items.filter((item) => item.id !== next.id), next]);
    return next;
  });
  if (record) notify();
  return record;
}

/** Its Undo window ended: it may go once its corrections are acknowledged. */
export async function commitAnswerAfterCorrections(id: string) {
  await update((items) => items.map((item) => {
    if (item.id !== id) return item;
    const { held: _held, ...rest } = item;
    return rest;
  }));
}

/** Undo (or the answer could not be held after all): the answer goes; its corrections stay. */
export async function cancelAnswerAfterCorrections(id: string) {
  await update((items) => items.filter((item) => item.id !== id));
}

/** Called by the correction outbox before it lets go of an acknowledged correction. */
export async function noteTimelineCorrectionAcknowledged(owner: MobileAccountOwner, clientCorrectionId: string) {
  await update((items) => items.map((item) => mobileAccountOwnersEqual(item, owner) && item.waitsFor.includes(clientCorrectionId)
    && !item.acknowledged.includes(clientCorrectionId) ? { ...item, acknowledged: [...item.acknowledged, clientCorrectionId] } : item));
}

/** Called by the correction outbox when a correction is refused for good. */
export async function noteTimelineCorrectionRefused(owner: MobileAccountOwner, clientCorrectionId: string) {
  await update((items) => items.map((item) => mobileAccountOwnersEqual(item, owner) && item.waitsFor.includes(clientCorrectionId)
    ? { ...item, refused: true } : item));
}

/** Logout: this account's waiting answers leave with its corrections. */
export async function clearAnswersAfterCorrectionsForOwner(owner: MobileAccountOwner) {
  await update((items) => items.filter((item) => !mobileAccountOwnersEqual(item, owner)));
}

/** Puts one answer into the Review outbox under its own id: "gone" when its "?" is no longer open, "wait" when it can't yet. */
export type AnswerAfterCorrectionsRelease = (record: AnswerAfterCorrections) => Promise<"released" | "gone" | "wait">;

/**
 * Releases this owner's answers whose corrections are all acknowledged and whose Undo has ended, and drops those
 * whose corrections were refused or discarded (`onDropped`). `readPending` is the correction outbox as it is now;
 * it is read before the records, so an acknowledgement (marked here before the outbox lets go) is never missed.
 */
export async function releaseAnswersAfterCorrections(input: {
  owner: MobileAccountOwner;
  readPending: (owner: MobileAccountOwner) => Promise<ReadonlyArray<{ clientCorrectionId: string; failureKind?: string }>>;
  /**
   * The queue's memory of what it just had acknowledged: one that has just left the queue counts as accepted, never
   * refused (Codex r6 on #610).
   */
  readAcknowledged?: (owner: MobileAccountOwner) => ReadonlyArray<{ clientCorrectionId: string }>;
  release: AnswerAfterCorrectionsRelease;
  onDropped?: (record: AnswerAfterCorrections) => void;
}) {
  const released: string[] = [];
  const dropped: AnswerAfterCorrections[] = [];
  let changed = false;
  await serialised(async () => {
    const pending = await input.readPending(input.owner);
    const acknowledgedNow = new Set((input.readAcknowledged?.(input.owner) ?? []).map((item) => item.clientCorrectionId));
    const items = await readAll();
    const keep: AnswerAfterCorrections[] = [];
    for (const item of items) {
      if (!mobileAccountOwnersEqual(item, input.owner)) {
        keep.push(item);
        continue;
      }
      // Killed during its Undo window: never answered, as a held answer isn't.
      if (item.held && item.held.run !== run) continue;
      const outstanding = item.waitsFor.filter((id) => !item.acknowledged.includes(id) && !acknowledgedNow.has(id));
      const refused = item.refused || outstanding.some((id) => {
        const queued = pending.find((each) => each.clientCorrectionId === id);
        return !queued || queued.failureKind === "permanent";
      });
      if (refused) {
        dropped.push(item);
        continue;
      }
      if (outstanding.length || item.held) {
        keep.push(item);
        continue;
      }
      const outcome = await input.release(item).catch(() => "wait" as const);
      if (outcome === "wait") keep.push(item);
      else if (outcome === "released" && item.reviewItemId) released.push(item.reviewItemId);
    }
    changed = keep.length !== items.length;
    if (changed) await writeAll(keep);
  });
  if (changed) notify();
  for (const item of dropped) input.onDropped?.(item);
  return { released, dropped };
}

export function __resetAnswersAfterCorrectionsForTests(options: { newRun?: boolean } = {}) {
  listeners.clear();
  tail = Promise.resolve();
  if (options.newRun) run = `${run}-next`;
}
