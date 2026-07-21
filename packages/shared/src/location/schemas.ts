import { z } from "zod";
import { LOCATION_ENGINE_V2_CONFIG } from "./config";

export const LocationEvidenceKindSchema = z.enum([
  "standard_location",
  "significant_change",
  "visit",
  "geofence_enter",
  "geofence_exit",
  "geofence_state",
  "location_paused",
  "location_resumed",
  "provider_status"
]);

const boundedId = z.string().trim().min(1).max(160);
const nullableFinite = z.number().finite().nullable().optional();

export const LocationRolloutModeSchema = z.enum([
  "v1",
  "v2_shadow",
  "v2_review",
  "v2_enabled"
]);

// `v2` shipped in the first V2 development build. Continue accepting it on
// ingest so an older TestFlight build cannot be stranded by the migration, but
// normalise it to the review-only contract. The server still decides whether
// semantic V2 output is enabled.
export const LocationRolloutModeRequestSchema = z
  .union([LocationRolloutModeSchema, z.literal("v2")])
  .transform((mode) => mode === "v2" ? "v2_review" as const : mode);

export const LocationEvidenceMetadataSchema = z
  .object({
    visitDepartureOpen: z.boolean().optional(),
    geofenceState: z.enum(["inside", "outside", "unknown"]).optional(),
    providerEnabled: z.boolean().optional(),
    authorizationStatus: z
      .enum(["not_determined", "restricted", "denied", "when_in_use", "always"])
      .optional(),
    accuracyAuthorization: z.enum(["full", "reduced", "unknown"]).optional(),
    errorCode: z.string().trim().max(80).optional(),
    signalSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional()
  })
  .strict();

const LocationEvidenceBaseSchema = z.object({
    clientEvidenceId: boundedId,
    deviceId: boundedId,
    algorithmVersion: z.string().trim().min(1).max(40),
    kind: LocationEvidenceKindSchema,
    occurredAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }).nullable().optional(),
    latitude: z.number().finite().min(-90).max(90).nullable().optional(),
    longitude: z.number().finite().min(-180).max(180).nullable().optional(),
    horizontalAccuracyMeters: z.number().finite().nonnegative().max(100_000).nullable().optional(),
    altitudeMeters: z.number().finite().min(-20_000).max(100_000).nullable().optional(),
    speedMetersPerSecond: nullableFinite,
    courseDegrees: z.number().finite().min(0).max(360).nullable().optional(),
    savedPlaceId: z.string().uuid().nullable().optional(),
    geofenceIdentifier: z.string().trim().min(1).max(160).nullable().optional(),
    sourceTimestamp: z.string().datetime({ offset: true }).nullable().optional(),
    receivedAt: z.string().datetime({ offset: true }),
    timeZone: z.string().trim().min(1).max(80),
    isSimulated: z.boolean().nullable().optional(),
    metadata: LocationEvidenceMetadataSchema.optional()
  }).strict();

function validateEvidenceShape(
  value: { latitude?: number | null; longitude?: number | null; occurredAt: string; endedAt?: string | null },
  context: z.RefinementCtx
) {
    const hasLatitude = value.latitude != null;
    const hasLongitude = value.longitude != null;
    if (hasLatitude !== hasLongitude) {
      context.addIssue({ code: "custom", message: "Latitude and longitude must be supplied together." });
    }
    if (value.endedAt && Date.parse(value.endedAt) < Date.parse(value.occurredAt)) {
      context.addIssue({ code: "custom", path: ["endedAt"], message: "Departure cannot precede arrival." });
    }
}

export const LocationEvidenceSchema = LocationEvidenceBaseSchema.superRefine(validateEvidenceShape);

export const LocationEvidenceUploadItemSchema = LocationEvidenceBaseSchema.omit({
  deviceId: true,
  algorithmVersion: true,
  timeZone: true
}).extend({
  deviceId: boundedId.optional(),
  algorithmVersion: z.string().trim().min(1).max(40).optional(),
  timeZone: z.string().trim().min(1).max(80).optional()
}).strict().superRefine(validateEvidenceShape);

export const LocationEvidenceBatchRequestSchema = z
  .object({
    clientBatchId: boundedId,
    deviceId: boundedId,
    algorithmVersion: z.string().trim().min(1).max(40),
    timeZone: z.string().trim().min(1).max(80),
    rolloutMode: LocationRolloutModeRequestSchema.default("v2_shadow"),
    semanticModeAcknowledgedAt: z.string().datetime({ offset: true }).optional(),
    evidence: z
      .array(LocationEvidenceUploadItemSchema)
      .min(1)
      .max(LOCATION_ENGINE_V2_CONFIG.maxEvidenceItemsPerUpload)
  })
  .strict()
  .superRefine((value, context) => {
    value.evidence.forEach((item, index) => {
      if (item.deviceId && item.deviceId !== value.deviceId) {
        context.addIssue({ code: "custom", path: ["evidence", index, "deviceId"], message: "Device ID does not match the batch." });
      }
      if (item.algorithmVersion && item.algorithmVersion !== value.algorithmVersion) {
        context.addIssue({ code: "custom", path: ["evidence", index, "algorithmVersion"], message: "Algorithm version does not match the batch." });
      }
      if (item.timeZone && item.timeZone !== value.timeZone) {
        context.addIssue({ code: "custom", path: ["evidence", index, "timeZone"], message: "Time zone does not match the batch." });
      }
    });
  })
  .transform((batch) => ({
    ...batch,
    evidence: batch.evidence.map((item) => ({
      ...item,
      deviceId: item.deviceId ?? batch.deviceId,
      algorithmVersion: item.algorithmVersion ?? batch.algorithmVersion,
      timeZone: item.timeZone ?? batch.timeZone
    }))
  }));

export const ReviewEntryEditSchema = z
  .object({
    categoryId: z.string().uuid().nullable().optional(),
    placeId: z.string().uuid().nullable().optional(),
    description: z.string().trim().max(500).optional(),
    startedAt: z.string().datetime({ offset: true }).optional(),
    stoppedAt: z.string().datetime({ offset: true }).optional(),
    tags: z.array(z.string().trim().min(1).max(50)).max(20).optional()
  })
  .strict();

const legacyReviewActionSchema = z.object({
  action: z.enum(["accept", "ignore", "ignore_once", "always_ignore_source", "create_rule"])
}).strict();

export const LocationReviewActionSchema = z.discriminatedUnion("action", [
  legacyReviewActionSchema,
  z.object({ action: z.literal("confirm") }).strict(),
  z.object({ action: z.literal("ignore_once_location") }).strict(),
  z.object({ action: z.literal("edit_and_confirm"), edit: ReviewEntryEditSchema }).strict(),
  z.object({
    action: z.enum(["change_place", "change_place_and_confirm"]),
    placeId: z.string().uuid().nullable(),
    learnedPlaceId: z.string().uuid().nullable().optional()
  }).strict(),
  z.object({ action: z.literal("record_once"), edit: ReviewEntryEditSchema.optional() }).strict(),
  z.object({
    action: z.literal("save_place_and_confirm"),
    name: z.string().trim().min(1).max(120),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    radiusMeters: z.number().int().min(30).max(160).default(80),
    edit: ReviewEntryEditSchema.optional()
  }).strict(),
  z.object({
    action: z.enum(["split", "split_and_confirm"]),
    splitAt: z.string().datetime({ offset: true }),
    left: ReviewEntryEditSchema.optional(),
    right: ReviewEntryEditSchema.optional()
  }).strict(),
  z.object({
    action: z.enum(["merge", "merge_and_confirm"]),
    adjacentReviewItemId: z.string().uuid(),
    acknowledgeContradictoryEvidence: z.boolean().default(false),
    edit: ReviewEntryEditSchema.optional()
  }).strict()
]);

export type LocationEvidenceBatchRequest = z.output<typeof LocationEvidenceBatchRequestSchema>;
export type LocationEvidenceUploadItem = z.input<typeof LocationEvidenceUploadItemSchema>;
export type LocationRolloutMode = z.infer<typeof LocationRolloutModeSchema>;
export type LocationReviewAction = z.output<typeof LocationReviewActionSchema>;
export type ReviewEntryEdit = z.output<typeof ReviewEntryEditSchema>;
