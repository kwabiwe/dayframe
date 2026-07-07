import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { enqueueEvent } from "./api";

export const DAYFRAME_GEOFENCE_TASK = "DAYFRAME_GEOFENCE_TASK";
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
  lastMonitorRefreshAt?: string;
  lastVisitQueuedAt?: string;
};

type MonitoredPlace = {
  id: string;
  name: string;
  radiusMeters: number;
  priority: number;
  defaultCategoryId?: string | null;
  defaultCategoryName?: string | null;
};

type OpenVisit = {
  placeId: string;
  placeName: string;
  enteredAt: string;
  radiusMeters: number;
  source: "geofence_specific" | "geofence_broad";
  defaultCategoryId?: string | null;
  defaultCategoryName?: string | null;
};

type GeofenceTransition = "enter" | "exit";

const IOS_GEOFENCE_LIMIT = 20;
const MONITORED_PLACES_KEY = "dayframe.location.monitoredPlaces.v1";
const OPEN_VISITS_KEY = "dayframe.location.openVisits.v1";
const SEEN_VISIT_IDS_KEY = "dayframe.location.seenVisits.v1";
const LOCATION_DIAGNOSTICS_KEY = "dayframe.location.diagnostics.v1";
const MAX_SEEN_VISIT_IDS = 500;
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
  return startGeofences(places);
}

export async function createUnknownStayCandidate(durationMinutes: number) {
  return enqueueEvent({
    source: "geofence_broad",
    type: "unknown_stay",
    rawPayload: { durationMinutes }
  });
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
  const [stored, foreground, background] = await Promise.all([
    readLocationDiagnostics(),
    Location.getForegroundPermissionsAsync().catch(() => null),
    Location.getBackgroundPermissionsAsync().catch(() => null)
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
    defaultCategoryName: place.defaultCategoryName
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
  await enqueueEvent({
    localId,
    source,
    type: "geofence_exit",
    occurredAt: stoppedAt,
    placeId: place.id,
    categoryId: place.defaultCategoryId ?? openVisit.defaultCategoryId ?? undefined,
    description: `Visit to ${place.name}`,
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
      defaultCategoryName: place.defaultCategoryName ?? openVisit.defaultCategoryName ?? null
    }
  });
  await writeSeenVisitIds([localId, ...seenVisitIds.filter((id) => id !== localId)].slice(0, MAX_SEEN_VISIT_IDS));
  await updateLocationDiagnostics({
    lastStatus: `Queued ${place.name} visit for review.`,
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
  radiusMeters: number;
  priority?: number;
  defaultCategoryId?: string | null;
  defaultCategoryName?: string | null;
}): MonitoredPlace {
  return {
    id: place.id,
    name: place.name,
    radiusMeters: place.radiusMeters,
    priority: place.priority ?? 0,
    defaultCategoryId: place.defaultCategoryId,
    defaultCategoryName: place.defaultCategoryName
  };
}

async function stopGeofencesIfStarted() {
  const started = await Location.hasStartedGeofencingAsync(DAYFRAME_GEOFENCE_TASK).catch(() => false);
  if (started) await Location.stopGeofencingAsync(DAYFRAME_GEOFENCE_TASK);
}

function geofenceSource(radiusMeters: number): "geofence_specific" | "geofence_broad" {
  return radiusMeters > 250 ? "geofence_broad" : "geofence_specific";
}

function geofenceEvidenceLocalId(transition: GeofenceTransition, placeId: string, occurredAt: Date) {
  return `location-${transition}-${placeId}-${occurredAt.getTime()}`;
}

function visitLocalId(visit: Pick<OpenVisit, "placeId" | "enteredAt">) {
  return `location-visit-${visit.placeId}-${new Date(visit.enteredAt).getTime()}`;
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
