import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { enqueueEvent } from "./api";

export const DAYFRAME_GEOFENCE_TASK = "DAYFRAME_GEOFENCE_TASK";

type DayframeRegion = {
  identifier: string;
  latitude: number;
  longitude: number;
  radius: number;
  notifyOnEnter: boolean;
  notifyOnExit: boolean;
};

const IOS_GEOFENCE_LIMIT = 20;

TaskManager.defineTask(DAYFRAME_GEOFENCE_TASK, async ({ data, error }) => {
  if (error) return;
  const payload = data as {
    eventType: Location.GeofencingEventType;
    region: DayframeRegion;
  };
  const type =
    payload.eventType === Location.GeofencingEventType.Enter
      ? "geofence_enter"
      : payload.eventType === Location.GeofencingEventType.Exit
        ? "geofence_exit"
        : null;
  if (!type) return;

  await enqueueEvent({
    source: payload.region.radius > 250 ? "geofence_broad" : "geofence_specific",
    type,
    placeId: payload.region.identifier,
    rawPayload: {
      region: payload.region.identifier,
      radius: payload.region.radius,
      transition: type === "geofence_enter" ? "enter" : "exit",
      isBroad: payload.region.radius > 250
    }
  });
});

export async function requestLocationAccess() {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") return foreground.status;
  const background = await Location.requestBackgroundPermissionsAsync();
  return background.status;
}

export async function startGeofences(
  places: Array<{
    id: string;
    name: string;
    latitude?: number | null;
    longitude?: number | null;
    radiusMeters: number;
    priority?: number;
  }>
) {
  const regions = places
    .filter((place) => typeof place.latitude === "number" && typeof place.longitude === "number")
    .sort((left, right) => {
      const priorityDelta = (right.priority ?? 0) - (left.priority ?? 0);
      if (priorityDelta !== 0) return priorityDelta;
      return left.radiusMeters - right.radiusMeters;
    })
    .slice(0, IOS_GEOFENCE_LIMIT)
    .map((place) => ({
      identifier: place.id,
      latitude: place.latitude as number,
      longitude: place.longitude as number,
      radius: place.radiusMeters,
      notifyOnEnter: true,
      notifyOnExit: true
    }));

  if (regions.length === 0) return 0;
  await Location.startGeofencingAsync(DAYFRAME_GEOFENCE_TASK, regions);
  return regions.length;
}

export async function createUnknownStayCandidate(durationMinutes: number) {
  return enqueueEvent({
    source: "geofence_broad",
    type: "unknown_stay",
    rawPayload: { durationMinutes }
  });
}
