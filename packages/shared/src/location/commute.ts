import { distanceMeters, stableLocationId } from "./geo";
import type { LocationEngineConfig } from "./config";
import {
  crossesUnsupportedSavedPlaceArrivalWitness,
  type SavedPlaceArrivalWitness
} from "./savedPlaceArrivalSupport";
import type {
  ClassifiedEvidence,
  CommuteEvidenceSummary,
  CommuteQualification,
  CommuteSegment,
  StaySegment,
  SavedPlaceForMatching
} from "./types";

type Point = { latitude: number; longitude: number };

function segmentPoint(segment: StaySegment): Point | null {
  if (segment.centreLatitude == null || segment.centreLongitude == null) return null;
  return { latitude: segment.centreLatitude, longitude: segment.centreLongitude };
}

function evidencePoint(item: ClassifiedEvidence): Point | null {
  const { latitude, longitude } = item.evidence;
  return latitude == null || longitude == null ? null : { latitude, longitude };
}

function evidenceMatchesStay(item: ClassifiedEvidence, stay: StaySegment) {
  if (stay.placeId) {
    return item.evidence.savedPlaceId === stay.placeId ||
      item.match?.kind === "saved" && item.match.placeId === stay.placeId;
  }
  if (stay.learnedPlaceId) {
    return item.match?.kind === "learned" && item.match.placeId === stay.learnedPlaceId;
  }
  return false;
}

function sameKnownEndpoint(from: StaySegment, to: StaySegment) {
  return Boolean(
    from.placeMatchKind !== "unknown" &&
    to.placeMatchKind !== "unknown" &&
    (
      from.placeId && from.placeId === to.placeId ||
      from.learnedPlaceId && from.learnedPlaceId === to.learnedPlaceId
    )
  );
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function routeDistance(points: Point[]) {
  let distance = 0;
  for (let index = 1; index < points.length; index += 1) {
    distance += distanceMeters(points[index - 1], points[index]);
  }
  return distance;
}

export function summariseCommuteEvidence({
  config,
  from,
  routeEvidence,
  startedAtMs,
  stoppedAtMs,
  to
}: {
  config: LocationEngineConfig;
  from: StaySegment;
  routeEvidence: ClassifiedEvidence[];
  startedAtMs: number;
  stoppedAtMs: number;
  to: StaySegment;
}): CommuteEvidenceSummary {
  const fromPoint = segmentPoint(from);
  const toPoint = segmentPoint(to);
  const routePoints = routeEvidence.flatMap((item) => {
    const point = evidencePoint(item);
    return point ? [point] : [];
  });
  const routeWithEndpoints = routeEvidence.length >= 2
    ? [
        ...(fromPoint ? [fromPoint] : []),
        ...routePoints,
        ...(toPoint ? [toPoint] : [])
      ]
    : [];
  const measuredRouteDistance = routeWithEndpoints.length >= 2
    ? routeDistance(routeWithEndpoints)
    : null;
  const straightLineDistance = fromPoint && toPoint
    ? distanceMeters(fromPoint, toPoint)
    : null;
  const speedBearing = routeEvidence.flatMap((item) => {
    const speed = item.evidence.speedMetersPerSecond ?? item.impliedSpeedMetersPerSecond;
    return speed != null && Number.isFinite(speed) && speed >= 0 ? [{ item, speed }] : [];
  });
  const credibleSpeeds = speedBearing.filter(({ item }) =>
    item.evidence.horizontalAccuracyMeters == null ||
    item.evidence.horizontalAccuracyMeters <= config.commuteMaximumSpeedAccuracyMeters
  );
  const credibleSpeedValues = credibleSpeeds.map(({ speed }) => speed);
  const credibleFasterSampleCount = credibleSpeedValues.filter(
    (speed) => speed >= config.commuteFasterMovementThresholdMps
  ).length;
  const observedTimes = [
    startedAtMs,
    ...routeEvidence.map((item) => Date.parse(item.evidence.occurredAt)),
    stoppedAtMs
  ].filter(Number.isFinite).sort((a, b) => a - b);
  let maximumObservationGapMs = 0;
  for (let index = 1; index < observedTimes.length; index += 1) {
    maximumObservationGapMs = Math.max(
      maximumObservationGapMs,
      observedTimes[index] - observedTimes[index - 1]
    );
  }
  const maximumDisplacementFromOrigin = fromPoint && routePoints.length
    ? Math.max(...routePoints.map((point) => distanceMeters(fromPoint, point)))
    : null;

  return {
    routeSampleCount: routeEvidence.length,
    speedBearingSampleCount: speedBearing.length,
    credibleSpeedSampleCount: credibleSpeedValues.length,
    credibleFasterSampleCount,
    medianSpeedMetersPerSecond: percentile(credibleSpeedValues, 0.5),
    upperQuartileSpeedMetersPerSecond: percentile(credibleSpeedValues, 0.75),
    routeDistanceMeters: measuredRouteDistance,
    straightLineDistanceMeters: straightLineDistance,
    routeEfficiency:
      measuredRouteDistance && straightLineDistance != null
        ? straightLineDistance / measuredRouteDistance
        : null,
    maximumDisplacementFromOriginMeters: maximumDisplacementFromOrigin,
    // Persisted max_gap_seconds is integral. Round upward so a gap just beyond
    // the continuity ceiling cannot become eligible through rounding.
    maximumObservationGapSeconds: Math.ceil(maximumObservationGapMs / 1_000),
    // A real round trip can return to the same physical place even when that
    // place has not been saved or learned yet. Keep the existing identity
    // match, but also recognise endpoints whose centres are effectively
    // co-located. Qualification below still requires a substantial sampled
    // route, excursion, and credible faster movement.
    sameKnownPlace:
      sameKnownEndpoint(from, to) ||
      (straightLineDistance != null &&
        straightLineDistance <= config.commuteLocalMovementMaximumEndpointDistanceMeters),
    strongEndpoints: from.placeMatchKind !== "unknown" && to.placeMatchKind !== "unknown",
    hasCredibleFasterMovement:
      credibleFasterSampleCount >= config.commuteMinimumReliableSpeedSamples
  };
}

export function qualifyCommuteCandidate(
  summary: CommuteEvidenceSummary,
  config: LocationEngineConfig
): CommuteQualification {
  const endpointDistance = summary.straightLineDistanceMeters;
  const routeDistanceMeters = summary.routeDistanceMeters;

  if (summary.sameKnownPlace) {
    if (
      summary.routeSampleCount < config.commuteSamePlaceMinimumRouteSamples ||
      routeDistanceMeters == null ||
      routeDistanceMeters < config.commuteSamePlaceMinimumRouteDistanceMeters
    ) {
      return { qualifies: false, reason: "same_place_insufficient_route" };
    }
    if (
      summary.maximumDisplacementFromOriginMeters == null ||
      summary.maximumDisplacementFromOriginMeters < config.commuteSamePlaceMinimumExcursionMeters
    ) {
      return { qualifies: false, reason: "looping_local_movement" };
    }
    if (!summary.hasCredibleFasterMovement) {
      return { qualifies: false, reason: "local_pedestrian_movement" };
    }
    return {
      qualifies: true,
      reason: "same_place_meaningful_round_trip",
      confidence: summary.maximumObservationGapSeconds * 1_000 <= config.maxContinuityGapMs
        ? "medium_high"
        : "medium"
    };
  }

  if (endpointDistance != null && endpointDistance >= config.commuteMinimumEndpointDistanceMeters) {
    if (summary.routeSampleCount === 0) {
      // Widely separated endpoint observations prove only that the device was
      // later somewhere else. Without a departure or route observation, V2
      // must not fabricate the missing journey.
      return { qualifies: false, reason: "insufficient_evidence" };
    }
    const continuous =
      summary.maximumObservationGapSeconds * 1_000 <= config.maxContinuityGapMs;
    return {
      qualifies: true,
      reason: "significant_endpoint_displacement",
      confidence:
        summary.strongEndpoints && summary.routeSampleCount >= 2 && continuous
          ? summary.hasCredibleFasterMovement ? "medium_high" : "medium"
          : "low"
    };
  }

  if (endpointDistance == null) {
    return { qualifies: false, reason: "insufficient_evidence" };
  }
  if (endpointDistance < config.commuteLocalMovementMaximumEndpointDistanceMeters) {
    if (
      routeDistanceMeters != null &&
      routeDistanceMeters >= config.commuteMinimumRouteDistanceMeters &&
      (summary.routeEfficiency ?? 0) < config.commuteMinimumRouteEfficiency
    ) {
      return { qualifies: false, reason: "looping_local_movement" };
    }
    return {
      qualifies: false,
      reason: summary.hasCredibleFasterMovement
        ? "insufficient_displacement"
        : "local_pedestrian_movement"
    };
  }
  if (
    routeDistanceMeters != null &&
    routeDistanceMeters >= config.commuteMinimumRouteDistanceMeters &&
    (summary.routeEfficiency ?? 0) >= config.commuteMinimumRouteEfficiency
  ) {
    return {
      qualifies: true,
      reason: "significant_route_distance",
      confidence:
        summary.strongEndpoints &&
        summary.routeSampleCount >= 2 &&
        summary.maximumObservationGapSeconds * 1_000 <= config.maxContinuityGapMs
          ? "medium"
          : "low"
    };
  }
  return { qualifies: false, reason: "insufficient_displacement" };
}

// Exception-only proof. Do not change ordinary route summaries/confidence or
// rewrite journal identity. Native mirrored callbacks can lose subsecond time;
// repeated exact device/coordinate points therefore never add independent proof.
function shortJourneyProof(
  evidence: ClassifiedEvidence[],
  config: LocationEngineConfig,
  occurredAtMs: readonly number[]
) {
  const eligible = new Set<ClassifiedEvidence>();
  let previousPoint: ClassifiedEvidence | undefined;
  const accuratePoint = (item: ClassifiedEvidence) => {
    const e = item.evidence;
    return (e.kind === "standard_location" || e.kind === "significant_change") &&
      e.isSimulated === false &&
      e.latitude != null && Number.isFinite(e.latitude) && Math.abs(e.latitude) <= 90 &&
      e.longitude != null && Number.isFinite(e.longitude) && Math.abs(e.longitude) <= 180 &&
      e.horizontalAccuracyMeters != null && Number.isFinite(e.horizontalAccuracyMeters) &&
      e.horizontalAccuracyMeters >= 0 &&
      e.horizontalAccuracyMeters <= config.commuteMaximumSpeedAccuracyMeters;
  };
  for (const [index, item] of evidence.entries()) {
    const e = item.evidence;
    const nativeSpeed = e.speedMetersPerSecond;
    const impliedSpeed = item.impliedSpeedMetersPerSecond;
    const speed = nativeSpeed ?? impliedSpeed;
    // Preprocessing's 120m/s rejection applies only to standard_location.
    // Fail closed for either speed on every source in this new exception.
    const plausible = [nativeSpeed, impliedSpeed].every(value =>
      value == null || Number.isFinite(value) && value >= 0 && value <= 120);
    const supportedSpeed = nativeSpeed != null || previousPoint != null &&
      previousPoint.evidence.deviceId === e.deviceId && accuratePoint(previousPoint);
    if (Number.isFinite(occurredAtMs[index]) && accuratePoint(item) && plausible && supportedSpeed && speed != null &&
      speed >= config.commuteFasterMovementThresholdMps) eligible.add(item);
    // Match preprocessing's previous-coordinate owner, including non-GPS
    // anchors: those may not supply implied-speed proof for this exception.
    if (e.latitude != null && e.longitude != null) previousPoint = item;
  }
  return eligible;
}

function hasIndependentShortJourneyProof(
  route: ClassifiedEvidence[],
  eligible: ReadonlySet<ClassifiedEvidence>,
  start: number,
  stop: number,
  config: LocationEngineConfig
) {
  const ids = new Set<string>();
  const times = new Set<string>();
  const points = new Set<string>();
  let count = 0;
  for (const item of route) {
    const e = item.evidence;
    const sourceTime = Date.parse(e.sourceTimestamp ?? e.occurredAt);
    if (!eligible.has(item) || !Number.isFinite(sourceTime) || sourceTime <= start || sourceTime >= stop) continue;
    const id = JSON.stringify([e.deviceId, e.clientEvidenceId]);
    const time = JSON.stringify([e.deviceId, sourceTime]);
    const point = JSON.stringify([e.deviceId, e.latitude, e.longitude]);
    const duplicate = ids.has(id) || times.has(time) || points.has(point);
    ids.add(id); times.add(time); points.add(point);
    if (!duplicate) count += 1;
  }
  return count >= config.commuteMinimumReliableSpeedSamples;
}

export type CommuteDerivationOptions = {
  inferredBoundaryStayIds?: ReadonlySet<string>;
  arrivalWitnesses?: readonly SavedPlaceArrivalWitness[];
  savedPlaces?: readonly SavedPlaceForMatching[];
};

export function deriveCommutes(
  stays: StaySegment[],
  acceptedEvidence: ClassifiedEvidence[],
  config: LocationEngineConfig,
  processingAt: string,
  options: CommuteDerivationOptions = {}
) {
  const commutes: CommuteSegment[] = [];
  // This invocation's evidence is immutable. Both per-pair scans below need
  // the same timestamps; parse once rather than twice per evidence/stay pair.
  // Keep the original array/filter order and strict endpoint comparisons.
  let shortProof: ReadonlySet<ClassifiedEvidence> | undefined;
  const occurredAtMs = acceptedEvidence.map(({ evidence }) => Date.parse(evidence.occurredAt));
  for (let index = 1; index < stays.length; index += 1) {
    const from = stays[index - 1];
    const to = stays[index];
    if (!from.stoppedAt) continue;
    const originalStartedAtMs = Date.parse(from.stoppedAt);
    const stoppedAtMs = Date.parse(to.startedAt);
    const boundaryEvidence = acceptedEvidence.filter((_item, evidenceIndex) => {
      const at = occurredAtMs[evidenceIndex];
      return at > originalStartedAtMs && at < stoppedAtMs;
    });
    const latestFromSupport = boundaryEvidence
      .filter((item) => evidenceMatchesStay(item, from))
      .at(-1);
    const startedAtMs = latestFromSupport
      ? Date.parse(latestFromSupport.evidence.occurredAt)
      : originalStartedAtMs;
    const fromHasInferredBoundary = options.inferredBoundaryStayIds?.has(from.clientSegmentId) === true;
    const toHasInferredBoundary = options.inferredBoundaryStayIds?.has(to.clientSegmentId) === true;
    const anyEndpointHasInferredBoundary = fromHasInferredBoundary || toHasInferredBoundary;
    const hasUnsupportedArrivalConflict = !toHasInferredBoundary &&
      (options.arrivalWitnesses ?? []).some((witness) =>
        options.savedPlaces && crossesUnsupportedSavedPlaceArrivalWitness({
          witness,
          from,
          to,
          acceptedEvidence,
          config,
          savedPlaces: options.savedPlaces
        })
      );
    if (hasUnsupportedArrivalConflict) continue;
    const duration = stoppedAtMs - startedAtMs;
    if (!Number.isFinite(duration) || duration <= 0 || duration > config.commuteMaximumDurationMs) {
      continue;
    }

    const routeEvidence = acceptedEvidence.filter((item, evidenceIndex) => {
      const at = occurredAtMs[evidenceIndex];
      if (at <= startedAtMs || at >= stoppedAtMs || evidencePoint(item) == null) return false;
      return !evidenceMatchesStay(item, from) && !evidenceMatchesStay(item, to);
    });
    const summary = summariseCommuteEvidence({
      config,
      from,
      routeEvidence,
      startedAtMs,
      stoppedAtMs,
      to
    });
    if (duration < config.commuteMinimumDurationMs) {
      if (summary.sameKnownPlace || summary.straightLineDistanceMeters == null ||
        summary.straightLineDistanceMeters < config.commuteMinimumEndpointDistanceMeters) continue;
      shortProof ??= shortJourneyProof(acceptedEvidence, config, occurredAtMs);
      if (!hasIndependentShortJourneyProof(routeEvidence, shortProof, startedAtMs, stoppedAtMs, config)) continue;
    }
    const qualification = qualifyCommuteCandidate(summary, config);
    if (!qualification.qualifies) continue;
    const evidenceIds = routeEvidence.map(({ evidence }) => evidence.clientEvidenceId);
    const uncertainBoundary =
      summary.routeSampleCount < 2 ||
      summary.maximumObservationGapSeconds * 1_000 > config.maxContinuityGapMs ||
      from.continuityStatus === "uncertain_gap" ||
      to.continuityStatus === "uncertain_gap";
    commutes.push({
      kind: "commute",
      clientSegmentId: stableLocationId("commute", [from.clientSegmentId, to.clientSegmentId]),
      algorithmVersion: config.algorithmVersion,
      status:
        Date.parse(processingAt) - stoppedAtMs >= config.segmentFinalisationLagMs
          ? "finalised"
          : "closed",
      startedAt: new Date(startedAtMs).toISOString(),
      stoppedAt: to.startedAt,
      startLowerBoundAt: from.stopLowerBoundAt ?? from.stoppedAt,
      startUpperBoundAt: from.stopUpperBoundAt ?? routeEvidence[0]?.evidence.occurredAt ?? from.stoppedAt,
      stopLowerBoundAt: to.startLowerBoundAt ?? to.startedAt,
      stopUpperBoundAt: to.startUpperBoundAt ?? to.startedAt,
      fromStaySegmentId: from.clientSegmentId,
      toStaySegmentId: to.clientSegmentId,
      fromPlaceId: from.placeId ?? null,
      toPlaceId: to.placeId ?? null,
      routeDistanceMeters:
        summary.routeDistanceMeters == null ? null : Math.round(summary.routeDistanceMeters),
      straightLineDistanceMeters:
        summary.straightLineDistanceMeters == null
          ? null
          : Math.round(summary.straightLineDistanceMeters),
      routeSampleCount: summary.routeSampleCount,
      gapDurationSeconds: Math.round(duration / 1_000),
      maximumObservationGapSeconds: summary.maximumObservationGapSeconds,
      continuityStatus: uncertainBoundary ? "uncertain_gap" : "continuous",
      confidence: anyEndpointHasInferredBoundary
        ? "low"
        : uncertainBoundary && qualification.confidence === "medium_high"
          ? "medium"
          : qualification.confidence,
      qualificationReason: qualification.reason,
      evidenceIds
    });
  }
  return commutes;
}
