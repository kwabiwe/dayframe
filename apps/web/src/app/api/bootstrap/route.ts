import { NextResponse } from "next/server";
import { serverBuildMetadata } from "@/lib/build-metadata";
import { authErrorResponse } from "@/lib/api-errors";
import { isMissingRequiredColumnError } from "@/lib/db";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { getBootstrapData } from "@/lib/queries";
import { getServerLocationRolloutMode } from "@/lib/location/location-rollout";
import { scheduleLiveActivityRetry } from "@/lib/live-activity-post-response";

export async function GET(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const url = new URL(request.url);
    const data = await getBootstrapData(session, {
      selectedDate: url.searchParams.get("date")
    });
    scheduleLiveActivityRetry(session);
    return NextResponse.json({
      ...data,
      serverBuild: serverBuildMetadata(),
      locationRolloutMode: getServerLocationRolloutMode()
    });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (isMissingRequiredColumnError(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    throw error;
  }
}
