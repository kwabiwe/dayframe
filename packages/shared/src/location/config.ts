export type LocationEngineConfig = {
  algorithmVersion: string;
  distanceIntervalMeters: number;
  deferredUpdatesDistanceMeters: number;
  deferredUpdatesIntervalMs: number;
  deferredTimeoutMs: number;
  pausesUpdatesAutomatically: boolean;
  maxAcceptedHorizontalAccuracyMeters: number;
  highQualityHorizontalAccuracyMeters: number;
  maxAccuracyAllowanceMeters: number;
  unknownStayBaseRadiusMeters: number;
  maxContinuityGapMs: number;
  segmentFinalisationLagMs: number;
  savedPlaceMinimumDwellMs: number;
  unknownStayCandidateDwellMs: number;
  unknownStayReviewDwellMs: number;
  minimumGpsSamplesForUnanchoredStay: number;
  outsideConfirmationCount: number;
  movementSpeedThresholdMps: number;
  movementDisplacementThresholdMeters: number;
  commuteMinimumDurationMs: number;
  commuteMaximumDurationMs: number;
  commuteMinimumEndpointDistanceMeters: number;
  commuteLocalMovementMaximumEndpointDistanceMeters: number;
  commuteMinimumRouteDistanceMeters: number;
  commuteMinimumRouteEfficiency: number;
  commuteFasterMovementThresholdMps: number;
  commuteMinimumReliableSpeedSamples: number;
  commuteMaximumSpeedAccuracyMeters: number;
  commuteSamePlaceMinimumRouteDistanceMeters: number;
  commuteSamePlaceMinimumExcursionMeters: number;
  commuteSamePlaceMinimumRouteSamples: number;
  visitContinuityMaximumEndpointDistanceMeters: number;
  visitContinuityMaximumTransitionMs: number;
  visitContinuityMaximumRouteDistanceMeters: number;
  visitContinuityPedestrianSpeedThresholdMps: number;
  rawEvidenceRetentionDays: number;
  maxEvidenceItemsPerUpload: number;
};

/**
 * Initial iOS V2 profile. `distanceIntervalMeters` is Core Location's movement
 * filter, not a periodic dwell clock. Visits and geofences provide additional
 * arrival/departure anchors, while deferred updates reduce delivery frequency
 * without discarding the ordered samples in a delivered batch.
 */
export const LOCATION_ENGINE_V2_CONFIG: LocationEngineConfig = {
  algorithmVersion: "location-v2.0",
  distanceIntervalMeters: 75,
  deferredUpdatesDistanceMeters: 200,
  deferredUpdatesIntervalMs: 300_000,
  deferredTimeoutMs: 300_000,
  pausesUpdatesAutomatically: false,
  maxAcceptedHorizontalAccuracyMeters: 200,
  highQualityHorizontalAccuracyMeters: 65,
  maxAccuracyAllowanceMeters: 60,
  unknownStayBaseRadiusMeters: 120,
  maxContinuityGapMs: 720_000,
  segmentFinalisationLagMs: 600_000,
  savedPlaceMinimumDwellMs: 300_000,
  unknownStayCandidateDwellMs: 600_000,
  unknownStayReviewDwellMs: 1_200_000,
  minimumGpsSamplesForUnanchoredStay: 3,
  outsideConfirmationCount: 2,
  movementSpeedThresholdMps: 1.5,
  movementDisplacementThresholdMeters: 150,
  commuteMinimumDurationMs: 180_000,
  commuteMaximumDurationMs: 21_600_000,
  commuteMinimumEndpointDistanceMeters: 800,
  commuteLocalMovementMaximumEndpointDistanceMeters: 450,
  commuteMinimumRouteDistanceMeters: 1_200,
  commuteMinimumRouteEfficiency: 0.25,
  commuteFasterMovementThresholdMps: 2.8,
  commuteMinimumReliableSpeedSamples: 3,
  commuteMaximumSpeedAccuracyMeters: 65,
  commuteSamePlaceMinimumRouteDistanceMeters: 1_800,
  commuteSamePlaceMinimumExcursionMeters: 650,
  commuteSamePlaceMinimumRouteSamples: 3,
  visitContinuityMaximumEndpointDistanceMeters: 450,
  visitContinuityMaximumTransitionMs: 2_700_000,
  visitContinuityMaximumRouteDistanceMeters: 1_200,
  visitContinuityPedestrianSpeedThresholdMps: 2.5,
  rawEvidenceRetentionDays: 7,
  maxEvidenceItemsPerUpload: 100
};
