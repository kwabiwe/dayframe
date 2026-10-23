import type { LocationSegment } from "@dayframe/shared";

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
