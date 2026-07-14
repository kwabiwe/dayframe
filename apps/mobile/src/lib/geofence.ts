import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import {
  classifyLocationLearningEvidence,
  LOCATION_LEARNING_THRESHOLDS,
  readableLocationNameFromParts,
  type LocationLearningEvidence
} from "@dayframe/shared";
import { enqueueEvent } from "./api";
import { reverseGeocodeLocation } from "./locationGeocoding";

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
  lastStatus?: string;
  lastPlaceName?: string;
  lastEventAt?: string;
  lastGeofenceEvent?: {
    transition: GeofenceTransition;
    placeName: string;
    occurredAt: string;
  };
  lastQueuedVisitCandidate?: {
    placeName: string;
    startedAt: string;
    stoppedAt: string;
    queuedAt: string;
    durationSeconds: number;
  };
  locationLearningEnabled?: boolean;
  locationLearningActive?: boolean;
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

const IOS_GEOFENCE_LIMIT = 20;
const MONITORED_PLACES_KEY = "dayframe.location.monitoredPlaces.v1";
const OPEN_VISITS_KEY = "dayframe.location.openVisits.v1";
const SEEN_VISIT_IDS_KEY = "dayframe.location.seenVisits.v1";
const LOCATION_DIAGNOSTICS_KEY = "dayframe.location.diagnostics.v1";
const LOCATION_LEARNING_ENABLED_KEY = "dayframe.location.learning.enabled.v1";
const LEARNED_PLACE_CLUSTERS_KEY = "dayframe.location.learning.clusters.v1";
const LAST_COMPLETED_VISIT_KEY = "dayframe.location.lastCompletedVisit.v1";
const MAX_SEEN_VISIT_IDS = 500;
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

TaskManager.defineTask(DAYFRAME_GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    await updateLocationDiagnostics({
      lastStatus: "Location monitor reported an error.",
      lastEventAt: new Date().toISOString()
    });
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

  await recordGeofenceTransition(transition, payload.region);
});

TaskManager.defineTask(DAYFRAME_LOCATION_LEARNING_TASK, async ({ data, error }) => {
  if (error) {
    await updateLocationDiagnostics({
      lastStatus: "Location learning reported an error.",
      lastEventAt: new Date().toISOString()
    });
    return;
  }
  const enabled = await getLocationLearningEnabled();
  if (!enabled) return;
  const payload = data as { locations?: Location.LocationObject[] };
  const places = await readMonitoredPlaces();
  for (const location of payload.locations ?? []) {
    await recordLocationLearningSample(location, Object.values(places));
  }
});

export async function requestLocationAccess() {
  const foreground = await Location.requestForegroundPermissionsAsync();
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

  const background = await Location.requestBackgroundPermissionsAsync();
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
  return AsyncStorage.getItem(LOCATION_LEARNING_ENABLED_KEY).then((value) => value === "true");
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
  }> = []
) {
  if (!enabled) {
    await AsyncStorage.setItem(LOCATION_LEARNING_ENABLED_KEY, "false");
    await stopLocationLearningIfStarted();
    await updateLocationDiagnostics({
      locationLearningEnabled: false,
      locationLearningActive: false,
      lastStatus: "Commute and regular-place learning is paused.",
      lastEventAt: new Date().toISOString()
    });
    return "Commute and regular-place learning is paused.";
  }

  const foreground = await Location.getForegroundPermissionsAsync();
  const background = await Location.getBackgroundPermissionsAsync();
  if (foreground.status !== "granted" || background.status !== "granted") {
    await AsyncStorage.setItem(LOCATION_LEARNING_ENABLED_KEY, "false");
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

  await AsyncStorage.setItem(LOCATION_LEARNING_ENABLED_KEY, "true");
  await startLocationLearning(places);
  return "Commute and regular-place learning is on. Suggestions stay in Review.";
}

export async function startGeofences(
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
  }>
) {
  const monitorablePlaces = places
    .filter((place) => typeof place.latitude === "number" && typeof place.longitude === "number")
    .sort((left, right) => {
      const priorityDelta = (right.priority ?? 0) - (left.priority ?? 0);
      if (priorityDelta !== 0) return priorityDelta;
      return left.radiusMeters - right.radiusMeters;
    })
    .slice(0, IOS_GEOFENCE_LIMIT);
  const regions = monitorablePlaces
    .map((place) => ({
      identifier: place.id,
      latitude: place.latitude as number,
      longitude: place.longitude as number,
      radius: place.radiusMeters,
      notifyOnEnter: true,
      notifyOnExit: true
    }));

  await writeMonitoredPlaces(monitorablePlaces.map(monitoredPlaceFromInput));

  if (regions.length === 0) {
    await stopGeofencesIfStarted();
    await updateLocationDiagnostics({
      activeMonitorCount: 0,
      lastStatus: "No saved places with coordinates to monitor.",
      lastMonitorRefreshAt: new Date().toISOString()
    });
    return 0;
  }
  await Location.startGeofencingAsync(DAYFRAME_GEOFENCE_TASK, regions);
  await updateLocationDiagnostics({
    activeMonitorCount: regions.length,
    lastStatus: `Monitoring ${regions.length} saved ${regions.length === 1 ? "place" : "places"}.`,
    lastMonitorRefreshAt: new Date().toISOString()
  });
  return regions.length;
}

export async function startLocationLearning(
  places: Array<{
    id: string;
    name: string;
    latitude?: number | null;
    longitude?: number | null;
    radiusMeters: number;
  }> = []
) {
  const enabled = await getLocationLearningEnabled();
  if (!enabled) {
    await updateLocationDiagnostics({ locationLearningEnabled: false, locationLearningActive: false });
    return false;
  }

  if (places.length > 0) await writeMonitoredPlaces(places.map(monitoredPlaceFromInput));
  await Location.startLocationUpdatesAsync(DAYFRAME_LOCATION_LEARNING_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: LOCATION_LEARNING_SAMPLE_INTERVAL_MS,
    distanceInterval: LOCATION_LEARNING_DISTANCE_INTERVAL_METERS,
    pausesUpdatesAutomatically: true,
    showsBackgroundLocationIndicator: false
  });
  await updateLocationDiagnostics({
    locationLearningEnabled: true,
    locationLearningActive: true,
    lastStatus: "Commute and regular-place learning is on. Suggestions stay in Review.",
    lastMonitorRefreshAt: new Date().toISOString()
  });
  return true;
}

export async function refreshGeofencesForPlaces(
  places: Array<{
    id: string;
    name: string;
    latitude?: number | null;
    longitude?: number | null;
    radiusMeters: number;
    priority?: number;
  }>
) {
  const foreground = await Location.getForegroundPermissionsAsync();
  const background = await Location.getBackgroundPermissionsAsync();
  const foregroundPermission = permissionLabel(foreground.status);
  const backgroundPermission = permissionLabel(background.status);
  if (foreground.status !== "granted" || background.status !== "granted") {
    await updateLocationDiagnostics({
      foregroundPermission,
      backgroundPermission,
      activeMonitorCount: 0,
      lastStatus: "Location needs Always access before saved places can be monitored.",
      lastMonitorRefreshAt: new Date().toISOString()
    });
    return 0;
  }
  await updateLocationDiagnostics({ foregroundPermission, backgroundPermission });
  if (await getLocationLearningEnabled()) await startLocationLearning(places);
  return startGeofences(places);
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
  savedPlaces: MonitoredPlace[] = []
) {
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

  const sampledAt = new Date(location.timestamp || Date.now()).toISOString();
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
    }).catch(() => false);
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
    });
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
  });
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
  occurredAt = new Date()
) {
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

  if (transition === "enter") {
    return recordPlaceEnter(place, region, occurredAt);
  }

  return recordPlaceExit(place, region, occurredAt);
}

export async function getLocationVisitDiagnostics(): Promise<LocationVisitDiagnostics> {
  const [stored, foreground, background, learningEnabled, learningActive] = await Promise.all([
    readLocationDiagnostics(),
    Location.getForegroundPermissionsAsync().catch(() => null),
    Location.getBackgroundPermissionsAsync().catch(() => null),
    getLocationLearningEnabled().catch(() => false),
    Location.hasStartedLocationUpdatesAsync(DAYFRAME_LOCATION_LEARNING_TASK).catch(() => false)
  ]);
  const foregroundPermission = permissionLabel(foreground?.status);
  const backgroundPermission = permissionLabel(background?.status);

  return {
    foregroundPermission: foregroundPermission === "unknown" ? stored.foregroundPermission : foregroundPermission,
    backgroundPermission: backgroundPermission === "unknown" ? stored.backgroundPermission : backgroundPermission,
    activeMonitorCount: stored.activeMonitorCount,
    lastStatus: stored.lastStatus,
    lastPlaceName: stored.lastPlaceName,
    lastEventAt: stored.lastEventAt,
    lastGeofenceEvent: stored.lastGeofenceEvent,
    lastQueuedVisitCandidate: stored.lastQueuedVisitCandidate,
    locationLearningEnabled: learningEnabled,
    locationLearningActive: learningEnabled && learningActive,
    lastLearningSampleAt: stored.lastLearningSampleAt,
    lastLearnedPlaceCandidate: stored.lastLearnedPlaceCandidate,
    lastCommuteCandidate: stored.lastCommuteCandidate,
    lastMonitorRefreshAt: stored.lastMonitorRefreshAt,
    lastVisitQueuedAt: stored.lastVisitQueuedAt
  };
}

async function recordPlaceEnter(place: MonitoredPlace, region: DayframeRegion, occurredAt: Date) {
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
    defaultActivityDescription: place.defaultActivityDescription
  };
  await writeOpenVisits(openVisits);
  await enqueueEvent({
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
      isBroad: source === "geofence_broad"
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

async function recordPlaceExit(place: MonitoredPlace, region: DayframeRegion, occurredAt: Date) {
  const openVisits = await readOpenVisits();
  const openVisit = openVisits[place.id];
  if (!openVisit) {
    await updateLocationDiagnostics({
      lastStatus: `Left ${place.name}, but no matching entry was recorded.`,
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
  await enqueueEvent({
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
      defaultActivityDescription
    }
  });
  const currentVisit = {
    kind: "saved_place" as const,
    placeId: place.id,
    placeName: place.name,
    startedAt: startedAt.toISOString(),
    stoppedAt: stoppedAt.toISOString(),
    latitude: place.latitude,
    longitude: place.longitude
  };
  if (await getLocationLearningEnabled()) {
    await queueCommuteCandidate(currentVisit).catch(() => undefined);
  }
  await writeLastCompletedVisit(currentVisit);
  await writeSeenVisitIds([localId, ...seenVisitIds.filter((id) => id !== localId)].slice(0, MAX_SEEN_VISIT_IDS));
  await updateLocationDiagnostics({
    lastStatus: `Queued ${place.name} visit for review. Saved-place visits are review-first before becoming time entries.`,
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
  latitude?: number | null;
  longitude?: number | null;
  radiusMeters: number;
  priority?: number;
  defaultCategoryId?: string | null;
  defaultCategoryName?: string | null;
  defaultActivityDescription?: string | null;
}): MonitoredPlace {
  return {
    id: place.id,
    name: place.name,
    latitude: typeof place.latitude === "number" ? place.latitude : 0,
    longitude: typeof place.longitude === "number" ? place.longitude : 0,
    radiusMeters: place.radiusMeters,
    priority: place.priority ?? 0,
    defaultCategoryId: place.defaultCategoryId,
    defaultCategoryName: place.defaultCategoryName,
    defaultActivityDescription: normalizedActivityDescription(place.defaultActivityDescription)
  };
}

async function stopGeofencesIfStarted() {
  const started = await Location.hasStartedGeofencingAsync(DAYFRAME_GEOFENCE_TASK).catch(() => false);
  if (started) await Location.stopGeofencingAsync(DAYFRAME_GEOFENCE_TASK);
}

async function stopLocationLearningIfStarted() {
  const started = await Location.hasStartedLocationUpdatesAsync(DAYFRAME_LOCATION_LEARNING_TASK).catch(() => false);
  if (started) await Location.stopLocationUpdatesAsync(DAYFRAME_LOCATION_LEARNING_TASK);
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

async function queueCommuteCandidate(currentVisit: CompletedVisit) {
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
  await enqueueEvent({
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
}) {
  const latitude = roundedCoordinate(input.latitude);
  const longitude = roundedCoordinate(input.longitude);
  const startedAt = new Date(input.firstSeenAt);
  const stoppedAt = new Date(input.lastSeenAt);
  const durationSeconds = Math.max(0, Math.round((stoppedAt.getTime() - startedAt.getTime()) / 1000));
  const clusterKey = learnedPlaceClusterKey(latitude, longitude);
  const localId = `location-learned-${input.clusterId ?? clusterKey}-${stoppedAt.getTime()}`;
  const address = await reverseGeocodeLocation(latitude, longitude);
  const candidateName = readableLocationNameFromParts({ address, latitude, longitude });
  await enqueueEvent({
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
}) {
  const latitude = roundedCoordinate(input.latitude);
  const longitude = roundedCoordinate(input.longitude);
  const startedAt = new Date(input.firstSeenAt);
  const stoppedAt = new Date(input.lastSeenAt);
  const durationSeconds = Math.max(0, Math.round((stoppedAt.getTime() - startedAt.getTime()) / 1000));
  const clusterKey = learnedPlaceClusterKey(latitude, longitude);
  const address = await reverseGeocodeLocation(latitude, longitude);
  const candidateName = readableLocationNameFromParts({ address, latitude, longitude });
  await enqueueEvent({
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

function distanceMeters(
  leftLatitude: number,
  leftLongitude: number,
  rightLatitude?: number | null,
  rightLongitude?: number | null
) {
  if (typeof rightLatitude !== "number" || typeof rightLongitude !== "number") return Number.POSITIVE_INFINITY;
  const earthRadiusMeters = 6_371_000;
  const leftPhi = degreesToRadians(leftLatitude);
  const rightPhi = degreesToRadians(rightLatitude);
  const deltaPhi = degreesToRadians(rightLatitude - leftLatitude);
  const deltaLambda = degreesToRadians(rightLongitude - leftLongitude);
  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(leftPhi) * Math.cos(rightPhi) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

async function readMonitoredPlaces() {
  const raw = await AsyncStorage.getItem(MONITORED_PLACES_KEY);
  const places = parseJson<MonitoredPlace[]>(raw, []);
  return places.reduce<Record<string, MonitoredPlace>>((map, place) => {
    if (place.id) map[place.id] = place;
    return map;
  }, {});
}

async function writeMonitoredPlaces(places: MonitoredPlace[]) {
  await AsyncStorage.setItem(MONITORED_PLACES_KEY, JSON.stringify(places));
}

async function readOpenVisits() {
  return parseJson<Record<string, OpenVisit>>(await AsyncStorage.getItem(OPEN_VISITS_KEY), {});
}

async function writeOpenVisits(visits: Record<string, OpenVisit>) {
  await AsyncStorage.setItem(OPEN_VISITS_KEY, JSON.stringify(visits));
}

async function readSeenVisitIds() {
  return parseJson<string[]>(await AsyncStorage.getItem(SEEN_VISIT_IDS_KEY), []);
}

async function writeSeenVisitIds(ids: string[]) {
  await AsyncStorage.setItem(SEEN_VISIT_IDS_KEY, JSON.stringify(ids));
}

async function readLastCompletedVisit() {
  return parseJson<CompletedVisit | null>(await AsyncStorage.getItem(LAST_COMPLETED_VISIT_KEY), null);
}

async function writeLastCompletedVisit(visit: CompletedVisit) {
  await AsyncStorage.setItem(LAST_COMPLETED_VISIT_KEY, JSON.stringify(visit));
}

async function readLearnedPlaceClusters() {
  return parseJson<LearnedPlaceCluster[]>(await AsyncStorage.getItem(LEARNED_PLACE_CLUSTERS_KEY), []);
}

async function writeLearnedPlaceClusters(clusters: LearnedPlaceCluster[]) {
  await AsyncStorage.setItem(LEARNED_PLACE_CLUSTERS_KEY, JSON.stringify(clusters));
}

async function readLocationDiagnostics(): Promise<LocationVisitDiagnostics> {
  return {
    foregroundPermission: "unknown",
    backgroundPermission: "unknown",
    activeMonitorCount: 0,
    ...parseJson<Partial<LocationVisitDiagnostics>>(await AsyncStorage.getItem(LOCATION_DIAGNOSTICS_KEY), {})
  };
}

async function updateLocationDiagnostics(patch: Partial<LocationVisitDiagnostics>) {
  const current = await readLocationDiagnostics();
  await AsyncStorage.setItem(LOCATION_DIAGNOSTICS_KEY, JSON.stringify({ ...current, ...patch }));
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
