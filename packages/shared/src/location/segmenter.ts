import { deriveCommutes } from "./commute";
import { accuracyWeightedCentre, distanceMeters, midpointTimeIso, stableLocationId } from "./geo";
import { matchLocationToPlaces } from "./placeMatcher";
import type {
  ClassifiedEvidence,
  ContinuityStatus,
  LocationEngineInput,
  LocationEngineOutput,
  LocationEvidence,
  PlaceMatch,
  RejectedEvidence,
  StaySegment
} from "./types";

const SOURCE_PRECEDENCE: Record<LocationEvidence["kind"], number> = {
  visit: 0,
  geofence_exit: 1,
  geofence_enter: 2,
  geofence_state: 3,
  significant_change: 4,
  standard_location: 5,
  location_resumed: 6,
  location_paused: 7,
  provider_status: 8
};

type WorkingStay = {
  key: string;
  placeMatchKind: StaySegment["placeMatchKind"];
  placeId: string | null;
  learnedPlaceId: string | null;
  candidatePlaceIds: string[];
  evidence: ClassifiedEvidence[];
  startedAt: string;
  stoppedAt: string | null;
  startLowerBoundAt: string | null;
  startUpperBoundAt: string | null;
  stopLowerBoundAt: string | null;
  stopUpperBoundAt: string | null;
  continuityStatus: ContinuityStatus;
  outside: ClassifiedEvidence[];
  supportedByVisit: boolean;
  visitSupportUntilAt: string | null;
};

function pointFor(evidence: LocationEvidence) {
  return evidence.latitude == null || evidence.longitude == null
    ? null
    : { latitude: evidence.latitude, longitude: evidence.longitude };
}

function matchKey(match: PlaceMatch | null, evidence: LocationEvidence) {
  if (evidence.savedPlaceId) return `saved:${evidence.savedPlaceId}`;
  if (!match || match.kind === "unknown") return "unknown";
  if (match.kind === "ambiguous") {
    return `ambiguous:${match.candidates.map((candidate) => candidate.id).sort().join(",")}`;
  }
  return `${match.kind}:${match.placeId}`;
}

function matchingActive(match: PlaceMatch | null, active: WorkingStay) {
  if (!match) return false;
  if (active.placeId && match.kind === "ambiguous") {
    return match.candidates.some((candidate) => candidate.id === active.placeId);
  }
  if ((match.kind === "saved" || match.kind === "learned") && match.placeId) {
    return `${match.kind}:${match.placeId}` === active.key;
  }
  return match.kind === "unknown" && active.key === "unknown";
}

function makeWorkingStay(item: ClassifiedEvidence): WorkingStay {
  const { evidence, match } = item;
  const kind = match?.kind ?? "unknown";
  return {
    key: matchKey(match, evidence),
    placeMatchKind: kind,
    placeId: kind === "saved" ? match?.placeId ?? evidence.savedPlaceId ?? null : evidence.savedPlaceId ?? null,
    learnedPlaceId: kind === "learned" ? match?.placeId ?? null : null,
    candidatePlaceIds: match?.candidates.filter((candidate) => candidate.matchClass !== "outside").map((candidate) => candidate.id) ?? [],
    evidence: [item],
    startedAt: evidence.occurredAt,
    stoppedAt: evidence.kind === "visit" && evidence.endedAt ? evidence.endedAt : null,
    startLowerBoundAt: evidence.occurredAt,
    startUpperBoundAt: evidence.occurredAt,
    stopLowerBoundAt: evidence.endedAt ?? null,
    stopUpperBoundAt: evidence.endedAt ?? null,
    continuityStatus: evidence.kind === "visit" ? "supported_by_visit" : "continuous",
    outside: [],
    supportedByVisit: evidence.kind === "visit",
    visitSupportUntilAt: evidence.kind === "visit" ? evidence.endedAt ?? null : null
  };
}

function evidenceCentre(items: ClassifiedEvidence[]) {
  return accuracyWeightedCentre(
    items.flatMap(({ evidence }) => {
      const point = pointFor(evidence);
      return point ? [{ ...point, accuracyMeters: evidence.horizontalAccuracyMeters }] : [];
    })
  );
}

function sameUnknownCluster(active: WorkingStay, item: ClassifiedEvidence, radius: number) {
  const centre = evidenceCentre(active.evidence);
  const point = pointFor(item.evidence);
  return Boolean(centre && point && distanceMeters(centre, point) <= radius);
}

function hasPairedGeofenceEnter(
  items: ClassifiedEvidence[],
  exit: LocationEvidence,
  toleranceMs = 5_000
) {
  if (!exit.savedPlaceId) return false;
  const exitAt = Date.parse(exit.occurredAt);
  return items.some(({ evidence }) =>
    evidence.kind === "geofence_enter" &&
    evidence.savedPlaceId === exit.savedPlaceId &&
    Math.abs(Date.parse(evidence.occurredAt) - exitAt) <= toleranceMs
  );
}

function closeAtTransition(
  active: WorkingStay,
  nextAt: string,
  continuityStatus: ContinuityStatus,
  exact = false,
  respectVisitSupport = false
) {
  const lastEvidence = active.evidence.at(-1)?.evidence;
  let lastAt = lastEvidence?.endedAt && Date.parse(lastEvidence.endedAt) <= Date.parse(nextAt)
    ? lastEvidence.endedAt
    : lastEvidence?.occurredAt ?? active.startedAt;
  if (
    respectVisitSupport &&
    active.visitSupportUntilAt &&
    Date.parse(active.visitSupportUntilAt) <= Date.parse(nextAt) &&
    Date.parse(active.visitSupportUntilAt) > Date.parse(lastAt)
  ) {
    lastAt = active.visitSupportUntilAt;
  }
  active.stoppedAt = exact ? lastAt : midpointTimeIso(lastAt, nextAt);
  active.stopLowerBoundAt = lastAt;
  active.stopUpperBoundAt = nextAt;
  active.continuityStatus = continuityStatus;
}

function stayFromWorking(
  working: WorkingStay,
  processingAt: string,
  input: LocationEngineInput
): StaySegment | null {
  const endedAt = working.stoppedAt;
  const duration = Date.parse(endedAt ?? processingAt) - Date.parse(working.startedAt);
  const coordinateEvidence = working.evidence.filter(({ evidence }) => pointFor(evidence));
  const knownPlace = working.placeMatchKind === "saved" || working.placeMatchKind === "learned";
  const completedVisit = working.evidence.some(
    ({ evidence }) => evidence.kind === "visit" && evidence.endedAt && Date.parse(evidence.endedAt) > Date.parse(evidence.occurredAt)
  );
  const promotable = knownPlace
    ? duration >= input.config.savedPlaceMinimumDwellMs || completedVisit
    : duration >= input.config.unknownStayCandidateDwellMs &&
      (coordinateEvidence.length >= input.config.minimumGpsSamplesForUnanchoredStay || completedVisit);
  if (!promotable || (endedAt && Date.parse(endedAt) <= Date.parse(working.startedAt))) return null;

  const centre = evidenceCentre(working.evidence);
  const evidenceIds = working.evidence.map(({ evidence }) => evidence.clientEvidenceId);
  const firstEvidenceId = evidenceIds[0];
  const lastEvidenceId = evidenceIds.at(-1)!;
  const simulated = working.evidence.some(({ evidence }) => evidence.isSimulated);
  const highQualityCount = working.evidence.filter(
    ({ evidence }) =>
      evidence.horizontalAccuracyMeters != null &&
      evidence.horizontalAccuracyMeters <= input.config.highQualityHorizontalAccuracyMeters
  ).length;
  const confidence = simulated
    ? "low"
    : working.supportedByVisit || knownPlace
      ? highQualityCount > 0
        ? "medium_high"
        : "medium"
      : highQualityCount >= input.config.minimumGpsSamplesForUnanchoredStay
        ? "medium"
        : "low";
  const stoppedAtMs = endedAt ? Date.parse(endedAt) : null;
  return {
    kind: "stay",
    clientSegmentId: stableLocationId("stay", [
      input.config.algorithmVersion,
      working.evidence[0].evidence.deviceId,
      firstEvidenceId,
      lastEvidenceId,
      working.key
    ]),
    algorithmVersion: input.config.algorithmVersion,
    status:
      stoppedAtMs == null
        ? "open"
        : Date.parse(processingAt) - stoppedAtMs >= input.config.segmentFinalisationLagMs
          ? "finalised"
          : "closed",
    startedAt: working.startedAt,
    stoppedAt: endedAt,
    startLowerBoundAt: working.startLowerBoundAt,
    startUpperBoundAt: working.startUpperBoundAt,
    stopLowerBoundAt: working.stopLowerBoundAt,
    stopUpperBoundAt: working.stopUpperBoundAt,
    placeId: working.placeId,
    learnedPlaceId: working.learnedPlaceId,
    placeMatchKind: working.placeMatchKind,
    candidatePlaceIds: working.candidatePlaceIds,
    centreLatitude: centre?.latitude ?? null,
    centreLongitude: centre?.longitude ?? null,
    radiusMeters: knownPlace
      ? working.evidence[0].match?.candidates.find((candidate) => candidate.id === (working.placeId ?? working.learnedPlaceId))
          ?.radiusMeters ?? null
      : input.config.unknownStayBaseRadiusMeters,
    sampleCount: coordinateEvidence.length,
    continuityStatus: working.continuityStatus,
    confidence,
    evidenceIds
  };
}

function preprocess(input: LocationEngineInput) {
  const rejectedEvidence: RejectedEvidence[] = [];
  const seen = new Set<string>();
  const sorted = input.evidence.map((evidence) => ({ ...evidence, metadata: evidence.metadata ? { ...evidence.metadata } : undefined })).sort((a, b) => {
    const timeDifference = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
    return timeDifference || SOURCE_PRECEDENCE[a.kind] - SOURCE_PRECEDENCE[b.kind] || a.clientEvidenceId.localeCompare(b.clientEvidenceId);
  });
  const accepted: ClassifiedEvidence[] = [];
  let previousPoint: LocationEvidence | null = null;
  for (const evidence of sorted) {
    if (seen.has(`${evidence.deviceId}:${evidence.clientEvidenceId}`)) {
      rejectedEvidence.push({ clientEvidenceId: evidence.clientEvidenceId, kind: evidence.kind, occurredAt: evidence.occurredAt, reason: "duplicate" });
      continue;
    }
    seen.add(`${evidence.deviceId}:${evidence.clientEvidenceId}`);
    const occurredAtMs = Date.parse(evidence.occurredAt);
    if (!Number.isFinite(occurredAtMs) || occurredAtMs > Date.parse(input.processingAt) + 10 * 60_000) {
      rejectedEvidence.push({ clientEvidenceId: evidence.clientEvidenceId, kind: evidence.kind, occurredAt: evidence.occurredAt, reason: "invalid_timestamp" });
      continue;
    }
    const hasOneCoordinate = (evidence.latitude == null) !== (evidence.longitude == null);
    if (
      hasOneCoordinate ||
      (evidence.latitude != null && (evidence.latitude < -90 || evidence.latitude > 90)) ||
      (evidence.longitude != null && (evidence.longitude < -180 || evidence.longitude > 180))
    ) {
      rejectedEvidence.push({ clientEvidenceId: evidence.clientEvidenceId, kind: evidence.kind, occurredAt: evidence.occurredAt, reason: "invalid_coordinate" });
      continue;
    }
    if (evidence.horizontalAccuracyMeters != null && evidence.horizontalAccuracyMeters < 0) {
      rejectedEvidence.push({ clientEvidenceId: evidence.clientEvidenceId, kind: evidence.kind, occurredAt: evidence.occurredAt, reason: "invalid_accuracy" });
      continue;
    }
    if (
      evidence.latitude != null &&
      evidence.horizontalAccuracyMeters != null &&
      evidence.horizontalAccuracyMeters > input.config.maxAcceptedHorizontalAccuracyMeters
    ) {
      rejectedEvidence.push({ clientEvidenceId: evidence.clientEvidenceId, kind: evidence.kind, occurredAt: evidence.occurredAt, reason: "accuracy_too_broad" });
      continue;
    }
    let impliedSpeedMetersPerSecond: number | null = null;
    if (previousPoint && evidence.latitude != null && evidence.longitude != null) {
      const elapsedSeconds = (occurredAtMs - Date.parse(previousPoint.occurredAt)) / 1000;
      if (elapsedSeconds > 0) {
        impliedSpeedMetersPerSecond = distanceMeters(
          { latitude: previousPoint.latitude!, longitude: previousPoint.longitude! },
          { latitude: evidence.latitude, longitude: evidence.longitude }
        ) / elapsedSeconds;
      }
      if (impliedSpeedMetersPerSecond != null && impliedSpeedMetersPerSecond > 120 && evidence.kind === "standard_location") {
        rejectedEvidence.push({ clientEvidenceId: evidence.clientEvidenceId, kind: evidence.kind, occurredAt: evidence.occurredAt, reason: "implausible_speed" });
        continue;
      }
    }
    const normalisedEvidence = {
      ...evidence,
      speedMetersPerSecond:
        evidence.speedMetersPerSecond != null && evidence.speedMetersPerSecond >= 0
          ? evidence.speedMetersPerSecond
          : null,
      courseDegrees:
        evidence.courseDegrees != null && evidence.courseDegrees >= 0 && evidence.courseDegrees <= 360
          ? evidence.courseDegrees
          : null
    };
    let match: PlaceMatch | null = null;
    if (normalisedEvidence.latitude != null && normalisedEvidence.longitude != null) {
      match = matchLocationToPlaces(
        {
          latitude: normalisedEvidence.latitude,
          longitude: normalisedEvidence.longitude,
          horizontalAccuracyMeters: normalisedEvidence.horizontalAccuracyMeters ?? null,
          savedPlaceIdHint: normalisedEvidence.savedPlaceId
        },
        input.savedPlaces,
        input.acceptedLearnedPlaces,
        input.config
      );
      previousPoint = normalisedEvidence;
    } else if (normalisedEvidence.savedPlaceId) {
      match = {
        kind: "saved",
        placeId: normalisedEvidence.savedPlaceId,
        candidates: []
      };
    }
    accepted.push({ evidence: normalisedEvidence, match, impliedSpeedMetersPerSecond });
  }
  return { accepted, rejectedEvidence };
}

function minimumConfidence(
  left: StaySegment["confidence"],
  right: StaySegment["confidence"]
): StaySegment["confidence"] {
  const order: StaySegment["confidence"][] = ["low", "medium", "medium_high", "high"];
  return order[Math.min(order.indexOf(left), order.indexOf(right))];
}

function coalescedContinuity(left: StaySegment, right: StaySegment): ContinuityStatus {
  if (left.continuityStatus === "uncertain_gap" || right.continuityStatus === "uncertain_gap") {
    return "uncertain_gap";
  }
  return "supported_by_visit";
}

function weightedStayCentre(left: StaySegment, right: StaySegment) {
  if (
    left.centreLatitude == null ||
    left.centreLongitude == null ||
    right.centreLatitude == null ||
    right.centreLongitude == null
  ) {
    return null;
  }
  const leftWeight = Math.max(1, left.sampleCount);
  const rightWeight = Math.max(1, right.sampleCount);
  const totalWeight = leftWeight + rightWeight;
  return {
    latitude:
      (left.centreLatitude * leftWeight + right.centreLatitude * rightWeight) / totalWeight,
    longitude:
      (left.centreLongitude * leftWeight + right.centreLongitude * rightWeight) / totalWeight
  };
}

function transitionRouteDistance(
  left: StaySegment,
  routeEvidence: ClassifiedEvidence[],
  right: StaySegment
) {
  const points = [
    left.centreLatitude != null && left.centreLongitude != null
      ? { latitude: left.centreLatitude, longitude: left.centreLongitude }
      : null,
    ...routeEvidence.map(({ evidence }) =>
      evidence.latitude != null && evidence.longitude != null
        ? { latitude: evidence.latitude, longitude: evidence.longitude }
        : null
    ),
    right.centreLatitude != null && right.centreLongitude != null
      ? { latitude: right.centreLatitude, longitude: right.centreLongitude }
      : null
  ].filter((point): point is { latitude: number; longitude: number } => point != null);
  if (points.length < 2) return null;
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distanceMeters(points[index - 1], points[index]);
  }
  return total;
}

function upperQuartile(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.75) - 1)];
}

/**
 * Joins only evidence-backed unknown stays that look like two parts of one
 * large-site visit. It intentionally does not infer site identity for saved or
 * learned places and requires an actual visit observation on one side.
 */
export function coalesceCompatibleUnknownStays(
  stays: StaySegment[],
  acceptedEvidence: ClassifiedEvidence[],
  input: LocationEngineInput
) {
  const evidenceById = new Map(
    acceptedEvidence.map((item) => [item.evidence.clientEvidenceId, item])
  );
  const evidenceOrder = new Map(
    acceptedEvidence.map((item, index) => [item.evidence.clientEvidenceId, index])
  );
  const result: StaySegment[] = [];

  for (const nextStay of stays) {
    const previousStay = result.at(-1);
    if (
      !previousStay ||
      previousStay.placeMatchKind !== "unknown" ||
      nextStay.placeMatchKind !== "unknown" ||
      previousStay.stoppedAt == null ||
      previousStay.centreLatitude == null ||
      previousStay.centreLongitude == null ||
      nextStay.centreLatitude == null ||
      nextStay.centreLongitude == null
    ) {
      result.push(nextStay);
      continue;
    }

    const transitionMs = Date.parse(nextStay.startedAt) - Date.parse(previousStay.stoppedAt);
    const endpointDistance = distanceMeters(
      {
        latitude: previousStay.centreLatitude,
        longitude: previousStay.centreLongitude
      },
      {
        latitude: nextStay.centreLatitude,
        longitude: nextStay.centreLongitude
      }
    );
    const hasVisitSupport = [...previousStay.evidenceIds, ...nextStay.evidenceIds].some(
      (evidenceId) => evidenceById.get(evidenceId)?.evidence.kind === "visit"
    );
    const occupiedEvidence = new Set([
      ...previousStay.evidenceIds,
      ...nextStay.evidenceIds
    ]);
    const routeEvidence = acceptedEvidence.filter((item) => {
      if (occupiedEvidence.has(item.evidence.clientEvidenceId)) return false;
      const at = Date.parse(item.evidence.occurredAt);
      return (
        at > Date.parse(previousStay.stoppedAt!) &&
        at < Date.parse(nextStay.startedAt) &&
        item.evidence.latitude != null &&
        item.evidence.longitude != null
      );
    });
    const credibleTransitionSpeeds = routeEvidence.flatMap((item) => {
      if (
        item.evidence.horizontalAccuracyMeters != null &&
        item.evidence.horizontalAccuracyMeters > input.config.commuteMaximumSpeedAccuracyMeters
      ) {
        return [];
      }
      const speed = item.evidence.speedMetersPerSecond ?? item.impliedSpeedMetersPerSecond;
      return speed != null && Number.isFinite(speed) && speed >= 0 ? [speed] : [];
    });
    const routeDistance = transitionRouteDistance(previousStay, routeEvidence, nextStay);
    const pedestrianTransition =
      routeEvidence.length >= 2 &&
      credibleTransitionSpeeds.length >= 2 &&
      (upperQuartile(credibleTransitionSpeeds) ?? Number.POSITIVE_INFINITY) <=
        input.config.visitContinuityPedestrianSpeedThresholdMps;
    const compatible =
      hasVisitSupport &&
      transitionMs >= 0 &&
      transitionMs <= input.config.visitContinuityMaximumTransitionMs &&
      endpointDistance <= input.config.visitContinuityMaximumEndpointDistanceMeters &&
      routeDistance != null &&
      routeDistance <= input.config.visitContinuityMaximumRouteDistanceMeters &&
      pedestrianTransition;

    if (!compatible) {
      result.push(nextStay);
      continue;
    }

    const centre = weightedStayCentre(previousStay, nextStay);
    const evidenceIds = [
      ...new Set([
        ...previousStay.evidenceIds,
        ...routeEvidence.map(({ evidence }) => evidence.clientEvidenceId),
        ...nextStay.evidenceIds
      ])
    ].sort(
      (left, right) =>
        (evidenceOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (evidenceOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
    );
    const radiusMeters =
      Math.ceil(
        endpointDistance / 2 +
        Math.max(previousStay.radiusMeters ?? 0, nextStay.radiusMeters ?? 0)
      );
    result[result.length - 1] = {
      ...previousStay,
      // Preserve the earliest stay identity so PR #115 can update an open
      // semantic row in place and replay cannot create a competing identity
      // for a manually resolved/corrected segment.
      clientSegmentId: previousStay.clientSegmentId,
      status: nextStay.status,
      stoppedAt: nextStay.stoppedAt,
      stopLowerBoundAt: nextStay.stopLowerBoundAt,
      stopUpperBoundAt: nextStay.stopUpperBoundAt,
      centreLatitude: centre?.latitude ?? previousStay.centreLatitude,
      centreLongitude: centre?.longitude ?? previousStay.centreLongitude,
      radiusMeters,
      sampleCount: previousStay.sampleCount + nextStay.sampleCount,
      continuityStatus: coalescedContinuity(previousStay, nextStay),
      confidence: minimumConfidence(previousStay.confidence, nextStay.confidence),
      evidenceIds
    };
  }

  return result;
}

export function runLocationEngine(input: LocationEngineInput): LocationEngineOutput {
  if (input.config.algorithmVersion !== input.priorState.algorithmVersion && input.priorState.processedEvidenceIds.length > 0) {
    throw new Error("Location engine state version does not match the requested configuration.");
  }
  if (!Number.isFinite(Date.parse(input.processingAt))) throw new Error("processingAt must be a valid instant.");

  const { accepted, rejectedEvidence } = preprocess(input);
  const completed: WorkingStay[] = [];
  let active: WorkingStay | null = null;

  for (const item of accepted) {
    const evidence = item.evidence;
    const point = pointFor(evidence);
    if (!point && !evidence.savedPlaceId && evidence.kind !== "visit") continue;
    const itemKey = matchKey(item.match, evidence);
    const atMs = Date.parse(evidence.occurredAt);

    if (active) {
      const lastEvidence = active.evidence.at(-1)!.evidence;
      const observedAt = lastEvidence.endedAt ?? lastEvidence.occurredAt;
      const lastAt = active.visitSupportUntilAt && Date.parse(active.visitSupportUntilAt) > Date.parse(observedAt)
        ? active.visitSupportUntilAt
        : observedAt;
      if (atMs - Date.parse(lastAt) > input.config.maxContinuityGapMs) {
        closeAtTransition(active, evidence.occurredAt, "uncertain_gap", true, true);
        completed.push(active);
        active = null;
      }
    }

    if (!active) {
      // State snapshots and departures describe an already-running monitor; they
      // are supporting evidence, never proof that a new visit began.
      if (evidence.kind === "geofence_state" || evidence.kind === "geofence_exit") continue;
      const moving =
        (evidence.speedMetersPerSecond ?? item.impliedSpeedMetersPerSecond ?? 0) >= input.config.movementSpeedThresholdMps;
      if (itemKey === "unknown" && moving && evidence.kind !== "visit") continue;
      active = makeWorkingStay(item);
      continue;
    }

    if (
      evidence.kind === "geofence_exit" &&
      evidence.savedPlaceId &&
      evidence.savedPlaceId === active.placeId
    ) {
      // Core Location can emit a same-place exit/enter pair while monitored
      // regions are being restored. That is a state snapshot, not a departure.
      if (hasPairedGeofenceEnter(accepted, evidence)) continue;
      const lastInsideAt = active.evidence.at(-1)?.evidence.endedAt ??
        active.evidence.at(-1)?.evidence.occurredAt ??
        active.startedAt;
      active.evidence.push(item);
      active.stoppedAt = midpointTimeIso(lastInsideAt, evidence.occurredAt);
      active.stopLowerBoundAt = lastInsideAt;
      active.stopUpperBoundAt = evidence.occurredAt;
      active.continuityStatus = "uncertain_gap";
      completed.push(active);
      active = null;
      continue;
    }

    // A departure for another monitored region is not evidence that the active
    // stay ended. iOS can deliver overlapping region callbacks, especially at
    // registration and with reduced precision.
    if (evidence.kind === "geofence_exit") continue;

    const sameKnownPlace = itemKey !== "unknown" && (itemKey === active.key || matchingActive(item.match, active));
    const sameUnknown = itemKey === "unknown" && active.key === "unknown" && sameUnknownCluster(active, item, input.config.unknownStayBaseRadiusMeters);
    if (sameKnownPlace || sameUnknown) {
      active.evidence.push(item);
      active.outside = [];
      if (evidence.kind === "visit") {
        active.supportedByVisit = true;
        if (
          evidence.endedAt &&
          (!active.visitSupportUntilAt || Date.parse(evidence.endedAt) > Date.parse(active.visitSupportUntilAt))
        ) active.visitSupportUntilAt = evidence.endedAt;
      }
      if (evidence.kind === "visit" && evidence.endedAt) {
        active.stoppedAt = evidence.endedAt;
        active.stopLowerBoundAt = evidence.endedAt;
        active.stopUpperBoundAt = evidence.endedAt;
        active.continuityStatus = "supported_by_visit";
      } else if (active.visitSupportUntilAt && atMs > Date.parse(active.visitSupportUntilAt)) {
        active.stoppedAt = null;
        active.stopLowerBoundAt = active.visitSupportUntilAt;
        active.stopUpperBoundAt = evidence.occurredAt;
      }
      continue;
    }

    const credibleOtherPlace = itemKey !== "unknown" && !itemKey.startsWith("ambiguous:");
    const sustainedUnknownCluster = active.key === "unknown" && itemKey === "unknown" && !sameUnknown;
    if (credibleOtherPlace || sustainedUnknownCluster) {
      closeAtTransition(active, evidence.occurredAt, "broken_by_other_place");
      completed.push(active);
      active = makeWorkingStay(item);
      continue;
    }

    active.outside.push(item);
    const activeCentre = evidenceCentre(active.evidence);
    const displaced = activeCentre && point
      ? distanceMeters(activeCentre, point) >= input.config.movementDisplacementThresholdMeters
      : false;
    const moving =
      (evidence.speedMetersPerSecond ?? item.impliedSpeedMetersPerSecond ?? 0) >= input.config.movementSpeedThresholdMps;
    if (active.outside.length >= input.config.outsideConfirmationCount && (displaced || moving || itemKey === "unknown")) {
      closeAtTransition(active, active.outside[0].evidence.occurredAt, "broken_by_other_place");
      completed.push(active);
      const outside = active.outside;
      active = null;
      const stationaryOutside = outside.filter(
        (candidate) =>
          (candidate.evidence.speedMetersPerSecond ?? candidate.impliedSpeedMetersPerSecond ?? 0) <
          input.config.movementSpeedThresholdMps
      );
      if (stationaryOutside.length > 0) {
        active = makeWorkingStay(stationaryOutside[0]);
        for (const candidate of stationaryOutside.slice(1)) {
          if (sameUnknownCluster(active, candidate, input.config.unknownStayBaseRadiusMeters)) {
            active.evidence.push(candidate);
          }
        }
      }
    }
  }

  if (active) completed.push(active);
  const rawStays = completed
    .map((working) => stayFromWorking(working, input.processingAt, input))
    .filter((segment): segment is StaySegment => Boolean(segment))
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const stays = coalesceCompatibleUnknownStays(rawStays, accepted, input);
  const commutes = deriveCommutes(stays, accepted, input.config, input.processingAt);
  const segments = [...stays, ...commutes].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.kind.localeCompare(b.kind));
  const finalisedSegments = segments.filter((segment) => segment.status === "finalised");
  const processedEvidenceIds = [...new Set([
    ...input.priorState.processedEvidenceIds,
    ...accepted.map(({ evidence }) => evidence.clientEvidenceId),
    ...rejectedEvidence.map((evidence) => evidence.clientEvidenceId)
  ])].sort();
  const activeStay = stays.find((stay) => stay.status === "open") ?? null;
  const hasUncertainGap = stays.some((stay) => stay.continuityStatus === "uncertain_gap");

  return {
    nextState: {
      algorithmVersion: input.config.algorithmVersion,
      mode: activeStay
        ? "staying"
        : active
          ? "candidate_stay"
          : hasUncertainGap
            ? "uncertain_gap"
            : commutes.at(-1)?.status === "closed"
              ? "moving"
              : "idle",
      activeSegmentId: activeStay?.clientSegmentId ?? null,
      processedEvidenceIds,
      lastProcessedAt: accepted.at(-1)?.evidence.occurredAt ?? input.priorState.lastProcessedAt
    },
    acceptedEvidence: accepted,
    rejectedEvidence,
    segmentUpserts: segments,
    finalisedSegments,
    diagnostics: {
      inputCount: input.evidence.length,
      acceptedCount: accepted.length,
      rejectedCount: rejectedEvidence.length,
      duplicateCount: rejectedEvidence.filter((item) => item.reason === "duplicate").length,
      stayCount: stays.length,
      commuteCount: commutes.length,
      ambiguousMatchCount: accepted.filter((item) => item.match?.kind === "ambiguous").length,
      warningCodes: stays.some((stay) => stay.continuityStatus === "uncertain_gap") ? ["evidence_gap"] : []
    }
  };
}
