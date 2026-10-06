import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { addMissingStarterActivities } from "@/lib/starter-activities-service";

// Adds any starter activities this workspace is missing. Existing activities are never
// renamed or recoloured; one with a starter's name is linked to that starter instead.
export async function POST(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const result = await addMissingStarterActivities(session);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
