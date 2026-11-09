import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { getCalendarWeek } from "@/lib/queries";
import { viewerTimeZoneIfSentForRequest } from "@/lib/viewer-time-zone-server";

const dateSchema = z.iso.date();

export async function GET(request: Request) {
  try {
    const session = await resolveRequestSession(request, { requiredScopes: ["app:read"] });
    const selectedDate = dateSchema.safeParse(new URL(request.url).searchParams.get("date"));
    if (!selectedDate.success) {
      return NextResponse.json({ error: "Pass date as YYYY-MM-DD" }, { status: 400 });
    }
    const data = await getCalendarWeek(session, {
      selectedDate: selectedDate.data,
      timeZone: viewerTimeZoneIfSentForRequest(request)
    });
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
