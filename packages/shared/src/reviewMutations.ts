import { z } from "zod";
import { ReviewEntryEditSchema } from "./location/schemas";

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

export const ReviewMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }).strict(),
  z.object({ action: z.literal("ignore_once") }).strict(),
  z.object({ action: z.literal("confirm") }).strict(),
  z.object({ action: z.literal("ignore_once_location") }).strict(),
  z.object({
    action: z.literal("edit_and_confirm"),
    edit: ReviewMutationEditSchema
  }).strict()
]);

export const ReviewMutationEnvelopeSchema = z.object({
  clientMutationId: z.string().uuid(),
  mutation: ReviewMutationSchema
}).strict();

export type ReviewMutation = z.output<typeof ReviewMutationSchema>;
export type ReviewMutationEdit = z.output<typeof ReviewMutationEditSchema>;
export type ReviewMutationEnvelope = z.output<typeof ReviewMutationEnvelopeSchema>;
