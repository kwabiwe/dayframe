import type { LocationEngineConfig } from "./config";
import { accuracyWeightedCentre, distanceMeters, midpointTimeIso, type Coordinate } from "./geo";
import type { ClassifiedEvidence } from "./types";

/**
 * A stop proven by physical evidence alone. Place identity, naming and Review
 * eligibility are decided elsewhere; a physical stop only states that the
 * device stopped between observed movement.
 */
export type PhysicalStop = {
  startedAt: string;
  stoppedAt: string;
  startLowerBoundAt: string;
  startUpperBoundAt: string;
  stopLowerBoundAt: string;
  stopUpperBoundAt: string;
  centre: Coordinate;
  slowSampleCount: number;
  supportedByVisit: boolean;
  evidenceIds: string[];
  candidatePlaceIds: string[];
};

// Native mirrors carry whole-second timestamps, so a copy can land in the next second.
const MIRROR_WINDOW_MS = 5_000;

type Fix = { item: ClassifiedEvidence; at: number; point: Coordinate; speed: number | null };

function speedOf(item: ClassifiedEvidence) {
  const speed = item.evidence.speedMetersPerSecond ?? item.impliedSpeedMetersPerSecond;
  return speed != null && Number.isFinite(speed) && speed >= 0 ? speed : null;
}

/**
 * Accurate, independent position fixes in occurrence order. Native SLC mirrors
 * repeat a standard fix at the same second, or at the same coordinate within a
 * few seconds; keep one, preferring the copy that carries a native speed.
 */
function independentFixes(accepted: ClassifiedEvidence[], config: LocationEngineConfig) {
  const bySecond = new Map<string, ClassifiedEvidence>();
  for (const item of accepted) {
    const e = item.evidence;
    if ((e.kind !== "standard_location" && e.kind !== "significant_change") || e.isSimulated === true ||
      e.latitude == null || e.longitude == null || e.horizontalAccuracyMeters == null ||
      e.horizontalAccuracyMeters > config.commuteMaximumSpeedAccuracyMeters) continue;
    const at = Date.parse(e.occurredAt);
    if (!Number.isFinite(at)) continue;
    const key = `${e.deviceId}:${Math.floor(at / 1_000)}`;
    const existing = bySecond.get(key);
    if (!existing || existing.evidence.speedMetersPerSecond == null && e.speedMetersPerSecond != null) bySecond.set(key, item);
  }
  const lastSeenAt = new Map<string, number>();
  const fixes: Fix[] = [];
  for (const item of accepted) {
    const e = item.evidence;
    if (bySecond.get(`${e.deviceId}:${Math.floor(Date.parse(e.occurredAt) / 1_000)}`) !== item) continue;
    const at = Date.parse(e.occurredAt);
    const pointKey = `${e.deviceId}:${e.latitude}:${e.longitude}`;
    const previous = lastSeenAt.get(pointKey);
    if (previous != null && at - previous <= MIRROR_WINDOW_MS) continue;
    lastSeenAt.set(pointKey, at);
    fixes.push({ item, at, point: { latitude: e.latitude!, longitude: e.longitude! }, speed: speedOf(item) });
  }
  return fixes;
}

function firstIndexAtOrAfter(accepted: ClassifiedEvidence[], atMs: number) {
  let low = 0;
  let high = accepted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (Date.parse(accepted[middle].evidence.occurredAt) < atMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

function iso(ms: number) {
  return new Date(ms).toISOString();
}

function clamp(value: number, lower: number, upper: number) {
  return Math.min(upper, Math.max(lower, value));
}

export function detectPhysicalStops(accepted: ClassifiedEvidence[], config: LocationEngineConfig): PhysicalStop[] {
  const fixes = independentFixes(accepted, config);
  const slow = (fix: Fix) => fix.speed != null && fix.speed < config.movementSpeedThresholdMps;
  const vehicle = (fix: Fix) => fix.speed != null && fix.speed >= config.commuteFasterMovementThresholdMps;
  const completedVisits = accepted.filter(({ evidence }) => evidence.kind === "visit" && evidence.endedAt &&
    evidence.latitude != null && evidence.longitude != null && evidence.isSimulated !== true);
  const order = new Map(accepted.map((item, index) => [item, index]));
  const stops: PhysicalStop[] = [];

  let index = 0;
  while (index < fixes.length) {
    if (!slow(fixes[index])) {
      index += 1;
      continue;
    }
    const members = [fixes[index]];
    const slowMembers = [fixes[index]];
    let centre = fixes[index].point;
    let next = index + 1;
    for (; next < fixes.length; next += 1) {
      const fix = fixes[next];
      if (fix.at - members[members.length - 1].at > config.sparseUnknownContinuityMaximumGapMs || vehicle(fix)) break;
      if (distanceMeters(centre, fix.point) > config.physicalStopRadiusMeters) break;
      members.push(fix);
      if (slow(fix)) {
        slowMembers.push(fix);
        centre = accuracyWeightedCentre(slowMembers.map(member => ({
          ...member.point, accuracyMeters: member.item.evidence.horizontalAccuracyMeters
        })))!;
      }
    }
    const stop = evaluateCluster(fixes, index, next, members, completedVisits, accepted, order, config, slow, vehicle);
    if (stop) stops.push(stop);
    index = next;
  }
  return stops;
}

function evaluateCluster(
  fixes: Fix[], firstIndex: number, afterIndex: number, members: Fix[],
  completedVisits: ClassifiedEvidence[], accepted: ClassifiedEvidence[], order: ReadonlyMap<ClassifiedEvidence, number>,
  config: LocationEngineConfig,
  slow: (fix: Fix) => boolean, vehicle: (fix: Fix) => boolean
): PhysicalStop | null {
  const slowMembers = members.filter(slow);
  const centre = accuracyWeightedCentre(slowMembers.map(member => ({
    ...member.point, accuracyMeters: member.item.evidence.horizontalAccuracyMeters
  })))!;
  const departed = (fix: Fix) => vehicle(fix) ||
    distanceMeters(centre, fix.point) >= config.movementDisplacementThresholdMeters;
  const firstSlowAt = slowMembers[0].at;
  const lastSlowAt = slowMembers[slowMembers.length - 1].at;

  // Movement must be observed on both sides; an unbounded cluster may be a
  // capture gap, the start of the retained window, or an ongoing stay.
  let arrival: Fix | null = null;
  for (let index = firstIndex - 1; index >= 0; index -= 1) {
    if (firstSlowAt - fixes[index].at > config.physicalStopBoundaryWindowMs) break;
    if (departed(fixes[index])) {
      arrival = fixes[index];
      break;
    }
  }
  let departure: Fix | null = null;
  let lastLocal = members[members.length - 1];
  for (let index = afterIndex; index < fixes.length; index += 1) {
    if (fixes[index].at - lastLocal.at > config.physicalStopBoundaryWindowMs) break;
    if (departed(fixes[index])) {
      departure = fixes[index];
      break;
    }
    lastLocal = fixes[index];
  }
  if (!arrival || !departure) return null;

  const visits = completedVisits.filter(({ evidence }) => {
    const from = Date.parse(evidence.occurredAt);
    const to = Date.parse(evidence.endedAt!);
    return distanceMeters(centre, { latitude: evidence.latitude!, longitude: evidence.longitude! }) <=
        config.physicalStopRadiusMeters + (evidence.horizontalAccuracyMeters ?? 0) &&
      slowMembers.some(member => member.at >= from && member.at <= to);
  });
  const spread = lastSlowAt - firstSlowAt;
  const corroborated = visits.length > 0
    ? slowMembers.length >= 2 && spread >= config.physicalStopMinimumSlowSpreadMs
    : slowMembers.length >= config.physicalStopUnanchoredMinimumSlowSamples &&
      spread >= config.physicalStopUnanchoredMinimumSlowSpreadMs;
  if (!corroborated) return null;

  // Observed movement bounds the stop. A Visit estimate is used only inside
  // those bounds because iOS can overstate brief stops by several minutes.
  const startLower = arrival.at;
  const startUpper = firstSlowAt;
  const stopLower = lastLocal.at;
  const stopUpper = departure.at;
  const visitStart = visits.length ? Math.min(...visits.map(({ evidence }) => Date.parse(evidence.occurredAt))) : null;
  const visitStop = visits.length ? Math.max(...visits.map(({ evidence }) => Date.parse(evidence.endedAt!))) : null;
  const startedAt = visitStart != null
    ? iso(clamp(visitStart, startLower, startUpper))
    : midpointTimeIso(iso(startLower), iso(startUpper));
  const stoppedAt = visitStop != null
    ? iso(clamp(visitStop, stopLower, stopUpper))
    : midpointTimeIso(iso(stopLower), iso(stopUpper));
  const startedAtMs = Date.parse(startedAt);
  const stoppedAtMs = Date.parse(stoppedAt);
  if (stoppedAtMs - startedAtMs < config.physicalStopMinimumDurationMs) return null;

  const included = new Set<ClassifiedEvidence>(visits);
  // Accepted evidence is occurrence-ordered; scan only the stop interval.
  for (let index = firstIndexAtOrAfter(accepted, startedAtMs); index < accepted.length; index += 1) {
    const item = accepted[index];
    const { evidence, impliedSpeedMetersPerSecond } = item;
    if (Date.parse(evidence.occurredAt) > stoppedAtMs) break;
    if (evidence.latitude == null || evidence.longitude == null || evidence.kind === "visit") continue;
    const speed = evidence.speedMetersPerSecond ?? impliedSpeedMetersPerSecond;
    if (speed != null && speed >= config.commuteFasterMovementThresholdMps) continue;
    if (distanceMeters(centre, { latitude: evidence.latitude, longitude: evidence.longitude }) <=
      config.physicalStopRadiusMeters + (evidence.horizontalAccuracyMeters ?? 0)) included.add(item);
  }
  const evidenceIds = [...included]
    .sort((left, right) => order.get(left)! - order.get(right)!)
    .map(({ evidence }) => evidence.clientEvidenceId);
  const candidatePlaceIds = [...new Set(members.flatMap(({ item }) =>
    item.match?.candidates.filter(candidate => candidate.matchClass !== "outside").map(candidate => candidate.id) ?? []
  ))].sort();

  return {
    startedAt,
    stoppedAt,
    startLowerBoundAt: iso(startLower),
    startUpperBoundAt: iso(startUpper),
    stopLowerBoundAt: iso(stopLower),
    stopUpperBoundAt: iso(stopUpper),
    centre,
    slowSampleCount: slowMembers.length,
    supportedByVisit: visits.length > 0,
    evidenceIds,
    candidatePlaceIds
  };
}
