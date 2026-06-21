import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-errors";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { buildJsonExport, buildTimeEntriesCsv, type ExportKind } from "@/lib/export-service";

export async function GET(request: Request) {
  try {
    const session = await resolveRequestSession(request, { requiredScopes: ["exports:read"] });
    const url = new URL(request.url);
    const kind = (url.searchParams.get("kind") ?? "workspace_json") as ExportKind;

    if (kind === "time_entries_csv") {
      const csv = await buildTimeEntriesCsv(session);
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": "attachment; filename=dayframe-time-entries.csv"
        }
      });
    }

    const payload = await buildJsonExport(kind, session);
    return NextResponse.json(payload);
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
