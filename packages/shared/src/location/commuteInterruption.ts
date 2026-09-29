import { LOCATION_ENGINE_V2_CONFIG } from "./config";
import { distanceMeters } from "./geo";

type Point = { latitude: number; longitude: number };
const MINIMUM_INDEPENDENT_ROUTE_SAMPLES = 3;
const MAXIMUM_PLAUSIBLE_ROUTE_SPEED_MPS = 120;

export type RetainedCommuteRoutePoint = Point & {
  evidenceId: string;
  occurredAt: string;
  accuracyMeters: number | null;
  kind: string;
  role: string;
  isSimulated: boolean | null;
};

export type InterruptedCommuteLeg = {
  startedAt: string;
  stoppedAt: string;
  evidenceIds: string[];
  routeSampleCount: number;
  observedRouteDistanceMeters: number;
  endpointDisplacementMeters: number;
  maximumObservationGapSeconds: number;
};

export type InterruptedCommuteQualification =
  | { qualifies: true; inbound: InterruptedCommuteLeg; outbound: InterruptedCommuteLeg }
  | { qualifies: false; reason: "invalid_window" | "missing_stay_endpoint" | "insufficient_inbound_route" | "insufficient_outbound_route" };

// The user supplies both stop boundaries. Retained route observations prove each
// remaining leg independently; this function never discovers or names a stop.
export function qualifyConfirmedCommuteInterruption(input: {
  startedAt: string;
  stoppedAt: string;
  stopStartedAt: string;
  stopEndedAt: string;
  fromStayPoint: Point | null;
  toStayPoint: Point | null;
  routePoints: RetainedCommuteRoutePoint[];
}): InterruptedCommuteQualification {
  const start = Date.parse(input.startedAt);
  const stopStart = Date.parse(input.stopStartedAt);
  const stopEnd = Date.parse(input.stopEndedAt);
  const end = Date.parse(input.stoppedAt);
  if (![start, stopStart, stopEnd, end].every(Number.isFinite) ||
      !(start < stopStart && stopStart < stopEnd && stopEnd < end)) {
    return { qualifies: false, reason: "invalid_window" };
  }
  if (!input.fromStayPoint || !input.toStayPoint) {
    return { qualifies: false, reason: "missing_stay_endpoint" };
  }
  const inbound = qualifyLeg(start, stopStart, input.fromStayPoint, input.routePoints, "inbound");
  if (!inbound) return { qualifies: false, reason: "insufficient_inbound_route" };
  const outbound = qualifyLeg(stopEnd, end, input.toStayPoint, input.routePoints, "outbound");
  if (!outbound) return { qualifies: false, reason: "insufficient_outbound_route" };
  return { qualifies: true, inbound, outbound };
}

function qualifyLeg(
  startedAtMs: number,
  stoppedAtMs: number,
  stayPoint: Point,
  allPoints: RetainedCommuteRoutePoint[],
  side: "inbound" | "outbound"
): InterruptedCommuteLeg | null {
  const accepted = allPoints.filter((point) => {
    const time = Date.parse(point.occurredAt);
    return time > startedAtMs && time < stoppedAtMs &&
      point.role === "route" &&
      (point.kind === "standard_location" || point.kind === "significant_change") &&
      point.isSimulated === false &&
      point.accuracyMeters != null && Number.isFinite(point.accuracyMeters) && point.accuracyMeters >= 0 &&
      point.accuracyMeters <= LOCATION_ENGINE_V2_CONFIG.highQualityHorizontalAccuracyMeters &&
      Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 &&
      Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
  }).sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.evidenceId.localeCompare(b.evidenceId));

  const independent: RetainedCommuteRoutePoint[] = [];
  const seenIds = new Set<string>();
  const seenTimes = new Set<number>();
  for (const point of accepted) {
    if (seenIds.has(point.evidenceId)) continue;
    seenIds.add(point.evidenceId);
    const occurredAt = Date.parse(point.occurredAt);
    if (seenTimes.has(occurredAt)) continue;
    seenTimes.add(occurredAt);
    if (independent.some((other) => other.latitude === point.latitude && other.longitude === point.longitude)) continue;
    independent.push(point);
  }
  if (independent.length < MINIMUM_INDEPENDENT_ROUTE_SAMPLES) return null;
  let observedRouteDistanceMeters = 0;
  for (let index = 1; index < independent.length; index += 1) {
    const previous = independent[index - 1];
    const current = independent[index];
    const distance = distanceMeters(previous, current);
    const elapsedSeconds = (Date.parse(current.occurredAt) - Date.parse(previous.occurredAt)) / 1_000;
    if (elapsedSeconds <= 0 || distance / elapsedSeconds > MAXIMUM_PLAUSIBLE_ROUTE_SPEED_MPS) return null;
    observedRouteDistanceMeters += distance;
  }
  if (observedRouteDistanceMeters < LOCATION_ENGINE_V2_CONFIG.movementDisplacementThresholdMeters) return null;
  const nearStopPoint = side === "inbound" ? independent[independent.length - 1] : independent[0];
  const endpointDisplacementMeters = distanceMeters(stayPoint, nearStopPoint);
  if (endpointDisplacementMeters < LOCATION_ENGINE_V2_CONFIG.commuteMinimumEndpointDistanceMeters) return null;
  const times = [startedAtMs, ...independent.map((point) => Date.parse(point.occurredAt)), stoppedAtMs];
  let maximumGapMs = 0;
  for (let index = 1; index < times.length; index += 1) {
    maximumGapMs = Math.max(maximumGapMs, times[index] - times[index - 1]);
  }
  if (maximumGapMs > LOCATION_ENGINE_V2_CONFIG.maxContinuityGapMs) return null;
  return {
    startedAt: new Date(startedAtMs).toISOString(),
    stoppedAt: new Date(stoppedAtMs).toISOString(),
    evidenceIds: independent.map((point) => point.evidenceId),
    routeSampleCount: independent.length,
    observedRouteDistanceMeters,
    endpointDisplacementMeters,
    maximumObservationGapSeconds: Math.ceil(maximumGapMs / 1_000)
  };
}
