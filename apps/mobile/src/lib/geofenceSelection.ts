import type { PlaceRole } from "@dayframe/shared";

// Which saved places the iPhone asks iOS to watch (location v3 PR 16b, design §11.1). iOS watches
// at most 20 regions per app. With 20 or fewer places with a location every one is watched, in the
// same order as before. Above that, Home and Work are always watched, then the places nearest the
// phone, and the last slot is a "refresh" circle around the phone: leaving it (or a Visit or a
// significant location change) picks the nearest places again. Pure and coordinate-local: the
// phone's position is only compared with saved places here and never leaves the device.
export const IOS_GEOFENCE_LIMIT = 20;
// iOS reports exits from small regions late or not at all, and a tiny circle in a dense part of
// town would re-pick on every short walk; 500 m keeps the refresh dependable.
export const GEOFENCE_REFRESH_MIN_RADIUS_METERS = 500;
// When no other place is near, a long drive still re-picks at least every 20 km.
export const GEOFENCE_REFRESH_MAX_RADIUS_METERS = 20_000;
// A position older or vaguer than this does not re-pick (the watched set stays as it is).
export const GEOFENCE_POSITION_MAX_AGE_MS = 15 * 60_000;
export const GEOFENCE_POSITION_MAX_ACCURACY_METERS = 1_500;

export type GeofenceCandidate = {
  id: string;
  role?: PlaceRole | null;
  latitude?: number | null;
  longitude?: number | null;
  radiusMeters: number;
  priority?: number;
};

export type GeofencePosition = { latitude: number; longitude: number };

export type GeofencePositionFix = GeofencePosition & {
  accuracy?: number | null;
  /** Epoch milliseconds of the reading. */
  timestamp: number;
};

export type GeofenceRefreshCircle = GeofencePosition & { radiusMeters: number };

export type GeofenceSelection<T> = {
  /** "all": every place fits; "nearest": nearest to the phone; "priority": position unknown. */
  mode: "all" | "nearest" | "priority";
  /** The places to watch: Home and Work first, then by distance (or by priority). */
  places: T[];
  /** Places with a location that are not watched right now. */
  unwatched: T[];
  refresh: GeofenceRefreshCircle | null;
};

export function selectGeofencePlaces<T extends GeofenceCandidate>(
  places: T[],
  position: GeofencePosition | null,
  limit = IOS_GEOFENCE_LIMIT
): GeofenceSelection<T> {
  const monitorable = places.filter(hasCoordinates).sort(byPriority);
  if (monitorable.length <= limit) return { mode: "all", places: monitorable, unwatched: [], refresh: null };

  const roles = monitorable.filter((place) => place.role === "home" || place.role === "work");
  const others = monitorable.filter((place) => place.role !== "home" && place.role !== "work");
  if (!position || !validPosition(position)) {
    // Today's priority order, with Home and Work kept, until the phone knows where it is.
    const chosen = [...roles, ...others].slice(0, limit);
    return { mode: "priority", places: chosen, unwatched: monitorable.filter((place) => !chosen.includes(place)), refresh: null };
  }

  // One slot is the refresh circle.
  const slots = limit - 1;
  const chosenRoles = roles.slice(0, slots);
  const ranked = others
    .map((place) => {
      const centre = distanceMeters(position.latitude, position.longitude, place.latitude, place.longitude);
      // Distance to the place's circle, so a large place counts as near as soon as its edge is.
      return { place, centre, edge: Math.max(0, centre - normalizedGeofenceRadius(place.radiusMeters)) };
    })
    .sort((left, right) => left.edge - right.edge || left.centre - right.centre || byPriority(left.place, right.place));
  const nearestCount = Math.max(0, slots - chosenRoles.length);
  const chosen = [...chosenRoles, ...ranked.slice(0, nearestCount).map((item) => item.place)];
  // The circle reaches the nearest place that is not watched, so the phone leaves it before it can
  // enter an unwatched place (unless the minimum radius is wider than that gap).
  const firstUnwatched = ranked[nearestCount];
  const radiusMeters = clamp(
    Math.round(firstUnwatched ? firstUnwatched.edge : GEOFENCE_REFRESH_MAX_RADIUS_METERS),
    GEOFENCE_REFRESH_MIN_RADIUS_METERS,
    GEOFENCE_REFRESH_MAX_RADIUS_METERS
  );
  return {
    mode: "nearest",
    places: chosen,
    unwatched: monitorable.filter((place) => !chosen.includes(place)),
    refresh: { latitude: position.latitude, longitude: position.longitude, radiusMeters }
  };
}

/** True when the position is inside (or on the edge of) the refresh circle. */
export function insideRefreshCircle(position: GeofencePosition, circle: GeofenceRefreshCircle) {
  return distanceMeters(position.latitude, position.longitude, circle.latitude, circle.longitude) <= circle.radiusMeters;
}

/** The newest usable reading, or null when none is recent and accurate enough to re-pick from. */
export function freshestGeofenceFix(fixes: Array<GeofencePositionFix | null | undefined>, now = Date.now()) {
  let freshest: GeofencePositionFix | null = null;
  for (const fix of fixes) {
    if (!fix || !validPosition(fix) || !Number.isFinite(fix.timestamp)) continue;
    if (now - fix.timestamp > GEOFENCE_POSITION_MAX_AGE_MS || fix.timestamp - now > 60_000) continue;
    if (typeof fix.accuracy === "number" && (!Number.isFinite(fix.accuracy) || fix.accuracy > GEOFENCE_POSITION_MAX_ACCURACY_METERS)) continue;
    if (!freshest || fix.timestamp > freshest.timestamp) freshest = fix;
  }
  return freshest;
}

export function normalizedGeofenceRadius(value: number) {
  if (!Number.isFinite(value)) return 100;
  return Math.max(25, Math.min(2000, Math.round(value)));
}

export function distanceMeters(
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

// Priority first, then the smaller radius, then id: the order used before nearest-place selection.
function byPriority(left: GeofenceCandidate, right: GeofenceCandidate) {
  const priorityDelta = (right.priority ?? 0) - (left.priority ?? 0);
  if (priorityDelta !== 0) return priorityDelta;
  const radiusDelta = left.radiusMeters - right.radiusMeters;
  if (radiusDelta !== 0) return radiusDelta;
  return left.id.localeCompare(right.id);
}

function hasCoordinates<T extends GeofenceCandidate>(place: T) {
  return typeof place.latitude === "number" && typeof place.longitude === "number";
}

function validPosition(position: GeofencePosition) {
  return Number.isFinite(position.latitude) && Number.isFinite(position.longitude) &&
    Math.abs(position.latitude) <= 90 && Math.abs(position.longitude) <= 180;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}
