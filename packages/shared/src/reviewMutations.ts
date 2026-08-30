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
