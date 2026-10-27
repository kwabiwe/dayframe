import { z } from "zod";
import { MotionTravelModeSchema } from "./schemas";

const GeoJsonPointSchema = z.object({
  type: z.literal("Point"),
  coordinates: z.tuple([z.number(), z.number()])
});

const GeoJsonLineStringSchema = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(z.tuple([z.number(), z.number()])).min(2)
});

export const LocationReviewEvidenceDtoSchema = z.object({
  reviewItemId: z.string().uuid(),
  eventId: z.string().uuid(),
  segment: z.object({
    id: z.string(),
    kind: z.enum(["stay", "commute"]),
    status: z.string(),
    startedAt: z.string(),
    stoppedAt: z.string().nullable(),
    approximateArrival: z.boolean().default(false),
    startUncertainty: z.object({ lower: z.string().nullable(), upper: z.string().nullable() }).optional(),
    stopUncertainty: z.object({ lower: z.string().nullable(), upper: z.string().nullable() }).optional(),
    confidence: z.string(),
    continuityStatus: z.string(),
    algorithmVersion: z.string(),
    evidenceCount: z.number().int().nonnegative(),
    rejectedEvidenceCount: z.number().int().nonnegative(),
    /** Commutes only: how the journey was travelled, from Motion & Fitness. */
    travelMode: MotionTravelModeSchema.nullable().optional(),
    /** Commutes only: time away from a saved or learned place rather than a journey. */
    timeAway: z.boolean().optional()
  }),
  display: z.object({
    title: z.string(),
    subtitle: z.string().nullable(),
    placeId: z.string().uuid().nullable(),
    placeName: z.string().nullable(),
    addressSummary: z.string().nullable()
  }),
  map: z.object({
    centre: GeoJsonPointSchema.nullable(),
    stayRadiusMeters: z.number().nullable(),
    route: GeoJsonLineStringSchema.nullable(),
    straightLineFallback: GeoJsonLineStringSchema.nullable(),
    acceptedSamples: z.array(z.object({
      id: z.string(),
      point: GeoJsonPointSchema,
      occurredAt: z.string(),
      accuracyMeters: z.number().nullable(),
      kind: z.string(),
      role: z.string().nullable()
    })),
    rejectedSamples: z.array(z.object({
      id: z.string(),
      point: GeoJsonPointSchema.nullable(),
      occurredAt: z.string(),
      kind: z.string(),
      reason: z.string()
    })),
    anchors: z.array(z.object({
      id: z.string(),
      point: GeoJsonPointSchema.nullable(),
      occurredAt: z.string(),
      endedAt: z.string().nullable(),
      kind: z.string(),
      label: z.string()
    })),
    gaps: z.array(z.object({
      startedAt: z.string(),
      stoppedAt: z.string(),
      durationSeconds: z.number(),
      fromPoint: GeoJsonPointSchema.nullable(),
      toPoint: GeoJsonPointSchema.nullable()
    })),
    nearbySavedPlaces: z.array(z.object({
      id: z.string().uuid(),
      name: z.string(),
      point: GeoJsonPointSchema,
      radiusMeters: z.number(),
      matchClass: z.enum(["strong", "plausible", "outside"]),
      distanceMeters: z.number()
    }))
  }),
  // Stops inside one trip, coordinate-free. Stop time is part of the trip, not movement.
  stops: z.array(z.object({
    startedAt: z.string(),
    stoppedAt: z.string(),
    durationSeconds: z.number().nonnegative(),
    approximate: z.boolean()
  })).optional(),
  suggestedSplitPoints: z.array(z.object({
    at: z.string(),
    reason: z.enum(["place_transition", "evidence_gap", "movement", "manual"]),
    confidence: z.string()
  })),
  /**
   * Apple venues for a stay (location v3 PR 8): the one picked when it was recorded, the one the
   * iPhone suggested, and those picked within 150 m before (Place IDs only, newest first).
   * Absent from older servers.
   */
  venue: z.object({
    confirmedPlaceId: z.string().nullable(),
    suggestedPlaceId: z.string().nullable(),
    historyPlaceIds: z.array(z.string()).max(20)
  }).optional(),
  evidenceExpiresAt: z.string().nullable(),
  evidenceExpired: z.boolean(),
  rawEvidenceAvailable: z.boolean(),
  textualSummary: z.string()
});

export type LocationReviewEvidenceDto = z.infer<typeof LocationReviewEvidenceDtoSchema>;

/**
 * A timeline item's evidence (location v4 step 12, the correction sheets' map): the same as a Review item's,
 * found by the timeline item (its client segment id), with its open Review item and its event when it has them.
 */
export const TimelineItemEvidenceDtoSchema = LocationReviewEvidenceDtoSchema.extend({
  itemId: z.string(),
  reviewItemId: z.string().uuid().nullable(),
  eventId: z.string().uuid().nullable()
});
export type TimelineItemEvidenceDto = z.infer<typeof TimelineItemEvidenceDtoSchema>;

/**
 * The map's words for people (location v4 step 12, owner feedback 27 Oct 2026), in place of the server's
 * diagnostic `textualSummary`: how many readings, each silence and each stop, in the viewer's own clock,
 * e.g. "25 readings · No readings 18:06–19:21". `time` formats an ISO instant on the viewer's clock.
 */
export function evidencePlainSummary(
  evidence: Pick<LocationReviewEvidenceDto, "segment" | "map" | "stops" | "evidenceExpired" | "rawEvidenceAvailable">,
  time: (iso: string) => string
) {
  if (evidence.evidenceExpired) return "Its readings have been deleted; only the times remain.";
  const count = evidence.segment.evidenceCount;
  const parts = [count === 0 ? "No readings" : `${count} reading${count === 1 ? "" : "s"}`];
  for (const stop of evidence.stops ?? []) {
    const minutes = Math.max(1, Math.round(stop.durationSeconds / 60));
    parts.push(`Stopped ${minutes} min ${time(stop.startedAt)}–${time(stop.stoppedAt)}`);
  }
  for (const gap of evidence.map.gaps) parts.push(`No readings ${time(gap.startedAt)}–${time(gap.stoppedAt)}`);
  return parts.join(" · ");
}
