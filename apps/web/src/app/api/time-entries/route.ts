import { NextResponse } from "next/server";
import { createManualEntry, processActivityEvent, splitActiveEntry } from "@/lib/event-service";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";

export async function POST(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const body = await request.json();
    const eventSource = body.source === "mobile_app" ? "mobile_app" : "manual_app";
    const origin = eventSource === "mobile_app" ? "mobile_timer" : "web_timer";

    if (body.mode === "manual") {
      await createManualEntry(body, session);
      return NextResponse.json({ ok: true }, { status: 201 });
    }

    if (body.mode === "stop") {
      const result = await processActivityEvent(
        {
          source: eventSource,
          type: "timer_stop",
          occurredAt: new Date(),
          rawPayload: { origin }
        },
        session
      );
      return NextResponse.json(result, { status: 201 });
    }

    if (body.mode === "split") {
      await splitActiveEntry(session);
      return NextResponse.json({ ok: true }, { status: 201 });
    }

    const result = await processActivityEvent(
      {
        source: eventSource,
        type: "timer_start",
        occurredAt: new Date(),
        projectId: body.projectId,
        categoryId: body.categoryId,
        placeId: body.placeId,
        description: body.description,
        rawPayload: { origin }
      },
      session
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
