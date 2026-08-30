import { LOCATION_ENGINE_V2_CONFIG } from "./config";
import type { LocationRolloutMode } from "./schemas";
import type { CommuteSegment, LocationSegment } from "./types";

export const AUTOMATIC_LOCATION_POLICY_VERSION = "automatic-location-v1";
export const AUTOMATIC_LOCATION_BOUNDARY_TOLERANCE_MS = 5 * 60_000;
export const AUTOMATIC_COMMUTE_OVERLAP_TOLERANCE_MS = 5 * 60_000;
export const AUTOMATIC_LOCATION_CONFLICT_OVERLAP_TOLERANCE_MS = 5 * 60_000;
export const AUTOMATIC_MEDIUM_COMMUTE_MIN_ROUTE_SAMPLES = 3;

export function hasAutomaticConfidence(confidence: string) {
  return confidence === "medium_high" || confidence === "high";
}

export type BoundaryAssessment = {
  eligible: boolean;
  startUncertaintyMs: number | null;
  stopUncertaintyMs: number | null;
  reason: "within_tolerance" | "missing_bounds" | "invalid_bounds" |
    "start_exceeds_tolerance" | "stop_exceeds_tolerance";
};

export function assessAutomaticLocationBoundaries(segment: Pick<LocationSegment,
  "startedAt" | "stoppedAt" | "startLowerBoundAt" | "startUpperBoundAt" |
  "stopLowerBoundAt" | "stopUpperBoundAt"
>): BoundaryAssessment {
  const result: BoundaryAssessment = {
    eligible: false, startUncertaintyMs: null, stopUncertaintyMs: null,
    reason: "missing_bounds"
  };
  const bounds = [segment.startLowerBoundAt, segment.startUpperBoundAt,
    segment.stopLowerBoundAt, segment.stopUpperBoundAt];
  if (bounds.some((bound) => bound == null)) return result;
  const values = [...bounds, segment.startedAt, segment.stoppedAt];
  if (values.some((value) => typeof value !== "string" ||
    !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))) {
    return { ...result, reason: "invalid_bounds" };
  }
  const [startLower, startUpper, stopLower, stopUpper, start, stop] = values.map((value) => Date.parse(value!));
  if (startUpper < startLower || stopUpper < stopLower || start < startLower ||
    start > startUpper || stop < stopLower || stop > stopUpper || stop <= start) {
    return { ...result, reason: "invalid_bounds" };
  }
  result.startUncertaintyMs = startUpper - startLower;
  result.stopUncertaintyMs = stopUpper - stopLower;
  if (result.startUncertaintyMs > AUTOMATIC_LOCATION_BOUNDARY_TOLERANCE_MS) {
    return { ...result, reason: "start_exceeds_tolerance" };
  }
  if (result.stopUncertaintyMs > AUTOMATIC_LOCATION_BOUNDARY_TOLERANCE_MS) {
    return { ...result, reason: "stop_exceeds_tolerance" };
  }
  return { ...result, eligible: true, reason: "within_tolerance" };
}

export type LocationAutomaticLoggingReason =
  | "enabled_trusted_stay" | "enabled_trusted_commute" | "enabled_medium_saved_route_commute"
  | "review_mode" | "segment_not_finalised" | "untrusted_place" | "untrusted_commute_endpoints"
  | "insufficient_confidence" | "insufficient_route_evidence" | "internal_route_gap"
  | "boundary_uncertainty_exceeded" | "boundary_bounds_missing" | "boundary_bounds_invalid"
  | "uncertain_boundary";

export type CommuteRouteAssessment = {
  eligible: boolean;
  tier: "standard" | "medium_saved_route" | "ineligible";
  reason: LocationAutomaticLoggingReason;
};

function boundaryReason(boundary: BoundaryAssessment): LocationAutomaticLoggingReason {
  if (boundary.reason === "missing_bounds") return "boundary_bounds_missing";
  if (boundary.reason === "invalid_bounds") return "boundary_bounds_invalid";
  return "boundary_uncertainty_exceeded";
}

export function assessAutomaticCommuteRoute(segment: CommuteSegment): CommuteRouteAssessment {
  const reject = (reason: LocationAutomaticLoggingReason): CommuteRouteAssessment => ({
    eligible: false, tier: "ineligible", reason
  });
  if (segment.status !== "finalised") return reject("segment_not_finalised");
  if (!segment.fromPlaceId || !segment.toPlaceId) return reject("untrusted_commute_endpoints");
  const standard = hasAutomaticConfidence(segment.confidence);
  if (!standard && segment.confidence !== "medium") return reject("insufficient_confidence");
  if (segment.continuityStatus === "manual") return reject("uncertain_boundary");
  const qualification = segment.qualificationReason;
  const qualified = standard
    ? qualification === "significant_endpoint_displacement" || qualification === "same_place_meaningful_round_trip"
    : segment.fromPlaceId !== segment.toPlaceId &&
      (qualification === "significant_endpoint_displacement" || qualification === "significant_route_distance");
  if (!qualified || !Number.isInteger(segment.routeSampleCount) ||
    segment.routeSampleCount < (standard ? 2 : AUTOMATIC_MEDIUM_COMMUTE_MIN_ROUTE_SAMPLES)) {
    return reject("insufficient_route_evidence");
  }
  // Legacy rows without an actual observation metric must fail closed.
  if (!Number.isFinite(segment.maximumObservationGapSeconds) || segment.maximumObservationGapSeconds < 0 ||
    segment.maximumObservationGapSeconds * 1_000 > LOCATION_ENGINE_V2_CONFIG.maxContinuityGapMs) {
    return reject("internal_route_gap");
  }
  const boundary = assessAutomaticLocationBoundaries(segment);
  if (!boundary.eligible) return reject(boundaryReason(boundary));
  return {
    eligible: true,
    tier: standard ? "standard" : "medium_saved_route",
    reason: standard ? "enabled_trusted_commute" : "enabled_medium_saved_route_commute"
  };
}

export type LocationAutomaticLoggingDecision = {
  action: "auto_confirm" | "review";
  reason: LocationAutomaticLoggingReason;
  confidenceTier: "standard" | "medium_saved_route" | "none";
  boundary: BoundaryAssessment;
};

export function assessAutomaticLocation(mode: LocationRolloutMode, segment: LocationSegment): LocationAutomaticLoggingDecision {
  const boundary = assessAutomaticLocationBoundaries(segment);
  const reject = (reason: LocationAutomaticLoggingReason): LocationAutomaticLoggingDecision => ({
    action: "review", reason, confidenceTier: "none", boundary
  });
  if (mode !== "v2_enabled") return reject("review_mode");
  if (segment.status !== "finalised") return reject("segment_not_finalised");
  if (segment.kind === "commute") {
    const route = assessAutomaticCommuteRoute(segment);
    return route.eligible ? {
      action: "auto_confirm", reason: route.reason,
      confidenceTier: route.tier === "standard" ? "standard" : "medium_saved_route", boundary
    } : reject(route.reason);
  }
  if (!((segment.placeMatchKind === "saved" && segment.placeId) ||
    (segment.placeMatchKind === "learned" && segment.learnedPlaceId))) return reject("untrusted_place");
  if (!hasAutomaticConfidence(segment.confidence)) return reject("insufficient_confidence");
  if (!["continuous", "supported_by_visit", "broken_by_other_place", "uncertain_gap"].includes(segment.continuityStatus)) {
    return reject("uncertain_boundary");
  }
  if (!boundary.eligible) return reject(boundaryReason(boundary));
  // Server verifies saved-place existence, learned linkage and logging preference.
  return { action: "auto_confirm", reason: "enabled_trusted_stay", confidenceTier: "standard", boundary };
}

export type AutomaticActivityKind = "health" | "location_stay" | "location_commute" | "manual_or_other";
export type AutomaticOverlapEntry = {
  id: string;
  startedAt: string;
  stoppedAt: string | null;
  source: string;
  eventType: string | null;
  eventId?: string | null;
  clientEventId?: string | null;
  placeId?: string | null;
};

export function classifyAutomaticActivity(entry: Pick<AutomaticOverlapEntry, "source" | "eventType">): AutomaticActivityKind {
  if (entry.source === "health_sleep" || entry.source === "health_workout" ||
    entry.eventType === "health_sleep_import" || entry.eventType === "health_workout_import") return "health";
  if (entry.eventType === "commute_detected") return "location_commute";
  if (["geofence", "location_learning"].includes(entry.source) &&
    ["geofence_enter", "geofence_exit", "learned_place_visit", "unknown_stay"].includes(entry.eventType ?? "")) return "location_stay";
  return "manual_or_other";
}

export type AutomaticOverlapDecision = {
  allowed: boolean;
  maximumOverlapMs: number;
  blockingEntryId: string | null;
  overlapClass: AutomaticActivityKind | null;
  reason: "no_overlap" | "health_overlap_allowed" | "stay_concurrent_activity_allowed" |
    "within_five_minute_tolerance" | "commute_overlap_exceeded" | "location_stay_conflict" | "invalid_time_window";
};

export function assessAutomaticOverlap(candidate: {
  kind: Exclude<AutomaticActivityKind, "manual_or_other">;
  startedAt: string;
  stoppedAt: string;
  eventId?: string | null;
  clientEventId?: string | null;
  placeId?: string | null;
}, entries: AutomaticOverlapEntry[]): AutomaticOverlapDecision {
  const start = Date.parse(candidate.startedAt), stop = Date.parse(candidate.stoppedAt);
  const empty: AutomaticOverlapDecision = {
    allowed: true, maximumOverlapMs: 0, blockingEntryId: null, overlapClass: null, reason: "no_overlap"
  };
  if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) {
    return { ...empty, allowed: false, reason: "invalid_time_window" };
  }
  const overlaps = entries.flatMap((entry) => {
    if ((candidate.eventId && candidate.eventId === entry.eventId) ||
      (candidate.clientEventId && candidate.clientEventId === entry.clientEventId)) return [];
    const entryStart = Date.parse(entry.startedAt);
    const entryStop = entry.stoppedAt == null ? stop : Date.parse(entry.stoppedAt);
    const overlap = Math.max(0, Math.min(stop, entryStop) - Math.max(start, entryStart));
    if (!Number.isFinite(overlap) || overlap === 0) return [];
    return [{ entry, entryStart, overlap, kind: classifyAutomaticActivity(entry) }];
  }).sort((a, b) => b.overlap - a.overlap || a.entryStart - b.entryStart || a.entry.id.localeCompare(b.entry.id));
  if (!overlaps.length) return empty;
  const maximum = overlaps[0];
  const base = { ...empty, maximumOverlapMs: maximum.overlap, overlapClass: maximum.kind };
  if (candidate.kind === "health") return { ...base, reason: "health_overlap_allowed" };
  const conflicts = overlaps.filter(({ entry, kind }) => candidate.kind === "location_commute" ||
    kind === "location_commute" || (kind === "location_stay" && (!candidate.placeId || entry.placeId !== candidate.placeId)));
  const blocker = conflicts.find(({ overlap }) => overlap > (candidate.kind === "location_commute"
    ? AUTOMATIC_COMMUTE_OVERLAP_TOLERANCE_MS : AUTOMATIC_LOCATION_CONFLICT_OVERLAP_TOLERANCE_MS));
  if (blocker) return {
    ...base, allowed: false, blockingEntryId: blocker.entry.id, overlapClass: blocker.kind,
    reason: candidate.kind === "location_commute" ? "commute_overlap_exceeded" : "location_stay_conflict"
  };
  return { ...base, reason: conflicts.length ? "within_five_minute_tolerance" : "stay_concurrent_activity_allowed" };
}
