// What Apple Health leaves behind when an account leaves the iPhone (stability audit 22 Oct 2026,
// health-3 and health-4; Codex r1 on #549).
// - Background delivery: one serial switch owns native enable and disable. Disable runs whenever the
//   session authority reads signed out (at every launch, background ones included, and on every
//   session or account change); enable runs only for the session generation that asked for it, so an
//   enable that started before a logout can never turn delivery back on after it. The next
//   authenticated foreground turns delivery back on only while Health access is on (the Dashboard
//   gates `configureHealthKitAutomaticSync` on it).
// - Journal: logout records a pending expiry before it revokes the session; the expiry clears that
//   marker only once it has run, and every launch retries a marker left behind, signed out or not. A replaced
//   account's journal is expired by the first foreground capture of each launch. The account to keep
//   comes from the session authority, and an account hand-over in progress (a session installed before
//   its account record, or an account record left after sign-out) or an unreadable session defers the
//   expiry. Unsettled deliveries stay with the durable queue that still holds them.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { requireBackendIdentity } from "./backendIdentity";
import { expireInactiveHealthOwners, type HealthJournalKeeper } from "./healthSyncStore";
import {
  getActiveMobileAccountSnapshot,
  type MobileAccountOwner,
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

// The pending-expiry marker: `{ id, launch, done, owner }`. Logout writes it before it revokes the
// session and marks it done once it has signed out; every read and write runs on one serial chain. A
// cleanup consumes only a marker whose logout has finished: done, or written by an earlier launch (that
// logout can no longer finish here). It is bound to the departing owner and is consumed only by an
// expiry that removed that owner's journal: while the session still reads that owner (a logout
// interrupted after the server revoked it, before the token went), it stays pending until a sign-out
// lets it run (Codex r3 on #549). It reads the id, runs the expiry, then removes the marker only if it
// still holds that id, so a newer logout's marker is never consumed by an older cleanup (Codex r2).
type ExpiryMarker = { id: string; launch: string; done: boolean; owner: MobileAccountOwner | null };
const LAUNCH_ID = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
let markerTail: Promise<unknown> = Promise.resolve();
function onMarker<Result>(work: () => Promise<Result>) {
  const result = markerTail.catch(() => undefined).then(work);
  markerTail = result.catch(() => undefined);
  return result;
}
async function readMarker(): Promise<ExpiryMarker | null> {
  const raw = await AsyncStorage.getItem(HEALTH_SIGNED_OUT_EXPIRY_PENDING_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ExpiryMarker>;
    if (typeof value.id === "string" && typeof value.launch === "string")
      return { id: value.id, launch: value.launch, done: value.done === true, owner: value.owner ?? null };
  } catch {
    // An unreadable marker still asks for an expiry.
  }
  return { id: raw, launch: "", done: true, owner: null };
}

/** Logout records this before it revokes the session; the returned id is passed to `endHealthCaptureAfterLogout`. */
export function markSignedOutHealthExpiryPending(owner: MobileAccountOwner | null) {
  return onMarker(async () => {
    const id = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const departing = owner ? { userId: owner.userId, workspaceId: owner.workspaceId } : null;
    await AsyncStorage.setItem(
      HEALTH_SIGNED_OUT_EXPIRY_PENDING_KEY,
      JSON.stringify({ id, launch: LAUNCH_ID, done: false, owner: departing } satisfies ExpiryMarker),
    );
    return id;
  });
}

function finishSignedOutHealthExpiryLogout(id: string) {
  return onMarker(async () => {
    const marker = await readMarker();
    if (marker?.id !== id) return;
    await AsyncStorage.setItem(HEALTH_SIGNED_OUT_EXPIRY_PENDING_KEY, JSON.stringify({ ...marker, done: true }));
  });
}

/** Runs a recorded expiry whose logout has finished; clears the marker only if it still holds that id. */
export async function runPendingSignedOutHealthExpiry() {
  const marker = await onMarker(readMarker);
  if (!marker || (!marker.done && marker.launch === LAUNCH_ID)) return false;
  const expired = await expireInactiveHealthOwners(async () => {
    const keeper = await healthJournalKeeper();
    // The departing owner is still the session's: its journal would be kept, so the marker waits.
    if (keeper?.keep && marker.owner && mobileAccountOwnersEqual(keeper.keep, marker.owner)) return null;
    return keeper;
  });
  if (expired === null) return false;
  await onMarker(async () => {
    if ((await readMarker())?.id === marker.id)
      await AsyncStorage.removeItem(HEALTH_SIGNED_OUT_EXPIRY_PENDING_KEY);
  });
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
  // Every session or account change (a 401 sign-out included) also retries a pending expiry.
  const changed = () => {
    void stopHealthBackgroundDeliveryWhileSignedOut(native).catch(() => undefined);
    void runPendingSignedOutHealthExpiry().catch(() => undefined);
  };
  const unsubscribeAccount = subscribeActiveMobileAccount(changed);
  const unsubscribeSession = subscribeAuthenticatedSession(changed);
  changed();
  return () => {
    unsubscribeAccount();
    unsubscribeSession();
  };
}

/** Runs after a completed logout, with the id of the pending expiry it recorded before revoking the session. */
export async function endHealthCaptureAfterLogout(markerId: string) {
  await Promise.allSettled([
    stopHealthBackgroundDeliveryWhileSignedOut(),
    finishSignedOutHealthExpiryLogout(markerId).then(runPendingSignedOutHealthExpiry),
  ]);
}

export function __resetHealthSignOutForTests() {
  expiredThisLaunch = null;
  switchTail = Promise.resolve();
  markerTail = Promise.resolve();
}
