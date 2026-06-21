import { NextResponse } from "next/server";
import { resolveRequestSession } from "@/lib/ingest-auth";
import { buildJsonExport, buildTimeEntriesCsv, type ExportKind } from "@/lib/export-service";

export async function GET(request: Request) {
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
}
