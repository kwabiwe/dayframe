import { SyncOperationError, syncFailureMetadata } from "@/lib/sync-transaction";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { processActivityEvent, TimerMutationBusyError } from "@/lib/event-service";
import { isDatabasePayloadError, isDatabaseReadinessError, isMissingRequiredColumnError, isStatementTimeoutError, isLockNotAvailableError } from "@/lib/db";
import { scheduleLiveActivityNotification } from "@/lib/live-activity-post-response";

export async function POST(request: Request) {
  const deadlineAt = Date.now() + 8_000;
  try {
    const session = await resolveRequestSession(request, {
      allowIngestToken: true,
      requiredScopes: ["events:write"]
    });
    const body = await request.json();
    const result = await processActivityEvent(body, session, { signal: request.signal, deadlineAt });
    scheduleLiveActivityNotification(session);
    return NextResponse.json({ ...result,
      ...(typeof body?.clientEventId === "string" ? { clientEventId: body.clientEventId } : {})
    }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
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
    if (isDatabasePayloadError(error)) {
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
