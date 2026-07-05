import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { isMissingRequiredColumnError } from "@/lib/db";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { getBootstrapData } from "@/lib/queries";

export async function GET(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const url = new URL(request.url);
    const data = await getBootstrapData(session, {
      selectedDate: url.searchParams.get("date")
    });
    return NextResponse.json(data);
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (isMissingRequiredColumnError(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    throw error;
  }
}
