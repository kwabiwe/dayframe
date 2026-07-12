import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { isDatabaseReadinessError, isMissingRequiredColumnError } from "@/lib/db";
import { getIntegrationTimeCurrentSnapshot } from "@/lib/integration-time";
import { resolveRequestSession } from "@/lib/ingest-auth";

export async function GET(request: Request) {
  try {
    const session = await resolveRequestSession(request, {
      allowIngestToken: true,
      allowBearerIntegrationToken: true,
      requiredScopes: ["time:read"]
    });
    const snapshot = await getIntegrationTimeCurrentSnapshot(session);
    return NextResponse.json(snapshot);
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (isMissingRequiredColumnError(error) || isDatabaseReadinessError(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    console.error("Dayframe integration time snapshot failed", error);
    return NextResponse.json({ error: "Unable to load the current timer." }, { status: 500 });
  }
}
