// The evening Review reminder (owner decisions 9 Oct 2026): one quiet notification at a chosen
// evening time when suggestions are waiting. Never more than one a day, never anything about
// places. The phone schedules it itself from the Review count it last heard from Dayframe
// (bootstrap, and the counts the event and location replies carry).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { mobileAccountKey, mobileAccountOwnersEqual, readActiveMobileAccount, type MobileAccountOwner } from "./mobileAccount";

export const REVIEW_NUDGE_DEFAULT_MINUTES = 20 * 60;
export const REVIEW_NUDGE_MINUTES = { min: 17 * 60, max: 23 * 60 + 30, step: 30 } as const;
/** A count older than this (when the reminder would fire) is too old to nag about. */
export const REVIEW_NUDGE_STALE_AFTER_MS = 72 * 60 * 60 * 1000;

export type ReviewNudgeState = {
  enabled: boolean;
  minutes: number;
  knownCount: number | null;
  knownAt: string | null;
  /** When the pending reminder is set to fire (null when none is scheduled). */
  lastFireAt: string | null;
  /** Local day ("YYYY-MM-DD") of the latest reminder that has fired; that day stays quiet. */
  firedOn: string | null;
};

export const DEFAULT_REVIEW_NUDGE_STATE: ReviewNudgeState = {
  enabled: false,
  minutes: REVIEW_NUDGE_DEFAULT_MINUTES,
  knownCount: null,
  knownAt: null,
  lastFireAt: null,
  firedOn: null
};

export type ReviewNudgePlan = { fireAt: Date; body: string };

export function reviewNudgeBody(count: number) {
  return count === 1 ? "1 suggestion is ready to review." : `${count} suggestions are ready to review.`;
}

export function clampReviewNudgeMinutes(minutes: number) {
  if (!Number.isFinite(minutes)) return REVIEW_NUDGE_DEFAULT_MINUTES;
  const stepped = Math.round(minutes / REVIEW_NUDGE_MINUTES.step) * REVIEW_NUDGE_MINUTES.step;
  return Math.min(REVIEW_NUDGE_MINUTES.max, Math.max(REVIEW_NUDGE_MINUTES.min, stepped));
}

function atMinutes(day: Date, minutes: number) {
  // Local wall-clock time, so a DST change keeps "8:00 pm" at 8:00 pm.
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60, 0, 0);
}

export function localDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * A scheduled reminder whose time has passed has fired (a reminder cancelled before its time is
 * cleared, never left behind). Moves that fire into `firedOn` and clears the pending time.
 */
export function settleFiredReminder(state: ReviewNudgeState, now: Date): ReviewNudgeState {
  if (!state.lastFireAt) return state;
  const fireAt = new Date(state.lastFireAt);
  if (Number.isNaN(fireAt.getTime())) return { ...state, lastFireAt: null };
  if (fireAt.getTime() > now.getTime()) return state;
  const day = localDayKey(fireAt);
  return { ...state, lastFireAt: null, firedOn: !state.firedOn || day > state.firedOn ? day : state.firedOn };
}

/** When (and with what words) the next reminder fires, or null when nothing should be scheduled. */
export function planReviewNudge(state: ReviewNudgeState, now: Date): ReviewNudgePlan | null {
  if (!state.enabled || state.knownCount === null || state.knownCount <= 0 || !state.knownAt) return null;
  const minutes = clampReviewNudgeMinutes(state.minutes);
  const settled = settleFiredReminder(state, now);
  let fireAt = atMinutes(now, minutes);
  const firedToday = settled.firedOn === localDayKey(now);
  if (fireAt.getTime() <= now.getTime() || firedToday) {
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    fireAt = atMinutes(tomorrow, minutes);
  }
  if (fireAt.getTime() - new Date(state.knownAt).getTime() > REVIEW_NUDGE_STALE_AFTER_MS) return null;
  return { fireAt, body: reviewNudgeBody(state.knownCount) };
}

export function formatReviewNudgeTime(minutes: number) {
  const hours24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(mins).padStart(2, "0")} ${hours24 < 12 ? "am" : "pm"}`;
}

const storageKey = (owner: MobileAccountOwner) => `dayframe:review-nudge:v1:${mobileAccountKey(owner)}`;

function parseState(raw: string | null): ReviewNudgeState {
  if (!raw) return { ...DEFAULT_REVIEW_NUDGE_STATE };
  try {
    const value = JSON.parse(raw) as Partial<ReviewNudgeState>;
    return {
      enabled: value.enabled === true,
      minutes: clampReviewNudgeMinutes(typeof value.minutes === "number" ? value.minutes : REVIEW_NUDGE_DEFAULT_MINUTES),
      knownCount: typeof value.knownCount === "number" && Number.isInteger(value.knownCount) && value.knownCount >= 0 ? value.knownCount : null,
      knownAt: typeof value.knownAt === "string" ? value.knownAt : null,
      lastFireAt: typeof value.lastFireAt === "string" ? value.lastFireAt : null,
      firedOn: typeof value.firedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.firedOn) ? value.firedOn : null
    };
  } catch {
    return { ...DEFAULT_REVIEW_NUDGE_STATE };
  }
}

export async function readReviewNudgeState(owner: MobileAccountOwner) {
  return parseState(await AsyncStorage.getItem(storageKey(owner)));
}

// Every change runs one at a time, so a late count can't undo a newer switch or time change.
let chain: Promise<unknown> = Promise.resolve();
function serialised<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.catch(() => undefined);
  return next;
}

async function native() {
  return import("./reviewNudgeNative");
}

/**
 * Applies a change for `owner` and schedules (or cancels) the one reminder to match. Nothing is
 * scheduled for an account that is no longer the active one.
 */
async function update(owner: MobileAccountOwner, change: (state: ReviewNudgeState) => ReviewNudgeState, now = new Date()) {
  return serialised(async () => {
    const next = settleFiredReminder(change(await readReviewNudgeState(owner)), now);
    if (!mobileAccountOwnersEqual(owner, await readActiveMobileAccount())) {
      // Saved under that account's key only; its reminder is scheduled when it is back.
      await AsyncStorage.setItem(storageKey(owner), JSON.stringify(next));
      return next;
    }
    const plan = planReviewNudge(next, now);
    const nativeModule = await native();
    const allowed = plan !== null && (await nativeModule.readReviewNudgePermission()) === "granted";
    // The account can change while the native module loads or permission is read.
    const stillActive = mobileAccountOwnersEqual(owner, await readActiveMobileAccount());
    if (plan && allowed && stillActive) {
      await nativeModule.scheduleReviewNudge(plan.fireAt, plan.body, mobileAccountKey(owner));
      next.lastFireAt = plan.fireAt.toISOString();
    } else {
      // Never cancel another account's reminder: it replaces this one when its own count arrives.
      if (stillActive) await nativeModule.cancelReviewNudge();
      next.lastFireAt = null;
    }
    await AsyncStorage.setItem(storageKey(owner), JSON.stringify(next));
    return next;
  });
}

/** The latest number of suggestions waiting in Review, from any Dayframe reply. Best effort. */
export function noteReviewCount(owner: MobileAccountOwner | null, count: unknown, now = new Date()) {
  if (!owner || typeof count !== "number" || !Number.isInteger(count) || count < 0) return Promise.resolve();
  return update(owner, (state) => ({ ...state, knownCount: count, knownAt: now.toISOString() }), now)
    .then(() => undefined, () => undefined);
}

export function setReviewNudgeEnabled(owner: MobileAccountOwner, enabled: boolean, now = new Date()) {
  return update(owner, (state) => ({ ...state, enabled }), now);
}

export function setReviewNudgeMinutes(owner: MobileAccountOwner, minutes: number, now = new Date()) {
  return update(owner, (state) => ({ ...state, minutes: clampReviewNudgeMinutes(minutes) }), now);
}

/** Sign-out: the reminder belongs to the account that is leaving. */
export function cancelReviewNudgeForLogout() {
  return serialised(async () => {
    await (await native()).cancelReviewNudge();
  }).catch(() => undefined);
}
