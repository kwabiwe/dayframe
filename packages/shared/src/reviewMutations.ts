import { z } from "zod";
import {
  ReviewEntryEditSchema, ConfirmLocationReviewSchema, IgnoreLocationReviewSchema,
  ChangePlaceAndConfirmSchema, RecordOnceLocationReviewSchema, RecordPoiOnceLocationReviewSchema,
  SavePlaceAndConfirmSchema, SplitLocationReviewSchema, MergeLocationReviewSchema
} from "./location/schemas";

export const ReviewMutationEditSchema = ReviewEntryEditSchema.extend({
  startedAt: z.string().datetime({ offset: true }),
  stoppedAt: z.string().datetime({ offset: true })
}).superRefine((value, context) => {
  if (Date.parse(value.stoppedAt) <= Date.parse(value.startedAt)) {
    context.addIssue({
      code: "custom",
      path: ["stoppedAt"],
      message: "End time must be after start time."
    });
  }
});

const completeEditMutationSchema = z.object({
  action: z.literal("edit_and_confirm"), edit: ReviewMutationEditSchema
}).strict();
const acceptMutationSchema = z.object({ action: z.literal("accept") }).strict();
const ignoreMutationSchema = z.object({ action: z.literal("ignore_once") }).strict();

export const GenericReviewMutationSchema = z.discriminatedUnion("action", [
  acceptMutationSchema, ignoreMutationSchema, completeEditMutationSchema
]);
export const DurableLocationReviewMutationSchema = z.discriminatedUnion("action", [
  ConfirmLocationReviewSchema, IgnoreLocationReviewSchema, completeEditMutationSchema,
  ChangePlaceAndConfirmSchema, RecordOnceLocationReviewSchema, RecordPoiOnceLocationReviewSchema,
  SavePlaceAndConfirmSchema, SplitLocationReviewSchema, MergeLocationReviewSchema
]);
export const ReviewMutationSchema = z.discriminatedUnion("action", [
  acceptMutationSchema, ignoreMutationSchema, ...DurableLocationReviewMutationSchema.options
]);

export const ReviewMutationEnvelopeSchema = z.object({
  clientMutationId: z.string().uuid(),
  mutation: ReviewMutationSchema
}).strict();

export type ReviewMutation = z.output<typeof ReviewMutationSchema>;
export type ReviewMutationEdit = z.output<typeof ReviewMutationEditSchema>;
export type ReviewMutationEnvelope = z.output<typeof ReviewMutationEnvelopeSchema>;

export const ReviewReconciliationRequestSchema = z.object({
  mutations: z.array(ReviewMutationEnvelopeSchema.extend({ reviewItemId: z.string().uuid() })).min(1).max(25)
}).strict();

// Legacy valid responses omit envelope identity. If present, all identity fields
// must match before a durable owner may acknowledge its saved intent.
export function validReviewAcknowledgement(body: unknown, envelope: ReviewMutationEnvelope, reviewItemId: string) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const value = body as Record<string, unknown>;
  if (value.ok !== true || value.action !== envelope.mutation.action) return false;
  if (value.clientMutationId !== undefined && value.clientMutationId !== envelope.clientMutationId) return false;
  if (value.reviewItemId !== undefined && value.reviewItemId !== reviewItemId) return false;
  if (value.partial === true) return false;
  const ignore = ["ignore_once", "ignore_once_location"].includes(envelope.mutation.action);
  if (["split", "split_and_confirm"].includes(envelope.mutation.action)) {
    return value.status === "accepted" && Array.isArray(value.childSegmentIds) && value.childSegmentIds.length === 2 &&
      value.childSegmentIds.every(id => typeof id === "string" && id.length > 0) &&
      (envelope.mutation.action !== "split_and_confirm" || Array.isArray(value.entryIds) && value.entryIds.length === 2 &&
        value.entryIds.every(id => typeof id === "string" && id.length > 0));
  }
  if (["merge", "merge_and_confirm"].includes(envelope.mutation.action)) {
    return value.status === "accepted" && typeof value.mergedSegmentId === "string" && value.mergedSegmentId.length > 0 &&
      (envelope.mutation.action !== "merge_and_confirm" || typeof value.entryId === "string" && value.entryId.length > 0);
  }
  return ignore ? value.status === "ignored" : value.status === "accepted" &&
    (typeof value.entryId === "string" && value.entryId.length > 0 ||
      value.alreadyResolved === true && value.equivalent === true);
}

export const ReviewReconciliationResultSchema = z.object({
  clientMutationId: z.string().uuid(), reviewItemId: z.string().uuid(),
  state: z.enum(["applied", "equivalent_applied", "open", "conflict", "missing", "unknown"]),
  checkedAt: z.string().datetime(), reason: z.string().optional(),
  retryOriginal: z.boolean().optional(), result: z.record(z.string(), z.unknown()).optional()
});
export const ReviewReconciliationResponseSchema = z.object({
  ok: z.literal(true), results: z.array(ReviewReconciliationResultSchema).max(25)
});
export type ReviewReconciliationResult = z.output<typeof ReviewReconciliationResultSchema>;
