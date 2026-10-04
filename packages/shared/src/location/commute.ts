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
  CommuteStop,
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

type RoundTripBounds = {
  /** The last evidence at the place before the final excursion left; null when none precedes it in the gap. */
  departure: ClassifiedEvidence | null;
  /** The first evidence back at the place after the excursion's last far fix (never a Visit), if observed. */
  returnedAtMs: number | null;
  /** The latest evidence away from the place before that return. */
  lastAwayMs: number | null;
};

/**
 * A same-place round trip's observed departure and return. An excursion starts
 * at its first accurate standard/significant fix at least the round-trip
 * excursion minimum from the place; Visits (backdated arrivals, averaged
 * completions) and broad fixes never set it. Genuine presence back at the
 * place ends an excursion, so a later departure starts a new one: a still
 * accurate fix there, or evidence there at least `savedPlaceMinimumDwellMs`
 * apart with nothing away in between. A moving pass-by, geofence callbacks and
 * Visits do not. Null when the gap has no far fix, which leaves the ordinary
 * rule in place.
 */
function roundTripBounds(stay: StaySegment, evidence: ClassifiedEvidence[], config: LocationEngineConfig): RoundTripBounds | null {
  const centre = segmentPoint(stay);
  if (!centre) return null;
  const accurateFix = (item: ClassifiedEvidence) => {
    const { kind, horizontalAccuracyMeters } = item.evidence;
    return evidencePoint(item) != null && (kind === "standard_location" || kind === "significant_change") &&
      horizontalAccuracyMeters != null && horizontalAccuracyMeters <= config.highQualityHorizontalAccuracyMeters;
  };
  const still = (item: ClassifiedEvidence) => {
    const speed = item.evidence.speedMetersPerSecond ?? item.impliedSpeedMetersPerSecond;
    return accurateFix(item) && (speed == null || !Number.isFinite(speed) || speed < config.movementSpeedThresholdMps);
  };
  let support: ClassifiedEvidence | null = null;
  let departure: ClassifiedEvidence | null | undefined;
  let inExcursion = false;
  let backSinceMs: number | null = null;
  let lastFarMs: number | null = null;
  for (const item of evidence) {
    const atMs = Date.parse(item.evidence.occurredAt);
    if (evidenceMatchesStay(item, stay)) {
      if (!inExcursion) {
        support = item;
        continue;
      }
      if (item.evidence.kind === "visit") continue;
      backSinceMs ??= atMs;
      if (still(item) || atMs - backSinceMs >= config.savedPlaceMinimumDwellMs) {
        inExcursion = false;
        backSinceMs = null;
        support = item;
      }
      continue;
    }
    if (!accurateFix(item)) continue;
    backSinceMs = null;
    if (distanceMeters(centre, evidencePoint(item)!) < config.commuteSamePlaceMinimumExcursionMeters) continue;
    if (!inExcursion) {
      inExcursion = true;
      departure = support;
    }
    lastFarMs = atMs;
  }
  if (lastFarMs == null) return null;
  const farMs = lastFarMs;
  const returned = evidence.find((item) => Date.parse(item.evidence.occurredAt) > farMs && item.evidence.kind !== "visit" &&
    evidenceMatchesStay(item, stay));
  const returnedAtMs = returned ? Date.parse(returned.evidence.occurredAt) : null;
  const lastAway = returnedAtMs == null ? null : evidence.filter((item) => Date.parse(item.evidence.occurredAt) < returnedAtMs &&
    evidencePoint(item) != null && !evidenceMatchesStay(item, stay)).at(-1);
  return {
    departure: departure ?? null,
    returnedAtMs,
    lastAwayMs: lastAway ? Date.parse(lastAway.evidence.occurredAt) : null
  };
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

/** Longest part of [from, to] not covered by any observed stop interval. */
export function longestUnobservedMs(from: number, to: number, observed: ReadonlyArray<readonly [number, number]>) {
  let pieces: Array<[number, number]> = [[from, to]];
  for (const [start, stop] of observed) {
    pieces = pieces.flatMap(([pieceStart, pieceStop]): Array<[number, number]> => [
      ...(start > pieceStart ? [[pieceStart, Math.min(pieceStop, start)] as [number, number]] : []),
      ...(stop < pieceStop ? [[Math.max(pieceStart, stop), pieceStop] as [number, number]] : [])
    ].filter(([a, b]) => b > a));
  }
  return pieces.reduce((longest, [a, b]) => Math.max(longest, b - a), 0);
}

export function summariseCommuteEvidence({
  config,
  from,
  routeEvidence,
  startedAtMs,
  stoppedAtMs,
  to,
  stops = []
}: {
  config: LocationEngineConfig;
  from: StaySegment;
  routeEvidence: ClassifiedEvidence[];
  startedAtMs: number;
  stoppedAtMs: number;
  to: StaySegment;
  /** Observed stops inside the trip: route waypoints whose interval is observed, not a gap. */
  stops?: readonly StaySegment[];
}): CommuteEvidenceSummary {
  const fromPoint = segmentPoint(from);
  const toPoint = segmentPoint(to);
  const timedPoints = [
    ...routeEvidence.flatMap((item) => {
      const point = evidencePoint(item);
      return point ? [{ at: Date.parse(item.evidence.occurredAt), point }] : [];
    }),
    ...stops.flatMap((stop) => {
      const point = segmentPoint(stop);
      return point ? [{ at: Date.parse(stop.startedAt), point }] : [];
    })
  ].sort((a, b) => a.at - b.at);
  const routePoints = timedPoints.map(({ point }) => point);
  const routeWithEndpoints = routeEvidence.length + stops.length >= 2
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
    ...stops.flatMap((stop) => [Date.parse(stop.startedAt), Date.parse(stop.stoppedAt ?? stop.startedAt)]),
    stoppedAtMs
  ].filter(Number.isFinite).sort((a, b) => a - b);
  // A recorded stop is observed by its own stay: its interval is not a route gap.
  const stopIntervals = stops.flatMap((stop) => {
    const from = Date.parse(stop.startedAt);
    const to = Date.parse(stop.stoppedAt ?? stop.startedAt);
    return Number.isFinite(from) && Number.isFinite(to) && to > from ? [[from, to] as const] : [];
  });
  let maximumObservationGapMs = 0;
  for (let index = 1; index < observedTimes.length; index += 1) {
    maximumObservationGapMs = Math.max(
      maximumObservationGapMs,
      longestUnobservedMs(observedTimes[index - 1], observedTimes[index], stopIntervals)
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
  /** Short stops between the given stays; their evidence is not route evidence. */
  interiorStops?: readonly StaySegment[];
  /**
   * Lowest confidence of a complete chain of already-qualified legs joining
   * these stays through interior stops, or null when no such chain exists.
   */
  qualifiedLegChainConfidence?: (fromStayId: string, toStayId: string) => CommuteSegment["confidence"] | null;
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
    const gapEndMs = Date.parse(to.startedAt);
    const boundaryEvidence = acceptedEvidence.filter((_item, evidenceIndex) => {
      const at = occurredAtMs[evidenceIndex];
      return at > originalStartedAtMs && at < gapEndMs;
    });
    // A round trip runs from its observed departure to its observed return
    // (roundTripBounds). Evidence at the place after the departure belongs to
    // a pass by it or to the return: iOS often dates the return's arrival
    // Visit before the stay it starts, which the stay may begin later still.
    const roundTrip = sameKnownEndpoint(from, to) ? roundTripBounds(from, boundaryEvidence, config) : null;
    const latestFromSupport = roundTrip
      ? roundTrip.departure ?? undefined
      : boundaryEvidence.filter((item) => evidenceMatchesStay(item, from)).at(-1);
    const returnedEarly = roundTrip?.returnedAtMs != null && roundTrip.returnedAtMs < gapEndMs;
    const stoppedAtMs = returnedEarly ? roundTrip!.returnedAtMs! : gapEndMs;
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

    const stops = (options.interiorStops ?? []).filter((stop) => stop.stoppedAt != null &&
      Date.parse(stop.startedAt) >= startedAtMs && Date.parse(stop.stoppedAt) <= stoppedAtMs);
    const stopEvidenceIds = new Set(stops.flatMap((stop) => stop.evidenceIds));
    const routeEvidence = acceptedEvidence.filter((item, evidenceIndex) => {
      const at = occurredAtMs[evidenceIndex];
      if (at <= startedAtMs || at >= stoppedAtMs || evidencePoint(item) == null) return false;
      if (stopEvidenceIds.has(item.evidence.clientEvidenceId)) return false;
      return !evidenceMatchesStay(item, from) && !evidenceMatchesStay(item, to);
    });
    // Every portion of a trip through stops needs its own movement evidence;
    // otherwise unobserved time either side of a stop would be claimed as travel.
    if (stops.length && !everyPortionShowsMovement(from, to, stops, routeEvidence, startedAtMs, stoppedAtMs, config)) continue;
    const summary = summariseCommuteEvidence({
      config,
      from,
      routeEvidence,
      startedAtMs,
      stoppedAtMs,
      to,
      stops
    });
    if (duration < config.commuteMinimumDurationMs) {
      if (summary.sameKnownPlace || summary.straightLineDistanceMeters == null ||
        summary.straightLineDistanceMeters < config.commuteMinimumEndpointDistanceMeters) continue;
      shortProof ??= shortJourneyProof(acceptedEvidence, config, occurredAtMs);
      if (!hasIndependentShortJourneyProof(routeEvidence, shortProof, startedAtMs, stoppedAtMs, config)) continue;
    }
    let qualification = qualifyCommuteCandidate(summary, config);
    // Each leg already proved a real journey to or from a recorded stop; the
    // whole trip through those stops is therefore real even when the combined
    // route is shorter than the same-place round-trip minimum.
    const chainConfidence = !qualification.qualifies && stops.length
      ? options.qualifiedLegChainConfidence?.(from.clientSegmentId, to.clientSegmentId) ?? null
      : null;
    if (chainConfidence) {
      qualification = {
        qualifies: true,
        reason: summary.sameKnownPlace ? "same_place_meaningful_round_trip" : "significant_route_distance",
        confidence: chainConfidence
      };
    }
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
      stoppedAt: returnedEarly ? new Date(stoppedAtMs).toISOString() : to.startedAt,
      startLowerBoundAt: from.stopLowerBoundAt ?? from.stoppedAt,
      startUpperBoundAt: from.stopUpperBoundAt ?? routeEvidence[0]?.evidence.occurredAt ?? from.stoppedAt,
      stopLowerBoundAt: returnedEarly
        ? new Date(roundTrip!.lastAwayMs ?? stoppedAtMs).toISOString()
        : to.startLowerBoundAt ?? to.startedAt,
      stopUpperBoundAt: returnedEarly ? new Date(stoppedAtMs).toISOString() : to.startUpperBoundAt ?? to.startedAt,
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
      ...(stops.length ? { stops: stops.map(stopFromStay) } : {}),
      evidenceIds
    });
  }
  return commutes;
}

function everyPortionShowsMovement(
  from: StaySegment,
  to: StaySegment,
  stops: readonly StaySegment[],
  routeEvidence: readonly ClassifiedEvidence[],
  startedAtMs: number,
  stoppedAtMs: number,
  config: LocationEngineConfig
) {
  const ordered = [...stops].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const anchors = [from, ...ordered, to];
  const bounds = [startedAtMs, ...ordered.flatMap((stop) => [Date.parse(stop.startedAt), Date.parse(stop.stoppedAt!)]), stoppedAtMs];
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const portionStart = bounds[index * 2];
    const portionStop = bounds[index * 2 + 1];
    const ends = [segmentPoint(anchors[index]), segmentPoint(anchors[index + 1])];
    const moving = routeEvidence.some((item) => {
      const at = Date.parse(item.evidence.occurredAt);
      if (at < portionStart || at > portionStop) return false;
      const accuracy = item.evidence.horizontalAccuracyMeters;
      if (accuracy == null || accuracy > config.commuteMaximumSpeedAccuracyMeters) return false;
      const speed = item.evidence.speedMetersPerSecond ?? item.impliedSpeedMetersPerSecond;
      if (speed != null && speed >= config.movementSpeedThresholdMps) return true;
      const point = evidencePoint(item);
      return point != null && ends.every((end) => end != null &&
        distanceMeters(end, point) >= config.movementDisplacementThresholdMeters);
    });
    if (!moving) return false;
  }
  return true;
}

function stopFromStay(stay: StaySegment): CommuteStop {
  return {
    staySegmentId: stay.clientSegmentId,
    startedAt: stay.startedAt,
    stoppedAt: stay.stoppedAt!,
    startLowerBoundAt: stay.startLowerBoundAt ?? null,
    startUpperBoundAt: stay.startUpperBoundAt ?? null,
    stopLowerBoundAt: stay.stopLowerBoundAt ?? null,
    stopUpperBoundAt: stay.stopUpperBoundAt ?? null,
    candidatePlaceIds: stay.candidatePlaceIds
  };
}

/**
 * Time tracking records a short errand as one trip. A trip is derived directly
 * between the stays either side of unknown stops shorter than the visit Review
 * threshold, with those stops as observed waypoints, so the whole trip
 * qualifies even when its legs would not. Each trip keeps its qualified legs
 * (never persisted) so replay can fall back to them when protected history
 * blocks the trip. Pairs whose trip does not qualify keep their legs, and
 * saved/learned or visit-length stops still split journeys.
 */
export function assembleTripsThroughStops(
  legs: CommuteSegment[],
  stays: StaySegment[],
  acceptedEvidence: ClassifiedEvidence[],
  config: LocationEngineConfig,
  processingAt: string,
  options: CommuteDerivationOptions = {}
) {
  const minorStop = (stay: StaySegment) => stay.placeMatchKind === "unknown" && stay.stoppedAt != null &&
    Date.parse(stay.stoppedAt) - Date.parse(stay.startedAt) < config.unknownStayReviewDwellMs;
  const interiorStops = stays.filter(minorStop);
  if (!interiorStops.length) return legs;
  const majors = stays.filter((stay) => !minorStop(stay));
  const interiorIds = new Set(interiorStops.map((stay) => stay.clientSegmentId));
  const order: CommuteSegment["confidence"][] = ["low", "medium", "medium_high", "high"];
  const qualifiedLegChainConfidence = (fromStayId: string, toStayId: string) => {
    let current = fromStayId;
    let confidence: CommuteSegment["confidence"] | null = null;
    for (let hops = 0; hops <= interiorStops.length; hops += 1) {
      const leg = legs.find((candidate) => candidate.fromStaySegmentId === current);
      if (!leg) return null;
      confidence = confidence == null || order.indexOf(leg.confidence) < order.indexOf(confidence) ? leg.confidence : confidence;
      if (leg.toStaySegmentId === toStayId) return confidence;
      if (!interiorIds.has(leg.toStaySegmentId)) return null;
      current = leg.toStaySegmentId;
    }
    return null;
  };
  const trips = deriveCommutes(majors, acceptedEvidence, config, processingAt, {
    ...options, interiorStops, qualifiedLegChainConfidence
  }).filter((trip) => trip.stops?.length);
  const within = (leg: CommuteSegment, trip: CommuteSegment) =>
    Date.parse(leg.startedAt) >= Date.parse(trip.startedAt) && Date.parse(leg.stoppedAt) <= Date.parse(trip.stoppedAt);
  const result = [
    ...legs.filter((leg) => !trips.some((trip) => within(leg, trip))),
    ...trips.map((trip) => {
      const tripLegs = legs.filter((leg) => within(leg, trip));
      return tripLegs.length ? { ...trip, legs: tripLegs } : trip;
    })
  ];
  return result.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}
