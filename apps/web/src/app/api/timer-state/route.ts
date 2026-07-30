import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { getTimerState } from "@/lib/timer-state";

export async function GET(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const state = await getTimerState(session);
    return NextResponse.json(state, {
      headers: {
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
