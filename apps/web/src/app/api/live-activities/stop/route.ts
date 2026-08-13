import { after, NextResponse } from "next/server";
import { z } from "zod";
import {
  isDatabasePayloadError,
  isDatabaseReadinessError,
  isMissingRequiredColumnError
} from "@/lib/db";
import { processActivityEvent } from "@/lib/event-service";
import {
  LiveActivityControlError,
  notifyLiveActivitiesBestEffort,
  resolveLiveActivityControlSession
} from "@/lib/live-activity-push";

const StopSchema = z.object({
  token: z.string().regex(/^[0-9a-f]+$/i).min(32).max(512),
  activityId: z.string().trim().min(1).max(128),
  entryId: z.string().uuid(),
  clientEventId: z.string().trim().min(1).max(160)
});

export async function POST(request: Request) {
  try {
    const stop = StopSchema.parse(await request.json());
    const session = await resolveLiveActivityControlSession({
      token: stop.token.toLowerCase(),
      activityId: stop.activityId,
      entryId: stop.entryId
    });
    const result = await processActivityEvent({
      source: "shortcut",
      type: "timer_stop",
      occurredAt: new Date(),
      clientEventId: stop.clientEventId,
      rawPayload: {
        origin: "ios_live_activity",
        stopScope: "entry",
        targetActivityId: stop.activityId,
        targetEntryId: stop.entryId
      }
    }, session);
    // The exact timer mutation is already committed. APNs delivery must not
    // hold the App Intent response open long enough for iOS to terminate it.
    after(async () => {
      await notifyLiveActivitiesBestEffort(session);
    });
    return NextResponse.json(result, {
      status: result.duplicate ? 200 : 201,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (error instanceof LiveActivityControlError) {
      return NextResponse.json(
        { error: "Live Activity control is unavailable." },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (isMissingRequiredColumnError(error) || isDatabaseReadinessError(error)) {
      return NextResponse.json(
        { error: error.message },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (isDatabasePayloadError(error)) {
      return NextResponse.json(
        { error: error.message },
        { status: 422, headers: { "Cache-Control": "no-store" } }
      );
    }
    console.error("Dayframe Live Activity Stop failed", {
      name: error instanceof Error ? error.name : "UnknownError"
    });
    return NextResponse.json(
      { error: "Unable to stop this Live Activity." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
