import type {
  CommuteQualificationReason,
  CommuteSegment,
  ContinuityStatus,
  LocationSegment,
  LocationSegmentStatus,
  MotionTravelMode,
  StaySegment
} from "@dayframe/shared";
import { isIsoInstant } from "./answerKey";
import { HarnessError } from "./errors";

/**
 * The scored view of an engine segment: kinds, times, anonymous place labels ("P4") and journey
 * measurements. Never coordinates, so a saved run can sit beside the private inputs.
 */
export type QualitySegment = {
  kind: "stay" | "commute";
  startedAt: string;
  stoppedAt: string | null;
  status: string;
  confidence: string;
  continuity: string;
  place: string | null;
  match: string | null;
  formation: string | null;
  from: string | null;
  to: string | null;
  reason: string | null;
  mode: string | null;
  routeM: number | null;
  lineM: number | null;
  stops: number;
  routeSamples: number | null;
  maxGapS: number | null;
  motionSupported: boolean;
  motionTimed: boolean;
  /** The trip's legs (location v4 step 6): times and engine mode codes only. */
  legs?: Array<{ startedAt: string; stoppedAt: string; mode: string | null }>;
};

export function toQualitySegments(segments: LocationSegment[], placeLabel: (id: string | null | undefined) => string): QualitySegment[] {
  return segments.map((segment) => {
    // Older engines (replayed with --engine) can carry fields the current types lack; read them loosely.
    const s = segment as LocationSegment & Record<string, unknown>;
    const isStay = segment.kind === "stay";
    return {
      kind: isStay ? "stay" : "commute",
      startedAt: segment.startedAt,
      stoppedAt: segment.stoppedAt ?? null,
      status: segment.status,
      confidence: segment.confidence,
      continuity: segment.continuityStatus,
      place: isStay ? placeLabel(s.placeId as string | null) : null,
      match: (s.placeMatchKind as string | undefined) ?? null,
      formation: (s.formation as string | undefined) ?? null,
      from: isStay ? null : placeLabel(s.fromPlaceId as string | null),
      to: isStay ? null : placeLabel(s.toPlaceId as string | null),
      reason: (s.qualificationReason as string | undefined) ?? null,
      mode: (s.travelMode as string | undefined) ?? null,
      routeM: (s.routeDistanceMeters as number | undefined) ?? null,
      lineM: (s.straightLineDistanceMeters as number | undefined) ?? null,
      stops: (s.stops as unknown[] | undefined)?.length ?? 0,
      routeSamples: (s.routeSampleCount as number | undefined) ?? null,
      maxGapS: (s.maximumObservationGapSeconds as number | undefined) ?? null,
      motionSupported: Boolean(s.motionSupported),
      motionTimed: Boolean(s.motionTimed),
      ...(Array.isArray(s.tripLegs) ? { legs: (s.tripLegs as Array<Record<string, unknown>>).map((leg) => ({
        startedAt: leg.startedAt as string, stoppedAt: leg.stoppedAt as string, mode: (leg.mode as string | undefined) ?? null
      })) } : {})
    };
  });
}

// The engine's own code values, tied to its types so a new code is a compile error here. A saved run
// keeps only these; anything else becomes "other" (or null), so no free text survives.
const ENGINE_CODES: Record<string, readonly string[]> = {
  status: ["candidate", "open", "closed", "finalised", "superseded", "ignored"] satisfies LocationSegmentStatus[],
  confidence: ["low", "medium", "medium_high", "high"] satisfies CommuteSegment["confidence"][],
  continuity: ["continuous", "supported_by_visit", "uncertain_gap", "broken_by_other_place", "manual"] satisfies ContinuityStatus[],
  match: ["saved", "learned", "unknown", "ambiguous"] satisfies StaySegment["placeMatchKind"][],
  formation: ["physical_stop"] satisfies NonNullable<StaySegment["formation"]>[],
  reason: [
    "significant_endpoint_displacement",
    "significant_route_distance",
    "endpoint_only_significant_distance",
    "same_place_meaningful_round_trip",
    "same_place_outing"
  ] satisfies CommuteQualificationReason[],
  mode: ["walking", "running", "cycling", "automotive"] satisfies MotionTravelMode[]
};

const SEGMENT_STRING_FIELDS = ["status", "confidence", "continuity"] as const;
const SEGMENT_NULLABLE_STRING_FIELDS = ["stoppedAt", "place", "match", "formation", "from", "to", "reason", "mode"] as const;
const SEGMENT_NULLABLE_NUMBER_FIELDS = ["routeM", "lineM", "routeSamples", "maxGapS"] as const;

/**
 * A saved run read back from disk, rebuilt field by field from the allowlist above, so nothing else
 * a file carries (a coordinate, a name) can reach a score or a re-saved run. Throws without quoting
 * the file.
 */
export function sanitizeQualitySegments(value: unknown): QualitySegment[] {
  if (!Array.isArray(value)) throw new HarnessError("A saved run must be a JSON array of segments.");
  return value.map((raw, index) => {
    const fail = (field: string) => new HarnessError(`Saved run segment ${index} has an invalid ${field}.`);
    if (!raw || typeof raw !== "object") throw fail("shape");
    const item = raw as Record<string, unknown>;
    if (item.kind !== "stay" && item.kind !== "commute") throw fail("kind");
    const instant = isIsoInstant;
    if (!instant(item.startedAt)) throw fail("startedAt");
    const out: Record<string, unknown> = { kind: item.kind, startedAt: item.startedAt };
    for (const field of SEGMENT_STRING_FIELDS) {
      if (typeof item[field] !== "string") throw fail(field);
      out[field] = item[field];
    }
    for (const field of SEGMENT_NULLABLE_STRING_FIELDS) {
      const fieldValue = item[field] ?? null;
      if (fieldValue !== null && typeof fieldValue !== "string") throw fail(field);
      out[field] = fieldValue;
    }
    if (out.stoppedAt !== null && !instant(out.stoppedAt)) throw fail("stoppedAt");
    // Place labels are anonymous ("P4", "-"), never names; the rest are engine codes.
    for (const field of ["place", "from", "to"] as const) {
      if (out[field] !== null && !/^(P\d+|-)$/.test(out[field] as string)) throw fail(field);
    }
    for (const [field, codes] of Object.entries(ENGINE_CODES)) {
      if (out[field] !== null && !codes.includes(out[field] as string)) {
        out[field] = (SEGMENT_STRING_FIELDS as readonly string[]).includes(field) ? "other" : null;
      }
    }
    for (const field of SEGMENT_NULLABLE_NUMBER_FIELDS) {
      const fieldValue = item[field] ?? null;
      if (fieldValue !== null && (typeof fieldValue !== "number" || !Number.isFinite(fieldValue))) throw fail(field);
      out[field] = fieldValue;
    }
    if (typeof item.stops !== "number" || !Number.isInteger(item.stops) || item.stops < 0) throw fail("stops");
    out.stops = item.stops;
    out.motionSupported = item.motionSupported === true;
    out.motionTimed = item.motionTimed === true;
    // Older saved runs and trips without legs have none.
    if (item.legs !== undefined && !Array.isArray(item.legs)) throw fail("legs");
    if (Array.isArray(item.legs)) out.legs = item.legs.map((leg: unknown) => {
      const value = leg as Record<string, unknown> | null;
      if (!value || !instant(value.startedAt) || !instant(value.stoppedAt)) throw fail("legs");
      return { startedAt: value.startedAt, stoppedAt: value.stoppedAt,
        mode: typeof value.mode === "string" && ENGINE_CODES.mode.includes(value.mode) ? value.mode : null };
    });
    return out as QualitySegment;
  });
}
