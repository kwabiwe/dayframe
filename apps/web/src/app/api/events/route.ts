import { NextResponse } from "next/server";
import { AuthError } from "@/lib/session";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { processActivityEvent } from "@/lib/event-service";

export async function POST(request: Request) {
  try {
    const session = await resolveRequestSession(request, {
      allowIngestToken: true,
      requiredScopes: ["events:write"]
    });
    const body = await request.json();
    const result = await processActivityEvent(body, session);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
