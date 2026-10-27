import { distanceMeters } from "./geo";
import { STATIONS_PACKED } from "./stations.generated";

/**
 * Rail, Underground and metro/tram stations bundled from NaPTAN (location v4 §8, build step 7; Open
 * Government Licence v3.0, see stations.generated.ts). Public data only, decoded once on first use.
 */
export type StationKind = "rail" | "underground" | "metro";
type Station = { kind: StationKind; latitude: number; longitude: number };

const KIND: Record<string, StationKind> = { r: "rail", u: "underground", m: "metro" };
let decoded: Station[] | null = null;

function stations(): Station[] {
  if (decoded) return decoded;
  decoded = STATIONS_PACKED.split(";").map((entry) => {
    const [latitude, longitude] = entry.slice(1).split(",").map(Number);
    return { kind: KIND[entry[0]], latitude: latitude / 1e5, longitude: longitude / 1e5 };
  });
  return decoded;
}

/** The bundled stations of one kind (public data), for tests that need real station positions. */
export function bundledStations(kind: StationKind) {
  return stations().filter((station) => station.kind === kind).map((station) => ({ ...station }));
}

/** Metres per degree of latitude, rounded down so the search window never misses a station. */
const METRES_PER_DEGREE_LATITUDE = 110_000;

/**
 * The nearest bundled station of one of `kinds` within `radiusMeters` of a point, or null. Stations are
 * sorted by latitude, so only the band within the radius is searched.
 */
export function nearestStation(point: { latitude: number; longitude: number }, kinds: readonly StationKind[], radiusMeters: number) {
  const list = stations();
  const band = radiusMeters / METRES_PER_DEGREE_LATITUDE;
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (list[middle].latitude < point.latitude - band) low = middle + 1;
    else high = middle;
  }
  let best: { kind: StationKind; meters: number } | null = null;
  for (let index = low; index < list.length && list[index].latitude <= point.latitude + band; index += 1) {
    const station = list[index];
    if (!kinds.includes(station.kind)) continue;
    const meters = distanceMeters(point, station);
    if (meters <= radiusMeters && (!best || meters < best.meters)) best = { kind: station.kind, meters };
  }
  return best;
}
