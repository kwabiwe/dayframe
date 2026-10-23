import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { getLocationTimeline } from "@/lib/location/location-timeline-service";
import { normalizeViewerTimeZone } from "@/lib/viewer-time-zone";
import { viewerTimeZoneForRequest } from "@/lib/viewer-time-zone-server";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/timeline?date=YYYY-MM-DD[&tz=Area/City] (location v4 step 8): the day's location timeline,
 * read-only. The day is cut in `tz` when given (the iPhone), else the web viewer's zone cookie, else UTC.
 */
export async function GET(request: Request) {
  try {
    const session = await resolveRequestSession(request, { requiredScopes: ["app:read"] });
    const url = new URL(request.url);
    const date = url.searchParams.get("date") ?? "";
    // A real calendar date: the range helper would quietly roll 2026-02-30 into March (Codex r1 on #564).
    const dayMs = DATE_KEY.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
    if (!Number.isFinite(dayMs) || new Date(dayMs).toISOString().slice(0, 10) !== date) {
      return NextResponse.json({ error: "Pass date as YYYY-MM-DD" }, { status: 400 });
    }
    const zone = url.searchParams.get("tz");
    const timeZone = zone ? normalizeViewerTimeZone(zone) : viewerTimeZoneForRequest(request);
    const timeline = await getLocationTimeline(session, { date, timeZone, now: new Date() });
    return NextResponse.json(timeline, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
