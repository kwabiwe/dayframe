import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useSyncExternalStore } from "react";
import { HEALTH_IMPORT_PREFERENCE_OPTIONS, type HealthImportPreferenceKey } from "@dayframe/shared";
import type { DayframeMotionAuthorizationStatus } from "../../modules/dayframe-motion-activity";
import { DAYFRAME_API_BASE } from "./config";
import type { LocationPermissionLabel, LocationVisitDiagnostics } from "./geofence";
import {
  getActiveMobileAccountSnapshot,
  subscribeActiveMobileAccount,
  type MobileAccountOwner
} from "./mobileAccount";
import { subscribeMobileSignedOut } from "./mobileSessionTransition";
import { REVIEW_NUDGE_MINUTES } from "./reviewNudge";
import type { ReviewNudgePermission } from "./reviewNudgeNative";
import { currentSessionGeneration, subscribeAuthenticatedSession } from "./secure-session";
import {
  beginRememberedSettingsRead,
  isRememberedSettingsBindingCurrent,
  sameRememberedSettingsBinding,
  subscribeRememberedSettingWrites,
  type RememberedSettingsBinding
} from "./settingsRemembered";

/**
 * Settings' last-known display states on this iPhone (staging feedback A4, owner 12 Oct): the first
 * Settings open after a fresh launch paints what this account last saw at once, then the live reads
 * refresh it quietly and only what really changed moves. `settingsRemembered.ts` keeps the live
 * values of one app session in memory (#355); this module keeps a small display-only projection of
 * them in AsyncStorage, the app's store for small per-account device state (the active account,
 * the onboarding offer, the evening reminder).
 *
 * - Keyed by backend + workspace + user (`dayframe:settings-last-known:v1:<api base>:<workspace>:<user>`),
 *   with the same owner and backend repeated inside the payload and checked on read.
 * - Holds only display-level values: enum statuses, booleans, counts and the reminder time, plus a
 *   schema version. Never tokens, coordinates, place names, entry or item IDs or free text: every
 *   write and every read goes through `sanitizeSettingsLastKnown`, which rebuilds the value from an
 *   allow-list.
 * - Bound like the remembered values: a value is handed out only to the account and authenticated
 *   session (`currentSessionGeneration`) it is held for, and a read or write started for another
 *   account or session never lands (late launch reads included).
 * - Cleared, in memory and on disk, on sign-out, on any new authenticated session (every sign-in,
 *   sign-out and invalidation bumps the generation) and when the active account or workspace is
 *   replaced; values survive only an app relaunch of the same signed-in account.
 * - A corrupt, foreign or old-schema payload is ignored (and removed).
 * - Display only: `SettingsLastKnownDisplay` is read through `useSettingsLastKnown` by the Settings
 *   display layer. Actions never read it; they keep reading the live permission and state.
 */

export const SETTINGS_LAST_KNOWN_SCHEMA_VERSION = 1;
export const SETTINGS_LAST_KNOWN_KEY_PREFIX = "dayframe:settings-last-known:";

const MOTION_STATUSES = ["unavailable", "not_determined", "restricted", "denied", "authorized", "unknown"] as const;
const LOCATION_PERMISSIONS = ["granted", "denied", "undetermined", "unknown"] as const;
const CAPTURE_STATES = ["off", "inactive", "active", "logout_cleanup"] as const;
const NUDGE_PERMISSIONS = ["granted", "denied", "undetermined"] as const;
export const SETTINGS_LAST_KNOWN_SYNC_COUNT_KEYS = [
  "timerStopIssueCount",
  "timeEntryIssueCount",
  "reviewIssueCount",
  "permanentFailedCount",
  "quarantinedCount",
  "deviceQuarantinedCount",
  "queuedCount",
  "timerStopPendingCount",
  "timeEntryPendingCount",
  "reviewWaitingCount",
  "reviewSignInCount"
] as const;
const HEALTH_PREFERENCE_KEYS = HEALTH_IMPORT_PREFERENCE_OPTIONS.map((option) => option.key) as HealthImportPreferenceKey[];
const MAX_COUNT = 1_000_000;

export type SettingsLastKnownSyncCountKey = (typeof SETTINGS_LAST_KNOWN_SYNC_COUNT_KEYS)[number];
export type SettingsLastKnownSyncCounts = Partial<Record<SettingsLastKnownSyncCountKey, number>>;

/** The Location rows' inputs: the iOS permissions and this account's suggestions consent state. */
export type SettingsLocationDisplay = {
  foregroundPermission: LocationPermissionLabel;
  backgroundPermission: LocationPermissionLabel;
  learningEnabled: boolean;
  learningActive: boolean;
  captureState: (typeof CAPTURE_STATES)[number] | null;
};

/**
 * What Settings last showed for this account. Every field is optional (unknown until read once).
 * Display only: never pass these to an action as permission or state truth.
 */
export type SettingsLastKnownDisplay = Readonly<{
  healthAccessGranted?: boolean;
  healthImportPreferences?: Readonly<Partial<Record<HealthImportPreferenceKey, boolean>>>;
  motionFitnessStatus?: DayframeMotionAuthorizationStatus;
  iosSettingsNeeded?: boolean;
  location?: Readonly<SettingsLocationDisplay>;
  reviewNudge?: Readonly<{ enabled: boolean; minutes: number }>;
  nudgePermission?: ReviewNudgePermission;
  sync?: Readonly<SettingsLastKnownSyncCounts>;
  activities?: Readonly<{ count: number; pinned: number }>;
  placesCount?: number;
}>;

type MutableDisplay = { -readonly [Key in keyof SettingsLastKnownDisplay]: SettingsLastKnownDisplay[Key] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? (value as T) : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_COUNT ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Rebuilds a display value from the allow-list: unknown keys, wrong types, free text and anything
 * nested deeper than the schema are dropped, so nothing else can be stored or handed out.
 */
export function sanitizeSettingsLastKnown(input: unknown): SettingsLastKnownDisplay {
  if (!isRecord(input)) return {};
  const out: MutableDisplay = {};
  const healthAccessGranted = bool(input.healthAccessGranted);
  if (healthAccessGranted !== undefined) out.healthAccessGranted = healthAccessGranted;
  if (isRecord(input.healthImportPreferences)) {
    const preferences: Partial<Record<HealthImportPreferenceKey, boolean>> = {};
    for (const key of HEALTH_PREFERENCE_KEYS) {
      const enabled = bool(input.healthImportPreferences[key]);
      if (enabled !== undefined) preferences[key] = enabled;
    }
    if (Object.keys(preferences).length > 0) out.healthImportPreferences = preferences;
  }
  const motion = oneOf(MOTION_STATUSES, input.motionFitnessStatus);
  if (motion) out.motionFitnessStatus = motion;
  const iosSettingsNeeded = bool(input.iosSettingsNeeded);
  if (iosSettingsNeeded !== undefined) out.iosSettingsNeeded = iosSettingsNeeded;
  if (isRecord(input.location)) {
    const location = input.location;
    const foregroundPermission = oneOf(LOCATION_PERMISSIONS, location.foregroundPermission);
    const backgroundPermission = oneOf(LOCATION_PERMISSIONS, location.backgroundPermission);
    const learningEnabled = bool(location.learningEnabled);
    const learningActive = bool(location.learningActive);
    const captureState = location.captureState === null ? null : oneOf(CAPTURE_STATES, location.captureState);
    if (foregroundPermission && backgroundPermission && learningEnabled !== undefined &&
      learningActive !== undefined && captureState !== undefined) {
      out.location = { foregroundPermission, backgroundPermission, learningEnabled, learningActive, captureState };
    }
  }
  if (isRecord(input.reviewNudge)) {
    const enabled = bool(input.reviewNudge.enabled);
    const minutes = count(input.reviewNudge.minutes);
    if (enabled !== undefined && minutes !== undefined && minutes >= REVIEW_NUDGE_MINUTES.min && minutes <= REVIEW_NUDGE_MINUTES.max) {
      out.reviewNudge = { enabled, minutes };
    }
  }
  const nudgePermission = oneOf(NUDGE_PERMISSIONS, input.nudgePermission);
  if (nudgePermission) out.nudgePermission = nudgePermission;
  if (isRecord(input.sync)) {
    const sync: SettingsLastKnownSyncCounts = {};
    for (const key of SETTINGS_LAST_KNOWN_SYNC_COUNT_KEYS) {
      const value = count(input.sync[key]);
      if (value !== undefined) sync[key] = value;
    }
    if (Object.keys(sync).length > 0) out.sync = sync;
  }
  if (isRecord(input.activities)) {
    const total = count(input.activities.count);
    const pinned = count(input.activities.pinned);
    if (total !== undefined && pinned !== undefined && pinned <= total) out.activities = { count: total, pinned };
  }
  const placesCount = count(input.placesCount);
  if (placesCount !== undefined) out.placesCount = placesCount;
  return out;
}

/** A patch merges field by field; the per-source sync counts and Health types one level deeper. */
export function mergeSettingsLastKnown(
  base: SettingsLastKnownDisplay,
  patch: SettingsLastKnownDisplay
): SettingsLastKnownDisplay {
  const merged: MutableDisplay = { ...base, ...patch };
  if (base.sync && patch.sync) merged.sync = { ...base.sync, ...patch.sync };
  if (base.healthImportPreferences && patch.healthImportPreferences) {
    merged.healthImportPreferences = { ...base.healthImportPreferences, ...patch.healthImportPreferences };
  }
  return merged;
}

/** The Location rows' display inputs from a live diagnostics read (nothing else is kept). */
export function settingsLocationDisplay(diagnostics: LocationVisitDiagnostics): SettingsLocationDisplay {
  return {
    foregroundPermission: diagnostics.foregroundPermission,
    backgroundPermission: diagnostics.backgroundPermission,
    learningEnabled: diagnostics.locationLearningEnabled === true,
    learningActive: diagnostics.locationLearningActive === true,
    captureState: diagnostics.locationLearningCaptureState ?? null
  };
}

function lengthOf(value: unknown) {
  return Array.isArray(value) ? value.length : undefined;
}

/**
 * The display projection of a remembered Settings value (settingsRemembered keys), or null for
 * values Settings does not show (the native Location status) or that are not known yet.
 */
export function settingsLastKnownPatchForRemembered(key: string, value: unknown): SettingsLastKnownDisplay | null {
  if (value === null || value === undefined) return null;
  const record = isRecord(value) ? value : {};
  switch (key) {
    case "healthAccessGranted":
      return sanitizeSettingsLastKnown({ healthAccessGranted: value });
    case "motionFitnessStatus":
      return sanitizeSettingsLastKnown({ motionFitnessStatus: value });
    case "iosSettingsNeeded":
      return sanitizeSettingsLastKnown({ iosSettingsNeeded: value });
    case "reviewNudge":
      return sanitizeSettingsLastKnown({ reviewNudge: { enabled: record.enabled, minutes: record.minutes } });
    case "nudgePermission":
      return sanitizeSettingsLastKnown({ nudgePermission: value });
    case "reviewSyncDiagnostics":
      return sanitizeSettingsLastKnown({
        sync: { reviewWaitingCount: record.waitingCount, reviewSignInCount: record.authenticationRequiredCount }
      });
    case "reviewSyncIssues":
      return sanitizeSettingsLastKnown({ sync: { reviewIssueCount: lengthOf(value) } });
    case "timeEntrySyncDiagnostics":
      return sanitizeSettingsLastKnown({
        sync: {
          timeEntryPendingCount: record.pendingCount,
          quarantinedCount: record.quarantinedCount,
          deviceQuarantinedCount: record.deviceQuarantinedCount
        }
      });
    case "timeEntrySyncIssues":
      return sanitizeSettingsLastKnown({ sync: { timeEntryIssueCount: lengthOf(value) } });
    case "timerStopSyncDiagnostics":
      return sanitizeSettingsLastKnown({ sync: { timerStopPendingCount: record.pendingCount } });
    case "timerStopSyncIssues":
      return sanitizeSettingsLastKnown({ sync: { timerStopIssueCount: lengthOf(value) } });
    default:
      return null;
  }
}

type LiveSyncCounts = { [Key in SettingsLastKnownSyncCountKey]: number | null };

/**
 * Sync help's status input for display: each live count once this session has read it (null until
 * then), otherwise the last-known count, otherwise 0. The Needs attention rows themselves (and their
 * Retry/Discard actions) only ever come from the live lists.
 */
export function shownSyncHelpCounts(live: LiveSyncCounts, lastKnown: SettingsLastKnownSyncCounts | undefined) {
  const shown = {} as Record<SettingsLastKnownSyncCountKey, number>;
  for (const key of SETTINGS_LAST_KNOWN_SYNC_COUNT_KEYS) shown[key] = live[key] ?? lastKnown?.[key] ?? 0;
  return shown;
}

export function settingsLastKnownStorageKey(owner: MobileAccountOwner, backend = DAYFRAME_API_BASE) {
  return `${SETTINGS_LAST_KNOWN_KEY_PREFIX}v${SETTINGS_LAST_KNOWN_SCHEMA_VERSION}:${encodeURIComponent(backend)}:` +
    `${encodeURIComponent(owner.workspaceId)}:${encodeURIComponent(owner.userId)}`;
}

type PersistedSettingsLastKnown = {
  schema: typeof SETTINGS_LAST_KNOWN_SCHEMA_VERSION;
  backend: string;
  workspaceId: string;
  userId: string;
  values: SettingsLastKnownDisplay;
};

function serialise(owner: MobileAccountOwner, values: SettingsLastKnownDisplay) {
  const payload: PersistedSettingsLastKnown = {
    schema: SETTINGS_LAST_KNOWN_SCHEMA_VERSION,
    backend: DAYFRAME_API_BASE,
    workspaceId: owner.workspaceId,
    userId: owner.userId,
    values: sanitizeSettingsLastKnown(values)
  };
  return JSON.stringify(payload);
}

/** The stored values for exactly this owner and backend, or null (missing, corrupt, foreign or old schema). */
export function parseSettingsLastKnown(raw: string | null, owner: MobileAccountOwner): SettingsLastKnownDisplay | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.schema !== SETTINGS_LAST_KNOWN_SCHEMA_VERSION) return null;
  if (parsed.backend !== DAYFRAME_API_BASE || parsed.userId !== owner.userId || parsed.workspaceId !== owner.workspaceId) return null;
  if (!isRecord(parsed.values)) return null;
  return sanitizeSettingsLastKnown(parsed.values);
}

type HeldValues = {
  binding: RememberedSettingsBinding & { owner: MobileAccountOwner; ownerKey: string };
  values: SettingsLastKnownDisplay;
  /** Whether the stored payload has been read into `values` (writes before that wait for it). */
  primed: boolean;
};

let held: HeldValues | null = null;
/** Bumped by every clear: storage work started before it never writes or publishes. */
let epoch = 0;
let storageTail: Promise<void> = Promise.resolve();
let persistQueued = false;
let emitQueued = false;
const listeners = new Set<() => void>();
let observedOwnerKey: string | null | undefined;
let observedGeneration = currentSessionGeneration();

function ownerKeyOf(owner: MobileAccountOwner | null) {
  return owner ? `${owner.userId}:${owner.workspaceId}` : null;
}

function withStorage(operation: () => Promise<void>) {
  const result = storageTail.then(operation).catch(() => undefined);
  storageTail = result;
  return result;
}

function emit() {
  emitQueued = false;
  for (const listener of [...listeners]) listener();
}

// Never inside a render or a state updater (remembered values land inside one).
function scheduleEmit() {
  if (emitQueued) return;
  emitQueued = true;
  void Promise.resolve().then(emit);
}

function heldIsCurrent(target: HeldValues) {
  return isRememberedSettingsBindingCurrent(target.binding);
}

/** This account's last-known values in this session, or null when there are none. Display only. */
export function readSettingsLastKnown(): SettingsLastKnownDisplay | null {
  return held && heldIsCurrent(held) && Object.keys(held.values).length > 0 ? held.values : null;
}

function schedulePersist() {
  if (!held) return;
  if (!held.primed) {
    void primeSettingsLastKnown();
    return;
  }
  if (persistQueued) return;
  persistQueued = true;
  const startedIn = epoch;
  void withStorage(async () => {
    persistQueued = false;
    const target = held;
    if (startedIn !== epoch || !target || !target.primed || !heldIsCurrent(target)) return;
    await AsyncStorage.setItem(settingsLastKnownStorageKey(target.binding.owner), serialise(target.binding.owner, target.values));
  });
}

/**
 * Records display values for the account and session `binding` was taken in (a read's
 * `beginRememberedSettingsRead`); a binding that is no longer current records nothing.
 */
export function recordSettingsLastKnown(patch: SettingsLastKnownDisplay, binding: RememberedSettingsBinding) {
  const owner = binding.owner;
  if (!owner || binding.ownerKey === null || !isRememberedSettingsBindingCurrent(binding)) return false;
  const clean = sanitizeSettingsLastKnown(patch);
  if (Object.keys(clean).length === 0) return false;
  const target: HeldValues["binding"] = { generation: binding.generation, owner, ownerKey: binding.ownerKey };
  if (!held || !sameRememberedSettingsBinding(held.binding, target)) held = { binding: target, values: {}, primed: false };
  const values = mergeSettingsLastKnown(held.values, clean);
  if (JSON.stringify(values) === JSON.stringify(held.values)) return true;
  held = { ...held, values };
  scheduleEmit();
  schedulePersist();
  return true;
}

/**
 * Reads this account's stored values into memory (app start, a new active account, and Settings'
 * first render as a fallback), so Settings can paint them on its first frame. Bound to the account
 * and session it started in: a read that finishes after a switch, sign-out or new sign-in never
 * lands. Also removes any other account's or schema's leftovers.
 */
export async function primeSettingsLastKnown() {
  const startedIn = epoch;
  const binding = await beginRememberedSettingsRead();
  const owner = binding.owner;
  if (observedOwnerKey === undefined) observedOwnerKey = binding.ownerKey;
  if (!owner || binding.ownerKey === null) return;
  if (held?.primed && sameRememberedSettingsBinding(held.binding, binding)) return;
  await withStorage(async () => {
    if (startedIn !== epoch || !isRememberedSettingsBindingCurrent(binding)) return;
    const key = settingsLastKnownStorageKey(owner);
    const raw = await AsyncStorage.getItem(key);
    if (startedIn !== epoch || !isRememberedSettingsBindingCurrent(binding)) return;
    // Another prime for the same account and session already landed.
    if (held?.primed && sameRememberedSettingsBinding(held.binding, binding)) return;
    const stored = parseSettingsLastKnown(raw, owner);
    // Values that landed during the read are newer than the stored ones.
    const pending = held && sameRememberedSettingsBinding(held.binding, binding) ? held.values : {};
    held = {
      binding: { generation: binding.generation, owner, ownerKey: binding.ownerKey! },
      values: mergeSettingsLastKnown(stored ?? {}, pending),
      primed: true
    };
    scheduleEmit();
    if (Object.keys(pending).length > 0) schedulePersist();
    // A corrupt, foreign or old-schema payload is ignored and dropped, as is anything left by
    // another account, backend or schema (one account's values on the phone at a time).
    const leftovers = (await AsyncStorage.getAllKeys()).filter((stale) =>
      stale.startsWith(SETTINGS_LAST_KNOWN_KEY_PREFIX) && (stale !== key || (raw !== null && stored === null))
    );
    if (leftovers.length > 0 && startedIn === epoch) await AsyncStorage.multiRemove(leftovers);
  });
}

/** Forgets every account's last-known values, in memory at once and on disk in order. */
export function clearSettingsLastKnown() {
  epoch += 1;
  held = null;
  persistQueued = false;
  scheduleEmit();
  return withStorage(async () => {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(SETTINGS_LAST_KNOWN_KEY_PREFIX));
    if (keys.length > 0) await AsyncStorage.multiRemove(keys);
  });
}

function subscribeSettingsLastKnown(listener: () => void) {
  listeners.add(listener);
  // The held values show only for their own account and session: re-read on every change of either.
  const unsubscribes = [
    subscribeActiveMobileAccount(listener),
    subscribeAuthenticatedSession(listener),
    subscribeMobileSignedOut(listener)
  ];
  return () => {
    listeners.delete(listener);
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}

/**
 * The Settings display layer's last-known values for the current account and session (null when
 * none). Display only: rows fall back to these until their live read lands; actions never read them.
 */
export function useSettingsLastKnown(): SettingsLastKnownDisplay | null {
  const values = useSyncExternalStore(subscribeSettingsLastKnown, readSettingsLastKnown, readSettingsLastKnown);
  useEffect(() => {
    void primeSettingsLastKnown();
  }, []);
  return values;
}

// Sign-out (every path publishes it) clears everything.
subscribeMobileSignedOut(() => {
  void clearSettingsLastKnown();
});

// Every sign-in, sign-out and invalidation is a new authenticated lifetime: nothing carries over.
subscribeAuthenticatedSession(() => {
  const generation = currentSessionGeneration();
  if (generation === observedGeneration) return;
  observedGeneration = generation;
  void clearSettingsLastKnown();
});

// Account or workspace replacement (or the account leaving) clears; a newly known account primes.
subscribeActiveMobileAccount(() => {
  const owner = getActiveMobileAccountSnapshot();
  const key = ownerKeyOf(owner);
  const previous = observedOwnerKey;
  observedOwnerKey = key;
  if (key === null || (previous !== undefined && previous !== key) || (held && held.binding.ownerKey !== key)) {
    void clearSettingsLastKnown();
  }
  if (key !== null) void primeSettingsLastKnown();
});

// Live values that land in Settings keep their display projection here.
subscribeRememberedSettingWrites((key, value, binding) => {
  const patch = settingsLastKnownPatchForRemembered(key, value);
  if (patch) recordSettingsLastKnown(patch, binding);
});

export function __resetSettingsLastKnownForTests() {
  held = null;
  epoch += 1;
  storageTail = Promise.resolve();
  persistQueued = false;
  emitQueued = false;
  listeners.clear();
  observedOwnerKey = undefined;
  observedGeneration = currentSessionGeneration();
}

/** Resolves once every storage step queued so far has run (tests). */
export function __settingsLastKnownStorageIdleForTests() {
  return storageTail;
}
