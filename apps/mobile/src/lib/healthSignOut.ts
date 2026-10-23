// What Apple Health leaves behind when an account leaves the iPhone (stability audit 22 Oct 2026,
// health-3 and health-4).
// - Background delivery: while no account is signed in, native HealthKit observers, background
//   delivery and the refresh task are off, so HealthKit stops waking a signed-out app. The next
//   authenticated foreground turns them back on only while Health access is on (the Dashboard gates
//   `configureHealthKitAutomaticSync` on it).
// - Journal: a completed logout expires the departed account's Health journal; a replaced account's
//   journal, or one whose logout never reached that step, is expired by the first foreground capture
//   of each launch. Unsettled deliveries stay with the durable queue that still holds them.
import { requireBackendIdentity } from "./backendIdentity";
import { expireInactiveHealthOwners, type HealthCaptureOwner } from "./healthSyncStore";
import {
  getActiveMobileAccountSnapshot,
  readActiveMobileAccount,
  subscribeActiveMobileAccount,
} from "./mobileAccount";

type HealthBackgroundSwitch = { setEnabled(enabled: boolean): Promise<boolean> };

async function signedInHealthOwner(): Promise<HealthCaptureOwner | null> {
  const owner = await readActiveMobileAccount();
  // A signed-in account without a backend identity cannot be told apart from another: throw, delete nothing.
  return owner ? { ...owner, backendId: requireBackendIdentity() } : null;
}

/** Deletes the Health journal of every account except the one signed in now (unsettled deliveries stay). */
export async function expireSignedOutHealthJournals() {
  return expireInactiveHealthOwners(signedInHealthOwner);
}

let expiredThisLaunch: Promise<unknown> | null = null;

/** Foreground maintenance: at most once per launch, tried again on the next call after a failure. */
export function expireSignedOutHealthJournalsOncePerLaunch() {
  expiredThisLaunch ??= expireSignedOutHealthJournals().catch((error) => {
    expiredThisLaunch = null;
    throw error;
  });
  return expiredThisLaunch;
}

async function loadHealthBackgroundSwitch(): Promise<HealthBackgroundSwitch> {
  return import("../../modules/dayframe-health-background");
}

/** Turns HealthKit background delivery and the refresh task off when no account is signed in. */
export async function stopHealthBackgroundDeliveryWhileSignedOut(native?: HealthBackgroundSwitch) {
  const target = native ?? await loadHealthBackgroundSwitch();
  await readActiveMobileAccount();
  // Checked with no await before the native call, so a sign-in that lands first keeps its delivery.
  if (getActiveMobileAccountSnapshot()) return false;
  await target.setEnabled(false);
  return true;
}

/**
 * Installed with the Health wake listener at every launch, background launches included: a launch
 * while signed out (also after an older build left delivery on) and every later sign-out stop it.
 */
export function watchSignedOutHealthBackground(native: HealthBackgroundSwitch) {
  const stop = () => void stopHealthBackgroundDeliveryWhileSignedOut(native).catch(() => undefined);
  const unsubscribe = subscribeActiveMobileAccount(() => {
    if (!getActiveMobileAccountSnapshot()) stop();
  });
  stop();
  return unsubscribe;
}

/** Runs after a completed logout. Each part is best effort and independent of the other. */
export async function endHealthCaptureAfterLogout() {
  await Promise.allSettled([
    stopHealthBackgroundDeliveryWhileSignedOut(),
    expireSignedOutHealthJournals(),
  ]);
}

export function __resetHealthSignOutForTests() {
  expiredThisLaunch = null;
}
