// What Apple Health leaves behind when an account leaves the iPhone (stability audit 22 Oct 2026,
// health-3 and health-4; Codex r1 on #549).
// - Background delivery: one serial switch owns native enable and disable. Disable runs whenever the
//   session authority reads signed out (at every launch, background ones included, and on every
//   session or account change); enable runs only for the session generation that asked for it, so an
//   enable that started before a logout can never turn delivery back on after it. The next
//   authenticated foreground turns delivery back on only while Health access is on (the Dashboard
//   gates `configureHealthKitAutomaticSync` on it).
// - Journal: logout records a pending expiry before it completes; the expiry clears that marker only
//   once it has run, and every launch retries a marker left behind, signed out or not. A replaced
//   account's journal is expired by the first foreground capture of each launch. The account to keep
//   comes from the session authority, and an account hand-over in progress (a session installed before
//   its account record, or an account record left after sign-out) or an unreadable session defers the
//   expiry. Unsettled deliveries stay with the durable queue that still holds them.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { requireBackendIdentity } from "./backendIdentity";
import { expireInactiveHealthOwners, type HealthJournalKeeper } from "./healthSyncStore";
import {
  getActiveMobileAccountSnapshot,
  mobileAccountOwnersEqual,
  readActiveMobileAccount,
  subscribeActiveMobileAccount,
} from "./mobileAccount";
import {
  currentSessionGeneration,
  isAuthenticatedSessionSnapshotCurrent,
  readAuthenticatedSessionSnapshot,
  subscribeAuthenticatedSession,
} from "./secure-session";

type HealthBackgroundSwitch = { setEnabled(enabled: boolean): Promise<boolean> };

export const HEALTH_SIGNED_OUT_EXPIRY_PENDING_KEY = "dayframe.health.signedOutExpiryPending.v1";

async function readSession() {
  try {
    return await readAuthenticatedSessionSnapshot();
  } catch {
    // The Keychain is unreadable (a background launch before first unlock): nothing is decided.
    return null;
  }
}

/** The account whose journal stays, from the session authority; null defers the expiry. */
async function healthJournalKeeper(): Promise<HealthJournalKeeper | null> {
  const generation = currentSessionGeneration();
  const session = await readSession();
  if (!session || session.status === "changed") return null;
  const account = await readActiveMobileAccount();
  if (session.status === "signed_out") {
    // An account record left after sign-out is a hand-over still settling: wait for it.
    if (account) return null;
    return {
      keep: null,
      isCurrent: () => currentSessionGeneration() === generation && !getActiveMobileAccountSnapshot(),
    };
  }
  const owner = session.snapshot.owner;
  // A legacy unbound session, or one installed before its account record (sign-in in progress).
  if (!owner || !mobileAccountOwnersEqual(account, owner)) return null;
  let backendId: string;
  try {
    backendId = requireBackendIdentity();
  } catch {
    // Without a backend identity this account cannot be told apart from another: delete nothing.
    return null;
  }
  return {
    keep: { ...owner, backendId },
    isCurrent: () =>
      isAuthenticatedSessionSnapshotCurrent(session.snapshot) &&
      mobileAccountOwnersEqual(getActiveMobileAccountSnapshot(), owner),
  };
}

/** Deletes every Health journal but the signed-in account's (unsettled deliveries stay); null when deferred. */
export async function expireSignedOutHealthJournals() {
  return expireInactiveHealthOwners(healthJournalKeeper);
}

let expiredThisLaunch: Promise<unknown> | null = null;

/** Foreground maintenance: at most once per launch, tried again on the next call after a failure or deferral. */
export function expireSignedOutHealthJournalsOncePerLaunch() {
  expiredThisLaunch ??= expireSignedOutHealthJournals().then(
    (result) => {
      if (result === null) expiredThisLaunch = null;
      return result;
    },
    (error) => {
      expiredThisLaunch = null;
      throw error;
    },
  );
  return expiredThisLaunch;
}

/** Logout records this before it completes, so a failed or interrupted expiry is retried. */
export async function markSignedOutHealthExpiryPending() {
  await AsyncStorage.setItem(
    HEALTH_SIGNED_OUT_EXPIRY_PENDING_KEY,
    `${Date.now()}:${Math.random().toString(36).slice(2)}`,
  );
}

/** Runs a recorded expiry; the marker is cleared only after it ran, and only if no newer logout replaced it. */
export async function runPendingSignedOutHealthExpiry() {
  const marker = await AsyncStorage.getItem(HEALTH_SIGNED_OUT_EXPIRY_PENDING_KEY);
  if (!marker) return false;
  if ((await expireSignedOutHealthJournals()) === null) return false;
  if ((await AsyncStorage.getItem(HEALTH_SIGNED_OUT_EXPIRY_PENDING_KEY)) === marker)
    await AsyncStorage.removeItem(HEALTH_SIGNED_OUT_EXPIRY_PENDING_KEY);
  return true;
}

let switchTail: Promise<unknown> = Promise.resolve();
function onHealthBackgroundSwitch<Result>(work: () => Promise<Result>) {
  const result = switchTail.catch(() => undefined).then(work);
  switchTail = result.catch(() => undefined);
  return result;
}

async function loadHealthBackgroundSwitch(): Promise<HealthBackgroundSwitch> {
  return import("../../modules/dayframe-health-background");
}

/**
 * Turns native background delivery on for the session generation `configureHealthKitAutomaticSync`
 * started under, and only while that session is still current when its turn on the switch comes.
 */
export function enableHealthBackgroundDeliveryForSession(
  generation: number,
  native?: HealthBackgroundSwitch,
) {
  return onHealthBackgroundSwitch(async () => {
    const target = native ?? (await loadHealthBackgroundSwitch());
    const session = await readSession();
    if (
      session?.status !== "authenticated" ||
      session.snapshot.generation !== generation ||
      !isAuthenticatedSessionSnapshotCurrent(session.snapshot)
    )
      return false;
    return target.setEnabled(true);
  });
}

/** Turns HealthKit background delivery and the refresh task off when the session reads signed out. */
export function stopHealthBackgroundDeliveryWhileSignedOut(native?: HealthBackgroundSwitch) {
  return onHealthBackgroundSwitch(async () => {
    const target = native ?? (await loadHealthBackgroundSwitch());
    const session = await readSession();
    if (session?.status !== "signed_out") return false;
    await target.setEnabled(false);
    return true;
  });
}

/**
 * Installed with the Health wake listener at every launch, background launches included: a launch
 * while signed out (also after an older build left delivery on) and every later sign-out stop
 * delivery, and a logout's unfinished journal expiry is retried.
 */
export function watchSignedOutHealthBackground(native: HealthBackgroundSwitch) {
  const stop = () => void stopHealthBackgroundDeliveryWhileSignedOut(native).catch(() => undefined);
  const unsubscribeAccount = subscribeActiveMobileAccount(stop);
  const unsubscribeSession = subscribeAuthenticatedSession(stop);
  stop();
  void runPendingSignedOutHealthExpiry().catch(() => undefined);
  return () => {
    unsubscribeAccount();
    unsubscribeSession();
  };
}

/** Runs after a completed logout, which has already recorded the pending expiry. */
export async function endHealthCaptureAfterLogout() {
  await Promise.allSettled([
    stopHealthBackgroundDeliveryWhileSignedOut(),
    runPendingSignedOutHealthExpiry(),
  ]);
}

export function __resetHealthSignOutForTests() {
  expiredThisLaunch = null;
  switchTail = Promise.resolve();
}
