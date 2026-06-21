import { NextResponse } from "next/server";
import { createManualEntry, processActivityEvent } from "@/lib/event-service";

export async function POST(request: Request) {
  const body = await request.json();

  if (body.mode === "manual") {
    await createManualEntry(body);
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  if (body.mode === "stop") {
    const result = await processActivityEvent({
      source: "manual_app",
      type: "timer_stop",
      occurredAt: new Date(),
      rawPayload: { origin: "web_timer" }
    });
    return NextResponse.json(result, { status: 201 });
  }

  const result = await processActivityEvent({
    source: "manual_app",
    type: "timer_start",
    occurredAt: new Date(),
    projectId: body.projectId,
    categoryId: body.categoryId,
    placeId: body.placeId,
    description: body.description,
    rawPayload: { origin: "web_timer" }
  });
  return NextResponse.json(result, { status: 201 });
}
