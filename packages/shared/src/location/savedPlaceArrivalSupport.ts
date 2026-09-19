import { distanceMeters } from "./geo";
import type { LocationEngineConfig } from "./config";
import type {
  ClassifiedEvidence,
  LocationEngineInput,
  LocationEvidence,
  SavedPlaceForMatching,
  StaySegment
} from "./types";

export type CorroboratedSavedVisitSupport = {
  visitEvidenceId: string;
  savedPlaceId: string;
  arrivedAt: string;
  departedAt: string;
  arrivalUpperBoundAt: string;
  departureLowerBoundAt: string;
  corroboratingEvidenceIds: readonly string[];
};

export type SavedPlaceArrivalWitness = {
  savedPlaceId: string;
  startedAt: string;
  endedAt: string;
  evidenceIds: readonly string[];
  supportingEvidenceIds: readonly string[];
};

export type SavedPlaceArrivalAnalysis = {
  corroboratedVisits: ReadonlyMap<string, CorroboratedSavedVisitSupport>;
  witnesses: readonly SavedPlaceArrivalWitness[];
};

function pointFor(item: ClassifiedEvidence) {
  const { latitude, longitude } = item.evidence;
  return latitude == null || longitude == null ? null : { latitude, longitude };
}

function timeOfEvidence(evidence: Pick<LocationEvidence, "occurredAt">) {
  return Date.parse(evidence.occurredAt);
}

function timeOf(item: ClassifiedEvidence) {
  return timeOfEvidence(item.evidence);
}

function hasFiniteAccuracy(item: ClassifiedEvidence) {
  return item.evidence.horizontalAccuracyMeters != null && Number.isFinite(item.evidence.horizontalAccuracyMeters);
}

function isIndependentPoint(item: ClassifiedEvidence) {
  return item.evidence.kind === "standard_location" || item.evidence.kind === "significant_change";
}

function strongCandidateIds(item: ClassifiedEvidence) {
  return [...new Set(
    (item.match?.candidates ?? [])
      .filter((candidate) => candidate.matchClass === "strong")
      .map((candidate) => candidate.id)
  )];
}

function uniqueStrongSavedPointId(
  item: ClassifiedEvidence,
  config: LocationEngineConfig
) {
  const accuracy = item.evidence.horizontalAccuracyMeters;
  if (
    !isIndependentPoint(item) ||
    !pointFor(item) ||
    accuracy == null ||
    !Number.isFinite(accuracy) ||
    accuracy > config.highQualityHorizontalAccuracyMeters ||
    item.evidence.isSimulated
  ) return null;
  const strongIds = strongCandidateIds(item);
  if (item.match?.kind !== "saved" || !item.match.placeId || strongIds.length !== 1 || strongIds[0] !== item.match.placeId) {
    return null;
  }
  const candidate = item.match.candidates.find((entry) => entry.id === item.match!.placeId);
  return candidate?.source === "saved" ? item.match.placeId : null;
}

function compatibleVisit(
  item: ClassifiedEvidence,
  input: LocationEngineInput,
  minimumAccuracyExclusive: number | null
) {
  const { evidence, match } = item;
  const accuracy = evidence.horizontalAccuracyMeters;
  const arrivedAtMs = timeOf(item);
  const departedAtMs = evidence.endedAt ? Date.parse(evidence.endedAt) : Number.NaN;
  if (
    evidence.kind !== "visit" ||
    !pointFor(item) ||
    accuracy == null ||
    !Number.isFinite(accuracy) ||
    accuracy > input.config.maxAcceptedHorizontalAccuracyMeters ||
    (minimumAccuracyExclusive != null && accuracy <= minimumAccuracyExclusive) ||
    !Number.isFinite(arrivedAtMs) ||
    !Number.isFinite(departedAtMs) ||
    arrivedAtMs >= departedAtMs ||
    departedAtMs > Date.parse(input.processingAt) ||
    departedAtMs - arrivedAtMs < input.config.savedPlaceMinimumDwellMs ||
    evidence.isSimulated ||
    match?.kind !== "saved" ||
    !match.placeId ||
    !match.candidates.some((candidate) => candidate.id === match.placeId && candidate.matchClass !== "outside") ||
    strongCandidateIds(item).some((id) => id !== match.placeId)
  ) return null;
  return {
    savedPlaceId: match.placeId,
    arrivedAtMs,
    departedAtMs
  };
}

function sortedUniqueIds(items: ClassifiedEvidence[], ids: Iterable<string>) {
  const wanted = new Set(ids);
  return items
    .filter((item) => wanted.has(item.evidence.clientEvidenceId))
    .map((item) => item.evidence.clientEvidenceId);
}

function hasContradictoryStrongPlace(
  items: ClassifiedEvidence[],
  savedPlaceId: string,
  startMs: number,
  endMs: number,
  config: LocationEngineConfig
) {
  return items.some((item) => {
    const at = timeOf(item);
    if (at < startMs || at > endMs || !hasFiniteAccuracy(item) || item.evidence.isSimulated) return false;
    const accuracy = item.evidence.horizontalAccuracyMeters!;
    if (accuracy > config.highQualityHorizontalAccuracyMeters || !pointFor(item)) return false;
    return strongCandidateIds(item).some((id) => id !== savedPlaceId);
  });
}

function hasCredibleOutsideMovement(
  items: ClassifiedEvidence[],
  savedPlace: SavedPlaceForMatching,
  savedPlaceId: string,
  startMs: number,
  endMs: number,
  config: LocationEngineConfig
) {
  const outside = items.filter((item) => {
    const at = timeOf(item);
    if (
      at < startMs ||
      at > endMs ||
      !isIndependentPoint(item) ||
      !hasFiniteAccuracy(item) ||
      item.evidence.horizontalAccuracyMeters! > config.highQualityHorizontalAccuracyMeters ||
      !pointFor(item) ||
      item.evidence.isSimulated
    ) return false;
    return uniqueStrongSavedPointId(item, config) !== savedPlaceId;
  });
  const distinctTimes = new Set(outside.map(timeOf));
  if (distinctTimes.size < config.outsideConfirmationCount) return false;
  const explicitMovement = outside.some(
    (item) => (item.evidence.speedMetersPerSecond ?? 0) >= config.movementSpeedThresholdMps
  );
  const displaced = outside.some((item) => {
    const point = pointFor(item)!;
    return distanceMeters(point, savedPlace) >= config.movementDisplacementThresholdMeters;
  });
  const pairMovement = outside.some((left, index) => outside.slice(index + 1).some((right) => {
    const elapsedSeconds = (timeOf(right) - timeOf(left)) / 1_000;
    const leftPoint = pointFor(left);
    const rightPoint = pointFor(right);
    return elapsedSeconds > 0 && leftPoint && rightPoint &&
      distanceMeters(leftPoint, rightPoint) / elapsedSeconds >= config.movementSpeedThresholdMps;
  }));
  return explicitMovement || displaced || pairMovement;
}

function hasCredibleMovement(
  items: ClassifiedEvidence[],
  startMs: number,
  endMs: number,
  config: LocationEngineConfig
) {
  const points = items
    .filter((item) => {
      const at = timeOf(item);
      return at >= startMs && at <= endMs && isIndependentPoint(item) &&
        hasFiniteAccuracy(item) &&
        item.evidence.horizontalAccuracyMeters! <= config.highQualityHorizontalAccuracyMeters &&
        pointFor(item) && !item.evidence.isSimulated;
    })
    .sort((left, right) => timeOf(left) - timeOf(right));
  if (points.some((item) => (item.evidence.speedMetersPerSecond ?? 0) >= config.movementSpeedThresholdMps)) {
    return true;
  }
  return points.some((item, index) => {
    if (index === 0) return false;
    const previous = points[index - 1];
    const elapsedSeconds = (timeOf(item) - timeOf(previous)) / 1_000;
    const previousPoint = pointFor(previous);
    const currentPoint = pointFor(item);
    return elapsedSeconds > 0 && previousPoint && currentPoint &&
      distanceMeters(previousPoint, currentPoint) / elapsedSeconds >= config.movementSpeedThresholdMps;
  });
}

function hasUnresolvedExit(
  items: ClassifiedEvidence[],
  savedPlaceId: string,
  startMs: number,
  endMs: number,
  config: LocationEngineConfig
) {
  const exits = items.filter(({ evidence }) =>
    evidence.kind === "geofence_exit" &&
    evidence.savedPlaceId === savedPlaceId &&
    timeOfEvidence(evidence) >= startMs &&
    timeOfEvidence(evidence) <= endMs
  );
  return exits.some((exit) => {
    const exitAt = timeOf(exit);
    const pairedEnter = items.some(({ evidence }) =>
      evidence.kind === "geofence_enter" &&
      evidence.savedPlaceId === savedPlaceId &&
      evidence.deviceId === exit.evidence.deviceId &&
      Math.abs(timeOfEvidence(evidence) - exitAt) <= 5_000
    );
    const restoredByStrongPoint = items.some((item) => {
      const at = timeOf(item);
      return at > exitAt && at <= exitAt + config.savedPlaceExitReentryGraceMs &&
        uniqueStrongSavedPointId(item, config) === savedPlaceId;
    });
    return !pairedEnter && !restoredByStrongPoint;
  });
}

function compatibleVisitForWitness(
  item: ClassifiedEvidence,
  savedPlaceId: string,
  input: LocationEngineInput,
  startMs: number,
  endMs: number
) {
  const visit = compatibleVisit(item, input, null);
  return visit?.savedPlaceId === savedPlaceId && timeOf(item) >= startMs && timeOf(item) <= endMs;
}

function findStationaryCluster(
  points: ClassifiedEvidence[],
  config: LocationEngineConfig,
  minimumSpanMs: number,
  minimumDistinctPointCount: number,
  maximumSpanMs: number
) {
  for (let start = 0; start < points.length; start += 1) {
    const startAt = timeOf(points[start]);
    for (let end = start + 1; end < points.length; end += 1) {
      const endAt = timeOf(points[end]);
      const span = endAt - startAt;
      if (span > maximumSpanMs) break;
      const cluster = points.slice(start, end + 1);
      const distinctTimes = new Set(cluster.map(timeOf)).size;
      if (
        span >= minimumSpanMs &&
        distinctTimes >= minimumDistinctPointCount &&
        clusterIsStationary(cluster, config)
      ) {
        return cluster;
      }
    }
  }
  return null;
}

function clusterIsStationary(cluster: ClassifiedEvidence[], config: LocationEngineConfig) {
  return cluster.every((item, index) => {
    const explicitSpeed = item.evidence.speedMetersPerSecond;
    if (explicitSpeed != null && explicitSpeed >= config.movementSpeedThresholdMps) return false;
    if (index === 0) return true;
    const previous = cluster[index - 1];
    const elapsedSeconds = (timeOf(item) - timeOf(previous)) / 1_000;
    const previousPoint = pointFor(previous);
    const currentPoint = pointFor(item);
    return elapsedSeconds > 0 && previousPoint && currentPoint &&
      distanceMeters(previousPoint, currentPoint) / elapsedSeconds < config.movementSpeedThresholdMps;
  });
}

function buildWitnesses(
  accepted: ClassifiedEvidence[],
  input: LocationEngineInput,
  pointsBySavedPlace: Map<string, ClassifiedEvidence[]>
) {
  const witnesses: SavedPlaceArrivalWitness[] = [];
  for (const [savedPlaceId, rawPoints] of pointsBySavedPlace) {
    const points = [...rawPoints].sort((left, right) =>
      timeOf(left) - timeOf(right) ||
      left.evidence.clientEvidenceId.localeCompare(right.evidence.clientEvidenceId)
    );
    const cluster = findStationaryCluster(
      points,
      input.config,
      input.config.savedArrivalWitnessMinimumSpanMs,
      input.config.savedPlaceArrivalMinimumStrongPointCount,
      input.config.savedPlaceArrivalCorroborationWindowMs
    );
    if (!cluster) continue;
    const startMs = timeOf(cluster[0]);
    const endMs = timeOf(cluster.at(-1)!);
    const windowStartMs = startMs - input.config.savedPlaceArrivalCorroborationWindowMs;
    const windowEndMs = endMs + input.config.savedPlaceArrivalCorroborationWindowMs;
    const supporting = accepted.filter((item) => {
      const at = timeOf(item);
      if (at < windowStartMs || at > windowEndMs || item.evidence.isSimulated) return false;
      return (item.evidence.kind === "geofence_enter" &&
        item.evidence.savedPlaceId === savedPlaceId) ||
        compatibleVisitForWitness(item, savedPlaceId, input, windowStartMs, windowEndMs);
    });
    if (supporting.length === 0) continue;
    witnesses.push({
      savedPlaceId,
      startedAt: cluster[0].evidence.occurredAt,
      endedAt: cluster.at(-1)!.evidence.occurredAt,
      evidenceIds: sortedUniqueIds(accepted, cluster.map((item) => item.evidence.clientEvidenceId)),
      supportingEvidenceIds: sortedUniqueIds(accepted, supporting.map((item) => item.evidence.clientEvidenceId))
    });
  }
  return witnesses;
}

function analyseVisitSupport(
  visitItem: ClassifiedEvidence,
  visit: { savedPlaceId: string; arrivedAtMs: number; departedAtMs: number },
  accepted: ClassifiedEvidence[],
  input: LocationEngineInput,
  pointsBySavedPlace: Map<string, ClassifiedEvidence[]>
) {
  const points = pointsBySavedPlace.get(visit.savedPlaceId) ?? [];
  const arrivalEndMs = visit.arrivedAtMs + input.config.savedPlaceArrivalCorroborationWindowMs;
  const earlyCandidates = points.filter((item) => {
    const at = timeOf(item);
    return at >= visit.arrivedAtMs && at <= arrivalEndMs && at <= visit.departedAtMs;
  });
  const early = findStationaryCluster(
    earlyCandidates,
    input.config,
    0,
    input.config.savedPlaceArrivalMinimumStrongPointCount,
    input.config.savedPlaceArrivalCorroborationWindowMs
  );
  if (!early) return null;

  const later = points
    .filter((item) => timeOf(item) > arrivalEndMs && timeOf(item) <= visit.departedAtMs)
    .sort((left, right) =>
      timeOf(left) - timeOf(right) ||
      left.evidence.clientEvidenceId.localeCompare(right.evidence.clientEvidenceId)
    );
  let laterCluster: ClassifiedEvidence[] | null = null;
  for (let start = 0; start < later.length; start += 1) {
    const cluster: ClassifiedEvidence[] = [later[start]];
    for (let index = start + 1; index < later.length; index += 1) {
      if (timeOf(later[index]) - timeOf(later[index - 1]) > input.config.maxContinuityGapMs) break;
      cluster.push(later[index]);
      if (
        new Set(cluster.map(timeOf)).size >= input.config.savedPlaceArrivalMinimumStrongPointCount &&
        timeOf(cluster.at(-1)!) - timeOf(cluster[0]) >= input.config.savedPlaceMinimumDwellMs &&
        cluster.some((item) => visit.departedAtMs - timeOf(item) <= input.config.maxContinuityGapMs) &&
        clusterIsStationary(cluster, input.config)
      ) {
        laterCluster = cluster;
        break;
      }
    }
    if (laterCluster) break;
  }
  if (!laterCluster) return null;
  if (timeOf(laterCluster[0]) - timeOf(early.at(-1)!) <= input.config.savedPlaceQuietGapMaxMs) return null;

  const usedItems = [...early, ...laterCluster];
  const departureLower = points
    .filter((item) => timeOf(item) <= visit.departedAtMs)
    .at(-1);
  if (!departureLower) return null;
  const intervalStartMs = visit.arrivedAtMs;
  const intervalEndMs = visit.departedAtMs;
  const savedPlace = input.savedPlaces.find((place) => place.id === visit.savedPlaceId);
  if (!savedPlace) return null;
  if (
    hasContradictoryStrongPlace(accepted, visit.savedPlaceId, intervalStartMs, intervalEndMs, input.config) ||
    hasCredibleOutsideMovement(
      accepted,
      savedPlace,
      visit.savedPlaceId,
      intervalStartMs,
      intervalEndMs,
      input.config
    ) ||
    hasCredibleMovement(accepted, intervalStartMs, intervalEndMs, input.config) ||
    hasUnresolvedExit(accepted, visit.savedPlaceId, intervalStartMs, intervalEndMs, input.config)
  ) return null;

  const geofenceSupport = accepted.filter(({ evidence }) =>
    evidence.kind === "geofence_enter" &&
    evidence.savedPlaceId === visit.savedPlaceId &&
    timeOfEvidence(evidence) >= visit.arrivedAtMs &&
    timeOfEvidence(evidence) <= arrivalEndMs &&
    !evidence.isSimulated
  );
  return {
    visitEvidenceId: visitItem.evidence.clientEvidenceId,
    savedPlaceId: visit.savedPlaceId,
    arrivedAt: visitItem.evidence.occurredAt,
    departedAt: visitItem.evidence.endedAt!,
    arrivalUpperBoundAt: early[0].evidence.occurredAt,
    departureLowerBoundAt: departureLower.evidence.occurredAt,
    corroboratingEvidenceIds: sortedUniqueIds(accepted, [
      ...usedItems.map((item) => item.evidence.clientEvidenceId),
      ...geofenceSupport.map((item) => item.evidence.clientEvidenceId)
    ])
  } satisfies CorroboratedSavedVisitSupport;
}

export function analyseSavedPlaceArrivalEvidence(
  accepted: ClassifiedEvidence[],
  input: LocationEngineInput
): SavedPlaceArrivalAnalysis {
  const processingAtMs = Date.parse(input.processingAt);
  const usable = accepted.filter((item) =>
    Number.isFinite(timeOf(item)) && timeOf(item) <= processingAtMs && item.evidence.deviceId === input.evidence[0]?.deviceId
  );
  const pointsBySavedPlace = new Map<string, ClassifiedEvidence[]>();
  for (const item of usable) {
    const savedPlaceId = uniqueStrongSavedPointId(item, input.config);
    if (!savedPlaceId) continue;
    const items = pointsBySavedPlace.get(savedPlaceId) ?? [];
    items.push(item);
    pointsBySavedPlace.set(savedPlaceId, items);
  }

  const corroboratedVisits = new Map<string, CorroboratedSavedVisitSupport>();
  for (const item of usable) {
    const visit = compatibleVisit(item, input, input.config.highQualityHorizontalAccuracyMeters);
    if (!visit || !input.savedPlaces.some((place) => place.id === visit.savedPlaceId)) continue;
    const support = analyseVisitSupport(item, visit, usable, input, pointsBySavedPlace);
    if (support) corroboratedVisits.set(item.evidence.clientEvidenceId, support);
  }
  return {
    corroboratedVisits,
    witnesses: buildWitnesses(usable, input, pointsBySavedPlace)
  };
}

function hasCredibleInterveningAwayEvidence(
  acceptedEvidence: ClassifiedEvidence[],
  witness: SavedPlaceArrivalWitness,
  toStayStartedAtMs: number,
  savedPlace: SavedPlaceForMatching,
  config: LocationEngineConfig
) {
  const between = acceptedEvidence.filter((item) => {
    const at = timeOf(item);
    return at > Date.parse(witness.endedAt) && at < toStayStartedAtMs && item.evidence.deviceId === acceptedEvidence[0]?.evidence.deviceId;
  });
  const otherStrongPlace = between.some((item) => strongCandidateIds(item).some((id) => id !== witness.savedPlaceId));
  if (otherStrongPlace) return true;

  const outside = between.filter((item) => {
    const point = pointFor(item);
    return isIndependentPoint(item) && point && hasFiniteAccuracy(item) &&
      item.evidence.horizontalAccuracyMeters! <= config.highQualityHorizontalAccuracyMeters &&
      uniqueStrongSavedPointId(item, config) !== witness.savedPlaceId &&
      !item.evidence.isSimulated;
  });
  if (new Set(outside.map(timeOf)).size < config.outsideConfirmationCount) return false;
  const moving = outside.some((item) => (item.evidence.speedMetersPerSecond ?? 0) >= config.movementSpeedThresholdMps);
  const displaced = outside.some((item) => distanceMeters(pointFor(item)!, savedPlace) >= config.movementDisplacementThresholdMeters);
  return moving || displaced;
}

export function crossesUnsupportedSavedPlaceArrivalWitness({
  witness,
  from,
  to,
  acceptedEvidence,
  config,
  savedPlaces
}: {
  witness: SavedPlaceArrivalWitness;
  from: StaySegment;
  to: StaySegment;
  acceptedEvidence: ClassifiedEvidence[];
  config: LocationEngineConfig;
  savedPlaces: readonly SavedPlaceForMatching[];
}) {
  const fromStoppedAtMs = from.stoppedAt ? Date.parse(from.stoppedAt) : Number.NaN;
  const toStartedAtMs = Date.parse(to.startedAt);
  const witnessStartedAtMs = Date.parse(witness.startedAt);
  const witnessEndedAtMs = Date.parse(witness.endedAt);
  if (
    to.placeMatchKind !== "saved" ||
    to.placeId !== witness.savedPlaceId ||
    from.placeId === witness.savedPlaceId ||
    !Number.isFinite(fromStoppedAtMs) ||
    !Number.isFinite(toStartedAtMs) ||
    witnessStartedAtMs <= fromStoppedAtMs ||
    witnessEndedAtMs >= toStartedAtMs ||
    toStartedAtMs - witnessEndedAtMs <= config.maxContinuityGapMs
  ) return false;
  const savedPlace = savedPlaces.find((place) => place.id === witness.savedPlaceId);
  if (!savedPlace) return false;
  return !hasCredibleInterveningAwayEvidence(
    acceptedEvidence,
    witness,
    toStartedAtMs,
    savedPlace,
    config
  );
}
