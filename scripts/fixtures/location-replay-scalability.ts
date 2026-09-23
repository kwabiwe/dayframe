import { LOCATION_ENGINE_V2_CONFIG, type LocationEvidence } from "@dayframe/shared";

export const REPLAY_SCALABILITY_CLOCK = "2026-09-14T00:00:00.000Z";
export const REPLAY_SCALABILITY_CUTOVER = "2026-09-07T00:00:00.000Z";
export const REPLAY_SCALABILITY_DEVICE = "replay-scalability-synthetic-device";
export const REPLAY_SCALABILITY_TRIPS_PER_DAY = 8;
export const REPLAY_SCALABILITY_POINTS_PER_TRIP = 76;
export const REPLAY_SCALABILITY_S1_DAYS = 7;
export const REPLAY_SCALABILITY_S3_DAYS = 7;

export const REPLAY_SCALABILITY_PLACE_A = {
  name: "Scalability saved place A",
  latitude: 51.5001,
  longitude: -0.1201,
  radiusMeters: 100
} as const;
export const REPLAY_SCALABILITY_PLACE_B = {
  name: "Scalability saved place B",
  latitude: 51.5151,
  longitude: -0.1201,
  radiusMeters: 100
} as const;

export type ReplayScalabilityPlaceIds = {
  placeAId: string;
  placeBId: string;
};

/**
 * A deterministic seven-day journal with real stationary episodes, journeys,
 * Visits, significant-change route points, saved-place matches and unknown
 * stays. No provider-status filler is used to inflate the workload.
 */
export function replayScalabilityHistory(
  placeIds: ReplayScalabilityPlaceIds,
  days = REPLAY_SCALABILITY_S1_DAYS,
  tripsPerDay = REPLAY_SCALABILITY_TRIPS_PER_DAY
): LocationEvidence[] {
  const rows: LocationEvidence[] = [];
  const cutoverAt = Date.parse(REPLAY_SCALABILITY_CUTOVER);
  const compactEpisodes = tripsPerDay > REPLAY_SCALABILITY_TRIPS_PER_DAY;
  for (let day = 0; day < days; day++) {
    for (let trip = 0; trip < tripsPerDay; trip++) {
      const start = cutoverAt + day * 86_400_000 +
        (compactEpisodes ? trip * 90 * 60_000 : 3 * 3_600_000 + trip * 150 * 60_000);
      const savedEpisode = (day + trip) % 3 !== 1;
      const originIsA = (day + trip) % 2 === 0;
      const origin = savedEpisode
        ? originIsA ? REPLAY_SCALABILITY_PLACE_A : REPLAY_SCALABILITY_PLACE_B
        : {
            latitude: 51.48 + day * 0.004 + trip * 0.001,
            longitude: -0.20 - trip * 0.004
          };
      const destination = savedEpisode
        ? originIsA ? REPLAY_SCALABILITY_PLACE_B : REPLAY_SCALABILITY_PLACE_A
        : {
            latitude: origin.latitude + 0.014,
            longitude: origin.longitude + 0.012
          };
      const originPlaceId = savedEpisode ? originIsA ? placeIds.placeAId : placeIds.placeBId : undefined;
      const destinationPlaceId = savedEpisode ? originIsA ? placeIds.placeBId : placeIds.placeAId : undefined;

      for (let point = 0; point < REPLAY_SCALABILITY_POINTS_PER_TRIP; point++) {
        const stationaryAtStart = point < 20;
        const moving = point >= 20 && point < 56;
        const minute = stationaryAtStart
          ? point * (compactEpisodes ? 0.35 : 0.75)
          : moving
            ? (compactEpisodes ? 8 : 15) + (point - 20) * (compactEpisodes ? 0.8 : 1.75)
            : (compactEpisodes ? 42 : 78) + (point - 56) * (compactEpisodes ? 0.6 : 1.5);
        const fraction = moving ? (point - 20) / 35 : point >= 56 ? 1 : 0;
        const latitude = origin.latitude + (destination.latitude - origin.latitude) * fraction;
        const longitude = origin.longitude + (destination.longitude - origin.longitude) * fraction;
        const isVisit = point === 4;
        const kind = isVisit
          ? "visit"
          : moving && point % 4 === 0
            ? "significant_change"
            : "standard_location";
        rows.push({
          clientEvidenceId: `scale-day-${day}-trip-${trip}-point-${point}`,
          deviceId: REPLAY_SCALABILITY_DEVICE,
          algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
          kind,
          occurredAt: new Date(start + minute * 60_000).toISOString(),
          endedAt: isVisit ? new Date(start + 18 * 60_000).toISOString() : undefined,
          latitude,
          longitude,
          horizontalAccuracyMeters: 10,
          altitudeMeters: 12,
          speedMetersPerSecond: moving ? 6 : 0,
          courseDegrees: moving ? 90 : 0,
          // Route samples carry no saved-place hint; only stationary/Visit
          // observations do, keeping place ownership realistic.
          savedPlaceId: moving ? undefined : isVisit ? originPlaceId : point >= 56 ? destinationPlaceId : originPlaceId,
          receivedAt: REPLAY_SCALABILITY_CLOCK,
          timeZone: "Europe/London",
          isSimulated: false,
          metadata: { signalSequence: day * tripsPerDay * REPLAY_SCALABILITY_POINTS_PER_TRIP + trip * REPLAY_SCALABILITY_POINTS_PER_TRIP + point }
        });
      }
    }
  }
  return rows;
}

export function changedReplayEvidence(placeIds: ReplayScalabilityPlaceIds) {
  const history = replayScalabilityHistory(placeIds);
  const last = history.at(-1)!;
  return [
    ...history,
    {
      ...last,
      clientEvidenceId: "scale-changed-input-final-witness",
      kind: "standard_location" as const,
      occurredAt: new Date(Date.parse(last.occurredAt) + 30_000).toISOString(),
      receivedAt: REPLAY_SCALABILITY_CLOCK,
      metadata: { signalSequence: 9_999_999 }
    }
  ];
}

/** Additional diagnostic shape, not a replacement for S1: many more episodes
 * at a similar observation count. Synthetic only, not reconstructed hosted data. */
export function highSegmentReplayEvidence(placeIds: ReplayScalabilityPlaceIds) {
  const points = new Set([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36,
    40, 44, 48, 52, 55, 56, 58, 60, 62, 64, 66, 68, 70, 72, 75]);
  const start = Date.parse(REPLAY_SCALABILITY_CUTOVER);
  const rows = replayScalabilityHistory(placeIds, 7, 20).flatMap((row, index) => {
    const point = index % 76, trip = Math.floor(index / 76) % 20, day = Math.floor(index / (76 * 20));
    if (!points.has(point) && !(point === 74 && trip % 2 === 0)) return [];
    const oldStart = start + day * 86_400_000 + trip * 90 * 60_000;
    const newStart = start + day * 86_400_000 + trip * 70 * 60_000;
    const move = (value: string) => new Date(newStart + (Date.parse(value) - oldStart) * 0.7).toISOString();
    return [{ ...row, occurredAt: move(row.occurredAt), endedAt: row.endedAt ? move(row.endedAt) : row.endedAt }];
  });
  const last = rows.at(-1)!;
  return [...rows, { ...last, clientEvidenceId: "high-segment-last-witness",
    occurredAt: new Date(Date.parse(last.occurredAt) + 30_000).toISOString() }];
}
