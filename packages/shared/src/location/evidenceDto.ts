import { z } from "zod";

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
    startUncertainty: z.object({ lower: z.string().nullable(), upper: z.string().nullable() }).optional(),
    stopUncertainty: z.object({ lower: z.string().nullable(), upper: z.string().nullable() }).optional(),
    confidence: z.string(),
    continuityStatus: z.string(),
    algorithmVersion: z.string(),
    evidenceCount: z.number().int().nonnegative(),
    rejectedEvidenceCount: z.number().int().nonnegative()
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
  suggestedSplitPoints: z.array(z.object({
    at: z.string(),
    reason: z.enum(["place_transition", "evidence_gap", "movement", "manual"]),
    confidence: z.string()
  })),
  evidenceExpiresAt: z.string().nullable(),
  evidenceExpired: z.boolean(),
  rawEvidenceAvailable: z.boolean(),
  textualSummary: z.string()
});

export type LocationReviewEvidenceDto = z.infer<typeof LocationReviewEvidenceDtoSchema>;
