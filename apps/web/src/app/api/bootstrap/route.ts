import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { getBootstrapData } from "@/lib/queries";

export async function GET(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const data = await getBootstrapData(session);
    return NextResponse.json(data);
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
