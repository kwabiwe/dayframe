import type { LocationEngineConfig } from "./config";
import { accuracyWeightedCentre, distanceMeters, midpointTimeIso, type Coordinate } from "./geo";
import { motionArrivalMs, type MotionTimeline } from "./motionActivity";
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
  /** Silences the stop spans because Core Motion saw the device still through them (card J), as [from, to] ms. */
  stillSpans?: Array<[number, number]>;
};

// Native mirrors carry whole-second timestamps, so a copy can land in the next second.
const MIRROR_WINDOW_MS = 5_000;

type PlacedVisit = { point: Coordinate; accuracy: number; from: number; to: number; episode: string };

type Fix = { item: ClassifiedEvidence; at: number; point: Coordinate; speed: number | null; accuracy: number; accurate: boolean };

function speedOf(item: ClassifiedEvidence) {
  const speed = item.evidence.speedMetersPerSecond ?? item.impliedSpeedMetersPerSecond;
  return speed != null && Number.isFinite(speed) && speed >= 0 ? speed : null;
}

/**
 * Independent accepted position fixes in occurrence order. Native SLC mirrors
 * repeat a standard fix at the same second, or at the same coordinate within a
 * few seconds; keep one, preferring the copy that carries a native speed. Only
 * accurate fixes can support a stop, but broad accepted fixes still count as
 * contradicting movement when they are certainly elsewhere.
 */
function independentFixes(accepted: ClassifiedEvidence[], config: LocationEngineConfig) {
  const bySecond = new Map<string, ClassifiedEvidence>();
  for (const item of accepted) {
    const e = item.evidence;
    if ((e.kind !== "standard_location" && e.kind !== "significant_change") || e.isSimulated === true ||
      e.latitude == null || e.longitude == null || e.horizontalAccuracyMeters == null) continue;
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
    const accuracy = e.horizontalAccuracyMeters!;
    fixes.push({
      item, at, point: { latitude: e.latitude!, longitude: e.longitude! }, speed: speedOf(item),
      accuracy, accurate: accuracy <= config.commuteMaximumSpeedAccuracyMeters
    });
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

// iOS can report a same-region exit and entry together while monitored regions are
// restored. Such a pair is a state snapshot, not a crossing (as in the segmenter).
// Pairs are disjoint: each callback excuses at most one opposite callback, so a
// surplus enter or exit remains a crossing.
const GEOFENCE_SNAPSHOT_PAIR_MS = 5_000;

function geofenceCrossings(accepted: ClassifiedEvidence[]) {
  const transitions = accepted.filter(({ evidence }) => evidence.kind === "geofence_enter" || evidence.kind === "geofence_exit");
  const paired = new Set<ClassifiedEvidence>();
  transitions.forEach((item, index) => {
    if (paired.has(item) || !item.evidence.savedPlaceId) return;
    const at = Date.parse(item.evidence.occurredAt);
    const match = transitions.slice(index + 1).find((other) => !paired.has(other) &&
      other.evidence.kind !== item.evidence.kind && other.evidence.deviceId === item.evidence.deviceId &&
      other.evidence.savedPlaceId === item.evidence.savedPlaceId &&
      Date.parse(other.evidence.occurredAt) - at <= GEOFENCE_SNAPSHOT_PAIR_MS);
    if (match) paired.add(item).add(match);
  });
  return transitions.filter((item) => !paired.has(item));
}

/**
 * Card J: whether the device stayed still through a silence between two fixes, by Core Motion. Its history
 * covers the whole silence (no more than the still-silence maximum), with positive stillness: stationary for
 * a share of it, never long without being stationary, walking about for a bounded share, driving, cycling or
 * running (at any confidence) for at most a few minutes. iOS reports "unknown" between stationary readings
 * while a phone sits on a table, so unknown time is allowed, but never for a long spell. No reading of any
 * accuracy came in it (Codex r1 on #601), and no geofence was crossed.
 */
function stillThrough(motion: MotionTimeline | null, fromMs: number, toMs: number, config: LocationEngineConfig,
  crossings: readonly ClassifiedEvidence[], broadReadingTimes: readonly number[]) {
  if (!motion || !(toMs > fromMs) || toMs - fromMs > config.physicalStopStillSilenceMaximumMs) return false;
  if (motion.coverageFromMs > fromMs || motion.coverageToMs < toMs) return false;
  let stationaryMs = 0;
  let walkingMs = 0;
  let movingMs = 0;
  let restlessMs = 0;
  let longestRestlessMs = 0;
  for (const interval of motion.intervals) {
    const overlap = Math.max(0, Math.min(interval.toMs, toMs) - Math.max(interval.fromMs, fromMs));
    if (!overlap) continue;
    if (interval.activity === "stationary" && interval.confidence !== "low") {
      stationaryMs += overlap;
      restlessMs = 0;
      continue;
    }
    if (interval.activity === "walking") walkingMs += overlap;
    if (["automotive", "cycling", "running"].includes(interval.activity)) movingMs += overlap;
    restlessMs += overlap;
    longestRestlessMs = Math.max(longestRestlessMs, restlessMs);
  }
  const silenceMs = toMs - fromMs;
  if (stationaryMs < silenceMs * config.physicalStopStillSilenceStationaryMinimumShare ||
    walkingMs > silenceMs * config.physicalStopStillSilenceWalkingMaximumShare ||
    movingMs > config.physicalStopStillSilenceMovingAllowanceMs ||
    longestRestlessMs > config.physicalStopStillSilenceRestlessMaximumMs) return false;
  if (broadReadingTimes.some((at) => at > fromMs && at < toMs)) return false;
  return !crossings.some(({ evidence }) => {
    const at = Date.parse(evidence.occurredAt);
    return at > fromMs && at < toMs;
  });
}

function iso(ms: number) {
  return new Date(ms).toISOString();
}

function clamp(value: number, lower: number, upper: number) {
  return Math.min(upper, Math.max(lower, value));
}

export function detectPhysicalStops(
  accepted: ClassifiedEvidence[],
  config: LocationEngineConfig,
  /** Core Motion's history: a still silence (card J) may join a stop across a longer quiet spell. */
  motion: MotionTimeline | null = null,
  /** Readings too broad to accept: any of them in a silence shows it was not silent (Codex r1 on #601). */
  broadReadingTimes: readonly number[] = []
): PhysicalStop[] {
  const fixes = independentFixes(accepted, config);
  const slow = (fix: Fix) => fix.accurate && fix.speed != null && fix.speed < config.movementSpeedThresholdMps;
  const vehicle = (fix: Fix) => fix.accurate && fix.speed != null && fix.speed >= config.commuteFasterMovementThresholdMps;
  // Even a broad fix proves the device left when its whole accuracy disc lies outside the stop.
  const certainlyBeyond = (fix: Fix, centre: Coordinate, metres: number) =>
    distanceMeters(centre, fix.point) - (fix.accurate ? 0 : fix.accuracy) > metres;
  const completedVisits = accepted.filter(({ evidence }) => evidence.kind === "visit" && evidence.endedAt &&
    evidence.latitude != null && evidence.longitude != null && evidence.isSimulated !== true);
  // A Visit is never a slow fix, but a credible Visit elsewhere shows the device
  // was not at the stop during its interval: it splits clusters and bounds stops.
  const placedVisits: PlacedVisit[] = accepted.flatMap(({ evidence }) =>
    evidence.kind === "visit" && evidence.latitude != null && evidence.longitude != null &&
      evidence.isSimulated !== true && evidence.horizontalAccuracyMeters != null
      ? [{
          point: { latitude: evidence.latitude, longitude: evidence.longitude },
          accuracy: evidence.horizontalAccuracyMeters,
          from: Date.parse(evidence.occurredAt),
          to: Date.parse(evidence.endedAt ?? evidence.occurredAt),
          episode: `${evidence.deviceId}:${evidence.occurredAt}`
        }]
      : []);
  // iOS reports one Visit as an arrival callback and a completed callback with the
  // same arrival time. The completion's coordinate averages the whole Visit, so
  // the Visit is elsewhere only when every callback for it is.
  const episodes = new Map<string, PlacedVisit[]>();
  for (const visit of placedVisits) episodes.set(visit.episode, [...(episodes.get(visit.episode) ?? []), visit]);
  const elsewhere = (visit: PlacedVisit, centre: Coordinate) => episodes.get(visit.episode)!.every((callback) =>
    distanceMeters(centre, callback.point) - callback.accuracy > config.movementDisplacementThresholdMeters);
  const order = new Map(accepted.map((item, index) => [item, index]));
  const crossings = geofenceCrossings(accepted);
  const still = (fromMs: number, toMs: number) => stillThrough(motion, fromMs, toMs, config, crossings, broadReadingTimes);
  const stops: PhysicalStop[] = [];

  let index = 0;
  while (index < fixes.length) {
    if (!slow(fixes[index])) {
      index += 1;
      continue;
    }
    const members = [fixes[index]];
    const slowMembers = [fixes[index]];
    const stillSpans: Array<[number, number]> = [];
    let centre = fixes[index].point;
    let next = index + 1;
    for (; next < fixes.length; next += 1) {
      const fix = fixes[next];
      const lastMemberAt = members[members.length - 1].at;
      // A longer quiet spell is bridged only when it was truly silent (no fix at all since the last member,
      // however broad) and the device stayed still through it (card J).
      const longQuiet = fix.at - lastMemberAt > config.sparseUnknownContinuityMaximumGapMs;
      const silent = fixes[next - 1] === members[members.length - 1];
      if (longQuiet && !(silent && still(lastMemberAt, fix.at)) || vehicle(fix)) break;
      if (placedVisits.some((visit) => elsewhere(visit, centre) && visit.to >= lastMemberAt && visit.from <= fix.at)) break;
      // The cluster ends only where departure is evident, the same rule as its
      // boundaries; nearer fixes neither join nor split it, so one stop cannot
      // become overlapping clusters sharing one arrival and departure.
      if (certainlyBeyond(fix, centre, config.movementDisplacementThresholdMeters)) break;
      if (!fix.accurate || distanceMeters(centre, fix.point) > config.physicalStopRadiusMeters) continue;
      // Only a silence the stop goes on across is covered by it (Codex r1 on #601).
      if (longQuiet) stillSpans.push([lastMemberAt, fix.at]);
      members.push(fix);
      if (slow(fix)) {
        slowMembers.push(fix);
        centre = accuracyWeightedCentre(slowMembers.map(member => ({
          ...member.point, accuracyMeters: member.item.evidence.horizontalAccuracyMeters
        })))!;
      }
    }
    const stop = evaluateCluster(fixes, index, next, members, completedVisits, accepted, order, config, slow, vehicle, certainlyBeyond,
      placedVisits, elsewhere, crossings, still, motion, stillSpans);
    // Defensive: never emit overlapping stops.
    if (stop && (!stops.length || Date.parse(stop.startedAt) >= Date.parse(stops[stops.length - 1].stoppedAt))) stops.push(stop);
    index = next;
  }
  return stops;
}

function evaluateCluster(
  fixes: Fix[], firstIndex: number, afterIndex: number, members: Fix[],
  completedVisits: ClassifiedEvidence[], accepted: ClassifiedEvidence[], order: ReadonlyMap<ClassifiedEvidence, number>,
  config: LocationEngineConfig,
  slow: (fix: Fix) => boolean, vehicle: (fix: Fix) => boolean,
  certainlyBeyond: (fix: Fix, centre: Coordinate, metres: number) => boolean,
  placedVisits: readonly PlacedVisit[], elsewhere: (visit: PlacedVisit, centre: Coordinate) => boolean,
  crossings: readonly ClassifiedEvidence[],
  still: (fromMs: number, toMs: number) => boolean,
  motion: MotionTimeline | null,
  stillSpans: Array<[number, number]>
): PhysicalStop | null {
  const slowMembers = members.filter(slow);
  const centre = accuracyWeightedCentre(slowMembers.map(member => ({
    ...member.point, accuracyMeters: member.item.evidence.horizontalAccuracyMeters
  })))!;
  const departed = (fix: Fix) => vehicle(fix) ||
    certainlyBeyond(fix, centre, config.movementDisplacementThresholdMeters - 1e-9);
  const firstSlowAt = slowMembers[0].at;
  const lastSlowAt = slowMembers[slowMembers.length - 1].at;

  // Movement must be observed on both sides; an unbounded cluster may be a
  // capture gap, the start of the retained window, or an ongoing stay.
  // A credible Visit elsewhere is also observed movement: before the stop it
  // bounds arrival, after it bounds departure.
  let arrivalAt: number | null = null;
  for (let index = firstIndex - 1; index >= 0; index -= 1) {
    if (firstSlowAt - fixes[index].at > config.physicalStopBoundaryWindowMs) break;
    if (departed(fixes[index])) {
      arrivalAt = fixes[index].at;
      break;
    }
  }
  for (const visit of placedVisits) {
    if (elsewhere(visit, centre) && visit.to <= firstSlowAt && firstSlowAt - visit.to <= config.physicalStopBoundaryWindowMs) {
      arrivalAt = Math.max(arrivalAt ?? visit.to, visit.to);
    }
  }
  // Card J: the first slow fix comes after a long quiet spell. When the device stayed still through it and
  // the fix before it is close by, that fix bounds the arrival (the stop began after it); Core Motion's own
  // arrival, when it saw one, is nearer.
  // A credible Visit elsewhere in the silence contradicts it (Codex r1 on #601). The stop starts at that
  // arrival, not halfway to the first slow fix: the device was still from then (Codex r1 on #601).
  const before = firstIndex > 0 ? fixes[firstIndex - 1] : null;
  let stillArrivalAt: number | null = null;
  if (arrivalAt == null && before?.accurate && firstSlowAt - before.at > config.physicalStopBoundaryWindowMs && still(before.at, firstSlowAt) &&
    distanceMeters(centre, before.point) <= config.sparseUnknownContinuityMaximumDistanceMeters &&
    !placedVisits.some((visit) => elsewhere(visit, centre) && visit.to >= before.at && visit.from <= firstSlowAt)) {
    arrivalAt = motionArrivalMs(motion, before.at, firstSlowAt, config) ?? before.at;
    stillArrivalAt = arrivalAt;
    stillSpans.push([before.at, firstSlowAt]);
  }
  const lastMemberAt = members[members.length - 1].at;
  const visitDepartureAt = placedVisits
    .filter((visit) => elsewhere(visit, centre) && visit.from >= lastMemberAt)
    .reduce<number | null>((earliest, visit) => earliest == null || visit.from < earliest ? visit.from : earliest, null);
  const visits = completedVisits.filter(({ evidence }) => {
    const from = Date.parse(evidence.occurredAt);
    const to = Date.parse(evidence.endedAt!);
    return distanceMeters(centre, { latitude: evidence.latitude!, longitude: evidence.longitude! }) <=
        config.physicalStopRadiusMeters + (evidence.horizontalAccuracyMeters ?? 0) &&
      slowMembers.some(member => member.at >= from && member.at <= to);
  });
  // A long compatible Visit carries the stop through silence after its last
  // fix. It speaks only for the time since movement was last observed: a Visit
  // that began before that movement is measured from it, so stale support cannot
  // pass the overstatement allowance. A geofence crossing in the silence shows
  // the device moved; registration snapshot pairs do not.
  const visitStop = visits.length ? Math.max(...visits.map(({ evidence }) => Date.parse(evidence.endedAt!))) : null;
  const carrier = visits.find(({ evidence }) => Date.parse(evidence.endedAt!) === visitStop);
  const carriedUntil = carrier ? Date.parse(carrier.evidence.endedAt!) : null;
  const carriedFrom = carrier ? Math.max(Date.parse(carrier.evidence.occurredAt), arrivalAt ?? Number.NEGATIVE_INFINITY) : null;
  const deviceId = members[0].item.evidence.deviceId;
  // The silence ends at the first observed departure. iOS reports a Visit's
  // end shortly after the device leaves, so a crossing on the drive away
  // before that report is the departure itself, not movement while stopped.
  let observedDepartureMs = visitDepartureAt ?? Number.POSITIVE_INFINITY;
  for (let index = afterIndex; index < fixes.length; index += 1) {
    if (departed(fixes[index])) {
      observedDepartureMs = Math.min(observedDepartureMs, fixes[index].at);
      break;
    }
  }
  const silenceEndMs = carriedUntil == null ? null : Math.min(carriedUntil, observedDepartureMs);
  const carriedVisit = carriedUntil != null && carriedFrom != null && silenceEndMs != null &&
    carriedUntil - carriedFrom >= config.physicalStopVisitCarriedMinimumMs &&
    !crossings.some(({ evidence }) => evidence.deviceId === deviceId &&
      Date.parse(evidence.occurredAt) > lastMemberAt && Date.parse(evidence.occurredAt) < silenceEndMs) &&
    // A credible Visit elsewhere already in progress at the last fix contradicts
    // the silence (one starting later is a departure bound instead).
    !placedVisits.some((visit) => elsewhere(visit, centre) && visit.from <= lastMemberAt && visit.to > lastMemberAt);
  // Both departure sources search the same horizon.
  const horizonFrom = (lastLocalAt: number) => Math.max(lastLocalAt, carriedVisit ? carriedUntil! : Number.NEGATIVE_INFINITY);
  let departureAt: number | null = null;
  let lastLocal = members[members.length - 1];
  for (let index = afterIndex; index < fixes.length; index += 1) {
    if (fixes[index].at - horizonFrom(lastLocal.at) > config.physicalStopBoundaryWindowMs) break;
    if (visitDepartureAt != null && fixes[index].at >= visitDepartureAt) break;
    if (departed(fixes[index])) {
      departureAt = fixes[index].at;
      break;
    }
    // Only accurate fixes can show the device was still at the stop.
    if (fixes[index].accurate) lastLocal = fixes[index];
  }
  if (visitDepartureAt != null && visitDepartureAt - horizonFrom(lastLocal.at) <= config.physicalStopBoundaryWindowMs &&
    (departureAt == null || visitDepartureAt < departureAt)) departureAt = visitDepartureAt;
  if (arrivalAt == null || departureAt == null) return null;

  const spread = lastSlowAt - firstSlowAt;
  const corroborated = visits.length > 0
    ? slowMembers.length >= 2 && spread >= config.physicalStopMinimumSlowSpreadMs ||
      carriedVisit && Math.abs(departureAt - carriedUntil!) <= config.physicalStopVisitDepartureLagMaximumMs
    : slowMembers.length >= config.physicalStopUnanchoredMinimumSlowSamples &&
      spread >= config.physicalStopUnanchoredMinimumSlowSpreadMs;
  if (!corroborated) return null;

  // Observed movement bounds the stop. A Visit estimate is used only inside
  // those bounds because iOS can overstate brief stops by several minutes.
  const startLower = arrivalAt;
  const startUpper = firstSlowAt;
  const stopLower = lastLocal.at;
  const stopUpper = departureAt;
  const visitStart = visits.length ? Math.min(...visits.map(({ evidence }) => Date.parse(evidence.occurredAt))) : null;
  const startedAt = visitStart != null
    ? iso(clamp(visitStart, startLower, startUpper))
    : stillArrivalAt != null ? iso(stillArrivalAt) : midpointTimeIso(iso(startLower), iso(startUpper));
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
    candidatePlaceIds,
    ...(stillSpans.length ? { stillSpans } : {})
  };
}
