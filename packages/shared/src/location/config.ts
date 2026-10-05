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
  savedPlaceExitReentryGraceMs: number;
  savedPlaceQuietGapMaxMs: number;
  savedPlaceOpenVisitPresenceMaximumMs: number;
  savedPlaceVisitDepartureLagMaximumMs: number;
  savedPlaceArrivalCorroborationWindowMs: number;
  savedPlaceArrivalMinimumStrongPointCount: number;
  savedArrivalWitnessMinimumSpanMs: number;
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
  sparseUnknownContinuityMaximumGapMs: number;
  sparseUnknownContinuityMaximumDistanceMeters: number;
  physicalStopRadiusMeters: number;
  physicalStopMinimumDurationMs: number;
  physicalStopMinimumSlowSpreadMs: number;
  physicalStopUnanchoredMinimumSlowSamples: number;
  physicalStopUnanchoredMinimumSlowSpreadMs: number;
  physicalStopBoundaryWindowMs: number;
  physicalStopVisitCarriedMinimumMs: number;
  physicalStopVisitDepartureLagMaximumMs: number;
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
  savedPlaceExitReentryGraceMs: 300_000,
  savedPlaceQuietGapMaxMs: 1_800_000,
  // A corroborated arrival-only Visit at a saved place means iOS saw the device
  // arrive. A still phone records nothing, so presence continues through silence
  // to the next same-place observation (or to processing time for an open stay),
  // but never past contradicting evidence, never past the departure iOS later
  // reports for that Visit, and never longer than this cap.
  savedPlaceOpenVisitPresenceMaximumMs: 64_800_000,
  // iOS reports a Visit's departure shortly after the device leaves (about a
  // minute after the geofence exit on 3 Oct). Without a corroborated arrival,
  // whose presence already reaches the departure evidence, a completed
  // saved-place Visit ending no later than this after the earliest departure
  // evidence keeps presence up to that evidence. A longer overrun means the
  // Visit is contradicted, and the ordinary midpoint estimate applies.
  savedPlaceVisitDepartureLagMaximumMs: 300_000,
  savedPlaceArrivalCorroborationWindowMs: 300_000,
  savedPlaceArrivalMinimumStrongPointCount: 2,
  savedArrivalWitnessMinimumSpanMs: 120_000,
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
  // Core Location commonly goes quiet during a stationary visit. Two parts of
  // the same tight unknown cluster may bridge this bounded quiet period only
  // when there is no contradictory route/place evidence between them.
  sparseUnknownContinuityMaximumGapMs: 3_600_000,
  sparseUnknownContinuityMaximumDistanceMeters: 120,
  // Physical stops exist independently of place identity or Review eligibility.
  // A stop needs accurate slow fixes spread over time plus observed movement on
  // both sides. A native Visit can corroborate but never sets duration alone:
  // iOS reported 5–7 minute Visits for owner-confirmed 30–60 second drop-offs.
  physicalStopRadiusMeters: 100,
  physicalStopMinimumDurationMs: 180_000,
  physicalStopMinimumSlowSpreadMs: 60_000,
  physicalStopUnanchoredMinimumSlowSamples: 3,
  physicalStopUnanchoredMinimumSlowSpreadMs: 180_000,
  physicalStopBoundaryWindowMs: 900_000,
  // A parked phone records one fix and then nothing until it moves. A compatible
  // completed Visit spanning that fix can carry the stop through the silence
  // when the observed departure falls within this lag of the Visit's reported
  // departure, and the Visit lasted long enough that iOS's overstatement of
  // brief stops (5–7 minutes for owner-labelled drop-offs) cannot explain it.
  // A geofence crossing inside the silence means the device moved, so the
  // silence is not carried.
  physicalStopVisitCarriedMinimumMs: 600_000,
  physicalStopVisitDepartureLagMaximumMs: 300_000,
  rawEvidenceRetentionDays: 7,
  maxEvidenceItemsPerUpload: 100
};
