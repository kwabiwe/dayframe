export type Coordinate = { latitude: number; longitude: number };

const EARTH_RADIUS_METERS = 6_371_008.8;

export function distanceMeters(a: Coordinate, b: Coordinate) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(b.latitude - a.latitude);
  const longitudeDelta = toRadians(b.longitude - a.longitude);
  const latitudeA = toRadians(a.latitude);
  const latitudeB = toRadians(b.latitude);
  const h =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function midpointTimeIso(lower: string, upper: string) {
  const lowerMs = Date.parse(lower);
  const upperMs = Date.parse(upper);
  return new Date(lowerMs + Math.max(0, upperMs - lowerMs) / 2).toISOString();
}

export function accuracyWeightedCentre(
  points: Array<Coordinate & { accuracyMeters?: number | null }>
): Coordinate | null {
  if (points.length === 0) return null;
  let latitude = 0;
  let longitude = 0;
  let totalWeight = 0;
  for (const point of points) {
    const accuracy = Math.max(10, Math.min(100, point.accuracyMeters ?? 65));
    // Horizontal accuracy is a radius, so inverse-variance weighting keeps a
    // broad/noisy sample from dragging an otherwise tight cluster centre.
    const weight = 1 / (accuracy * accuracy);
    latitude += point.latitude * weight;
    longitude += point.longitude * weight;
    totalWeight += weight;
  }
  return { latitude: latitude / totalWeight, longitude: longitude / totalWeight };
}

export function stableLocationId(prefix: string, parts: string[]) {
  const input = parts.join("\u001f");
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}_${(hash >>> 0).toString(36)}`;
}

/** Returns the calendar day in the user's IANA zone; UTC slicing is incorrect around DST and midnight. */
export function localDateKey(instant: string, timeZone: string) {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) throw new Error("A valid instant is required for local day grouping.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
