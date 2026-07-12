import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createManualEntry, processActivityEvent, splitActiveEntry, TimerReplacementWindowError } from "@/lib/event-service";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";

export async function POST(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const body = await request.json();
    const eventSource = body.source === "mobile_app" ? "mobile_app" : "manual_app";
    const origin = eventSource === "mobile_app" ? "mobile_timer" : "web_timer";

    if (body.mode === "manual") {
      const startedAt = requiredString(body.startedAt, "startedAt");
      const stoppedAt = requiredString(body.stoppedAt, "stoppedAt");
      await createManualEntry(
        {
          projectId: optionalString(body.projectId),
          categoryId: optionalString(body.categoryId),
          placeId: optionalString(body.placeId),
          description: optionalString(body.description),
          startedAt,
          stoppedAt
        },
        session
      );
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

    const startedAt = optionalTimestamp(body.startedAt, "startedAt");
    const occurredAt = startedAt ? new Date(startedAt) : new Date();
    const rawPayload = startedAt ? { origin, startedAt } : { origin };

    const result = await processActivityEvent(
      {
        source: eventSource,
        type: "timer_start",
        occurredAt,
        projectId: optionalString(body.projectId),
        categoryId: optionalString(body.categoryId),
        placeId: optionalString(body.placeId),
        description: optionalString(body.description),
        rawPayload
      },
      session
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof TimerReplacementWindowError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof ZodError || error instanceof BadRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Dayframe timer action failed", error);
    return NextResponse.json(
      {
        error:
          "Unable to save this time entry. Confirm the hosted database migrations are applied, then try again."
      },
      { status: 500 }
    );
  }
}

class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredString(value: unknown, field: string) {
  const next = optionalString(value);
  if (!next) throw new BadRequestError(`${field} is required.`);
  return next;
}

function optionalTimestamp(value: unknown, field: string) {
  const next = optionalString(value);
  if (!next) return undefined;
  const parsed = new Date(next);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestError(`${field} must be a valid date.`);
  if (parsed.getTime() > Date.now()) throw new BadRequestError(`${field} cannot be in the future.`);
  return parsed.toISOString();
}
