import {
  pickTimerDraftFields,
  timerDetailEquivalent,
  timerDraftEditedFields,
  type TimerDetailField,
  type TimerDraft
} from "@/lib/timer-runtime";

/**
 * The running block's details a close-time flush could not be sure of delivering (stability
 * audit WEB-UI-2; Codex r1 on #539). The page writes them here before it sends them, a successful
 * save of that exact text clears them, and the next load (or the tab coming back) puts them back
 * in the draft when the server still holds one of the copies they were based on, so autosave sends
 * them again. Kept in this browser only, for one block, for at most a day; cleared on sign-out and
 * workspace switch.
 */
export type PendingTimerDetails = {
  /** The block's server id. */
  entryId: string;
  draft: TimerDraft;
  /** The server copies the draft may be applied over: its base, and the base of a save still in flight. */
  bases: TimerDraft[];
  savedAt: number;
};

export type PendingTimerDetailsDecision =
  | { kind: "saved" }
  | { kind: "stale" }
  | { kind: "apply"; fields: TimerDetailField[] };

const STORAGE_KEY = "dayframe:pending-timer-details";
export const PENDING_TIMER_DETAILS_MAX_AGE_MS = 24 * 60 * 60_000;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isDraft(value: unknown): value is TimerDraft {
  const draft = value as TimerDraft | null;
  return Boolean(draft)
    && typeof draft!.categoryId === "string"
    && typeof draft!.description === "string"
    && Array.isArray(draft!.tagNames) && draft!.tagNames.every((tag) => typeof tag === "string");
}

export function writePendingTimerDetails(record: PendingTimerDetails) {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Full or blocked storage: the flush itself still runs.
  }
}

export function readPendingTimerDetails(now = Date.now()): PendingTimerDetails | null {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as PendingTimerDetails;
    if (
      typeof record?.entryId === "string"
      && isDraft(record.draft)
      && Array.isArray(record.bases) && record.bases.length > 0 && record.bases.every(isDraft)
      && typeof record.savedAt === "number"
      && now - record.savedAt <= PENDING_TIMER_DETAILS_MAX_AGE_MS
    ) return record;
  } catch {
    // Unreadable: dropped below.
  }
  clearPendingTimerDetails();
  return null;
}

/** Clears the record; with `entryId`, only that block's; with `saved`, only when that text is all it holds. */
export function clearPendingTimerDetails(entryId?: string, saved?: TimerDraft) {
  if (entryId !== undefined) {
    const record = readPendingTimerDetails();
    if (!record || record.entryId !== entryId) return;
    if (saved && timerDraftEditedFields(record.draft, saved).length) return;
  }
  try {
    storage()?.removeItem(STORAGE_KEY);
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
