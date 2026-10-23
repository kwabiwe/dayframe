import type { LocationSegment } from "@dayframe/shared";
import { ISO_INSTANT } from "./answerKey";

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
      motionTimed: Boolean(s.motionTimed)
    };
  });
}

const SEGMENT_STRING_FIELDS = ["status", "confidence", "continuity"] as const;
const SEGMENT_NULLABLE_STRING_FIELDS = ["stoppedAt", "place", "match", "formation", "from", "to", "reason", "mode"] as const;
const SEGMENT_NULLABLE_NUMBER_FIELDS = ["routeM", "lineM", "routeSamples", "maxGapS"] as const;

/**
 * A saved run read back from disk, rebuilt field by field from the allowlist above, so nothing else
 * a file carries (a coordinate, a name) can reach a score or a re-saved run. Throws without quoting
 * the file.
 */
export function sanitizeQualitySegments(value: unknown): QualitySegment[] {
  if (!Array.isArray(value)) throw new Error("A saved run must be a JSON array of segments.");
  return value.map((raw, index) => {
    const fail = (field: string) => new Error(`Saved run segment ${index} has an invalid ${field}.`);
    if (!raw || typeof raw !== "object") throw fail("shape");
    const item = raw as Record<string, unknown>;
    if (item.kind !== "stay" && item.kind !== "commute") throw fail("kind");
    if (typeof item.startedAt !== "string" || !ISO_INSTANT.test(item.startedAt)) throw fail("startedAt");
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
    if (out.stoppedAt !== null && !ISO_INSTANT.test(out.stoppedAt as string)) throw fail("stoppedAt");
    // Place labels are anonymous ("P4", "-"), never names; the rest are engine codes.
    for (const field of ["place", "from", "to"] as const) {
      if (out[field] !== null && !/^(P\d+|-)$/.test(out[field] as string)) throw fail(field);
    }
    for (const field of ["status", "confidence", "continuity", "match", "formation", "reason", "mode"] as const) {
      if (out[field] !== null && !/^[a-z][a-z0-9_]*$/.test(out[field] as string)) throw fail(field);
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
    return out as QualitySegment;
  });
}
