import type { LocationReviewEvidenceDto } from "@dayframe/shared";

/** The evidence's extent as [[west, south], [east, north]], or null when it has no coordinates. */
export function evidenceBounds(
  evidence: LocationReviewEvidenceDto,
  visitOnly = false
): [[number, number], [number, number]] | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [longitude, latitude] of [
    ...evidence.map.acceptedSamples.map((sample) => sample.point.coordinates),
    ...(visitOnly ? [] : evidence.map.nearbySavedPlaces.map((place) => place.point.coordinates)),
    ...(visitOnly ? [] : evidence.map.rejectedSamples.flatMap((sample) => sample.point ? [sample.point.coordinates] : [])),
    ...(evidence.map.route?.coordinates ?? []),
    ...(evidence.map.straightLineFallback?.coordinates ?? []),
    ...(evidence.map.centre ? [evidence.map.centre.coordinates] : [])
  ]) {
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }
  return Number.isFinite(west) ? [[west, south], [east, north]] : null;
}
