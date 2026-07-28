import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { searchDayframe } from "@/lib/global-search";
import { resolveRequestSession } from "@/lib/ingest-auth";

export async function GET(request: Request) {
  try {
    const session = await resolveRequestSession(request);
    const searchTerm = new URL(request.url).searchParams.get("q") ?? "";
    if (searchTerm.trim().length < 2) {
      return NextResponse.json({ results: [] });
    }
    return NextResponse.json({ results: await searchDayframe(searchTerm, session) });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error("Dayframe global search failed", error);
    return NextResponse.json({ error: "Unable to search Dayframe." }, { status: 500 });
  }
}
