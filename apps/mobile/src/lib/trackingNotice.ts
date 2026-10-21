// The tracking-stopped notice (owner-agreed 6 Oct 2026): when the person closes Dayframe from the
// app switcher while location tracking is on, iOS ends it and nothing restarts it, so native code
// posts one calm local notification from `applicationWillTerminate` ("Dayframe isn't tracking
// locations — open it to resume"), at most once a day. JS keeps the native module "armed" flag
// current: this device's switch is on, notifications are allowed, and the signed-in account's
// location tracking is on with Always access. Native re-checks Always and the daily limit itself.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ReviewNudgePermission } from "./reviewNudgeNative";

const TRACKING_NOTICE_ENABLED_KEY = "dayframe.trackingNotice.enabled.v1";

export type TrackingNoticeArmingInputs = {
  enabled: boolean;
  notificationPermission: ReviewNudgePermission | null;
  locationConsent: boolean;
  alwaysLocation: boolean;
};

export function trackingNoticeArmed(inputs: TrackingNoticeArmingInputs) {
  return inputs.enabled &&
    inputs.notificationPermission === "granted" &&
    inputs.locationConsent &&
    inputs.alwaysLocation;
}

/** This iPhone's switch; on unless the person turned it off. */
export async function readTrackingNoticeEnabled() {
  return (await AsyncStorage.getItem(TRACKING_NOTICE_ENABLED_KEY)) !== "false";
}

export async function setTrackingNoticeEnabled(enabled: boolean) {
  // Off stands the notice down before anything is stored or read.
  if (!enabled) disarm();
  await AsyncStorage.setItem(TRACKING_NOTICE_ENABLED_KEY, enabled ? "true" : "false");
  await syncTrackingNoticeArming();
}

export type TrackingNoticeDependencies = {
  /** The signed-in account (a key, hydrated from storage on a cold launch), or null. */
  readAccountKey(): Promise<string | null>;
  readEnabled(): Promise<boolean>;
  readNotificationPermission(): Promise<ReviewNudgePermission | null>;
  readLocationConsent(): Promise<boolean>;
  readAlwaysLocation(): Promise<boolean>;
  setArmed(armed: boolean): Promise<void>;
};

type NativeTrackingNotice = typeof import("../../modules/dayframe-tracking-notice");

function loadNativeModule(): NativeTrackingNotice | null {
  // React Native defines __DEV__ in development and release bundles; Node tests do not.
  if (typeof __DEV__ === "undefined") return null;
  try {
    return require("../../modules/dayframe-tracking-notice") as NativeTrackingNotice;
  } catch {
    return null;
  }
}

function defaultDependencies(native: NativeTrackingNotice): TrackingNoticeDependencies {
  const accounts = require("./mobileAccount") as typeof import("./mobileAccount");
  return {
    readAccountKey: async () => {
      const owner = await accounts.readActiveMobileAccount();
      return owner ? accounts.mobileAccountKey(owner) : null;
    },
    readEnabled: readTrackingNoticeEnabled,
    readNotificationPermission: async () =>
      (await import("./reviewNudgeNative")).readReviewNudgePermission().catch(() => null),
    readLocationConsent: async () => (await import("./geofence")).getLocationLearningEnabled(),
    readAlwaysLocation: async () => {
      const Location = await import("expo-location");
      return (await Location.getBackgroundPermissionsAsync()).granted;
    },
    setArmed: (armed) => native.setArmed(armed)
  };
}

let dependencies: TrackingNoticeDependencies | null = null;
let generation = 0;
let tail: Promise<void> = Promise.resolve();

/**
 * Recomputes the armed flag. Calls are serialised; a newer call, a disarm, or a change of account
 * since the call began supersedes it before it writes, so the flag ends on the latest inputs and
 * one account's reads never arm another. A failed read disarms.
 */
export function syncTrackingNoticeArming(): Promise<void> {
  const deps = dependencies;
  if (!deps) return Promise.resolve();
  const mine = ++generation;
  tail = tail.catch(() => undefined).then(async () => {
    if (mine !== generation) return;
    let accountKey: string | null = null;
    let armed = false;
    try {
      accountKey = await deps.readAccountKey();
      const [enabled, notificationPermission, locationConsent, alwaysLocation] = await Promise.all([
        deps.readEnabled(),
        deps.readNotificationPermission(),
        deps.readLocationConsent(),
        deps.readAlwaysLocation()
      ]);
      armed = accountKey !== null &&
        trackingNoticeArmed({ enabled, notificationPermission, locationConsent, alwaysLocation });
    } catch {
      armed = false;
    }
    if (mine !== generation) return;
    if (armed && (await deps.readAccountKey().catch(() => null)) !== accountKey) return;
    if (mine !== generation) return;
    await deps.setArmed(armed).catch(() => undefined);
  });
  return tail;
}

/**
 * Disarms at once, without waiting for a recompute's reads (sign-out, an account change, location
 * consent turned off). Native applies writes in call order, and a pending recompute is superseded.
 */
function disarm() {
  const deps = dependencies;
  if (!deps) return;
  generation += 1;
  void deps.setArmed(false).catch(() => undefined);
}

type Lifecycle = {
  subscribeAppState(listener: () => void): void;
  subscribeSignedOut(listener: () => void): void;
  subscribeAccountChange(listener: () => void): void;
  subscribeLocationConsent(listener: (enabled: boolean) => void): void;
};

/**
 * Starts keeping the flag current: now, on every app-state change (opening the app switcher makes
 * Dayframe inactive before it can be closed there), on sign-out, on an account change and on every
 * location consent write. Idempotent.
 */
export function installTrackingNotice(
  deps: TrackingNoticeDependencies | null = null,
  lifecycle: Lifecycle | null = null
) {
  if (dependencies) return;
  const native = deps ? null : loadNativeModule();
  if (!deps && !native?.isAvailable()) return;
  dependencies = deps ?? defaultDependencies(native!);
  const hooks = lifecycle ?? defaultLifecycle();
  hooks.subscribeAppState(() => void syncTrackingNoticeArming());
  hooks.subscribeSignedOut(disarm);
  hooks.subscribeAccountChange(() => {
    disarm();
    void syncTrackingNoticeArming();
  });
  hooks.subscribeLocationConsent((enabled) => {
    if (!enabled) disarm();
    void syncTrackingNoticeArming();
  });
  void syncTrackingNoticeArming();
}

function defaultLifecycle(): Lifecycle {
  return {
    subscribeAppState: (listener) => {
      const { AppState } = require("react-native") as typeof import("react-native");
      AppState.addEventListener("change", listener);
    },
    subscribeSignedOut: (listener) => {
      const { subscribeMobileSignedOut } = require("./mobileSessionTransition") as typeof import("./mobileSessionTransition");
      subscribeMobileSignedOut(listener);
    },
    subscribeAccountChange: (listener) => {
      const { subscribeActiveMobileAccount } = require("./mobileAccount") as typeof import("./mobileAccount");
      subscribeActiveMobileAccount(listener);
    },
    subscribeLocationConsent: (listener) => {
      const { subscribeLocationCaptureConsent } = require("./location/captureConsent") as typeof import("./location/captureConsent");
      subscribeLocationCaptureConsent((_owner, enabled) => listener(enabled));
    }
  };
}

export function __resetTrackingNoticeForTests() {
  dependencies = null;
  generation = 0;
  tail = Promise.resolve();
}
