import { currentMobileAccountEpoch } from "./mobileAccount";

/**
 * A Stop asked for by a `dayframe://action/stop` link (Shortcuts "Open URL" actions and NFC automations).
 *
 * The link names no entry, and a queued Stop without a canonical target is never replayed (`api.ts`
 * marks it permanently failed when the queue is read), so such a Stop used to vanish. Instead the
 * Dashboard stops the block it shows as running, through the same targeted outbox as its Stop button.
 *
 * Both URL handlers (the Dashboard's `Linking` listener and the `action/[verb]` route) report the same
 * link, so requests close together coalesce into one. A request nobody takes within
 * `SHORTCUT_STOP_REQUEST_TTL_MS` expires, so a late hand-off can never stop a block started afterwards, and
 * a request belongs to the account lifetime it arrived in: a sign-out, sign-in or account switch before it
 * is taken voids it, so it can never stop another account's block (Codex r1 on #397).
 */

export const SHORTCUT_STOP_REQUEST_TTL_MS = 30_000;
export const SHORTCUT_STOP_COALESCE_MS = 2_000;

let pending: { at: number; accountEpoch: number } | null = null;
let lastRequestAt = Number.NEGATIVE_INFINITY;
const listeners = new Set<() => void>();

/** Records a Stop request; returns false when it is the same link reported a second time. */
export function requestShortcutStop(now = Date.now()) {
  if (now - lastRequestAt < SHORTCUT_STOP_COALESCE_MS) return false;
  lastRequestAt = now;
  pending = { at: now, accountEpoch: currentMobileAccountEpoch() };
  for (const listener of [...listeners]) listener();
  return true;
}

/**
 * Takes the pending request: true only for one that has not expired and arrived in the current account
 * lifetime. Either way it is gone.
 */
export function takeShortcutStopRequest(now = Date.now()) {
  const request = pending;
  pending = null;
  return request !== null &&
    now - request.at <= SHORTCUT_STOP_REQUEST_TTL_MS &&
    request.accountEpoch === currentMobileAccountEpoch();
}

export function subscribeShortcutStopRequests(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetShortcutStopRequestsForTests() {
  pending = null;
  lastRequestAt = Number.NEGATIVE_INFINITY;
  listeners.clear();
}
