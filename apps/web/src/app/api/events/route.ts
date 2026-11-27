import { SyncOperationError, syncFailureMetadata } from "@/lib/sync-transaction";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { TIME_ENTRY_CACHE_RECEIPT_HEADER } from "@dayframe/shared";
import { authErrorResponse, databaseReadinessResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { processActivityEvent, TimeEntryValidationError, TimerMutationBusyError, TimerReplacementWindowError, TimerStopBeforeStartError } from "@/lib/event-service";
import { isDatabasePayloadError, isDatabaseReadinessError, isMissingRequiredColumnError, isStatementTimeoutError, isLockNotAvailableError } from "@/lib/db";
import { scheduleLiveActivityNotification } from "@/lib/live-activity-post-response";
import { openReviewCountFor, withReviewCount } from "@/lib/review-count";
import { getTimeEntryById } from "@/lib/queries";
import { wantsReviewCardCount } from "@/lib/review-card-count";
import { reconcileHealthCoveredMoveCardsNow } from "@/lib/location/health-coverage";

const WebStopOwnerSchema = z.object({ userId: z.uuid(), workspaceId: z.uuid() });

export async function POST(request: Request) {
  const deadlineAt = Date.now() + 8_000;
  try {
    const session = await resolveRequestSession(request, {
      allowIngestToken: true,
      requiredScopes: ["events:write"]
    });
    const body = await request.json();
    if (body?.webStopOwner !== undefined) {
      const owner = WebStopOwnerSchema.parse(body.webStopOwner);
      if (body.type !== "timer_stop" || body.source !== "manual_app" || body.rawPayload?.stopScope !== "entry" ||
          !z.uuid().safeParse(body.rawPayload.targetEntryId).success) {
        return NextResponse.json({ error: "A web Stop must target a specific block." }, { status: 400 });
      }
      if (owner.userId !== session.userId || owner.workspaceId !== session.workspaceId) {
        return NextResponse.json({ error: "The account or workspace changed. Check the current block before trying again." }, { status: 409 });
      }
    }
    const result = await processActivityEvent(body, session, { signal: request.signal, deadlineAt });
    // Health walks win (PRD D19): a newly imported workout retires the location Move cards it covers.
    if (body?.type === "health_workout_import" && !result.duplicate) {
      await reconcileHealthCoveredMoveCardsNow(session, { deadlineAt, signal: request.signal, workout: importedWorkout(body) });
    }
    scheduleLiveActivityNotification(session);
    // The phone schedules its evening Review reminder from this count.
    const receiptId = body?.type === "timer_start" ? result.timeEntryId
      : body?.type === "timer_stop" && body.rawPayload?.stopScope === "entry" ? body.rawPayload.targetEntryId : undefined;
    const timerCacheEntryRead = request.headers.get(TIME_ENTRY_CACHE_RECEIPT_HEADER) === "1" &&
      session.scopes.includes("app:read") && typeof receiptId === "string" && z.uuid().safeParse(receiptId).success
      ? getTimeEntryById(session, receiptId).catch(() => undefined)
      : undefined;
    const [reviewCount, timerCacheEntry] = await Promise.all([
      openReviewCountFor(session, { cards: wantsReviewCardCount(request) }), timerCacheEntryRead
    ]);
    return NextResponse.json(withReviewCount({ ...result,
      ...(timerCacheEntry !== undefined ? { timerCacheEntry } : {}),
      ...(typeof body?.clientEventId === "string" ? { clientEventId: body.clientEventId } : {})
    }, reviewCount), { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    const readiness = databaseReadinessResponse(error);
    if (readiness) return readiness;
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // Timer events the timeline can't take are permanent (422 with a code), never a generic 500 the
    // phone retries forever while every later timer change waits behind it (stability audit 22 Oct).
    if (error instanceof TimerReplacementWindowError) {
      return NextResponse.json({ code: "timer_start_before_running_block", error: error.message }, { status: 422 });
    }
    if (error instanceof TimerStopBeforeStartError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status });
    }
    if (error instanceof TimerMutationBusyError) {
      return NextResponse.json(
        { code: error.code, error: error.message },
        { status: error.status }
      );
    }
    if (isMissingRequiredColumnError(error) || isDatabaseReadinessError(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (error instanceof TimeEntryValidationError || isDatabasePayloadError(error)) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    if (error instanceof SyncOperationError || isStatementTimeoutError(error) || isLockNotAvailableError(error)) {
      console.warn("Dayframe event sync deferred", syncFailureMetadata(error));
      return NextResponse.json({code:"event_sync_deferred",...syncFailureMetadata(error),error:"Activity delivery did not finish. Retry with the same event ID."},{status:503});
    }
    console.error("Dayframe event sync failed", { name: error instanceof Error ? error.name : "UnknownError",
      ...syncFailureMetadata(error) });
    return NextResponse.json(
      {
        error:
          "Unable to sync this event. Confirm the hosted database migrations are applied, then try again."
      },
      { status: 500 }
    );
  }
}

/**
 * The imported workout as ingestion keeps it: its sample, and its window with the same fallbacks
 * (`occurredAt` for a missing start or stop; Codex r4 on #457).
 */
function importedWorkout(body: { occurredAt?: unknown; rawPayload?: Record<string, unknown> } | null) {
  const text = (value: unknown) => typeof value === "string" && value.length > 0 ? value : null;
  const occurredAt = text(body?.occurredAt);
  const startedAt = text(body?.rawPayload?.startedAt) ?? occurredAt;
  const stoppedAt = text(body?.rawPayload?.stoppedAt) ?? occurredAt;
  if (!startedAt || !stoppedAt || !Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(stoppedAt))) return null;
  return { provider: text(body?.rawPayload?.provider), externalSampleId: text(body?.rawPayload?.externalSampleId), startedAt, stoppedAt };
}
