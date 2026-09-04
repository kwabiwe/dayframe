import { NextResponse } from "next/server";
import { resolveReviewItem, ReviewResolutionError } from "@/lib/event-service";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import {
  LocationReviewActionSchema,
  ReviewMutationEnvelopeSchema
} from "@dayframe/shared";
import { resolveLocationReviewAction } from "@/lib/location/location-review-service";
import { resolveIdempotentReviewMutation } from "@/lib/review-mutation-service";

export const maxDuration = 15;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const operation = { signal: request.signal, deadlineAt: startedAt + 8_000, requestId };
  try {
    const session = await resolveRequestSession(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const reviewMutation = ReviewMutationEnvelopeSchema.safeParse(body);
    if (reviewMutation.success) {
      const result = await resolveIdempotentReviewMutation(
        id,
        reviewMutation.data,
        session,
        operation
      );
      return NextResponse.json({ ...result as Record<string, unknown>,
        clientMutationId: reviewMutation.data.clientMutationId, reviewItemId: id, requestId });
    }
    if (
      isRecord(body) &&
      (
        Object.prototype.hasOwnProperty.call(body, "clientMutationId") ||
        Object.prototype.hasOwnProperty.call(body, "mutation")
      )
    ) {
      return NextResponse.json(
        {
          ok: false,
          code: "invalid_action",
          message: "Invalid Review mutation envelope.",
          issues: reviewMutation.error.issues
        },
        { status: 400 }
      );
    }
    const action = isRecord(body) ? body.action : undefined;
    const locationAction = LocationReviewActionSchema.safeParse(body);
    if (
      locationAction.success &&
      [
        "edit_and_confirm",
        "confirm",
        "ignore_once_location",
        "change_place",
        "change_place_and_confirm",
        "record_once",
        "record_poi_once",
        "save_place_and_confirm",
        "split",
        "split_and_confirm",
        "merge",
        "merge_and_confirm"
      ].includes(locationAction.data.action)
    ) {
      const result = await resolveLocationReviewAction(id, locationAction.data, session, operation);
      return NextResponse.json(result);
    }
    const result = await resolveReviewItem(id, action, session, operation);
    return NextResponse.json(result);
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ReviewResolutionError) {
      return NextResponse.json(
        {
          ok: false,
          code: error.code,
          message: error.message,
          requestId,
          ...(error.details ? error.details : {})
        },
        { status: error.status }
      );
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
