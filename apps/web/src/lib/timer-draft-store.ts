import {
  pickTimerDraftFields,
  timerDetailEquivalent,
  timerDraftEditedFields,
  type TimerDetailField,
  type TimerDraft
} from "@/lib/timer-runtime";

/**
 * Best-effort recovery for the running block's details that a closing page cannot send keepalive
 * (stability audit WEB-UI-2; Codex r1–r3 on #539): a body over the keepalive budget, edits typed
 * behind a save still in flight, or a save in flight that is not keepalive. Every other description
 * save is keepalive and outlives the page, so this store is rarely written. A save of that exact
 * text that the server acknowledges clears it, and a reload or restore of the same tab puts it back
 * in the draft when the server still holds one of the copies it was based on, so autosave sends it
 * again. A newly opened tab does not have it (sessionStorage). One record per user, workspace and
 * block, at most a day old. When the session ends (sign-out, workspace switch) every record is
 * removed and writes made for the session that ended are refused (`generation`).
 */
export type PendingTimerDetails = {
  /** The block's server id. */
  entryId: string;
  draft: TimerDraft;
  /** The server copies the draft may be applied over: its base, and the base of a save still in flight. */
  bases: TimerDraft[];
  savedAt: number;
};

/** Whose records these are: the signed-in user and workspace. */
export type PendingTimerDetailsOwner = { userId: string; workspaceId: string };

export type PendingTimerDetailsDecision =
  | { kind: "saved" }
  | { kind: "stale" }
  | { kind: "apply"; fields: TimerDetailField[] };

const STORAGE_PREFIX = "dayframe:pending-timer-details:";
export const PENDING_TIMER_DETAILS_MAX_AGE_MS = 24 * 60 * 60_000;

let generation = 0;

/** The current session's write token; a token from before the last `endPendingTimerDetailsSession` is refused. */
export function pendingTimerDetailsGeneration() {
  return generation;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function keyFor(owner: PendingTimerDetailsOwner, entryId: string) {
  return `${STORAGE_PREFIX}${encodeURIComponent(owner.userId)}:${encodeURIComponent(owner.workspaceId)}:${encodeURIComponent(entryId)}`;
}

function isDraft(value: unknown): value is TimerDraft {
  const draft = value as TimerDraft | null;
  return Boolean(draft)
    && typeof draft!.categoryId === "string"
    && typeof draft!.description === "string"
    && Array.isArray(draft!.tagNames) && draft!.tagNames.every((tag) => typeof tag === "string");
}

/** Writes the record for its block; refused (false) for a session that has ended. */
export function writePendingTimerDetails(owner: PendingTimerDetailsOwner, record: PendingTimerDetails, writeGeneration: number) {
  if (writeGeneration !== generation) return false;
  try {
    storage()?.setItem(keyFor(owner, record.entryId), JSON.stringify(record));
    return true;
  } catch {
    // Full or blocked storage: the flush itself still runs.
    return false;
  }
}

export function readPendingTimerDetails(owner: PendingTimerDetailsOwner, entryId: string, now = Date.now()): PendingTimerDetails | null {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(keyFor(owner, entryId)) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as PendingTimerDetails;
    if (
      record?.entryId === entryId
      && isDraft(record.draft)
      && Array.isArray(record.bases) && record.bases.length > 0 && record.bases.every(isDraft)
      && typeof record.savedAt === "number"
      && now - record.savedAt <= PENDING_TIMER_DETAILS_MAX_AGE_MS
    ) return record;
  } catch {
    // Unreadable: dropped below.
  }
  clearPendingTimerDetails(owner, entryId);
  return null;
}

/** Clears that block's record; with `saved`, only when that text is all it holds. */
export function clearPendingTimerDetails(owner: PendingTimerDetailsOwner, entryId: string, saved?: TimerDraft) {
  if (saved) {
    const record = readPendingTimerDetails(owner, entryId);
    if (!record || timerDraftEditedFields(record.draft, saved).length) return;
  }
  try {
    storage()?.removeItem(keyFor(owner, entryId));
  } catch {
    // Nothing more to do.
  }
}

/** The session ends: every record goes, and writes for it are refused from now on. */
export function endPendingTimerDetailsSession() {
  generation += 1;
  const store = storage();
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // Nothing more to do.
  }
}

/**
 * What a stored draft means against the block's server copy: already `saved`; `stale` (the block
 * changed in a way the draft was not based on, so the server's copy wins); or `apply` (the server
 * still holds a copy the draft was based on, for the fields it edits).
 */
export function pendingTimerDetailsDecision(record: PendingTimerDetails, server: TimerDraft): PendingTimerDetailsDecision {
  for (const base of record.bases) {
    const fields = timerDraftEditedFields(record.draft, base);
    if (!fields.length) continue;
    if (fields.every((field) => timerDetailEquivalent(field, record.draft, server))) return { kind: "saved" };
    if (fields.every((field) => timerDetailEquivalent(field, base, server))) return { kind: "apply", fields };
  }
  return timerDraftEditedFields(record.draft, server).length ? { kind: "stale" } : { kind: "saved" };
}

/** The draft with the stored edits applied over `current`. */
export function applyPendingTimerDetails(record: PendingTimerDetails, current: TimerDraft, fields: TimerDetailField[]) {
  return pickTimerDraftFields(record.draft, current, fields);
}

/** A keepalive request's body must stay under the browser's 64 KiB in-flight budget. */
export const KEEPALIVE_BODY_LIMIT_BYTES = 60_000;

export function fitsKeepalive(body: string) {
  return new TextEncoder().encode(body).length <= KEEPALIVE_BODY_LIMIT_BYTES;
}
