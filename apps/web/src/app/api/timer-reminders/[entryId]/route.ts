import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse } from "@/lib/api-errors";
import { query } from "@/lib/db";
import { processActivityEvent, TimerStopBeforeStartError } from "@/lib/event-service";
import { isForgottenTimerResponseAvailable, keepOverdueTimerRunning } from "@/lib/forgotten-timer-reminders";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { scheduleLiveActivityNotification } from "@/lib/live-activity-post-response";

type Context = { params: Promise<{ entryId: string }> };
const ResponseInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("keep") }),
  z.object({ action: z.literal("stop"), commandId: z.uuid() }),
  z.object({ action: z.literal("end"), commandId: z.uuid(), stoppedAt: z.iso.datetime({ offset: true }) })
]);

export async function GET(request: Request, { params }: Context) {
  try {
    const session = await resolveRequestSession(request, { requiredScopes: ["app:read"] });
    const entryId = z.uuid().parse((await params).entryId);
    return NextResponse.json({ available: await isForgottenTimerResponseAvailable(session, entryId) }, {
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch (error) {
    return authErrorResponse(error) ?? new NextResponse(null, { status: error instanceof z.ZodError ? 400 : 500 });
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const session = await resolveRequestSession(request, { requiredScopes: ["app:write"] });
    const entryId = z.uuid().parse((await params).entryId);
    const input = ResponseInput.parse(await request.json());
    if (input.action === "keep") {
      return new NextResponse(null, { status: await keepOverdueTimerRunning(session, entryId) ? 204 : 409 });
    }
    const now = new Date();
    const end = input.action === "end" ? new Date(input.stoppedAt) : now;
    if (end > now) return new NextResponse(null, { status: 422 });
    const clientEventId = `forgotten-timer:${entryId}:${input.commandId}`;
    const result = await processActivityEvent({
      source: "manual_app",
      type: "timer_stop",
      occurredAt: end,
      clientEventId,
      rawPayload: { origin: "forgotten_timer_response", targetEntryId: entryId, stopScope: "entry" }
    }, session, { overdueRunningStopOnly: true });
    if (result.stopOutcome === "stopped") scheduleLiveActivityNotification(session);
    const replayed = result.duplicate ? await query(
      `select 1 from activity_events where workspace_id = $1 and user_id = $2 and client_event_id = $3
         and raw_payload->>'origin' = 'forgotten_timer_response'
         and raw_payload->>'serverStopOutcome' = 'stopped'`,
      [session.workspaceId, session.userId, clientEventId]
    ) : null;
    return new NextResponse(null, { status: result.stopOutcome === "stopped" || replayed?.rowCount === 1 ? 204 : 409 });
  } catch (error) {
    if (error instanceof TimerStopBeforeStartError) return new NextResponse(null, { status: 422 });
    if (error instanceof SyntaxError || error instanceof z.ZodError) return new NextResponse(null, { status: 400 });
    return authErrorResponse(error) ?? new NextResponse(null, { status: 500 });
  }
}
