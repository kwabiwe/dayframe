import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import {
  classifyLocationLearningEvidence,
  LOCATION_ENGINE_V2_CONFIG,
  LOCATION_LEARNING_THRESHOLDS,
  LocationEvidenceSchema,
  placeDisplayName,
  readableLocationNameFromParts,
  type LocationEvidence,
  type LocationLearningEvidence,
  type PlaceRole
} from "@dayframe/shared";
import { enqueueEvent } from "./api";
import { registerLocationAdmissionGuard } from "./location/admissionGuard";
import { createSerialMutationQueue } from "./location/mutationQueue";
import { ACCURACY_BURST_DURATION_MS, ACCURACY_BURST_FORCE_STOP_MS, accuracyBurstArm, accuracyBurstDecision, accuracyBurstDue, accuracyBurstTrigger, endAccuracyBurst, startAccuracyBurst, startAccuracyBurstTrial,
  withTrialProgress, type AccuracyBurstKind, type AccuracyBurstState } from "./location/accuracyBurst";
import { reverseGeocodeLocation } from "./locationGeocoding";
import { distanceMeters, freshestGeofenceFix, GEOFENCE_POSITION_MAX_ACCURACY_METERS, GEOFENCE_POSITION_MAX_AGE_MS,
  GEOFENCE_REFRESH_RADIUS_TOLERANCE_METERS, insideRefreshCircle, IOS_GEOFENCE_LIMIT, normalizedGeofenceRadius,
  refreshRadiusFor, selectGeofencePlaces, type GeofencePosition, type GeofencePositionFix,
  type GeofenceRefreshCircle } from "./geofenceSelection";
import { LOCATION_LEARNING_ENABLED_KEY, locationAccountStorageKey as accountStorageKey,
  readLocationCaptureConsent, writeLocationCaptureConsent } from "./location/captureConsent";
import { getActiveMobileAccountSnapshot, mobileAccountKey, mobileAccountOwnersEqual, readActiveMobileAccount,
  subscribeActiveMobileAccount, type MobileAccountOwner } from "./mobileAccount";
import { subscribeMobileSignedOut } from "./mobileSessionTransition";
import { captureLocationOwnership, updateLocationCaptureCatalogue, getLocationRolloutMode, hasLegacyLocationOwner, isLocationCaptureSnapshotCurrent,
  locationCaptureRevision, recordLocationCaptureDiscard, type LocationCaptureSnapshot } from "./location/store";
import { bindLocationCaptureOwner, drainNativeLocationSignalsInBatches, enableLocationCaptureOwnership, endLocationCaptureOwnership, locationCaptureAccountChanged,
  isLocationLogoutCurrent, locationCaptureSessionSignedOut, stopUnownedLocationCapture, withLocationCaptureLifecycle } from "./location/runtime";

export const DAYFRAME_GEOFENCE_TASK = "DAYFRAME_GEOFENCE_TASK";
export const DAYFRAME_LOCATION_LEARNING_TASK = "DAYFRAME_LOCATION_LEARNING_TASK";
export const LOCATION_VISIT_DWELL_THRESHOLD_MINUTES = 5;
export const LOCATION_VISIT_DWELL_THRESHOLD_MS = LOCATION_VISIT_DWELL_THRESHOLD_MINUTES * 60_000;

type DayframeRegion = {
  identifier?: string;
  latitude: number;
  longitude: number;
  radius: number;
  notifyOnEnter: boolean;
  notifyOnExit: boolean;
};

export type LocationPermissionLabel = "granted" | "denied" | "undetermined" | "unknown";

export type LocationVisitDiagnostics = {
  foregroundPermission: LocationPermissionLabel;
  backgroundPermission: LocationPermissionLabel;
  activeMonitorCount: number;
  configuredMonitorCount?: number;
  excludedMonitorCount?: number;
  geofencingActive?: boolean;
  monitoredPlaceNames?: string[];
  excludedPlaceNames?: string[];
  /** How the watched places were chosen (geofenceSelection.ts); never where the phone is. */
  geofenceSelection?: "all" | "nearest" | "priority";
  lastStatus?: string;
  lastPlaceName?: string;
  lastEventAt?: string;
  lastGeofenceEvent?: {
    transition: GeofenceTransition;
    placeName: string;
    occurredAt: string;
  };
  lastTransitionEvidence?: GeofenceTransitionEvidence;
  transitionEvidenceHistory?: GeofenceTransitionEvidence[];
  lastQueuedVisitCandidate?: {
    placeName: string;
    startedAt: string;
    stoppedAt: string;
    queuedAt: string;
    durationSeconds: number;
  };
  locationLearningEnabled?: boolean;
  locationLearningActive?: boolean;
  // Stored consent is not proof that the current binding/OS start completed.
  locationLearningCaptureState?: "off" | "inactive" | "active" | "logout_cleanup";
  lastLearningSampleAt?: string;
  lastLearnedPlaceCandidate?: {
    candidateName: string;
    startedAt: string;
    stoppedAt: string;
    queuedAt: string;
    durationSeconds: number;
    sampleCount: number;
  };
  lastCommuteCandidate?: {
    fromPlaceName: string;
    toPlaceName: string;
    startedAt: string;
    stoppedAt: string;
    queuedAt: string;
    durationSeconds: number;
  };
  lastMonitorRefreshAt?: string;
  lastVisitQueuedAt?: string;
};

type MonitoredPlace = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  priority: number;
  defaultCategoryId?: string | null;
  defaultCategoryName?: string | null;
  defaultActivityDescription?: string | null;
  loggingEnabled?: boolean;
};

type OpenVisit = {
  placeId: string;
  placeName: string;
  enteredAt: string;
  radiusMeters: number;
  source: "geofence_specific" | "geofence_broad";
  defaultCategoryId?: string | null;
  defaultCategoryName?: string | null;
  defaultActivityDescription?: string | null;
  loggingEnabled?: boolean;
};

type CompletedVisit = {
  kind?: "saved_place" | "learned_place" | "unknown_place";
  placeId?: string;
  placeName: string;
  startedAt: string;
  stoppedAt: string;
  latitude?: number;
  longitude?: number;
  clusterKey?: string;
};

type LearnedPlaceCluster = {
  id: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  visitCount?: number;
  firstSeenAt: string;
  lastSeenAt: string;
  currentVisitStartedAt?: string;
  currentVisitSampleCount?: number;
  seenDayKeys?: string[];
  sampleCount: number;
  completedDwellMs?: number;
  longestCompletedDwellMs?: number;
  accuracyTotalMeters?: number;
  accuracySampleCount?: number;
  maxClusterSpreadMeters?: number;
  lastQueuedAt?: string;
  lastOneOffQueuedAt?: string;
  lastOneOffVisitStartedAt?: string;
  lastCommuteQueuedAt?: string;
};

type GeofenceTransition = "enter" | "exit";

export type GeofenceTransitionEvidence = {
  transition: GeofenceTransition;
  placeName: string;
  occurredAt: string;
  outcome: "accepted" | "rejected_far_from_region" | "no_recent_location";
  configuredRadiusMeters: number;
  distanceMeters?: number;
  accuracyMeters?: number;
  sampleAgeSeconds?: number;
};

// The refresh circle of nearest-place selection: one of the 20 regions, never a place.
const GEOFENCE_REFRESH_REGION_ID = "nearest-refresh";
const MAX_DIAGNOSTIC_UNWATCHED_NAMES = 50;
const MONITORED_PLACES_KEY = "dayframe.location.monitoredPlaces.v1";
const SAVED_PLACE_CATALOGUE_KEY = "dayframe.location.savedPlaceCatalogue.v2";
const GEOFENCE_REGISTRATION_KEY = "dayframe.location.geofenceRegistration.v1";
const GEOFENCE_SELECTION_AT_KEY = "dayframe.location.geofenceSelectionAt.v1";
const OPEN_VISITS_KEY = "dayframe.location.openVisits.v1";
const SEEN_VISIT_IDS_KEY = "dayframe.location.seenVisits.v1";
const LOCATION_DIAGNOSTICS_KEY = "dayframe.location.diagnostics.v1";
const LEARNED_PLACE_CLUSTERS_KEY = "dayframe.location.learning.clusters.v1";
const LAST_COMPLETED_VISIT_KEY = "dayframe.location.lastCompletedVisit.v1";
const MAX_SEEN_VISIT_IDS = 500;
const MAX_TRANSITION_EVIDENCE_ITEMS = 12;
const GEOFENCE_EVIDENCE_MAX_AGE_MS = 5 * 60_000;
const GEOFENCE_ENTER_REJECTION_MAX_AGE_MS = 60_000;
const GEOFENCE_EVIDENCE_REQUIRED_ACCURACY_METERS = 250;
const GEOFENCE_ENTER_OUTSIDE_BUFFER_METERS = 100;
const LOCATION_LEARNING_SAMPLE_INTERVAL_MS = LOCATION_LEARNING_THRESHOLDS.sampleIntervalMs;
const LOCATION_LEARNING_DISTANCE_INTERVAL_METERS = LOCATION_LEARNING_THRESHOLDS.distanceIntervalMeters;
const LEARNED_PLACE_RADIUS_METERS = LOCATION_LEARNING_THRESHOLDS.clusterRadiusMeters;
const LEARNED_PLACE_COMMUTE_DWELL_MS = LOCATION_LEARNING_THRESHOLDS.commuteDwellMs;
const LEARNED_PLACE_QUEUE_COOLDOWN_MS = LOCATION_LEARNING_THRESHOLDS.learnedPlaceQueueCooldownMs;
const LEARNED_PLACE_ONE_OFF_QUEUE_COOLDOWN_MS = LOCATION_LEARNING_THRESHOLDS.oneOffQueueCooldownMs;
const LEARNED_PLACE_COMMUTE_QUEUE_COOLDOWN_MS = LOCATION_LEARNING_THRESHOLDS.commuteQueueCooldownMs;
const LEARNED_PLACE_VISIT_GAP_MS = LOCATION_LEARNING_THRESHOLDS.visitGapMs;
const MAX_LEARNED_PLACE_CLUSTERS = 24;
const MIN_COMMUTE_DURATION_MS = 3 * 60_000;
const MAX_COMMUTE_DURATION_MS = 6 * 60 * 60_000;
const SAVED_PLACE_ACCURACY_BUFFER_MIN_METERS = 25;
const SAVED_PLACE_ACCURACY_BUFFER_MAX_METERS = 100;
const SAVED_PLACE_MIN_EFFECTIVE_RADIUS_METERS = 75;
const SAVED_PLACE_LEARNING_SUPPRESSION_METERS = 150;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The consent read an admitted wake needs; when it fails, inherited options are put back first (Codex r16 on #619). */
async function learningEnabledOrGuard() {
  return getLocationLearningEnabled().catch(async (error) => {
    await protectInheritedAccuracyOptions();
    throw error;
  });
}

/**
 * A wake this capture no longer owns stops what it can. Its diagnostics never come first (a failed write can't skip
 * the stop), and a stop that fails leaves options this process never set to the guard, which keeps stopping them
 * until a stop succeeds or a capture in this process sets them (Codex r18 on #619).
 */
async function stopRejectedWakeCapture(capture: LocationCaptureSnapshot) {
  await stopUnownedLocationCapture(capture).catch(async (error) => {
    await withNativeLocationOptions(async () => guardInheritedAccuracyOptions(STOPPED_CAPTURE)).catch(() => undefined);
    throw error;
  });
}

/** A task's owner, read first; when it can't be read, inherited options are put back first (Codex r17 on #619). */
async function admittedCapture(captured: Promise<LocationCaptureSnapshot>) {
  return captured.then(hydrateLegacyCapture).catch(async (error) => {
    await protectInheritedAccuracyOptions();
    throw error;
  });
}

TaskManager.defineTask(DAYFRAME_GEOFENCE_TASK, async ({ data, error }) => {
  guardWakeAdmission();
  const captured = captureLocationOwnership();
  const capture = await admittedCapture(captured);
  if (!isLocationCaptureSnapshotCurrent(capture) || !await learningEnabledOrGuard() || !isLocationCaptureSnapshotCurrent(capture)) {
    await recordLocationCaptureDiscard(capture.revision !== locationCaptureRevision() ? "stale_epoch" : !capture.binding || !capture.context ? "no_owner" : "opted_out", 1)
      .catch(() => undefined);
    await stopRejectedWakeCapture(capture);
    return;
  }
  // An admitted wake puts inherited best-accuracy options back (and ends a burst past its 3 minutes) before anything
  // that can fail and return early: an error, or evidence that can't be stored (Codex r15 on #619).
  await maybeEndAccuracyBurst(capture).catch(() => undefined);
  if (error) {
    await updateLocationDiagnostics({
      lastStatus: "Location monitor reported an error.",
      lastEventAt: new Date().toISOString()
    }, capture);
    return;
  }
  const payload = data as {
    eventType: Location.GeofencingEventType;
    region: DayframeRegion;
  };
  const transition =
    payload.eventType === Location.GeofencingEventType.Enter
      ? "enter"
      : payload.eventType === Location.GeofencingEventType.Exit
        ? "exit"
        : null;
  if (!transition) return;

  // The refresh circle is not a place: neither of its transitions is evidence or a visit. Leaving
  // this lifetime's circle picks the nearest places again.
  if (isRefreshRegionIdentifier(payload.region.identifier)) {
    if (transition === "exit" && payload.region.identifier === refreshRegionIdentifier(capture.binding!.id)) {
      await refreshNearestGeofencesOnWake(capture, "refresh_exit");
    }
    return;
  }

  const persisted = await persistV2GeofenceEvidence(transition, payload.region, capture).catch(async (persistError) => {
    await recordV2LocationFailure(persistError, capture);
    return null;
  });
  if (!persisted) return;
  // Leaving or reaching a saved place sharpens the trip's ends with a best-accuracy burst (card K, location v4 §10).
  await maybeStartAccuracyBurst(transition === "exit" ? "departure" : "arrival", capture).catch(() => undefined);
  // Expo geofences are shared capture infrastructure for V2. Once any V2 mode
  // is active they must persist evidence only; the legacy visit classifier must
  // never run as a semantic fallback (including in shadow mode).
  if (persisted.rolloutMode !== "v1") return;

  if (!isLocationCaptureSnapshotCurrent(capture)) return;
  const identifier = payload.region.identifier?.split(":").at(-1);
  await withLocationCaptureLifecycle(async () => {
    if (isLocationCaptureSnapshotCurrent(capture)) await recordGeofenceTransition(transition, { ...payload.region, identifier }, new Date(), capture);
  });
});

TaskManager.defineTask(DAYFRAME_LOCATION_LEARNING_TASK, async ({ data, error }) => {
  guardWakeAdmission();
  const captured = captureLocationOwnership();
  const capture = await admittedCapture(captured);
  if (!isLocationCaptureSnapshotCurrent(capture)) {
    const count = (data as {locations?: unknown[]} | undefined)?.locations?.length ?? 0;
    if (count) {
      await recordLocationCaptureDiscard(capture.revision !== locationCaptureRevision() ? "stale_epoch" : !capture.binding || !capture.context ? "no_owner" : "opted_out", count)
        .catch(() => undefined);
    }
    await stopRejectedWakeCapture(capture);
    return;
  }
  const enabled = await learningEnabledOrGuard();
  if (!enabled) {
    await stopRejectedWakeCapture(capture);
    return;
  }
  // A burst past its 3 minutes ends with this wake (card K), before an error or a failed write can return early
  // (Codex r15 on #619).
  await maybeEndAccuracyBurst(capture).catch(() => undefined);
  if (error) {
    await updateLocationDiagnostics({
      lastStatus: "Location learning reported an error.",
      lastEventAt: new Date().toISOString()
    }, capture);
    return;
  }
  const payload = data as { locations?: Location.LocationObject[] };
  const locations = [...(payload.locations ?? [])].sort((left, right) => left.timestamp - right.timestamp);
  const persisted = await persistV2LocationBatch(locations, capture).catch(async (persistError) => {
    await recordV2LocationFailure(persistError, capture);
    return null;
  });
  if (!persisted) return;
  // A reading outside the refresh circle picks the nearest places again (after the evidence above).
  // Only readings the capture boundary admitted count.
  await refreshNearestGeofencesOnWake(capture, "location_update", persisted.admittedLocations.map(fixFromLocation));
  // The continuous Expo task feeds both pipelines, but V1 classification is
  // permitted only in the explicit V1 mode.
  if (persisted.rolloutMode !== "v1") return;
  await withLocationCaptureLifecycle(async () => {
    const places = await readSavedPlaceCatalogue();
    for (const location of locations) {
      if (!isLocationCaptureSnapshotCurrent(capture) || location.timestamp < Date.parse(capture.binding!.boundAt)) continue;
      await recordLocationLearningSample(location, Object.values(places), capture);
    }
  });
});

// These listeners also exist in Expo headless launches; Dashboard is not the
// authority for Location teardown. Rejections are handled without raw payloads.
subscribeActiveMobileAccount(() => {
  void locationCaptureAccountChanged(getActiveMobileAccountSnapshot()).catch(() => undefined);
});
subscribeMobileSignedOut(() => {
  void locationCaptureSessionSignedOut().catch(() => undefined);
});

async function hydrateLegacyCapture(capture: LocationCaptureSnapshot) {
  if (capture.binding || !capture.context || capture.revision !== locationCaptureRevision() ||
    !await hasLegacyLocationOwner(capture.context)) return capture;
  // A headless upgrade must migrate demonstrably owned consent before cleanup
  // removes the legacy binding. Reuse its stored device/context, not Keychain.
  await bindLocationCaptureOwner(capture.context, capture.revision);
  const updated = await captureLocationOwnership();
  const originalLifetime = { ...updated, revision: capture.revision };
  if (isLocationCaptureSnapshotCurrent(originalLifetime)) {
    await refreshGeofencesForPlaces(originalLifetime.context!.savedPlaces, originalLifetime.context!);
  }
  return originalLifetime;
}

/**
 * True when iOS will no longer show a location prompt (denied or restricted with no second ask,
 * or Always already declined): only this app's page in iOS Settings can change it (UIA-111,
 * mobile-permissions.md "denied and needs Settings").
 */
export async function locationAccessNeedsIosSettings() {
  const foreground = await Location.getForegroundPermissionsAsync();
  if (foreground.status === "denied") return !foreground.canAskAgain;
  if (foreground.status !== "granted") {
    // An Allow Once grant expired (or nothing was ever granted): any Always request made under it
    // failed without showing iOS's prompt, so it doesn't count as spent.
    if (foreground.status === "undetermined") await AsyncStorage.removeItem(ALWAYS_LOCATION_REQUESTED_KEY).catch(() => undefined);
    return false;
  }
  const background = await readBackgroundLocationPermission();
  if (background.granted) return false;
  if (background.status === "denied" && !background.canAskAgain) return true;
  // iOS shows the Always upgrade once, whatever the answer (and a later downgrade to While Using
  // in iOS Settings doesn't make it ask again); after a restart Expo reports it askable, so the
  // spent request is remembered on this iPhone.
  return (await AsyncStorage.getItem(ALWAYS_LOCATION_REQUESTED_KEY).catch(() => null)) === "asked";
}

const ALWAYS_LOCATION_REQUESTED_KEY = "dayframe.location.alwaysRequest.v2";

/**
 * Every Always read in this module goes through here, so a grant seen on any path (launch, geofence
 * refresh, Settings, diagnostics) records that iOS's one Always prompt has been used.
 */
async function readBackgroundLocationPermission() {
  const background = await Location.getBackgroundPermissionsAsync();
  if (background.granted) await rememberAlwaysGranted();
  return background;
}

/**
 * Always is allowed, so iOS's one-time upgrade prompt has been used (perhaps by an older build that
 * kept no record): a later downgrade to While Using must route to iOS Settings.
 */
async function rememberAlwaysGranted() {
  await AsyncStorage.setItem(ALWAYS_LOCATION_REQUESTED_KEY, "asked").catch(() => undefined);
}

/**
 * Every While Using request goes through here. When the current grant has lapsed (an Allow Once
 * that expired, or nothing yet), an Always request made under it failed without iOS's prompt, so
 * that record is cleared before the new grant; otherwise a later upgrade would wrongly go to
 * Settings.
 */
export async function requestForegroundLocationPermission() {
  const current = await Location.getForegroundPermissionsAsync().catch(() => null);
  if (!current?.granted) await AsyncStorage.removeItem(ALWAYS_LOCATION_REQUESTED_KEY).catch(() => undefined);
  return Location.requestForegroundPermissionsAsync();
}

/**
 * Asks iOS for Always location (its one-time upgrade prompt) and remembers that it was asked, so
 * later taps go to iOS Settings instead of a request that shows nothing.
 */
export async function requestAlwaysLocationPermission() {
  const background = await Location.requestBackgroundPermissionsAsync();
  await AsyncStorage.setItem(ALWAYS_LOCATION_REQUESTED_KEY, "asked").catch(() => undefined);
  return background;
}

export async function requestLocationAccess() {
  const foreground = await requestForegroundLocationPermission();
  if (!foreground.granted) {
    await updateLocationDiagnostics({
      foregroundPermission: permissionLabel(foreground.status),
      activeMonitorCount: 0,
      lastStatus: "Location permission was not enabled.",
      lastEventAt: new Date().toISOString()
    });
    return foreground.canAskAgain
      ? "Location permission was not enabled. You can try again when you are ready."
      : "Location is denied. Open iOS Settings to allow Dayframe to use location.";
  }

  const background = await requestAlwaysLocationPermission();
  await updateLocationDiagnostics({
    foregroundPermission: permissionLabel(foreground.status),
    backgroundPermission: permissionLabel(background.status),
    lastStatus: background.granted
      ? "Always allowed. Dayframe can monitor saved places."
      : "Background location is not enabled.",
    lastEventAt: new Date().toISOString()
  });
  if (background.granted) return "Always allowed. Dayframe can monitor known places in the background.";

  const accuracyNote =
    foreground.ios?.accuracy === "reduced"
      ? " Precise location is off, so place detection may be less accurate."
      : "";
  return background.canAskAgain
    ? `Allowed while using the app. Enable Always access to monitor places in the background.${accuracyNote}`
    : `Allowed while using the app. Open iOS Settings to enable Always access for background place monitoring.${accuracyNote}`;
}

export async function getLocationLearningEnabled() {
  const owner = await readActiveMobileAccount();
  if (!owner) return false;
  await migrateLegacyLocationOptIn(owner);
  const enabled = await readLocationCaptureConsent(owner);
  return mobileAccountOwnersEqual(getActiveMobileAccountSnapshot(), owner) && enabled;
}

export function writeLocationLearningPreference(owner: MobileAccountOwner, enabled: boolean) {
  return writeLocationCaptureConsent(owner, enabled);
}

export async function migrateLegacyLocationOptIn(owner: MobileAccountOwner) {
  const legacy = await AsyncStorage.getItem(LOCATION_LEARNING_ENABLED_KEY);
  if (legacy === null) return;
  const scopedKey = accountStorageKey(LOCATION_LEARNING_ENABLED_KEY, mobileAccountKey(owner));
  if (await hasLegacyLocationOwner(owner) && mobileAccountOwnersEqual(getActiveMobileAccountSnapshot(), owner) &&
    await AsyncStorage.getItem(scopedKey) === null) {
    await AsyncStorage.setItem(scopedKey, legacy === "true" ? "true" : "false");
  }
  await AsyncStorage.removeItem(LOCATION_LEARNING_ENABLED_KEY);
}

export async function clearLocationCaptureCaches(ownerKey?: string) {
  for (const key of [MONITORED_PLACES_KEY, SAVED_PLACE_CATALOGUE_KEY, GEOFENCE_REGISTRATION_KEY, GEOFENCE_SELECTION_AT_KEY,
    OPEN_VISITS_KEY, SEEN_VISIT_IDS_KEY, LOCATION_DIAGNOSTICS_KEY, LEARNED_PLACE_CLUSTERS_KEY, LAST_COMPLETED_VISIT_KEY]) {
    await AsyncStorage.removeItem(key);
    if (ownerKey) await AsyncStorage.removeItem(accountStorageKey(key, ownerKey));
  }
}

async function readLocationCache(key: string, captured?: LocationCaptureSnapshot) {
  const capture = captured ?? await captureLocationOwnership();
  if (!capture.context || !capture.binding || capture.revision !== locationCaptureRevision()) return null;
  const value = await AsyncStorage.getItem(accountStorageKey(key, mobileAccountKey(capture.context)));
  return capture.revision === locationCaptureRevision() && mobileAccountOwnersEqual(getActiveMobileAccountSnapshot(), capture.context) ? value : null;
}
async function writeLocationCache(key: string, value: string, captured?: LocationCaptureSnapshot) {
  const capture = captured ?? await captureLocationOwnership();
  if (capture.context && capture.binding && capture.revision === locationCaptureRevision() &&
    mobileAccountOwnersEqual(getActiveMobileAccountSnapshot(), capture.context)) {
    await AsyncStorage.setItem(accountStorageKey(key, mobileAccountKey(capture.context)), value);
  }
}

export async function setLocationLearningEnabled(
  enabled: boolean,
  places: Array<{
    id: string;
    name: string;
    latitude?: number | null;
    longitude?: number | null;
    radiusMeters: number;
    priority?: number;
    loggingEnabled?: boolean;
  }> = [],
  expectedOwner?: MobileAccountOwner
) {
  guardWakeAdmission();
  const revision = locationCaptureRevision();
  const owner = await readActiveMobileAccount();
  if (!owner) return "Sign in before enabling Location learning.";
  if (expectedOwner && !mobileAccountOwnersEqual(expectedOwner, owner)) return "Location account changed.";
  if (!enabled) {
    if (revision !== locationCaptureRevision() || !mobileAccountOwnersEqual(getActiveMobileAccountSnapshot(), owner)) return "Location account changed.";
    const end = endLocationCaptureOwnership("opt_out", owner);
    const endedRevision = locationCaptureRevision();
    await end;
    if (endedRevision !== locationCaptureRevision() || !mobileAccountOwnersEqual(getActiveMobileAccountSnapshot(), owner)) return "Location account changed.";
    await updateLocationDiagnostics({
      locationLearningEnabled: false,
      locationLearningActive: false,
      lastStatus: "Commute and regular-place learning is paused.",
      lastEventAt: new Date().toISOString()
    });
    return "Commute and regular-place learning is paused.";
  }

  const foreground = await Location.getForegroundPermissionsAsync();
  const background = await readBackgroundLocationPermission();
  if (revision !== locationCaptureRevision() || !mobileAccountOwnersEqual(getActiveMobileAccountSnapshot(), owner)) return "Location account changed.";
  if (foreground.status !== "granted" || background.status !== "granted") {
    await updateLocationDiagnostics({
      foregroundPermission: permissionLabel(foreground.status),
      backgroundPermission: permissionLabel(background.status),
      locationLearningEnabled: false,
      locationLearningActive: false,
      lastStatus: "Enable Always location access before turning on commute and regular-place learning.",
      lastEventAt: new Date().toISOString()
    });
    return "Enable Always location access before turning on commute and regular-place learning.";
  }

  if (!await enableLocationCaptureOwnership(owner, revision)) return "Location account changed.";
  if (revision !== locationCaptureRevision() || !mobileAccountOwnersEqual(getActiveMobileAccountSnapshot(), owner)) return "Location account changed.";
  const capture = await refreshCaptureCatalogue(places, owner);
  if (capture.revision !== revision || !mobileAccountOwnersEqual(capture.context, owner)) return "Location account changed.";
  const started = await withLocationCaptureLifecycle(async () => {
    if (!await startLocationLearningUnsafe(places, capture)) return false;
    await startGeofencesUnsafe(places, capture);
    if (isLocationCaptureSnapshotCurrent(capture)) {
      await import("./location/runtime").then(({ startNativeLocationIntelligence }) => startNativeLocationIntelligence());
    }
    return isLocationCaptureSnapshotCurrent(capture) && await getLocationLearningEnabled() &&
      isLocationCaptureSnapshotCurrent(capture);
  });
  if (!started || !isLocationCaptureSnapshotCurrent(capture)) return "Location account changed.";
  return "Commute and regular-place learning is on. Suggestions are asked in Calendar.";
}

export function startGeofences(places: Parameters<typeof startGeofencesUnsafe>[0], owner?: MobileAccountOwner) {
  guardWakeAdmission();
  const captured = captureLocationOwnership();
  return withLocationCaptureLifecycle(async () => {
    const capture = await refreshCaptureCatalogue(places, owner, await captured);
    const started = await startGeofencesUnsafe(places, capture);
    // Registration sets no learning options of its own: a consenting capture gets normal capture back here.
    await reconcileLearningOptionsAfterAdmission(capture);
    return started;
  });
}
export function startLocationLearning(places: Parameters<typeof startLocationLearningUnsafe>[0] = []) {
  guardWakeAdmission();
  const captured = captureLocationOwnership();
  return withLocationCaptureLifecycle(async () => startLocationLearningUnsafe(places, await captured));
}
export function refreshGeofencesForPlaces(places: Parameters<typeof refreshGeofencesForPlacesUnsafe>[0], owner?: MobileAccountOwner) {
  // Every launch notes a seen Always grant, whatever this account's consent or binding: whether iOS
  // will ask again belongs to the iPhone, not to capture (UIA-111).
  void readBackgroundLocationPermission().catch(() => undefined);
  guardWakeAdmission();
  const captured = captureLocationOwnership();
  return withLocationCaptureLifecycle(async () => {
    try {
      const capture = await refreshCaptureCatalogue(places, owner, await captured);
      return await refreshGeofencesForPlacesUnsafe(places, capture);
    } catch (error) {
      // A refresh that failed before it set the options (an owner, consent or permission read) still puts inherited
      // best accuracy back (Codex r17 on #619).
      await protectInheritedAccuracyOptions();
      throw error;
    }
  });
}

async function refreshCaptureCatalogue(places: Parameters<typeof startGeofencesUnsafe>[0], owner?: MobileAccountOwner,
  initial?: LocationCaptureSnapshot) {
  const capture = initial ?? await captureLocationOwnership();
  if (!isLocationCaptureSnapshotCurrent(capture) || !capture.context ||
    (owner && !mobileAccountOwnersEqual(owner, capture.context)) ||
    !mobileAccountOwnersEqual(getActiveMobileAccountSnapshot(), capture.context)) return { ...capture, context: null };
  const updated = await updateLocationCaptureCatalogue(places.flatMap(place =>
    typeof place.latitude !== "number" || typeof place.longitude !== "number" ? [] : [{
      id: place.id, name: place.name, role: place.role ?? null, latitude: place.latitude, longitude: place.longitude,
      radiusMeters: place.radiusMeters, priority: place.priority, loggingEnabled: place.loggingEnabled
    }]), capture);
  if (!updated) return { ...capture, context: null };
  return { ...await captureLocationOwnership(), revision: capture.revision };
}

type GeofencePlaceInput = {
  id: string;
  name: string;
  role?: PlaceRole | null;
  latitude?: number | null;
  longitude?: number | null;
  radiusMeters: number;
  priority?: number;
  defaultCategoryId?: string | null;
  defaultCategoryName?: string | null;
  defaultActivityDescription?: string | null;
  loggingEnabled?: boolean;
};

type GeofenceRepickTrigger = "refresh_exit" | "location_update" | "visit_or_significant_change";

/** The shortest gap between two re-picks not caused by leaving the refresh circle (this process). */
export const REPICK_MIN_INTERVAL_MS = 30_000;
let lastRepickAt = Number.NEGATIVE_INFINITY;
/** Tests only: forget the last re-pick. */
export function __resetGeofenceRepickClockForTests() {
  lastRepickAt = Number.NEGATIVE_INFINITY;
}

async function startGeofencesUnsafe(places: GeofencePlaceInput[], capture: LocationCaptureSnapshot) {
  if (!isLocationCaptureSnapshotCurrent(capture) || !await getLocationLearningEnabled() || !isLocationCaptureSnapshotCurrent(capture)) return 0;
  const monitorablePlaces = places
    .filter((place) => capture.context!.savedPlaces.some(saved => saved.id === place.id) && typeof place.latitude === "number" && typeof place.longitude === "number");
  // Every place that may be watched, so a transition of whichever are watched now finds its place.
  await writeMonitoredPlaces(monitorablePlaces.map(monitoredPlaceFromInput));
  return registerGeofenceSelectionUnsafe(monitorablePlaces, capture);
}

/**
 * Registers the selected places (geofenceSelection.ts) and, above the iOS limit, the refresh circle.
 * Re-registers only when the watched set changed (identifier, centre and radius), the phone has
 * left the current refresh circle, or the circle no longer fits the unwatched places; otherwise the
 * registration iOS has is kept, because a new one makes iOS report every region's initial state
 * again. `position` undefined reads the phone's last known position, falling back to the current
 * circle's centre, then to priority order. A position older than the one the current selection
 * used (or than the capture binding) is never used.
 */
async function registerGeofenceSelectionUnsafe(
  monitorablePlaces: GeofencePlaceInput[],
  capture: LocationCaptureSnapshot,
  position?: GeofencePositionFix
) {
  const refreshIdentifier = refreshRegionIdentifier(capture.binding!.id);
  const storedFingerprint = await readLocationCache(GEOFENCE_REGISTRATION_KEY, capture);
  if (!isLocationCaptureSnapshotCurrent(capture)) return 0;
  const storedRegions = parseJson<DayframeRegion[]>(storedFingerprint, []);
  const storedRefresh = Array.isArray(storedRegions)
    ? storedRegions.find((region) => region?.identifier === refreshIdentifier) ?? null
    : null;
  let used: GeofencePositionFix | null = position ?? null;
  let where: GeofencePosition | null = used;
  if (!where && monitorablePlaces.length > IOS_GEOFENCE_LIMIT) {
    const floor = await selectionPositionFloor(capture);
    used = freshestGeofenceFix([await readLastKnownGeofenceFix()].filter((fix) => fix && fix.timestamp >= floor));
    where = used ?? (storedRefresh ? { latitude: storedRefresh.latitude, longitude: storedRefresh.longitude } : null);
    if (!isLocationCaptureSnapshotCurrent(capture)) return 0;
  }
  const selection = selectGeofencePlaces(monitorablePlaces, where);
  // Above the limit the set changes as the phone moves: registered in id order, so the same set is
  // the same registration whatever the distances.
  const registeredPlaces = selection.mode === "all"
    ? selection.places
    : [...selection.places].sort((left, right) => left.id.localeCompare(right.id));
  const placeRegions: DayframeRegion[] = registeredPlaces
    .map((place) => ({
      identifier: `${capture.binding!.id}:${place.id}`,
      latitude: place.latitude as number,
      longitude: place.longitude as number,
      radius: normalizedGeofenceRadius(place.radiusMeters),
      notifyOnEnter: true,
      notifyOnExit: true
    }));
  const samePlaces = Boolean(storedRefresh) &&
    JSON.stringify(storedRegions.filter((region) => region !== storedRefresh)) === JSON.stringify(placeRegions);
  // The current circle is kept only while the phone is inside it and it still fits the unwatched
  // places as they are now (an edit can move one closer).
  const keepRefresh = Boolean(storedRefresh && samePlaces && where && insideRefreshCircle(where, refreshCircleOf(storedRefresh)) &&
    Math.abs(storedRefresh.radius - refreshRadiusFor(storedRefresh, selection.unwatched)) <= GEOFENCE_REFRESH_RADIUS_TOLERANCE_METERS);
  const refreshRegion: DayframeRegion | null = !selection.refresh
    ? null
    : keepRefresh
      ? storedRefresh
      : {
          identifier: refreshIdentifier,
          latitude: selection.refresh.latitude,
          longitude: selection.refresh.longitude,
          radius: selection.refresh.radiusMeters,
          notifyOnEnter: true,
          notifyOnExit: true
        };
  const regions = refreshRegion ? [...placeRegions, refreshRegion] : placeRegions;

  if (regions.length === 0) {
    await stopGeofencesIfStarted();
    await writeLocationCache(GEOFENCE_REGISTRATION_KEY, "", capture);
    await updateLocationDiagnostics({
      activeMonitorCount: 0,
      configuredMonitorCount: 0,
      excludedMonitorCount: 0,
      excludedPlaceNames: [],
      geofenceSelection: "all",
      geofencingActive: false,
      lastStatus: "No saved places with coordinates to monitor.",
      lastMonitorRefreshAt: new Date().toISOString(),
      monitoredPlaceNames: []
    }, capture);
    return 0;
  }

  const registrationFingerprint = JSON.stringify(regions);
  const alreadyStarted = await Location.hasStartedGeofencingAsync(DAYFRAME_GEOFENCE_TASK).catch(() => false);
  if (!isLocationCaptureSnapshotCurrent(capture)) return 0;
  if (!alreadyStarted || storedFingerprint !== registrationFingerprint) {
    // Consent can be withdrawn while the reads above wait: nothing registers for an owner that is
    // no longer current or no longer has Location on.
    if (!await getLocationLearningEnabled() || !isLocationCaptureSnapshotCurrent(capture)) return 0;
    await Location.startGeofencingAsync(DAYFRAME_GEOFENCE_TASK, regions);
    await writeLocationCache(GEOFENCE_REGISTRATION_KEY, registrationFingerprint, capture);
  }
  if (used) await noteSelectionPosition(capture, used.timestamp);
  const watchedNames = selection.places.map((place) => monitoredPlaceFromInput(place).name);
  await updateLocationDiagnostics({
    activeMonitorCount: placeRegions.length,
    configuredMonitorCount: monitorablePlaces.length,
    excludedMonitorCount: selection.unwatched.length,
    excludedPlaceNames: selection.unwatched.slice(0, MAX_DIAGNOSTIC_UNWATCHED_NAMES).map((place) => monitoredPlaceFromInput(place).name),
    geofenceSelection: selection.mode,
    geofencingActive: true,
    lastStatus: geofenceSelectionStatus(selection.mode, placeRegions.length, monitorablePlaces.length,
      selection.places.some((place) => place.role === "home" || place.role === "work")),
    lastMonitorRefreshAt: new Date().toISOString(),
    monitoredPlaceNames: watchedNames
  }, capture);
  return placeRegions.length;
}

function geofenceSelectionStatus(mode: "all" | "nearest" | "priority", watched: number, total: number, withRoles: boolean) {
  if (mode === "all") return `Monitoring ${watched} saved ${watched === 1 ? "place" : "places"}.`;
  if (mode === "priority") {
    return `Watching ${watched} of ${total} saved places by priority until Dayframe knows where you are; then the nearest are watched.`;
  }
  return `Watching ${watched} of ${total} saved places: ${withRoles ? "Home and Work, then the nearest to you" : "the nearest to you"}. Places farther away are watched when you get closer.`;
}

/**
 * Picks the nearest places again from a task wake: leaving the refresh circle, a reading outside it,
 * or a Visit or significant location change. Queues in the lifecycle lane for the captured owner
 * only, and never throws into the evidence path that called it.
 */
function refreshNearestGeofencesOnWake(capture: LocationCaptureSnapshot, trigger: GeofenceRepickTrigger,
  fixes: GeofencePositionFix[] = []) {
  if (!isLocationCaptureSnapshotCurrent(capture)) return Promise.resolve(0);
  return withLocationCaptureLifecycle(() => refreshNearestGeofencesInLifecycleLane(capture, trigger, fixes));
}

/**
 * The same re-pick for code already running in the lifecycle lane (the native drain in
 * runtime.ts, for every wake, bootstrap and foreground sync). Call only inside
 * withLocationCaptureLifecycle. Never throws.
 */
export async function refreshNearestGeofencesInLifecycleLane(captured: LocationCaptureSnapshot | Promise<LocationCaptureSnapshot>,
  trigger: GeofenceRepickTrigger, fixes: GeofencePositionFix[] = []) {
  const capture = await captured;
  return repickNearestGeofencesUnsafe(capture, trigger, fixes).catch(async () => {
    await updateLocationDiagnostics({
      lastStatus: "Couldn't refresh the nearest saved places. Dayframe tries again as you move.",
      lastEventAt: new Date().toISOString()
    }, capture).catch(() => undefined);
    return 0;
  });
}

async function repickNearestGeofencesUnsafe(captured: LocationCaptureSnapshot, trigger: GeofenceRepickTrigger,
  fixes: GeofencePositionFix[]) {
  if (!isLocationCaptureSnapshotCurrent(captured)) return 0;
  // Re-read inside the lane: a Places edit that ran before this queued wake keeps the revision, so
  // the catalogue captured at the wake may be out of date. Only the same binding and lifetime.
  const latest = await captureLocationOwnership();
  const capture = { ...latest, revision: captured.revision };
  if (latest.binding?.id !== captured.binding?.id || !isLocationCaptureSnapshotCurrent(capture)) return 0;
  // The owner's current catalogue (the same one evidence admission checks), not a caller's list.
  const monitorablePlaces = capture.context!.savedPlaces
    .filter((place) => typeof place.latitude === "number" && typeof place.longitude === "number");
  // With 20 or fewer places every one is already watched: nothing to pick.
  if (monitorablePlaces.length <= IOS_GEOFENCE_LIMIT) return 0;
  if (!await getLocationLearningEnabled() || !isLocationCaptureSnapshotCurrent(capture)) return 0;
  const lastKnown = trigger === "location_update" ? null : await readLastKnownGeofenceFix();
  const floor = await selectionPositionFloor(capture);
  if (!isLocationCaptureSnapshotCurrent(capture)) return 0;
  // Never a reading from before this capture lifetime, or older than the one the current selection
  // used: a wake queued behind a newer one cannot move the set back.
  const position = freshestGeofenceFix([...fixes, lastKnown].filter((fix) => fix && fix.timestamp >= floor));
  // Without a recent position the watched set stays as it is.
  if (!position) return 0;
  if (trigger !== "refresh_exit") {
    const stored = parseJson<DayframeRegion[]>(await readLocationCache(GEOFENCE_REGISTRATION_KEY, capture), []);
    const refresh = Array.isArray(stored)
      ? stored.find((region) => region?.identifier === refreshRegionIdentifier(capture.binding!.id))
      : undefined;
    if (!isLocationCaptureSnapshotCurrent(capture)) return 0;
    // An ordinary reading, a Visit or a significant change re-picks only once it is outside the refresh
    // circle: inside it the nearest places are the ones already watched (freeze guard, 24 Oct 2026).
    if (refresh && insideRefreshCircle(position, refreshCircleOf(refresh))) {
      await noteSelectionPosition(capture, position.timestamp);
      return 0;
    }
    // And at most one such re-pick every REPICK_MIN_INTERVAL_MS: iOS re-registers regions on the main
    // thread, so a burst of wakes never re-registers in a burst. Leaving the circle always re-picks.
    if (Date.now() - lastRepickAt < REPICK_MIN_INTERVAL_MS) {
      // The reading still moves the freshness floor, so an older one arriving later cannot move the set back.
      await noteSelectionPosition(capture, position.timestamp);
      return 0;
    }
  }
  lastRepickAt = Date.now();
  return registerGeofenceSelectionUnsafe(monitorablePlaces, capture, position);
}

// The time of the newest position a selection was made from (never the position itself), per
// binding: later re-picks only use readings at least as new.
async function selectionPositionFloor(capture: LocationCaptureSnapshot) {
  const stored = parseJson<{ bindingId?: string; at?: number } | null>(await readLocationCache(GEOFENCE_SELECTION_AT_KEY, capture), null);
  const boundAt = Date.parse(capture.binding!.boundAt);
  return stored?.bindingId === capture.binding!.id && typeof stored.at === "number" && Number.isFinite(stored.at)
    ? Math.max(boundAt, stored.at) : boundAt;
}

async function noteSelectionPosition(capture: LocationCaptureSnapshot, at: number) {
  if (at <= await selectionPositionFloor(capture)) return;
  await writeLocationCache(GEOFENCE_SELECTION_AT_KEY, JSON.stringify({ bindingId: capture.binding!.id, at }), capture);
}

function refreshRegionIdentifier(bindingId: string) {
  return `${bindingId}:${GEOFENCE_REFRESH_REGION_ID}`;
}

function isRefreshRegionIdentifier(identifier?: string) {
  return typeof identifier === "string" && identifier.split(":").at(-1) === GEOFENCE_REFRESH_REGION_ID;
}

function refreshCircleOf(region: DayframeRegion): GeofenceRefreshCircle {
  return { latitude: region.latitude, longitude: region.longitude, radiusMeters: region.radius };
}

async function readLastKnownGeofenceFix(): Promise<GeofencePositionFix | null> {
  const location = await Location.getLastKnownPositionAsync({
    maxAge: GEOFENCE_POSITION_MAX_AGE_MS,
    requiredAccuracy: GEOFENCE_POSITION_MAX_ACCURACY_METERS
  }).catch(() => null);
  return location ? fixFromLocation(location) : null;
}

function fixFromLocation(location: Location.LocationObject): GeofencePositionFix {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy,
    timestamp: location.timestamp
  };
}

async function startLocationLearningUnsafe(
  places: Array<{
    id: string;
    name: string;
    latitude?: number | null;
    longitude?: number | null;
    radiusMeters: number;
    loggingEnabled?: boolean;
  }> = [],
  capture: LocationCaptureSnapshot
) {
  if (!isLocationCaptureSnapshotCurrent(capture)) return false;
  const enabled = await getLocationLearningEnabled();
  if (!enabled) {
    await updateLocationDiagnostics({ locationLearningEnabled: false, locationLearningActive: false });
    return false;
  }

  if (places.length > 0) await writeSavedPlaceCatalogue(places.map(monitoredPlaceFromInput));
  if (!isLocationCaptureSnapshotCurrent(capture)) return false;
  // The accuracy trial starts the first time capture runs (card K); a burst still running keeps its options, one
  // past its 3 minutes ends here.
  // Best accuracy runs only under a live lease this process took (Codex r12 on #619): a burst is never resumed from
  // storage, whatever the clock says, so after a relaunch the stored burst simply ends here at normal capture.
  // The options first, before any storage (Codex r13 on #619); the lease a normal start ends is bound right there.
  const applied = await withNativeLocationOptions(async () => {
    // Ownership again, in the queue: a refresh queued behind a burst's start never sets options once capture is
    // turned off or changes hands; opt-out and sign-out end the snapshot synchronously (Codex r18 on #619).
    if (!isLocationCaptureSnapshotCurrent(capture)) return null;
    const held = liveAccuracyBurstLease(capture);
    try {
      await Location.startLocationUpdatesAsync(DAYFRAME_LOCATION_LEARNING_TASK, learningUpdateOptions(Boolean(held)));
    } catch (error) {
      return { error, held: null, ended: null };
    }
    nativeLocationMode = held ? "burst" : "normal";
    nativeOptionsOwner = capture.binding?.id ?? null;
    return { error: null, held, ended: held ? null : endHeldLeaseAtNormal() };
  });
  if (!applied) return false;
  if (applied.error) {
    // Inherited (or a burst's) options may still be in place: the guard retries and stops them 5 minutes on.
    if (!heldGuardLease()) takeAccuracyBurstLease(capture, UNKNOWN_BURST, 0, ACCURACY_BURST_FORCE_STOP_MS);
    throw applied.error;
  }
  await withAccuracyBurstState(async (state) => {
    const now = new Date();
    const next = state ?? startAccuracyBurstTrial(now);
    return { state: next === UNREADABLE_ACCURACY_TRIAL ? next : withTrialProgress(next, now), result: undefined };
  }).catch(() => undefined);
  if (applied.held) {
    if (!accuracyBurstTimer) scheduleAccuracyBurstGuard(applied.held, ACCURACY_BURST_RETRY_MS);
  } else {
    await settleAfterNormalCapture(applied.ended);
  }
  await updateLocationDiagnostics({
    locationLearningEnabled: true,
    locationLearningActive: true,
    lastStatus: "Location Intelligence V2 is collecting ordered evidence. Suggestions are asked in Calendar.",
    lastMonitorRefreshAt: new Date().toISOString()
  });
  return true;
}

async function refreshGeofencesForPlacesUnsafe(
  places: Array<{
    id: string;
    name: string;
    latitude?: number | null;
    longitude?: number | null;
    radiusMeters: number;
    priority?: number;
    defaultCategoryId?: string | null;
    defaultCategoryName?: string | null;
    defaultActivityDescription?: string | null;
    loggingEnabled?: boolean;
  }>,
  capture: LocationCaptureSnapshot
) {
  if (!isLocationCaptureSnapshotCurrent(capture)) return 0;
  const foreground = await Location.getForegroundPermissionsAsync();
  const background = await readBackgroundLocationPermission();
  if (!isLocationCaptureSnapshotCurrent(capture)) return 0;
  const foregroundPermission = permissionLabel(foreground.status);
  const backgroundPermission = permissionLabel(background.status);
  if (foreground.status !== "granted" || background.status !== "granted") {
    await updateLocationDiagnostics({
      foregroundPermission,
      backgroundPermission,
      activeMonitorCount: 0,
      geofencingActive: false,
      lastStatus: "Location needs Always access before saved places can be monitored.",
      lastMonitorRefreshAt: new Date().toISOString()
    });
    return 0;
  }
  await updateLocationDiagnostics({ foregroundPermission, backgroundPermission });
  if (await getLocationLearningEnabled()) {
    await startLocationLearningUnsafe(places, capture);
    await import("./location/runtime").then(({ startNativeLocationIntelligence }) =>
      startNativeLocationIntelligence()
    ).catch(error => recordV2LocationFailure(error, capture));
  }
  return startGeofencesUnsafe(places, capture);
}

export async function createUnknownStayCandidate(
  durationMinutes: number,
  location?: { latitude: number; longitude: number; accuracy?: number | null }
) {
  return enqueueEvent({
    source: "geofence_broad",
    type: "unknown_stay",
    rawPayload: {
      durationMinutes,
      latitude: location?.latitude,
      longitude: location?.longitude,
      accuracy: location?.accuracy ?? undefined
    }
  });
}

export async function recordLocationLearningSample(
  location: Location.LocationObject,
  savedPlaces: MonitoredPlace[] = [],
  captured?: LocationCaptureSnapshot
) {
  const capture = captured ?? await captureLocationOwnership();
  if (!isLocationCaptureSnapshotCurrent(capture) || !Number.isFinite(new Date(location.timestamp).getTime()) ||
    location.timestamp < Date.parse(capture.binding!.boundAt)) return {status:"stale_capture" as const, queued:false};
  if (!await getLocationLearningEnabled()) return { status: "disabled" as const, queued: false };

  const latitude = location.coords.latitude;
  const longitude = location.coords.longitude;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { status: "invalid_location" as const, queued: false };
  }

  const accuracy = typeof location.coords.accuracy === "number" ? location.coords.accuracy : null;
  if (accuracy !== null && accuracy > LOCATION_LEARNING_THRESHOLDS.maxSampleAccuracyMeters) {
    await updateLocationDiagnostics({
      lastStatus: "Ignored a low-accuracy location-learning sample.",
      lastLearningSampleAt: new Date(location.timestamp).toISOString()
    });
    return { status: "low_accuracy" as const, queued: false };
  }

  const savedPlaceMatch = nearestSavedPlaceMatch(latitude, longitude, accuracy, savedPlaces);
  if (savedPlaceMatch?.withinEffectiveRadius) {
    await updateLocationDiagnostics({
      lastStatus: `Location learning matched ${savedPlaceMatch.place.name}; noisy samples stay attached to saved places.`,
      lastLearningSampleAt: new Date(location.timestamp).toISOString()
    });
    return { status: "saved_place" as const, queued: false };
  }
  if (savedPlaceMatch?.withinSuppressionRadius) {
    await updateLocationDiagnostics({
      lastStatus: `Location learning suppressed a nearby sample so it does not become a duplicate of ${savedPlaceMatch.place.name}.`,
      lastLearningSampleAt: new Date(location.timestamp).toISOString()
    });
    return { status: "near_saved_place" as const, queued: false };
  }

  const sampledAt = new Date(location.timestamp).toISOString();
  const sampledDayKey = dateKey(sampledAt);
  const clusters = await readLearnedPlaceClusters();
  const existingIndex = clusters.findIndex((cluster) =>
    distanceMeters(latitude, longitude, cluster.latitude, cluster.longitude) <= cluster.radiusMeters
  );
  const existing = existingIndex >= 0 ? clusters[existingIndex] : null;
  const sampleCount = (existing?.sampleCount ?? 0) + 1;
  const existingDayKeys = normalizedDayKeys(existing, sampledDayKey);
  const lastSeenMs = existing ? new Date(existing.lastSeenAt).getTime() : NaN;
  const sampledMs = new Date(sampledAt).getTime();
  const startsNewVisit =
    !existing ||
    !Number.isFinite(lastSeenMs) ||
    !Number.isFinite(sampledMs) ||
    sampledMs - lastSeenMs > LEARNED_PLACE_VISIT_GAP_MS;
  const previousVisitStartedMs = existing
    ? new Date(existing.currentVisitStartedAt ?? existing.firstSeenAt).getTime()
    : NaN;
  const previousVisitDwellMs = existing && Number.isFinite(lastSeenMs) && Number.isFinite(previousVisitStartedMs)
    ? Math.max(0, lastSeenMs - previousVisitStartedMs)
    : 0;
  const completedDwellMs =
    (existing?.completedDwellMs ?? 0) + (existing && startsNewVisit ? previousVisitDwellMs : 0);
  const longestCompletedDwellMs = Math.max(
    existing?.longestCompletedDwellMs ?? 0,
    existing && startsNewVisit ? previousVisitDwellMs : 0
  );
  const visitCount = (existing?.visitCount ?? 1) + (existing && startsNewVisit ? 1 : 0);
  const currentVisitStartedAt = startsNewVisit
    ? sampledAt
    : existing?.currentVisitStartedAt ?? existing?.firstSeenAt ?? sampledAt;
  const currentVisitSampleCount = startsNewVisit
    ? 1
    : (existing?.currentVisitSampleCount ?? existing?.sampleCount ?? 0) + 1;
  const seenDayKeys = uniqueStrings([...existingDayKeys, sampledDayKey]);
  const accuracyTotalMeters = (existing?.accuracyTotalMeters ?? 0) + (accuracy ?? 0);
  const accuracySampleCount = (existing?.accuracySampleCount ?? 0) + (accuracy === null ? 0 : 1);
  const sampleSpreadMeters = existing
    ? distanceMeters(latitude, longitude, existing.latitude, existing.longitude)
    : 0;
  const maxClusterSpreadMeters = Math.max(existing?.maxClusterSpreadMeters ?? 0, sampleSpreadMeters);
  const nextCluster: LearnedPlaceCluster = existing
    ? {
        ...existing,
        latitude: ((existing.latitude * existing.sampleCount) + latitude) / sampleCount,
        longitude: ((existing.longitude * existing.sampleCount) + longitude) / sampleCount,
        lastSeenAt: sampledAt,
        currentVisitStartedAt,
        currentVisitSampleCount,
        seenDayKeys,
        visitCount,
        sampleCount,
        completedDwellMs,
        longestCompletedDwellMs,
        accuracyTotalMeters,
        accuracySampleCount,
        maxClusterSpreadMeters
      }
    : {
        id: learnedPlaceClusterId(latitude, longitude, sampledAt),
        latitude,
        longitude,
        radiusMeters: LEARNED_PLACE_RADIUS_METERS,
        visitCount: 1,
        firstSeenAt: sampledAt,
        lastSeenAt: sampledAt,
        currentVisitStartedAt: sampledAt,
        currentVisitSampleCount: 1,
        seenDayKeys: [sampledDayKey],
        sampleCount,
        completedDwellMs: 0,
        longestCompletedDwellMs: 0,
        accuracyTotalMeters,
        accuracySampleCount,
        maxClusterSpreadMeters: 0
      };

  const nextClusters =
    existingIndex >= 0
      ? clusters.map((cluster, index) => index === existingIndex ? nextCluster : cluster)
      : [nextCluster, ...clusters].slice(0, MAX_LEARNED_PLACE_CLUSTERS);
  await writeLearnedPlaceClusters(nextClusters);

  const dwellMs = Math.max(
    0,
    new Date(nextCluster.lastSeenAt).getTime() - new Date(currentVisitStartedAt).getTime()
  );
  const evidence: LocationLearningEvidence = {
    visitCount: nextCluster.visitCount ?? 1,
    distinctDays: nextCluster.seenDayKeys?.length ?? 1,
    sampleCount: nextCluster.sampleCount,
    totalDwellMs: completedDwellMs + dwellMs,
    longestDwellMs: Math.max(longestCompletedDwellMs, dwellMs),
    currentDwellMs: dwellMs,
    currentVisitSampleCount,
    averageAccuracyMeters: accuracySampleCount > 0 ? accuracyTotalMeters / accuracySampleCount : null,
    maxClusterSpreadMeters,
    radiusMeters: nextCluster.radiusMeters,
    firstSeenAt: nextCluster.firstSeenAt,
    lastSeenAt: nextCluster.lastSeenAt
  };
  const classification = classifyLocationLearningEvidence(evidence);
  const lastQueuedMs = nextCluster.lastQueuedAt ? new Date(nextCluster.lastQueuedAt).getTime() : 0;
  const queuedRecently = Number.isFinite(lastQueuedMs) && Date.now() - lastQueuedMs < LEARNED_PLACE_QUEUE_COOLDOWN_MS;
  const lastOneOffQueuedMs = nextCluster.lastOneOffQueuedAt
    ? new Date(nextCluster.lastOneOffQueuedAt).getTime()
    : 0;
  const oneOffQueuedRecently =
    Number.isFinite(lastOneOffQueuedMs) &&
    Date.now() - lastOneOffQueuedMs < LEARNED_PLACE_ONE_OFF_QUEUE_COOLDOWN_MS;
  const lastCommuteQueuedMs = nextCluster.lastCommuteQueuedAt ? new Date(nextCluster.lastCommuteQueuedAt).getTime() : 0;
  const commuteQueuedRecently =
    Number.isFinite(lastCommuteQueuedMs) && Date.now() - lastCommuteQueuedMs < LEARNED_PLACE_COMMUTE_QUEUE_COOLDOWN_MS;
  if (dwellMs >= LEARNED_PLACE_COMMUTE_DWELL_MS && !commuteQueuedRecently && await readLastCompletedVisit()) {
    const commuteName = await readableLearnedPlaceName(nextCluster.latitude, nextCluster.longitude);
    const queued = await queueCommuteCandidate({
      kind: "unknown_place",
      placeName: commuteName,
      startedAt: currentVisitStartedAt,
      stoppedAt: nextCluster.lastSeenAt,
      latitude: nextCluster.latitude,
      longitude: nextCluster.longitude,
      clusterKey: learnedPlaceClusterKey(nextCluster.latitude, nextCluster.longitude)
    }, capture).catch(() => false);
    if (queued) {
      nextCluster.lastCommuteQueuedAt = new Date().toISOString();
      await writeLearnedPlaceClusters(
        nextClusters.map((cluster) => cluster.id === nextCluster.id ? nextCluster : cluster)
      );
    }
  }

  if (
    classification.kind === "one_off_activity" &&
    nextCluster.lastOneOffVisitStartedAt !== currentVisitStartedAt &&
    !oneOffQueuedRecently
  ) {
    await queueOneOffLocationActivity({
      latitude: nextCluster.latitude,
      longitude: nextCluster.longitude,
      accuracy,
      firstSeenAt: currentVisitStartedAt,
      lastSeenAt: nextCluster.lastSeenAt,
      clusterId: nextCluster.id,
      evidence
    }, capture);
    const queuedAt = new Date().toISOString();
    await writeLearnedPlaceClusters(
      nextClusters.map((cluster) => cluster.id === nextCluster.id
        ? {
            ...nextCluster,
            lastOneOffQueuedAt: queuedAt,
            lastOneOffVisitStartedAt: currentVisitStartedAt
          }
        : cluster)
    );
    return {
      status: "one_off_activity_queued" as const,
      queued: true,
      sampleCount: nextCluster.sampleCount,
      classification
    };
  }

  if (classification.kind !== "place_candidate" || queuedRecently) {
    await updateLocationDiagnostics({
      lastStatus: classification.kind === "one_off_activity"
        ? "Location learning retained this significant stay as a one-off activity."
        : "Location learning recorded a sample; there is not enough evidence to surface it.",
      lastLearningSampleAt: sampledAt
    });
    return {
      status: "sampled" as const,
      queued: false,
      sampleCount: nextCluster.sampleCount,
      classification
    };
  }

  await queueLearnedPlaceVisit({
    latitude: nextCluster.latitude,
    longitude: nextCluster.longitude,
    accuracy,
    firstSeenAt: currentVisitStartedAt,
    lastSeenAt: nextCluster.lastSeenAt,
    clusterFirstSeenAt: nextCluster.firstSeenAt,
    clusterId: nextCluster.id,
    evidence
  }, capture);
  const queuedAt = new Date().toISOString();
  await writeLearnedPlaceClusters(
    nextClusters.map((cluster) => cluster.id === nextCluster.id ? { ...cluster, lastQueuedAt: queuedAt } : cluster)
  );

  return {
    status: "learned_place_queued" as const,
    queued: true,
    sampleCount: nextCluster.sampleCount,
    classification
  };
}

export async function recordGeofenceTransition(
  transition: GeofenceTransition,
  region: DayframeRegion,
  occurredAt = new Date(),
  captured?: LocationCaptureSnapshot
) {
  const capture = captured ?? await captureLocationOwnership();
  if (!isLocationCaptureSnapshotCurrent(capture) || occurredAt.getTime() < Date.parse(capture.binding!.boundAt)) return {status:"stale_capture" as const,queued:false};
  const placeId = typeof region.identifier === "string" ? region.identifier : "";
  const places = await readMonitoredPlaces();
  const place = places[placeId];

  if (!place || !UUID_RE.test(placeId)) {
    await updateLocationDiagnostics({
      lastStatus: "Ignored a location event for an unknown saved place.",
      lastEventAt: occurredAt.toISOString()
    });
    return { status: "unknown_place" as const, queued: false };
  }

  const evidence = await getGeofenceTransitionEvidence(transition, place, occurredAt);
  await appendGeofenceTransitionEvidence(evidence);
  if (evidence.outcome === "rejected_far_from_region") {
    await updateLocationDiagnostics({
      lastStatus: `Ignored an enter for ${place.name} because a recent location fix was clearly outside the saved radius.`,
      lastPlaceName: place.name,
      lastEventAt: occurredAt.toISOString(),
      lastGeofenceEvent: {
        transition,
        placeName: place.name,
        occurredAt: occurredAt.toISOString()
      }
    });
    return { status: "evidence_rejected_enter" as const, queued: false, evidence };
  }

  if (transition === "enter") {
    return recordPlaceEnter(place, region, occurredAt, capture);
  }

  return recordPlaceExit(place, region, occurredAt, capture);
}

export async function getLocationVisitDiagnostics(): Promise<LocationVisitDiagnostics> {
  const owner = await readActiveMobileAccount();
  const captured = captureLocationOwnership();
  const [stored, foreground, background, geofencingActive, learningEnabled, learningActive] = await Promise.all([
    readLocationDiagnostics(),
    Location.getForegroundPermissionsAsync().catch(() => null),
    readBackgroundLocationPermission().catch(() => null),
    Location.hasStartedGeofencingAsync(DAYFRAME_GEOFENCE_TASK).catch(() => false),
    getLocationLearningEnabled().catch(() => false),
    Location.hasStartedLocationUpdatesAsync(DAYFRAME_LOCATION_LEARNING_TASK).catch(() => false)
  ]);
  const foregroundPermission = permissionLabel(foreground?.status);
  const backgroundPermission = permissionLabel(background?.status);
  const capture = await captured;
  const consent = learningEnabled && owner && await readLocationCaptureConsent(owner);
  const consentCurrent = Boolean(consent && mobileAccountOwnersEqual(getActiveMobileAccountSnapshot(), owner));
  const cleanupPending = Boolean(owner && isLocationLogoutCurrent(owner));
  const captureActive = consentCurrent && !cleanupPending && isLocationCaptureSnapshotCurrent(capture) && learningActive &&
    foregroundPermission === "granted" && backgroundPermission === "granted";

  return {
    foregroundPermission: foregroundPermission === "unknown" ? stored.foregroundPermission : foregroundPermission,
    backgroundPermission: backgroundPermission === "unknown" ? stored.backgroundPermission : backgroundPermission,
    activeMonitorCount: geofencingActive ? stored.activeMonitorCount : 0,
    configuredMonitorCount: stored.configuredMonitorCount,
    excludedMonitorCount: stored.excludedMonitorCount,
    geofencingActive,
    monitoredPlaceNames: stored.monitoredPlaceNames,
    excludedPlaceNames: stored.excludedPlaceNames,
    geofenceSelection: stored.geofenceSelection,
    lastStatus: stored.lastStatus,
    lastPlaceName: stored.lastPlaceName,
    lastEventAt: stored.lastEventAt,
    lastGeofenceEvent: stored.lastGeofenceEvent,
    lastTransitionEvidence: stored.lastTransitionEvidence,
    transitionEvidenceHistory: stored.transitionEvidenceHistory,
    lastQueuedVisitCandidate: stored.lastQueuedVisitCandidate,
    locationLearningEnabled: consentCurrent,
    locationLearningActive: captureActive,
    locationLearningCaptureState: cleanupPending ? "logout_cleanup" : !consentCurrent ? "off" : captureActive ? "active" : "inactive",
    lastLearningSampleAt: stored.lastLearningSampleAt,
    lastLearnedPlaceCandidate: stored.lastLearnedPlaceCandidate,
    lastCommuteCandidate: stored.lastCommuteCandidate,
    lastMonitorRefreshAt: stored.lastMonitorRefreshAt,
    lastVisitQueuedAt: stored.lastVisitQueuedAt
  };
}

async function recordPlaceEnter(place: MonitoredPlace, region: DayframeRegion, occurredAt: Date, capture: LocationCaptureSnapshot) {
  const openVisits = await readOpenVisits();
  if (openVisits[place.id]) {
    await updateLocationDiagnostics({
      lastStatus: `Already tracking a visit to ${place.name}.`,
      lastPlaceName: place.name,
      lastEventAt: occurredAt.toISOString(),
      lastGeofenceEvent: {
        transition: "enter",
        placeName: place.name,
        occurredAt: occurredAt.toISOString()
      }
    });
    return { status: "duplicate_enter" as const, queued: false };
  }

  const source = geofenceSource(region.radius || place.radiusMeters);
  openVisits[place.id] = {
    placeId: place.id,
    placeName: place.name,
    enteredAt: occurredAt.toISOString(),
    radiusMeters: region.radius || place.radiusMeters,
    source,
    defaultCategoryId: place.defaultCategoryId,
    defaultCategoryName: place.defaultCategoryName,
    defaultActivityDescription: place.defaultActivityDescription,
    loggingEnabled: place.loggingEnabled !== false
  };
  await writeOpenVisits(openVisits);
  if (place.loggingEnabled === false) {
    await updateLocationDiagnostics({
      lastStatus: `Entered ${place.name}. Visit logging is off for this place.`,
      lastPlaceName: place.name,
      lastEventAt: occurredAt.toISOString(),
      lastGeofenceEvent: {
        transition: "enter",
        placeName: place.name,
        occurredAt: occurredAt.toISOString()
      }
    });
    return { status: "logging_disabled_enter" as const, queued: false };
  }

  if (!isLocationCaptureSnapshotCurrent(capture)) return {status:"stale_capture" as const,queued:false};
  await enqueueEvent({
    owner: capture.context!,
    localId: geofenceEvidenceLocalId("enter", place.id, occurredAt),
    source,
    type: "geofence_enter",
    occurredAt,
    placeId: place.id,
    categoryId: place.defaultCategoryId ?? undefined,
    description: `Entered ${place.name}`,
    rawPayload: {
      provider: "expo_location",
      evidenceKind: "known_place_enter",
      placeId: place.id,
      placeName: place.name,
      region: place.id,
      radius: region.radius || place.radiusMeters,
      transition: "enter",
      isBroad: source === "geofence_broad",
      loggingEnabled: true
    }
  });
  await updateLocationDiagnostics({
    lastStatus: `Entered ${place.name}. Waiting for exit before suggesting a visit.`,
    lastPlaceName: place.name,
    lastEventAt: occurredAt.toISOString(),
    lastGeofenceEvent: {
      transition: "enter",
      placeName: place.name,
      occurredAt: occurredAt.toISOString()
    }
  });

  return { status: "entered" as const, queued: true };
}

async function recordPlaceExit(place: MonitoredPlace, region: DayframeRegion, occurredAt: Date, capture: LocationCaptureSnapshot) {
  const openVisits = await readOpenVisits();
  const openVisit = openVisits[place.id];
  if (!openVisit) {
    await updateLocationDiagnostics({
      lastStatus: `Left ${place.name}, but no matching block was recorded.`,
      lastPlaceName: place.name,
      lastEventAt: occurredAt.toISOString(),
      lastGeofenceEvent: {
        transition: "exit",
        placeName: place.name,
        occurredAt: occurredAt.toISOString()
      }
    });
    return { status: "missing_enter" as const, queued: false };
  }

  delete openVisits[place.id];
  await writeOpenVisits(openVisits);

  const startedAt = new Date(openVisit.enteredAt);
  const stoppedAt = occurredAt;
  const durationMs = stoppedAt.getTime() - startedAt.getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    await updateLocationDiagnostics({
      lastStatus: `Ignored ${place.name} visit because the timestamps were invalid.`,
      lastPlaceName: place.name,
      lastEventAt: stoppedAt.toISOString(),
      lastGeofenceEvent: {
        transition: "exit",
        placeName: place.name,
        occurredAt: stoppedAt.toISOString()
      }
    });
    return { status: "invalid_duration" as const, queued: false };
  }

  const durationSeconds = Math.round(durationMs / 1000);
  if (durationMs < LOCATION_VISIT_DWELL_THRESHOLD_MS) {
    await updateLocationDiagnostics({
      lastStatus: `Ignored short ${place.name} visit under ${LOCATION_VISIT_DWELL_THRESHOLD_MINUTES} minutes.`,
      lastPlaceName: place.name,
      lastEventAt: stoppedAt.toISOString(),
      lastGeofenceEvent: {
        transition: "exit",
        placeName: place.name,
        occurredAt: stoppedAt.toISOString()
      }
    });
    return { status: "below_dwell_threshold" as const, queued: false, durationSeconds };
  }

  const localId = visitLocalId(openVisit);
  const seenVisitIds = await readSeenVisitIds();
  if (seenVisitIds.includes(localId)) {
    await updateLocationDiagnostics({
      lastStatus: `Already queued the ${place.name} visit.`,
      lastPlaceName: place.name,
      lastEventAt: stoppedAt.toISOString(),
      lastGeofenceEvent: {
        transition: "exit",
        placeName: place.name,
        occurredAt: stoppedAt.toISOString()
      }
    });
    return { status: "duplicate_visit" as const, queued: false, durationSeconds };
  }

  const source = openVisit.source ?? geofenceSource(region.radius || place.radiusMeters);
  const defaultActivityDescription = normalizedActivityDescription(
    place.defaultActivityDescription ?? openVisit.defaultActivityDescription
  );
  const currentVisit = {
    kind: "saved_place" as const,
    placeId: place.id,
    placeName: place.name,
    startedAt: startedAt.toISOString(),
    stoppedAt: stoppedAt.toISOString(),
    latitude: place.latitude,
    longitude: place.longitude
  };

  if (place.loggingEnabled === false || openVisit.loggingEnabled === false) {
    if (await getLocationLearningEnabled()) {
      await queueCommuteCandidate(currentVisit, capture).catch(() => undefined);
    }
    await writeLastCompletedVisit(currentVisit);
    await writeSeenVisitIds([localId, ...seenVisitIds.filter((id) => id !== localId)].slice(0, MAX_SEEN_VISIT_IDS));
    await updateLocationDiagnostics({
      lastStatus: `Skipped ${place.name} visit review because visit logging is off for this place.`,
      lastPlaceName: place.name,
      lastEventAt: stoppedAt.toISOString(),
      lastGeofenceEvent: {
        transition: "exit",
        placeName: place.name,
        occurredAt: stoppedAt.toISOString()
      }
    });
    return { status: "logging_disabled_visit" as const, queued: false, durationSeconds, localId };
  }

  if (!isLocationCaptureSnapshotCurrent(capture)) return {status:"stale_capture" as const,queued:false};
  await enqueueEvent({
    owner: capture.context!,
    localId,
    source,
    type: "geofence_exit",
    occurredAt: stoppedAt,
    placeId: place.id,
    categoryId: place.defaultCategoryId ?? openVisit.defaultCategoryId ?? undefined,
    description: defaultActivityDescription ?? place.name,
    rawPayload: {
      provider: "expo_location",
      evidenceKind: "known_place_visit",
      placeId: place.id,
      placeName: place.name,
      startedAt: startedAt.toISOString(),
      stoppedAt: stoppedAt.toISOString(),
      enteredAt: startedAt.toISOString(),
      exitedAt: stoppedAt.toISOString(),
      durationSeconds,
      durationMinutes: Math.round(durationSeconds / 60),
      dwellThresholdMinutes: LOCATION_VISIT_DWELL_THRESHOLD_MINUTES,
      confidence: source === "geofence_broad" ? "low" : "medium_high",
      source: "ios_geofence",
      region: place.id,
      radius: region.radius || openVisit.radiusMeters || place.radiusMeters,
      transition: "visit",
      isBroad: source === "geofence_broad",
      defaultCategoryId: place.defaultCategoryId ?? openVisit.defaultCategoryId ?? null,
      defaultCategoryName: place.defaultCategoryName ?? openVisit.defaultCategoryName ?? null,
      defaultActivityDescription,
      loggingEnabled: true
    }
  });
  if (await getLocationLearningEnabled()) {
    await queueCommuteCandidate(currentVisit, capture).catch(() => undefined);
  }
  await writeLastCompletedVisit(currentVisit);
  await writeSeenVisitIds([localId, ...seenVisitIds.filter((id) => id !== localId)].slice(0, MAX_SEEN_VISIT_IDS));
  await updateLocationDiagnostics({
    lastStatus: `Queued ${place.name} visit for review. Saved-place visits are review-first before becoming blocks.`,
    lastPlaceName: place.name,
    lastEventAt: stoppedAt.toISOString(),
    lastGeofenceEvent: {
      transition: "exit",
      placeName: place.name,
      occurredAt: stoppedAt.toISOString()
    },
    lastQueuedVisitCandidate: {
      placeName: place.name,
      startedAt: startedAt.toISOString(),
      stoppedAt: stoppedAt.toISOString(),
      queuedAt: stoppedAt.toISOString(),
      durationSeconds
    },
    lastVisitQueuedAt: stoppedAt.toISOString()
  });

  return { status: "visit_queued" as const, queued: true, durationSeconds, localId };
}

function monitoredPlaceFromInput(place: {
  id: string;
  name: string;
  role?: PlaceRole | null;
  latitude?: number | null;
  longitude?: number | null;
  radiusMeters: number;
  priority?: number;
  defaultCategoryId?: string | null;
  defaultCategoryName?: string | null;
  defaultActivityDescription?: string | null;
  loggingEnabled?: boolean;
}): MonitoredPlace {
  return {
    id: place.id,
    // A Home or Work place is described as "Home"/"Work" in the visits the phone records.
    name: placeDisplayName({ name: place.name, role: place.role ?? null }),
    latitude: typeof place.latitude === "number" ? place.latitude : 0,
    longitude: typeof place.longitude === "number" ? place.longitude : 0,
    radiusMeters: place.radiusMeters,
    priority: place.priority ?? 0,
    defaultCategoryId: place.defaultCategoryId,
    defaultCategoryName: place.defaultCategoryName,
    defaultActivityDescription: normalizedActivityDescription(place.defaultActivityDescription),
    loggingEnabled: place.loggingEnabled !== false
  };
}

export function evaluateGeofenceTransitionEvidence(input: {
  transition: GeofenceTransition;
  placeName: string;
  occurredAt: Date;
  configuredRadiusMeters: number;
  distanceMeters?: number | null;
  accuracyMeters?: number | null;
  sampleAgeMs?: number | null;
}): GeofenceTransitionEvidence {
  const base = {
    transition: input.transition,
    placeName: input.placeName,
    occurredAt: input.occurredAt.toISOString(),
    configuredRadiusMeters: normalizedGeofenceRadius(input.configuredRadiusMeters)
  };
  const distance = input.distanceMeters;
  const accuracy = input.accuracyMeters;
  const sampleAgeMs = input.sampleAgeMs;
  if (
    distance === null || distance === undefined || !Number.isFinite(distance) ||
    accuracy === null || accuracy === undefined || !Number.isFinite(accuracy) ||
    sampleAgeMs === null || sampleAgeMs === undefined || !Number.isFinite(sampleAgeMs) ||
    sampleAgeMs > GEOFENCE_ENTER_REJECTION_MAX_AGE_MS ||
    accuracy > GEOFENCE_EVIDENCE_REQUIRED_ACCURACY_METERS
  ) {
    return { ...base, outcome: "no_recent_location" };
  }
  const evidence = {
    ...base,
    accuracyMeters: Math.round(Math.max(0, accuracy)),
    distanceMeters: Math.round(Math.max(0, distance)),
    sampleAgeSeconds: Math.round(Math.max(0, sampleAgeMs) / 1000)
  };
  const clearlyOutside =
    distance - Math.max(0, accuracy) >
    base.configuredRadiusMeters + GEOFENCE_ENTER_OUTSIDE_BUFFER_METERS;
  if (input.transition === "enter" && clearlyOutside) {
    return { ...evidence, outcome: "rejected_far_from_region" };
  }
  return { ...evidence, outcome: "accepted" };
}

async function getGeofenceTransitionEvidence(
  transition: GeofenceTransition,
  place: MonitoredPlace,
  occurredAt: Date
) {
  const location = await Location.getLastKnownPositionAsync({
    maxAge: GEOFENCE_EVIDENCE_MAX_AGE_MS,
    requiredAccuracy: GEOFENCE_EVIDENCE_REQUIRED_ACCURACY_METERS
  }).catch(() => null);
  if (!location) {
    return evaluateGeofenceTransitionEvidence({
      transition,
      placeName: place.name,
      occurredAt,
      configuredRadiusMeters: place.radiusMeters
    });
  }
  return evaluateGeofenceTransitionEvidence({
    transition,
    placeName: place.name,
    occurredAt,
    configuredRadiusMeters: place.radiusMeters,
    distanceMeters: distanceMeters(
      location.coords.latitude,
      location.coords.longitude,
      place.latitude,
      place.longitude
    ),
    accuracyMeters: location.coords.accuracy,
    sampleAgeMs: Math.abs(occurredAt.getTime() - location.timestamp)
  });
}

async function appendGeofenceTransitionEvidence(evidence: GeofenceTransitionEvidence) {
  const diagnostics = await readLocationDiagnostics();
  const history = [
    evidence,
    ...(diagnostics.transitionEvidenceHistory ?? [])
  ].slice(0, MAX_TRANSITION_EVIDENCE_ITEMS);
  await updateLocationDiagnostics({
    lastTransitionEvidence: evidence,
    transitionEvidenceHistory: history
  });
}

export async function stopGeofencesIfStarted() {
  const started = await Location.hasStartedGeofencingAsync(DAYFRAME_GEOFENCE_TASK).catch(() => false);
  if (started) await Location.stopGeofencingAsync(DAYFRAME_GEOFENCE_TASK);
}

export async function stopLocationLearningIfStarted() {
  // An unknown native state is not a stopped one: stop anyway, and end a burst only once updates have really
  // stopped, so sign-out or location off never leaves best accuracy running untracked (Codex r2 on #619).
  const lease = await withNativeLocationOptions(async () => {
    const started = await Location.hasStartedLocationUpdatesAsync(DAYFRAME_LOCATION_LEARNING_TASK).catch(() => null);
    if (started !== false) {
      await Location.stopLocationUpdatesAsync(DAYFRAME_LOCATION_LEARNING_TASK).catch(async (error) => {
        // A stop that failed while the state was unknown is fine only if updates turn out not to run; otherwise the
        // failure is the caller's, so teardown never reports success with updates maybe running (Codex r3 on #619).
        if (started === null && await Location.hasStartedLocationUpdatesAsync(DAYFRAME_LOCATION_LEARNING_TASK).catch(() => null) === false) return;
        // Options this process never set (a relaunch may have inherited a burst's) are the guard's to keep stopping,
        // with no capture of its own, until a stop succeeds or a capture sets them (Codex r15 on #619).
        guardInheritedAccuracyOptions(STOPPED_CAPTURE);
        throw error;
      });
    }
    clearAccuracyBurstTimer();
    nativeLocationMode = "stopped";
    nativeOptionsOwner = null;
    noteNativeBurstEnd();
    const held = accuracyBurstLease;
    accuracyBurstLease = null;
    return held;
  });
  // Capture stopped (sign-out, an account change, location off), so best accuracy did too: its end is confirmed
  // now, kept until storage takes it, and the burst counted for what it ran (Codex r8 on #619).
  if (lease && lease.startedAt !== UNKNOWN_BURST) {
    confirmLeaseDone(lease);
    pendingAccuracyBurstSettlements.set(lease.startedAt, lease);
  }
  await withAccuracyBurstState(async (state) => ({ state: state?.active ? settleAccuracyBurst(state, lease) : state, result: undefined }))
    .catch(() => undefined);
  // Confirms, once storage holds it (and retries until it does), then forgets what it kept.
  settlePendingAccuracyBursts();
}

const ACCURACY_BURST_STATE_KEY = "dayframe.location.burstTrial.v1";
/** A stored trial that can't be read as one: treated as finished (no bursts), and never overwritten by a new one. */
const UNREADABLE_ACCURACY_TRIAL: AccuracyBurstState = { startedDay: "0001-01-01", furthestTrialDay: Number.MAX_SAFE_INTEGER, days: {} };
/** While a burst runs past its 3 minutes, normal capture is tried again this often, readings or not. */
const ACCURACY_BURST_RETRY_MS = 30_000;
let accuracyBurstChain: Promise<unknown> = Promise.resolve();
let accuracyBurstTimer: ReturnType<typeof setTimeout> | null = null;

function clearAccuracyBurstTimer() {
  if (accuracyBurstTimer) clearTimeout(accuracyBurstTimer);
  accuracyBurstTimer = null;
}

/**
 * The trial's state on this iPhone, read and written one change at a time (both location tasks change it). A
 * storage read that fails aborts the change rather than starting the trial again (Codex r1 on #619).
 */
function withAccuracyBurstState<T>(
  change: (state: AccuracyBurstState | null) => Promise<{ state: AccuracyBurstState | null; result: T }>
): Promise<T> {
  const run = accuracyBurstChain.then(async () => {
    const stored = await AsyncStorage.getItem(ACCURACY_BURST_STATE_KEY);
    let state: AccuracyBurstState | null = null;
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as AccuracyBurstState;
        state = parsed && typeof parsed.startedDay === "string" && parsed.days && typeof parsed.days === "object" ? parsed : UNREADABLE_ACCURACY_TRIAL;
      } catch {
        state = UNREADABLE_ACCURACY_TRIAL;
      }
    }
    const { state: next, result } = await change(state);
    if (next && next !== state && next !== UNREADABLE_ACCURACY_TRIAL) await AsyncStorage.setItem(ACCURACY_BURST_STATE_KEY, JSON.stringify(next));
    return result;
  });
  accuracyBurstChain = run.catch(() => undefined);
  return run;
}

/**
 * The accuracy trial's state, for Sync help and shared diagnostics. The trial day it shows is kept, so a clock
 * set back after seeing an off day never turns bursts on again (Codex r2 on #619).
 */
export function readAccuracyBurstState() {
  return withAccuracyBurstState(async (state) => {
    if (!state || state === UNREADABLE_ACCURACY_TRIAL) return { state, result: null };
    const progressed = withTrialProgress(state, new Date());
    return { state: progressed, result: progressed };
  });
}

/**
 * The location task's options: normal capture, or a burst at best accuracy for a departure's or arrival's
 * 3 minutes (card K): every reading, no deferral, no automatic pause.
 */
function learningUpdateOptions(burst: boolean): Location.LocationTaskOptions {
  return burst ? {
    accuracy: Location.Accuracy.Highest,
    distanceInterval: 0,
    pausesUpdatesAutomatically: false,
    activityType: 1 as Location.LocationActivityType,
    showsBackgroundLocationIndicator: false
  } : {
    accuracy: Location.Accuracy.High ?? Location.Accuracy.Balanced,
    distanceInterval: LOCATION_ENGINE_V2_CONFIG.distanceIntervalMeters,
    deferredUpdatesDistance: LOCATION_ENGINE_V2_CONFIG.deferredUpdatesDistanceMeters,
    deferredUpdatesInterval: LOCATION_ENGINE_V2_CONFIG.deferredUpdatesIntervalMs,
    deferredUpdatesTimeout: LOCATION_ENGINE_V2_CONFIG.deferredTimeoutMs,
    pausesUpdatesAutomatically: LOCATION_ENGINE_V2_CONFIG.pausesUpdatesAutomatically,
    activityType: 1 as Location.LocationActivityType,
    showsBackgroundLocationIndicator: false
  };
}

/**
 * A saved place's exit (a departure) or entry (an arrival), or an iOS Visit's departure or arrival at any place,
 * starts a burst when the trial allows one; a Visit never takes the day's last one. A burst past its 3 minutes is
 * settled first, so a late end never lets the next start early.
 */
export async function maybeStartAccuracyBurst(
  kind: AccuracyBurstKind, capture: LocationCaptureSnapshot, source: "saved_place" | "visit" = "saved_place"
) {
  const trigger = accuracyBurstTrigger(kind, source);
  const captureId = capture.binding?.id;
  if (!captureId || !isLocationCaptureSnapshotCurrent(capture) || !await learningEnabledOrGuard()) return false;
  const running = await Location.hasStartedLocationUpdatesAsync(DAYFRAME_LOCATION_LEARNING_TASK).catch(() => null);
  // An unknown native status may still hide inherited options: they're put back (or guarded) before giving up
  // (Codex r16 on #619).
  if (running === null) await maybeEndAccuracyBurst(capture).catch(() => protectInheritedAccuracyOptions());
  if (!running) return false;
  await maybeEndAccuracyBurst(capture);
  // Ownership is checked inside the change, so a stale lifetime's callback never starts one (Codex r1 on #619).
  const reserved = await withAccuracyBurstState(async (state) => {
    const now = new Date();
    if (!state || !isLocationCaptureSnapshotCurrent(capture) || !accuracyBurstDecision(state, now, trigger).start) return { state, result: null };
    const next = startAccuracyBurst(state, kind, now, trigger, captureId);
    reservingAccuracyBursts.add(next.active!.startedAt);
    return { state: next, result: next };
  });
  if (!reserved) return false;
  const started = reserved.active!;
  const stopBy = Date.parse(started.stopBy ?? started.endsAt);
  const ok = await withNativeLocationOptions(async () => {
    // A recording that took long enough to reach an off day never starts best accuracy (Codex r17 on #619).
    if (!isLocationCaptureSnapshotCurrent(capture) || accuracyBurstArm(reserved, new Date()) !== "on") return false;
    const done = await Location.startLocationUpdatesAsync(DAYFRAME_LOCATION_LEARNING_TASK, learningUpdateOptions(true)).then(() => true, () => false);
    if (!done) return false;
    nativeLocationMode = "burst";
    nativeOptionsOwner = captureId;
    // A new burst starts only with none recorded, so no earlier note can govern anything any more.
    earliestNativeBurstEndAt = null;
    earliestNativeBurstEndMono = null;
    // The lease is taken with the options, in the same step, so nothing between them can end it (Codex r13 on #619).
    const reservedAt = Date.parse(started.startedAt);
    takeAccuracyBurstLease(capture, started.startedAt, Date.parse(started.endsAt) - reservedAt, stopBy - reservedAt);
    reservingAccuracyBursts.delete(started.startedAt);
    return true;
  }).finally(() => reservingAccuracyBursts.delete(started.startedAt));
  if (ok) {
    // When best accuracy really started, kept with the burst so a relaunch counts its runtime from there; if this
    // write fails, the recording's moment counts instead (more, never less) (Codex r16 on #619).
    const nativeStartedAt = accuracyBurstLease?.startedAt === started.startedAt ? new Date(accuracyBurstLease.nativeStartAt).toISOString() : null;
    if (nativeStartedAt) {
      await withAccuracyBurstState(async (state) => ({
        state: state?.active?.startedAt === started.startedAt && !state.active.nativeStartedAt
          ? { ...state, active: { ...state.active, nativeStartedAt } } : state,
        result: undefined
      })).catch(() => undefined);
    }
  }
  if (!ok) {
    // Best accuracy never started: this burst (and only this one) ends at once, having run for no time (Codex r16 on #619).
    await withAccuracyBurstState(async (state) => ({
      state: state?.active?.startedAt === started.startedAt && state.active.captureId === captureId ? endAccuracyBurst(state, new Date(), 0) : state,
      result: undefined
    }));
    return false;
  }
  return true;
}

/** The running burst, in memory: what the safety timer needs to end it natively, even with storage unavailable. */
type AccuracyBurstLease = {
  capture: LocationCaptureSnapshot; startedAt: string;
  /** Monotonic: when it was taken, and how long from then to the burst's end and its hard stop (Codex r5 on #619). */
  takenAt: number; endsInMs: number; stopInMs: number;
  /** Wall clock when best accuracy started (the lease is taken with it): the day its runtime counts on. */
  nativeStartAt: number;
  /** How long it had run when the lease was taken (from the wall clock, once). */
  priorMs: number;
  /** When normal capture (or none) was confirmed back: wall clock, and monotonic for its elapsed time. */
  nativeDoneAt: number | null;
  nativeDoneMono: number | null;
};

/** How long the lease's burst ran at best accuracy, on elapsed time (Codex r7 on #619). */
const leaseElapsedMs = (lease: AccuracyBurstLease) => lease.priorMs + ((lease.nativeDoneMono ?? monotonicNow()) - lease.takenAt);

/** The lease's native end, confirmed now unless already confirmed earlier (the earliest wins). */
function confirmLeaseDone(lease: AccuracyBurstLease) {
  if (lease.nativeDoneAt == null) {
    lease.nativeDoneAt = Date.now();
    lease.nativeDoneMono = monotonicNow();
  }
}

/**
 * Leases whose native end is confirmed but whose time storage hasn't taken yet (a teardown, say), by burst: any
 * later settlement of that burst uses them, never the later moment storage came back (Codex r8 on #619).
 */
const pendingAccuracyBurstSettlements = new Map<string, AccuracyBurstLease>();
let accuracyBurstSettlementTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * The earliest moment, not yet settled, that this process confirmed best accuracy over without a lease to hold it
 * (location updates stopped, or normal options restored by a capture refresh, a headless one too): a burst that had
 * started before it ended then at the latest. A later moment never replaces it (Codex r9–r10 on #619).
 */
let earliestNativeBurstEndAt: number | null = null;
/** When (monotonic) that moment was noted: a burst this process leased after it is never governed by it. */
let earliestNativeBurstEndMono: number | null = null;

function noteNativeBurstEnd(at = Date.now()) {
  // The first note stands until it's settled and cleared: a later one, even one a clock set back dates earlier,
  // never replaces it (Codex r11 on #619).
  if (earliestNativeBurstEndAt == null) {
    earliestNativeBurstEndAt = at;
    earliestNativeBurstEndMono = monotonicNow();
  }
}

/**
 * Whether that noted end governs a stored burst: one this process leased after the note never is (its own elapsed
 * time decides), and otherwise one that started before the note (Codex r11 on #619).
 */
function nativeEndCovers(active: { startedAt: string }, lease: AccuracyBurstLease | null) {
  if (earliestNativeBurstEndAt == null || earliestNativeBurstEndMono == null) return false;
  const known = lease?.startedAt === active.startedAt ? lease
    : accuracyBurstLease?.startedAt === active.startedAt ? accuracyBurstLease : pendingAccuracyBurstSettlements.get(active.startedAt) ?? null;
  if (known && known.takenAt >= earliestNativeBurstEndMono) return false;
  return Date.parse(active.startedAt) <= earliestNativeBurstEndAt;
}

/** Settles a burst's time from its lease when one is known: the confirmed moment and elapsed time, never a later one. */
function settleAccuracyBurst(state: AccuracyBurstState, lease: AccuracyBurstLease | null) {
  if (!state.active) return state;
  const startedAt = state.active.startedAt;
  if (reservingAccuracyBursts.has(startedAt)) return state;
  // Only the burst the caller's operation ended, or one this process holds no live lease for, settles here.
  if (lease?.startedAt !== startedAt && accuracyBurstLease?.startedAt === startedAt && accuracyBurstLease.nativeDoneAt == null) return state;
  const known = lease?.startedAt === startedAt ? lease
    : accuracyBurstLease?.startedAt === startedAt ? accuracyBurstLease : pendingAccuracyBurstSettlements.get(startedAt) ?? null;
  // An earlier confirmed end without a lease (a headless stop or restore) wins over a lease rebuilt since, never
  // over one this process took after it.
  const earlier = nativeEndCovers(state.active, lease) ? earliestNativeBurstEndAt : null;
  // Kept until a retry sees the burst no longer stored: a write that fails never loses it (Codex r9 on #619).
  if (known) {
    confirmLeaseDone(known);
    // Which came first is read on elapsed time, never on wall clocks a change could reorder (Codex r21 on #619).
    if (earlier == null || earliestNativeBurstEndMono == null || earliestNativeBurstEndMono >= known.nativeDoneMono!) {
      return endAccuracyBurst(state, new Date(known.nativeDoneAt!), leaseElapsedMs(known), known.nativeStartAt);
    }
  }
  // No lease: nothing measured its elapsed time, and a clock moved since can't be seen, so it counts at least to its
  // hard stop (Codex r21 on #619).
  if (earlier != null) return endAccuracyBurst(state, new Date(earlier), undefined, undefined, true);
  return endAccuracyBurst(state, new Date(), undefined, undefined, true);
}

/** Tests only: this process's burst memory (leases, pending settlements, timers) back to a fresh launch. */
export function __resetAccuracyBurstForTests() {
  clearAccuracyBurstTimer();
  if (accuracyBurstSettlementTimer) clearTimeout(accuracyBurstSettlementTimer);
  accuracyBurstSettlementTimer = null;
  accuracyBurstLease = null;
  nativeLocationMode = "unknown";
  nativeOptionsOwner = null;
  reservingAccuracyBursts.clear();
  pendingAccuracyBurstSettlements.clear();
  earliestNativeBurstEndAt = null;
  earliestNativeBurstEndMono = null;
  accuracyBurstChain = Promise.resolve();
}

/** Retries a confirmed burst's settlement until storage takes it (storage only: native capture is already done). */
function settlePendingAccuracyBursts() {
  if (accuracyBurstSettlementTimer || (!pendingAccuracyBurstSettlements.size && earliestNativeBurstEndAt == null)) return;
  accuracyBurstSettlementTimer = setTimeout(() => {
    accuracyBurstSettlementTimer = null;
    void withAccuracyBurstState(async (state) => {
      const active = state?.active;
      const settle = active && (pendingAccuracyBurstSettlements.has(active.startedAt) ||
        (accuracyBurstLease?.startedAt !== active.startedAt && nativeEndCovers(active, null)));
      return { state: settle ? settleAccuracyBurst(state!, null) : state, result: undefined };
    }).then(() => readAccuracyBurstState()).then((state) => {
      // Once storage holds the result, a burst no longer recorded needs nothing more.
      for (const startedAt of [...pendingAccuracyBurstSettlements.keys()]) {
        if (state?.active?.startedAt !== startedAt) pendingAccuracyBurstSettlements.delete(startedAt);
      }
      if (!state?.active || !nativeEndCovers(state.active, null)) {
        earliestNativeBurstEndAt = null;
        earliestNativeBurstEndMono = null;
      }
    }).catch(() => undefined).finally(settlePendingAccuracyBursts);
  }, ACCURACY_BURST_RETRY_MS);
}
let accuracyBurstLease: AccuracyBurstLease | null = null;
/** What this process last set the location task to; unknown until it does (a relaunch may inherit a burst's options). */
/** "stopped": this process stopped updates (a guard, a teardown); an admitted wake starts normal capture again. */
let nativeLocationMode: "unknown" | "normal" | "burst" | "stopped" = "unknown";
/**
 * Every change to the location task's options (a burst's start, a restore, a refresh, a forced stop, a teardown)
 * runs here one at a time, with the lease change that goes with it, so a completion is always the one operation's
 * own (Codex r13 on #619). Never entered from inside itself.
 */
const withNativeLocationOptions = createSerialMutationQueue();
/** The capture lifetime whose call last set the options (null once stopped): a stale guard stops only its own. */
let nativeOptionsOwner: string | null = null;
/**
 * Bursts this process has recorded but not yet started (or failed to start) natively: nothing else settles them,
 * so a normal start that ran in between never ends a burst it didn't end (Codex r14 on #619).
 */
const reservingAccuracyBursts = new Set<string>();

/** Elapsed time that a clock set back or forward never changes. */
const monotonicNow = () => typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();

/**
 * The lease for a burst this process has just started natively (or the guard's for inherited options), with its
 * 3 minutes and hard stop counted from now: time spent recording the burst before best accuracy really started is
 * neither runtime nor taken from the burst (Codex r15 on #619).
 */
function takeAccuracyBurstLease(capture: LocationCaptureSnapshot, startedAt: string, endsInMs: number, stopInMs: number, firstTickMs?: number) {
  // The same lifetime's same burst keeps its lease: its monotonic deadlines are never recomputed from a wall clock
  // that may have moved since (Codex r6 on #619).
  const held = accuracyBurstLease;
  if (held && startedAt !== UNKNOWN_BURST && held.startedAt === startedAt && held.capture.binding?.id === capture.binding?.id) {
    if (!accuracyBurstTimer) scheduleAccuracyBurstGuard(held, ACCURACY_BURST_RETRY_MS);
    return;
  }
  accuracyBurstLease = {
    capture, startedAt, takenAt: monotonicNow(), nativeStartAt: Date.now(),
    // Never longer than a burst's 3 minutes and its hard stop, whatever the clocks say (Codex r12 on #619).
    endsInMs: Math.min(ACCURACY_BURST_DURATION_MS, Math.max(0, endsInMs)),
    stopInMs: Math.min(ACCURACY_BURST_DURATION_MS + ACCURACY_BURST_FORCE_STOP_MS, Math.max(0, stopInMs)),
    // Its runtime is elapsed time from here, past its planned stop too: a deadline is no proof native capture
    // stopped (Codex r8 on #619).
    priorMs: 0, nativeDoneAt: null, nativeDoneMono: null
  };
  scheduleAccuracyBurstGuard(accuracyBurstLease, firstTickMs ?? accuracyBurstLease.endsInMs + 1_000);
}

/**
 * A safety bound that needs no reading and no storage: while the process runs, the lease's timer brings normal
 * capture back after the 3 minutes and keeps trying until it's confirmed; at `stopBy` (5 minutes past the 3,
 * never past the day's remaining allowance) it stops location updates outright, and the next capture refresh
 * restarts them. Both native steps run in the capture lifecycle lane and only for the lease's own lifetime, still
 * current, so a late timer never touches another account's capture. The accounting is settled afterwards, retried
 * until storage takes it (Codex r2–r4 on #619). A relaunch ends a recorded burst on its first reading.
 */
function scheduleAccuracyBurstGuard(lease: AccuracyBurstLease, delayMs: number) {
  clearAccuracyBurstTimer();
  accuracyBurstTimer = setTimeout(() => {
    accuracyBurstTimer = null;
    void accuracyBurstGuardTick(lease).then((again) => {
      if (again && accuracyBurstLease === lease) scheduleAccuracyBurstGuard(lease, ACCURACY_BURST_RETRY_MS);
    }, () => {
      if (accuracyBurstLease === lease) scheduleAccuracyBurstGuard(lease, ACCURACY_BURST_RETRY_MS);
    });
  }, delayMs);
}

/** One step of the guard; true while there is more to do. */
async function accuracyBurstGuardTick(lease: AccuracyBurstLease) {
  if (accuracyBurstLease !== lease) return false;
  // A lifetime that ended has its own teardown, which stops updates and ends the burst. If that teardown failed and
  // its options are still the last ones set (no newer capture has set its own), the guard keeps stopping them; a
  // newer capture's start has replaced them, so there is nothing of this lease's left to stop (Codex r13 on #619).
  if (!isLocationCaptureSnapshotCurrent(lease.capture)) {
    const stopped = await withNativeLocationOptions(async () => {
      // Inherited options (the guard's own unknown burst) stay its to stop until a capture in this process sets the
      // options; a burst's, while its lifetime still owns them (Codex r13–r14 on #619).
      const stillOurs = lease.startedAt === UNKNOWN_BURST ? nativeLocationMode === "unknown"
        : nativeOptionsOwner === lease.capture.binding?.id && nativeLocationMode === "burst";
      if (!stillOurs) return true;
      // Updates that aren't running need no stop: a guard never retries a stop for nothing (Codex r19 on #619).
      const running = await Location.hasStartedLocationUpdatesAsync(DAYFRAME_LOCATION_LEARNING_TASK).catch(() => null);
      const done = running === false || await Location.stopLocationUpdatesAsync(DAYFRAME_LOCATION_LEARNING_TASK).then(() => true, () => false);
      if (done) {
        // Stopped, not normal: a capture still current and consenting starts again on its next admitted wake
        // (Codex r20 on #619).
        nativeLocationMode = "stopped";
        nativeOptionsOwner = null;
      }
      return done;
    });
    if (!stopped) return true;
    confirmLeaseDone(lease);
    if (lease.startedAt === UNKNOWN_BURST) noteNativeBurstEnd(lease.nativeDoneAt!);
    else pendingAccuracyBurstSettlements.set(lease.startedAt, lease);
    if (accuracyBurstLease === lease) accuracyBurstLease = null;
    settlePendingAccuracyBursts();
    return false;
  }
  const elapsed = monotonicNow() - lease.takenAt;
  if (lease.nativeDoneAt == null && elapsed >= lease.endsInMs) {
    const pastStopBy = elapsed >= lease.stopInMs;
    const done = await withNativeLocationOptions(async () => {
      if (accuracyBurstLease !== lease || !isLocationCaptureSnapshotCurrent(lease.capture)) return false;
      if (await Location.startLocationUpdatesAsync(DAYFRAME_LOCATION_LEARNING_TASK, learningUpdateOptions(false)).then(() => true, () => false)) {
        nativeLocationMode = "normal";
        nativeOptionsOwner = lease.capture.binding?.id ?? null;
        return true;
      }
      if (!pastStopBy) return false;
      const stopped = await Location.stopLocationUpdatesAsync(DAYFRAME_LOCATION_LEARNING_TASK).then(() => true, () => false);
      if (stopped) {
        nativeLocationMode = "stopped";
        nativeOptionsOwner = null;
      }
      return stopped;
    });
    if (done) confirmLeaseDone(lease);
  }
  if (lease.nativeDoneAt == null) return true;
  if (lease.startedAt === UNKNOWN_BURST) {
    // Inherited options are gone: any stored burst ended then at the latest.
    if (accuracyBurstLease === lease) accuracyBurstLease = null;
    noteNativeBurstEnd(lease.nativeDoneAt);
    settlePendingAccuracyBursts();
    return false;
  }
  // Normal capture (or none) is in place: settle the burst once storage takes it, at the moment that was
  // confirmed and on elapsed time, never the later moment storage came back (Codex r5–r7 on #619).
  await withAccuracyBurstState(async (state) => ({
    state: state?.active?.startedAt === lease.startedAt ? settleAccuracyBurst(state, lease) : state,
    result: undefined
  }));
  if (accuracyBurstLease === lease) accuracyBurstLease = null;
  return false;
}

/**
 * A reading (or the safety timer) after a burst's 3 minutes brings normal capture back. The burst stays recorded
 * until normal options are really in place, so a failed restore is tried again, and its time counts in full
 * (Codex r1 on #619). Only the capture lifetime that started it restores it. The trial starts here on the first
 * admitted wake, a headless one too, when there is none yet (Codex r2 on #619).
 */
export async function maybeEndAccuracyBurst(capture: LocationCaptureSnapshot) {
  if (!isLocationCaptureSnapshotCurrent(capture)) return false;
  // A process's first wake (a headless relaunch too) without a live lease of its own puts normal capture back before
  // anything else, storage readable or not: Expo may have kept a burst's options (Codex r12 on #619).
  // So does one after this process stopped updates (a guard or a teardown), for a capture current and consenting:
  // capture starts again here, at normal accuracy (Codex r20 on #619).
  const unset = () => nativeLocationMode === "unknown" || nativeLocationMode === "stopped";
  if (unset() && !liveAccuracyBurstLease(capture)) {
    const first = await withNativeLocationOptions(async () => {
      if (!unset() || liveAccuracyBurstLease(capture) || !isLocationCaptureSnapshotCurrent(capture)) return { done: true, ended: null };
      const restored = await Location.startLocationUpdatesAsync(DAYFRAME_LOCATION_LEARNING_TASK, learningUpdateOptions(false)).then(() => true, () => false);
      if (!restored) return { done: false, ended: null };
      nativeLocationMode = "normal";
      nativeOptionsOwner = capture.binding?.id ?? null;
      return { done: true, ended: endHeldLeaseAtNormal() };
    });
    if (!first.done) {
      // The guard keeps trying, and stops updates 5 minutes on, whether or not a burst is recorded.
      if (!heldGuardLease()) takeAccuracyBurstLease(capture, UNKNOWN_BURST, 0, ACCURACY_BURST_FORCE_STOP_MS);
      return false;
    }
    await settleAfterNormalCapture(first.ended);
  }
  const due = await withAccuracyBurstState(async (state) => {
    const now = new Date();
    const current = state ?? startAccuracyBurstTrial(now);
    const own = current.active && current.active.captureId === capture.binding?.id ? current.active : null;
    const lease = own && accuracyBurstLease?.startedAt === own.startedAt ? accuracyBurstLease : null;
    // This process's burst past its 3 minutes, or a stored one this process never leased (it can't be running).
    const result = own && (!lease || monotonicNow() - lease.takenAt >= lease.endsInMs || lease.nativeDoneAt != null) ? own.startedAt : null;
    return { state: current === UNREADABLE_ACCURACY_TRIAL ? current : withTrialProgress(current, now), result };
  });
  if (!due) return false;
  const lease = accuracyBurstLease?.startedAt === due ? accuracyBurstLease : null;
  if (lease && lease.nativeDoneAt == null) {
    const restored = await withNativeLocationOptions(async () => {
      if (!isLocationCaptureSnapshotCurrent(capture) || accuracyBurstLease !== lease) return lease.nativeDoneAt != null;
      const done = await Location.startLocationUpdatesAsync(DAYFRAME_LOCATION_LEARNING_TASK, learningUpdateOptions(false)).then(() => true, () => false);
      if (done) {
        nativeLocationMode = "normal";
        nativeOptionsOwner = capture.binding?.id ?? null;
        confirmLeaseDone(lease);
      }
      return done;
    });
    if (!restored) return false;
  }
  const ended = await withAccuracyBurstState(async (state) => {
    if (!state?.active || state.active.startedAt !== due) return { state, result: false };
    return { state: settleAccuracyBurst(state, lease), result: true };
  });
  if (ended && lease && accuracyBurstLease === lease) {
    accuracyBurstLease = null;
    clearAccuracyBurstTimer();
  }
  return ended;
}

/** The guard's lease for options a relaunch may have inherited, with no burst of this process behind them. */
const UNKNOWN_BURST = "";

/**
 * When this process hasn't set the options yet and holds no lease, the guard takes options a relaunch may have
 * inherited: it restores normal capture while `capture` is current, and otherwise stops updates while no capture in
 * this process has set them (Codex r13–r16 on #619). Called inside the native options queue.
 */
function guardInheritedAccuracyOptions(capture: LocationCaptureSnapshot) {
  if (!heldGuardLease() && nativeLocationMode === "unknown") takeAccuracyBurstLease(capture, UNKNOWN_BURST, 0, ACCURACY_BURST_FORCE_STOP_MS);
}

/** How long a wake has to be admitted (and set the options) before its admission guard acts. */
const WAKE_ADMISSION_GUARD_MS = 30_000;

/** The admission guard's lease: options this process never set, held from a wake's first line (Codex r19 on #619). */
const isAdmissionGuard = (lease: AccuracyBurstLease | null) => Boolean(lease && lease.startedAt === UNKNOWN_BURST && lease.capture === STOPPED_CAPTURE);

/** The lease, unless it's only the admission guard, which any surer guard or a capture's own options replace. */
const heldGuardLease = () => isAdmissionGuard(accuracyBurstLease) ? null : accuracyBurstLease;

/**
 * Every wake, and every foreground capture start or refresh, of a process that hasn't set the options yet starts
 * here, before any read, write or await: options a relaunch may have inherited are stopped 30 seconds on unless a
 * capture in this process has set them by then (an admitted wake or a refresh does at once), so a wake or refresh
 * that's rejected, slow, or whose cleanup does nothing never leaves them running (Codex r19, r21 on #619). A
 * capture's own options, or a guard bound to an admitted capture, end it; an admitted wake restarts what it stopped.
 */
function guardWakeAdmission() {
  if (accuracyBurstLease || nativeLocationMode !== "unknown") return;
  takeAccuracyBurstLease(STOPPED_CAPTURE, UNKNOWN_BURST, 0, ACCURACY_BURST_FORCE_STOP_MS, WAKE_ADMISSION_GUARD_MS);
}
registerLocationAdmissionGuard(guardWakeAdmission);

/**
 * An admission that ends without setting the learning task's options itself (geofence registration, a bootstrap):
 * for a capture still current and consenting, normal capture is put in place, as an admitted wake does, which also
 * ends the admission guard (Codex r22 on #619). Never throws.
 */
export async function reconcileLearningOptionsAfterAdmission(capture: LocationCaptureSnapshot) {
  try {
    if (!isLocationCaptureSnapshotCurrent(capture) || !await getLocationLearningEnabled()) return;
    await maybeEndAccuracyBurst(capture);
  } catch {
    await protectInheritedAccuracyOptions();
  }
}

/**
 * For a wake or refresh that failed before it could tell whose capture this is (an owner, consent, permission or
 * status read): options this process never set are put back to normal capture when updates are running, which only
 * ever lowers accuracy and never starts capture; if that can't be done, the guard stops updates outright until a
 * capture in this process sets the options (Codex r17 on #619). Never called inside the native options queue.
 */
async function protectInheritedAccuracyOptions() {
  if (heldGuardLease() || nativeLocationMode !== "unknown") return;
  await withNativeLocationOptions(async () => {
    if (heldGuardLease() || nativeLocationMode !== "unknown") return;
    const running = await Location.hasStartedLocationUpdatesAsync(DAYFRAME_LOCATION_LEARNING_TASK).catch(() => null);
    if (running === false) return;
    if (running && await Location.startLocationUpdatesAsync(DAYFRAME_LOCATION_LEARNING_TASK, learningUpdateOptions(false)).then(() => true, () => false)) {
      nativeLocationMode = "normal";
      nativeOptionsOwner = null;
      noteNativeBurstEnd();
      return;
    }
    guardInheritedAccuracyOptions(STOPPED_CAPTURE);
  }).catch(() => undefined);
  settlePendingAccuracyBursts();
}
/** No capture lifetime at all (a teardown's): never current, so a guard holding it only ever stops updates. */
const STOPPED_CAPTURE: LocationCaptureSnapshot = { revision: -1, binding: null, context: null };

/** This capture lifetime's lease while its burst may still run (not confirmed over, within its elapsed 3 minutes). */
function liveAccuracyBurstLease(capture: LocationCaptureSnapshot) {
  const lease = accuracyBurstLease;
  return lease && lease.startedAt !== UNKNOWN_BURST && lease.capture.binding?.id === capture.binding?.id && lease.nativeDoneAt == null &&
    monotonicNow() - lease.takenAt < lease.endsInMs ? lease : null;
}

/**
 * Called in the native options queue right after normal options were set with no live lease: the lease still held
 * (a burst past its 3 minutes, or the guard's), if any, is over now, and any stored burst started before now is too.
 */
function endHeldLeaseAtNormal() {
  const lease = accuracyBurstLease;
  if (lease) {
    confirmLeaseDone(lease);
    if (lease.startedAt !== UNKNOWN_BURST) pendingAccuracyBurstSettlements.set(lease.startedAt, lease);
    accuracyBurstLease = null;
    clearAccuracyBurstTimer();
  }
  noteNativeBurstEnd();
  return lease && lease.startedAt !== UNKNOWN_BURST ? lease : null;
}

/** Settles what a normal start ended, once storage takes it, retried until it does. */
async function settleAfterNormalCapture(ended: AccuracyBurstLease | null) {
  await withAccuracyBurstState(async (state) => ({ state: state?.active ? settleAccuracyBurst(state, ended) : state, result: undefined }))
    .catch(() => undefined);
  settlePendingAccuracyBursts();
}

function geofenceSource(radiusMeters: number): "geofence_specific" | "geofence_broad" {
  return radiusMeters > 250 ? "geofence_broad" : "geofence_specific";
}

function normalizedActivityDescription(value?: string | null) {
  const description = value?.trim();
  return description || null;
}

function geofenceEvidenceLocalId(transition: GeofenceTransition, placeId: string, occurredAt: Date) {
  return `location-${transition}-${placeId}-${occurredAt.getTime()}`;
}

function visitLocalId(visit: Pick<OpenVisit, "placeId" | "enteredAt">) {
  return `location-visit-${visit.placeId}-${new Date(visit.enteredAt).getTime()}`;
}

async function queueCommuteCandidate(currentVisit: CompletedVisit, capture: LocationCaptureSnapshot) {
  const previousVisit = await readLastCompletedVisit();
  if (!previousVisit || sameVisitEndpoint(previousVisit, currentVisit)) return false;

  const startedAt = new Date(previousVisit.stoppedAt);
  const stoppedAt = new Date(currentVisit.startedAt);
  const durationMs = stoppedAt.getTime() - startedAt.getTime();
  if (!Number.isFinite(durationMs) || durationMs < MIN_COMMUTE_DURATION_MS || durationMs > MAX_COMMUTE_DURATION_MS) {
    return false;
  }

  const durationSeconds = Math.round(durationMs / 1000);
  const reviewFirst = !isSavedPlaceVisit(previousVisit) || !isSavedPlaceVisit(currentVisit);
  const fromKey = visitEndpointKey(previousVisit);
  const toKey = visitEndpointKey(currentVisit);
  const localId = `location-commute-${fromKey}-${toKey}-${startedAt.getTime()}`;
  if (!isLocationCaptureSnapshotCurrent(capture)) return false;
  await enqueueEvent({
    owner: capture.context!,
    localId,
    source: "location_learning",
    type: "commute_detected",
    occurredAt: stoppedAt,
    description: reviewFirst ? "Possible commute" : undefined,
    rawPayload: {
      provider: "expo_location",
      evidenceKind: reviewFirst ? "commute_between_stationary_visits" : "commute_between_saved_place_visits",
      fromKind: previousVisit.kind ?? "saved_place",
      fromPlaceId: previousVisit.placeId,
      fromPlaceName: previousVisit.placeName,
      fromClusterKey: previousVisit.clusterKey,
      fromLatitude: previousVisit.latitude,
      fromLongitude: previousVisit.longitude,
      toKind: currentVisit.kind ?? "saved_place",
      toPlaceId: currentVisit.placeId,
      toPlaceName: currentVisit.placeName,
      toClusterKey: currentVisit.clusterKey,
      toLatitude: currentVisit.latitude,
      toLongitude: currentVisit.longitude,
      startedAt: startedAt.toISOString(),
      stoppedAt: stoppedAt.toISOString(),
      durationSeconds,
      durationMinutes: Math.round(durationSeconds / 60),
      confidence: reviewFirst ? "medium" : "medium_high",
      reviewFirst
    }
  });

  await updateLocationDiagnostics({
    lastStatus: reviewFirst
      ? `Queued possible commute from ${previousVisit.placeName} to ${currentVisit.placeName} for review.`
      : `Queued commute from ${previousVisit.placeName} to ${currentVisit.placeName} for auto-log.`,
    lastCommuteCandidate: {
      fromPlaceName: previousVisit.placeName,
      toPlaceName: currentVisit.placeName,
      startedAt: startedAt.toISOString(),
      stoppedAt: stoppedAt.toISOString(),
      queuedAt: new Date().toISOString(),
      durationSeconds
    },
    lastEventAt: stoppedAt.toISOString()
  });
  return true;
}

async function queueLearnedPlaceVisit(input: {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  clusterFirstSeenAt?: string;
  clusterId?: string;
  evidence: LocationLearningEvidence;
}, capture: LocationCaptureSnapshot) {
  const latitude = roundedCoordinate(input.latitude);
  const longitude = roundedCoordinate(input.longitude);
  const startedAt = new Date(input.firstSeenAt);
  const stoppedAt = new Date(input.lastSeenAt);
  const durationSeconds = Math.max(0, Math.round((stoppedAt.getTime() - startedAt.getTime()) / 1000));
  const clusterKey = learnedPlaceClusterKey(latitude, longitude);
  const localId = `location-learned-${input.clusterId ?? clusterKey}-${stoppedAt.getTime()}`;
  const address = await reverseGeocodeLocation(latitude, longitude);
  const candidateName = readableLocationNameFromParts({ address, latitude, longitude });
  if (!isLocationCaptureSnapshotCurrent(capture)) return;
  await enqueueEvent({
    owner: capture.context!,
    localId,
    source: "location_learning",
    type: "learned_place_visit",
    occurredAt: stoppedAt,
    description: candidateName,
    rawPayload: {
      provider: "expo_location",
      evidenceKind: "learned_place_visit",
      candidateName,
      address,
      clusterKey,
      clusterFirstSeenAt: input.clusterFirstSeenAt ?? startedAt.toISOString(),
      latitude,
      longitude,
      accuracy: input.accuracy ?? null,
      radiusMeters: LEARNED_PLACE_RADIUS_METERS,
      startedAt: startedAt.toISOString(),
      stoppedAt: stoppedAt.toISOString(),
      durationSeconds,
      durationMinutes: Math.round(durationSeconds / 60),
      ...locationLearningEvidencePayload(input.evidence),
      classification: "place_candidate",
      classificationScore: classifyLocationLearningEvidence(input.evidence).score,
      confidence: "medium",
      rawLocationRetentionDays: 7,
      reviewFirst: true
    }
  });
  await updateLocationDiagnostics({
    lastStatus: "Queued detected visit for review.",
    lastLearningSampleAt: stoppedAt.toISOString(),
    lastLearnedPlaceCandidate: {
      candidateName,
      startedAt: startedAt.toISOString(),
      stoppedAt: stoppedAt.toISOString(),
      queuedAt: new Date().toISOString(),
      durationSeconds,
      sampleCount: input.evidence.sampleCount
    }
  });
  await writeLastCompletedVisit({
    kind: "learned_place",
    placeName: candidateName,
    startedAt: startedAt.toISOString(),
    stoppedAt: stoppedAt.toISOString(),
    latitude,
    longitude,
    clusterKey
  });
}

async function queueOneOffLocationActivity(input: {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  clusterId: string;
  evidence: LocationLearningEvidence;
}, capture: LocationCaptureSnapshot) {
  const latitude = roundedCoordinate(input.latitude);
  const longitude = roundedCoordinate(input.longitude);
  const startedAt = new Date(input.firstSeenAt);
  const stoppedAt = new Date(input.lastSeenAt);
  const durationSeconds = Math.max(0, Math.round((stoppedAt.getTime() - startedAt.getTime()) / 1000));
  const clusterKey = learnedPlaceClusterKey(latitude, longitude);
  const address = await reverseGeocodeLocation(latitude, longitude);
  const candidateName = readableLocationNameFromParts({ address, latitude, longitude });
  if (!isLocationCaptureSnapshotCurrent(capture)) return;
  await enqueueEvent({
    owner: capture.context!,
    localId: `location-one-off-${input.clusterId}-${startedAt.getTime()}`,
    source: "location_learning",
    type: "unknown_stay",
    occurredAt: stoppedAt,
    description: candidateName,
    rawPayload: {
      provider: "expo_location",
      evidenceKind: "one_off_activity",
      candidateName,
      address,
      clusterKey,
      latitude,
      longitude,
      accuracy: input.accuracy ?? null,
      radiusMeters: LEARNED_PLACE_RADIUS_METERS,
      startedAt: startedAt.toISOString(),
      stoppedAt: stoppedAt.toISOString(),
      durationSeconds,
      durationMinutes: Math.round(durationSeconds / 60),
      ...locationLearningEvidencePayload(input.evidence),
      classification: "one_off_activity",
      classificationScore: classifyLocationLearningEvidence(input.evidence).score,
      confidence: "low",
      rawLocationRetentionDays: 7,
      reviewFirst: true
    }
  });
  await updateLocationDiagnostics({
    lastStatus: "Queued a significant one-off stay for review; it is not a saved-place suggestion.",
    lastLearningSampleAt: stoppedAt.toISOString(),
    lastEventAt: stoppedAt.toISOString()
  });
}

function locationLearningEvidencePayload(evidence: LocationLearningEvidence) {
  return {
    visitCount: evidence.visitCount,
    distinctDayCount: evidence.distinctDays,
    sampleCount: evidence.sampleCount,
    currentVisitSampleCount: evidence.currentVisitSampleCount,
    totalDwellMs: Math.round(evidence.totalDwellMs),
    longestDwellMs: Math.round(evidence.longestDwellMs),
    currentDwellMs: Math.round(evidence.currentDwellMs),
    averageAccuracyMeters: evidence.averageAccuracyMeters,
    maxClusterSpreadMeters: evidence.maxClusterSpreadMeters
  };
}

async function readableLearnedPlaceName(latitude: number, longitude: number) {
  const address = await reverseGeocodeLocation(roundedCoordinate(latitude), roundedCoordinate(longitude));
  return readableLocationNameFromParts({ address, latitude, longitude });
}

function learnedPlaceClusterId(latitude: number, longitude: number, sampledAt: string) {
  return `${learnedPlaceClusterKey(latitude, longitude)}-${new Date(sampledAt).getTime()}`;
}

function learnedPlaceClusterKey(latitude: number, longitude: number) {
  return `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
}

function nearestSavedPlaceMatch(
  latitude: number,
  longitude: number,
  accuracy: number | null,
  savedPlaces: MonitoredPlace[]
) {
  const matches = savedPlaces
    .map((place) => {
      const distance = distanceMeters(latitude, longitude, place.latitude, place.longitude);
      const effectiveRadius = effectiveSavedPlaceRadius(place, accuracy);
      const suppressionRadius = Math.max(effectiveRadius, SAVED_PLACE_LEARNING_SUPPRESSION_METERS);
      return {
        place,
        distance,
        effectiveRadius,
        suppressionRadius,
        withinEffectiveRadius: distance <= effectiveRadius,
        withinSuppressionRadius: distance <= suppressionRadius
      };
    })
    .filter((match) => Number.isFinite(match.distance))
    .sort((left, right) => left.distance - right.distance);
  return matches[0] ?? null;
}

function effectiveSavedPlaceRadius(place: MonitoredPlace, accuracy: number | null) {
  const accuracyBuffer = clampMeters(
    accuracy ?? SAVED_PLACE_ACCURACY_BUFFER_MIN_METERS,
    SAVED_PLACE_ACCURACY_BUFFER_MIN_METERS,
    SAVED_PLACE_ACCURACY_BUFFER_MAX_METERS
  );
  return Math.max(place.radiusMeters + accuracyBuffer, SAVED_PLACE_MIN_EFFECTIVE_RADIUS_METERS);
}

function clampMeters(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function sameVisitEndpoint(previousVisit: CompletedVisit, currentVisit: CompletedVisit) {
  return visitEndpointKey(previousVisit) === visitEndpointKey(currentVisit);
}

function visitEndpointKey(visit: CompletedVisit) {
  return visit.placeId ?? visit.clusterKey ?? `${visit.kind ?? "unknown_place"}:${visit.placeName}`;
}

function isSavedPlaceVisit(visit: CompletedVisit) {
  return (visit.kind ?? "saved_place") === "saved_place" && Boolean(visit.placeId);
}

function normalizedDayKeys(cluster: LearnedPlaceCluster | null, fallbackDayKey: string) {
  if (!cluster) return [fallbackDayKey];
  const stored = Array.isArray(cluster.seenDayKeys) ? cluster.seenDayKeys.filter(Boolean) : [];
  if (stored.length > 0) return uniqueStrings(stored);
  return uniqueStrings([dateKey(cluster.firstSeenAt), dateKey(cluster.lastSeenAt), fallbackDayKey]);
}

function dateKey(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function roundedCoordinate(value: number) {
  return Number(value.toFixed(6));
}

async function readMonitoredPlaces() {
  const raw = await readLocationCache(MONITORED_PLACES_KEY);
  const places = parseJson<MonitoredPlace[]>(raw, []);
  return places.reduce<Record<string, MonitoredPlace>>((map, place) => {
    if (place.id) map[place.id] = place;
    return map;
  }, {});
}

async function writeMonitoredPlaces(places: MonitoredPlace[]) {
  await writeLocationCache(MONITORED_PLACES_KEY, JSON.stringify(places));
}

async function readSavedPlaceCatalogue() {
  const raw = await readLocationCache(SAVED_PLACE_CATALOGUE_KEY);
  const places = parseJson<MonitoredPlace[]>(raw, []);
  return places.reduce<Record<string, MonitoredPlace>>((map, place) => {
    if (place.id) map[place.id] = place;
    return map;
  }, {});
}

async function writeSavedPlaceCatalogue(places: MonitoredPlace[]) {
  await writeLocationCache(SAVED_PLACE_CATALOGUE_KEY, JSON.stringify(places));
}

async function persistV2LocationBatch(locations: Location.LocationObject[], capture: LocationCaptureSnapshot) {
  const store = await import("./location/store");
  const rolloutMode = await store.getLocationRolloutMode();
  if (!capture.context || !isLocationCaptureSnapshotCurrent(capture)) return null;
  const pairs = locations.flatMap(location => {
    if (!Number.isFinite(new Date(location.timestamp).getTime())) return [];
    try { return [{ location, evidence: store.evidenceFromExpoLocation(location, capture.context!) }]; }
    catch { return []; }
  });
  if (pairs.length !== locations.length) await store.recordLocationCaptureDiscard("invalid_timestamp", locations.length - pairs.length);
  // V1 keeps its own binding cutoff (the classifier below skips earlier readings).
  if (rolloutMode === "v1") {
    return { rolloutMode, admittedLocations: pairs.map(pair => pair.location)
      .filter(location => location.timestamp >= Date.parse(capture.binding!.boundAt)) };
  }
  const persisted = await store.persistLocationEvidence(pairs.map(pair => pair.evidence), capture);
  const admitted = new Set(persisted.admittedIds);
  await drainNativeSignalsOnWake(capture);
  if (isLocationCaptureSnapshotCurrent(capture)) void store.syncLocationEvidence().catch(error => recordV2LocationFailure(error, capture));
  return { rolloutMode, admittedLocations: pairs.filter(pair => admitted.has(pair.evidence.clientEvidenceId)).map(pair => pair.location) };
}

// Native Visit and significant-change callbacks wait in the native journal until
// JavaScript runs. Every background wake drains them through the owned lifecycle
// lane, so they upload with this batch instead of at the next foreground. (The
// drain itself lets an admitted Visit or significant change re-pick the nearest
// saved places: runtime.ts.)
async function drainNativeSignalsOnWake(capture: LocationCaptureSnapshot) {
  if (!isLocationCaptureSnapshotCurrent(capture)) return;
  await drainNativeLocationSignalsInBatches().catch(error => recordV2LocationFailure(error, capture));
}

async function persistV2GeofenceEvidence(transition: GeofenceTransition, region: DayframeRegion, capture: LocationCaptureSnapshot) {
  const store = await import("./location/store");
  const rolloutMode = await store.getLocationRolloutMode();
  if (!capture.context || !isLocationCaptureSnapshotCurrent(capture)) return null;
  const identifier = region.identifier?.slice(0, 160) ?? "";
  const placeId = identifier.split(":").at(-1) ?? "";
  if (!capture.context.savedPlaces.some(place => place.id === placeId)) {
    await store.recordLocationCaptureDiscard("foreign_place", 1);
    return null;
  }
  // Expo gives no source timestamp for region events. Bind the registration
  // itself to the capture generation, including opt-out/re-enable and A/B/A.
  if (identifier !== `${capture.binding!.id}:${placeId}`) {
    await store.recordLocationCaptureDiscard("stale_epoch", 1);
    return null;
  }
  if (rolloutMode === "v1") return { rolloutMode };
  const occurredAt = new Date().toISOString();
  const evidence = LocationEvidenceSchema.parse({
    clientEvidenceId: `geofence-${transition}-${identifier}-${Date.parse(occurredAt)}`,
    deviceId: capture.context.deviceId,
    algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
    kind: transition === "enter" ? "geofence_enter" : "geofence_exit",
    occurredAt,
    savedPlaceId: UUID_RE.test(placeId) ? placeId : null,
    geofenceIdentifier: identifier,
    receivedAt: occurredAt,
    timeZone: capture.context.timeZone,
    metadata: {}
  } satisfies LocationEvidence);
  await store.persistLocationEvidence([evidence], capture);
  await drainNativeSignalsOnWake(capture);
  if (isLocationCaptureSnapshotCurrent(capture)) void store.syncLocationEvidence().catch(error => recordV2LocationFailure(error, capture));
  return { rolloutMode };
}

async function recordV2LocationFailure(error: unknown, capture: LocationCaptureSnapshot) {
  if (!isLocationCaptureSnapshotCurrent(capture)) return;
  const message = error instanceof Error ? error.message : "Location Intelligence V2 could not persist evidence.";
  await updateLocationDiagnostics({
    lastStatus: message.slice(0, 180),
    lastEventAt: new Date().toISOString()
  }, capture);
  await import("./location/store")
    .then(({ recordLocationStoreError }) => isLocationCaptureSnapshotCurrent(capture) ? recordLocationStoreError(error) : undefined)
    .catch(() => undefined);
}

async function readOpenVisits() {
  return parseJson<Record<string, OpenVisit>>(await readLocationCache(OPEN_VISITS_KEY), {});
}

async function writeOpenVisits(visits: Record<string, OpenVisit>) {
  await writeLocationCache(OPEN_VISITS_KEY, JSON.stringify(visits));
}

async function readSeenVisitIds() {
  return parseJson<string[]>(await readLocationCache(SEEN_VISIT_IDS_KEY), []);
}

async function writeSeenVisitIds(ids: string[]) {
  await writeLocationCache(SEEN_VISIT_IDS_KEY, JSON.stringify(ids));
}

async function readLastCompletedVisit() {
  return parseJson<CompletedVisit | null>(await readLocationCache(LAST_COMPLETED_VISIT_KEY), null);
}

async function writeLastCompletedVisit(visit: CompletedVisit) {
  await writeLocationCache(LAST_COMPLETED_VISIT_KEY, JSON.stringify(visit));
}

async function readLearnedPlaceClusters() {
  return parseJson<LearnedPlaceCluster[]>(await readLocationCache(LEARNED_PLACE_CLUSTERS_KEY), []);
}

async function writeLearnedPlaceClusters(clusters: LearnedPlaceCluster[]) {
  await writeLocationCache(LEARNED_PLACE_CLUSTERS_KEY, JSON.stringify(clusters));
}

async function readLocationDiagnostics(capture?: LocationCaptureSnapshot): Promise<LocationVisitDiagnostics> {
  return {
    foregroundPermission: "unknown",
    backgroundPermission: "unknown",
    activeMonitorCount: 0,
    ...parseJson<Partial<LocationVisitDiagnostics>>(await readLocationCache(LOCATION_DIAGNOSTICS_KEY, capture), {})
  };
}

async function updateLocationDiagnostics(patch: Partial<LocationVisitDiagnostics>, captured?: LocationCaptureSnapshot) {
  const capture = captured ?? await captureLocationOwnership();
  const current = await readLocationDiagnostics(capture);
  await writeLocationCache(LOCATION_DIAGNOSTICS_KEY, JSON.stringify({ ...current, ...patch }), capture);
}

function permissionLabel(status?: string): LocationPermissionLabel {
  if (status === "granted" || status === "denied" || status === "undetermined") return status;
  return "unknown";
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
