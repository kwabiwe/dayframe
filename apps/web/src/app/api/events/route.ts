import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError } from "@/lib/session";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { processActivityEvent } from "@/lib/event-service";
import { isDatabaseReadinessError, isMissingRequiredColumnError } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const session = await resolveRequestSession(request, {
      allowIngestToken: true,
      requiredScopes: ["events:write"]
    });
    const body = await request.json();
    const result = await processActivityEvent(body, session);
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (isMissingRequiredColumnError(error) || isDatabaseReadinessError(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    console.error("Dayframe event sync failed", error);
    return NextResponse.json(
      {
        error:
          "Unable to sync this event. Confirm the hosted database migrations are applied, then try again."
      },
      { status: 500 }
    );
  }
}
