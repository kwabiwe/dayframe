import { distanceMeters, stableLocationId } from "./geo";
import type { LocationEngineConfig } from "./config";
import type { ClassifiedEvidence, CommuteSegment, StaySegment } from "./types";

function segmentPoint(segment: StaySegment) {
  if (segment.centreLatitude == null || segment.centreLongitude == null) return null;
  return { latitude: segment.centreLatitude, longitude: segment.centreLongitude };
}

export function deriveCommutes(
  stays: StaySegment[],
  acceptedEvidence: ClassifiedEvidence[],
  config: LocationEngineConfig,
  processingAt: string
) {
  const commutes: CommuteSegment[] = [];
  for (let index = 1; index < stays.length; index += 1) {
    const from = stays[index - 1];
    const to = stays[index];
    if (!from.stoppedAt) continue;
    const startedAtMs = Date.parse(from.stoppedAt);
    const stoppedAtMs = Date.parse(to.startedAt);
    const duration = stoppedAtMs - startedAtMs;
    if (duration < config.commuteMinimumDurationMs || duration > config.commuteMaximumDurationMs) continue;

    const routeEvidence = acceptedEvidence.filter(({ evidence }) => {
      const at = Date.parse(evidence.occurredAt);
      return at > startedAtMs && at < stoppedAtMs && evidence.latitude != null && evidence.longitude != null;
    });
    const fromPoint = segmentPoint(from);
    const toPoint = segmentPoint(to);
    const routePoints = routeEvidence.length >= 2
      ? [
          ...(fromPoint ? [fromPoint] : []),
          ...routeEvidence.map(({ evidence }) => ({
            latitude: evidence.latitude!,
            longitude: evidence.longitude!
          })),
          ...(toPoint ? [toPoint] : [])
        ]
      : [];
    let routeDistanceMeters = 0;
    for (let routeIndex = 1; routeIndex < routePoints.length; routeIndex += 1) {
      routeDistanceMeters += distanceMeters(routePoints[routeIndex - 1], routePoints[routeIndex]);
    }
    const straightLineDistanceMeters = fromPoint && toPoint ? distanceMeters(fromPoint, toPoint) : null;
    const evidenceIds = routeEvidence.map(({ evidence }) => evidence.clientEvidenceId);
    const strongEndpoints = from.placeMatchKind !== "unknown" && to.placeMatchKind !== "unknown";
    const confidence = routeEvidence.length >= 2 && strongEndpoints ? "medium_high" : routeEvidence.length ? "medium" : "low";
    commutes.push({
      kind: "commute",
      clientSegmentId: stableLocationId("commute", [from.clientSegmentId, to.clientSegmentId]),
      algorithmVersion: config.algorithmVersion,
      status:
        Date.parse(processingAt) - stoppedAtMs >= config.segmentFinalisationLagMs ? "finalised" : "closed",
      startedAt: from.stoppedAt,
      stoppedAt: to.startedAt,
      fromStaySegmentId: from.clientSegmentId,
      toStaySegmentId: to.clientSegmentId,
      fromPlaceId: from.placeId ?? null,
      toPlaceId: to.placeId ?? null,
      routeDistanceMeters: routeEvidence.length >= 2 ? Math.round(routeDistanceMeters) : null,
      straightLineDistanceMeters: straightLineDistanceMeters == null ? null : Math.round(straightLineDistanceMeters),
      routeSampleCount: routeEvidence.length,
      gapDurationSeconds: Math.round(duration / 1000),
      continuityStatus:
        routeEvidence.length < 2 ||
        from.continuityStatus === "uncertain_gap" || to.continuityStatus === "uncertain_gap"
          ? "uncertain_gap"
          : "continuous",
      confidence,
      evidenceIds
    });
  }
  return commutes;
}
